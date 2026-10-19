import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';
import type { SessionStore } from './session-store.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscriptionRecord extends PushSubscriptionInput {
  lang: string;
  createdAt: number;
  updatedAt: number;
}

export interface PushPayloadData {
  title: string;
  body: string;
  tag: string;
  url: string;
  sessionId?: string;
  requireInteraction?: boolean;
}

const VAPID_SETTING_KEY = 'vapid-keys-v1';
const SUBSCRIPTIONS_SETTING_KEY = 'push-subscriptions-v1';
const MAX_SUBSCRIPTIONS = 64;

function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  let priv = ecdh.getPrivateKey();
  if (priv.length < 32) {
    const padded = Buffer.alloc(32);
    priv.copy(padded, 32 - priv.length);
    priv = padded;
  } else if (priv.length > 32) {
    priv = priv.subarray(priv.length - 32);
  }
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: priv.toString('base64url'),
  };
}

export function createVapidJwt(
  audienceOrigin: string,
  vapidKeys: VapidKeys,
  subject = 'mailto:notify@agent-board.local',
): string {
  const pubBuf = Buffer.from(vapidKeys.publicKey, 'base64url');
  const privBuf = Buffer.from(vapidKeys.privateKey, 'base64url');
  if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || privBuf.length !== 32) {
    throw new Error('Invalid VAPID key pair');
  }
  const x = pubBuf.subarray(1, 33).toString('base64url');
  const y = pubBuf.subarray(33, 65).toString('base64url');
  const d = privBuf.toString('base64url');

  const keyObject = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d },
    format: 'jwk',
  });

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      aud: audienceOrigin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: subject,
    }),
  ).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: keyObject,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Encrypts a UTF-8 string payload according to RFC 8291 (Web Push Message Encryption)
 * and RFC 8188 (aes128gcm content encoding).
 */
export function encryptWebPushPayload(
  subscription: PushSubscriptionInput,
  payloadText: string,
): Buffer {
  const uaPublic = Buffer.from(subscription.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.keys.auth, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('Invalid client p256dh public key');
  }
  if (authSecret.length < 16) {
    throw new Error('Invalid client auth secret');
  }

  const salt = randomBytes(16);
  const serverECDH = createECDH('prime256v1');
  serverECDH.generateKeys();
  const asPublic = serverECDH.getPublicKey();
  const sharedSecret = serverECDH.computeSecret(uaPublic);

  // RFC 8291 Section 3.3: IKM derivation
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  // RFC 8188 Section 2.2 & 2.3: CEK and Nonce derivation
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, cekInfo, 16));

  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'ascii');
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // RFC 8188 Section 2: Final record delimiter 0x02
  const paddedPlaintext = Buffer.concat([
    Buffer.from(payloadText, 'utf8'),
    Buffer.from([0x02]),
  ]);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(paddedPlaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // RFC 8188 Section 2.1: aes128gcm header = salt(16) || rs(4) || idlen(1) || keyid(65)
  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return Buffer.concat([header, ciphertext]);
}

function localizeReason(reason: string, lang: string): string {
  const clean = (reason || '').trim();
  if (!clean) return '';
  if (lang === 'en-US') {
    if (clean === '允许执行命令？') return 'Allow command execution?';
    if (clean === '允许修改文件？') return 'Allow file modification?';
    if (clean === 'AI 需要你的回答') return 'Agent is waiting for your answer';
    if (clean === '等待确认或输入') return 'Waiting for your confirmation or input';
  } else if (lang === 'ja-JP') {
    if (clean === '允许执行命令？') return 'コマンドの実行を許可しますか？';
    if (clean === '允许修改文件？') return 'ファイルの変更を許可しますか？';
    if (clean === 'AI 需要你的回答') return 'エージェントが回答を待っています';
    if (clean === '等待确认或输入') return '確認または入力を待っています';
  } else if (lang === 'zh-TW') {
    if (clean === '允许执行命令？') return '允許執行命令？';
    if (clean === '允许修改文件？') return '允許修改檔案？';
    if (clean === 'AI 需要你的回答') return 'AI 需要你的回答';
    if (clean === '等待确认或输入') return '等待確認或輸入';
  }
  return clean;
}

export function buildWaitingPushPayload(
  session: {
    id: string;
    provider: string;
    title: string;
    execution: 'WAITING_APPROVAL' | 'WAITING_INPUT';
    stateReason: string;
  },
  lang = 'zh-CN',
): PushPayloadData {
  const providerLabel =
    session.provider === 'claude'
      ? 'Claude'
      : session.provider === 'codex'
        ? 'Codex'
        : 'Antigravity';
  const isApproval = session.execution === 'WAITING_APPROVAL';
  const reasonText = localizeReason(session.stateReason, lang);

  let title: string;
  let fallbackBody: string;
  if (lang === 'en-US') {
    title = isApproval
      ? `⚠️ Approval Needed · ${providerLabel}`
      : `💬 Input Needed · ${providerLabel}`;
    fallbackBody = isApproval
      ? 'Agent is waiting for your approval to continue.'
      : 'Agent has a question and is waiting for your reply.';
  } else if (lang === 'ja-JP') {
    title = isApproval
      ? `⚠️ 承認待ち · ${providerLabel}`
      : `💬 入力待ち · ${providerLabel}`;
    fallbackBody = isApproval
      ? 'エージェントが実行の承認を待っています。'
      : 'エージェントがあなたの回答を待っています。';
  } else if (lang === 'zh-TW') {
    title = isApproval
      ? `⚠️ 待確認批准 · ${providerLabel}`
      : `💬 待輸入回覆 · ${providerLabel}`;
    fallbackBody = isApproval
      ? '代理正在等待你的批准以繼續執行'
      : '代理向你提問，正在等待你的回覆';
  } else {
    title = isApproval
      ? `⚠️ 待确认批准 · ${providerLabel}`
      : `💬 待输入回复 · ${providerLabel}`;
    fallbackBody = isApproval
      ? '代理正在等待你的批准以继续执行'
      : '代理向你提问，正在等待你的回复';
  }

  const sessionTitle = (session.title || '').trim();
  const body = reasonText
    ? `${sessionTitle} — ${reasonText}`
    : `${sessionTitle} — ${fallbackBody}`;

  return {
    title,
    body: body.slice(0, 240),
    tag: `agent-board-wait-${session.id}`,
    url: `/?session=${encodeURIComponent(session.id)}`,
    sessionId: session.id,
    requireInteraction: true,
  };
}

