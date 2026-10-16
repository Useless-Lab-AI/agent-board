import { open } from 'node:fs/promises';
import type { DisplayEvent, EventPage, Execution, Vector } from '../shared/types.js';
import type { NativeSession, SourceFile } from './discovery.js';
import { codexRecord, type ParsedRecord } from './codex-reader.js';
import { claudeRecord } from './claude-reader.js';
import { antigravityRecord } from './antigravity-reader.js';
import { contained, cursors, hash, HttpError } from './security.js';
const BATCH = 2 * 1024 * 1024;
const RECORD = 256 * 1024;
interface Row {
  start: number;
  end: number;
  parsed: ParsedRecord;
  items: DisplayEvent[];
}
interface PageCursor {
  kind: 'history' | 'snapshot';
  id: string;
  vector: Vector;
  file?: string;
  end?: number;
  skip?: number;
}
export interface Observed {
  progress: Vector;
  output: Vector;
  state: Execution;
  reason: string;
  diagnostics: string[];
  activity?: { lastOutputAt: number; source: 'assistant' | 'tool'; expired: boolean };
}
export class EventReader {
  readonly cursor;
  private cache = new Map<string, { signature: string; page: EventPage }>();
  constructor(secret: string) {
    this.cursor = cursors(secret);
  }
  private async bytes(file: SourceFile, start: number, end: number) {
    const real = await contained(file.root, file.path);
    const fd = await open(real, 'r');
    try {
      const buffer = Buffer.alloc(Math.max(0, end - start));
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  }
  private parse(
    session: NativeSession,
    file: SourceFile,
    line: Buffer,
    start: number,
    end: number,
  ): Row {
    let parsed: ParsedRecord;
    if (line.length > RECORD)
      parsed = {
        items: [
          {
            role: 'notice',
            text: 'content truncated: size limit exceeded（原生记录超过 256 KiB）',
          },
        ],
        output: true,
        state: 'UNKNOWN',
        reason: '记录超限，状态无法确认',
      };
    else
      try {
        const record = JSON.parse(line.toString('utf8'));
        parsed =
          session.provider === 'codex'
            ? codexRecord(record)
            : session.provider === 'antigravity'
              ? antigravityRecord(record)
              : claudeRecord(record);
      } catch {
        parsed = {
          items: [{ role: 'notice', text: '原生记录无法解析；此行未作为有效内容处理' }],
          output: false,
          state: 'UNKNOWN',
          reason: '原生记录解析失败',
        };
      }
    const key = parsed.nativeId
      ? `native:${parsed.nativeId}`
      : `${file.key}:${file.generation}:${start}:${hash(line)}`;
    return {
      start,
      end,
      parsed,
      items: parsed.items.map((item, i) => ({
        ...item,
        text: item.text.slice(0, RECORD),
        id: key + ':' + i,
        segment: file.key.slice(0, 6),
      })),
    };
  }
  private rows(
    session: NativeSession,
    file: SourceFile,
    buffer: Buffer,
    start: number,
    skipFragment: boolean,
  ): Row[] {
    const result: Row[] = [];
    let begin = 0;
    if (skipFragment && start > 0) {
      const newline = buffer.indexOf(10);
      if (newline < 0) return result;
      begin = newline + 1;
    }
    for (let end = buffer.indexOf(10, begin); end >= 0; end = buffer.indexOf(10, begin)) {
      if (end > begin)
        result.push(
          this.parse(session, file, buffer.subarray(begin, end), start + begin, start + end + 1),
        );
      begin = end + 1;
    }
    return result;
  }
  validate(session: NativeSession, vector: Vector) {
    for (const [key, position] of Object.entries(vector)) {
      const file = session.files.find((f) => f.key === key);
      if (
        !file ||
        file.generation !== position.generation ||
        !Number.isSafeInteger(position.offset) ||
        position.offset < 0 ||
        position.offset > file.size
      )
        throw new HttpError(409, '原生文件已替换或截断，请重新加载当前记录');
    }
  }
  snapshot(session: NativeSession, token: string) {
    const cursor = this.cursor.decode<PageCursor>(token);
    if (cursor.kind !== 'snapshot' || cursor.id !== session.id)
      throw new HttpError(400, '游标不属于当前会话快照');
    this.validate(session, cursor.vector);
    return cursor.vector;
  }
  async page(session: NativeSession, token?: string, limit = 100): Promise<EventPage> {
    if (!session.files.length) throw new HttpError(503, '原生来源不可用');
    const signature = session.files
      .map((f) => `${f.key}:${f.generation}:${f.size}:${f.mtime}`)
      .join('|');
    const cached = this.cache.get(session.id);
    if (!token && limit === 100 && cached?.signature === signature) {
      this.cache.delete(session.id);
      this.cache.set(session.id, cached);
      return cached.page;
    }
    let index = session.files.length - 1;
    let end = session.files[index].size;
    let vector: Vector = {};
    let skip = 0;
    if (token) {
      const cursor = this.cursor.decode<PageCursor>(token);
      index = session.files.findIndex((f) => f.key === cursor.file);
      if (cursor.kind !== 'history' || cursor.id !== session.id || index < 0)
        throw new HttpError(400, '历史游标无效');
      this.validate(session, cursor.vector);
      vector = cursor.vector;
      end = cursor.end!;
      skip = cursor.skip ?? 0;
      if (!Number.isSafeInteger(skip) || skip < 0) throw new HttpError(400, '记录内游标无效');
      if (!Number.isSafeInteger(end) || end < 0 || end > session.files[index].size)
        throw new HttpError(400, '历史位置无效');
    }
    const items: DisplayEvent[] = [];
    const seen = new Set<string>();
    let budget = BATCH;
    let nextCursor: string | null = null;
    const diagnostics = [...session.diagnostics];
    let truncated = false;
    while (index >= 0 && budget > 0 && items.length < limit) {
      const file = session.files[index];
      const start = Math.max(0, end - budget);
      const buffer = await this.bytes(file, start, end);
      budget -= buffer.length;
      const rows = this.rows(session, file, buffer, start, start > 0);
      const completedEnd = start + buffer.lastIndexOf(10) + 1;
      if (!token && buffer.lastIndexOf(10) >= 0)
        vector[file.key] = { generation: file.generation, offset: completedEnd };
      let boundary = start > 0 ? start + Math.max(0, buffer.indexOf(10) + 1) : 0;
      let remainingSkip = 0;
      for (let r = rows.length - 1; r >= 0; r--) {
        const row = rows[r];
        const candidates = skip
          ? row.items.slice(0, Math.max(0, row.items.length - skip))
          : row.items;
        skip = 0;
        const unique = candidates.filter((item) => !seen.has(item.id));
        if (items.length + unique.length > limit) {
          const take = limit - items.length;
          const selected = unique.slice(unique.length - take);
          remainingSkip = take ? row.items.length - candidates.indexOf(selected[0]) : 0;
          items.unshift(...selected);
          boundary = row.end;
          break;
        }
        unique.forEach((item) => seen.add(item.id));
        items.unshift(...unique);
        boundary = row.start;
      }
      if (start > 0 && !rows.length) {
        items.unshift({
          id: `${file.key}:${file.generation}:${start}:limit`,
          role: 'notice',
          text: 'content truncated: size limit exceeded（读取窗口内没有完整记录；继续加载更早内容）',
          segment: file.key.slice(0, 6),
        });
        boundary = start;
        truncated = true;
      }
      if (boundary > 0) {
        nextCursor = this.cursor.encode({
          kind: 'history',
          id: session.id,
          vector,
          file: file.key,
          end: boundary,
          skip: remainingSkip,
        });
        truncated = true;
        break;
      }
      index--;
      if (index >= 0) end = session.files[index].size;
    }
    if (!nextCursor && index >= 0 && (budget <= 0 || items.length >= limit))
      nextCursor = this.cursor.encode({
        kind: 'history',
        id: session.id,
        vector,
        file: session.files[index].key,
        end,
      });
    const page: EventPage = {
      items,
      nextCursor,
      snapshotCursor: this.cursor.encode({ kind: 'snapshot', id: session.id, vector }),
      truncated: truncated || !!nextCursor,
      diagnostics,
    };
    if (!token && limit === 100 && Buffer.byteLength(JSON.stringify(page)) <= 5 * 1024 * 1024) {
      this.cache.delete(session.id);
      this.cache.set(session.id, { signature, page });
      while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
    }
    return page;
  }
  async observe(
    session: NativeSession,
    previous?: Observed,
    activityBaseline?: Vector,
  ): Promise<Observed> {
    const state: Observed = previous
      ? {
          ...previous,
          progress: { ...previous.progress },
          output: { ...previous.output },
          diagnostics: [],
        }
      : {
          progress: {},
          output: {},
          state: 'UNKNOWN',
          reason: '没有可靠的执行状态证据',
          diagnostics: [],
        };
    let budget = BATCH;
    for (const file of session.files) {
      const last = state.progress[file.key];
      if (last?.generation === file.generation && last.offset === file.size) continue;
      const fresh = !last || last.generation !== file.generation || last.offset > file.size;
      const start = fresh ? Math.max(0, file.size - Math.min(65536, budget)) : last.offset;
      const end = Math.min(file.size, start + budget);
      if (budget <= 0) {
        state.diagnostics.push('新增记录正在分批读取');
        break;
      }
      const buffer = await this.bytes(file, start, end);
      budget -= buffer.length;
      const skipFragment = (fresh && start > 0) || !!last?.skipping;
      const rows = this.rows(session, file, buffer, start, skipFragment);
      if (fresh) {
        state.activity = undefined;
        state.state = 'UNKNOWN';
        state.reason = '来源首次读取或发生替换';
      }
      let progress = start;
      let skipping = !!last?.skipping;
      if (skipFragment && buffer.indexOf(10) >= 0) {
        progress = start + buffer.indexOf(10) + 1;
        skipping = false;
        if (last?.skipping) {
          state.output[file.key] = { generation: file.generation, offset: progress };
          state.state = 'UNKNOWN';
          state.reason = '超大记录已落盘，完整内容未解析';
        }
      }
      for (const row of rows) {
        progress = row.end;
        if (row.parsed.state) {
          state.state = row.parsed.state;
          state.reason = row.parsed.reason ?? '';
        }
        if (row.parsed.output)
          state.output[file.key] = { generation: file.generation, offset: row.end };
        const baseline = activityBaseline?.[file.key];
        const activity = row.parsed.items.find(
          (item) => item.role === 'assistant' || item.role === 'tool',
        );
        if (
          !fresh &&
          baseline?.generation === file.generation &&
          row.start >= baseline.offset &&
          activity
        ) {
          state.activity = {
            lastOutputAt: Date.now(),
            source: activity.role as 'assistant' | 'tool',
            expired: false,
          };
        }
      }
      if (buffer.length === BATCH && buffer.indexOf(10) < 0) {
        progress = end;
        skipping = true;
        state.diagnostics.push('超大记录正在跳过，内容将显示截断提示');
        state.state = 'UNKNOWN';
      }
      state.progress[file.key] = {
        generation: file.generation,
        offset: progress,
        ...(skipping ? { skipping: true } : {}),
      };
      if (fresh && !state.output[file.key])
        state.output[file.key] = { generation: file.generation, offset: 0 };
    }
    if (session.files.length > 1) {
      state.state = 'UNKNOWN';
      state.reason = '多个原生分段的先后关系无法确认';
    }
    if (!session.files.length) {
      state.activity = undefined;
      state.state = 'UNKNOWN';
      state.reason = '原生来源不可用';
    }
    return state;
  }
}
