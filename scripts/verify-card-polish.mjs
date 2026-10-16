// Real HTTP integration with synthetic native files only; no unit tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-board-polish-'));
const codex = path.join(root, 'codex');
const claude = path.join(root, 'claude');
const project = path.join(claude, 'projects', 'synthetic');
await fs.mkdir(path.join(codex, 'sessions'), { recursive: true });
await fs.mkdir(path.join(codex, 'archived_sessions'));
await fs.mkdir(project, { recursive: true });
const line = value => JSON.stringify(value) + '\n';
const message = text => line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
for (let i = 0; i < 26; i++) {
  const id = `synthetic-${i}`;
  const body = Array.from({ length: 125 }, (_, n) => message(`### 合成记录 ${n}\n\n${'独立阅读与原生会话。'.repeat(12)}\n\n\`\`\`text\n${'工具输出\n'.repeat(12)}\`\`\``)).join('');
  await fs.writeFile(path.join(codex, 'sessions', `${i}.jsonl`), line({ type: 'session_meta', payload: { id, cwd: '/synthetic', ...(i === 25 ? { title: '元信息中的名称' } : {}) } }) + body);
}
await fs.writeFile(path.join(project, 'one.jsonl'), line({ type: 'user', sessionId: 'synthetic-0', cwd: '/synthetic', message: { content: '合成 Claude 内容' } }));
const index = path.join(codex, 'session_index.jsonl');
const claudeIndex = path.join(project, 'sessions-index.json');
const indexText = Array.from({ length: 24 }, (_, i) => line({ id: `synthetic-${i}`, thread_name: `合成会话名称 ${i}`, updated_at: '2026-10-11T00:00:00Z' })).join('');
await fs.writeFile(index, indexText);
await fs.writeFile(claudeIndex, JSON.stringify({ entries: [{ sessionId: 'synthetic-0', summary: 'Claude 原生名称', firstPrompt: '不可用作名称', fullPath: path.join(root, 'DO-NOT-FOLLOW') }] }));
const base = 'http://127.0.0.1:4318';
const child = spawn(process.execPath, ['--import', 'tsx', 'server/api.ts'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AGENT_BOARD_CODEX_HOME: codex, AGENT_BOARD_CLAUDE_HOME: claude, AGENT_BOARD_DATA: path.join(root, 'data'), AGENT_BOARD_PORT: '4318' } });
let errors = '';
child.stderr.on('data', b => errors += b);
const get = async url => { const r = await fetch(base + url); assert.equal(r.status, 200); return r.json(); };
const until = async predicate => {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(errors);
    try { const result = await get('/api/sessions?pageSize=100&archive=all'); if (!result.initializing && predicate(result)) return result; } catch (e) { if (i === 99) throw e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Expected HTTP state not reached');
};
try {
  const all = await until(r => r.total === 27);
  if (process.argv.includes('--serve')) {
    console.log('SYNTHETIC_BROWSER_READY ' + JSON.stringify({ root, base }));
    await new Promise(() => {});
  }
  const cx = r => r.sessions.find(s => s.provider === 'codex' && s.nativeId === 'synthetic-0');
  assert.equal(cx(all).title, '合成会话名称 0', 'Native title must replace directory name');
  assert.equal(all.sessions.find(s => s.provider === 'claude').title, 'Claude 原生名称');
  assert.match(all.sessions.find(s => s.nativeId === 'synthetic-24').title, /^未命名会话/);
  assert.equal(all.sessions.find(s => s.nativeId === 'synthetic-25').title, '元信息中的名称');
  const first = await get('/api/sessions');
  assert.equal(first.sessions.length, 12);
  const second = await get('/api/sessions?cursor=' + encodeURIComponent(first.nextCursor));
  assert.equal(second.sessions.length, 12);
  assert.equal(new Set([...first.sessions, ...second.sessions].map(s => s.id)).size, 24);
  const original = cx(all);
  const page = await get(`/api/sessions/${original.id}/events`);
  for (const action of ['read', 'archive']) {
    const response = await fetch(`${base}/api/sessions/${original.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Board': '1' }, body: JSON.stringify({ cursor: page.snapshotCursor }) });
    assert.equal(response.status, 200);
  }
  const archived = cx(await get('/api/sessions?archive=all&pageSize=100'));
  const sse = await fetch(base + '/api/events');
  const reader = sse.body.getReader();
  await reader.read();
  await fs.appendFile(index, line({ id: 'synthetic-0', thread_name: '重命名后的会话' }));
  const renamed = cx(await until(r => cx(r).title === '重命名后的会话'));
  const signal = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('Missing title SSE')), 6000))]);
  assert.match(new TextDecoder().decode(signal.value), /event: change/);
  await reader.cancel();
  for (const field of ['order', 'attention', 'archived', 'revision']) assert.equal(renamed[field], archived[field], `Title-only preserves ${field}`);
  await fs.appendFile(index, JSON.stringify({ id: 'synthetic-0', thread_name: '完整行后才生效' }));
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(cx(await get('/api/sessions?archive=all&pageSize=100')).title, '重命名后的会话');
  await fs.appendFile(index, '\n');
  await until(r => cx(r).title === '完整行后才生效');
  for (const content of ['{broken}\n', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    await fs.writeFile(index, content);
    await until(r => /^未命名会话/.test(cx(r).title) && cx(r).diagnostics.some(d => /名称/.test(d)));
  }
  await fs.unlink(index);
  const external = path.join(root, 'outside');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'session_index.jsonl'), line({ id: 'synthetic-0', thread_name: '禁止越界' }));
  // Windows junctions need no symbolic-link privilege and exercise the same rejection.
  await fs.symlink(external, index, 'junction');
  await new Promise(r => setTimeout(r, 2500));
  assert.match(cx(await get('/api/sessions?archive=all&pageSize=100')).title, /^未命名会话/);
  await fs.unlink(index);
  await until(r => cx(r).diagnostics.some(d => /名称/.test(d)));
  await fs.writeFile(index, indexText);
  await until(r => cx(r).title === '合成会话名称 0');
  await fs.writeFile(claudeIndex, JSON.stringify({ entries: [{ sessionId: 'synthetic-0', firstPrompt: '禁止用第一句冒充名称' }] }));
  await until(r => /^未命名会话/.test(r.sessions.find(s => s.provider === 'claude').title));
  console.log('PASS card polish HTTP: titles, provider identity, metadata fallback, missing/malformed/oversize/symlink index, partial line, rename SSE, read/archive/order invariance, 12+12 pagination');
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(r => child.once('exit', r));
}
