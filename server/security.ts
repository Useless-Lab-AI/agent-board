import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
const realpathCache = new Map<string, string>();
export async function cachedRealpath(p: string): Promise<string> {
  const cached = realpathCache.get(p);
  if (cached) return cached;
  const resolved = await realpath(p);
  realpathCache.set(p, resolved);
  return resolved;
}
export async function contained(root: string, file: string) {
  const [base, target] = await Promise.all([cachedRealpath(root), cachedRealpath(file)]);
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new HttpError(403, '路径超出允许的来源目录');
  return target;
}
export function guard(
  req: IncomingMessage,
  port: number,
  remoteVerify?: (req: IncomingMessage) => boolean,
): { isRemoteClient: boolean } {
  const authority = `127.0.0.1:${port}`;
  const addr = req.socket?.remoteAddress;
  const isLoopbackSocket =
    !addr || addr === '127.0.0.1' || addr === '::ffff:127.0.0.1' || addr === '::1';
  const isForwarded = Boolean(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']);
  const isLocalDirect = isLoopbackSocket && !isForwarded && req.headers.host === authority;

  if (isLocalDirect) {
    if (req.headers.origin && req.headers.origin !== `http://${authority}`) {
      throw new HttpError(403, '只允许本机同源访问');
    }
  } else {
    const host = req.headers.host;
    if (!host || !remoteVerify?.(req)) {
      throw new HttpError(403, '只允许本机同源访问');
    }
    if (req.headers.origin) {
      let originHost = '';
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {
        throw new HttpError(403, '只允许本机同源访问');
      }
      if (originHost !== host) {
        throw new HttpError(403, '只允许本机同源访问');
      }
    }
  }

  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '拒绝跨站请求');
  if (
    req.method === 'POST' &&
    (req.headers['x-agent-board'] !== '1' ||
      !req.headers['content-type']?.startsWith('application/json'))
  )
    throw new HttpError(403, '写入需要 JSON 和看板请求标识');

  return { isRemoteClient: !isLocalDirect };
}
export async function jsonBody(req: IncomingMessage, limit = 65536): Promise<Record<string, unknown>> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new HttpError(413, '请求过大');
    chunks.push(chunk);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON 请求无效');
  }
}
export function cursors(secret: string) {
  const signature = (body: string) => createHmac('sha256', secret).update(body).digest('base64url');
  return {
    encode(value: unknown) {
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return body + '.' + signature(body);
    },
    decode<T>(token: string): T {
      if (token.length > 60000) throw new HttpError(400, '游标过大');
      const [body, signed, extra] = token.split('.');
      const actual = Buffer.from(signed || '');
      const expected = Buffer.from(signature(body || ''));
      if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new HttpError(400, '游标无效');
      try {
        return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
      } catch {
        throw new HttpError(400, '游标无效');
      }
    },
  };
}
