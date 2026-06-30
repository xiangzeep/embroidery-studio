// satin.ts - 2-rail satin renderer.
//
// English note.
// English note.
// English note.
// English note.
// English note.
//      output (`renderSatin2Rail`)
// English note.
// English note.
// English note.
//
// English note.

import type { Point2D, Shape } from "./types";

type Point = Point2D;

const MIDLINE_SAMPLE_COUNT = 200;
const CAP_GROUP_TOLERANCE_RATIO = 0.02; // English note.

/**
 * English note.
 * English note.
 * English note.
 */
export type SatinRails = {
  left: Point[];
  right: Point[];
};

export type SatinWidthStats = {
  minWidthMm: number;
  maxWidthMm: number;
  averageWidthMm: number;
  sampleCount: number;
};

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
export function extractRails(shape: Shape): SatinRails {
  const pts = stripClosingDuplicate(shape.outer);
  if (pts.length < 3) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }

  const hull = convexHull(pts);
  const axis = longestHullEdgeAxis(hull) ?? diameterAxis(hull);
  if (axis === null) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }

  const projs = pts.map((p) => p[0] * axis[0] + p[1] * axis[1]);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const v of projs) {
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
  }
  const span = maxP - minP;
  if (span <= 0) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }
  const tol = span * CAP_GROUP_TOLERANCE_RATIO;

  // English note.
  const inStart = projs.map((v) => v - minP <= tol);
  const inEnd = projs.map((v) => maxP - v <= tol);
  const startCap = findCyclicRun(inStart);
  const endCap = findCyclicRun(inEnd);
  if (startCap === null || endCap === null) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }

  // Rail 1: polyline forward from "last of startCap" to "first of endCap"
  // Rail 2: polyline forward from "last of endCap" to "first of startCap"
  // English note.
  const rail1 = sliceCyclic(pts, startCap.last, endCap.first);
  const rail2 = sliceCyclic(pts, endCap.last, startCap.first).slice().reverse();

  const perp: Point = [-axis[1], axis[0]];
  const projA = meanProjection(rail1, perp);
  const projB = meanProjection(rail2, perp);
  return projA >= projB
    ? { left: rail1, right: rail2 }
    : { left: rail2, right: rail1 };
}

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
 */
export function estimateSatinWidthStats(
  rails: SatinRails,
  sampleCount = 32,
): SatinWidthStats {
  const left = rails.left.slice();
  const right = rails.right.slice();
  if (left.length === 0 || right.length === 0 || sampleCount <= 0) {
    return { minWidthMm: 0, maxWidthMm: 0, averageWidthMm: 0, sampleCount: 0 };
  }

  const cumL = cumulativeLengths(left);
  const cumR = cumulativeLengths(right);
  const count = Math.max(1, Math.floor(sampleCount));
  let minWidthMm = Infinity;
  let maxWidthMm = 0;
  let totalWidthMm = 0;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const pl = arcLengthSample(left, cumL.lens, cumL.total, t);
    const pr = arcLengthSample(right, cumR.lens, cumR.total, t);
    const widthMm = Math.hypot(pr[0] - pl[0], pr[1] - pl[1]);
    if (widthMm < minWidthMm) minWidthMm = widthMm;
    if (widthMm > maxWidthMm) maxWidthMm = widthMm;
    totalWidthMm += widthMm;
  }

  return {
    minWidthMm: Number.isFinite(minWidthMm) ? minWidthMm : 0,
    maxWidthMm,
    averageWidthMm: totalWidthMm / count,
    sampleCount: count,
  };
}

export function renderSatin2Rail(
  rails: SatinRails,
  densityMm: number,
  _maxStitchMm: number,
): Point[] {
  void _maxStitchMm; // English note.
  const left = rails.left.slice();
  const right = rails.right.slice();
  if (left.length === 0 || right.length === 0) return [];

  const cumL = cumulativeLengths(left);
  const cumR = cumulativeLengths(right);
  if (cumL.total === 0 && cumR.total === 0) return [];

  const midTotal = estimateMidlineLength(left, cumL, right, cumR);
  const effectiveDensity = densityMm > 0 ? densityMm : 1;
  const N = Math.max(2, Math.ceil(midTotal / effectiveDensity));

  const out: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pl = arcLengthSample(left, cumL.lens, cumL.total, t);
    const pr = arcLengthSample(right, cumR.lens, cumR.total, t);
    if (i % 2 === 0) out.push(pl, pr);
    else out.push(pr, pl);
  }
  return out;
}

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 *
 * English note.
 */
