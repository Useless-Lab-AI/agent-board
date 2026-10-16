import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

console.log('1. Starting synthetic server for browser verification...');
const server = spawn(process.execPath, ['scripts/verify-http.mjs', '--serve'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let serverLog = '';
server.stdout.on('data', (b) => {
  serverLog += b;
});
server.stderr.on('data', (b) => {
  serverLog += b;
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Server died early: ' + serverLog);
    if (serverLog.includes('SYNTHETIC_BROWSER_READY')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server readiness timed out: ' + serverLog);
}

try {
  await waitForServer();
  console.log('Server is ready. Running browser verification for new session buttons & modal...');

  const runBrowserTest = (filename) =>
    new Promise((resolve, reject) => {
      const pw = spawn(
        'playwright-cli.ps1',
        ['-s=agent-board', 'run-code', `--filename=${filename}`],
        {
          shell: 'powershell.exe',
          stdio: 'inherit',
          windowsHide: true,
        },
      );
      pw.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playwright-cli exited with code ${code} for ${filename}`));
      });
    });

  const ensureBrowserOpen = () =>
    new Promise((resolve, reject) => {
      const pw = spawn(
        'playwright-cli.ps1',
        ['-s=agent-board', 'open', 'http://127.0.0.1:4318'],
        {
          shell: 'powershell.exe',
          stdio: 'inherit',
          windowsHide: true,
        },
      );
      pw.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playwright-cli open failed with code ${code}`));
      });
    });

  await ensureBrowserOpen();
  await runBrowserTest('scripts/verify-new-session.js');

  console.log('\n========================================');
  console.log('ALL NEW SESSION UI & MODAL VERIFICATIONS PASSED');
  console.log('========================================\n');
} finally {
  server.kill();
}
