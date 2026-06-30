import type { Stitch, StitchBlock, StitchPattern } from "./types";

const EPS = 1e-6;
const MAX_JUMP_STEP_MM = 10;

export function optimizeStitches(stitches: Stitch[]): Stitch[] {
  const out: Stitch[] = [];
  for (const stitch of stitches) {
    if (isZeroDistanceJump(out[out.length - 1], stitch)) continue;
    if (stitch.kind === "trim") {
      pushTrim(out, stitch);
      continue;
    }
    if (stitch.kind === "jump") {
      pushJump(out, stitch);
      continue;
    }
    if (stitch.kind === "stop") {
      pushStop(out, stitch);
      continue;
    }
    pushRealStitch(out, stitch);
  }
  return splitLongJumps(removeTrailingMeaninglessCommands(out));
}

export function optimizePatternCommands(pattern: StitchPattern): StitchPattern {
  const blocks = pattern.blocks
    .map((block, index) => optimizeBlock(block, index < pattern.blocks.length - 1))
    .filter((block) => block.stitches.length > 0);
  return {
    ...pattern,
    blocks,
    totalStitches: countRealStitches(blocks),
  };
}

function optimizeBlock(block: StitchBlock, shouldEndWithStop: boolean): StitchBlock {
  let stitches = optimizeStitches(block.stitches);
  stitches = stitches.filter((stitch, index) => {
    if (stitch.kind !== "stop") return true;
    return shouldEndWithStop && index === stitches.length - 1;
  });
  if (shouldEndWithStop && stitches.length > 0 && stitches[stitches.length - 1].kind !== "stop") {
    const last = stitches[stitches.length - 1];
    stitches = [...stitches, { x: last.x, y: last.y, kind: "stop", colorIndex: block.colorIndex }];
  }
  return { ...block, stitches };
}

function pushTrim(out: Stitch[], trim: Stitch): void {
  while (out.length > 0 && (out[out.length - 1].kind === "trim" || out[out.length - 1].kind === "jump")) {
    out.pop();
  }
  out.push(trim);
}

function pushJump(out: Stitch[], jump: Stitch): void {
  const previous = out[out.length - 1];
  if (previous?.kind === "jump") {
    out[out.length - 1] = jump;
    return;
  }
  if (previous?.kind === "trim" && pointsClose(previous, jump)) {
    out.push(jump);
    return;
  }
  out.push(jump);
}

function pushStop(out: Stitch[], stop: Stitch): void {
  if (out[out.length - 1]?.kind === "trim") out.pop();
  if (out[out.length - 1]?.kind === "stop") {
    out[out.length - 1] = stop;
    return;
  }
  out.push(stop);
}

function pushRealStitch(out: Stitch[], stitch: Stitch): void {
  if (out[out.length - 1]?.kind === "trim") out.pop();
  out.push(stitch);
}

function removeTrailingMeaninglessCommands(stitches: Stitch[]): Stitch[] {
  const out = [...stitches];
  while (out.length > 0 && (out[out.length - 1].kind === "trim" || out[out.length - 1].kind === "jump")) {
    out.pop();
  }
  return out;
}

function splitLongJumps(stitches: Stitch[]): Stitch[] {
  const out: Stitch[] = [];
  for (const stitch of stitches) {
    if (stitch.kind !== "jump" || out.length === 0) {
      out.push(stitch);
      continue;
    }
    const previous = out[out.length - 1];
    const dx = stitch.x - previous.x;
    const dy = stitch.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= MAX_JUMP_STEP_MM || distance <= EPS) {
      out.push(stitch);
      continue;
    }
    const steps = Math.ceil(distance / MAX_JUMP_STEP_MM);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push({
        x: previous.x + dx * t,
        y: previous.y + dy * t,
        kind: "jump",
        colorIndex: stitch.colorIndex,
      });
    }
  }
  return out;
}

function isZeroDistanceJump(previous: Stitch | undefined, stitch: Stitch): boolean {
  if (!previous) return false;
  if (stitch.kind !== "jump") return false;
  return pointsClose(previous, stitch);
}

function pointsClose(a: Stitch, b: Stitch): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function countRealStitches(blocks: StitchBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    for (const stitch of block.stitches) {
      if (stitch.kind === "run" || stitch.kind === "satin" || stitch.kind === "fill") total++;
    }
  }
  return total;
}
