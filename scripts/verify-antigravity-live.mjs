import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { AntigravityClient } from '../dist/server/antigravity-client.js';
import { getAntigravitySummaries } from '../dist/server/antigravity-meta.js';
import { resolveAntigravityCredentials } from '../dist/server/antigravity-ls.js';

const antigravityHome = path.join(os.homedir(), '.gemini', 'antigravity');

console.log('Testing Antigravity LS credentials discovery...');
const creds = await resolveAntigravityCredentials();
console.log('Credentials discovered:', creds);
assert.ok(creds, 'Credentials must be discovered when Antigravity language_server is running');
assert.ok(creds.address.startsWith('localhost:'));
assert.ok(creds.csrfToken.length > 10);

console.log('Testing Antigravity summaries metadata...');
const summaries = getAntigravitySummaries(antigravityHome);
console.log(`Found ${summaries.size} summaries in DB`);
assert.ok(summaries.size > 0, 'Should find summaries in conversation_summaries.db');

// Check that projectId is populated
let foundProjectWithId = false;
for (const [id, summary] of summaries) {
  if (summary.projectId) {
    foundProjectWithId = true;
    break;
  }
}
assert.ok(foundProjectWithId, 'At least one session summary should have a projectId');

console.log('PASS Antigravity discovery and metadata verification!');
