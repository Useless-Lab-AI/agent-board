import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const svgPath = path.resolve('assets/icon.svg');
const svgContent = readFileSync(svgPath, 'utf8');

const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: transparent; overflow: hidden; display: flex; justify-content: center; align-items: center; width: 100vw; height: 100vh; }
    svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

const tempHtml = path.resolve('build/temp-icon.html');
writeFileSync(tempHtml, htmlContent, 'utf8');

console.log('Generating PNG icons via playwright-cli...');

const testCode = `
await (async page => {
  const path = await import('node:path');
  const tempUrl = 'file:///' + path.resolve('build/temp-icon.html').replace(/\\\\/g, '/');
  
  // 1. 512x512 app icon
  await page.setViewportSize({ width: 512, height: 512 });
  await page.goto(tempUrl);
  await page.screenshot({ path: 'build/icon.png', omitBackground: true });
  await page.screenshot({ path: 'assets/icon.png', omitBackground: true });
  console.log('Generated build/icon.png and assets/icon.png (512x512)');

  // 2. 64x64 tray@2x
  await page.setViewportSize({ width: 64, height: 64 });
  await page.goto(tempUrl);
  await page.screenshot({ path: 'assets/tray@2x.png', omitBackground: true });

  // 3. 32x32 tray
  await page.setViewportSize({ width: 32, height: 32 });
  await page.goto(tempUrl);
  await page.screenshot({ path: 'assets/tray.png', omitBackground: true });
  await page.screenshot({ path: 'build/tray.png', omitBackground: true });
  console.log('Generated tray icons (32x32, 64x64)');
})(page);
`;

const tempJs = path.resolve('build/render-icons.js');
writeFileSync(tempJs, testCode, 'utf8');

const pw = spawn('playwright-cli.ps1', ['-s=agent-board', 'run-code', `--filename=${tempJs}`], {
  shell: 'powershell.exe',
  stdio: 'inherit',
  windowsHide: true,
});

pw.on('exit', code => {
  if (code === 0) {
    console.log('Icon generation succeeded!');
    process.exit(0);
  } else {
    console.error('Failed to generate icons, exit code:', code);
    process.exit(code ?? 1);
  }
});
