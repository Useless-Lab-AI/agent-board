import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { statSync, openSync, readSync, closeSync, existsSync, watch, type FSWatcher } from 'node:fs';
import type { NativeSession } from './discovery.js';
import type { InteractionRequest } from '../shared/interaction.js';
import type { LiveClient, LiveState } from './live-client.js';

export function inspectCodexTail(filePath: string): {
  state: 'IDLE' | 'RUNNING' | 'WAITING_APPROVAL' | 'WAITING_INPUT';
  reason: string;
  lastMessage?: string;
} | null {
  try {
    const st = statSync(filePath);
    if (!st.size) return null;
    const fd = openSync(filePath, 'r');
    try {
      const readLen = Math.min(st.size, 65536);
      const buf = Buffer.alloc(readLen);
      readSync(fd, buf, 0, readLen, st.size - readLen);
      const lines = buf.toString('utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.type === 'event_msg' && obj.payload) {
            const p = obj.payload;
            if (p.type === 'task_complete') {
              return { state: 'IDLE', reason: '任务已完成', lastMessage: p.last_agent_message };
            }
            if (p.type === 'turn_aborted') {
              return { state: 'IDLE', reason: '已中止', lastMessage: p.last_agent_message };
            }
            if (p.type === 'turn_complete') {
              return { state: 'IDLE', reason: '本轮已完成', lastMessage: p.last_agent_message };
            }
            if (p.type === 'turn_started' || p.type === 'task_started') {
              return { state: 'RUNNING', reason: '智能体正在执行' };
            }
          }
          if (obj.type === 'turn_start') {
            return { state: 'RUNNING', reason: '智能体正在思考回复' };
          }
        } catch {}
      }
    } finally {
      closeSync(fd);
    }
  } catch {}
  return null;
}

function applyPatch(obj: any, patch: { op: string; path: (string | number)[]; value?: any }) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(patch.path) || patch.path.length === 0) return;
  let cur = obj;
  for (let i = 0; i < patch.path.length - 1; i++) {
    const key = patch.path[i];
    if (cur[key] == null || typeof cur[key] !== 'object') {
      cur[key] = typeof patch.path[i + 1] === 'number' ? [] : {};
    }
    cur = cur[key];
  }
  const lastKey = patch.path[patch.path.length - 1];
  if (patch.op === 'replace') {
    cur[lastKey] = patch.value;
  } else if (patch.op === 'add') {
    if (Array.isArray(cur)) {
      const idx = Number(lastKey);
      if (Number.isInteger(idx) && idx >= 0 && idx <= cur.length) {
        cur.splice(idx, 0, patch.value);
      } else {
        cur.push(patch.value);
      }
    } else {
      cur[lastKey] = patch.value;
    }
  } else if (patch.op === 'remove') {
    if (Array.isArray(cur)) {
      const idx = Number(lastKey);
      if (Number.isInteger(idx) && idx >= 0 && idx < cur.length) {
        cur.splice(idx, 1);
      }
    } else {
      delete cur[lastKey];
    }
  }
}

// Independently implemented adapter for the installed client's internal IPC contract.
// Do not start an app-server or claim conversation ownership on this connection.
export class CodexClient implements LiveClient {
  private socket?: net.Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private clientId = '';
  private owner = '';
  private epoch = randomUUID();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private state: any;
  private snapshotRevision = -1;
  private snapshotWaiters = new Set<{ resolve: () => void; reject: (e: Error) => void }>();
  private failure?: Error;
  private connecting?: Promise<void>;
  private turnId?: string;
  private requests = new Map<string, any>();
  private onUpdateCallback?: () => void;
  private watcher?: FSWatcher;
  private watchTimer?: NodeJS.Timeout;
  private justSentAt = 0;

  constructor(
    private session: NativeSession,
    private endpoint = process.platform === 'win32'
      ? '\\\\.\\pipe\\codex-ipc'
      : (process.env.CODEX_IPC_PATH ?? path.join(os.tmpdir(), 'codex-ipc')),
  ) {
    this.ensureWatcher();
  }

