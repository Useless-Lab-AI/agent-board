import { useMemo } from 'react';

/**
 * Antigravity-style Pure SVG QR Code Generator (Zero Dependencies)
 * Implements ISO/IEC 18004 Reed-Solomon QR encoding with rounded SVG modules
 * and custom finder eye rings matching Antigravity's Remote Control dialog.
 */

type EccLevel = 0 | 1 | 2 | 3; // 0: L, 1: M, 2: Q, 3: H

const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const ECC_FORMAT_BITS = [1, 0, 3, 2];

function getBit(val: number, bit: number): boolean {
  return ((val >>> bit) & 1) !== 0;
}

function appendBits(val: number, len: number, out: number[]): void {
  for (let i = len - 1; i >= 0; i--) {
    out.push((val >>> i) & 1);
  }
}

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver: number, ecl: EccLevel): number {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver]
  );
}

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonComputeDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[divisor.length - 1] = 0;
    divisor.forEach((coef, i) => {
      result[i] ^= reedSolomonMultiply(coef, factor);
    });
  }
  return result;
}

function getAlignmentPatternPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step =
    ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

export function encodeQrMatrix(text: string, ecl: EccLevel = 0): QrMatrix {
  const dataBytes = new TextEncoder().encode(text);
  let version = 1;
  for (; version <= 40; version++) {
    const capacityBits = getNumDataCodewords(version, ecl) * 8;
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + dataBytes.length * 8 <= capacityBits) break;
  }
  if (version > 40) version = 40;

  const bits: number[] = [];
  appendBits(0b0100, 4, bits);
  appendBits(dataBytes.length, version <= 9 ? 8 : 16, bits);
  for (const b of dataBytes) appendBits(b, 8, bits);

  const dataCapacityBits = getNumDataCodewords(version, ecl) * 8;
  appendBits(0, Math.min(4, dataCapacityBits - bits.length), bits);
  appendBits(0, (8 - (bits.length % 8)) % 8, bits);
  for (let padByte = 0xec; bits.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
    appendBits(padByte, 8, bits);
  }

  const dataCodewords = new Uint8Array(bits.length / 8);
  bits.forEach((bit, idx) => {
    dataCodewords[idx >>> 3] |= bit << (7 - (idx & 7));
  });

  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: Uint8Array[] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = dataCodewords.subarray(
      k,
      k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1),
    );
    k += dat.length;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) {
      const block = new Uint8Array(shortBlockLen + 1);
      block.set(dat, 0);
      block.set(ecc, shortBlockLen - blockEccLen + 1);
      blocks.push(block);
    } else {
      const block = new Uint8Array(shortBlockLen + 1);
      block.set(dat, 0);
      block.set(ecc, shortBlockLen - blockEccLen + 1);
      blocks.push(block);
    }
  }

  const allCodewords = new Uint8Array(rawCodewords);
  let ptr = 0;
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        allCodewords[ptr++] = block[i];
      }
    });
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );

  const setFunctionModule = (x: number, y: number, isDark: boolean) => {
    modules[y][x] = isDark;
    isFunction[y][x] = true;
  };

  const drawFinderPattern = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  const drawAlignmentPattern = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  for (let i = 0; i < size; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  drawFinderPattern(3, 3);
  drawFinderPattern(size - 4, 3);
  drawFinderPattern(3, size - 4);

  const alignPos = getAlignmentPatternPositions(version);
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      if (
        !(
          (i === 0 && j === 0) ||
          (i === 0 && j === alignPos.length - 1) ||
          (i === alignPos.length - 1 && j === 0)
        )
      ) {
        drawAlignmentPattern(alignPos[i], alignPos[j]);
      }
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(size - 1 - i, 8, false);
    setFunctionModule(8, size - 1 - i, false);
  }
  setFunctionModule(8, size - 8, true);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const verBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(verBits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(a, b, bit);
      setFunctionModule(b, a, bit);
    }
  }

  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIdx < allCodewords.length * 8) {
          modules[y][x] = getBit(allCodewords[bitIdx >>> 3], 7 - (bitIdx & 7));
          bitIdx++;
        }
      }
    }
  }

  const drawFormatBits = (mask: number) => {
    const data = (ECC_FORMAT_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bitsVal = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getBit(bitsVal, i));
    setFunctionModule(8, 7, getBit(bitsVal, 6));
    setFunctionModule(8, 8, getBit(bitsVal, 7));
    setFunctionModule(7, 8, getBit(bitsVal, 8));
    for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getBit(bitsVal, i));
    for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getBit(bitsVal, i));
    for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getBit(bitsVal, i));
    setFunctionModule(8, size - 8, true);
  };

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert = false;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          case 7:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  };

  const computePenalty = (): number => {
    let penalty = 0;
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runX = 0;
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runX++;
          if (runX === 5) penalty += 3;
          else if (runX > 5) penalty++;
        } else {
          runColor = modules[y][x];
          runX = 1;
        }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runY = 0;
      for (let y = 0; y < size; y++) {
        if (modules[y][x] === runColor) {
          runY++;
          if (runY === 5) penalty += 3;
          else if (runY > 5) penalty++;
        } else {
          runColor = modules[y][x];
          runY = 1;
        }
      }
    }
    return penalty;
  };

  let bestMask = 0;
  let minPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormatBits(m);
    const p = computePenalty();
    if (p < minPenalty) {
      minPenalty = p;
      bestMask = m;
    }
    applyMask(m);
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return { size, modules };
}

