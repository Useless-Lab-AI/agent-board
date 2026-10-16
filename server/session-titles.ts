import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type { NativeSession, SourceFile } from './discovery.js';
import { contained } from './security.js';
import { getAntigravitySummaries } from './antigravity-meta.js';

const maxIndexBytes = 8 * 1024 * 1024;
function titleText(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  return value.replace(/\s+/g, ' ').trim().slice(0, 240) || undefined;
}

function cleanPromptText(raw: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const cmdMatch = raw.match(/<command-name>(.*?)<\/command-name>/);
  if (cmdMatch && cmdMatch[1]?.trim()) return cmdMatch[1].trim();

  const cleaned = raw
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .trim();

  if (!cleaned) return undefined;
  const firstLine = cleaned.split('\n').map((s) => s.trim()).find(Boolean);
  return firstLine ? titleText(firstLine) : undefined;
}

function parseClaudeTitleFromText(text: string, isTailOnly: boolean): string | undefined {
  const safeText =
    isTailOnly && text.indexOf('\n') >= 0 ? text.slice(text.indexOf('\n') + 1) : text;
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let firstPrompt: string | undefined;

  for (const line of safeText.split('\n')) {
    if (!line.trim()) continue;
    if (line.includes('"custom-title"')) {
      try {
        const obj = JSON.parse(line);
        const t = titleText(obj?.customTitle);
        if (t) customTitle = t;
      } catch {}
    } else if (line.includes('"ai-title"')) {
      try {
        const obj = JSON.parse(line);
        const t = titleText(obj?.aiTitle);
        if (t) aiTitle = t;
      } catch {}
    } else if (!isTailOnly && !firstPrompt && line.includes('"type":"user"')) {
      try {
        const obj = JSON.parse(line);
        const content = obj?.message?.content;
        if (typeof content === 'string') {
          firstPrompt = cleanPromptText(content);
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (part?.type === 'text' && typeof part.text === 'string') {
              const cleaned = cleanPromptText(part.text);
              if (cleaned) {
                firstPrompt = cleaned;
                break;
              }
            }
          }
        }
      } catch {}
    }
  }

  return customTitle ?? aiTitle ?? firstPrompt;
}

interface IndexTitles {
  names: Map<string, string>;
  diagnostic?: string;
}
export class SessionTitles {
  private cache = new Map<string, IndexTitles & { signature: string }>();
  private claudeCache = new Map<string, { signature: string; title?: string }>();
  values = new Map<string, { title: string; diagnostic?: string }>();
  constructor(
    private codexHome: string,
    private claudeHome: string,
    private antigravityHome?: string,
  ) {}

  private async readClaudeSessionFile(root: string, file: SourceFile): Promise<string | undefined> {
    try {
      const relative = path.relative(root, file.path);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
      let current = root;
      for (const part of ['', ...relative.split(path.sep)]) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) return undefined;
      }
      const real = await contained(root, file.path);
      const info = await lstat(real);
      if (!info.isFile() || info.size === 0) return undefined;

