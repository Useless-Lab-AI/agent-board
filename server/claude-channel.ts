#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { guard, HttpError, jsonBody } from './security.js';

// Spawned by Claude as an MCP stdio server, not by the board.
const root = process.env.AGENT_BOARD_CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
const directory = path.join(root, 'agent-board-channels');
const token = randomBytes(32).toString('hex');
const epoch = randomUUID();
const pending = new Map<string, { id: string; kind: 'approval'; title: string; detail: string; expires: number }>();
const receipts = new Map<string, { text: string; error?: string }>();
const awaitingReply = new Set<string>();
let output = '', truncated = false, initialized = false;
let boundSession: string | undefined;
let descriptor: string | undefined;
let port = 0;

async function identity() {
  const registry = JSON.parse(await readFile(path.join(root, 'sessions', `${process.ppid}.json`), 'utf8'));
  if (registry.pid !== process.ppid || typeof registry.sessionId !== 'string' || !registry.sessionId ||
    path.resolve(registry.cwd).toLowerCase() !== path.resolve(process.cwd()).toLowerCase())
    throw new Error('Channel parent PID/cwd does not match the native Claude registry');
  process.kill(process.ppid, 0);
  if (boundSession && boundSession !== registry.sessionId) throw new Error('Native Claude session changed; reconnect the MCP channel');
  return registry.sessionId as string;
}
function append(text: string) {
  if (output.length + text.length + 1 > 256000) truncated = true;
  output = (output + text + '\n').slice(-256000);
}
const mcp = new Server({ name: 'agent-board', version: '0.1.0' }, {
  capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }, tools: {} },
  instructions: 'Messages from agent-board are sent by the local user. Reply using the reply tool with the message request_id. Native transcript remains the complete history. A reply acknowledges receipt; do not claim work completed unless it is complete.',
});
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'reply',
  description: 'Reply to a local Agent Board channel message.',
  inputSchema: { type: 'object', properties: { request_id: { type: 'string' }, text: { type: 'string' } }, required: ['request_id', 'text'], additionalProperties: false } }] }));
mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const args = params.arguments;
  if (params.name !== 'reply' || typeof args?.text !== 'string' || args.text.length > 32000 ||
    typeof args.request_id !== 'string' || !receipts.has(args.request_id))
    return { isError: true, content: [{ type: 'text', text: 'Unknown message or invalid reply' }] };
  append(args.text);
  awaitingReply.delete(args.request_id);
  return { content: [{ type: 'text', text: 'Reply delivered to Agent Board' }] };
});
mcp.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel/permission_request'), params: z.object({
  request_id: z.string(), tool_name: z.string(), description: z.string(), input_preview: z.string(),
}) }), async ({ params }) => {
  if (pending.size >= 16) { append('审批数量超过上限，请在原客户端处理。'); return; }
  const detail = `${params.description}\n${params.input_preview}`;
  if (detail.length > 16000 || params.tool_name.length > 200) { append('审批内容过长，请在原客户端查看完整内容并处理。'); return; }
  pending.set(params.request_id, { id: params.request_id, kind: 'approval', title: params.tool_name,
    detail, expires: Date.now() + 5 * 60_000 });
});
mcp.oninitialized = () => { initialized = true; };

const http = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    guard(req, port);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(403, 'Invalid channel token');
    if (!initialized || !boundSession || await identity() !== boundSession) throw new HttpError(409, 'Channel session unavailable');
    for (const [id, request] of pending) if (request.expires < Date.now()) pending.delete(id);
    if (req.method === 'POST') {
      const body = await jsonBody(req);
      if (body.epoch !== epoch || body.sessionId !== boundSession) throw new HttpError(409, 'Channel connection changed');
      if (req.url === '/send') {
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 32000 ||
          typeof body.requestId !== 'string' || !/^[\w-]{1,100}$/.test(body.requestId)) throw new HttpError(400, 'Invalid message');
        const previous = receipts.get(body.requestId);
        if (previous !== undefined && previous.text !== body.text) throw new HttpError(409, 'Request ID already used');
        if (previous?.error) throw new HttpError(409, previous.error);
        if (previous === undefined) {
          if (receipts.size >= 256) throw new HttpError(409, 'Channel request limit reached; reconnect MCP');
          // Record before transport write. Never replay an uncertain notification.
          const receipt: { text: string; error?: string } = { text: body.text };
          receipts.set(body.requestId, receipt);
          awaitingReply.add(body.requestId);
          try {
            await mcp.notification({ method: 'notifications/claude/channel', params: { content: body.text, meta: { request_id: body.requestId } } });
          } catch {
            receipt.error = 'Channel write failed; delivery uncertain, not replayed';
            throw new HttpError(409, receipt.error);
          }
        }
      } else if (req.url === '/decision') {
        if (typeof body.id !== 'string' || !pending.has(body.id)) throw new HttpError(409, 'Permission expired or already relayed');
        if (body.decision !== 'allow' && body.decision !== 'deny') throw new HttpError(400, 'Invalid decision');
        pending.delete(body.id);
        await mcp.notification({ method: 'notifications/claude/channel/permission', params: { request_id: body.id, behavior: body.decision } });
        append('审批答复已转交原客户端；若原客户端已处理，此答复会被忽略。');
      } else throw new HttpError(404, 'Unknown channel operation');
    } else if (req.method !== 'GET' || req.url !== '/state') throw new HttpError(404, 'Unknown channel operation');
    res.end(JSON.stringify({ epoch, sessionId: boundSession, queued: awaitingReply.size > 0, output, truncated, pending: [...pending.values()].map(({ expires, ...r }) => r) }));
  } catch (error) {
    res.statusCode = error instanceof HttpError ? error.status : 409;
    res.end(JSON.stringify({ error: error instanceof HttpError ? error.message : 'Channel session identity unavailable' }));
  }
});
await mcp.connect(new StdioServerTransport());
await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
port = (http.address() as { port: number }).port;
await mkdir(directory, { recursive: true, mode: 0o700 });
async function publish() {
  try {
    if (!initialized) return;
    const sessionId = await identity();
    boundSession = sessionId;
    descriptor = path.join(directory, `${process.pid}.json`);
    const staging = descriptor + '.writing';
    await writeFile(staging, JSON.stringify({ pid: process.pid, parentPid: process.ppid, sessionId, port, token, epoch }), { mode: 0o600 });
    await rename(staging, descriptor);
  } catch {
    if (descriptor) await unlink(descriptor).catch(() => {});
    // No project/title-based fallback when a native PID binding is unavailable.
  }
}
await publish();
const interval = setInterval(() => void publish(), 3000);
let closing = false;
async function close() {
  if (closing) return;
  closing = true; clearInterval(interval);
  http.close();
  if (descriptor) await unlink(descriptor).catch(() => {});
  await mcp.close();
  process.exit(0);
}
mcp.onclose = () => { void close(); };
process.stdin.on('end', () => void close());
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
