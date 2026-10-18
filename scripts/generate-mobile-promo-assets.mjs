import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { chromium } = require('d:/tools/nvm/nodejs/node_modules/@playwright/cli/node_modules/playwright-core');

function rgbTo565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

function buildPaletteAndLut(rgbaSamples) {
  const hist = new Uint32Array(65536);
  for (const rgba of rgbaSamples) {
    for (let i = 0; i < rgba.length; i += 4) {
      hist[rgbTo565(rgba[i], rgba[i + 1], rgba[i + 2])]++;
    }
  }
  const colors = [];
  for (let c = 0; c < 65536; c++) {
    if (hist[c] > 0) {
      const r = ((c >> 11) & 31) * 255 / 31;
      const g = ((c >> 5) & 63) * 255 / 63;
      const b = (c & 31) * 255 / 31;
      colors.push({ r: Math.round(r), g: Math.round(g), b: Math.round(b), count: hist[c], c565: c });
    }
  }

  let boxes = [colors];
  while (boxes.length < 255) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length <= 1) continue;
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, pop = 0;
      for (const p of box) {
        if (p.r < rMin) rMin = p.r;
        if (p.r > rMax) rMax = p.r;
        if (p.g < gMin) gMin = p.g;
        if (p.g > gMax) gMax = p.g;
        if (p.b < bMin) bMin = p.b;
        if (p.b > bMax) bMax = p.b;
        pop += p.count;
      }
      const span = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
      const score = span * Math.pow(pop, 0.35);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const box = boxes[bestIdx];
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const p of box) {
      if (p.r < rMin) rMin = p.r;
      if (p.r > rMax) rMax = p.r;
      if (p.g < gMin) gMin = p.g;
      if (p.g > gMax) gMax = p.g;
      if (p.b < bMin) bMin = p.b;
      if (p.b > bMax) bMax = p.b;
    }
    const rSpan = rMax - rMin, gSpan = gMax - gMin, bSpan = bMax - bMin;
    const chan = rSpan >= gSpan && rSpan >= bSpan ? 'r' : gSpan >= bSpan ? 'g' : 'b';
    box.sort((a, b) => a[chan] - b[chan]);
    const mid = box.length >> 1;
    boxes.splice(bestIdx, 1, box.slice(0, mid), box.slice(mid));
  }

  const palette = new Uint8Array(256 * 3);
  const pR = new Int32Array(255);
  const pG = new Int32Array(255);
  const pB = new Int32Array(255);
  const numColors = Math.min(255, boxes.length);
  for (let i = 0; i < numColors; i++) {
    let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
    for (const p of boxes[i]) {
      rSum += p.r * p.count;
      gSum += p.g * p.count;
      bSum += p.b * p.count;
      wSum += p.count;
    }
    const r = wSum ? Math.round(rSum / wSum) : 0;
    const g = wSum ? Math.round(gSum / wSum) : 0;
    const b = wSum ? Math.round(bSum / wSum) : 0;
    palette[i * 3] = pR[i] = r;
    palette[i * 3 + 1] = pG[i] = g;
    palette[i * 3 + 2] = pB[i] = b;
  }

  const lut = new Uint8Array(65536);
  for (let c = 0; c < 65536; c++) {
    const r = Math.round(((c >> 11) & 31) * 255 / 31);
    const g = Math.round(((c >> 5) & 63) * 255 / 63);
    const b = Math.round((c & 31) * 255 / 31);
    let best = 0;
    let bestDist = 0x7fffffff;
    for (let i = 0; i < numColors; i++) {
      const dr = r - pR[i];
      const dg = g - pG[i];
      const db = b - pB[i];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    lut[c] = best;
  }
  return { palette, lut };
}

