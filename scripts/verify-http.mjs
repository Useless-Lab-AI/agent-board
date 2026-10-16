// HTTP integration against isolated synthetic native files; no unit tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-board-synthetic-'));
const codex = path.join(root, 'codex');
const claude = path.join(root, 'claude');
const antigravity = path.join(root, 'antigravity');
await fs.mkdir(path.join(codex, 'sessions'), { recursive: true });
await fs.mkdir(path.join(claude, 'projects', 'synthetic'), { recursive: true });
await fs.mkdir(path.join(antigravity, 'brain'), { recursive: true });
const line = value => JSON.stringify(value) + '\n';
const nativeFile = path.join(codex, 'sessions', 'one.jsonl');
await fs.writeFile(nativeFile, line({ type: 'session_meta', payload: { id: 'synthetic-codex', cwd: '/synthetic', timestamp: '2026-10-11T00:00:00Z' } }));
await fs.writeFile(path.join(codex, 'sessions', 'segment.jsonl'), line({ type: 'session_meta', payload: { id: 'synthetic-codex', cwd: '/synthetic' } }));
await fs.writeFile(path.join(claude, 'projects', 'synthetic', 'session.jsonl'), line({ type: 'user', sessionId: 'synthetic-claude', cwd: '/synthetic', message: { content: 'Synthetic hello' } }));
const external = path.join(root, 'external');
await fs.mkdir(external);
await fs.writeFile(path.join(external, 'escape.jsonl'), line({ type: 'session_meta', payload: { id: 'escaped' } }));
await fs.symlink(external, path.join(codex, 'sessions', 'escape'), 'junction');
const serve = process.argv[2] === '--serve';
if (serve) {
  await fs.unlink(path.join(codex,'sessions','segment.jsonl'));
  const message=(role,text)=>line({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
  await fs.appendFile(nativeFile,message('user','这是合成验收会话。请整理登录流程的实现进展。'));
  for(let i=0;i<15;i++) await fs.appendFile(nativeFile,message('assistant',`### 合成验收记录 ${i+1}\n已完成页面与接口的数据对接。\n\n- 会话保持原生 ID\n- 卡片位置保持不变\n- 新增输出自动更新\n\n\`\`\`typescript\nconst status = "verified";\n\`\`\`\n\n![blocked](https://example.invalid/image.png)\n<script>window.__unsafe=true</script>`));
  await fs.appendFile(nativeFile,line({type:'event_msg',payload:{type:'task_complete'}}));
  const third=path.join(codex,'sessions','third.jsonl');
  await fs.writeFile(third,line({type:'session_meta',payload:{id:'synthetic-tools',cwd:'/synthetic/读取与工具'}})+message('user','合成验收：检查工具输出能否在卡片内阅读。')+line({type:'response_item',payload:{type:'function_call',name:'读取文件',arguments:'{"path":"src/board.tsx"}'}})+line({type:'response_item',payload:{type:'function_call_output',output:'Synthetic tool output\n'+Array.from({length:24},(_,i)=>`第 ${i+1} 行 · 独立滚动的工具输出`).join('\n')}})+message('assistant','### 工具结果已读取\n这张卡片使用独立的滚动区域。'));
  const cf=path.join(claude,'projects','synthetic','session.jsonl');
  for(let i=0;i<12;i++)await fs.appendFile(cf,line({type:'assistant',sessionId:'synthetic-claude',uuid:`claude-${i}`,message:{content:[{type:'text',text:`### 合成会话 · 设计检查 ${i+1}\n网页使用固定宽度卡片自动换行。\n\n| 检查项 | 结果 |\n| --- | --- |\n| 卡片宽度 | 420 px |\n| 独立滚动 | 支持 |\n| 页面拖拽 | 不需要 |` }],stop_reason:'end_turn'}}));
}
const env = { ...process.env, AGENT_BOARD_CODEX_HOME: codex, AGENT_BOARD_CLAUDE_HOME: claude, AGENT_BOARD_ANTIGRAVITY_HOME: antigravity, AGENT_BOARD_DATA: path.join(root, 'data'), AGENT_BOARD_PORT: '4318' };
let child;
const base = 'http://127.0.0.1:4318';
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/api.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stderr.on('data', b => log += b);
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Service failed: ' + log);
    try { const r=await fetch(base+'/api/sessions');if(r.ok&&!(await r.json()).initializing)return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Service did not become ready: ' + log);
}
async function stop() { if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } }
const get = async url => { const r = await fetch(base + url); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
const wait = async predicate => { for (let i=0;i<60;i++) { const result=await predicate(); if(result) return result; await new Promise(r=>setTimeout(r,150)); } throw new Error('Condition timed out'); };
try {
  await start();
  const list = await wait(async () => {
    const l = await get('/api/sessions');
    return l.total === (serve ? 3 : 2) && l.sessions.find(x => x.provider === 'codex')?.segments === (serve ? 1 : 2) ? l : false;
  });
  assert.equal(list.total, serve?3:2, 'Group native IDs and reject symlink escape');
  assert.equal(list.sessions.find(x => x.provider === 'codex').segments, serve?1:2);
  assert.equal((await fetch(base + '/api/sessions', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => { const req=request(base+'/api/sessions',{headers:{Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);req.end(); });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(base + '/api/sessions/invalid/read', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/sessions/invalid/events')).status, 404);
  console.log('PASS discovery: identities, grouping, path containment, Host/Origin/write guards');
  if(serve){console.log('SYNTHETIC_BROWSER_READY '+JSON.stringify({root,url:base,nativeFile}));await new Promise(()=>{});}
  if (process.argv[2] !== 'discovery') {
    await fs.unlink(path.join(codex, 'sessions', 'segment.jsonl'));
    await new Promise(r=>setTimeout(r,2400));
    const id = list.sessions.find(x => x.provider === 'codex').id;
    const eventUrl = `/api/sessions/${id}/events`;
    const append = record => fs.appendFile(nativeFile, line(record));
    const output = (text, uuid) => ({ type: 'response_item', uuid, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
    await append({ type: 'event_msg', payload: { type: 'task_started' } });
    await append(output('**Synthetic** output with `code`', 'event-a'));
    let page = await wait(async () => { const p=await get(eventUrl); return p.items.some(x=>x.text.includes('Synthetic')) && p; });
    assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).execution, 'UNKNOWN');
    await fs.appendFile(nativeFile, JSON.stringify(output('Partial record', 'event-b')));
    await new Promise(r=>setTimeout(r,2400));
    assert.equal((await get(eventUrl)).items.some(x=>x.text==='Partial record'), false);
    await fs.appendFile(nativeFile, '\n');
    await wait(async()=> (await get(eventUrl)).items.some(x=>x.text==='Partial record'));
    await append({ type: 'event_msg', payload: { type: 'task_complete' } });
    await wait(async()=> (await get('/api/sessions')).sessions.find(x=>x.id===id).execution==='COMPLETED');
    await append({ type: 'event_msg', payload: { type: 'turn_aborted' } });
    await wait(async()=> (await get('/api/sessions')).sessions.find(x=>x.id===id).execution==='FAILED');
    await append(output('x'.repeat(300000), 'large'));
    await wait(async()=> (await get(eventUrl)).items.some(x=>x.text.includes('content truncated')));
    for(let i=0;i<120;i++) await append(output(`History ${i} `+'z'.repeat(20000),`history-${i}`));
    page = await wait(async()=> { const p=await get(eventUrl);return p.items.some(x=>x.text.startsWith('History 119')) && p; });
    assert.ok(page.nextCursor, 'Bounded page provides a continuation');
    const older = await get(eventUrl+'?cursor='+encodeURIComponent(page.nextCursor));
    assert.ok(older.items.length, 'History progresses');
    assert.ok(!older.items.some(x=>page.items.some(y=>y.id===x.id)), 'No page-boundary duplicates');
    const controller = new AbortController();
    const stream = await fetch(base+'/api/events',{signal:controller.signal});
    const reader = stream.body.getReader(); await reader.read();
    await append(output('SSE arrival', 'sse-arrival'));
    const notice = await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SSE timeout')),6000))]);
    assert.match(new TextDecoder().decode(notice.value), /change/);
    controller.abort();
    console.log('PASS events: partial records, lifecycle evidence, bounded history, oversize marker, SSE');
    if (['attention','all'].includes(process.argv[2])) {
      const post = async (action, body={}) => fetch(base+`/api/sessions/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Agent-Board':'1'},body:JSON.stringify(body)});
      page=await get(eventUrl);
      await append(output('Concurrent unseen output','unseen'));
      await wait(async()=> (await get(eventUrl)).items.some(x=>x.text==='Concurrent unseen output'));
      assert.equal((await post('read',{cursor:page.snapshotCursor})).status,200);
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).attention,'UNREAD_OUTPUT');
      const latest=await get(eventUrl);
      assert.equal((await post('read',{cursor:latest.snapshotCursor})).status,200);
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).attention,'READ');
      assert.equal((await post('read',{cursor:page.snapshotCursor})).status,200);
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).attention,'READ','Older read cannot regress');
      assert.equal((await post('read',{cursor:'forged'})).status,400);
      const claudeId=list.sessions.find(x=>x.provider==='claude').id;
      const other=await get(`/api/sessions/${claudeId}/events`);
      assert.equal((await post('read',{cursor:other.snapshotCursor})).status,400);
      const order=(await get('/api/sessions')).sessions.find(x=>x.id===id).order;
      assert.equal((await post('archive',{cursor:latest.snapshotCursor})).status,200);
      assert.equal((await get('/api/sessions?archive=true')).sessions.find(x=>x.id===id).attention,'ARCHIVED');
      await append({type:'event_msg',payload:{type:'token_count',count:3}});
      await new Promise(r=>setTimeout(r,2400));
      assert.ok((await get('/api/sessions?archive=true')).sessions.some(x=>x.id===id),'Metadata-only append stays archived');
      await append(output('Restore from archive','restore'));
      await append({type:'event_msg',payload:{type:'task_complete'}});
      await wait(async()=> (await get('/api/sessions')).sessions.some(x=>x.id===id&&x.attention==='UNREAD_COMPLETION'));
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).order,order);
      const baseline=(await get('/api/sessions')).sessions.find(x=>x.id===claudeId);
      assert.equal(baseline.attention,'BASELINE_EXISTING');
      const beforeRestart=await fs.readFile(nativeFile);
      await stop(); await start();
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).attention,'UNREAD_COMPLETION');
      assert.deepEqual(await fs.readFile(nativeFile),beforeRestart,'Service never writes native files');
      const stale=(await get(eventUrl)).snapshotCursor;
      await fs.writeFile(nativeFile,line({type:'session_meta',payload:{id:'synthetic-codex',cwd:'/synthetic'}})+line(output('After truncate','after-truncate')));
      await wait(async()=> (await get(eventUrl)).items.some(x=>x.text==='After truncate'));
      assert.equal((await post('read',{cursor:stale})).status,409);
      const replacementCursor=(await get(eventUrl)).snapshotCursor;
      const replaced=await fs.readFile(nativeFile,'utf8');
      await fs.writeFile(nativeFile,replaced.replace('After truncate','After REWRITE!'));
      await wait(async()=> (await get(eventUrl)).items.some(x=>x.text==='After REWRITE!'));
      assert.equal((await post('read',{cursor:replacementCursor})).status,409,'Same-size rewrite invalidates cursor');
      const afterRewrite=await get(eventUrl);assert.equal((await post('read',{cursor:afterRewrite.snapshotCursor})).status,200);
      await stop();await start();
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).attention,'READ','File generations survive restart');
      assert.equal((await post('read',{cursor:afterRewrite.snapshotCursor})).status,200,'Unchanged snapshot remains valid after restart');
      await fs.appendFile(nativeFile,JSON.stringify(output('q'.repeat(3*1024*1024),'giant-partial')));
      await new Promise(r=>setTimeout(r,2400));
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===id).attention,'READ','Incomplete giant record is not output yet');
      await fs.appendFile(nativeFile,'\n');
      await wait(async()=> (await get('/api/sessions')).sessions.find(x=>x.id===id).attention==='UNREAD_OUTPUT');
      const cf=path.join(claude,'projects','synthetic','session.jsonl');
      await fs.appendFile(cf,line({type:'system',subtype:'stop_hook_summary',sessionId:'synthetic-claude'}));
      await new Promise(r=>setTimeout(r,2200));
      assert.equal((await get('/api/sessions')).sessions.find(x=>x.id===claudeId).execution,'UNKNOWN','Stop summary alone is not completion');
      await fs.appendFile(cf,line({type:'assistant',sessionId:'synthetic-claude',uuid:'blocks',message:{content:Array.from({length:150},(_,i)=>({type:'text',text:`Block ${i}`})),stop_reason:'end_turn'}}));
      const cp=await wait(async()=>{const p=await get(`/api/sessions/${claudeId}/events`);return p.items.some(x=>x.text==='Block 149')&&p;});
      assert.equal(cp.items.length,100);
      const cpBefore=await get(`/api/sessions/${claudeId}/events?cursor=${encodeURIComponent(cp.nextCursor)}`);
      assert.equal(cpBefore.items.filter(x=>x.text.startsWith('Block ')).length,50,'One native record spanning pages makes progress');
      assert.equal(cpBefore.items[0].text,'Synthetic hello');
      await fs.unlink(cf);
      await wait(async()=> (await get('/api/sessions')).sessions.find(x=>x.id===claudeId).diagnostics.some(x=>x.includes('不可用')));
      assert.equal((await fetch(base+`/api/sessions/${claudeId}/events`)).status,503);
      console.log('PASS attention: snapshot races, monotonic reads, scoped cursors, archive restoration, restart, truncate recovery');
    }
  }
} finally {
  await stop();
  console.log('Synthetic fixture directory:', root);
}
