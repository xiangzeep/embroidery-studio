// English note.
//
// English note.
// English note.
// English note.
// English note.
//
// English note.
// English note.
// English note.
//
// English note.

import { skeletonizeMask } from "./skeleton";
import { centerRunUnderlay } from "./underlay";
import { __internal as underlayInternal } from "./underlay";
import { extractRails } from "./satin";
import type { Point2D, Shape, SkeletonBranch, SkeletonGraph } from "./types";

const MIN_RAIL_MIDLINE_AREA_MM2 = 0.25;
const SKELETON_RUN_PX_PER_MM = 10;
const MAX_SKELETON_RUN_RASTER_PIXELS = 220_000;
const JUNCTION_RETRACT_MM = 0.12;
const LOOP_CLOSE_THRESHOLD_MM = 0.85;
const MIN_OPEN_BRANCH_LENGTH_MM = 0.75;
const HEAL_GAP_MM = 1.2;
const HEAL_DIRECTION_COS = 0.25;

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
export function medialAxisRun(shape: Shape, stitchLenMm: number): Point2D[] {
  const routed = medialAxisRunSegments(shape, stitchLenMm);
  if (routed.length > 0) return flattenRunSegments(routed);
  return [];
}

export function medialAxisRunSegments(shape: Shape, stitchLenMm: number): Point2D[][] {
  const routed = branchAwareSkeletonRunSegments(shape, stitchLenMm);
  if (routed.length > 0) return routed;
  const centerline = centerRunUnderlay(shape, stitchLenMm);
  if (centerline.length >= 2) return [finalizeRunPath(centerline, shape)];
  const rail = railMidlineRun(shape, stitchLenMm);
  return rail.length >= 2 ? [finalizeRunPath(rail, shape)] : [];
}

export function lightweightRunSegments(shape: Shape, stitchLenMm: number): Point2D[][] {
  const centerline = centerRunUnderlay(shape, stitchLenMm);
  if (centerline.length >= 2) return [processLightweightRunPolyline(finalizeRunPath(centerline, shape), stitchLenMm)];
  const rail = railMidlineRun(shape, stitchLenMm);
  return rail.length >= 2 ? [processLightweightRunPolyline(finalizeRunPath(rail, shape), stitchLenMm)] : [];
}

function branchAwareSkeletonRunSegments(shape: Shape, stitchLenMm: number): Point2D[][] {
  if (stitchLenMm <= 0 || shape.outer.length < 3) return [];
  if (Math.abs(polygonArea(shape.outer)) < MIN_RAIL_MIDLINE_AREA_MM2) return [];
  if (estimatedRasterPixelsForShape(shape, SKELETON_RUN_PX_PER_MM) > MAX_SKELETON_RUN_RASTER_PIXELS) {
    return [];
  }

  const raster = underlayInternal.rasterizeShapeToMask(shape, SKELETON_RUN_PX_PER_MM);
  const graph = skeletonizeMask({
    data: raster.mask,
    width: raster.width,
    height: raster.height,
  });
  const sampled = routeSkeletonGraphBranchSegments(graph, raster, stitchLenMm, shape);
  if (sampled.length === 0) return [];
  return sampled;
}

function railMidlineRun(shape: Shape, stitchLenMm: number): Point2D[] {
  if (stitchLenMm <= 0 || shape.outer.length < 3 || shape.holes.length > 0) {
    return [];
  }
  if (Math.abs(polygonArea(shape.outer)) < MIN_RAIL_MIDLINE_AREA_MM2) return [];

  const rails = extractRails(shape);
  if (rails.left.length < 2 || rails.right.length < 2) return [];

  const left = stripClosingDuplicate(rails.left);
  const right = stripClosingDuplicate(rails.right);
  if (left.length < 2 || right.length < 2) return [];

  const leftLengths = cumulativeLengths(left);
  const rightLengths = cumulativeLengths(right);
  const total = Math.max(leftLengths.total, rightLengths.total);
  if (total <= 1e-6) return [];

  const sampleCount = Math.max(2, Math.ceil(total / stitchLenMm));
  const midline: Point2D[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const a = arcLengthSample(left, leftLengths.lens, leftLengths.total, t);
    const b = arcLengthSample(right, rightLengths.lens, rightLengths.total, t);
    midline.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return dedupeSequential(midline);
}

function estimatedRasterPixelsForShape(shape: Shape, pxPerMm: number): number {
  const xs = shape.outer.map(([x]) => x);
  const ys = shape.outer.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.max(1, Math.ceil(width * pxPerMm) + 4) *
    Math.max(1, Math.ceil(height * pxPerMm) + 4);
}

function stripClosingDuplicate(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first[0] - last[0]) <= 1e-6 && Math.abs(first[1] - last[1]) <= 1e-6) {
    return points.slice(0, -1);
  }
  return points.slice();
}

function cumulativeLengths(points: Point2D[]): { lens: number[]; total: number } {
  const lens = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(total);
  }
  return { lens, total };
}

