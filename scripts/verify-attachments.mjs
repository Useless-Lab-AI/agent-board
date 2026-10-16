import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-board-att-test-'));
const codex = path.join(root, 'codex');
const claude = path.join(root, 'claude');
const antigravity = path.join(root, 'antigravity');
const dataDir = path.join(root, 'data');
await fs.mkdir(path.join(codex, 'sessions'), { recursive: true });
await fs.mkdir(path.join(claude, 'projects', 'test'), { recursive: true });
await fs.mkdir(path.join(antigravity, 'brain'), { recursive: true });

const line = (v) => JSON.stringify(v) + '\n';
const codexFile = path.join(codex, 'sessions', 'test-session.jsonl');
await fs.writeFile(
  codexFile,
  line({ type: 'session_meta', payload: { id: 'test-codex', cwd: root, timestamp: '2026-10-13T00:00:00Z' } }),
);

const env = {
  ...process.env,
  AGENT_BOARD_CODEX_HOME: codex,
  AGENT_BOARD_CLAUDE_HOME: claude,
  AGENT_BOARD_ANTIGRAVITY_HOME: antigravity,
  AGENT_BOARD_DATA: dataDir,
  AGENT_BOARD_PORT: '4319',
};

let child;
const base = 'http://127.0.0.1:4319';

async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/api.ts'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  child.stderr?.on('data', (b) => (log += b));
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Service failed to start: ' + log);
    try {
      const r = await fetch(base + '/api/sessions');
      if (r.ok && !(await r.json()).initializing) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Service timeout: ' + log);
}

async function stop() {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}

