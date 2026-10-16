import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { contained } from './security.js';
import type { Execution } from '../shared/types.js';
import type { ParsedRecord } from './codex-reader.js';
import type { NativeSession } from './discovery.js';
export function claudeRecord(record: Record<string, any>): ParsedRecord {
  const result: ParsedRecord = { items: [], output: false, nativeId: record.uuid };
  const message = record.message ?? {};
  if (record.type === 'system' && record.subtype === 'compact_boundary')
    return {
      ...result,
      items: [{ role: 'notice', text: '原生上下文已压缩；压缩前后历史的完整顺序无法确认' }],
    };
  if (record.type === 'system' && record.subtype === 'api_error')
    return { ...result, state: 'FAILED', reason: '原生 API 错误记录', output: true };
  if (record.type !== 'user' && record.type !== 'assistant') return result;
  const content =
    typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : Array.isArray(message.content)
        ? message.content
        : [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string')
      result.items.push({ role: record.type, text: block.text, timestamp: record.timestamp });
    if (block.type === 'tool_use')
      result.items.push({
        role: 'tool',
        label: String(block.name ?? '工具调用'),
        text: JSON.stringify(block.input ?? {}, null, 2),
        timestamp: record.timestamp,
      });
    if (block.type === 'tool_result') {
      const text =
        typeof block.content === 'string'
          ? block.content
          : (Array.isArray(block.content) ? block.content : [])
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
      result.items.push({
        role: 'tool',
        label: block.is_error ? '工具错误' : '工具结果',
        text,
        timestamp: record.timestamp,
      });
    }
  }
  if (result.items.length) {
    result.output = true;
    result.state = 'UNKNOWN';
    result.reason = '原生会话记录，当前执行状态尚未确认';
  }
  if (
    record.type === 'assistant' &&
    message.stop_reason === 'end_turn' &&
    !record.isApiErrorMessage
  ) {
    result.state = 'COMPLETED';
    result.reason = '原生 assistant end_turn';
    result.output = true;
  }
  return result;
}
async function getClaudeActiveSubagent(
  subagentsDir: string,
): Promise<{ desc: string; lastAction: string } | null> {
  try {
    const files = await readdir(subagentsDir);
    const metas = files.filter((f) => f.endsWith('.meta.json'));
    let newest: { mf: string; jsonlPath: string; mtimeMs: number; size: number } | null = null;
    for (const mf of metas) {
      const jsonlPath = path.join(subagentsDir, mf.replace('.meta.json', '.jsonl'));
      try {
        const st = await stat(jsonlPath);
        if (!newest || st.mtimeMs > newest.mtimeMs) {
          newest = { mf, jsonlPath, mtimeMs: st.mtimeMs, size: st.size };
        }
      } catch {}
    }
    if (!newest || Date.now() - newest.mtimeMs > 30 * 60 * 1000) return null;
    let desc = '';
    try {
      const meta = JSON.parse(await readFile(path.join(subagentsDir, newest.mf), 'utf8'));
      desc = typeof meta.description === 'string' ? meta.description : '';
    } catch {}

    let lastAction = '';
    if (newest.size > 0) {
      try {
        const fd = await open(newest.jsonlPath, 'r');
        try {
          const bufSize = Math.min(newest.size, 4096);
          const buf = Buffer.alloc(bufSize);
          await fd.read(buf, 0, bufSize, newest.size - bufSize);
          const lines = buf.toString('utf8').trim().split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const rec = JSON.parse(lines[i]);
              if (rec.message?.content && Array.isArray(rec.message.content)) {
                const tu = rec.message.content.find((c: any) => c.type === 'tool_use');
                if (tu?.name) {
                  lastAction = String(tu.name);
                  break;
                }
              }
            } catch {}
          }
        } finally {
          await fd.close();
        }
      } catch {}
    }
    return { desc, lastAction };
  } catch {
    return null;
  }
}

