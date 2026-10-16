import { readdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { contained, hash } from './security.js';
import type { Provider, Vector } from '../shared/types.js';
import type { SessionStore } from './session-store.js';
import { getAntigravitySummaries } from './antigravity-meta.js';
export interface SourceFile {
  path: string;
  root: string;
  key: string;
  generation: string;
  size: number;
  mtime: number;
  anchor: string;
  head: Record<string, any>;
}
export interface NativeSession {
  id: string;
  nativeId: string;
  provider: Provider;
  cwd: string;
  files: SourceFile[];
  diagnostics: string[];
  createdAt?: number;
}
export interface Source {
  provider: Provider;
  root: string;
}
export class Discovery {
  private files = new Map<string, SourceFile>();
  private archivedCache?: { mtime: number; at: number; records: SourceFile[]; errors: number };
  sessions = new Map<string, NativeSession>();
  sources: { provider: Provider; available: boolean; message?: string }[] = [];
  constructor(
    readonly roots: Source[],
    private store: SessionStore,
  ) {}
  async scan() {
    const found = new Map<string, NativeSession>();
    const reports: typeof this.sources = [];
    const seen = new Set<string>();
    for (const source of this.roots) {
      let errors = 0;
      const candidates: string[] = [];
      const walk = async (directory: string, depth = 0): Promise<void> => {
        if (depth > 12) return;
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          errors++;
          return;
        }
        await Promise.all(
          entries.map(async (entry) => {
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
              errors++;
              return;
            }
            if (entry.isDirectory()) {
              if (source.provider === 'antigravity') {
                if (depth === 1 && entry.name !== '.system_generated') return;
                if (depth === 2 && entry.name !== 'logs') return;
              }
              if (source.provider === 'claude') {
                if (depth >= 1 || entry.name === 'subagents' || entry.name === 'tool-results') return;
              }
              try {
                await contained(source.root, file);
                await walk(file, depth + 1);
              } catch {
                errors++;
              }
              return;
            }
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
            if (source.provider === 'antigravity' && entry.name !== 'transcript.jsonl') return;
            candidates.push(file);
          }),
        );
      };
      const inspect = async (file: string) => {
        try {
          const real = await contained(source.root, file);
          const info = await stat(real);
          const cached = this.files.get(real);
          const prior = cached
            ? {
                size: cached.size,
                anchor: cached.anchor,
                generation: cached.generation,
                identity: cached.head.__identity,
              }
            : this.store.file(hash(real));
          let record = cached;
          if (!cached || cached.size !== info.size || cached.mtime !== info.mtimeMs) {
            const fd = await open(real, 'r');
            let head = Buffer.alloc(Math.min(info.size, 65536));
            let anchor = '';
            let preserved = false;
            try {
              await fd.read(head, 0, head.length, 0);
              if (head.indexOf(10) < 0 && info.size > head.length) {
                const larger = Buffer.alloc(Math.min(info.size, 1024 * 1024));
                await fd.read(larger, 0, larger.length, 0);
                head = larger;
              }
              const tail = Buffer.alloc(Math.min(64, info.size));
              await fd.read(tail, 0, tail.length, info.size - tail.length);
              anchor = hash(tail);
              if (prior && info.size >= prior.size) {
                const anchorBytes = Buffer.alloc(Math.min(64, prior.size));
                await fd.read(anchorBytes, 0, anchorBytes.length, prior.size - anchorBytes.length);
                preserved = hash(anchorBytes) === prior.anchor;
              }
            } finally {
              await fd.close();
            }
            let meta: Record<string, any> | undefined;
            if (source.provider === 'antigravity') {
              const rel = path.relative(source.root, real);
              const conversationId = rel.split(path.sep)[0];
              if (conversationId && conversationId.length <= 256) {
                let title: string | undefined;
                let cwd: string | undefined;
                let timestamp: string | undefined;
                for (const line of head.toString('utf8').split('\n')) {
                  if (!line.trim()) continue;
                  try {
                    const item = JSON.parse(line);
                    if (!timestamp && item.created_at) timestamp = item.created_at;
                    if (!title && item.type === 'USER_INPUT' && typeof item.content === 'string') {
                      const reqMatch = item.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                      if (reqMatch) title = reqMatch[1].trim().split('\n')[0].slice(0, 240);
                    }
                    if (!cwd && item.type === 'PLANNER_RESPONSE' && Array.isArray(item.tool_calls)) {
                      for (const tc of item.tool_calls) {
                        const rawCwd = tc.args?.Cwd;
                        if (typeof rawCwd === 'string' && rawCwd) {
                          let c = '';
                          try {
                            c = rawCwd.startsWith('"') ? JSON.parse(rawCwd) : rawCwd;
                          } catch {
                            c = rawCwd.replace(/^"|"$/g, '').replace(/\\\\/g, '\\');
                          }
                          const lower = c.replace(/\//g, '\\').toLowerCase();
                          if (
                            c &&
                            !lower.includes('\\.claude\\') &&
                            !lower.includes('\\.codex\\') &&
                            !lower.includes('\\.gemini\\') &&
                            !lower.includes('\\documents\\codex\\')
                          ) {
                            cwd = c;
                            break;
                          }
                        }
                      }
                    }
                  } catch {}
                  if (title && cwd && timestamp) break;
                }
                const agMeta = getAntigravitySummaries(path.dirname(source.root)).get(conversationId);
                meta = {
                  id: conversationId,
                  sessionId: conversationId,
                  cwd: agMeta?.cwd || cwd || '',
                  timestamp,
                  title: agMeta?.title || title,
                  branched: false,
                };
              }
            } else {
              for (const line of head.toString('utf8').split('\n')) {
                try {
                  const item = JSON.parse(line);
                  if (
                    source.provider === 'codex'
                      ? item.type === 'session_meta'
                      : typeof item.sessionId === 'string'
                  ) {
                    if (source.provider === 'codex') {
                      meta = item.payload;
                      break;
                    }
                    // Claude may start with queue records that carry an ID but no cwd.
                    if (!meta) meta = item;
                    if (meta && item.sessionId === meta.sessionId) {
                      if (typeof item.cwd === 'string') meta = { ...meta, cwd: item.cwd };
                      if (item.type === 'custom-title' && typeof item.customTitle === 'string') {
                        meta = { ...meta, title: item.customTitle };
                      } else if (item.type === 'ai-title' && typeof item.aiTitle === 'string' && !meta.title) {
                        meta = { ...meta, title: item.aiTitle };
                      }
                      if (meta.cwd && meta.title) break;
                    }
                  }
                } catch {}
              }
            }
            if (!meta) {
              errors++;
              return;
            }
            // Keep identity metadata only, not the first Claude message body.
            meta = {
              id: meta.id,
              session_id: meta.session_id,
              sessionId: meta.sessionId,
              cwd: meta.cwd,
              timestamp: meta.timestamp,
              title: typeof meta.title === 'string' ? meta.title.slice(0, 240) : undefined,
              branched: !!meta.history_base,
            };
            const firstLine = head.subarray(0, Math.max(0, head.indexOf(10)));
            let generation = hash(`${info.dev}:${info.ino}:${info.birthtimeMs}:${hash(firstLine)}`);
            if (prior && (info.size < prior.size || !preserved))
              generation = hash(generation + ':' + info.mtimeMs);
            else if (prior && info.size >= prior.size) {
              // Keep a truncate-derived generation while the same file grows.
              const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}:${hash(firstLine)}`;
              if (preserved && prior.identity === identity) generation = prior.generation;
            }
            meta.__identity = `${info.dev}:${info.ino}:${info.birthtimeMs}:${hash(firstLine)}`;
            record = {
              path: real,
              root: source.root,
              key: hash(real),
              generation,
              size: info.size,
              mtime: info.mtimeMs,
              anchor,
              head: meta,
            };
            if (
              !prior ||
              prior.generation !== generation ||
              prior.size !== info.size ||
              prior.anchor !== anchor
            )
              this.store.saveFile({
                key: record.key,
                identity: meta.__identity,
                generation,
                size: info.size,
                anchor,
              });
            this.files.set(real, record);
          }
          if (!record) return;
          sourceRecords.push(record);
          registerRecord(record);
        } catch {
          errors++;
        }
      };
      const sourceRecords: SourceFile[] = [];
      const registerRecord = (record: SourceFile) => {
        seen.add(record.path);
        const nativeId =
          source.provider === 'codex'
            ? (record.head.id ?? record.head.session_id)
            : record.head.sessionId;
        if (typeof nativeId !== 'string' || !nativeId || nativeId.length > 256) {
          errors++;
          return;
        }
        const id = hash(source.provider + ':' + nativeId);
        const existing = this.sessions.get(id);
        const session = found.get(id) ?? {
          id,
          nativeId,
          provider: source.provider,
          cwd: String(record.head.cwd ?? ''),
          files: [],
          diagnostics: [],
          ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
        };
        if (!session.cwd && record.head.cwd) session.cwd = String(record.head.cwd);
        if (source.provider === 'antigravity') {
          const agMeta = getAntigravitySummaries(path.dirname(source.root)).get(nativeId);
          if (agMeta?.cwd && !session.cwd) session.cwd = agMeta.cwd;
          if (agMeta?.title && !record.head.title) record.head.title = agMeta.title;
        }
        session.files.push(record);
        found.set(id, session);
      };
      try {
        const isArchivedDir = path.basename(source.root) === 'archived_sessions';
        let usedCache = false;
        let rootMtime = 0;
        if (isArchivedDir) {
          try {
            const st = await stat(source.root);
            rootMtime = st.mtimeMs;
            if (
              this.archivedCache &&
              this.archivedCache.mtime === rootMtime &&
              Date.now() - this.archivedCache.at < 30000
            ) {
              errors = this.archivedCache.errors;
              for (const rec of this.archivedCache.records) {
                registerRecord(rec);
              }
              usedCache = true;
            }
          } catch {}
        }
        if (!usedCache) {
          await walk(source.root);
          for (let i = 0; i < candidates.length; i += 16)
            await Promise.all(candidates.slice(i, i + 16).map(inspect));
          if (isArchivedDir && rootMtime > 0) {
            this.archivedCache = {
              mtime: rootMtime,
              at: Date.now(),
              records: sourceRecords,
              errors,
            };
          }
        }
        reports.push({
          provider: source.provider,
          available: true,
          ...(errors ? { message: `${errors} 个文件或目录不可读取、越界或元信息不完整` } : {}),
        });
      } catch {
        reports.push({
          provider: source.provider,
          available: false,
          message: `来源目录不可用：${source.root}`,
        });
      }
    }
    for (const [id, previous] of this.sessions) {
      if (!found.has(id)) {
        if (previous.createdAt && Date.now() - previous.createdAt < 30000) {
          found.set(id, previous);
        } else {
          found.set(id, {
            ...previous,
            files: [],
            diagnostics: ['原生记录暂不可用，请检查来源目录'],
          });
        }
      }
    }
    for (const session of found.values()) {
      session.files.sort((a, b) => a.path.localeCompare(b.path));
      if (session.files.length > 1)
        session.diagnostics.push('此原生会话包含多个分段；分段独立展示，历史分支无法确认完整顺序');
      else if (session.files.some((f) => f.head.branched))
        session.diagnostics.push('原生记录引用历史基底；分支历史无法确认完整顺序，仅展示当前记录');
    }
    for (const file of this.files.keys()) if (!seen.has(file)) this.files.delete(file);
    this.sessions = found;
    this.sources = reports;
  }
}
export const vectorOf = (session: NativeSession): Vector =>
  Object.fromEntries(
    session.files.map((f) => [f.key, { generation: f.generation, offset: f.size }]),
  );
