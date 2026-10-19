import { statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Execution } from '../shared/types.js';

const require = createRequire(import.meta.url);

export interface AntigravitySummary {
  conversationId: string;
  title: string;
  cwd: string;
  status: string;
  notFullyIdle: boolean;
  killed: boolean;
  projectId: string;
}

let cachedFingerprint = '';
let cachedTime = 0;
let cachedMap = new Map<string, AntigravitySummary>();
const DB_CACHE_TTL_MS = 1500;

function parseWorkspaceCwd(workspaceUris: unknown): string {
  if (typeof workspaceUris !== 'string' || !workspaceUris.trim()) return '';
  try {
    const list = JSON.parse(workspaceUris);
    if (Array.isArray(list) && list.length > 0 && typeof list[0] === 'string') {
      const first = list[0].trim();
      if (first.startsWith('file://')) {
        const decoded = decodeURIComponent(first);
        return fileURLToPath(decoded);
      }
      return first;
    }
  } catch {}
  return '';
}

function getDbFingerprint(antigravityHome: string): string {
  const files = [
    path.join(antigravityHome, 'conversation_summaries.db'),
    path.join(antigravityHome, 'conversation_summaries.db-wal'),
    path.join(antigravityHome, 'conversation_summaries.db-shm'),
  ];
  return files
    .map((f) => {
      try {
        const st = statSync(f);
        return `${st.size}:${st.mtimeMs}`;
      } catch {
        return '0:0';
      }
    })
    .join('|');
}

export function getAntigravitySummaries(
  antigravityHome: string,
): Map<string, AntigravitySummary> {
  const dbPath = path.join(antigravityHome, 'conversation_summaries.db');
  try {
    const now = Date.now();
    const fp = getDbFingerprint(antigravityHome);
    if (cachedMap.size > 0 && now - cachedTime < DB_CACHE_TTL_MS && fp === cachedFingerprint) {
      return cachedMap;
    }

    // Use dynamic require / import for node:sqlite to avoid startup crash on older node runtimes
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true, timeout: 2000 });
    const nextMap = new Map<string, AntigravitySummary>();
    try {
      const rows = db
        .prepare(
          'SELECT conversation_id, title, workspace_uris, status, not_fully_idle, killed, project_id FROM conversation_summaries',
        )
        .all() as any[];

      for (const row of rows) {
        if (!row.conversation_id) continue;
        nextMap.set(row.conversation_id, {
          conversationId: String(row.conversation_id),
          title: typeof row.title === 'string' ? row.title.trim() : '',
          cwd: parseWorkspaceCwd(row.workspace_uris),
          status: String(row.status ?? ''),
          notFullyIdle: row.not_fully_idle === 1,
          killed: row.killed === 1,
          projectId: String(row.project_id ?? ''),
        });
      }
      cachedFingerprint = fp;
      cachedTime = now;
      cachedMap = nextMap;
      return nextMap;
    } finally {
      try {
        db.close();
      } catch {}
    }
  } catch {
    return cachedMap;
  }
}

/**
 * Fast real-time transcript tail inspector (reads only the last 8 KiB).
 * Directly reflects the actual turn state without SQLite WAL or debouncing lag.
 */
export function getAntigravityTranscriptStatus(
  transcriptPath: string,
): { state: Execution; reason: string } | null {
  try {
    const st = statSync(transcriptPath);
    if (!st.size) return null;
    const fd = openSync(transcriptPath, 'r');
    try {
      const readLen = Math.min(st.size, 65536);
      const buffer = Buffer.alloc(readLen);
      readSync(fd, buffer, 0, readLen, st.size - readLen);
      const text = buffer.toString('utf8');
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return null;

      let obj: any = null;
      for (let i = lines.length - 1; i >= 0 && !obj; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (!parsed || typeof parsed !== 'object') continue;
          const type = parsed.type;
          // Skip meta/system records that don't represent the agent turn execution state
          if (type === 'CHECKPOINT' || type === 'EPHEMERAL_MESSAGE') {
            continue;
          }
          obj = parsed;
        } catch {}
      }
      if (!obj) return null;

      const tp = obj.type;
      const stCode = obj.status;
      const tools = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];

      if (tp === 'USER_INPUT') {
        return { state: 'RUNNING', reason: '智能体正在思考回复' };
      }
      if (tp === 'SYSTEM_MESSAGE') {
        const text = typeof obj.content === 'string' ? obj.content : '';
        if (text.includes('sender=') && !text.includes('sender=system')) {
          return { state: 'RUNNING', reason: '智能体正在思考回复' };
        }
        return { state: 'IDLE', reason: 'Antigravity 系统就绪' };
      }
      if (tp === 'PLANNER_RESPONSE') {
        if (tools.length > 0) {
          if (tools.some((t: any) => t.name === 'ask_question')) {
            return { state: 'WAITING_INPUT', reason: '智能体正在等待用户回答问题' };
          }
          const tname = String(tools[0]?.name || '工具');
          return { state: 'RUNNING', reason: `智能体正在调用工具: ${tname}` };
        }
        if (stCode === 'DONE') {
          return { state: 'IDLE', reason: 'Antigravity 会话就绪 / 空闲' };
        }
        if (stCode === 'ERROR' || stCode === 'FAILED') {
          return { state: 'IDLE', reason: 'Antigravity 会话就绪（上一轮已结束）' };
        }
        return { state: 'RUNNING', reason: '智能体正在生成回复' };
      }
      if (tp === 'GENERIC') {
        if (stCode === 'RUNNING') {
          return { state: 'RUNNING', reason: '智能体正在执行工具' };
        }
        // Tool finished (status === DONE). If file was recently touched, agent is preparing the next turn.
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > 15000) {
          return { state: 'IDLE', reason: 'Antigravity 会话就绪 / 空闲' };
        }
        return { state: 'RUNNING', reason: '智能体正在处理工具返回结果' };
      }
      return { state: 'UNKNOWN', reason: `Antigravity 状态：${stCode || tp}` };
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export interface AntigravityRawQuestion {
  question: string;
  isMultiSelect: boolean;
  options: Array<{ id: string; text: string }>;
}