function arcLengthSample(
  points: Point2D[],
  lengths: number[],
  total: number,
  t: number,
): Point2D {
  if (points.length === 0) return [0, 0];
  if (points.length === 1 || total <= 1e-6) return [points[0][0], points[0][1]];

  const target = total * clamp01(t);
  let hi = 1;
  while (hi < lengths.length && lengths[hi] < target) hi++;
  if (hi >= lengths.length) {
    const last = points[points.length - 1];
    return [last[0], last[1]];
  }
  const lo = hi - 1;
  const start = points[lo];
  const end = points[hi];
  const span = lengths[hi] - lengths[lo];
  if (span <= 1e-6) return [start[0], start[1]];
  const localT = (target - lengths[lo]) / span;
  return [
    start[0] + (end[0] - start[0]) * localT,
    start[1] + (end[1] - start[1]) * localT,
  ];
}

function dedupeSequential(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points;
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const next = points[i];
    if (Math.abs(prev[0] - next[0]) <= 1e-6 && Math.abs(prev[1] - next[1]) <= 1e-6) {
      continue;
    }
    out.push(next);
  }
  return out;
}

function finalizeRunPath(points: Point2D[], shape: Shape): Point2D[] {
  return extendOpenPathToShape(dedupeSequential(points), shape);
}

function resampleOpenLine(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 2 || stitchLenMm <= 0) {
    return line.length > 0 ? [[line[0][0], line[0][1]]] : [];
  }
  let totalLen = 0;
  for (let i = 1; i < line.length; i++) {
    totalLen += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  if (totalLen < stitchLenMm) {
    return [
      [line[0][0], line[0][1]],
      [line[line.length - 1][0], line[line.length - 1][1]],
    ];
  }

  const count = Math.max(2, Math.round(totalLen / stitchLenMm) + 1);
  const step = totalLen / (count - 1);
  const out: Point2D[] = [];
  let cursor = 0;
  let edgeIdx = 0;
  let edgeStart = line[0];
  let edgeEnd = line[1];
  let edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);

  for (let k = 0; k < count; k++) {
    const target = step * k;
    while (cursor + edgeLen < target && edgeIdx < line.length - 2) {
      cursor += edgeLen;
      edgeIdx += 1;
      edgeStart = line[edgeIdx];
      edgeEnd = line[edgeIdx + 1];
      edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
    }
    const t = edgeLen === 0 ? 0 : Math.min(1, (target - cursor) / edgeLen);
    out.push([
      edgeStart[0] + (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] + (edgeEnd[1] - edgeStart[1]) * t,
    ]);
  }

  return dedupeSequential(out);
}

function prepareRunPolyline(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 3) return line.map(([x, y]) => [x, y]);

  const toleranceMm = clamp(stitchLenMm * 0.06, 0.08, 0.15);
  const simplified = simplifyRdp(line, toleranceMm);
  const smoothingIterations = simplified.length >= 6 ? 3 : 2;
  const smoothed = chaikinSmoothOpenLine(simplified, smoothingIterations);
  const fitted = clampedCatmullRomSpline(smoothed, 6);
  return dedupeSequential(fitted);
}

function prepareClosedRunPolyline(line: Point2D[], stitchLenMm: number): Point2D[] {
  const loop = stripClosingDuplicate(dedupeSequential(line));
  if (loop.length < 3) return line.map(([x, y]) => [x, y]);

  const toleranceMm = clamp(stitchLenMm * 0.04, 0.06, 0.12);
  const simplified = simplifyClosedRdp(loop, toleranceMm);
  const smoothingIterations = simplified.length >= 8 ? 6 : 5;
  const smoothed = chaikinSmoothClosedLine(simplified, smoothingIterations);
  const fitted = periodicCubicBSpline(smoothed, 6);
  return dedupeSequential(fitted);
}

function resampleAdaptiveOpenLine(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 2 || stitchLenMm <= 0) return resampleOpenLine(line, stitchLenMm);

  const minStep = clamp(stitchLenMm * 0.45, 0.65, 1.2);
  const curveStep = clamp(stitchLenMm * 0.8, 1.0, 1.6);
  const maxStep = clamp(stitchLenMm * 1.15, 2.2, 2.5);
  const out: Point2D[] = [[line[0][0], line[0][1]]];
  let distSinceLast = 0;

  for (let i = 1; i < line.length; i++) {
    let start: Point2D = [line[i - 1][0], line[i - 1][1]];
    const end = line[i];
    let segLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (segLen <= 1e-6) continue;

    while (segLen > 1e-6) {
      const stepTarget = desiredRunStep(line, i - 1, minStep, curveStep, maxStep);
      if (distSinceLast + segLen < stepTarget - 1e-6) {
        distSinceLast += segLen;
        break;
      }

      const needed = Math.max(stepTarget - distSinceLast, 0);
      const t = segLen <= 1e-6 ? 1 : needed / segLen;
      const placed: Point2D = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
      out.push(placed);
      start = placed;
      segLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
      distSinceLast = 0;
    }
  }

  const last = line[line.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1e-6) {
    out.push([last[0], last[1]]);
  }

  return dedupeSequential(out);
}

