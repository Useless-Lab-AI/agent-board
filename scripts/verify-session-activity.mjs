// HTTP integration through real files/server; all conversations below are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-board-activity-'));
const codex = path.join(root, 'codex');
const claude = path.join(root, 'claude');
await fs.mkdir(path.join(codex, 'sessions'), { recursive: true });
await fs.mkdir(path.join(codex, 'archived_sessions'));
await fs.mkdir(path.join(claude, 'projects', 'synthetic'), { recursive: true });
const file = path.join(codex, 'sessions', 'one.jsonl');
const cf = path.join(claude, 'projects', 'synthetic', 'one.jsonl');
const line = record => JSON.stringify(record) + '\n';
const output = (text, role = 'assistant') => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: 'output_text', text }] } });
const meta = line({ type: 'session_meta', payload: { id: 'activity-codex', cwd: '/synthetic' } });
const initial = meta + Array.from({ length: 30 }, (_, i) => line(output(`合成历史 ${i}\n${'阅读位置保持不变。\n'.repeat(20)}`))).join('');
await fs.writeFile(file, initial);
await fs.writeFile(cf, line({ type: 'user', sessionId: 'activity-claude', cwd: '/synthetic', message: { content: '合成消息' } }));
await fs.writeFile(path.join(codex, 'session_index.jsonl'), line({ id: 'activity-codex', thread_name: '活动状态合成验收' }));
const base = 'http://127.0.0.1:4318';
const pause = ms => new Promise(r => setTimeout(r, ms));
let child;
const get = async url => { const r = await fetch(base + url); assert.equal(r.status, 200); return r.json(); };
const list = () => get('/api/sessions?archive=all');
const find = (data, provider = 'codex') => data.sessions.find(s => s.provider === provider);
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const data = await list(); if (predicate(data)) return data; await pause(150); }
  throw new Error('Activity HTTP condition timed out');
}
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/api.ts'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AGENT_BOARD_CODEX_HOME: codex, AGENT_BOARD_CLAUDE_HOME: claude, AGENT_BOARD_DATA: path.join(root, 'data'), AGENT_BOARD_PORT: '4318' } });
  let error = ''; child.stderr.on('data', b => error += b);
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(error); try { const r = await list(); if (!r.initializing) return r; } catch {} await pause(100); }
  throw new Error('Service failed to initialize');
}
async function stop() { if (child?.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } }
const append = record => fs.appendFile(file, line(record));
try {
  let data = await start();
  assert.equal(find(data).activity, undefined, 'History import is not live activity');
  if (process.argv.includes('--serve')) { console.log('SYNTHETIC_BROWSER_READY ' + JSON.stringify({ root, file, base })); await new Promise(() => {}); }
  await append(output('新出现的 AI 输出'));
  await until(r => find(r).revision !== find(data).revision);
  data = await list();
  assert.equal(find(data).activity?.label, '近期有输出', 'Fresh assistant output must update observed activity');
  const firstTime = find(data).activity.observedAt;
  assert.equal(find(data).execution, 'UNKNOWN', 'Do not fabricate proven RUNNING');
  await append({ type: 'response_item', payload: { type: 'function_call', name: 'synthetic_tool', arguments: '{}' } });
  data = await until(r => find(r).activity?.observedAt > firstTime);
  const cx = find(data);
  const snapshot = await get(`/api/sessions/${cx.id}/events`);
  const post = async action => { const r = await fetch(`${base}/api/sessions/${cx.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Board': '1' }, body: JSON.stringify({ cursor: snapshot.snapshotCursor }) }); assert.equal(r.status, 200); };
  await post('read'); await post('archive');
  const beforeExpiry = find(await list());
  const stream = await fetch(base + '/api/events'); const reader = stream.body.getReader(); await reader.read();
  const expired = await until(r => find(r).activity?.label === '暂未更新', 35000);
  const signal = await Promise.race([reader.read(), pause(2000).then(() => { throw new Error('No expiry SSE'); })]);
  assert.match(new TextDecoder().decode(signal.value), /event: change/); await reader.cancel();
  for (const key of ['revision', 'order', 'attention', 'archived']) assert.equal(find(expired)[key], beforeExpiry[key], `Expiry preserves ${key}`);
  assert.equal(find(expired).execution, 'UNKNOWN', 'Silence is not completion');
  console.log('PASS activity: append, refreshed window, 30s quiet expiry/SSE, preserved execution/read/archive/revision');
  for (const terminal of ['task_complete', 'turn_aborted']) {
    await append({ type: 'event_msg', payload: { type: terminal } });
    await until(r => find(r).execution === (terminal === 'task_complete' ? 'COMPLETED' : 'FAILED'));
    await append(output('新回合 AI 输出'));
    await until(r => find(r).execution === 'UNKNOWN' && find(r).activity?.label === '近期有输出');
  }
  await fs.appendFile(cf, line({ type: 'assistant', sessionId: 'activity-claude', message: { content: [{ type: 'tool_use', name: 'synthetic', input: {} }] } }));
  await until(r => find(r, 'claude').activity?.label === '近期有输出');
  await fs.appendFile(cf, line({ type: 'assistant', sessionId: 'activity-claude', message: { content: [{ type: 'text', text: '完成' }], stop_reason: 'end_turn' } }));
  await until(r => find(r, 'claude').execution === 'COMPLETED');
  const sourceBytes = await fs.readFile(file);
  await stop(); data = await start();
  assert.equal(find(data).activity, undefined, 'Restart history is not activity');
  assert.deepEqual(await fs.readFile(file), sourceBytes, 'Observer never writes native sources');
  await append(output('用户新消息', 'user'));
  await append({ type: 'event_msg', payload: { type: 'token_count' } });
  await fs.utimes(file, new Date(), new Date());
  await fs.appendFile(path.join(codex, 'session_index.jsonl'), line({ id: 'activity-codex', thread_name: '名称改变不是输出' }));
  await until(r => find(r).title === '名称改变不是输出');
  assert.equal(find(await list()).activity, undefined);
  await fs.appendFile(file, JSON.stringify(output('部分行'))); await pause(2400);
  assert.equal(find(await list()).activity, undefined);
  await fs.appendFile(file, '\n'); await until(r => find(r).activity?.label === '近期有输出');
  await fs.writeFile(file, meta + line(output('替换后的历史')));
  await until(r => !find(r).activity);
  await fs.appendFile(file, '{invalid}\n' + line(output('x'.repeat(300000)))); await pause(2400);
  assert.equal(find(await list()).activity, undefined, 'Malformed/oversize notices are not AI activity');
  await fs.writeFile(path.join(codex, 'sessions', 'segment.jsonl'), meta + line(output('新分段历史')));
  await until(r => find(r).segments === 2);
  assert.equal(find(await list()).activity, undefined);
  await append(output('多分段中新的输出'));
  data = await until(r => find(r).activity?.label === '近期有输出');
  assert.equal(find(data).execution, 'UNKNOWN');
  await fs.unlink(path.join(codex, 'sessions', 'segment.jsonl'));
  await stop();
  const catchup = Array.from({ length: 150 }, () => line(output('历史补读'.repeat(4000)))).join('');
  await fs.appendFile(file, catchup);
  await start(); await pause(8000);
  assert.equal(find(await list()).activity, undefined, 'Restart catchup beyond 2MiB remains historical');
  await stop();
  await fs.writeFile(file, meta + JSON.stringify(output('导入时的未完整行')));
  await start(); await fs.appendFile(file, '\n'); await pause(2400);
  assert.equal(find(await list()).activity, undefined, 'Completing imported fragment is not fresh activity');
  await append({ type: 'response_item', payload: { type: 'function_call_output', output: '新工具结果' } });
  await until(r => find(r).activity?.label === '近期有输出');
  await fs.unlink(file); await until(r => !find(r).activity && find(r).diagnostics.some(x => x.includes('不可用')));
  console.log('PASS activity boundaries: terminal/new round, Claude, baseline/restart/catchup, partial/import/replacement, invalid/oversize, user/meta/mtime/title, multi-segment, unavailable source');
} finally { await stop(); console.log('Synthetic fixture:', root); }