export class WebPushManager {
  private vapidKeys: VapidKeys;
  private subscriptions = new Map<string, PushSubscriptionRecord>();

  constructor(private store: SessionStore) {
    this.vapidKeys = this.loadOrInitVapidKeys();
    this.loadSubscriptions();
  }

  private loadOrInitVapidKeys(): VapidKeys {
    const raw = this.store.getSetting(VAPID_SETTING_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as VapidKeys;
        if (
          typeof parsed.publicKey === 'string' &&
          typeof parsed.privateKey === 'string' &&
          Buffer.from(parsed.publicKey, 'base64url').length === 65 &&
          Buffer.from(parsed.privateKey, 'base64url').length === 32
        ) {
          return parsed;
        }
      } catch {}
    }
    const keys = generateVapidKeys();
    this.store.setSetting(VAPID_SETTING_KEY, JSON.stringify(keys));
    return keys;
  }

  private loadSubscriptions() {
    const raw = this.store.getSetting(SUBSCRIPTIONS_SETTING_KEY);
    if (!raw) return;
    try {
      const list = JSON.parse(raw) as PushSubscriptionRecord[];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (
            item &&
            typeof item.endpoint === 'string' &&
            item.keys &&
            typeof item.keys.p256dh === 'string' &&
            typeof item.keys.auth === 'string'
          ) {
            this.subscriptions.set(item.endpoint, item);
          }
        }
      }
    } catch {}
  }

  private saveSubscriptions() {
    const sorted = [...this.subscriptions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SUBSCRIPTIONS);
    this.subscriptions = new Map(sorted.map((s) => [s.endpoint, s]));
    this.store.setSetting(SUBSCRIPTIONS_SETTING_KEY, JSON.stringify(sorted));
  }

  getPublicKey(): string {
    return this.vapidKeys.publicKey;
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  subscribe(input: PushSubscriptionInput, lang = 'zh-CN'): number {
    const endpoint = (input?.endpoint || '').trim();
    const p256dh = (input?.keys?.p256dh || '').trim();
    const auth = (input?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) {
      throw new Error('Invalid push subscription parameters');
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(endpoint);
    } catch {
      throw new Error('Invalid push subscription endpoint URL');
    }
    if (
      parsedUrl.protocol !== 'https:' &&
      parsedUrl.hostname !== '127.0.0.1' &&
      parsedUrl.hostname !== 'localhost'
    ) {
      throw new Error('Push endpoint must use HTTPS');
    }
    const pubBuf = Buffer.from(p256dh, 'base64url');
    const authBuf = Buffer.from(auth, 'base64url');
    if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || authBuf.length < 16) {
      throw new Error('Invalid push subscription cryptographic keys');
    }

    const now = Date.now();
    const existing = this.subscriptions.get(endpoint);
    this.subscriptions.set(endpoint, {
      endpoint,
      keys: {
        p256dh: pubBuf.toString('base64url'),
        auth: authBuf.toString('base64url'),
      },
      lang: typeof lang === 'string' && lang ? lang : existing?.lang || 'zh-CN',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.saveSubscriptions();
    return this.subscriptions.size;
  }

  unsubscribe(endpoint: string): number {
    if (this.subscriptions.delete(endpoint)) {
      this.saveSubscriptions();
    }
    return this.subscriptions.size;
  }

  async sendOne(
    sub: PushSubscriptionRecord,
    payload: PushPayloadData,
  ): Promise<{ ok: boolean; status?: number; expired?: boolean }> {
    try {
      const origin = new URL(sub.endpoint).origin;
      const jwt = createVapidJwt(origin, this.vapidKeys);
      const body = encryptWebPushPayload(sub, JSON.stringify(payload));
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `vapid t=${jwt}, k=${this.vapidKeys.publicKey}`,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.length),
          TTL: '86400',
          Urgency: 'high',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404 || res.status === 410) {
        return { ok: false, status: res.status, expired: true };
      }
      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false };
    }
  }

  async sendToAll(
    buildPayload: PushPayloadData | ((sub: PushSubscriptionRecord) => PushPayloadData),
  ): Promise<{ sent: number; failed: number; removed: number }> {
    const subs = [...this.subscriptions.values()];
    if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 };

    let sent = 0;
    let failed = 0;
    let removed = 0;

    await Promise.all(
      subs.map(async (sub) => {
        const payload = typeof buildPayload === 'function' ? buildPayload(sub) : buildPayload;
        const result = await this.sendOne(sub, payload);
        if (result.ok) {
          sent++;
        } else {
          failed++;
          if (result.expired) {
            if (this.subscriptions.delete(sub.endpoint)) {
              removed++;
            }
          }
        }
      }),
    );

    if (removed > 0) {
      this.saveSubscriptions();
    }
    return { sent, failed, removed };
  }
}