function resampleClosedLineByArcLength(line: Point2D[], stitchLenMm: number): Point2D[] {
  const loop = stripClosingDuplicate(dedupeSequential(line));
  if (loop.length < 3 || stitchLenMm <= 0) return line.map(([x, y]) => [x, y]);

  const lengths = [0];
  let total = 0;
  for (let i = 1; i <= loop.length; i++) {
    const prev = loop[i - 1];
    const next = loop[i % loop.length];
    total += Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    lengths.push(total);
  }
  if (total <= 1e-6) return ensureClosedLoop(loop);

  const targetStep = clamp(stitchLenMm * 0.55, 0.65, 1.2);
  const count = Math.max(6, Math.floor(total / targetStep));
  const step = total / count;
  const out: Point2D[] = [];
  for (let i = 0; i < count; i++) {
    out.push(sampleClosedArcLength(loop, lengths, step * i));
  }

  const rotated = rotateClosedLoopToHiddenSeam(dedupeSequential(out));
  const first = rotated[0];
  const last = rotated[rotated.length - 1];
  const closeGap = Math.hypot(first[0] - last[0], first[1] - last[1]);
  if (closeGap > LOOP_CLOSE_THRESHOLD_MM && rotated.length >= 3) {
    const beforeLast = rotated[rotated.length - 2];
    const tailLen = Math.hypot(first[0] - beforeLast[0], first[1] - beforeLast[1]);
    if (tailLen > LOOP_CLOSE_THRESHOLD_MM + 1e-6) {
      const t = (tailLen - LOOP_CLOSE_THRESHOLD_MM) / tailLen;
      rotated[rotated.length - 1] = [
        beforeLast[0] + (first[0] - beforeLast[0]) * t,
        beforeLast[1] + (first[1] - beforeLast[1]) * t,
      ];
    }
  }
  const minClosedStep = clamp(stitchLenMm * 0.38, 0.5, 0.85);
  return ensureClosedLoop(removeTinyClosedSteps(dedupeSequential(rotated), minClosedStep));
}

function ensureClosedLoop(points: Point2D[]): Point2D[] {
  if (points.length < 3) return points.map(([x, y]) => [x, y]);
  const out = points.map(([x, y]) => [x, y] as Point2D);
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
    out.push([first[0], first[1]]);
  } else {
    out[out.length - 1] = [first[0], first[1]];
  }
  return out;
}

function removeTinyClosedSteps(points: Point2D[], minStepMm: number): Point2D[] {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 4 || minStepMm <= 0) return loop.map(([x, y]) => [x, y]);

  const out: Point2D[] = [[loop[0][0], loop[0][1]]];
  for (let i = 1; i < loop.length; i++) {
    const prev = out[out.length - 1];
    const next = loop[i];
    if (Math.hypot(next[0] - prev[0], next[1] - prev[1]) < minStepMm && i < loop.length - 1) {
      continue;
    }
    out.push([next[0], next[1]]);
  }

  while (out.length > 3) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) >= minStepMm) break;
    out.pop();
  }

  return out;
}

function sampleClosedArcLength(points: Point2D[], lengths: number[], target: number): Point2D {
  const total = lengths[lengths.length - 1];
  const wrapped = ((target % total) + total) % total;
  let hi = 1;
  while (hi < lengths.length && lengths[hi] < wrapped) hi++;
  const lo = hi - 1;
  const start = points[lo % points.length];
  const end = points[hi % points.length];
  const span = lengths[hi] - lengths[lo];
  if (span <= 1e-6) return [start[0], start[1]];
  const t = (wrapped - lengths[lo]) / span;
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
}

function desiredRunStep(
  line: Point2D[],
  segmentStartIndex: number,
  minStep: number,
  curveStep: number,
  maxStep: number,
): number {
  const turn = localTurnAngle(line, Math.min(segmentStartIndex + 1, line.length - 2));
  if (turn >= Math.PI * 0.45) return minStep;
  if (turn >= Math.PI * 0.18) {
    const t = (turn - Math.PI * 0.18) / (Math.PI * 0.27);
    return curveStep + (minStep - curveStep) * clamp01(t);
  }
  const t = clamp01(turn / (Math.PI * 0.18));
  return maxStep + (curveStep - maxStep) * t;
}

function localTurnAngle(line: Point2D[], index: number): number {
  if (index <= 0 || index >= line.length - 1) return 0;
  const prev = line[index - 1];
  const current = line[index];
  const next = line[index + 1];
  const ax = current[0] - prev[0];
  const ay = current[1] - prev[1];
  const bx = next[0] - current[0];
  const by = next[1] - current[1];
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(bx, by);
  if (al <= 1e-6 || bl <= 1e-6) return 0;
  const dot = clamp((ax * bx + ay * by) / (al * bl), -1, 1);
  return Math.acos(dot);
}

