export type Provider = 'codex' | 'claude' | 'antigravity';
export type Execution =
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'IDLE'
  | 'UNKNOWN';
export type Attention =
  | 'BASELINE_EXISTING'
  | 'READ'
  | 'UNREAD_OUTPUT'
  | 'UNREAD_COMPLETION'
  | 'ARCHIVED';
export interface Position {
  generation: string;
  offset: number;
  skipping?: boolean;
}
export type Vector = Record<string, Position>;
export interface DisplayEvent {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'notice';
  text: string;
  timestamp?: string;
  label?: string;
  segment?: string;
}
export interface SessionView {
  id: string;
  nativeId: string;
  provider: Provider;
  title: string;
  cwd: string;
  segments: number;
  order: number;
  execution: Execution;
  stateReason: string;
  activity?: { label: '近期有输出' | '暂未更新'; observedAt: number };
  attention: Attention;
  archived: boolean;
  discoveredAt: number;
  updatedAt: number;
  diagnostics: string[];
  revision: string;
}
export interface EventPage {
  items: DisplayEvent[];
  nextCursor: string | null;
  snapshotCursor: string;
  truncated: boolean;
  diagnostics: string[];
}
export interface SessionList {
  sessions: SessionView[];
  total: number;
  nextCursor: string | null;
  initializing?: boolean;
  sources: { provider: Provider; available: boolean; message?: string }[];
}