      const fd = await open(real, 'r');
      try {
        if (info.size <= 512 * 1024) {
          const buffer = Buffer.alloc(info.size);
          await fd.read(buffer, 0, info.size, 0);
          return parseClaudeTitleFromText(buffer.toString('utf8'), false);
        }

        // 1. Check tail chunk (256 KiB) where recent custom-title or ai-title is usually appended
        const tailSize = Math.min(info.size, 256 * 1024);
        const tailBuf = Buffer.alloc(tailSize);
        await fd.read(tailBuf, 0, tailSize, info.size - tailSize);
        const tailTitle = parseClaudeTitleFromText(tailBuf.toString('utf8'), true);
        if (tailTitle) return tailTitle;

        // 2. Check head chunk (512 KiB) where the first turn's ai-title or user prompt is logged
        const headSize = Math.min(info.size, 512 * 1024);
        const headBuf = Buffer.alloc(headSize);
        await fd.read(headBuf, 0, headSize, 0);
        const headTitle = parseClaudeTitleFromText(headBuf.toString('utf8'), false);
        if (headTitle) return headTitle;

        // 3. Fallback: check full file up to maxIndexBytes (8 MiB)
        if (info.size <= maxIndexBytes) {
          const fullBuf = Buffer.alloc(info.size);
          await fd.read(fullBuf, 0, info.size, 0);
          return parseClaudeTitleFromText(fullBuf.toString('utf8'), false);
        }
      } finally {
        await fd.close();
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async read(root: string, file: string, codex: boolean): Promise<IndexTitles> {
    try {
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('名称索引越界');
      let current = root;
      for (const part of ['', ...relative.split(path.sep)]) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error('名称索引拒绝符号链接');
      }
      const real = await contained(root, file);
      const info = await lstat(real);
      if (!info.isFile() || info.size > maxIndexBytes)
        throw new Error('名称索引超出 8 MiB 读取上限或不是文件');
      const signature = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      const cached = this.cache.get(file);
      if (cached?.signature === signature) return cached;
      const fd = await open(real, 'r');
      let text: string;
      try {
        const buffer = Buffer.alloc(Math.min(info.size + 1, maxIndexBytes + 1));
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await fd.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > maxIndexBytes) throw new Error('名称索引超出 8 MiB 读取上限');
        text = buffer.subarray(0, length).toString('utf8');
      } finally {
        await fd.close();
      }
      const names = new Map<string, string>();
      let diagnostic: string | undefined;
      if (codex) {
        // The native index is append-only; an unfinished final line is not a rename yet.
        for (const line of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            const title = titleText(entry?.thread_name);
            if (typeof entry?.id === 'string' && entry.id.length <= 256 && title)
              names.set(entry.id, title);
            else diagnostic = '名称索引包含无效条目';
          } catch {
            diagnostic = '名称索引包含无法解析的记录';
          }
        }
      } else {
        const data = JSON.parse(text);
        if (!Array.isArray(data?.entries)) throw new Error('名称索引格式无效');
        for (const entry of data.entries) {
          const title = titleText(entry?.customTitle ?? entry?.summary ?? entry?.firstPrompt);
          if (typeof entry?.sessionId !== 'string' || entry.sessionId.length > 256) {
            diagnostic = '名称索引包含无效条目';
          } else if (title) names.set(entry.sessionId, title);
        }
      }
      const result = { signature, names, diagnostic };
      this.cache.set(file, result);
      return result;
    } catch (error) {
      this.cache.delete(file);
      const e = error as NodeJS.ErrnoException;
      return {
        names: new Map(),
        diagnostic:
          e.code === 'ENOENT' ? '原生名称索引不存在' : `原生名称索引不可用：${e.code ?? e.message}`,
      };
    }
  }

  async refresh(sessions: Iterable<NativeSession>) {
    const groups = new Map<string, { root: string; codex: boolean; sessions: NativeSession[] }>();
    const values: typeof this.values = new Map();
    const claudeSessions: NativeSession[] = [];
    const activeClaudePaths = new Set<string>();

    for (const session of sessions) {
      const codex = session.provider === 'codex';
      const root = codex ? this.codexHome : path.join(this.claudeHome, 'projects');
      const project =
        session.files[0] && path.relative(root, session.files[0].path).split(path.sep)[0];
      const metadataTitle = session.files.map((f) => titleText(f.head.title)).find(Boolean);
      if (session.provider === 'antigravity') {
        let agTitle: string | undefined;
        if (this.antigravityHome) {
          const summaries = getAntigravitySummaries(this.antigravityHome);
          agTitle = titleText(summaries.get(session.nativeId)?.title);
        }
        const defaultTitle = `未命名会话 · ${session.nativeId.slice(0, 8)}`;
        const existingTitle = this.values.get(session.id)?.title;
        const preservedTitle =
          existingTitle && existingTitle !== defaultTitle ? existingTitle : undefined;
        const resolvedTitle = agTitle ?? metadataTitle ?? preservedTitle;
        const title = resolvedTitle ?? defaultTitle;
        values.set(session.id, {
          title,
          diagnostic: resolvedTitle ? undefined : '原生会话名称不可用',
        });
        continue;
      }
      if (session.provider === 'claude') {
        claudeSessions.push(session);
      }
      values.set(session.id, {
        title: metadataTitle ?? `未命名会话 · ${session.nativeId.slice(0, 8)}`,
        diagnostic: metadataTitle ? undefined : '原生会话名称不可用',
      });
      if (!codex && (!project || project === '..')) continue;
      const file = codex
        ? path.join(root, 'session_index.jsonl')
        : path.join(root, project!, 'sessions-index.json');
      const group = groups.get(file) ?? { root, codex, sessions: [] };
      group.sessions.push(session);
      groups.set(file, group);
    }
    const entries = [...groups];
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(
        entries.slice(i, i + 8).map(async ([file, group]) => {
          const result = await this.read(group.root, file, group.codex);
          for (const session of group.sessions) {
            const previous = values.get(session.id)!;
            const title = result.names.get(session.nativeId);
            values.set(session.id, {
              title: title ?? previous.title,
              diagnostic: result.diagnostic ?? (title ? undefined : previous.diagnostic),
            });
          }
        }),
      );
    }

    // Process Claude session native files (where modern ai-title and custom-title live)
    const claudeRoot = path.join(this.claudeHome, 'projects');
    for (let i = 0; i < claudeSessions.length; i += 16) {
      await Promise.all(
        claudeSessions.slice(i, i + 16).map(async (session) => {
          const mainFile =
            session.files.find(
              (f) =>
                path.basename(f.path).toLowerCase() === `${session.nativeId.toLowerCase()}.jsonl`,
            ) ??
            session.files.find((f) => !f.path.includes('subagents')) ??
            session.files[0];

          if (!mainFile) return;
          activeClaudePaths.add(mainFile.path);

          const signature = `${mainFile.size}:${mainFile.mtime}`;
          const cached = this.claudeCache.get(mainFile.path);
          let title: string | undefined;

          if (cached && cached.signature === signature) {
            title = cached.title;
          } else {
            title = await this.readClaudeSessionFile(claudeRoot, mainFile);
            this.claudeCache.set(mainFile.path, { signature, title });
          }

          if (title) {
            values.set(session.id, {
              title,
              diagnostic: undefined,
            });
          }
        }),
      );
    }

    for (const file of this.cache.keys()) if (!groups.has(file)) this.cache.delete(file);
    for (const p of this.claudeCache.keys())
      if (!activeClaudePaths.has(p)) this.claudeCache.delete(p);
    this.values = values;
  }
}
