// Integration through a real named pipe, MCP stdio and HTTP, using SYNTHETIC peers.
// Does not send input to an actual user's Codex or Claude session.
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { CodexClient } from '../dist/server/codex-client.js';
const portProbe = net.createServer();
await new Promise((resolve, reject) => { portProbe.once('error', () => reject(new Error('Port 4321 is occupied; stop the previous isolated fixture before verification'))); portProbe.listen(4321, '127.0.0.1', resolve); });
await new Promise(resolve => portProbe.close(resolve));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-board-channel-proof-'));
const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\agent-board-proof-${randomUUID()}` : path.join(root, 'ipc.sock');
let native = { id: 'synthetic-codex-live', requests: [], threadRuntimeStatus: { type: 'idle' }, turns: [] };
let writes = [];
const sockets = new Set();
const ipc = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  let buffer = Buffer.alloc(0);
  const send = m => { const data = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(4); h.writeUInt32LE(data.length); socket.write(Buffer.concat([h, data])); };
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(); if (buffer.length < size + 4) break;
      const m = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
      if (m.method === 'thread-stream-following-changed' && m.params.following) {
        send({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'synthetic-owner',
          params: { hostId: 'local', conversationId: native.id, change: { type: 'snapshot', revision: 1, conversationState: native } } });
      }
      if (m.type !== 'request') continue;
      let result = {};
      if (m.method === 'initialize') result = { clientId: 'synthetic-follower' };
      else if (m.method === 'thread-owner-discovery') result = { supportsUntrustedAppInput: true };
      else {
        writes.push(m);
        if (m.method === 'thread-follower-start-turn') { native.threadRuntimeStatus.type = 'active'; native.turns = [{ turnId: 'synthetic-turn', status: 'inProgress' }]; }
        else if (m.method === 'thread-follower-interrupt-turn') native.threadRuntimeStatus.type = 'idle';
        else native.requests = [];
      }
      send({ type: 'response', requestId: m.requestId, method: m.method, resultType: 'success', handledByClientId: 'synthetic-owner', result });
    }
  });
});
await new Promise(resolve => ipc.listen(socketPath, resolve));
const c = new CodexClient({ id: 'synthetic', nativeId: native.id, provider: 'codex', cwd: root, files: [], diagnostics: [] }, socketPath);
let app;
const claude = path.join(root, 'claude');
const mcp = new Client({ name: 'synthetic-claude-channel-proof', version: '1.0.0' });
try {
  assert.equal((await c.refresh()).canSend, true);
  await c.send('Synthetic message', 'synthetic-send');
  assert.equal(writes[0].version, 2);
  assert.deepEqual(writes[0].params.turnStart.request.input, [{ type: 'text', text: 'Synthetic message', text_elements: [] }]);
  let state = await c.refresh(); assert.equal(state.phase, 'RUNNING'); assert.equal(state.canInterrupt, true);
  await c.interrupt(); assert.equal(writes.at(-1).params.expectedTurnId, 'synthetic-turn');
  native.requests = [{ id: 123, method: 'item/commandExecution/requestApproval', params: { command: 'echo synthetic' } }];
  state = await c.refresh(); assert.equal(state.pending[0].id, '123');
  await c.decision('123', { decision: 'deny' }); assert.equal(writes.at(-1).params.decision, 'decline');
  assert.equal(writes.at(-1).params.requestId, 123);
  native.requests = [{ id: 'question', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'answer', question: 'Synthetic?', options: [] }] } }];
  await c.refresh(); await c.decision('question', { answers: { answer: 'yes' } });
  assert.deepEqual(writes.at(-1).params.response, { answers: { answer: { answers: ['yes'] } } });
  await c.refresh(); await assert.rejects(() => c.decision('question', {}), /过期/);
  for (const socket of sockets) socket.destroy();
  await assert.rejects(() => c.refresh());
  await c.close();
  console.log('PASS synthetic Codex socket: send, state, approval, answers, turn-specific stop, stale request, disconnect');

  await fs.mkdir(path.join(claude, 'sessions'), { recursive: true });
  await fs.mkdir(path.join(claude, 'projects', 'synthetic'), { recursive: true });
  const sessionId = randomUUID();
  await fs.writeFile(path.join(claude, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd: root }));
  await fs.writeFile(path.join(claude, 'projects', 'synthetic', 'session.jsonl'), JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId, cwd: root, message: { content: 'Synthetic channel acceptance' } }) + '\n');
  const notifications = [];
  mcp.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel'), params: z.any() }), n => { notifications.push(n); });
  mcp.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel/permission'), params: z.any() }), n => { notifications.push(n); });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/server/claude-channel.js')], cwd: root,
    env: { ...process.env, AGENT_BOARD_CLAUDE_HOME: claude }, stderr: 'pipe' }));
  assert.ok(mcp.getServerCapabilities().experimental['claude/channel']);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  let descriptor;
  for (let i = 0; i < 40 && !descriptor; i++) {
    const names = await fs.readdir(path.join(claude, 'agent-board-channels')).catch(() => []);
    if (names.find(n => n.endsWith('.json'))) descriptor = JSON.parse(await fs.readFile(path.join(claude, 'agent-board-channels', names.find(n => n.endsWith('.json'))), 'utf8'));
    if (!descriptor) await pause(150);
  }
  assert.ok(descriptor, 'MCP initialized channel must publish native PID binding');
  assert.equal((await fetch(`http://127.0.0.1:${descriptor.port}/state`)).status, 403);
  app = spawn(process.execPath, ['dist/server/api.js'], { cwd: process.cwd(), env: { ...process.env, AGENT_BOARD_PORT: '4321',
    AGENT_BOARD_CODEX_HOME: path.join(root, 'codex'), AGENT_BOARD_CLAUDE_HOME: claude, AGENT_BOARD_DATA: path.join(root, 'data') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let appLog = '';
  app.stdout.on('data', b => { appLog += b; }); app.stderr.on('data', b => { appLog += b; });
  let sessions;
  for (let i = 0; i < 50; i++) {
    if (app.exitCode !== null) throw new Error(`Isolated board exited: ${appLog}`);
    try { sessions = (await (await fetch('http://127.0.0.1:4321/api/sessions')).json()).sessions; if (sessions?.length) break; } catch {}
    await pause(100);
  }
  assert.equal(sessions.length, 1);
  const url = `http://127.0.0.1:4321/api/sessions/${sessions[0].id}/interaction`;
  const get = async () => (await fetch(url)).json();
  const post = async (action, body) => { const r = await fetch(url + '/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-board': '1' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const v = await get(); assert.equal(v.connected, true); assert.equal(v.canInterrupt, false);
  const send = { serviceEpoch: v.serviceEpoch, runtimeEpoch: v.runtimeEpoch, text: 'Synthetic channel message', requestId: randomUUID() };
  const sent = await post('send', send); assert.equal(sent.status, 200); assert.equal(sent.body.phase, 'QUEUED');
  assert.equal((await post('send', send)).status, 200);
  await pause(100); assert.equal(notifications.filter(n => n.method === 'notifications/claude/channel').length, 1);
  assert.equal((await post('send', { ...send, text: 'different' })).status, 409);
  assert.equal((await post('send', { ...send, requestId: randomUUID(), runtimeEpoch: 'stale' })).status, 409);
  await mcp.callTool({ name: 'reply', arguments: { request_id: send.requestId, text: 'Synthetic reply received' } });
  assert.match((await get()).output, /Synthetic reply/);
  const firstQueued = { ...send, requestId: randomUUID(), text: 'Synthetic queued one' };
  const secondQueued = { ...send, requestId: randomUUID(), text: 'Synthetic queued two' };
  assert.equal((await post('send', firstQueued)).status, 200);
  assert.equal((await post('send', secondQueued)).status, 200);
  await mcp.callTool({ name: 'reply', arguments: { request_id: firstQueued.requestId, text: 'Synthetic first receipt' } });
  assert.equal((await get()).phase, 'QUEUED', 'One reply must not acknowledge a different message');
  await mcp.callTool({ name: 'reply', arguments: { request_id: secondQueued.requestId, text: 'Synthetic second receipt' } });
  assert.equal((await get()).phase, 'READY');
  await mcp.notification({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'large', tool_name: 'Bash', description: 'Synthetic oversized approval', input_preview: 'x'.repeat(17000) } });
  await pause(100);
  assert.equal((await get()).pending.length, 0, 'Do not allow truncated approval');
  await mcp.notification({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'abcde', tool_name: 'Bash', description: 'Synthetic approval', input_preview: 'echo synthetic' } });
  await pause(100);
  assert.equal((await get()).pending[0].id, 'abcde');
  const decision = { serviceEpoch: v.serviceEpoch, runtimeEpoch: v.runtimeEpoch, providerRequestId: 'abcde', decision: 'deny' };
  assert.equal((await post('decision', decision)).status, 200);
  assert.equal((await post('decision', decision)).status, 409);
  assert.equal(notifications.at(-1).params.behavior, 'deny');
  assert.equal((await post('interrupt', { serviceEpoch: v.serviceEpoch, runtimeEpoch: v.runtimeEpoch })).status, 409);
  if (process.argv.includes('--serve')) {
    console.log('SYNTHETIC browser fixture http://127.0.0.1:4321 ; original clients are not involved');
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
  await fs.writeFile(path.join(claude, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: randomUUID(), cwd: root }));
  assert.equal((await get()).connected, false);
  assert.equal((await post('send', { ...send, requestId: randomUUID() })).status, 409);
  console.log('PASS synthetic MCP + board HTTP: native-ID binding, auth, transport receipt, reply, dedup, epochs, approval, unsupported stop, changed identity');
  console.log('No native model prompts or real permission decisions were sent.');
} finally {
  await c.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => ipc.close(r));
  if (app?.connected) app.disconnect();
  await mcp.close();
}