function localClosedTurnAngle(line: Point2D[], index: number): number {
  if (line.length < 3) return 0;
  const prev = line[(index - 1 + line.length) % line.length];
  const current = line[index % line.length];
  const next = line[(index + 1) % line.length];
  return turnAngle(prev, current, next);
}

function turnAngle(prev: Point2D, current: Point2D, next: Point2D): number {
  const ax = current[0] - prev[0];
  const ay = current[1] - prev[1];
  const bx = next[0] - current[0];
  const by = next[1] - current[1];
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(bx, by);
  if (al <= 1e-6 || bl <= 1e-6) return 0;
  const dot = clamp((ax * bx + ay * by) / (al * bl), -1, 1);
  return Math.acos(dot);
}

function simplifyRdp(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2 || epsilon <= 0) return points.map(([x, y]) => [x, y]);

  let maxDistance = 0;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointToSegmentDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= epsilon || splitIndex === -1) {
    return [
      [start[0], start[1]],
      [end[0], end[1]],
    ];
  }

  const left = simplifyRdp(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function simplifyClosedRdp(points: Point2D[], epsilon: number): Point2D[] {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 4 || epsilon <= 0) return loop.map(([x, y]) => [x, y]);
  const closed = loop.concat([[loop[0][0], loop[0][1]]]);
  const simplified = stripClosingDuplicate(simplifyRdp(closed, epsilon));
  return simplified.length >= 3 ? simplified : loop.map(([x, y]) => [x, y]);
}

function pointToSegmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = clamp(((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / abLen2, 0, 1);
  const projX = a[0] + abx * t;
  const projY = a[1] + aby * t;
  return Math.hypot(point[0] - projX, point[1] - projY);
}

function clampedCatmullRomSpline(points: Point2D[], samplesPerSegment: number): Point2D[] {
  if (points.length < 3) return points.map(([x, y]) => [x, y]);
  const out: Point2D[] = [[points[0][0], points[0][1]]];
  const samples = Math.max(2, Math.floor(samplesPerSegment));
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 1; s <= samples; s++) {
      out.push(catmullRomPoint(p0, p1, p2, p3, s / samples));
    }
  }
  return dedupeSequential(out);
}

function periodicCatmullRomSpline(points: Point2D[], samplesPerSegment: number): Point2D[] {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 3) return loop.map(([x, y]) => [x, y]);
  const out: Point2D[] = [];
  const samples = Math.max(2, Math.floor(samplesPerSegment));
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[(i - 1 + loop.length) % loop.length];
    const p1 = loop[i];
    const p2 = loop[(i + 1) % loop.length];
    const p3 = loop[(i + 2) % loop.length];
    if (i === 0) out.push([p1[0], p1[1]]);
    for (let s = 1; s <= samples; s++) {
      out.push(catmullRomPoint(p0, p1, p2, p3, s / samples));
    }
  }
  return dedupeSequential(stripClosingDuplicate(out));
}

function periodicCubicBSpline(points: Point2D[], samplesPerSegment: number): Point2D[] {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 4) return periodicCatmullRomSpline(loop, samplesPerSegment);
  const out: Point2D[] = [];
  const samples = Math.max(2, Math.floor(samplesPerSegment));
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[(i - 1 + loop.length) % loop.length];
    const p1 = loop[i];
    const p2 = loop[(i + 1) % loop.length];
    const p3 = loop[(i + 2) % loop.length];
    for (let s = 0; s < samples; s++) {
      out.push(cubicBSplinePoint(p0, p1, p2, p3, s / samples));
    }
  }
  return dedupeSequential(stripClosingDuplicate(out));
}

function catmullRomPoint(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number,
): Point2D {
  const tt = t * t;
  const ttt = tt * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
      + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * tt
      + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * ttt),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
      + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * tt
      + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * ttt),
  ];
}

function cubicBSplinePoint(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number,
): Point2D {
  const tt = t * t;
  const ttt = tt * t;
  const b0 = (1 - 3 * t + 3 * tt - ttt) / 6;
  const b1 = (4 - 6 * tt + 3 * ttt) / 6;
  const b2 = (1 + 3 * t + 3 * tt - 3 * ttt) / 6;
  const b3 = ttt / 6;
  return [
    p0[0] * b0 + p1[0] * b1 + p2[0] * b2 + p3[0] * b3,
    p0[1] * b0 + p1[1] * b1 + p2[1] * b2 + p3[1] * b3,
  ];
}

function chaikinSmoothOpenLine(points: Point2D[], iterations: number): Point2D[] {
  let current = points.map(([x, y]) => [x, y] as Point2D);
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;
    const next: Point2D[] = [[current[0][0], current[0][1]]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      const q: Point2D = [
        a[0] * 0.75 + b[0] * 0.25,
        a[1] * 0.75 + b[1] * 0.25,
      ];
      const r: Point2D = [
        a[0] * 0.25 + b[0] * 0.75,
        a[1] * 0.25 + b[1] * 0.75,
      ];
      next.push(q, r);
    }
    next.push([current[current.length - 1][0], current[current.length - 1][1]]);
    current = dedupeSequential(next);
  }
  return current;
}

