#!/usr/bin/env node
import { createServer, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, readdirSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { contained, guard, hash, HttpError, jsonBody } from './security.js';
import { Discovery, vectorOf } from './discovery.js';
import { advanced, mergePosition, SessionStore } from './session-store.js';
import { EventReader, type Observed } from './event-reader.js';
import { claudeStatuses } from './claude-reader.js';
import { antigravityStatuses } from './antigravity-reader.js';
import { Interactions } from './interaction.js';
import { SessionTitles } from './session-titles.js';
import type { SessionView, Vector } from '../shared/types.js';
import type { InteractionAttachment } from '../shared/interaction.js';
import { createSession } from './session-creator.js';
import { getAvailableModels } from './models.js';
import { extractRequestToken, RemoteControlManager } from './remote-control.js';
const port = Number(process.env.AGENT_BOARD_PORT ?? 4317);
const listenHost = process.env.AGENT_BOARD_HOST ?? '0.0.0.0';
const codexHome = process.env.AGENT_BOARD_CODEX_HOME ?? path.join(os.homedir(), '.codex');
const claudeHome = process.env.AGENT_BOARD_CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
const antigravityHome =
  process.env.AGENT_BOARD_ANTIGRAVITY_HOME ??
  (process.env.AGENT_BOARD_CODEX_HOME
    ? path.join(path.dirname(process.env.AGENT_BOARD_CODEX_HOME), 'antigravity')
    : path.join(os.homedir(), '.gemini', 'antigravity'));
const store = new SessionStore(
  process.env.AGENT_BOARD_DATA ??
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'AgentBoard'),
);
const discovery = new Discovery(
  [
    { provider: 'codex', root: path.join(codexHome, 'sessions') },
    { provider: 'codex', root: path.join(codexHome, 'archived_sessions') },
    { provider: 'claude', root: path.join(claudeHome, 'projects') },
    ...((process.env.AGENT_BOARD_ANTIGRAVITY_HOME || existsSync(path.join(antigravityHome, 'brain')))
      ? [{ provider: 'antigravity' as const, root: path.join(antigravityHome, 'brain') }]
      : []),
  ],
  store,
);
const events = new EventReader(store.secret);
const titles = new SessionTitles(codexHome, claudeHome, antigravityHome);
const observations = new Map<string, Observed>();
const activityBaselines = new Map<string, Vector>();
const clients = new Set<ServerResponse>();
function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
const remoteControl = new RemoteControlManager(store, port, () => {
  broadcast('remote_control', {});
});
const runtimeStates = new Map<string,string>();
const interactions = new Interactions(codexHome, claudeHome, (id) => {
  broadcast('interaction', { id });
  const state = interactions.activeState(id)?.state ?? '';
  if (runtimeStates.get(id) !== state) {
    runtimeStates.set(id, state);
    broadcast('change', {});
    void reconcile();
  }
}, antigravityHome);
let agStatuses = new Map<string, { state: SessionView['execution']; reason: string }>();
let statuses = new Map<string, { state: SessionView['execution']; reason: string }>();
let scanError: string | null = null;
let scan: Promise<void> | undefined;
let initialized = false;

const PROJECT_MARKERS = [
  '.git',
  '.svn',
  '.hg',
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'go.mod',
  'Cargo.toml',
  'CMakeLists.txt',
  'Makefile',
  'composer.json',
  'tsconfig.json',
  'vite.config.ts',
  '.idea',
  '.vscode',
  '.cursor',
  'AGENTS.md',
  'CLAUDE.md',
  '.codexignore',
  'docker-compose.yml',
  'Dockerfile',
];

function isNonProjectPath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== 'string') return true;
  const cleaned = rawPath.trim().replace(/[/\\]+$/, '');
  if (!cleaned) return true;
  const norm = cleaned.replace(/\//g, '\\').toLowerCase();
  const home = os.homedir().replace(/\//g, '\\').toLowerCase();

  if (/^[a-z]:$/i.test(norm) || norm === '\\') return true;
  if (
    norm === home ||
    norm === `${home}\\documents` ||
    norm === `${home}\\desktop` ||
    norm === `${home}\\downloads` ||
    norm === `${home}\\appdata`
  ) {
    return true;
  }

  const blacklistedSegments = [
    '\\documents\\codex\\',
    '\\.claude\\',
    '\\.codex\\',
    '\\.gemini\\',
    '\\.worktrees\\',
    '\\.codex-worktrees\\',
    '\\appdata\\',
    '\\node_modules\\',
    '\\temp\\',
    '\\tmp\\',
  ];
  const withTrailing = `${norm}\\`;
  for (const seg of blacklistedSegments) {
    if (withTrailing.includes(seg)) return true;
  }

  const base = path.basename(norm);
  if (
    base.startsWith('.codex-') ||
    base.startsWith('.backup-worktree') ||
    base === '.claude' ||
    base === '.codex' ||
    base === '.gemini' ||
    base === '.worktrees'
  ) {
    return true;
  }
  return false;
}

function hasProjectMarker(dirPath: string): boolean {
  try {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(path.join(dirPath, marker))) return true;
    }
    const entries = readdirSync(dirPath);
    if (
      entries.some(
        (e) => e.endsWith('.sln') || e.endsWith('.csproj') || e.endsWith('.code-workspace'),
      )
    ) {
      return true;
    }
  } catch {}
  return false;
}

