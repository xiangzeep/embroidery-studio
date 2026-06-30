import type { Stitch, StitchPattern } from "./types";

export type PatternWarning = {
  level: "info" | "warning" | "danger";
  code: string;
  message: string;
};

export type PatternStats = {
  stitchCount: number;
  blockCount: number;
  colorCount: number;
  jumpCount: number;
  trimCount: number;
  stopCount: number;
  maxStitchLengthMm: number;
  averageStitchLengthMm: number;
  threadLengthMm: number;
  travelLengthMm: number;
  tinyBlockCount: number;
  warnings: PatternWarning[];
};

const CONTROL_KINDS = new Set<Stitch["kind"]>(["jump", "trim", "stop"]);
const TINY_BLOCK_STITCH_LIMIT = 10;

export function analyzePattern(pattern: StitchPattern): PatternStats {
  let stitchCount = 0;
  let jumpCount = 0;
  let trimCount = 0;
  let stopCount = 0;
  let tinyBlockCount = 0;
  let maxStitchLengthMm = 0;
  let stitchLengthTotalMm = 0;
  let measuredStitchLengths = 0;
  let travelLengthMm = 0;
  const colors = new Set<number>();

  for (const block of pattern.blocks) {
    colors.add(block.colorIndex);
    let blockStitchCount = 0;
    let previous: Stitch | null = null;

    for (const stitch of block.stitches) {
      if (stitch.kind === "jump") jumpCount += 1;
      if (stitch.kind === "trim") trimCount += 1;
      if (stitch.kind === "stop") stopCount += 1;
      if (!CONTROL_KINDS.has(stitch.kind)) {
        stitchCount += 1;
        blockStitchCount += 1;
      }

      if (previous) {
        const lengthMm = distance(previous, stitch);
        const isTravelMove = CONTROL_KINDS.has(stitch.kind) || CONTROL_KINDS.has(previous.kind);
        if (lengthMm > 0) {
          if (!isTravelMove) {
            maxStitchLengthMm = Math.max(maxStitchLengthMm, lengthMm);
            stitchLengthTotalMm += lengthMm;
            measuredStitchLengths += 1;
          }
        }
        if (isTravelMove) {
          travelLengthMm += lengthMm;
        }
      }
      previous = stitch;
    }

    if (blockStitchCount > 0 && blockStitchCount < TINY_BLOCK_STITCH_LIMIT) {
      tinyBlockCount += 1;
    }
  }

  const averageStitchLengthMm = measuredStitchLengths === 0
    ? 0
    : stitchLengthTotalMm / measuredStitchLengths;
  const effectiveStitchCount = Math.max(stitchCount, pattern.totalStitches);
  const colorCount = colors.size;
  const warnings: PatternWarning[] = [];

  if (maxStitchLengthMm > 12) {
    warnings.push({
      level: "warning",
      code: "long-stitch",
      message: "One or more stitches are longer than 12 mm.",
    });
  }
  if (jumpCount > Math.max(1, colorCount) * 8) {
    warnings.push({
      level: "warning",
      code: "many-jumps",
      message: "The pattern has many jumps for its color count.",
    });
  }
  if (effectiveStitchCount > 50000) {
    warnings.push({
      level: "danger",
      code: "high-stitch-count",
      message: "The pattern has more than 50,000 stitches.",
    });
  }

  return {
    stitchCount: effectiveStitchCount,
    blockCount: pattern.blocks.length,
    colorCount,
    jumpCount,
    trimCount,
    stopCount,
    maxStitchLengthMm,
    averageStitchLengthMm,
    threadLengthMm: stitchLengthTotalMm,
    travelLengthMm,
    tinyBlockCount,
    warnings,
  };
}

function distance(a: Stitch, b: Stitch): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
