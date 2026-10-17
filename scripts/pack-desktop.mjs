import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);

// Set domestic mirrors for local builds; on GitHub Actions runners, use direct GitHub CDN for maximum speed
if (!process.env.GITHUB_ACTIONS) {
  process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';
  console.log('[pack-desktop] Using ELECTRON_MIRROR:', process.env.ELECTRON_MIRROR);
  console.log('[pack-desktop] Using ELECTRON_BUILDER_BINARIES_MIRROR:', process.env.ELECTRON_BUILDER_BINARIES_MIRROR);
} else {
  console.log('[pack-desktop] Running in GitHub Actions — using default upstream Electron mirrors.');
}

// Clean up stale lock files if any
try {
  const tempDir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : '/tmp';
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    for (const f of files) {
      if (f.includes('electron') && f.endsWith('.lock')) {
        fs.rmSync(path.join(tempDir, f), { recursive: true, force: true });
        console.log('[pack-desktop] Removed stale lockfile:', f);
      }
    }
  }
} catch {
  // ignore lock cleanup errors
}

const isWin = process.platform === 'win32';
const bin = isWin ? 'npx.cmd' : 'npx';

const builder = spawn(bin, ['electron-builder', ...args], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

builder.on('exit', (code) => {
  if (code === 0) {
    console.log('[pack-desktop] Packaging completed successfully!');
    process.exit(0);
  } else {
    console.error('[pack-desktop] Packaging failed with exit code:', code);
    process.exit(code ?? 1);
  }
});