function resolveValidProjectDir(rawPath: string, requireMarker = true): string | null {
  if (isNonProjectPath(rawPath)) return null;
  try {
    if (!existsSync(rawPath)) return null;
    const st = statSync(rawPath);
    if (!st.isDirectory()) return null;
    let real = realpathSync.native ? realpathSync.native(rawPath) : realpathSync(rawPath);
    if (isNonProjectPath(real)) return null;

    if (!existsSync(path.join(real, '.git'))) {
      let curr = real;
      for (let i = 0; i < 2; i++) {
        const parent = path.dirname(curr);
        if (!parent || parent === curr || isNonProjectPath(parent)) break;
        if (existsSync(path.join(parent, '.git'))) {
          real = parent;
          break;
        }
        curr = parent;
      }
    }

    if (requireMarker && !hasProjectMarker(real)) return null;
    return real;
  } catch {
    return null;
  }
}

const fingerprint = () =>
  hash(
    JSON.stringify([
      [...discovery.sessions.values()].map((s) => [
        s.id,
        s.files.map((f) => [f.size, f.mtime]),
        observations.get(s.id)?.state,
        observations.get(s.id)?.activity,
      ]),
      [...statuses],
      [...agStatuses],
      [...titles.values],
      discovery.sources,
    ]),
  );
let pendingReconcile = false;
async function reconcile() {
  if (scan) {
    pendingReconcile = true;
    return scan;
  }
  scan = (async () => {
    do {
      pendingReconcile = false;
      const before = fingerprint();
      await discovery.scan();
      for (const id of activityBaselines.keys())
        if (!discovery.sessions.has(id)) activityBaselines.delete(id);
      await titles.refresh(discovery.sessions.values());
      statuses = await claudeStatuses(claudeHome, discovery.sessions.values());
      agStatuses = await antigravityStatuses(antigravityHome, discovery.sessions);
      const sorted = [...discovery.sessions.values()].sort(
        (a, b) =>
          Math.max(0, ...b.files.map((f) => f.mtime)) - Math.max(0, ...a.files.map((f) => f.mtime)),
      );
      for (const session of sorted) store.ensure(session.id, vectorOf(session));
      const observeSession = async (session: (typeof sorted)[number]) => {
        const meta = store.get(session.id)!;
        try {
          const previousBaseline = activityBaselines.get(session.id) ?? {};
          const baseline = Object.fromEntries(
            session.files.map((file) => [
              file.key,
              previousBaseline[file.key]?.generation === file.generation
                ? previousBaseline[file.key]
                : { generation: file.generation, offset: file.size },
            ]),
          );
          activityBaselines.set(session.id, baseline);
          let previous = observations.get(session.id);
          if (
            previous &&
            session.files.length > 0 &&
            Object.keys(previous.progress).length === session.files.length &&
            session.files.every((f) => {
              const p = previous!.progress[f.key];
              return p && p.generation === f.generation && p.offset === f.size && !p.skipping;
            })
          ) {
            return;
          }
          if (!previous && Object.keys(meta.progress).length) {
            const seed = await events.observe(session);
            previous = {
              ...seed,
              progress: meta.progress,
              output: meta.observed,
            };
          }
          let prevProgress = previous?.progress ?? {};
          let observation = await events.observe(session, previous, baseline);
          while (
            session.files.some((f) => {
              const p = observation.progress[f.key];
              const prev = prevProgress[f.key];
              const advancedProgress = !prev || prev.generation !== p?.generation || (p?.offset ?? 0) > prev.offset;
              return (
                p &&
                p.generation === f.generation &&
                p.offset < f.size &&
                !p.skipping &&
                advancedProgress
              );
            })
          ) {
            prevProgress = observation.progress;
            observation = await events.observe(session, observation, baseline);
          }
          observations.set(session.id, observation);
          const latestMeta = store.get(session.id)!;
          const serialized = JSON.stringify(latestMeta);
          latestMeta.observed = mergePosition(latestMeta.observed, observation.output);
          latestMeta.progress = observation.progress;
          if (session.files.length)
            latestMeta.observed = Object.fromEntries(
              Object.entries(latestMeta.observed).filter(([key]) =>
                session.files.some((f) => f.key === key),
              ),
            );
          if (latestMeta.archived && advanced(latestMeta.observed, latestMeta.archived))
            latestMeta.archived = null;
          if (JSON.stringify(latestMeta) !== serialized) store.save(latestMeta);
        } catch {
          observations.set(session.id, {
            progress: {},
            output: {},
            state: 'UNKNOWN',
            reason: '原生文件读取失败',
            diagnostics: ['原生文件读取失败，请检查权限或来源目录'],
          });
        }
      };
      for (let i = 0; i < sorted.length; i += 16)
        await Promise.all(sorted.slice(i, i + 16).map(observeSession));
      scanError = null;
      initialized = true;
      const after = fingerprint();
      if (after !== before) broadcast('change', {});
    } while (pendingReconcile);
  })()
    .catch(() => {
      scanError = '来源扫描失败，请检查文件权限与应用数据目录';
      broadcast('change', { sourceUnavailable: true });
    })
    .finally(() => {
      scan = undefined;
    });
  return scan;
}

const rootWatchers: FSWatcher[] = [];
let reconcileDebounce: NodeJS.Timeout | undefined;