function chaikinSmoothClosedLine(points: Point2D[], iterations: number): Point2D[] {
  let current = stripClosingDuplicate(points).map(([x, y]) => [x, y] as Point2D);
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;
    const next: Point2D[] = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push(
        [
          a[0] * 0.75 + b[0] * 0.25,
          a[1] * 0.75 + b[1] * 0.25,
        ],
        [
          a[0] * 0.25 + b[0] * 0.75,
          a[1] * 0.25 + b[1] * 0.75,
        ],
      );
    }
    current = dedupeSequential(next);
  }
  return current;
}

function rotateClosedLoopToHiddenSeam(points: Point2D[]): Point2D[] {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 3) return points.map(([x, y]) => [x, y]);

  let bestIndex = 0;
  let bestScore = Infinity;
  const minY = Math.min(...loop.map(([, y]) => y));
  const maxY = Math.max(...loop.map(([, y]) => y));
  const height = Math.max(maxY - minY, 1e-6);

  for (let i = 0; i < loop.length; i++) {
    const turn = localClosedTurnAngle(loop, i);
    const lowerPlacement = (maxY - loop[i][1]) / height;
    const score = turn + lowerPlacement * 0.22;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return loop.slice(bestIndex).concat(loop.slice(0, bestIndex));
}

function extendOpenPathToShape(points: Point2D[], shape: Shape): Point2D[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const endGap = Math.hypot(first[0] - last[0], first[1] - last[1]);
  if (endGap <= 1e-3 || isLoopLikeOpenPath(points, endGap)) return points;

  const extended = points.map(([x, y]) => [x, y] as Point2D);
  extended[0] = extendEndpointTowardBoundary(points[0], points[1], shape);
  extended[extended.length - 1] = extendEndpointTowardBoundary(
    points[points.length - 1],
    points[points.length - 2],
    shape,
  );
  return extended;
}

function isLoopLikeOpenPath(points: Point2D[], endGap: number): boolean {
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    totalLength += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }
  return endGap <= 1.2 || (totalLength > 0 && endGap / totalLength <= 0.08);
}

function extendEndpointTowardBoundary(
  endpoint: Point2D,
  neighbor: Point2D,
  shape: Shape,
): Point2D {
  const dx = endpoint[0] - neighbor[0];
  const dy = endpoint[1] - neighbor[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-6) return [endpoint[0], endpoint[1]];

  const dir: Point2D = [dx / length, dy / length];
  const stepMm = 0.05;
  const maxSteps = 240;
  let best: Point2D = [endpoint[0], endpoint[1]];

  for (let i = 1; i <= maxSteps; i++) {
    const candidate: Point2D = [
      endpoint[0] + dir[0] * stepMm * i,
      endpoint[1] + dir[1] * stepMm * i,
    ];
    if (!pointInShape(shape, candidate)) break;
    best = candidate;
  }

  return best;
}

type RoutedAdj = {
  branch: SkeletonBranch;
  nextNodeId: string;
  length: number;
};

type SkeletonRasterInfo = {
  offsetX: number;
  offsetY: number;
};

type RunRoutingMetrics = {
  branchCount: number;
  loopBranchCount: number;
  routedSegmentCount: number;
  inferredClosedCount: number;
  healedMergeCount: number;
  droppedShortBranchCount: number;
};