try {
  await start();
  console.log('1. Fetching session list...');
  const sessionsRes = await fetch(base + '/api/sessions');
  assert.equal(sessionsRes.status, 200);
  const { sessions } = await sessionsRes.json();
  const testSession = sessions.find((s) => s.provider === 'codex');
  assert.ok(testSession, 'Codex session should be discovered');

  console.log('2. Testing attachment upload (PNG image)...');
  // Small 1x1 transparent PNG in base64
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const uploadRes = await fetch(`${base}/api/sessions/${testSession.id}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Board': '1',
    },
    body: JSON.stringify({
      name: 'screenshot-test.png',
      mimeType: 'image/png',
      data: pngBase64,
    }),
  });
  assert.equal(uploadRes.status, 200);
  const attachment = await uploadRes.json();
  assert.equal(attachment.name, 'screenshot-test.png');
  assert.equal(attachment.mimeType, 'image/png');
  assert.ok(attachment.localPath && attachment.localPath.includes('screenshot-test.png'));
  assert.ok(attachment.url.startsWith(`/api/sessions/${testSession.id}/attachments/`));

  console.log('3. Verifying local file exists on disk...');
  const fileStat = await fs.stat(attachment.localPath);
  assert.ok(fileStat.size > 0);

  console.log('4. Testing GET attachment file...');
  const getFileRes = await fetch(`${base}${attachment.url}`);
  assert.equal(getFileRes.status, 200);
  assert.equal(getFileRes.headers.get('content-type'), 'image/png');
  const fileBuf = Buffer.from(await getFileRes.arrayBuffer());
  assert.equal(fileBuf.toString('base64'), pngBase64);

  console.log('5. Testing path traversal protection...');
  const badPathRes = await fetch(`${base}/api/sessions/${testSession.id}/attachments/%2e%2e%2f%2e%2e%2fpackage.json`);
  assert.equal(badPathRes.status, 403, 'Path traversal must be forbidden with 403');

  console.log('6. Testing DELETE attachment...');
  const deleteRes = await fetch(`${base}/api/sessions/${testSession.id}/attachments/${encodeURIComponent(attachment.id)}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 200);
  const existsAfterDelete = await fs.stat(attachment.localPath).then(() => true).catch(() => false);
  assert.equal(existsAfterDelete, false, 'File must be deleted from disk');

  console.log('6.1 Testing draft attachment upload (/api/draft/attachments)...');
  const draftUploadRes = await fetch(`${base}/api/draft/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Board': '1',
    },
    body: JSON.stringify({
      name: 'draft-screenshot.png',
      mimeType: 'image/png',
      data: pngBase64,
    }),
  });
  assert.equal(draftUploadRes.status, 200);
  const draftAttachment = await draftUploadRes.json();
  assert.equal(draftAttachment.name, 'draft-screenshot.png');
  assert.ok(draftAttachment.localPath && draftAttachment.localPath.includes('draft'));
  assert.ok(draftAttachment.url.startsWith('/api/draft/attachments/'));

  console.log('6.2 Testing GET draft attachment file...');
  const getDraftRes = await fetch(`${base}${draftAttachment.url}`);
  assert.equal(getDraftRes.status, 200);
  assert.equal(getDraftRes.headers.get('content-type'), 'image/png');

  console.log('6.3 Testing DELETE draft attachment...');
  const deleteDraftRes = await fetch(`${base}${draftAttachment.url}`, {
    method: 'DELETE',
  });
  assert.equal(deleteDraftRes.status, 200);
  const draftExistsAfterDelete = await fs.stat(draftAttachment.localPath).then(() => true).catch(() => false);
  assert.equal(draftExistsAfterDelete, false, 'Draft file must be deleted from disk');

  console.log('7. Testing Interactions multimodal prompt formatting logic...');
  const { Interactions } = await import('../dist/server/interaction.js');
  let sentPrompt = '';
  const mockClient = {
    refresh: async () => ({ epoch: 'ep-1', phase: 'READY', reason: 'ready', pending: [], canSend: true, canInterrupt: false }),
    send: async (text) => { sentPrompt = text; },
    decision: async () => {},
    interrupt: async () => {},
    close: async () => {},
  };
  const mockInteractions = new Interactions(codex, claude, () => {}, antigravity);
  // Inject mock entry
  const dummySession = { id: 'dummy-id', nativeId: 'dummy-native', provider: 'codex', cwd: root, files: [] };
  const view = await mockInteractions.view(dummySession);
  // Replace the created client with mockClient for testing prompt construction
  const entry = mockInteractions.entries.get('dummy-id');
  entry.client = mockClient;
  entry.view.canSend = true;
  entry.view.connected = true;
  entry.view.runtimeEpoch = 'ep-1';

  // Send message with image and document attachments
  await mockInteractions.send(dummySession, {
    text: '请帮我看一下这个界面和配置文件',
    requestId: 'req-1',
    serviceEpoch: mockInteractions.epoch,
    runtimeEpoch: 'ep-1',
    attachments: [
      {
        id: 'att-1',
        name: 'ui-bug.png',
        size: 10240,
        mimeType: 'image/png',
        localPath: 'C:\\Users\\test\\ui-bug.png',
        url: '/api/sessions/dummy/attachments/att-1',
      },
      {
        id: 'att-2',
        name: 'config.json',
        size: 2048,
        mimeType: 'application/json',
        localPath: 'C:\\Users\\test\\config.json',
        url: '/api/sessions/dummy/attachments/att-2',
      },
    ],
  });

  assert.ok(sentPrompt.includes('请帮我看一下这个界面和配置文件'), 'Prompt should include user text');
  assert.ok(sentPrompt.includes('[Image: C:\\Users\\test\\ui-bug.png]'), 'Prompt should include Claude Code CLI image chip');
  assert.ok(sentPrompt.includes('file:///C:/Users/test/ui-bug.png'), 'Prompt should include markdown image link');
  assert.ok(sentPrompt.includes('[config.json](file:///C:/Users/test/config.json)'), 'Prompt should include markdown file link');
  assert.ok(sentPrompt.includes('2.0 KB'), 'Prompt should include formatted file size');
  console.log('PASS prompt format:\n' + sentPrompt);

  console.log('ALL ATTACHMENT ENDPOINT AND PROMPT TESTS PASSED!');
  await mockInteractions.close();
} finally {
  await stop();
  process.exit(0);
}