function scheduleReconcile(delayMs = 80) {
  if (reconcileDebounce) clearTimeout(reconcileDebounce);
  reconcileDebounce = setTimeout(() => {
    reconcileDebounce = undefined;
    void reconcile();
  }, delayMs);
}

function initRootWatchers() {
  const watchDirs = new Set<string>();
  for (const root of discovery.roots) {
    if (existsSync(root.root)) {
      watchDirs.add(root.root);
    }
  }
  for (const sub of ['agent-board-bridges', 'sessions']) {
    const dir = path.join(claudeHome, sub);
    if (existsSync(dir)) {
      watchDirs.add(dir);
    }
  }
  if (existsSync(antigravityHome)) {
    watchDirs.add(antigravityHome);
  }
  for (const dir of watchDirs) {
    try {
      const w = watch(dir, { recursive: true }, () => {
        scheduleReconcile(80);
      });
      w.on('error', () => {});
      rootWatchers.push(w);
    } catch {}
  }
}

void reconcile();
initRootWatchers();
const interval = setInterval(() => {
  if (!scan) void reconcile();
}, 2000);
// Expiration is a presentation change: no native reads and no event revision bump.
const activityInterval = setInterval(() => {
  let changed = false;
  for (const observation of observations.values()) {
    const activity = observation.activity;
    if (activity && !activity.expired && Date.now() - activity.lastOutputAt >= 30000) {
      activity.expired = true;
      changed = true;
    }
  }
  if (changed) broadcast('change', {});
}, 1000);
function view(id: string): SessionView {
  const s = discovery.sessions.get(id)!;
  let meta = store.get(id);
  if (!meta) {
    store.ensure(s.id, vectorOf(s));
    meta = store.get(id)!;
  }
  const obs = observations.get(id);
  const name = titles.values.get(id);
  const live =
    s.provider === 'claude'
      ? statuses.get(s.nativeId)
      : s.provider === 'antigravity'
        ? agStatuses.get(s.nativeId)
        : undefined;
  const owned = interactions.activeState(id);
  const nativeExecution = live?.state ?? obs?.state ?? 'UNKNOWN';
  const execution = owned ? owned.state : nativeExecution;
  const unread = advanced(meta.observed, meta.read ?? meta.baseline);
  const attention = meta.archived
    ? 'ARCHIVED'
    : unread
      ? nativeExecution === 'COMPLETED'
        ? 'UNREAD_COMPLETION'
        : 'UNREAD_OUTPUT'
      : meta.read
        ? 'READ'
        : 'BASELINE_EXISTING';
  return {
    id: s.id,
    nativeId: s.nativeId,
    provider: s.provider,
    title: name?.title ?? `未命名会话 · ${s.nativeId.slice(0, 8)}`,
    cwd: s.cwd,
    segments: s.files.length,
    order: meta.ordinal,
    execution,
    stateReason: owned?.reason ?? live?.reason ?? obs?.reason ?? '来源未知',
    ...(obs?.activity
      ? {
          activity: {
            label: obs.activity.expired ? ('暂未更新' as const) : ('近期有输出' as const),
            observedAt: obs.activity.lastOutputAt,
          },
        }
      : {}),
    attention,
    archived: !!meta.archived,
    discoveredAt: meta.discovered,
    updatedAt: s.files.length ? Math.max(0, ...s.files.map((f) => f.mtime)) : (s.createdAt ?? 0),
    diagnostics: [
      ...s.diagnostics,
      ...(obs?.diagnostics ?? []),
      ...(name?.diagnostic ? [name.diagnostic] : []),
    ],
    revision: hash(JSON.stringify([vectorOf(s), obs?.state, live, owned, meta])),
  };
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const isPublicStaticAsset =
      req.method === 'GET' &&
      (url.pathname.startsWith('/assets/') ||
        url.pathname === '/icon.svg' ||
        url.pathname === '/apple-touch-icon.png' ||
        url.pathname === '/manifest.webmanifest' ||
        url.pathname === '/sw.js');
    const { isRemoteClient } = guard(req, port, (r) =>
      isPublicStaticAsset
        ? remoteControl.isEnabled()
        : remoteControl.verifyToken(extractRequestToken(r, port)),
    );
    if (isRemoteClient) {
      const reqToken = extractRequestToken(req, port);
      if (reqToken && remoteControl.verifyToken(reqToken)) {
        res.setHeader(
          'Set-Cookie',
          `agent_board_rc=${encodeURIComponent(reqToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        );
      }
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      if (!initialized) {
        res.end(
          JSON.stringify({
            sessions: [],
            total: 0,
            nextCursor: null,
            sources: discovery.sources,
            initializing: true,
            error: scanError,
          }),
        );
        return;
      }
      let sessions = [...discovery.sessions.keys()]
        .map(view)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.order - b.order);
      const archive = url.searchParams.get('archive');
      if (archive !== 'all') sessions = sessions.filter((s) => s.archived === (archive === 'true'));
      const provider = url.searchParams.get('provider');
      const state = url.searchParams.get('state');
      if (provider) sessions = sessions.filter((s) => s.provider === provider);
      if (state) sessions = sessions.filter((s) => s.execution === state || s.attention === state);
      const size = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 12)));
      if (!Number.isInteger(size)) throw new HttpError(400, '分页大小无效');
      const token = url.searchParams.get('cursor');
      const offset = token
        ? events.cursor.decode<{ kind: string; offset: number }>(token)
        : { kind: 'list', offset: 0 };
      if (offset.kind !== 'list' || !Number.isSafeInteger(offset.offset) || offset.offset < 0)
        throw new HttpError(400, '列表游标无效');
      const pageSessions = sessions.slice(offset.offset, offset.offset + size);
      const pin = url.searchParams.get('pin');
      if (pin && offset.offset === 0 && !pageSessions.some((s) => s.id === pin)) {
        if (discovery.sessions.has(pin)) {
          pageSessions.unshift(view(pin));
        }
      }
      res.end(
        JSON.stringify({
          sessions: pageSessions,
          total: sessions.length,
          nextCursor:
            offset.offset + size < sessions.length
              ? events.cursor.encode({
                  kind: 'list',
                  offset: offset.offset + size,
                })
              : null,
          sources: discovery.sources,
          error: scanError,
        }),
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      try {
        res.write('event: ready\ndata: {}\n\n');
      } catch {
        res.end();
        return;
      }
      clients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          cleanup();
        }
      }, 15000);
      const cleanup = () => {
        clients.delete(res);
        clearInterval(heartbeat);
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }
    const interaction = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{24})\/(interaction-capability|interaction)(?:\/(send|decision|interrupt))?$/);
    if (interaction) {
      const session = discovery.sessions.get(interaction[1]);
      if (!session) throw new HttpError(404, '原生会话不存在');
      if (req.method === 'GET' && !interaction[3]) {
        res.end(JSON.stringify(await interactions.view(session))); return;
      }
      if (req.method === 'POST' && interaction[2] === 'interaction' && interaction[3]) {
        const body = await jsonBody(req);
        const result = interaction[3] === 'send' ? await interactions.send(session, body)
          : interaction[3] === 'decision' ? await interactions.decision(session.id, body)
          : await interactions.interrupt(session.id, body);
        res.end(JSON.stringify(result)); return;
      }
      throw new HttpError(405, '交互操作不支持此方法');
    }
    const attachmentMatch = url.pathname.match(
      /^\/api\/(?:sessions\/([a-f0-9]{24})|(draft))\/attachments(?:\/(.+))?$/,
    );
    if (attachmentMatch) {
      const isDraft = !!attachmentMatch[2];
      let attachmentsDir: string;
      let urlPrefix: string;

      if (isDraft) {
        attachmentsDir = path.join(store.directory, 'attachments', 'draft');
        urlPrefix = '/api/draft/attachments';
      } else {
        const session = discovery.sessions.get(attachmentMatch[1]);
        if (!session) throw new HttpError(404, '原生会话不存在');
        attachmentsDir = path.join(store.directory, 'attachments', session.id);
        urlPrefix = `/api/sessions/${session.id}/attachments`;
      }
      await mkdir(attachmentsDir, { recursive: true });

      const subPath = attachmentMatch[3];
      if (req.method === 'POST' && !subPath) {
        const body = await jsonBody(req, 30 * 1024 * 1024);
        const { name, mimeType, data } = body;
        if (typeof name !== 'string' || !name.trim() || typeof data !== 'string' || !data) {
          throw new HttpError(400, '无效的文件数据');
        }
        const buffer = Buffer.from(data, 'base64');
        if (buffer.length > 25 * 1024 * 1024) {
          throw new HttpError(413, '文件大小超过 25MB 上限');
        }
        const cleanName = path.basename(name).replace(/[^\w.\-_\u4e00-\u9fa5]/g, '_');
        const fileId = `${Date.now()}_${randomBytes(4).toString('hex')}_${cleanName}`;
        const filePath = path.join(attachmentsDir, fileId);
        await writeFile(filePath, buffer);

        const attachment: InteractionAttachment = {
          id: fileId,
          name: path.basename(name),
          size: buffer.length,
          mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'application/octet-stream',
          localPath: filePath,
          url: `${urlPrefix}/${encodeURIComponent(fileId)}`,
        };
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(attachment));
        return;
      }

      if ((req.method === 'GET' || req.method === 'DELETE') && subPath) {
        const fileName = decodeURIComponent(subPath);
        const resolved = path.resolve(attachmentsDir, fileName);
        const rel = path.relative(attachmentsDir, resolved);
        if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
          throw new HttpError(403, '路径超出允许的来源目录');
        }
        if (!existsSync(resolved)) throw new HttpError(404, '未找到附件');
        const filePath = await contained(attachmentsDir, resolved);

        if (req.method === 'GET') {
          const mimeMap: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
          };
          const ext = path.extname(filePath).toLowerCase();
          res.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
          res.end(await readFile(filePath));
          return;
        }

        if (req.method === 'DELETE') {
          await unlink(filePath).catch(() => {});
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true }));
          return;
        }
      }

      throw new HttpError(405, '附件操作不支持此方法');
    }
    const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{24})\/events$/);
    if (req.method === 'GET' && match) {
      if (!initialized) await reconcile();
      let session = discovery.sessions.get(match[1]);
      if (!session) throw new HttpError(404, '原生会话不存在');

      let needsReconcile = false;
      for (const file of session.files) {
        try {
          const st = await stat(file.path);
          if (file.size !== st.size || file.mtime !== st.mtimeMs) {
            needsReconcile = true;
            break;
          }
        } catch {}
      }
      if (needsReconcile) {
        await reconcile();
        session = discovery.sessions.get(match[1]);
        if (!session) throw new HttpError(404, '原生会话不存在');
      }

      if (session.provider === 'antigravity' && !session.files.length) {
        const tPath = path.join(
          antigravityHome,
          'brain',
          session.nativeId,
          '.system_generated',
          'logs',
          'transcript.jsonl',
        );
        if (existsSync(tPath)) {
          await reconcile();
          session = discovery.sessions.get(match[1]) ?? session;
        }
      }

      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
      if (!Number.isInteger(limit)) throw new HttpError(400, '事件数量无效');
      if (!session.files.length) {
        if (session.provider === 'antigravity') {
          res.end(
            JSON.stringify({
              items: [],
              nextCursor: null,
              snapshotCursor: '',
              truncated: false,
              diagnostics: [],
            }),
          );
          return;
        }
        throw new HttpError(503, '原生来源不可用');
      }
      res.end(
        JSON.stringify(
          await events.page(session, url.searchParams.get('cursor') ?? undefined, limit),
        ),
      );
      return;
    }
    const mutation = url.pathname.match(
      /^\/api\/sessions\/([a-f0-9]{24})\/(read|archive|unarchive)$/,
    );
    if (req.method === 'POST' && mutation) {
      const body = await jsonBody(req);
      await reconcile();
      const session = discovery.sessions.get(mutation[1]);
      if (!session) throw new HttpError(404, '原生会话不存在');
      const meta = store.get(session.id)!;
      if (mutation[2] === 'unarchive') meta.archived = null;
      else {
        if (typeof body.cursor !== 'string')
          throw new HttpError(400, '请提交卡片实际显示的快照游标');
        const vector = events.snapshot(session, body.cursor);
        if (mutation[2] === 'read') meta.read = mergePosition(meta.read ?? {}, vector);
        else {
          meta.archived = vector;
          if (advanced(meta.observed, vector)) meta.archived = null;
        }
      }
      store.save(meta);
      broadcast('change', {});
      res.end(JSON.stringify(view(session.id)));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/system/cwd') {
      res.end(JSON.stringify({ cwd: process.cwd() }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/system/version') {
      let currentVersion = '0.1.2';
      try {
        const pkgCandidates = [
          path.resolve(process.cwd(), 'package.json'),
          path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../package.json'),
          path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../package.json'),
        ];
        for (const p of pkgCandidates) {
          if (existsSync(p)) {
            const pkg = JSON.parse(await readFile(p, 'utf8'));
            if (typeof pkg.version === 'string' && pkg.version) {
              currentVersion = pkg.version;
              break;
            }
          }
        }
      } catch {}

      const shouldCheck = url.searchParams.get('check') === '1';
      if (!shouldCheck) {
        res.end(
          JSON.stringify({
            currentVersion,
            latestVersion: null,
            hasUpdate: false,
            releaseUrl: 'https://github.com/Useless-Lab-AI/agent-board/releases/latest',
            downloadUrl: null,
          }),
        );
        return;
      }

      try {
        const ghRes = await fetch('https://api.github.com/repos/Useless-Lab-AI/agent-board/releases/latest', {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Agent-Board/${currentVersion}`,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!ghRes.ok) {
          throw new Error(`GitHub API HTTP ${ghRes.status}`);
        }
        const release = (await ghRes.json()) as {
          tag_name?: string;
          html_url?: string;
          published_at?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        const latestVersion = String(release.tag_name ?? '').replace(/^v/i, '').trim() || currentVersion;
        const parseVer = (v: string) =>
          v
            .split('-')[0]
            .split('.')
            .map((n) => Number.parseInt(n, 10) || 0);
        const [cMaj = 0, cMin = 0, cPat = 0] = parseVer(currentVersion);
        const [lMaj = 0, lMin = 0, lPat = 0] = parseVer(latestVersion);
        const hasUpdate =
          lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat);

        let downloadUrl: string | null = null;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const plat = process.platform;
        const arch = process.arch;
        for (const a of assets) {
          const name = String(a.name ?? '').toLowerCase();
          const dl = a.browser_download_url ?? null;
          if (!dl || name.endsWith('.blockmap') || name.endsWith('.yml') || name.endsWith('.txt')) continue;
          if (plat === 'win32' && name.endsWith('.exe')) {
            downloadUrl = dl;
            break;
          }
          if (plat === 'darwin' && name.endsWith('.dmg')) {
            if ((arch === 'arm64' && name.includes('arm64')) || (arch !== 'arm64' && name.includes('x64'))) {
              downloadUrl = dl;
              break;
            }
            if (!downloadUrl) downloadUrl = dl;
          }
          if (plat === 'linux' && (name.endsWith('.appimage') || name.endsWith('.deb'))) {
            if (name.endsWith('.appimage')) {
              downloadUrl = dl;
              break;
            }
            if (!downloadUrl) downloadUrl = dl;
          }
        }

        res.end(
          JSON.stringify({
            currentVersion,
            latestVersion,
            hasUpdate,
            releaseUrl: release.html_url ?? 'https://github.com/Useless-Lab-AI/agent-board/releases/latest',
            downloadUrl,
            publishedAt: release.published_at ?? null,
          }),
        );
      } catch (err) {
        res.end(
          JSON.stringify({
            currentVersion,
            latestVersion: null,
            hasUpdate: false,
            releaseUrl: 'https://github.com/Useless-Lab-AI/agent-board/releases/latest',
            downloadUrl: null,
            error: (err as Error).message,
          }),
        );
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      if (!initialized) await reconcile();
      const savedRaw = store.getSetting('recent_projects');
      let savedProjects: Array<{ id: string; name: string; path: string; lastUsed?: number }> = [];
      if (savedRaw) {
        try {
          savedProjects = JSON.parse(savedRaw);
        } catch {}
      }

      const projectMap = new Map<
        string,
        { id: string; name: string; path: string; lastUsed?: number }
      >();

      for (const p of savedProjects) {
        if (!p || typeof p.path !== 'string') continue;
        const validPath = resolveValidProjectDir(p.path, true);
        if (!validPath) continue;
        const key = validPath.toLowerCase();
        const base = path.basename(validPath) || validPath;
        const existing = projectMap.get(key);
        if (existing) {
          existing.lastUsed = Math.max(existing.lastUsed ?? 0, p.lastUsed ?? 0);
          if (p.name && p.name !== base) existing.name = p.name;
        } else {
          projectMap.set(key, {
            id: validPath,
            name: p.name?.trim() || base,
            path: validPath,
            lastUsed: p.lastUsed ?? 0,
          });
        }
      }

      // Collect valid project directories from discovered sessions
      for (const s of discovery.sessions.values()) {
        if (!s.cwd || typeof s.cwd !== 'string' || !s.cwd.trim()) continue;
        const validPath = resolveValidProjectDir(s.cwd.trim(), true);
        if (!validPath) continue;
        const key = validPath.toLowerCase();
        const existing = projectMap.get(key);
        const sessionTime = s.createdAt ?? Date.now() - 10000;
        if (existing) {
          if (!existing.lastUsed && sessionTime) {
            existing.lastUsed = sessionTime;
          }
        } else {
          const base = path.basename(validPath) || validPath;
          projectMap.set(key, {
            id: validPath,
            name: base,
            path: validPath,
            lastUsed: sessionTime,
          });
        }
      }

      // Ensure system cwd is included
      const defaultCwd =
        resolveValidProjectDir(process.cwd(), false) ?? path.normalize(process.cwd());
      const defaultKey = defaultCwd.toLowerCase();
      if (!projectMap.has(defaultKey)) {
        projectMap.set(defaultKey, {
          id: defaultCwd,
          name: path.basename(defaultCwd) || defaultCwd,
          path: defaultCwd,
          lastUsed: 0,
        });
      }

      const projects = Array.from(projectMap.values()).sort(
        (a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0),
      );

      // Persist cleaned list back to store if savedRaw contained polluted entries
      if (savedRaw && savedProjects.length !== projects.length) {
        store.setSetting('recent_projects', JSON.stringify(projects.slice(0, 100)));
      }

      res.end(JSON.stringify({ projects, defaultCwd }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/projects') {
      const body = await jsonBody(req);
      if (Array.isArray(body.projects)) {
        const cleanedMap = new Map<
          string,
          { id: string; name: string; path: string; lastUsed?: number }
        >();
        for (const p of body.projects) {
          if (!p || typeof p.path !== 'string') continue;
          const validPath = resolveValidProjectDir(p.path, false);
          if (!validPath) continue;
          const key = validPath.toLowerCase();
          if (!cleanedMap.has(key)) {
            const base = path.basename(validPath) || validPath;
            cleanedMap.set(key, {
              id: validPath,
              name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : base,
              path: validPath,
              lastUsed: typeof p.lastUsed === 'number' ? p.lastUsed : 0,
            });
          }
        }
        store.setSetting(
          'recent_projects',
          JSON.stringify(Array.from(cleanedMap.values()).slice(0, 100)),
        );
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/models') {
      const models = await getAvailableModels();
      res.end(JSON.stringify(models));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/create') {
      const body = await jsonBody(req);
      const provider = typeof body.provider === 'string' ? body.provider : '';
      if (!['codex', 'claude', 'antigravity'].includes(provider)) {
        throw new HttpError(400, '无效的 Provider 类型');
      }
      try {
        const result = await createSession(
          {
            provider: provider as 'codex' | 'claude' | 'antigravity',
            cwd: typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined,
            prompt: typeof body.prompt === 'string' ? body.prompt : '',
            title: typeof body.title === 'string' ? body.title : undefined,
            model: typeof body.model === 'string' ? body.model : undefined,
            launchTerminal: body.launchTerminal === true,
            attachments: Array.isArray(body.attachments)
              ? (body.attachments as InteractionAttachment[])
              : undefined,
          },
          {
            antigravityHome,
            codexHome,
            claudeHome,
            discovery,
            reconcile,
            titles,
          },
        );
        if (result.ok && result.provider === 'antigravity' && result.nativeId) {
          agStatuses.set(result.nativeId, {
            state: 'RUNNING',
            reason: 'Antigravity 智能体正在启动执行',
          });
        } else if (result.ok && result.provider === 'claude' && result.nativeId) {
          statuses.set(result.nativeId, {
            state: 'RUNNING',
            reason: 'Claude Code 正在启动执行',
          });
        }
        if (result.ok && typeof body.cwd === 'string' && body.cwd.trim()) {
          try {
            const rawSaved = store.getSetting('recent_projects');
            let list: Array<{ id: string; name: string; path: string; lastUsed?: number }> =
              rawSaved ? JSON.parse(rawSaved) : [];
            const normalized = path.normalize(body.cwd.trim());
            const idx = list.findIndex(
              (p) => path.normalize(p.path).toLowerCase() === normalized.toLowerCase(),
            );
            if (idx >= 0) {
              list[idx].lastUsed = Date.now();
            } else {
              list.unshift({
                id: normalized,
                name: path.basename(normalized) || normalized,
                path: normalized,
                lastUsed: Date.now(),
              });
            }
            store.setSetting('recent_projects', JSON.stringify(list.slice(0, 100)));
          } catch {}
        }
        broadcast('change', {});
        res.end(
          JSON.stringify({
            ...result,
            session: result.id && discovery.sessions.has(result.id) ? view(result.id) : null,
          }),
        );
        return;
      } catch (err: any) {
        throw new HttpError(500, err?.message || '创建会话失败');
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/remote-control') {
      res.end(JSON.stringify(remoteControl.getStatus(isRemoteClient)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/remote-control') {
      const body = await jsonBody(req);
      if (isRemoteClient) {
        if (body.action === 'startTunnel') {
          await remoteControl.startTunnel();
          res.end(JSON.stringify(remoteControl.getStatus(true)));
          return;
        }
        throw new HttpError(403, '远程设备不可修改远程控制设置');
      }
      if (typeof body.enabled === 'boolean') {
        remoteControl.setEnabled(body.enabled);
      }
      if (typeof body.deviceName === 'string') {
        remoteControl.setDeviceName(body.deviceName);
      }
      if (typeof body.customUrl === 'string') {
        remoteControl.setCustomUrl(body.customUrl);
      }
      if (body.action === 'rotateToken') {
        remoteControl.rotateToken();
      } else if (body.action === 'startTunnel') {
        await remoteControl.startTunnel();
      } else if (body.action === 'stopTunnel') {
        remoteControl.stopTunnel();
      }
      res.end(JSON.stringify(remoteControl.getStatus(false)));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pwa/install.mobileconfig') {
      const reqToken = extractRequestToken(req, port);
      const rcStatus = remoteControl.getStatus(false);
      const baseOrigin =
        rcStatus.customUrl || rcStatus.primaryLanUrl || `http://127.0.0.1:${port}`;
      const targetUrl =
        reqToken && remoteControl.verifyToken(reqToken)
          ? `${baseOrigin}/?rc=${encodeURIComponent(reqToken)}`
          : `${baseOrigin}/`;
      const iconCandidates = [
        path.resolve(import.meta.dirname, '../../assets/icon.png'),
        path.resolve(import.meta.dirname, '../../build/icon.png'),
        path.resolve('assets/icon.png'),
        path.resolve('build/icon.png'),
      ];
      const iconFile = iconCandidates.find((p) => existsSync(p));
      const iconBase64 = iconFile ? (await readFile(iconFile)).toString('base64') : '';
      const escapeXml = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const webClipUuid = randomUUID().toUpperCase();
      const profileUuid = randomUUID().toUpperCase();
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>IsRemovable</key>
      <true/>
      <key>Precomposed</key>
      <true/>
      <key>Label</key>
      <string>Agent Board</string>
      <key>PayloadDescription</key>
      <string>Agent Board 桌面应用快捷入口</string>
      <key>PayloadDisplayName</key>
      <string>Agent Board</string>
      <key>PayloadIdentifier</key>
      <string>com.agentboard.webclip.${webClipUuid}</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>${webClipUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>URL</key>
      <string>${escapeXml(targetUrl)}</string>${
        iconBase64
          ? `\n      <key>Icon</key>\n      <data>${iconBase64}</data>`
          : ''
      }
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>将 Agent Board 一键安装为全屏手机桌面应用（自带免密授权）</string>
  <key>PayloadDisplayName</key>
  <string>Agent Board 桌面应用</string>
  <key>PayloadIdentifier</key>
  <string>com.agentboard.profile.${profileUuid}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
      res.setHeader('Content-Type', 'application/x-apple-aspen-config; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="AgentBoard.mobileconfig"');
      res.end(plist);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      const reqToken = extractRequestToken(req, port);
      const startUrl =
        reqToken && remoteControl.verifyToken(reqToken)
          ? `/?rc=${encodeURIComponent(reqToken)}`
          : '/';
      const iconQuery =
        reqToken && remoteControl.verifyToken(reqToken)
          ? `?rc=${encodeURIComponent(reqToken)}`
          : '';
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.end(
        JSON.stringify({
          id: '/',
          name: `${remoteControl.getDeviceName()} · Agent Board`,
          short_name: 'Agent Board',
          description: 'Multi-agent session remote control for Codex, Claude Code, and Antigravity',
          start_url: startUrl,
          scope: '/',
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#0d1210',
          theme_color: '#1c523e',
          icons: [
            {
              src: `/apple-touch-icon.png${iconQuery}`,
              sizes: '192x192 512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `/apple-touch-icon.png${iconQuery}`,
              sizes: '192x192 512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: `/icon.svg${iconQuery}`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        }),
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/sw.js') {
      const reqToken = extractRequestToken(req, port);
      const rcStatus = remoteControl.getStatus(false);
      const lanBase = rcStatus.customUrl || rcStatus.primaryLanUrl || '';
      const fallbackUrl =
        lanBase && reqToken && remoteControl.verifyToken(reqToken)
          ? `${lanBase}/?rc=${encodeURIComponent(reqToken)}`
          : lanBase
            ? `${lanBase}/`
            : '';
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Service-Worker-Allowed', '/');
      res.end(
        `const FALLBACK_URL = ${JSON.stringify(fallbackUrl)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate' && FALLBACK_URL) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
            return new Response(
              '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0d1210;color:#e6ebe8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><script>location.replace(' + JSON.stringify(FALLBACK_URL) + ');</script>正在连接 Agent Board...</body></html>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
          return res;
        })
        .catch(() =>
          new Response(
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0d1210;color:#e6ebe8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><script>location.replace(' + JSON.stringify(FALLBACK_URL) + ');</script>正在连接 Agent Board...</body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        )
    );
  }
});
`,
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/icon.svg') {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      const svgCandidates = [
        path.resolve(import.meta.dirname, '../../assets/icon.svg'),
        path.resolve('assets/icon.svg'),
      ];
      const svgFile = svgCandidates.find((p) => existsSync(p));
      if (svgFile) {
        res.end(await readFile(svgFile));
        return;
      }
      res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <g stroke="#0C0C0E" stroke-opacity="0.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M 408 228 A 54 58 0 0 1 408 336" stroke-width="44"/>
    <path d="M 92 214 A 18 18 0 0 1 110 196 L 350 196 A 18 18 0 0 1 368 214 C 368 368, 312 414, 230 414 C 148 414, 92 368, 92 214 Z" stroke-width="14"/>
    <path d="M 196 152 C 150 100, 252 72, 206 24" stroke-width="42"/>
    <path d="M 272 152 C 236 110, 316 84, 280 42" stroke-width="38"/>
    <line x1="114" y1="468" x2="346" y2="468" stroke-width="44"/>
  </g>
  <path d="M 408 228 A 54 58 0 0 1 408 336" stroke="#949290" stroke-width="32" stroke-linecap="round"/>
  <path d="M 92 214 A 18 18 0 0 1 110 196 L 350 196 A 18 18 0 0 1 368 214 C 368 368, 312 414, 230 414 C 148 414, 92 368, 92 214 Z" fill="#FFFFFF"/>
  <path d="M 196 152 C 150 100, 252 72, 206 24" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round"/>
  <path d="M 272 152 C 236 110, 316 84, 280 42" stroke="#949290" stroke-width="26" stroke-linecap="round"/>
  <line x1="114" y1="468" x2="346" y2="468" stroke="#949290" stroke-width="32" stroke-linecap="round"/>
</svg>`,
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/apple-touch-icon.png') {
      const iconCandidates = [
        path.resolve(import.meta.dirname, '../../assets/icon.png'),
        path.resolve(import.meta.dirname, '../../build/icon.png'),
        path.resolve('assets/icon.png'),
        path.resolve('build/icon.png'),
      ];
      const iconFile = iconCandidates.find((p) => existsSync(p));
      if (iconFile) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(await readFile(iconFile));
        return;
      }
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const defaultWebDir = path.resolve(import.meta.dirname, '../web');
      const root = process.env.AGENT_BOARD_WEB_DIR ? path.resolve(process.env.AGENT_BOARD_WEB_DIR) : (existsSync(defaultWebDir) ? defaultWebDir : path.resolve('dist/web'));
      const requested =
        url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
      try {
        const file = await contained(root, path.resolve(root, requested));
        const ext = path.extname(file);
        const type: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.webmanifest': 'application/manifest+json; charset=utf-8',
        };
        if (!type[ext]) throw new HttpError(404, '未找到静态资源');
        res.setHeader('Content-Type', type[ext]);
        if (url.pathname.startsWith('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        let bodyBuf = await readFile(file);
        if (requested === 'index.html') {
          const reqToken = extractRequestToken(req, port);
          if (reqToken && remoteControl.verifyToken(reqToken)) {
            const htmlStr = bodyBuf
              .toString('utf8')
              .replace(
                'href="/manifest.webmanifest"',
                `href="/manifest.webmanifest?rc=${encodeURIComponent(reqToken)}"`,
              );
            bodyBuf = Buffer.from(htmlStr, 'utf8');
          }
        }
        const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
        if (
          acceptEncoding.includes('gzip') &&
          (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.svg' || ext === '.webmanifest')
        ) {
          res.setHeader('Content-Encoding', 'gzip');
          res.end(gzipSync(bodyBuf));
          return;
        }
        res.end(bodyBuf);
        return;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(404, '网页尚未构建，请先运行 npm run build');
      }
    }
    throw new HttpError(404, '未找到会话或接口');
  } catch (error) {
    res.statusCode = error instanceof HttpError ? error.status : 500;
    res.end(
      JSON.stringify({
        error:
          error instanceof HttpError ? error.message : '服务读取失败，请检查来源与应用数据目录',
      }),
    );
  }
});
server.listen(port, listenHost, () => {
  console.log(`Agent Board: http://127.0.0.1:${port}`);
  void getAvailableModels().catch(() => {});
});
async function shutdown() {
  clearInterval(interval);
  clearInterval(activityInterval);
  if (reconcileDebounce) clearTimeout(reconcileDebounce);
  for (const w of rootWatchers) {
    try {
      w.close();
    } catch {}
  }
  for (const client of clients) client.end();
  remoteControl.stopTunnel();
  server.close();
  await interactions.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('disconnect', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('uncaughtException', (err) => {
  console.error('[Agent Board] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Agent Board] Unhandled rejection:', reason);
});