export function brickSplit(
  left: Point,
  right: Point,
  maxStitchMm: number,
  rowIndex: number,
): Point[] {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const dist = Math.hypot(dx, dy);
  if (dist <= maxStitchMm || maxStitchMm <= 0) {
    return [[left[0], left[1]], [right[0], right[1]]];
  }
  const segs = Math.ceil(dist / maxStitchMm);
  const phase = (((rowIndex % 3) + 3) % 3) / 3;
  const out: Point[] = [[left[0], left[1]]];
  for (let i = 1; i <= segs; i++) {
    const t = clamp01(((i - 1) + phase) / segs);
    out.push(lerp(left, right, t));
  }
  out.push([right[0], right[1]]);
  return out;
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** English note. */
export const __internal = {
  brickSplit,
  lerp,
};

// ──────────────────────────────────────────────────────────────────────────────
// English note.

function stripClosingDuplicate(poly: ReadonlyArray<Point>): Point[] {
  if (poly.length < 2) return poly.slice();
  const first = poly[0];
  const last = poly[poly.length - 1];
  if (last[0] === first[0] && last[1] === first[1]) {
    return poly.slice(0, -1);
  }
  return poly.slice();
}

/** English note. */
function convexHull(pts: Point[]): Point[] {
  const sorted = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** English note. */
function longestHullEdgeAxis(hull: Point[]): Point | null {
  if (hull.length < 2) return null;
  let bestLen2 = 0;
  let bestAxis: Point | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 > bestLen2) {
      bestLen2 = l2;
      bestAxis = [dx, dy];
    }
  }
  if (bestAxis === null || bestLen2 === 0) return null;
  const len = Math.sqrt(bestLen2);
  return [bestAxis[0] / len, bestAxis[1] / len];
}

/** English note. */
function diameterAxis(hull: Point[]): Point | null {
  if (hull.length < 2) return null;
  let bestD2 = 0;
  let bestA: Point = hull[0];
  let bestB: Point = hull[0];
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const dx = hull[j][0] - hull[i][0];
      const dy = hull[j][1] - hull[i][1];
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) {
        bestD2 = d2;
        bestA = hull[i];
        bestB = hull[j];
      }
    }
  }
  if (bestD2 === 0) return null;
  const len = Math.sqrt(bestD2);
  return [(bestB[0] - bestA[0]) / len, (bestB[1] - bestA[1]) / len];
}

/**
 * English note.
 * English note.
 * English note.
 */
function findCyclicRun(mask: boolean[]): { first: number; last: number } | null {
  const n = mask.length;
  if (n === 0) return null;
  if (mask.every((m) => m)) return { first: 0, last: n - 1 };
  if (mask.every((m) => !m)) return null;

  // English note.
  let bestLen = 0;
  let bestStart = -1;
  let bestEnd = -1;
  for (let start = 0; start < n; start++) {
    const prev = (start - 1 + n) % n;
    if (!mask[start] || mask[prev]) continue; // English note.
    // English note.
    let len = 0;
    let i = start;
    while (mask[i]) {
      len++;
      i = (i + 1) % n;
      if (i === start) break;
    }
    if (len > bestLen) {
      bestLen = len;
      bestStart = start;
      bestEnd = (start + len - 1) % n;
    }
  }
  if (bestStart === -1) return null;
  return { first: bestStart, last: bestEnd };
}

/** English note. */
function sliceCyclic(pts: Point[], fromIdx: number, toIdx: number): Point[] {
  const n = pts.length;
  const out: Point[] = [];
  let i = fromIdx;
  while (true) {
    out.push(pts[i]);
    if (i === toIdx) break;
    i = (i + 1) % n;
  }
  return out;
}

function meanProjection(path: Point[], dir: Point): number {
  if (path.length === 0) return 0;
  let sum = 0;
  for (const [x, y] of path) sum += x * dir[0] + y * dir[1];
  return sum / path.length;
}

/** English note. */
function cumulativeLengths(poly: Point[]): { lens: number[]; total: number } {
  const lens: number[] = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i][0] - poly[i - 1][0];
    const dy = poly[i][1] - poly[i - 1][1];
    total += Math.hypot(dx, dy);
    lens.push(total);
  }
  return { lens, total };
}

/**
 * English note.
 * English note.
 */
function arcLengthSample(
  poly: Point[],
  cum: number[],
  total: number,
  t: number,
): Point {
  if (poly.length === 0) return [0, 0];
  if (poly.length === 1 || total === 0) return [poly[0][0], poly[0][1]];
  const target = Math.max(0, Math.min(total, total * t));
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const segLen = cum[lo] - cum[lo - 1];
  const ratio = segLen > 0 ? (target - cum[lo - 1]) / segLen : 0;
  const a = poly[lo - 1];
  const b = poly[lo];
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

/** English note. */
function estimateMidlineLength(
  left: Point[],
  cumL: { lens: number[]; total: number },
  right: Point[],
  cumR: { lens: number[]; total: number },
): number {
  let prev: Point | null = null;
  let total = 0;
  for (let i = 0; i <= MIDLINE_SAMPLE_COUNT; i++) {
    const t = i / MIDLINE_SAMPLE_COUNT;
    const pl = arcLengthSample(left, cumL.lens, cumL.total, t);
    const pr = arcLengthSample(right, cumR.lens, cumR.total, t);
    const m: Point = [(pl[0] + pr[0]) / 2, (pl[1] + pr[1]) / 2];
    if (prev !== null) total += Math.hypot(m[0] - prev[0], m[1] - prev[1]);
    prev = m;
  }
  return total;
}