export async function claudeStatuses(
  home: string,
  sessions?: Iterable<NativeSession>,
): Promise<Map<string, { state: Execution; reason: string }>> {
  const result = new Map<string, { state: Execution; reason: string }>();
  const root = path.join(home, 'sessions');
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return result;
  }
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const file = await contained(root, path.join(root, name));
      if ((await stat(file)).size > 65536) continue;
      const record = JSON.parse(await readFile(file, 'utf8'));
      if (!Number.isInteger(record.pid) || record.pid <= 0 || typeof record.sessionId !== 'string')
        continue;
      process.kill(record.pid, 0);
      // Stale registry or future timestamp checks
      if (
        typeof record.updatedAt !== 'number' ||
        Date.now() - record.updatedAt > 24 * 3600 * 1000 ||
        record.updatedAt > Date.now() + 5000
      )
        continue;
      const mapping: Record<string, Execution> = {
        running: 'RUNNING',
        working: 'RUNNING',
        busy: 'RUNNING',
        idle: 'IDLE',
        waiting_input: 'WAITING_INPUT',
        waiting_approval: 'WAITING_APPROVAL',
      };
      const state = mapping[record.status];
      if (state) {
        let reason = state === 'RUNNING' ? 'Claude 正在执行中' : '原生 Claude 进程存活且处于就绪状态';
        if (state === 'RUNNING' && sessions) {
          const session = [...sessions].find((s) => s.nativeId === record.sessionId);
          if (session && session.files[0]) {
            const projectDir = path.dirname(session.files[0].path);
            const subagentsDir = path.join(projectDir, record.sessionId, 'subagents');
            const subStatus = await getClaudeActiveSubagent(subagentsDir);
            if (subStatus) {
              const actionStr = subStatus.lastAction ? ` (${subStatus.lastAction})` : '';
              reason = subStatus.desc
                ? `Claude 正在运行子智能体: ${subStatus.desc}${actionStr}`
                : `Claude 正在执行中${actionStr}`;
            }
          }
        }
        result.set(record.sessionId, {
          state,
          reason,
        });
      }
    } catch {
      /* Unavailable/stale registrations provide no current status evidence. */
    }
  }

  // Check transparent bridges for live pending approval / question requests
  const bridgesRoot = path.join(home, 'agent-board-bridges');
  try {
    const bridgeNames = await readdir(bridgesRoot);
    for (const name of bridgeNames.filter((n) => /^\d+\.json$/.test(n))) {
      try {
        const file = await contained(bridgesRoot, path.join(bridgesRoot, name));
        if ((await stat(file)).size > 262144) continue;
        const bridge = JSON.parse(await readFile(file, 'utf8'));
        if (
          !Number.isInteger(bridge.pid) ||
          bridge.pid <= 0 ||
          !Number.isInteger(bridge.bridgePid) ||
          bridge.bridgePid <= 0
        )
          continue;
        process.kill(bridge.pid, 0);
        process.kill(bridge.bridgePid, 0);
        const sessionId = typeof bridge.sessionId === 'string' ? bridge.sessionId : '';
        if (!sessionId) continue;
        if (Array.isArray(bridge.pending) && bridge.pending.length > 0) {
          const hasApproval = bridge.pending.some((p: any) => p?.kind !== 'question');
          const firstTitle =
            typeof bridge.pending[0]?.title === 'string' && bridge.pending[0].title
              ? bridge.pending[0].title
              : hasApproval
                ? '允许执行命令？'
                : 'AI 需要你的回答';
          result.set(sessionId, {
            state: hasApproval ? 'WAITING_APPROVAL' : 'WAITING_INPUT',
            reason: firstTitle,
          });
        } else if (!result.has(sessionId)) {
          result.set(sessionId, {
            state: 'IDLE',
            reason: '原生 Claude 进程存活且处于就绪状态',
          });
        }
      } catch {}
    }
  } catch {}

  return result;
}
