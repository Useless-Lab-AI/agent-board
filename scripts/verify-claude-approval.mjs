import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Interactions } from '../dist/server/interaction.js';
import { claudeStatuses } from '../dist/server/claude-reader.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const bridgeExe = path.join(
  projectRoot,
  'dist',
  'bin',
  process.platform === 'win32' ? 'agent-board-bridge.exe' : 'agent-board-bridge',
);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 40) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await predicate();
    if (val) return val;
    await sleep(intervalMs);
  }
  throw new Error('Timeout waiting for condition');
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agent-board-claude-approval-test-'));
  const claudeHome = path.join(tempRoot, '.claude');
  const codexHome = path.join(tempRoot, '.codex');
  mkdirSync(path.join(claudeHome, 'sessions'), { recursive: true });
  mkdirSync(path.join(claudeHome, 'agent-board-bridges'), { recursive: true });
  mkdirSync(path.join(claudeHome, 'projects', 'test-proj'), { recursive: true });

  const sessionId = '11111111-2222-4333-8444-555555555555';
  const sessionJsonl = path.join(claudeHome, 'projects', 'test-proj', `${sessionId}.jsonl`);
  writeFileSync(
    sessionJsonl,
    JSON.stringify({
      type: 'user',
      uuid: 'u-1',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Hello Claude' },
    }) + '\n',
    'utf8',
  );

  // Create a mock claude script that communicates via stream-json stdio
  const mockClaudeScript = path.join(tempRoot, 'mock-claude.mjs');
  writeFileSync(
    mockClaudeScript,
    `
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const claudeHome = process.env.AGENT_BOARD_CLAUDE_HOME;
const sessionId = process.env.TEST_SESSION_ID;
const sessionFile = path.join(claudeHome, 'sessions', \`\${process.pid}.json\`);

fs.writeFileSync(sessionFile, JSON.stringify({
  pid: process.pid,
  sessionId,
  cwd: process.cwd(),
  status: 'busy',
  updatedAt: Date.now()
}));

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === 'test_emit_stdout' && parsed.payload) {
      process.stdout.write(JSON.stringify(parsed.payload) + '\\n');
      return;
    }
    process.stdout.write(JSON.stringify({ type: 'test_stdin_echo', received: parsed }) + '\\n');
  } catch {}
});

process.on('SIGTERM', () => process.exit(0));
`,
    'utf8',
  );

  const bridgeProc = spawn(
    bridgeExe,
    [
      process.execPath,
      mockClaudeScript,
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      `--session-id=${sessionId}`,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AGENT_BOARD_CLAUDE_HOME: claudeHome,
        TEST_SESSION_ID: sessionId,
      },
    },
  );

  const parentStdoutFrames = [];
  const childStdinEchoes = [];

  const outRl = readline.createInterface({ input: bridgeProc.stdout, crlfDelay: Infinity });
  outRl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed);
      parentStdoutFrames.push(obj);
      if (obj.type === 'test_stdin_echo') {
        childStdinEchoes.push(obj.received);
      }
    } catch {}
  });

  const emitFromClaudeStdout = (payload) => {
    bridgeProc.stdin.write(JSON.stringify({ type: 'test_emit_stdout', payload }) + '\n');
  };

  const session = {
    id: `claude:${sessionId}`,
    nativeId: sessionId,
    provider: 'claude',
    cwd: projectRoot,
    files: [{ key: '0', path: sessionJsonl, size: 100, mtime: Date.now(), generation: '1' }],
  };

  const notifications = [];
  const interactions = new Interactions(codexHome, claudeHome, (id) => {
    notifications.push(id);
  });

  try {
    // Wait for bridge registration file to appear
    await waitFor(async () => {
      const statuses = await claudeStatuses(claudeHome);
      return statuses.get(sessionId)?.state === 'RUNNING';
    });
    console.log('✓ Step 0: Bridge discovered and initial session status is RUNNING');

    // =========================================================================
    // Test 1: File Edit Approval (Allow) + Diff Formatting + VS Code Cancel & Duplicate Suppression
    // =========================================================================
    emitFromClaudeStdout({
      type: 'control_request',
      request_id: 'req_edit_1',
      session_id: sessionId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        tool_use_id: 'toolu_edit_1',
        input: {
          file_path: 'src/server.ts',
          old_string: 'const port = 3000;',
          new_string: 'const port = 4317;',
        },
        description: 'Change default server port to 4317',
      },
    });

    const view1 = await waitFor(async () => {
      const v = await interactions.view(session);
      return v.phase === 'WAITING_APPROVAL' && v.pending.length === 1 ? v : null;
    });

    assert.equal(view1.phase, 'WAITING_APPROVAL');
    assert.equal(view1.canSend, false);
    assert.equal(view1.pending[0].id, 'req_edit_1');
    assert.equal(view1.pending[0].kind, 'approval');
    assert.equal(view1.pending[0].title, '允许修改文件？');
    assert.ok(view1.pending[0].detail.includes('@@ Edit @@'), 'Detail should include unified diff header');
    assert.ok(view1.pending[0].detail.includes('- const port = 3000;'), 'Detail should include removed line');
    assert.ok(view1.pending[0].detail.includes('+ const port = 4317;'), 'Detail should include added line');

    // Also verify claudeStatuses reports WAITING_APPROVAL for the main board card
    const boardStatuses1 = await claudeStatuses(claudeHome);
    assert.equal(boardStatuses1.get(sessionId)?.state, 'WAITING_APPROVAL');
    assert.equal(boardStatuses1.get(sessionId)?.reason, '允许修改文件？');
    console.log('✓ Test 1a: Edit control_request intercepted, formatted as unified diff, and surfaced as WAITING_APPROVAL');

    // Approve from Agent Board
    const afterAllowView = await interactions.decision(session.id, {
      serviceEpoch: view1.serviceEpoch,
      runtimeEpoch: view1.runtimeEpoch,
      providerRequestId: 'req_edit_1',
      decision: 'allow',
    });
    assert.equal(afterAllowView.pending.length, 0);
    assert.equal(afterAllowView.phase, 'RUNNING');

    // Wait for child claude stdin echo and parent stdout cancel frame
    const allowEcho = await waitFor(() =>
      childStdinEchoes.find(
        (e) => e.type === 'control_response' && e.response?.request_id === 'req_edit_1',
      ),
    );
    assert.equal(allowEcho.response.subtype, 'success');
    assert.equal(allowEcho.response.response.behavior, 'allow');
    assert.equal(allowEcho.response.response.toolUseID, 'toolu_edit_1');
    assert.deepEqual(allowEcho.response.response.updatedInput, {
      file_path: 'src/server.ts',
      old_string: 'const port = 3000;',
      new_string: 'const port = 4317;',
    });

    const cancelFrame = await waitFor(() =>
      parentStdoutFrames.find(
        (f) => f.type === 'control_cancel_request' && f.request_id === 'req_edit_1',
      ),
    );
    assert.ok(cancelFrame, 'Parent stdout (VS Code) should receive control_cancel_request');

    // Simulate VS Code emitting an aborted control_response on stdin after receiving control_cancel_request
    const echoCountBeforeDup = childStdinEchoes.length;
    bridgeProc.stdin.write(
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: 'req_edit_1',
          error: 'aborted',
        },
      }) + '\n',
    );
    await sleep(150);
    assert.equal(
      childStdinEchoes.length,
      echoCountBeforeDup,
      'Duplicate/abort control_response from VS Code must be suppressed by bridge',
    );
    console.log('✓ Test 1b: Allow decision injected control_response to Claude, cancelled VS Code card, and suppressed duplicate response');

    // =========================================================================
    // Test 2: Bash Command Execution Approval (Deny)
    // =========================================================================
    emitFromClaudeStdout({
      type: 'control_request',
      request_id: 'req_bash_2',
      session_id: sessionId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'toolu_bash_2',
        input: {
          command: 'rm -rf ./build-cache',
          description: 'Clean build cache directory',
        },
      },
    });

    const view2 = await waitFor(async () => {
      const v = await interactions.view(session);
      return v.phase === 'WAITING_APPROVAL' && v.pending.some((p) => p.id === 'req_bash_2') ? v : null;
    });
    assert.equal(view2.pending[0].title, '允许执行命令？');
    assert.ok(view2.pending[0].detail.includes('$ rm -rf ./build-cache'));

    const afterDenyView = await interactions.decision(session.id, {
      serviceEpoch: view2.serviceEpoch,
      runtimeEpoch: view2.runtimeEpoch,
      providerRequestId: 'req_bash_2',
      decision: 'deny',
    });
    assert.equal(afterDenyView.pending.length, 0);

    const denyEcho = await waitFor(() =>
      childStdinEchoes.find(
        (e) => e.type === 'control_response' && e.response?.request_id === 'req_bash_2',
      ),
    );
    assert.equal(denyEcho.response.subtype, 'success');
    assert.equal(denyEcho.response.response.behavior, 'deny');
    assert.equal(denyEcho.response.response.interrupt, true);
    assert.equal(denyEcho.response.response.toolUseID, 'toolu_bash_2');
    console.log('✓ Test 2: Deny decision injected deny control_response to Claude and cleared pending list');

    // =========================================================================
    // Test 3: AskUserQuestion Interactive Question & Answers Submission
    // =========================================================================
    emitFromClaudeStdout({
      type: 'control_request',
      request_id: 'req_question_3',
      session_id: sessionId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_q_3',
        input: {
          questions: [
            {
              question: 'Which database should we use?',
              header: 'Database',
              options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }],
              multiSelect: false,
            },
          ],
        },
      },
    });

    const view3 = await waitFor(async () => {
      const v = await interactions.view(session);
      return v.phase === 'WAITING_INPUT' && v.pending.some((p) => p.id === 'req_question_3') ? v : null;
    });
    assert.equal(view3.pending[0].kind, 'question');
    assert.equal(view3.pending[0].title, 'AI 需要你的回答');
    assert.deepEqual(view3.pending[0].questions, [
      {
        id: 'Which database should we use?',
        text: 'Which database should we use?',
        options: ['PostgreSQL', 'SQLite'],
      },
    ]);

    const boardStatuses3 = await claudeStatuses(claudeHome);
    assert.equal(boardStatuses3.get(sessionId)?.state, 'WAITING_INPUT');

    const afterAnswerView = await interactions.decision(session.id, {
      serviceEpoch: view3.serviceEpoch,
      runtimeEpoch: view3.runtimeEpoch,
      providerRequestId: 'req_question_3',
      answers: {
        'Which database should we use?': 'PostgreSQL',
      },
    });
    assert.equal(afterAnswerView.pending.length, 0);

    const answerEcho = await waitFor(() =>
      childStdinEchoes.find(
        (e) => e.type === 'control_response' && e.response?.request_id === 'req_question_3',
      ),
    );
    assert.equal(answerEcho.response.response.behavior, 'allow');
    assert.deepEqual(answerEcho.response.response.updatedInput.answers, {
      'Which database should we use?': 'PostgreSQL',
    });
    console.log('✓ Test 3: AskUserQuestion surfaced as WAITING_INPUT and answers injected into updatedInput.answers');

    // =========================================================================
    // Test 4: Local Resolution in Original Client (VS Code)
    // =========================================================================
    emitFromClaudeStdout({
      type: 'control_request',
      request_id: 'req_local_4',
      session_id: sessionId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'toolu_local_4',
        input: { command: 'npm test' },
      },
    });

    await waitFor(async () => {
      const v = await interactions.view(session);
      return v.phase === 'WAITING_APPROVAL' && v.pending.some((p) => p.id === 'req_local_4');
    });

    // Simulate user clicking Allow directly inside VS Code (writing to bridgeProc.stdin)
    bridgeProc.stdin.write(
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req_local_4',
          response: {
            behavior: 'allow',
            updatedInput: { command: 'npm test' },
            toolUseID: 'toolu_local_4',
          },
        },
      }) + '\n',
    );

    const localEcho = await waitFor(() =>
      childStdinEchoes.find(
        (e) => e.type === 'control_response' && e.response?.request_id === 'req_local_4',
      ),
    );
    assert.equal(localEcho.response.response.behavior, 'allow');

    const viewAfterLocal = await waitFor(async () => {
      const v = await interactions.view(session);
      return v.pending.length === 0 ? v : null;
    });
    assert.equal(viewAfterLocal.phase, 'RUNNING');
    console.log('✓ Test 4: Local approval in VS Code forwarded to Claude and automatically cleared pending state in Agent Board');

    console.log('\n🎉 All Claude Code transparent bridge approval & question tests passed!');
  } finally {
    await interactions.close();
    bridgeProc.kill();
    await sleep(150);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
