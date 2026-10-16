import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { chromium } = require('d:/tools/nvm/nodejs/node_modules/@playwright/cli/node_modules/playwright-core');

async function main() {
  console.log('Launching Chromium for multilingual promo assets & videos...');
  const browser = await chromium.launch({
    headless: true,
  });

  const promoPath = path.resolve('promo-video/index.html');
  const promoUrl = `file:///${promoPath.replace(/\\/g, '/')}`;

  const locales = [
    { code: 'en-US', short: 'en', previewFile: 'docs/promo-video-preview.png', videoFile: 'docs/promo-video-en.webm' },
    { code: 'zh-CN', short: 'zh', previewFile: 'docs/promo-video-preview-zh.png', videoFile: 'docs/promo-video-zh.webm' },
    { code: 'zh-TW', short: 'zh-tw', previewFile: 'docs/promo-video-preview-zh-tw.png', videoFile: 'docs/promo-video-zh-tw.webm' },
    { code: 'ja-JP', short: 'ja', previewFile: 'docs/promo-video-preview-ja.png', videoFile: 'docs/promo-video-ja.webm' },
  ];

  // 1. Generate high-resolution snapshots at t=8.35s (showing code diff & approval buttons)
  console.log('Generating multilingual preview snapshots at t=8.35s (interactive approval state)...');
  const snapPage = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await snapPage.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

  const canvasEl = snapPage.locator('#stage');

  for (const item of locales) {
    console.log(`Generating preview for ${item.code} -> ${item.previewFile}...`);
    await snapPage.goto(`${promoUrl}?lang=${item.code}&t=8.35`, { waitUntil: 'domcontentloaded' });
    await snapPage.waitForTimeout(400);
    await canvasEl.screenshot({ path: item.previewFile });
    console.log(`Saved ${item.previewFile}`);
  }

  // Also capture clean board overview at t=2.4s (Chapter 1: Full 4-card board view)
  await snapPage.goto(`${promoUrl}?lang=zh-CN&t=2.4`, { waitUntil: 'domcontentloaded' });
  await snapPage.waitForTimeout(400);
  await canvasEl.screenshot({ path: 'docs/promo-board-preview.png' });
  console.log('Saved docs/promo-board-preview.png');
  await snapPage.close();

  // 2. Record full 15s 1080p WebM videos for all locales
  console.log('Recording 1080p promotional showcase videos for all locales in parallel...');
  const tempVideoDir = path.resolve('docs/.temp_videos');
  if (!fs.existsSync(tempVideoDir)) {
    fs.mkdirSync(tempVideoDir, { recursive: true });
  }

  await Promise.all(locales.map(async (item) => {
    console.log(`[${item.code}] Starting video recording -> ${item.videoFile}...`);
    const context = await browser.newContext({
      recordVideo: {
        dir: tempVideoDir,
        size: { width: 1920, height: 1080 },
      },
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

    // Navigate to player (autoplays from 0s to 15s)
    await page.goto(`${promoUrl}?lang=${item.code}`, { waitUntil: 'domcontentloaded' });

    // Wait for the full 15 seconds plus brief buffer
    await page.waitForTimeout(15600);

    const videoObj = page.video();
    await page.close();
    await context.close();

    if (videoObj) {
      const recordedPath = await videoObj.path();
      if (fs.existsSync(item.videoFile)) {
        try { fs.unlinkSync(item.videoFile); } catch (e) {}
      }
      fs.copyFileSync(recordedPath, item.videoFile);
      try { fs.unlinkSync(recordedPath); } catch (e) {}
      console.log(`[${item.code}] Successfully saved video: ${item.videoFile} (${(fs.statSync(item.videoFile).size / 1024 / 1024).toFixed(2)} MB)`);
    }
  }));

  // Clean up temp video directory
  try {
    if (fs.existsSync(tempVideoDir)) {
      fs.rmSync(tempVideoDir, { recursive: true, force: true });
    }
  } catch (e) {}

  await browser.close();
  console.log('All multilingual promo snapshots and videos successfully produced!');
}

main().catch(err => {
  console.error('Asset generation failed:', err);
  process.exit(1);
});