function routeSkeletonGraphBranchSegments(
  graph: SkeletonGraph,
  raster: SkeletonRasterInfo,
  stitchLenMm: number,
  shape: Shape,
): Point2D[][] {
  if (graph.branches.length === 0) return [];

  const metrics: RunRoutingMetrics = {
    branchCount: graph.branches.length,
    loopBranchCount: graph.branches.filter((branch) => branch.isLoop).length,
    routedSegmentCount: 0,
    inferredClosedCount: 0,
    healedMergeCount: 0,
    droppedShortBranchCount: 0,
  };
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const prepared = new Map<string, Point2D[]>();
  for (const branch of graph.branches) {
    const result = prepareSkeletonBranch(branch, raster, stitchLenMm, shape, nodeMap);
    if (result.droppedShort) {
      metrics.droppedShortBranchCount += 1;
      continue;
    }
    if (result.inferredClosed) metrics.inferredClosedCount += 1;
    const line = result.points;
    if (line.length >= 2) prepared.set(branch.id, line);
  }
  if (prepared.size === 0) {
    debugRunRoutingMetrics(metrics);
    return [];
  }

  if (graph.branches.length === 1) {
    const only = prepared.get(graph.branches[0].id);
    const routed: Point2D[][] = only ? [only.map(([x, y]) => [x, y] as Point2D)] : [];
    metrics.routedSegmentCount = routed.length;
    debugRunRoutingMetrics(metrics);
    return routed;
  }

  const adjacency = buildSkeletonAdjacency(graph);
  const visitedBranches = new Set<string>();
  const routed: Point2D[][] = [];
  const startNodes = graph.nodes
    .slice()
    .sort((a, b) => nodeStartRank(a) - nodeStartRank(b) || a.y - b.y || a.x - b.x);

  const visitNode = (nodeId: string): void => {
    const edges = (adjacency.get(nodeId) ?? [])
      .filter((edge) => !visitedBranches.has(edge.branch.id))
      .sort((a, b) => {
        const an = nodeMap.get(a.nextNodeId);
        const bn = nodeMap.get(b.nextNodeId);
        return (an?.y ?? 0) - (bn?.y ?? 0) || (an?.x ?? 0) - (bn?.x ?? 0) || a.length - b.length;
      });

    for (const edge of edges) {
      if (visitedBranches.has(edge.branch.id)) continue;
      const forward = orientPreparedBranch(edge.branch, nodeId, prepared);
      if (forward.length < 2) continue;
      visitedBranches.add(edge.branch.id);
      routed.push(forward);
      visitNode(edge.nextNodeId);
    }
  };

  for (const node of startNodes) {
    if ((adjacency.get(node.id) ?? []).some((edge) => !visitedBranches.has(edge.branch.id))) {
      visitNode(node.id);
    }
  }

  for (const branch of graph.branches) {
    if (visitedBranches.has(branch.id)) continue;
    const line = prepared.get(branch.id);
    if (!line || line.length < 2) continue;
    visitedBranches.add(branch.id);
    routed.push(line.map(([x, y]) => [x, y]));
  }

  const healed = healRunSegmentGaps(routed);
  metrics.routedSegmentCount = healed.length;
  metrics.healedMergeCount = Math.max(0, routed.length - healed.length);
  debugRunRoutingMetrics(metrics);
  return healed;
}

function prepareSkeletonBranch(
  branch: SkeletonBranch,
  raster: SkeletonRasterInfo,
  stitchLenMm: number,
  shape: Shape,
  nodeMap: Map<string, { degree: number }>,
): {
  points: Point2D[];
  inferredClosed: boolean;
  droppedShort: boolean;
} {
  const points = branch.points.map(([px, py]) => pixelToMm(px, py, raster));
  const rawLength = polylineRawLength(points);
  const startNode = branch.startNodeId ? nodeMap.get(branch.startNodeId) : undefined;
  const endNode = branch.endNodeId ? nodeMap.get(branch.endNodeId) : undefined;
  if (
    !branch.isLoop &&
    rawLength < MIN_OPEN_BRANCH_LENGTH_MM &&
    shouldDropShortSkeletonBranch(branch, startNode, endNode, shape)
  ) {
    return { points: [], inferredClosed: false, droppedShort: true };
  }
  const hasOpenBoundaryEndpoint = branchHasOpenBoundaryEndpoint(points, shape, startNode, endNode);
  const inferredClosed = branch.isLoop || (!hasOpenBoundaryEndpoint && shouldForceCloseRunPath(points, shape));
  if (inferredClosed && points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
      points.push([first[0], first[1]]);
    }
  } else if (points.length >= 2) {
    if (startNode && startNode.degree <= 1) {
      points[0] = extendEndpointTowardBoundary(points[0], points[1], shape);
    } else if (startNode && startNode.degree >= 3) {
      trimPolylineStart(points, JUNCTION_RETRACT_MM);
    }
    if (endNode && endNode.degree <= 1) {
      const lastIndex = points.length - 1;
      points[lastIndex] = extendEndpointTowardBoundary(points[lastIndex], points[lastIndex - 1], shape);
    } else if (endNode && endNode.degree >= 3) {
      trimPolylineEnd(points, JUNCTION_RETRACT_MM);
    }
  }
  return {
    points: processRunPolyline(points, stitchLenMm, inferredClosed),
    inferredClosed,
    droppedShort: false,
  };
}

function polylineRawLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

function shouldDropShortSkeletonBranch(
  branch: SkeletonBranch,
  startNode: { degree: number } | undefined,
  endNode: { degree: number } | undefined,
  shape: Shape,
): boolean {
  if (branch.isLoop || shape.holes.length > 0) return false;
  const startDegree = startNode?.degree ?? 0;
  const endDegree = endNode?.degree ?? 0;
  return (
    (startDegree <= 1 && endDegree >= 3) ||
    (endDegree <= 1 && startDegree >= 3)
  );
}

function shouldForceCloseRunPath(points: Point2D[], shape: Shape): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const endGap = Math.hypot(first[0] - last[0], first[1] - last[1]);
  const pathLength = polylineRawLength(points);
  if (pathLength < 3.0) return false;
  if (endGap <= 1.2) return true;
  if (pathLength > 1e-6 && endGap / pathLength <= 0.08 && endGap <= 2.0) return true;
  return shape.holes.length > 0 && pathLength > 1e-6 && endGap / pathLength <= 0.14 && endGap <= 2.5;
}

