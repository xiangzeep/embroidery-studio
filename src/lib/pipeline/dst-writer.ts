import type { Stitch, StitchPattern } from "./types";

const DST_HEADER_SIZE = 512;
const DST_END = [0x00, 0x00, 0xf3] as const;
const MAX_DST_DELTA = 121;
const MAX_DST_MOVE = 100;

type Command = "stitch" | "jump" | "stop";

export function writeDst(pattern: StitchPattern): Blob {
  const bytes = writeDstBytes(pattern);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "application/octet-stream" });
}

export function writeDstBytes(pattern: StitchPattern): Uint8Array {
  const records: number[] = [];
  let currentX = 0;
  let currentY = 0;
  let stitchRecords = 0;
  let colorChanges = 0;

  for (const block of pattern.blocks) {
    for (const stitch of block.stitches) {
      const targetX = Math.round(stitch.x * 10);
      const targetY = Math.round(stitch.y * 10);
      const command = commandForStitch(stitch);
      const moves = splitDelta(targetX - currentX, targetY - currentY);
      for (let i = 0; i < moves.length; i++) {
        const [dx, dy] = moves[i];
        const partCommand = i === moves.length - 1 ? command : "jump";
        records.push(...encodeRecord(dx, dy, partCommand));
        currentX += dx;
        currentY += dy;
        if (partCommand === "stop") colorChanges += 1;
        else stitchRecords += 1;
      }
    }
  }

  records.push(...DST_END);
  const header = makeHeader(pattern, stitchRecords, colorChanges);
  const out = new Uint8Array(header.length + records.length);
  out.set(header, 0);
  out.set(records, header.length);
  return out;
}

function commandForStitch(stitch: Stitch): Command {
  if (stitch.kind === "stop") return "stop";
  if (stitch.kind === "jump" || stitch.kind === "trim") return "jump";
  return "stitch";
}

function splitDelta(dx: number, dy: number): [number, number][] {
  const distance = Math.hypot(dx, dy);
  let steps = Math.max(
    1,
    Math.ceil(Math.abs(dx) / MAX_DST_DELTA),
    Math.ceil(Math.abs(dy) / MAX_DST_DELTA),
    Math.ceil(distance / MAX_DST_MOVE),
  );

  while (steps < 10000) {
    const moves: [number, number][] = [];
    let lastX = 0;
    let lastY = 0;
    let valid = true;

    for (let step = 1; step <= steps; step++) {
      const nextX = Math.round((dx * step) / steps);
      const nextY = Math.round((dy * step) / steps);
      const move: [number, number] = [nextX - lastX, nextY - lastY];
      if (!isEncodableMove(move)) {
        valid = false;
        break;
      }
      moves.push(move);
      lastX = nextX;
      lastY = nextY;
    }

    if (valid) return moves;
    steps++;
  }

  throw new Error(`DST delta could not be split into encodable moves: ${dx}, ${dy}`);
}

function encodeRecord(dx: number, dy: number, command: Command): number[] {
  const bytes = [0, 0, 0x03];
  const dstDy = -dy;
  applyAxis(bytes, dx, [
    [81, 2, 0x04],
    [27, 1, 0x04],
    [9, 0, 0x04],
    [3, 1, 0x01],
    [1, 0, 0x01],
  ], [
    [81, 2, 0x08],
    [27, 1, 0x08],
    [9, 0, 0x08],
    [3, 1, 0x02],
    [1, 0, 0x02],
  ]);
  applyAxis(bytes, dstDy, [
    [81, 2, 0x20],
    [27, 1, 0x20],
    [9, 0, 0x20],
    [3, 1, 0x80],
    [1, 0, 0x80],
  ], [
    [81, 2, 0x10],
    [27, 1, 0x10],
    [9, 0, 0x10],
    [3, 1, 0x40],
    [1, 0, 0x40],
  ]);

  if (command === "jump") bytes[2] |= 0x80;
  if (command === "stop") bytes[2] |= 0xc0;
  return bytes;
}

