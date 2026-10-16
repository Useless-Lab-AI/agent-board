import type { InteractionRequest, InteractionPhase } from '../shared/interaction.js';

export interface LiveState {
  epoch: string;
  phase: InteractionPhase;
  reason: string;
  pending: InteractionRequest[];
  canSend: boolean;
  canInterrupt: boolean;
  output?: string;
  truncated?: boolean;
}
export interface LiveClient {
  refresh(): Promise<LiveState>;
  send(text: string, requestId: string): Promise<void>;
  decision(id: string, body: Record<string, unknown>): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