function branchHasOpenBoundaryEndpoint(
  points: Point2D[],
  shape: Shape,
  startNode: { degree: number } | undefined,
  endNode: { degree: number } | undefined,
): boolean {
  if (points.length < 2) return false;
  return (
    Boolean(startNode && startNode.degree <= 1 && distanceToPolygonBoundary(points[0], shape.outer) <= 0.65) ||
    Boolean(endNode && endNode.degree <= 1 && distanceToPolygonBoundary(points[points.length - 1], shape.outer) <= 0.65)
  );
}

function distanceToPolygonBoundary(point: Point2D, poly: Point2D[]): number {
  if (poly.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, pointToSegmentDistance(point, poly[i], poly[(i + 1) % poly.length]));
  }
  return best;
}

function processRunPolyline(line: Point2D[], stitchLenMm: number, closed = false): Point2D[] {
  if (line.length < 2) return line.map(([x, y]) => [x, y]);
  if (closed) {
    const prepared = prepareClosedRunPolyline(line, stitchLenMm);
    return resampleClosedLineByArcLength(prepared, stitchLenMm);
  }
  const prepared = prepareRunPolyline(dedupeSequential(line), stitchLenMm);
  return resampleAdaptiveOpenLine(prepared, stitchLenMm);
}

function processLightweightRunPolyline(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 2) return line.map(([x, y]) => [x, y]);
  const simplified = simplifyRdp(dedupeSequential(line), clamp(stitchLenMm * 0.04, 0.04, 0.1));
  const smoothed = chaikinSmoothOpenLine(simplified, simplified.length >= 6 ? 7 : 5);
  const fitted = clampedCatmullRomSpline(smoothed, 10);
  return resampleAdaptiveOpenLine(dedupeSequential(fitted), stitchLenMm);
}

function trimPolylineStart(points: Point2D[], amountMm: number): void {
  const result = trimPolylineStartResult(points, amountMm);
  if (!result) return;
  points.splice(0, points.length, ...result);
}

function trimPolylineEnd(points: Point2D[], amountMm: number): void {
  const reversed = points.slice().reverse();
  const result = trimPolylineStartResult(reversed, amountMm);
  if (!result) return;
  points.splice(0, points.length, ...result.reverse());
}

function trimPolylineStartResult(points: Point2D[], amountMm: number): Point2D[] | null {
  if (points.length < 2 || amountMm <= 0) return null;
  let remaining = amountMm;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const length = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    if (length <= 1e-6) continue;
    if (remaining <= length) {
      const t = remaining / length;
      const trimmed: Point2D = [
        prev[0] + (next[0] - prev[0]) * t,
        prev[1] + (next[1] - prev[1]) * t,
      ];
      return [trimmed, ...points.slice(i)];
    }
    remaining -= length;
  }
  const fallback = points[Math.max(0, points.length - 2)];
  return [[fallback[0], fallback[1]], points[points.length - 1]];
}

function pixelToMm(px: number, py: number, raster: SkeletonRasterInfo): Point2D {
  return [
    raster.offsetX + (px + 0.5) / SKELETON_RUN_PX_PER_MM,
    raster.offsetY + (py + 0.5) / SKELETON_RUN_PX_PER_MM,
  ];
}

function nodeStartRank(node: { degree: number }): number {
  if (node.degree <= 1) return 0;
  return 1;
}

function orientPreparedBranch(
  branch: SkeletonBranch,
  fromNodeId: string,
  prepared: Map<string, Point2D[]>,
): Point2D[] {
  const points = prepared.get(branch.id) ?? [];
  if (branch.startNodeId === fromNodeId) return points.map(([x, y]) => [x, y]);
  return points.slice().reverse().map(([x, y]) => [x, y]);
}

function buildSkeletonAdjacency(graph: SkeletonGraph): Map<string, RoutedAdj[]> {
  const adjacency = new Map<string, RoutedAdj[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const branch of graph.branches) {
    if (!branch.startNodeId || !branch.endNodeId) continue;
    const length = branchPixelLength(branch);
    adjacency.get(branch.startNodeId)?.push({
      branch,
      nextNodeId: branch.endNodeId,
      length,
    });
    adjacency.get(branch.endNodeId)?.push({
      branch,
      nextNodeId: branch.startNodeId,
      length,
    });
  }
  return adjacency;
}

function healRunSegmentGaps(segments: Point2D[][]): Point2D[][] {
  const remaining = segments.map((segment) => segment.map(([x, y]) => [x, y] as Point2D));
  let changed = true;

  while (changed) {
    changed = false;
    let best: { a: number; b: number; gap: number; merged: Point2D[] } | null = null;

    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const candidate = bestHealingMerge(remaining[i], remaining[j]);
        if (!candidate) continue;
        if (!best || candidate.gap < best.gap) {
          best = { a: i, b: j, gap: candidate.gap, merged: candidate.merged };
        }
      }
    }

    if (best) {
      remaining[best.a] = best.merged;
      remaining.splice(best.b, 1);
      changed = true;
    }
  }

  return remaining;
}

