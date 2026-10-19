import { randomUUID } from 'node:crypto';
import type { NativeSession } from './discovery.js';
import type { InteractionAttachment, InteractionView } from '../shared/interaction.js';
import type { LiveClient } from './live-client.js';
import { CodexClient } from './codex-client.js';
import { ClaudeClient } from './claude-client.js';
import { AntigravityClient } from './antigravity-client.js';
import { HttpError } from './security.js';

interface Receipt { signature: string; error?: string; }
interface Entry {
  view: InteractionView;
  client: LiveClient;
  receipts: Map<string, Receipt>;
  decisions: Set<string>;
  refreshing?: Promise<void>;
  writing: boolean;
  touched: number;
  retryAt: number;
  stale: boolean;
}

export function formatPromptWithAttachments(
  text: string,
  attachments?: InteractionAttachment[],
): string {
  const textTrimmed = (text || '').trim();
  const atts = Array.isArray(attachments) ? attachments : [];
  if (atts.length === 0) return textTrimmed;

  const fileLines: string[] = [];
  const imageChips: string[] = [];
  for (const att of atts) {
    if (att && typeof att.localPath === 'string' && typeof att.name === 'string') {
      const isImg =
        att.mimeType?.startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
      const normalizedPath = att.localPath.replace(/\\/g, '/');
      if (isImg) {
        imageChips.push(`[Image: ${att.localPath}]`);
        fileLines.push(`- 🖼️ 图片 (Image): [${att.name}](file:///${normalizedPath})`);
      } else {
        const sizeStr =
          att.size < 1024
            ? `${att.size} B`
            : att.size < 1024 * 1024
              ? `${(att.size / 1024).toFixed(1)} KB`
              : `${(att.size / (1024 * 1024)).toFixed(1)} MB`;
        fileLines.push(`- 📄 文件 (File): [${att.name}](file:///${normalizedPath}) (${sizeStr})`);
      }
    }
  }

  const parts: string[] = [];
  if (textTrimmed) {
    parts.push(textTrimmed);
  } else {
    parts.push('请查看以下上传的附件并进行分析：');
  }

  if (imageChips.length > 0) {
    parts.push(imageChips.join('\n'));
  }

  if (fileLines.length > 0) {
    parts.push(
      `\n---\n📎 附件列表 (Attachments):\n${fileLines.join('\n')}\n（提示：以上文件已保存在本地，可通过对应工具读取文件内容或查看图片）`,
    );
  }
  return parts.join('\n\n');
}

