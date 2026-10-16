import type { DisplayEvent, Execution } from '../shared/types.js';
export interface ParsedRecord {
  items: Omit<DisplayEvent, 'id'>[];
  state?: Execution;
  reason?: string;
  output: boolean;
  nativeId?: string;
}
export function codexRecord(record: Record<string, any>): ParsedRecord {
  const result: ParsedRecord = { items: [], output: false, nativeId: record.uuid ?? record.id };
  const p = record.payload ?? {};
  const timestamp = record.timestamp;
  if (record.type === 'event_msg') {
    const states: Record<string, [Execution, string]> = {
      task_started: ['UNKNOWN', '已观测任务开始，尚无当前运行端证据'],
      task_complete: ['COMPLETED', '原生日志 task_complete'],
      turn_aborted: ['FAILED', '原生回合已中断'],
    };
    if (states[p.type]) {
      [result.state, result.reason] = states[p.type];
      result.output = true;
    }
    return result;
  }
  if (record.type !== 'response_item') return result;
  if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    const text = (Array.isArray(p.content) ? p.content : [])
      .filter((c: any) => c.type === 'input_text' || c.type === 'output_text' || c.type === 'text')
      .map((c: any) => c.text ?? '')
      .join('\n');
    if (text) {
      if (p.role === 'user' && text.trim().startsWith('<environment_context>') && text.trim().endsWith('</environment_context>')) {
        return result;
      }
      result.items.push({ role: p.role, text, timestamp });
    }
  } else if (['function_call', 'custom_tool_call'].includes(p.type)) {
    result.items.push({
      role: 'tool',
      label: String(p.name ?? '工具调用'),
      text:
        typeof p.arguments === 'string'
          ? p.arguments
          : typeof p.input === 'string'
            ? p.input
            : JSON.stringify(p.arguments ?? p.input ?? {}),
      timestamp,
    });
  } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
    result.items.push({
      role: 'tool',
      label: '工具结果',
      text: typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? ''),
      timestamp,
    });
  }
  if (result.items.length) {
    result.output = true;
    result.state = 'UNKNOWN';
    result.reason = '已有原生记录，当前执行状态尚未确认';
  }
  return result;
}
