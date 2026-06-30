#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const metaUrl = new URL(
  "../src/lib/pipeline/__tests__/fixtures/line-art-samples/c_00012.meta.json",
  import.meta.url,
);
const meta = JSON.parse(readFileSync(metaUrl, "utf8"));
const dstPath = process.argv[2] ?? meta.localReferencePaths.generatedDst;

console.log("Line-Art Real Sample Comparison");
console.log("================================");
console.log("");
console.log(`sampleId        ${meta.id}`);
console.log(`sourceImage     ${meta.sourceImage}`);
console.log(`wilcomReference ${meta.wilcomReferenceImage}`);
console.log(`generatedDst    ${basename(dstPath)}`);
console.log("");
console.log("Local paths");
console.log(`sourceImage     ${meta.localReferencePaths.sourceImage}`);
console.log(`wilcomReference ${meta.localReferencePaths.wilcomReferenceImage}`);
console.log(`generatedDst    ${dstPath}`);
console.log("");

if (!existsSync(dstPath)) {
  console.log("DST file not found. Pass a generated DST path as the first argument.");
  process.exitCode = 1;
} else {
  const bytes = readFileSync(dstPath);
  const analysis = analyzeDstBytes(bytes);
  console.log("Current DST metrics");
  console.log(`bytes           ${analysis.byteLength}`);
  console.log(`records         ${analysis.recordCount}`);
  console.log(`stitches        ${analysis.stitchCount}`);
  console.log(`jumps           ${analysis.jumpCount}`);
  console.log(`jumpRatio       ${(analysis.jumpRatio * 100).toFixed(1)}%`);
  console.log(`stops           ${analysis.stopCount}`);
  console.log(`longestJumpMm   ${analysis.longestJumpMm.toFixed(1)}`);
  console.log(`jumpRuns        ${analysis.consecutiveJumpRunCount}`);
  console.log(`maxJumpRun      ${analysis.maxConsecutiveJumpRun}`);
  console.log(`colorBlocks     ${analysis.colorBlockCount}`);
}

console.log("");
console.log("Professional target traits");
for (const trait of meta.expectedProfessionalTraits) {
  console.log(`- ${trait}`);
}
console.log("");
console.log("Synthetic benchmark:");
console.log("  node scripts/benchmark-phase3.mjs");

function analyzeDstBytes(bytes) {
  if (bytes.length < 512) throw new Error("DST header is missing or incomplete");
  const recordCount = Math.floor((bytes.length - 512) / 3);
  let stitchCount = 0;
  let jumpCount = 0;
  let stopCount = 0;
  let endCount = 0;
  let otherCount = 0;
  let longestJumpMm = 0;
  let consecutiveJumpRunCount = 0;
  let maxConsecutiveJumpRun = 0;
  let currentJumpRun = 0;

  for (let i = 0; i < recordCount; i++) {
    const record = bytes.subarray(512 + i * 3, 512 + i * 3 + 3);
    const kind = classifyDstRecord(record);
    if (kind === "stitch") stitchCount += 1;
    else if (kind === "jump") jumpCount += 1;
    else if (kind === "stop") stopCount += 1;
    else if (kind === "end") endCount += 1;
    else otherCount += 1;

    if (kind === "jump") {
      const { dx, dy } = decodeDstDelta(record);
      longestJumpMm = Math.max(longestJumpMm, Math.hypot(dx, dy) / 10);
      currentJumpRun += 1;
      maxConsecutiveJumpRun = Math.max(maxConsecutiveJumpRun, currentJumpRun);
    } else {
      if (currentJumpRun > 0) consecutiveJumpRunCount += 1;
      currentJumpRun = 0;
    }
  }
  if (currentJumpRun > 0) consecutiveJumpRunCount += 1;
  const commandCount = stitchCount + jumpCount + stopCount + otherCount;

  return {
    byteLength: bytes.length,
    recordCount,
    stitchCount,
    jumpCount,
    stopCount,
    endCount,
    otherCount,
    jumpRatio: commandCount === 0 ? 0 : jumpCount / commandCount,
    longestJumpMm,
    consecutiveJumpRunCount,
    maxConsecutiveJumpRun,
    colorBlockCount: commandCount === 0 ? 0 : stopCount + 1,
  };
}

function classifyDstRecord(record) {
  const [b0, b1, b2] = record;
  if (b0 === 0x00 && b1 === 0x00 && b2 === 0xf3) return "end";
  if ((b2 & 0xc0) === 0xc0) return "stop";
  if ((b2 & 0x80) === 0x80) return "jump";
  if ((b2 & 0x03) === 0x03) return "stitch";
  return "other";
}

function decodeDstDelta(record) {
  const [b0, b1, b2] = record;
  let dx = 0;
  let dstDy = 0;
  dx += bit(b2, 0x04) * 81 - bit(b2, 0x08) * 81;
  dx += bit(b1, 0x04) * 27 - bit(b1, 0x08) * 27;
  dx += bit(b0, 0x04) * 9 - bit(b0, 0x08) * 9;
  dx += bit(b1, 0x01) * 3 - bit(b1, 0x02) * 3;
  dx += bit(b0, 0x01) * 1 - bit(b0, 0x02) * 1;
  dstDy += bit(b2, 0x20) * 81 - bit(b2, 0x10) * 81;
  dstDy += bit(b1, 0x20) * 27 - bit(b1, 0x10) * 27;
  dstDy += bit(b0, 0x20) * 9 - bit(b0, 0x10) * 9;
  dstDy += bit(b1, 0x80) * 3 - bit(b1, 0x40) * 3;
  dstDy += bit(b0, 0x80) * 1 - bit(b0, 0x40) * 1;
  return { dx, dy: -dstDy };
}

function bit(value, mask) {
  return (value & mask) === mask ? 1 : 0;
}