function isEncodableMove([dx, dy]: [number, number]): boolean {
  return Math.abs(dx) <= MAX_DST_DELTA &&
    Math.abs(dy) <= MAX_DST_DELTA &&
    Math.hypot(dx, dy) <= MAX_DST_MOVE &&
    canEncodeAxis(dx) &&
    canEncodeAxis(-dy);
}

function canEncodeAxis(value: number): boolean {
  return findAxisBitPlan(value, [
    [81, 2, 0x04],
    [27, 1, 0x04],
    [9, 0, 0x04],
    [3, 1, 0x01],
    [1, 0, 0x01],
  ], [
    [81, 2, 0x08],
    [27, 1, 0x08],
    [9, 0, 0x08],
    [3, 1, 0x02],
    [1, 0, 0x02],
  ]) !== null;
}


function applyAxis(
  bytes: number[],
  value: number,
  positiveBits: [number, number, number][],
  negativeBits: [number, number, number][],
): void {
  const bitPlan = findAxisBitPlan(value, positiveBits, negativeBits);
  if (bitPlan === null) {
    throw new Error(`DST delta could not be encoded exactly: ${value}`);
  }
  for (const [, byteIndex, bit] of bitPlan) {
    bytes[byteIndex] |= bit;
  }
}

function findAxisBitPlan(
  value: number,
  positiveBits: [number, number, number][],
  negativeBits: [number, number, number][],
): [number, number, number][] | null {
  const choices: Array<{ signedWeight: number; bit: [number, number, number] }> = [];
  for (const bit of positiveBits) choices.push({ signedWeight: bit[0], bit });
  for (const bit of negativeBits) choices.push({ signedWeight: -bit[0], bit });

  let best: [number, number, number][] | null = null;
  const totalMasks = 1 << choices.length;
  for (let mask = 0; mask < totalMasks; mask++) {
    let sum = 0;
    const plan: [number, number, number][] = [];
    for (let i = 0; i < choices.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      sum += choices[i].signedWeight;
      plan.push(choices[i].bit);
    }
    if (sum !== value) continue;
    if (best === null || plan.length < best.length) best = plan;
  }
  return best;
}


function makeHeader(
  pattern: StitchPattern,
  stitchRecords: number,
  colorChanges: number,
): Uint8Array {
  const extents = patternExtents(pattern);
  const lines = [
    `LA:${padRight("EmbroideryStudio", 16)}`,
    `ST:${padLeft(String(stitchRecords), 7)}`,
    `CO:${padLeft(String(colorChanges), 3)}`,
    `+X:${padLeft(String(Math.max(0, extents.maxX)), 5)}`,
    `-X:${padLeft(String(Math.max(0, -extents.minX)), 5)}`,
    `+Y:${padLeft(String(Math.max(0, extents.maxY)), 5)}`,
    `-Y:${padLeft(String(Math.max(0, -extents.minY)), 5)}`,
    "AX:+    0",
    "AY:+    0",
    "MX:+    0",
    "MY:+    0",
    "PD:******",
  ];
  const bytes = new Uint8Array(DST_HEADER_SIZE).fill(0x20);
  const text = `${lines.join("\r")}\r\x1a`;
  const encoded = new TextEncoder().encode(text.slice(0, DST_HEADER_SIZE));
  bytes.set(encoded.slice(0, DST_HEADER_SIZE));
  return bytes;
}

function patternExtents(pattern: StitchPattern): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const block of pattern.blocks) {
    for (const stitch of block.stitches) {
      const x = Math.round(stitch.x * 10);
      const y = Math.round(stitch.y * 10);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
}

function padLeft(value: string, size: number): string {
  return value.padStart(size, " ").slice(-size);
}

function padRight(value: string, size: number): string {
  return value.padEnd(size, " ").slice(0, size);
}
