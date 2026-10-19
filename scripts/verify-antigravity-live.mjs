import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AntigravityClient } from '../dist/server/antigravity-client.js';
import {
  getAntigravitySummaries,
  getAntigravityPendingAskQuestion,
} from '../dist/server/antigravity-meta.js';
import {
  resolveAntigravityCredentials,
  resolveCascadeConfigForMessage,
} from '../dist/server/antigravity-ls.js';

const antigravityHome = path.join(os.homedir(), '.gemini', 'antigravity');

console.log('Testing Antigravity LS credentials discovery...');
const creds = await resolveAntigravityCredentials();
console.log('Credentials discovered:', creds);
assert.ok(creds, 'Credentials must be discovered when Antigravity language_server is running');
assert.ok(creds.address.startsWith('localhost:'));
assert.ok(creds.csrfToken.length > 10);

console.log('Testing resolveCascadeConfigForMessage (existing + fallback)...');
const existingCfg = await resolveCascadeConfigForMessage(
  creds,
  '216f7a80-f31b-4fc0-966d-ecc2aac83fe5',
);
console.log('Resolved config for existing session:', JSON.stringify(existingCfg));
assert.ok(
  existingCfg.cascadeConfig?.plannerConfig?.planModel &&
    existingCfg.cascadeConfig.plannerConfig.planModel !== 'MODEL_UNSPECIFIED',
  'Should resolve valid planModel for existing session',
);
assert.equal(existingCfg.cascadeConfig?.executorConfig?.useCoreDirect, true);
assert.equal(
  existingCfg.customAgentSpec?.builtinAgent?.defaultAgent?.surface,
  'AGENT_SURFACE_HUB',
);

const fallbackCfg = await resolveCascadeConfigForMessage(creds, 'non-existent-cascade-id');
console.log('Resolved fallback config:', JSON.stringify(fallbackCfg));
assert.ok(
  fallbackCfg.cascadeConfig?.plannerConfig?.planModel &&
    fallbackCfg.cascadeConfig.plannerConfig.planModel !== 'MODEL_UNSPECIFIED',
  'Should resolve valid fallback planModel from GetUserStatus',
);

console.log('Testing Antigravity summaries metadata...');
const summaries = getAntigravitySummaries(antigravityHome);
console.log(`Found ${summaries.size} summaries in DB`);
assert.ok(summaries.size > 0, 'Should find summaries in conversation_summaries.db');

// Check that projectId is populated
let foundProjectWithId = false;
for (const [, summary] of summaries) {
  if (summary.projectId) {
    foundProjectWithId = true;
    break;
  }
}
assert.ok(foundProjectWithId, 'At least one session summary should have a projectId');

// Test isolated Antigravity ask_question WAITING_INPUT & decision() flow
console.log('Testing Antigravity ask_question WAITING_INPUT & decision submission...');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agent-board-antigravity-q-test-'));
const prevEnv = process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
process.env.AGENT_BOARD_ANTIGRAVITY_HOME = tempRoot;
try {
  const binDir = path.join(tempRoot, 'bin');
  const convId = 'test-conv-ask-question-1';
  const logsDir = path.join(tempRoot, 'brain', convId, '.system_generated', 'logs');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(path.join(binDir, 'agentapi.bat'), '@echo off\r\necho {"ok":true}\r\n', 'utf8');

  const transcriptPath = path.join(logsDir, 'transcript.jsonl');
  const askRecord = {
    step_index: 10,
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: new Date().toISOString(),
    conversation_id: convId,
    content: 'Please select how to proceed:',
    tool_calls: [
      {
        name: 'ask_question',
        args: {
          toolSummary: 'Choose next step',
          toolAction: 'Asking user to choose next step',
          questions: [
            {
              question: '1. Which script approach do you prefer?',
              is_multi_select: false,
              options: ['Option A: Direct storyboard', 'Option B: Detailed script table'],
            },
            {
              question: '2. Any additional features?',
              is_multi_select: true,
              options: ['Voiceover', 'Subtitles'],
            },
          ],
        },
      },
    ],
  };
  writeFileSync(transcriptPath, JSON.stringify(askRecord) + '\n', 'utf8');

  const parsedPending = getAntigravityPendingAskQuestion(transcriptPath);
  assert.ok(parsedPending, 'Should parse pending ask_question from transcript');
  assert.equal(parsedPending.transcriptStepIndex, 10);
  assert.equal(parsedPending.rawQuestions.length, 2);

  const client = new AntigravityClient(
    {
      id: `antigravity:${convId}`,
      nativeId: convId,
      provider: 'antigravity',
      cwd: tempRoot,
      files: [{ key: '0', path: transcriptPath, size: 100, mtime: Date.now(), generation: '1' }],
      diagnostics: [],
    },
    tempRoot,
  );

  try {
    const state1 = await client.refresh();
    assert.equal(state1.phase, 'WAITING_INPUT');
    assert.equal(state1.canSend, false);
    assert.equal(state1.pending.length, 1);
    assert.equal(state1.pending[0].kind, 'question');
    assert.equal(state1.pending[0].id, 'ask_question_11');
    assert.equal(state1.pending[0].questions?.length, 2);
    assert.deepEqual(state1.pending[0].questions?.[0].options, [
      'Option A: Direct storyboard',
      'Option B: Detailed script table',
    ]);
    assert.equal(state1.pending[0].questions?.[1].multiple, true);

    await client.decision('ask_question_11', {
      action: 'submit',
      answers: {
        '1. Which script approach do you prefer?': 'Option B: Detailed script table',
        '2. Any additional features?': 'Subtitles, Custom BGM',
      },
      questionDetails: {
        '1. Which script approach do you prefer?': {
          selectedOptions: ['Option B: Detailed script table'],
          writeIn: '',
          skipped: false,
        },
        '2. Any additional features?': {
          selectedOptions: ['Subtitles'],
          writeIn: 'Custom BGM',
          skipped: false,
        },
      },
    });

    const linesAfter = readFileSync(transcriptPath, 'utf8').trim().split('\n');
    assert.equal(linesAfter.length, 2, 'Should append GENERIC answer record in test env');
    const answerRec = JSON.parse(linesAfter[1]);
    assert.equal(answerRec.type, 'GENERIC');
    assert.ok(answerRec.content.includes('A1: Option B: Detailed script table'));
    assert.ok(answerRec.content.includes('A2: Subtitles, Custom BGM'));

    const state2 = await client.refresh();
    assert.equal(state2.pending.length, 0);
  } finally {
    await client.close();
  }
} finally {
  if (prevEnv === undefined) delete process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
  else process.env.AGENT_BOARD_ANTIGRAVITY_HOME = prevEnv;
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('PASS Antigravity discovery, metadata, and ask_question interaction verification!');