function bestHealingMerge(
  a: Point2D[],
  b: Point2D[],
): { gap: number; merged: Point2D[] } | null {
  if (a.length < 2 || b.length < 2 || isExplicitlyClosedSegment(a) || isExplicitlyClosedSegment(b)) {
    return null;
  }

  const variants: Array<[Point2D[], Point2D[]]> = [
    [a, b],
    [a, reverseSegment(b)],
    [reverseSegment(a), b],
    [reverseSegment(a), reverseSegment(b)],
  ];
  let best: { gap: number; merged: Point2D[] } | null = null;

  for (const [left, right] of variants) {
    const gap = endpointGap(left, right);
    if (gap > HEAL_GAP_MM) continue;
    if (!healingDirectionsCompatible(left, right)) continue;
    const merged = closeOpenSegmentIfNear(mergeOrientedSegments(left, right));
    if (!best || gap < best.gap) best = { gap, merged };
  }

  return best;
}

function isExplicitlyClosedSegment(points: Point2D[]): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-6;
}

function reverseSegment(points: Point2D[]): Point2D[] {
  return points.slice().reverse().map(([x, y]) => [x, y] as Point2D);
}

function endpointGap(left: Point2D[], right: Point2D[]): number {
  const a = left[left.length - 1];
  const b = right[0];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function healingDirectionsCompatible(left: Point2D[], right: Point2D[]): boolean {
  if (left.length < 2 || right.length < 2) return true;
  const leftPrev = left[left.length - 2];
  const leftEnd = left[left.length - 1];
  const rightStart = right[0];
  const rightNext = right[1];
  const bridge: Point2D = [rightStart[0] - leftEnd[0], rightStart[1] - leftEnd[1]];
  if (Math.hypot(bridge[0], bridge[1]) <= 1e-6) return true;
  const leftDir: Point2D = [leftEnd[0] - leftPrev[0], leftEnd[1] - leftPrev[1]];
  const rightDir: Point2D = [rightNext[0] - rightStart[0], rightNext[1] - rightStart[1]];
  return (
    normalizedDot(leftDir, bridge) >= HEAL_DIRECTION_COS &&
    normalizedDot(bridge, rightDir) >= HEAL_DIRECTION_COS
  );
}

function normalizedDot(a: Point2D, b: Point2D): number {
  const al = Math.hypot(a[0], a[1]);
  const bl = Math.hypot(b[0], b[1]);
  if (al <= 1e-6 || bl <= 1e-6) return 1;
  return (a[0] * b[0] + a[1] * b[1]) / (al * bl);
}

function mergeOrientedSegments(left: Point2D[], right: Point2D[]): Point2D[] {
  const merged = left.map(([x, y]) => [x, y] as Point2D);
  const startIndex = endpointGap(left, right) <= 1e-6 ? 1 : 0;
  for (let i = startIndex; i < right.length; i++) {
    merged.push([right[i][0], right[i][1]]);
  }
  return dedupeSequential(merged);
}

function closeOpenSegmentIfNear(segment: Point2D[]): Point2D[] {
  if (segment.length < 3) return segment;
  const first = segment[0];
  const last = segment[segment.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= HEAL_GAP_MM) {
    return ensureClosedLoop(segment);
  }
  return segment;
}

function debugRunRoutingMetrics(metrics: RunRoutingMetrics): void {
  const maybeGlobal = globalThis as typeof globalThis & { __EMBROIDERY_RUN_DEBUG__?: boolean };
  if (!maybeGlobal.__EMBROIDERY_RUN_DEBUG__) return;
  console.debug("[embroidery-run]", metrics);
}

function appendPoints(target: Point2D[], points: Point2D[]): void {
  for (const point of points) {
    const prev = target[target.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    target.push([point[0], point[1]]);
  }
}

function flattenRunSegments(segments: Point2D[][]): Point2D[] {
  const routed: Point2D[] = [];
  for (const segment of segments) {
    appendPoints(routed, segment);
  }
  return dedupeSequential(routed);
}

function pointInShape(shape: Shape, point: Point2D): boolean {
  if (!pointInPolygonInclusive(shape.outer, point)) return false;
  return !shape.holes.some((hole) => pointInPolygonInclusive(hole, point));
}

function pointInPolygonInclusive(poly: Point2D[], point: Point2D): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    if (pointOnSegment(poly[i], poly[(i + 1) % poly.length], point)) return true;
  }

  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > py !== yj > py;
    if (!crosses) continue;
    const xAtY = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < xAtY) inside = !inside;
  }
  return inside;
}

function pointOnSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  if (dot < -1e-7) return false;
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= lenSq + 1e-7;
}

function branchPixelLength(branch: SkeletonBranch): number {
  let total = 0;
  for (let i = 1; i < branch.points.length; i++) {
    total += Math.hypot(
      branch.points[i][0] - branch.points[i - 1][0],
      branch.points[i][1] - branch.points[i - 1][1],
    );
  }
  return total;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function polygonArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