function lzwEncode(indices) {
  const minCodeSize = 8;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;

  const trie = new Int32Array(4096 * 256);
  trie.fill(-1);

  const bytes = [];
  let bitBuf = 0;
  let bitCount = 0;

  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  if (indices.length === 0) {
    emit(endCode);
    if (bitCount > 0) bytes.push(bitBuf & 0xff);
    return { minCodeSize, bytes };
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = trie[key];
    if (hit !== -1) {
      prefix = hit;
    } else {
      emit(prefix);
      if (nextCode < 4096) {
        trie[key] = nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emit(clearCode);
        trie.fill(-1);
        nextCode = endCode + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(endCode);
  if (bitCount > 0) bytes.push(bitBuf & 0xff);
  return { minCodeSize, bytes };
}

class GifWriter {
  constructor(width, height, palette) {
    this.width = width;
    this.height = height;
    this.chunks = [];
    this.prevIndices = null;

    const head = Buffer.alloc(13);
    head.write('GIF89a', 0, 'ascii');
    head.writeUInt16LE(width, 6);
    head.writeUInt16LE(height, 8);
    head[10] = 0xf7;
    head[11] = 0;
    head[12] = 0;
    this.chunks.push(head);
    this.chunks.push(Buffer.from(palette));

    this.chunks.push(Buffer.from([
      0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
      0x03, 0x01, 0x00, 0x00, 0x00,
    ]));
  }

  addFrame(currIndices, delayCs) {
    const W = this.width;
    const H = this.height;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    const prev = this.prevIndices;

    if (prev) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) {
        const rowOff = y * W;
        for (let x = 0; x < W; x++) {
          if (currIndices[rowOff + x] !== prev[rowOff + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0) {
        x0 = 0; y0 = 0; x1 = 0; y1 = 0;
      }
    }

    const subW = x1 - x0 + 1;
    const subH = y1 - y0 + 1;
    const subPixels = new Uint8Array(subW * subH);
    let ptr = 0;
    for (let y = y0; y <= y1; y++) {
      const rowOff = y * W;
      for (let x = x0; x <= x1; x++) {
        const idx = rowOff + x;
        const c = currIndices[idx];
        subPixels[ptr++] = prev && prev[idx] === c ? 255 : c;
      }
    }

    this.prevIndices = new Uint8Array(currIndices);

    const gce = Buffer.alloc(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 0x04;
    gce[3] = prev ? 0x05 : 0x04;
    gce.writeUInt16LE(delayCs, 4);
    gce[6] = 255;
    gce[7] = 0x00;
    this.chunks.push(gce);

    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(x0, 1);
    desc.writeUInt16LE(y0, 3);
    desc.writeUInt16LE(subW, 5);
    desc.writeUInt16LE(subH, 7);
    desc[9] = 0x00;
    this.chunks.push(desc);

    const { minCodeSize, bytes } = lzwEncode(subPixels);
    this.chunks.push(Buffer.from([minCodeSize]));
    for (let i = 0; i < bytes.length; i += 255) {
      const slice = bytes.slice(i, i + 255);
      this.chunks.push(Buffer.from([slice.length, ...slice]));
    }
    this.chunks.push(Buffer.from([0x00]));
  }

  finish(outPath) {
    this.chunks.push(Buffer.from([0x3b]));
    fs.writeFileSync(outPath, Buffer.concat(this.chunks));
  }
}

async function main() {
  console.log('Launching Chromium for Mobile & Voice promo assets, WebM videos & animated GIFs...');
  const browser = await chromium.launch({ headless: true });

  const promoPath = path.resolve('promo-video/mobile.html');
  const promoUrl = `file:///${promoPath.replace(/\\/g, '/')}`;

  const locales = [
    { code: 'en-US', short: 'en', previewFile: 'docs/promo-mobile-preview.png', videoFile: 'docs/promo-mobile-en.webm', gifFile: 'docs/promo-mobile-en.gif' },
    { code: 'zh-CN', short: 'zh', previewFile: 'docs/promo-mobile-preview-zh.png', videoFile: 'docs/promo-mobile-zh.webm', gifFile: 'docs/promo-mobile-zh.gif' },
    { code: 'zh-TW', short: 'zh-tw', previewFile: 'docs/promo-mobile-preview-zh-tw.png', videoFile: 'docs/promo-mobile-zh-tw.webm', gifFile: 'docs/promo-mobile-zh-tw.gif' },
    { code: 'ja-JP', short: 'ja', previewFile: 'docs/promo-mobile-preview-ja.png', videoFile: 'docs/promo-mobile-ja.webm', gifFile: 'docs/promo-mobile-ja.gif' },
  ];

  const snapPage = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await snapPage.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

  const canvasEl = snapPage.locator('#stage');

  for (const item of locales) {
    console.log(`Generating mobile preview for ${item.code} -> ${item.previewFile}...`);
    await snapPage.goto(`${promoUrl}?lang=${item.code}&t=8.6`, { waitUntil: 'domcontentloaded' });
    await snapPage.waitForTimeout(250);
    await canvasEl.screenshot({ path: item.previewFile });
    console.log(`Saved ${item.previewFile}`);

    const gifW = 960;
    const gifH = 540;
    const fps = 10;
    const duration = 15;
    const totalFrames = duration * fps;
    const delayCs = Math.round(100 / fps);

    const sampleTimes = [1.2, 2.6, 5.0, 8.6, 11.8, 14.0];
    const sampleRgbas = [];
    for (const st of sampleTimes) {
      const b64 = await snapPage.evaluate(({ t, w, h }) => {
        window.seekTo(t);
        let off = window.__offCanvas;
        if (!off) {
          off = document.createElement('canvas');
          off.width = w;
          off.height = h;
          window.__offCanvas = off;
        }
        const octx = off.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(document.getElementById('stage'), 0, 0, w, h);
        const bytes = octx.getImageData(0, 0, w, h).data;
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
      }, { t: st, w: gifW, h: gifH });
      sampleRgbas.push(Buffer.from(b64, 'base64'));
    }

    const { palette, lut } = buildPaletteAndLut(sampleRgbas);
    const gif = new GifWriter(gifW, gifH, palette);

    for (let f = 0; f < totalFrames; f++) {
      const t = (f / fps);
      const b64 = await snapPage.evaluate(({ t, w, h }) => {
        window.seekTo(t);
        const off = window.__offCanvas;
        const octx = off.getContext('2d');
        octx.drawImage(document.getElementById('stage'), 0, 0, w, h);
        const bytes = octx.getImageData(0, 0, w, h).data;
        const rgb565 = new Uint16Array(w * h);
        for (let i = 0, p = 0; i < bytes.length; i += 4, p++) {
          rgb565[p] = ((bytes[i] & 0xf8) << 8) | ((bytes[i + 1] & 0xfc) << 3) | (bytes[i + 2] >> 3);
        }
        const u8 = new Uint8Array(rgb565.buffer);
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < u8.length; i += chunk) {
          bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
        }
        return btoa(bin);
      }, { t, w: gifW, h: gifH });

      const raw = Buffer.from(b64, 'base64');
      const rgb565 = new Uint16Array(raw.buffer, raw.byteOffset, gifW * gifH);
      const indices = new Uint8Array(gifW * gifH);
      for (let p = 0; p < rgb565.length; p++) {
        indices[p] = lut[rgb565[p]];
      }
      gif.addFrame(indices, delayCs);
    }

    gif.finish(item.gifFile);
    console.log(`[${item.code}] Saved animated GIF: ${item.gifFile} (${(fs.statSync(item.gifFile).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  await snapPage.close();

  console.log('Recording 1080p mobile showcase WebM videos for all locales in parallel...');
  const tempVideoDir = path.resolve('docs/.temp_mobile_videos');
  if (!fs.existsSync(tempVideoDir)) {
    fs.mkdirSync(tempVideoDir, { recursive: true });
  }

  await Promise.all(locales.map(async (item) => {
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

    await page.goto(`${promoUrl}?lang=${item.code}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(15500);

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
      console.log(`[${item.code}] Saved video: ${item.videoFile} (${(fs.statSync(item.videoFile).size / 1024 / 1024).toFixed(2)} MB)`);
    }
  }));

  try {
    if (fs.existsSync(tempVideoDir)) {
      fs.rmSync(tempVideoDir, { recursive: true, force: true });
    }
  } catch (e) {}

  await browser.close();
  console.log('All multilingual Mobile & Voice promo snapshots, GIFs, and WebM videos successfully produced!');
}

main().catch(err => {
  console.error('Mobile promo asset generation failed:', err);
  process.exit(1);
});
