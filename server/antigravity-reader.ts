import type { DisplayEvent, Execution } from '../shared/types.js';
import type { ParsedRecord } from './codex-reader.js';
import { getAntigravitySummaries, getAntigravityExecution } from './antigravity-meta.js';

export function cleanArgs(args: unknown): any {
  if (!args || typeof args !== 'object') return args;
  if (Array.isArray(args)) return args.map(cleanArgs);
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          clean[k] = JSON.parse(trimmed);
          continue;
        } catch {}
      }
    }
    clean[k] = v;
  }
  return clean;
}

export function extractUserPrompt(content: string): string {
  if (!content) return '';
  const match = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (match) return match[1].trim();
  const stripped = content
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .trim();
  return stripped || content.trim();
}

export function parseAntigravitySystemMessage(rawContent: string): {
  role: 'user' | 'notice';
  text: string;
} {
  const text = typeof rawContent === 'string' ? rawContent : '';

  // 1. Check if this is a wrapped message: [Message] ... content=...
  const senderMatch = text.match(/sender=([^\s\r\n]+)/);
  const sender = senderMatch ? senderMatch[1] : '';

  const contentMatch = text.match(/content=([\s\S]*?)(?:\s*<\/SYSTEM_MESSAGE>|\s*$)/);
  if (contentMatch) {
    const cleanContent = contentMatch[1].trim();

    // Determine if this is a genuine system/task notice or a message sent by user via agentapi
    const isSystemNotice =
      sender !== 'system' ||
      cleanContent.startsWith('[Notice]') ||
      (cleanContent.startsWith('Subagent ') && cleanContent.includes('has gone idle')) ||
      (cleanContent.startsWith('Task id ') && cleanContent.includes('finished with result'));

    if (isSystemNotice) {
      return { role: 'notice', text: cleanContent };
    }
    // Message sent by user via agentapi send-message
    return { role: 'user', text: cleanContent };
  }

  // 2. Generic XML tag unwrapping: strip outer tags and preamble
  let inner = text;
  const tagStart = inner.lastIndexOf('<SYSTEM_MESSAGE>');
  const tagEnd = inner.indexOf('</SYSTEM_MESSAGE>', tagStart);
  if (tagStart !== -1 && tagEnd !== -1) {
    inner = inner.slice(tagStart + '<SYSTEM_MESSAGE>'.length, tagEnd).trim();
  } else {
    inner = inner
      .replace(/^The following is a <SYSTEM_MESSAGE>[\s\S]*?(?:\n\n|\r\n\r\n)/i, '')
      .replace(/<\/?SYSTEM_MESSAGE>/gi, '')
      .trim();
  }

  return { role: 'notice', text: inner };
}

export function antigravityRecord(record: Record<string, any>): ParsedRecord {
  const result: ParsedRecord = {
    items: [],
    output: false,
    nativeId: record.conversation_id,
  };

  if (record.type === 'USER_INPUT') {
    let text = extractUserPrompt(record.content || '');
    if (Array.isArray(record.media) && record.media.length > 0) {
      const mediaLines = record.media
        .map((m: any) => `[图片: ${m.uri ?? m.mime_type}]`)
        .join('\n');
      text = text ? `${text}\n${mediaLines}` : mediaLines;
    }
    if (text) {
      result.items.push({
        role: 'user',
        text,
        timestamp: record.created_at,
      });
    }
    return result;
  }

  if (record.type === 'PLANNER_RESPONSE') {
    if (typeof record.content === 'string' && record.content.trim()) {
      result.items.push({
        role: 'assistant',
        text: record.content.trim(),
        timestamp: record.created_at,
      });
      result.output = true;
    }
    if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
      for (const call of record.tool_calls) {
        let args = call.args;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {}
        }
        if (args && typeof args === 'object') {
          args = cleanArgs(args);
        }
        const text =
          typeof args === 'string'
            ? args
            : JSON.stringify(args ?? {}, null, 2);
        result.items.push({
          role: 'tool',
          label: String(call.name ?? '工具调用'),
          text,
          timestamp: record.created_at,
        });
        result.output = true;
      }
    }
    if (result.items.length > 0) {
      result.state = 'UNKNOWN';
      result.reason = '原生会话记录，当前执行状态尚未确认';
    }
    return result;
  }

  if (record.type === 'GENERIC') {
    if (typeof record.content === 'string' && record.content.trim()) {
      result.items.push({
        role: 'tool',
        label: '工具结果',
        text: record.content,
        timestamp: record.created_at,
      });
      result.output = true;
      if (record.status === 'RUNNING') {
        result.state = 'RUNNING';
        result.reason = '原生工具执行中';
      } else {
        result.state = 'UNKNOWN';
        result.reason = '原生工具结果已落盘';
      }
    }
    return result;
  }

  if (record.type === 'SYSTEM_MESSAGE') {
    const parsed = parseAntigravitySystemMessage(record.content || '');
    if (parsed.text) {
      result.items.push({
        role: parsed.role,
        text: parsed.text,
        timestamp: record.created_at,
      });
      if (parsed.role === 'user') {
        result.output = true;
      }
    }
    return result;
  }

  if (record.type === 'CHECKPOINT') {
    result.items.push({
      role: 'notice',
      text: '原生上下文已压缩；压缩前历史由上下文摘要恢复',
      timestamp: record.created_at,
    });
    return result;
  }

  return result;
}

import path from 'node:path';
import type { NativeSession } from './discovery.js';

export async function antigravityStatuses(
  antigravityHome: string,
  sessions?: Map<string, NativeSession>,
): Promise<Map<string, { state: Execution; reason: string }>> {
  const result = new Map<string, { state: Execution; reason: string }>();
  try {
    const summaries = getAntigravitySummaries(antigravityHome);
    for (const [id, summary] of summaries) {
      const session =
        sessions?.get(id) ||
        (sessions ? [...sessions.values()].find((s) => s.nativeId === id) : undefined);
      const transcriptPath =
        session?.files[0]?.path ||
        path.join(antigravityHome, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
      result.set(id, getAntigravityExecution(summary, transcriptPath));
    }
    if (sessions) {
      for (const session of sessions.values()) {
        if (session.provider === 'antigravity') {
          if (!result.has(session.nativeId)) {
            const transcriptPath =
              session.files[0]?.path ||
              path.join(
                antigravityHome,
                'brain',
                session.nativeId,
                '.system_generated',
                'logs',
                'transcript.jsonl',
              );
            result.set(session.nativeId, getAntigravityExecution(undefined, transcriptPath));
          }
          const current = result.get(session.nativeId);
          if (
            current?.state === 'UNKNOWN' &&
            session.createdAt &&
            Date.now() - session.createdAt < 15000
          ) {
            result.set(session.nativeId, {
              state: 'RUNNING',
              reason: 'Antigravity 智能体正在启动执行',
            });
          }
        }
      }
    }
  } catch {}
  return result;
}