  private ensureWatcher() {
    if (this.watcher) return;
    const filePath = this.session.files?.[0]?.path;
    if (filePath && existsSync(filePath)) {
      try {
        this.watcher = watch(filePath, () => {
          if (this.watchTimer) clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => {
            this.watchTimer = undefined;
            this.emitUpdate();
          }, 50);
        });
      } catch {}
    }
  }

  onUpdate(callback: () => void) {
    this.onUpdateCallback = callback;
    this.ensureWatcher();
  }
  private emitUpdate() {
    try { this.onUpdateCallback?.(); } catch {}
  }

  private write(message: unknown) {
    if (!this.socket || this.socket.destroyed || this.failure) throw this.failure ?? new Error('Codex 原客户端未连接');
    const payload = Buffer.from(JSON.stringify(message));
    if (this.socket.writableLength > 1024 * 1024) throw new Error('Codex 连接写入拥塞');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }
  private fail(error: Error) {
    this.failure = error;
    this.state = undefined;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    for (const w of this.snapshotWaiters) w.reject(error);
    this.snapshotWaiters.clear();
    this.socket?.destroy();
  }
  private request(method: string, version: number, params: unknown, targeted = true): Promise<any> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Codex ${method} 超时；操作结果未知，请查看原客户端，不会自动重发`));
      }, 8000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.write({ type: 'request', requestId, method, version, params,
          ...(this.clientId ? { sourceClientId: this.clientId } : {}),
          ...(targeted ? { targetClientId: this.owner } : {}), timeoutMs: 7000 });
      } catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  private receive(message: any) {
    if (message.type === 'client-discovery-request') {
      this.write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
    } else if (message.type === 'response') {
      const p = this.pending.get(message.requestId);
      if (!p) return;
      this.pending.delete(message.requestId); clearTimeout(p.timer);
      if (message.resultType !== 'success') p.reject(new Error(String(message.error ?? 'Codex 操作被拒绝')));
      else p.resolve(message);
    } else if (message.type === 'broadcast' && message.method === 'thread-stream-state-changed' &&
      message.params?.hostId === 'local' &&
      message.params?.conversationId === this.session.nativeId) {
      if (message.version !== 11) throw new Error('Codex IPC 状态协议版本不兼容，请更新接入器');
      if (message.sourceClientId && typeof message.sourceClientId === 'string') {
        this.owner = message.sourceClientId;
      }
      const change = message.params.change;
      if (change?.type === 'snapshot') {
        if (change.conversationState?.id !== this.session.nativeId || !Number.isInteger(change.revision))
          throw new Error('Codex 返回了不匹配的会话快照');
        if (change.revision < this.snapshotRevision) return;
        this.state = change.conversationState;
        this.snapshotRevision = change.revision;
        for (const waiter of this.snapshotWaiters) waiter.resolve();
        this.snapshotWaiters.clear();
        this.emitUpdate();
      } else if (change?.type === 'patches') {
        if (this.state && Array.isArray(change.patches)) {
          try {
            for (const patch of change.patches) {
              applyPatch(this.state, patch);
            }
            if (Number.isInteger(change.revision)) {
              this.snapshotRevision = change.revision;
            }
            for (const waiter of this.snapshotWaiters) waiter.resolve();
            this.snapshotWaiters.clear();
            this.emitUpdate();
          } catch {
            this.requestSnapshot();
          }
        } else {
          this.requestSnapshot();
        }
      }
    }
  }
  private requestSnapshot() {
    if (this.socket && !this.socket.destroyed && !this.failure && this.owner) {
      try { this.follow(true); } catch {}
    }
  }
  private async connect() {
    if (this.failure) throw this.failure;
    if (this.socket && !this.socket.destroyed && this.owner) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        if (process.platform !== 'win32' && this.endpoint.startsWith('\\\\.'))
          throw new Error('此 Codex 接入器当前支持 Windows 本地客户端');
        this.socket = net.createConnection(this.endpoint);
        this.socket.on('error', () =>
          this.fail(new Error('Codex 本地 IPC 不可用，请在桌面端或 VS Code 打开此会话')),
        );
        this.socket.on('close', () =>
          this.fail(new Error('Codex 原客户端连接已关闭，请重新连接')),
        );
        this.socket.on('data', (chunk) => {
          try {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            while (this.buffer.length >= 4) {
              const length = this.buffer.readUInt32LE(0);
              if (!length || length > 45 * 1024 * 1024)
                throw new Error('Codex IPC 消息超过限制');
              if (this.buffer.length < length + 4) break;
              const payload = this.buffer.subarray(4, length + 4);
              this.buffer = this.buffer.subarray(length + 4);
              this.receive(JSON.parse(payload.toString('utf8')));
            }
          } catch (error) {
            this.fail(error as Error);
          }
        });
        const hello = await this.request('initialize', 0, { clientType: 'agent-board' }, false);
        if (typeof hello.result?.clientId !== 'string')
          throw new Error('Codex IPC 初始化返回无效');
        this.clientId = hello.result.clientId;
        const owner = await this.request(
          'thread-owner-discovery',
          1,
          { hostId: 'local', conversationId: this.session.nativeId },
          false,
        );
        if (typeof owner.handledByClientId !== 'string')
          throw new Error('没有找到此会话的原客户端，请先在原客户端打开');
        this.owner = owner.handledByClientId;

        // Subscribe to live stream updates from owner
        try {
          this.follow(true);
        } catch {}

        // Wait briefly (up to 300ms) for an immediate snapshot if one is quickly available.
        // For large sessions (e.g. 200MB+), the full snapshot streams in the background;
        // do NOT block or fail if it takes longer.
        await new Promise<void>((resolve) => {
          if (this.state) {
            resolve();
            return;
          }
          let timer: NodeJS.Timeout | undefined;
          const waiter = {
            resolve: () => {
              if (timer) clearTimeout(timer);
              resolve();
            },
            reject: () => {
              if (timer) clearTimeout(timer);
              resolve();
            },
          };
          timer = setTimeout(() => {
            this.snapshotWaiters.delete(waiter);
            resolve();
          }, 300);
          this.snapshotWaiters.add(waiter);
        });
      } finally {
        this.connecting = undefined;
      }
    })();
    return this.connecting;
  }
  private follow(following: boolean) {
    this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1,
      sourceClientId: this.clientId, targetClientIds: [this.owner],
      params: { hostId: 'local', conversationId: this.session.nativeId, following } });
  }
  async refresh(): Promise<LiveState> {
    if (this.failure) throw this.failure;
    if (!this.socket || this.socket.destroyed || !this.owner) {
      await this.connect();
    }
    this.ensureWatcher();
    if (this.failure) throw this.failure;

    if (this.state) {
      return this.toLiveState();
    }

    return this.toFallbackLiveState();
  }
  private toFallbackLiveState(): LiveState {
    const filePath = this.session.files?.[0]?.path;
    const fileTail = filePath ? inspectCodexTail(filePath) : null;
    const isRunning = fileTail?.state === 'RUNNING' || Date.now() - this.justSentAt < 3000;
    const canSend = !!this.owner && !this.failure && !isRunning;

    return {
      epoch: this.epoch,
      phase: isRunning ? 'RUNNING' : canSend ? 'READY' : 'OBSERVE_ONLY',
      reason: isRunning
        ? '原客户端正在执行中；两端共用此会话，无需退出。'
        : canSend
          ? '已连接原客户端；两端共用此会话，无需退出。'
          : '正在同步原客户端会话数据…',
      pending: [],
      canSend,
      canInterrupt: false,
      output: fileTail?.lastMessage || undefined,
      truncated: false,
    };
  }
  private toLiveState(): LiveState {
    const state = this.state;
    if (!state || !Array.isArray(state.requests) || !state.threadRuntimeStatus?.type)
      throw new Error('Codex 会话状态格式不兼容');
    this.requests.clear();
    const pending: InteractionRequest[] = [];
    for (const r of state.requests.slice(0, 16)) {
      const id = String(r.id);
      if (r.method === 'item/commandExecution/requestApproval' || r.method === 'item/fileChange/requestApproval') {
        const detail = JSON.stringify(r.params ?? {}, null, 2);
        if (detail.length > 16000) continue; // Never allow approval of hidden/truncated details.
        this.requests.set(id, r);
        pending.push({ id, kind: 'approval', title: r.method.includes('commandExecution') ? '允许执行命令？' : '允许修改文件？',
          detail });
      } else if (r.method === 'item/tool/requestUserInput' && Array.isArray(r.params?.questions)) {
        if (JSON.stringify(r.params).length > 16000) continue;
        this.requests.set(id, r);
        pending.push({ id, kind: 'question', title: 'AI 需要你的回答', detail: '', questions: r.params.questions.map((q: any) => ({
          id: q.id, text: q.question, options: (q.options ?? []).map((o: any) => o.label),
        })) });
      }
    }
    const turns = state.turnHistory?.kind === 'canonical'
      ? Object.values(state.turnHistory.history?.entitiesByKey ?? {}) as any[] : state.turns ?? [];
    const active = turns.filter((t: any) => t.status === 'inProgress' || t.status === 'in_progress');
    this.turnId = active.length === 1 ? active[0].turnId : undefined;
    const running = state.threadRuntimeStatus.type === 'active';
    const unsupported = state.requests.length > pending.length;

    let output = '';
    let truncated = false;
    const targetTurn = active.length > 0 ? active[0] : turns.at(-1);
    if (targetTurn && Array.isArray(targetTurn.items)) {
      for (let i = targetTurn.items.length - 1; i >= 0; i--) {
        const item = targetTurn.items[i];
        if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
          output = item.text;
          break;
        } else if (item?.type === 'commandExecution' && item.aggregatedOutput) {
          output = item.aggregatedOutput;
          break;
        }
      }
      if (output.length > 32000) {
        output = output.slice(-32000);
        truncated = true;
      }
    }

    if (!output) {
      const filePath = this.session.files?.[0]?.path;
      if (filePath) {
        const fileTail = inspectCodexTail(filePath);
        if (fileTail?.lastMessage) output = fileTail.lastMessage;
      }
    }

    return {
      epoch: this.epoch,
      phase: pending.length
        ? pending.some(p => p.kind === 'approval') ? 'WAITING_APPROVAL' : 'WAITING_INPUT'
        : running ? 'RUNNING' : 'READY',
      reason: unsupported
        ? '原客户端有暂不支持的确认，请在原客户端处理。'
        : running
          ? '原客户端正在执行中；两端共用此会话，无需退出。'
          : '已连接原客户端；两端共用此会话，无需退出。',
      pending,
      canSend: !running && state.requests.length === 0 && state.threadRuntimeStatus.type === 'idle',
      canInterrupt: running && !!this.turnId,
      output: output || undefined,
      truncated: truncated || undefined,
    };
  }
  async send(text: string) {
    this.justSentAt = Date.now();
    if (this.state?.threadRuntimeStatus) {
      this.state.threadRuntimeStatus.type = 'active';
    }
    await this.request('thread-follower-start-turn', 2, {
      conversationId: this.session.nativeId,
      turnStart: {
        request: { threadId: this.session.nativeId, input: [{ type: 'text', text, text_elements: [] }] },
        context: { inheritThreadSettings: true },
      },
    });
    this.justSentAt = Date.now();
    setTimeout(() => this.emitUpdate(), 80);
  }
  async decision(id: string, body: Record<string, unknown>) {
    const r = this.requests.get(id);
    if (!r) throw new Error('请求已在原客户端处理或已过期');
    const method = r.method === 'item/commandExecution/requestApproval' ? 'thread-follower-command-approval-decision'
      : r.method === 'item/fileChange/requestApproval' ? 'thread-follower-file-approval-decision' : 'thread-follower-submit-user-input';
    const rawAnswers = (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {}) as Record<string, string>;
    const value = method.endsWith('submit-user-input')
      ? { response: { answers: Object.fromEntries(Object.entries(rawAnswers).map(([key, answer]) => [key, { answers: [answer] }])) } }
      : { decision: body.decision === 'allow' ? 'accept' : 'decline' };
    await this.request(method, 1, { conversationId: this.session.nativeId, requestId: r.id, ...value });
  }
  async interrupt() {
    if (!this.turnId) throw new Error('没有可确认身份的活动轮次，请在原客户端停止');
    await this.request('thread-follower-interrupt-turn', 4, { conversationId: this.session.nativeId, mode: 'user-stop', expectedTurnId: this.turnId });
  }
  async close() {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = undefined;
    }
    if (this.owner && !this.socket?.destroyed && !this.failure) {
      try {
        this.follow(false);
      } catch {}
    }
    this.fail(new Error('看板已断开；原客户端继续运行'));
  }
}
