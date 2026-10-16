export type InteractionPhase =
  | 'OBSERVE_ONLY'
  | 'READY'
  | 'QUEUED'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'WAITING_INPUT'
  | 'COMPLETED'
  | 'FAILED'
  | 'INTERRUPTED';
export interface InteractionQuestion {
  id: string;
  text: string;
  options: string[];
  multiple?: boolean;
}
export interface InteractionRequest {
  id: string;
  kind: 'approval' | 'question';
  title: string;
  detail: string;
  questions?: InteractionQuestion[];
}
export interface InteractionSetup {
  command: string;
  config: string;
  quickstart?: string;
  recommendedCommand?: string;
}
export interface InteractionView {
  serviceEpoch: string;
  runtimeEpoch: string | null;
  connected: boolean;
  available: boolean;
  canSend: boolean;
  canInterrupt: boolean;
  setup?: InteractionSetup;
  reason: string;
  phase: InteractionPhase;
  pending: InteractionRequest[];
  output: string;
  truncated: boolean;
  revision: number;
  lastRequestId?: string;
}

export interface InteractionAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  localPath: string;
  url: string;
}