export class Interactions {
  readonly epoch = randomUUID();
  private entries = new Map<string, Entry>();
  private closing = false;
  private cleanup: NodeJS.Timeout;
  constructor(
    _codexHome: string,
    private claudeHome: string,
    private notify: (id: string) => void,
    private antigravityHome = '',
  ) {
    this.cleanup = setInterval(() => {
      for (const [id, e] of this.entries) {
        if (!e.stale && Date.now() - e.touched > 6000) { e.stale = true; this.notify(id); }
        const isActiveTurn = e.view.connected && ['RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT'].includes(e.view.phase);
        if (!e.writing && !e.refreshing && !isActiveTurn && Date.now() - e.touched > 120_000) {
          this.entries.delete(id); void e.client.close(); this.notify(id);
        }
      }
    }, 2000);
    this.cleanup.unref();
  }
  activeState(id: string) {
    const e = this.entries.get(id);
    if (!e?.view.connected) return;
    if (e.view.phase === 'WAITING_APPROVAL' || e.view.phase === 'WAITING_INPUT')
      return { state: e.view.phase, reason: e.view.reason };
    if (Date.now() - e.touched > 6000) return;
    if (e.view.phase === 'RUNNING')
      return { state: 'RUNNING' as const, reason: e.view.reason };
  }
  private create(session: NativeSession): Entry {
    if (this.closing) throw new HttpError(409, '服务正在关闭');
    if (this.entries.size >= 12) throw new HttpError(409, '已达到 12 个连接上限，关闭不用的弹层后稍候重试');
    const view: InteractionView = { serviceEpoch: this.epoch, runtimeEpoch: null, connected: false, available: false,
      canSend: false, canInterrupt: false, reason: '正在连接原客户端', phase: 'OBSERVE_ONLY', pending: [], output: '', truncated: false, revision: 0 };
    if (session.provider === 'claude') view.setup = {
      quickstart: 'npm run setup',
      recommendedCommand: 'claude-board',
      command: 'claude --dangerously-load-development-channels server:agent-board',
      config: JSON.stringify({
        mcpServers: {
          'agent-board': {
            command: 'agent-board-channel',
          },
        },
      }, null, 2),
    };
    const client =
      session.provider === 'codex'
        ? new CodexClient(session)
        : session.provider === 'claude'
          ? new ClaudeClient(session, this.claudeHome)
          : new AntigravityClient(session, this.antigravityHome);
    const e: Entry = { view, client,
      receipts: new Map(), decisions: new Set(), writing: false, touched: Date.now(), retryAt: 0, stale: false };
    this.attachClient(session.id, e);
    this.entries.set(session.id, e);
    return e;
  }
  private attachClient(id: string, e: Entry) {
    if (typeof (e.client as any).onUpdate === 'function') {
      (e.client as any).onUpdate(() => {
        void this.refresh(id, e);
      });
    }
  }
  private async refresh(id: string, e: Entry) {
    if (e.refreshing) return e.refreshing;
    e.refreshing = (async () => {
      const before = JSON.stringify(e.view);
      try {
        const state = await e.client.refresh();
        e.retryAt = 0;
        Object.assign(e.view, { runtimeEpoch: state.epoch, connected: true, available: true,
          canSend: state.canSend, canInterrupt: state.canInterrupt, phase: state.phase, reason: state.reason,
          pending: state.pending.filter(p => !e.decisions.has(`${state.epoch}:${p.id}`)), output: state.output ?? '', truncated: state.truncated ?? false });
      } catch (error) {
        if (!e.retryAt) e.retryAt = Date.now() + 5000;
        Object.assign(e.view, { connected: false, available: false, canSend: false, canInterrupt: false,
          phase: 'OBSERVE_ONLY', pending: [], reason: (error as Error).message.slice(0, 1000) });
      }
      if (before !== JSON.stringify(e.view)) { e.view.revision++; this.notify(id); }
    })().finally(() => { e.refreshing = undefined; });
    return e.refreshing;
  }
  async view(session: NativeSession): Promise<InteractionView> {
    let e = this.entries.get(session.id);
    // Reopening after failure uses a fresh transport; never replays a write.
    if (e && !e.view.connected && !e.refreshing && !e.writing && e.retryAt && Date.now() >= e.retryAt) {
      await e.client.close();
      e.client =
        session.provider === 'codex'
          ? new CodexClient(session)
          : session.provider === 'claude'
            ? new ClaudeClient(session, this.claudeHome)
            : new AntigravityClient(session, this.antigravityHome);
      this.attachClient(session.id, e);
      e.retryAt = 0;
    }
    e ??= this.create(session);
    e.touched = Date.now();
    e.stale = false;
    if (!e.writing) await this.refresh(session.id, e);
    return structuredClone(e.view);
  }
  private entry(id: string, body: Record<string, unknown>) {
    if (body.serviceEpoch !== this.epoch) throw new HttpError(409, '看板已重启，请刷新；消息不会自动重发');
    const e = this.entries.get(id);
    if (!e || body.runtimeEpoch !== e.view.runtimeEpoch || !e.view.connected) throw new HttpError(409, '原客户端连接已变化，请刷新后重试');
    if (e.writing || this.closing) throw new HttpError(409, '操作尚未返回，请稍候');
    e.touched = Date.now();
    return e;
  }
  private async perform(id: string, e: Entry, body: Record<string, unknown>, action: () => Promise<void>) {
    e.writing = true;
    try {
      await this.refresh(id, e);
      if (!e.view.connected || body.runtimeEpoch !== e.view.runtimeEpoch) throw new Error('连接已变化，操作未发送，请刷新');
      await action();
      await this.refresh(id, e);
      return structuredClone(e.view);
    } catch (error) { throw new HttpError(409, (error as Error).message.slice(0, 1000)); }
    finally { e.writing = false; }
  }
  async send(session: NativeSession, body: Record<string, unknown>) {
    if (Object.keys(body).some(k => !['text', 'requestId', 'serviceEpoch', 'runtimeEpoch', 'attachments'].includes(k)))
      throw new HttpError(400, '消息包含不支持的参数');
    if (typeof body.text !== 'string' || body.text.length > 32000 ||
      typeof body.requestId !== 'string' || !/^[\w-]{1,100}$/.test(body.requestId)) throw new HttpError(400, '消息或请求编号无效');
    const attachments = Array.isArray(body.attachments) ? (body.attachments as InteractionAttachment[]) : [];
    const textTrimmed = body.text.trim();
    if (!textTrimmed && attachments.length === 0) throw new HttpError(400, '消息和附件不能同时为空');

    const fullText = formatPromptWithAttachments(textTrimmed, attachments);

    const e = this.entry(session.id, body);
    const signature = JSON.stringify([fullText, body.runtimeEpoch]);
    const prior = e.receipts.get(body.requestId);
    if (prior) {
      if (prior.signature !== signature) throw new HttpError(409, '请求编号已用于另一条消息');
      if (prior.error) throw new HttpError(409, prior.error);
      return structuredClone(e.view);
    }
    if (e.receipts.size >= 256) throw new HttpError(409, '此连接的请求记录已满，请关闭弹层等待连接释放');
    const textToSend = fullText, requestId = body.requestId;
    const receipt: Receipt = { signature };
    // Record even failed/uncertain attempts so a repeated HTTP request never resends.
    e.receipts.set(requestId, receipt);
    try {
      return await this.perform(session.id, e, body, async () => {
        if (!e.view.canSend) throw new Error('原客户端当前不可发送，请先处理正在执行的任务或确认');
        await e.client.send(textToSend, requestId);
        e.view.lastRequestId = requestId;
      });
    } catch (error) { receipt.error = (error as Error).message; throw error; }
  }
  async decision(id: string, body: Record<string, unknown>) {
    const e = this.entry(id, body);
    return this.perform(id, e, body, async () => {
      const request = e.view.pending.find(p => p.id === body.providerRequestId);
      if (!request) throw new Error('请求已处理或过期，请查看原客户端');
      if (request.kind === 'approval' && !['allow', 'deny'].includes(String(body.decision))) throw new Error('请选择允许或拒绝');
      if (request.kind === 'question') {
        const action = typeof body.action === 'string' ? body.action : 'submit';
        if (!['submit', 'skip', 'cancel'].includes(action)) {
          throw new Error('不支持的问题操作类型');
        }
        if (action === 'submit') {
          const answers = body.answers;
          if (!answers || typeof answers !== 'object' || Array.isArray(answers) ||
            Object.keys(answers).length !== request.questions?.length || request.questions?.some(q => {
              const answer = (answers as Record<string, unknown>)[q.id];
              return typeof answer !== 'string' || !answer.trim() || answer.length > 16000;
            })) throw new Error('请完整回答问题');
        }
      }
      if (e.decisions.size >= 256) throw new Error('此连接的审批记录已满，请在原客户端处理');
      e.decisions.add(`${e.view.runtimeEpoch}:${request.id}`);
      await e.client.decision(request.id, body);
    });
  }
  async interrupt(id: string, body: Record<string, unknown>) {
    const e = this.entry(id, body);
    return this.perform(id, e, body, async () => {
      if (!e.view.canInterrupt) throw new Error('此连接不支持停止，请在原客户端操作');
      await e.client.interrupt();
    });
  }
  async close() {
    this.closing = true; clearInterval(this.cleanup);
    await Promise.allSettled([...this.entries.values()].map(e => e.client.close()));
  }
}
