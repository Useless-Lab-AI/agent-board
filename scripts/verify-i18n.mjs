import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { zhCN } from '../src/i18n/locales/zh-CN.js';
import { zhTW } from '../src/i18n/locales/zh-TW.js';
import { enUS } from '../src/i18n/locales/en-US.js';
import { jaJP } from '../src/i18n/locales/ja-JP.js';

console.log('1. Checking translation dictionary completeness and structural parity...');

function compareObjects(base, target, targetName, path = '') {
  const baseKeys = Object.keys(base).sort();
  const targetKeys = Object.keys(target).sort();

  assert.deepEqual(
    baseKeys,
    targetKeys,
    `Key mismatch at "${path}": zh-CN has [${baseKeys.join(', ')}], ${targetName} has [${targetKeys.join(', ')}]`,
  );

  for (const key of baseKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const baseVal = base[key];
    const targetVal = target[key];

    assert.equal(
      typeof baseVal,
      typeof targetVal,
      `Type mismatch at "${currentPath}": zh-CN is ${typeof baseVal}, ${targetName} is ${typeof targetVal}`,
    );

    if (typeof baseVal === 'object' && baseVal !== null) {
      compareObjects(baseVal, targetVal, targetName, currentPath);
    } else if (typeof baseVal === 'function') {
      // Test function invocations with dummy params
      const baseRes = baseVal(5, 'test', 'item');
      const targetRes = targetVal(5, 'test', 'item');
      assert.equal(typeof baseRes, 'string', `zh-CN function at ${currentPath} must return string`);
      assert.equal(typeof targetRes, 'string', `${targetName} function at ${currentPath} must return string`);
      assert.ok(baseRes.length > 0, `zh-CN function at ${currentPath} returned empty string`);
      assert.ok(targetRes.length > 0, `${targetName} function at ${currentPath} returned empty string`);
    } else {
      assert.ok(baseVal.length > 0, `Empty string in zh-CN at "${currentPath}"`);
      assert.ok(targetVal.length > 0, `Empty string in ${targetName} at "${currentPath}"`);
    }
  }
}

compareObjects(zhCN, enUS, 'en-US');
compareObjects(zhCN, zhTW, 'zh-TW');
compareObjects(zhCN, jaJP, 'ja-JP');
console.log('PASS dictionary parity: zh-CN, zh-TW, en-US, and ja-JP have 100% key-for-key and type alignment.');

if (process.argv.includes('--dict-only')) {
  process.exit(0);
}

// 2. Start synthetic server and run playwright-cli browser verification
console.log('2. Starting synthetic server for browser verification...');
const server = spawn(process.execPath, ['scripts/verify-http.mjs', '--serve'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let serverLog = '';
server.stdout.on('data', b => {
  serverLog += b;
});
server.stderr.on('data', b => {
  serverLog += b;
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Server died early: ' + serverLog);
    if (serverLog.includes('SYNTHETIC_BROWSER_READY')) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server readiness timed out: ' + serverLog);
}

try {
  await waitForServer();
  console.log('Server is ready. Running browser i18n test via playwright-cli...');

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
      pw.on('exit', code => {
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
      pw.on('exit', code => {
        if (code === 0) resolve();
        else reject(new Error(`playwright-cli open exited with code ${code}`));
      });
    });

  await ensureBrowserOpen();
  await runBrowserTest('scripts/verify-i18n-browser.js');

  console.log('\n========================================');
  console.log('ALL I18N AND BROWSER VERIFICATIONS PASSED');
  console.log('========================================\n');
} finally {
  server.kill();
  await new Promise(r => server.once('exit', r));
}