function isFinderEye(x: number, y: number, size: number): boolean {
  return (
    (x < 7 && y < 7) ||
    (x >= size - 7 && y < 7) ||
    (x < 7 && y >= size - 7)
  );
}

export function QrCode({
  value,
  size = 188,
  quietZone = 1,
  moduleRounding = 0.35,
  className,
}: {
  value: string;
  size?: number;
  quietZone?: number;
  moduleRounding?: number;
  className?: string;
}) {
  const { viewSize, pathData, eyes } = useMemo(() => {
    const qr = encodeQrMatrix(value || 'http://127.0.0.1:4317', 0);
    const n = qr.size;
    const total = n + quietZone * 2;
    const r = Math.min(Math.max(moduleRounding, 0), 0.5);
    const fmt = (num: number) => Number(num.toFixed(3));

    const segments: string[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.modules[y][x] || isFinderEye(x, y, n)) continue;
        const px = x + quietZone;
        const py = y + quietZone;

        const top =
          y > 0 && qr.modules[y - 1][x] && !isFinderEye(x, y - 1, n);
        const right =
          x < n - 1 && qr.modules[y][x + 1] && !isFinderEye(x + 1, y, n);
        const bottom =
          y < n - 1 && qr.modules[y + 1][x] && !isFinderEye(x, y + 1, n);
        const left =
          x > 0 && qr.modules[y][x - 1] && !isFinderEye(x - 1, y, n);

        const tl = !top && !left ? r : 0;
        const tr = !top && !right ? r : 0;
        const br = !bottom && !right ? r : 0;
        const bl = !bottom && !left ? r : 0;

        if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
          segments.push(`M${px} ${py}h1v1h-1Z`);
        } else {
          segments.push(
            [
              `M${fmt(px + tl)} ${fmt(py)}`,
              `H${fmt(px + 1 - tr)}`,
              tr
                ? `A${fmt(tr)} ${fmt(tr)} 0 0 1 ${fmt(px + 1)} ${fmt(py + tr)}`
                : '',
              `V${fmt(py + 1 - br)}`,
              br
                ? `A${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(px + 1 - br)} ${fmt(py + 1)}`
                : '',
              `H${fmt(px + bl)}`,
              bl
                ? `A${fmt(bl)} ${fmt(bl)} 0 0 1 ${fmt(px)} ${fmt(py + 1 - bl)}`
                : '',
              `V${fmt(py + tl)}`,
              tl
                ? `A${fmt(tl)} ${fmt(tl)} 0 0 1 ${fmt(px + tl)} ${fmt(py)}`
                : '',
              'Z',
            ].join(''),
          );
        }
      }
    }

    const eyePositions = [
      { x: quietZone, y: quietZone },
      { x: quietZone + n - 7, y: quietZone },
      { x: quietZone, y: quietZone + n - 7 },
    ];

    return {
      viewSize: total,
      pathData: segments.join(''),
      eyes: eyePositions,
    };
  }, [value, quietZone, moduleRounding]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      fill="none"
      role="img"
      aria-label="QR Code"
      className={className}
    >
      <path d={pathData} fill="currentColor" />
      {eyes.map((eye, idx) => (
        <g key={idx}>
          <rect
            x={eye.x + 0.5}
            y={eye.y + 0.5}
            width={6}
            height={6}
            rx={1.6}
            stroke="currentColor"
            strokeWidth={1}
          />
          <rect
            x={eye.x + 2}
            y={eye.y + 2}
            width={3}
            height={3}
            rx={0.75}
            fill="currentColor"
          />
        </g>
      ))}
    </svg>
  );
}