export interface AntigravityPendingAskQuestion {
  transcriptStepIndex: number;
  title: string;
  rawQuestions: AntigravityRawQuestion[];
}

function readTailLastRecord(filePath: string): any | null {
  try {
    const st = statSync(filePath);
    if (!st.size) return null;
    const fd = openSync(filePath, 'r');
    try {
      const readLen = Math.min(st.size, 131072);
      const buffer = Buffer.alloc(readLen);
      readSync(fd, buffer, 0, readLen, st.size - readLen);
      const text = buffer.toString('utf8');
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (!parsed || typeof parsed !== 'object') continue;
          const type = parsed.type;
          if (type === 'CHECKPOINT' || type === 'EPHEMERAL_MESSAGE') {
            continue;
          }
          return parsed;
        } catch {}
      }
      return null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function getAntigravityPendingAskQuestion(
  transcriptPath: string,
): AntigravityPendingAskQuestion | null {
  let obj = readTailLastRecord(transcriptPath);
  if (!obj || obj.type !== 'PLANNER_RESPONSE') return null;

  if (
    Array.isArray(obj.truncated_fields) &&
    obj.truncated_fields.includes('tool_calls')
  ) {
    const fullPath = path.join(path.dirname(transcriptPath), 'transcript_full.jsonl');
    const fullObj = readTailLastRecord(fullPath);
    if (fullObj && fullObj.type === 'PLANNER_RESPONSE') {
      obj = fullObj;
    }
  }

  const tools = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
  const askCall = tools.find((t: any) => t && t.name === 'ask_question');
  if (!askCall) return null;

  let args = askCall.args;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {}
  }
  if (!args || typeof args !== 'object') args = {};

  const rawList = Array.isArray(args.questions) ? args.questions : [];
  const rawQuestions: AntigravityRawQuestion[] = [];
  for (const q of rawList) {
    if (!q || typeof q !== 'object') continue;
    const questionText = typeof q.question === 'string' ? q.question.trim() : '';
    if (!questionText) continue;
    const isMultiSelect = Boolean(q.is_multi_select ?? q.isMultiSelect ?? q.multiple);
    const optsRaw = Array.isArray(q.options) ? q.options : [];
    const options: Array<{ id: string; text: string }> = [];
    for (let i = 0; i < optsRaw.length; i++) {
      const item = optsRaw[i];
      if (typeof item === 'string' && item.trim()) {
        options.push({ id: String(i + 1), text: item.trim() });
      } else if (item && typeof item === 'object') {
        const text = String(item.text ?? item.label ?? '').trim();
        if (text) {
          options.push({ id: String(item.id ?? i + 1), text });
        }
      }
    }
    rawQuestions.push({
      question: questionText,
      isMultiSelect,
      options,
    });
  }

  if (rawQuestions.length === 0) return null;

  const title =
    (typeof args.toolSummary === 'string' && args.toolSummary.trim()) ||
    (typeof args.toolAction === 'string' && args.toolAction.trim()) ||
    'AI 需要你的回答';

  const transcriptStepIndex =
    typeof obj.step_index === 'number' && Number.isInteger(obj.step_index)
      ? obj.step_index
      : 0;

  return {
    transcriptStepIndex,
    title,
    rawQuestions,
  };
}

export function getAntigravityExecution(
  summary?: AntigravitySummary,
  transcriptPath?: string,
): { state: Execution; reason: string } {
  // If killed in DB, killed always wins
  if (summary?.killed) {
    return { state: 'FAILED', reason: 'Antigravity 会话已被终止' };
  }

  // Real-time transcript state takes precedence over lagging SQLite status
  if (transcriptPath) {
    const realTime = getAntigravityTranscriptStatus(transcriptPath);
    if (realTime) {
      if (
        (realTime.state === 'RUNNING' || realTime.state === 'WAITING_INPUT') &&
        summary &&
        !summary.notFullyIdle &&
        summary.status === 'CASCADE_RUN_STATUS_IDLE'
      ) {
        try {
          const st = statSync(transcriptPath);
          if (Date.now() - st.mtimeMs > 5000) {
            return { state: 'IDLE', reason: 'Antigravity 会话就绪 / 空闲' };
          }
        } catch {}
      }
      return realTime;
    }
  }

  if (!summary) {
    return { state: 'UNKNOWN', reason: 'Antigravity 会话元信息尚未确认' };
  }
  if (summary.status === 'CASCADE_RUN_STATUS_WAITING_FOR_USER') {
    return { state: 'WAITING_INPUT', reason: '智能体正在等待用户回答问题' };
  }
  if (summary.notFullyIdle || summary.status === 'CASCADE_RUN_STATUS_RUNNING') {
    return { state: 'RUNNING', reason: 'Antigravity 会话正在执行中' };
  }
  if (summary.status === 'CASCADE_RUN_STATUS_IDLE') {
    return { state: 'IDLE', reason: 'Antigravity 会话就绪 / 空闲' };
  }
  return { state: 'UNKNOWN', reason: `Antigravity 状态：${summary.status || '未知'}` };
}
