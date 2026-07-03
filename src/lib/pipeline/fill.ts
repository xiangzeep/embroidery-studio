// fill.ts — tatami brick fill。
// English note.
// English note.
// English note.
// English note.
//
// English note.
// English note.

import { intersectScanline } from "./scanline";
import { isSegmentInsideShape } from "./safe-travel";
import type { Point2D, Polygon, Shape, Stitch, StitchKind } from "./types";

type Point = Point2D;

const PHASE_EPS = 1e-9;
const MAX_FILL_ROW_CONNECTOR_MM = 2.5;
const MAX_GREEDY_FILL_SEGMENTS = 800;
export const DEFAULT_TATAMI_SHIFT_MM = 1.5;
export const DEFAULT_TATAMI_PATTERN_LENGTH_MM = 4.0;

const PHOTO_RANDOM_MIN_STEP_FACTOR = 0.55;
const PHOTO_RANDOM_MAX_STEP_FACTOR = 0.95;
const PHOTO_RANDOM_MAX_SWAY_MM = 0.35;

/**
 * English note.
 * English note.
 * English note.
 */
function computePhase(
  line: number,
  shiftMm: number,
  patternLengthMm: number,
): number {
  if (patternLengthMm <= 0) return 0;
  const raw = ((line * shiftMm) % patternLengthMm + patternLengthMm) %
    patternLengthMm;
  if (raw < PHASE_EPS) return 0;
  if (patternLengthMm - raw < PHASE_EPS) return 0;
  return raw;
}

/**
 * English note.
 * English note.
 *
 * English note.
 *
 * 業界標準値: `shiftMm = 1.5`, `patternLengthMm = 4.0`。
 */
export function tatamiBrick(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
  maxStitchMm: number,
  shiftMm = DEFAULT_TATAMI_SHIFT_MM,
  patternLengthMm = DEFAULT_TATAMI_PATTERN_LENGTH_MM,
): Point[][] {
  const rad = (angleDeg * Math.PI) / 180;
  const dir: Point = [Math.cos(rad), Math.sin(rad)];
  const perp: Point = [-dir[1], dir[0]];

  let minS = Infinity;
  let maxS = -Infinity;
  for (const [x, y] of shape.outer) {
    const s = x * perp[0] + y * perp[1];
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }

  const rings: Polygon[] = [shape.outer, ...shape.holes];
  const segments: Point[][] = [];
  let line = 0;
  for (let s = minS; s <= maxS; s += densityMm) {
    const ox = perp[0] * s;
    const oy = perp[1] * s;
    const crossings = intersectScanline(rings, ox, oy, dir);
    if (crossings.length < 2) continue; // English note.
    crossings.sort((a, b) => a - b);
    if (crossings.length % 2 !== 0) crossings.pop();
    const phase = computePhase(line, shiftMm, patternLengthMm);

    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < crossings.length; i += 2) {
      pairs.push([crossings[i], crossings[i + 1]]);
    }

    const lineSegs: Point[][] = pairs.map(([a, b]) => {
      const pts: Point[] = [[ox + dir[0] * a, oy + dir[1] * a]];
      // English note.
      // English note.
      // English note.
      if (phase > 0) {
        let t = a + phase;
        while (t < b - PHASE_EPS) {
          pts.push([ox + dir[0] * t, oy + dir[1] * t]);
          t += maxStitchMm;
        }
      }
      pts.push([ox + dir[0] * b, oy + dir[1] * b]);
      return pts;
    });

    if (line % 2 === 0) {
      for (const seg of lineSegs) segments.push(seg);
    } else {
      // English note.
      for (let i = lineSegs.length - 1; i >= 0; i--) {
        segments.push([...lineSegs[i]].reverse());
      }
    }
    line++;
  }
  return segments;
}

export function photoRandomFill(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
  maxStitchMm: number,
  seed = 1,
): Point[][] {
  const base = tatamiBrick(shape, densityMm, angleDeg, maxStitchMm, 0.9, 2.6);
  return base.map((segment, index) =>
    randomizeSegment(shape, segment, densityMm, maxStitchMm, seed + index * 131),
  );
}

export type FillRoutingInput = {
  shape: Shape;
  segments: Point[][];
  colorIndex: number;
  kind: Extract<StitchKind, "fill">;
  maxStitchMm: number;
  trimThresholdMm: number;
};

export function routeFillSegmentsSafely(input: FillRoutingInput): Stitch[] {
  const stitches: Stitch[] = [];
  for (const segment of orderFillSegments(input)) {
    appendFillSegmentSafely(stitches, segment, input);
  }
  return stitches;
}

function orderFillSegments(input: FillRoutingInput): Point[][] {
  if (input.segments.length <= 1) return input.segments;
  if (input.segments.length > MAX_GREEDY_FILL_SEGMENTS) return input.segments;

  const remaining = input.segments.map((segment) => [...segment]);
  const ordered: Point[][] = [remaining.shift()!];

  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1];
    const previousEnd = previous[previous.length - 1];
    let bestIndex = 0;
    let bestSegment = remaining[0];
    let bestCost = connectorCost(previousEnd, remaining[0][0], input);

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const forwardCost = connectorCost(previousEnd, candidate[0], input);
      if (forwardCost < bestCost) {
        bestCost = forwardCost;
        bestIndex = i;
        bestSegment = candidate;
      }

      const reversed = [...candidate].reverse();
      const reverseCost = connectorCost(previousEnd, reversed[0], input);
      if (reverseCost < bestCost) {
        bestCost = reverseCost;
        bestIndex = i;
        bestSegment = reversed;
      }
    }

    ordered.push(bestSegment);
    remaining.splice(bestIndex, 1);
  }

  return ordered;
}

function connectorCost(from: Point, to: Point, input: FillRoutingInput): number {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const safeConnector =
    dist <= Math.min(input.maxStitchMm, MAX_FILL_ROW_CONNECTOR_MM) &&
    isSegmentInsideShape(input.shape, from, to);

  if (safeConnector) return dist;
  if (dist <= input.trimThresholdMm) return 1_000 + dist;
  return 1_000_000 + dist;
}

function appendFillSegmentSafely(
  stitches: Stitch[],
  points: Point[],
  input: FillRoutingInput,
): void {
  if (points.length === 0) return;
  const previous = stitches[stitches.length - 1];
  let last: Point = previous ? [previous.x, previous.y] : points[0];
  if (previous) {
    const from: Point = [previous.x, previous.y];
    const to = points[0];
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const safeConnector =
      dist <= Math.min(input.maxStitchMm, MAX_FILL_ROW_CONNECTOR_MM) &&
      isSegmentInsideShape(input.shape, from, to);
    if (!safeConnector) {
      if (dist > input.trimThresholdMm) {
        stitches.push({
          x: previous.x,
          y: previous.y,
          kind: "trim",
          colorIndex: input.colorIndex,
        });
      }
      stitches.push({
        x: to[0],
        y: to[1],
        kind: "jump",
        colorIndex: input.colorIndex,
      });
      last = to;
    }
  }

  for (const point of points) {
    const dist = Math.hypot(point[0] - last[0], point[1] - last[1]);
    if (dist > input.maxStitchMm) {
      const steps = Math.ceil(dist / input.maxStitchMm);
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        stitches.push({
          x: last[0] + (point[0] - last[0]) * t,
          y: last[1] + (point[1] - last[1]) * t,
          kind: input.kind,
          colorIndex: input.colorIndex,
        });
      }
    } else {
      stitches.push({
        x: point[0],
        y: point[1],
        kind: input.kind,
        colorIndex: input.colorIndex,
      });
    }
    last = point;
  }
}

function randomizeSegment(
  shape: Shape,
  segment: Point[],
  densityMm: number,
  maxStitchMm: number,
  seed: number,
): Point[] {
  if (segment.length < 2) return segment;
  const start = segment[0];
  const end = segment[segment.length - 1];
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (length <= maxStitchMm * 1.2) return segment;

  const dir: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  const normal: Point = [-dir[1], dir[0]];
  const swayBase = Math.min(PHOTO_RANDOM_MAX_SWAY_MM, densityMm * 0.28, length * 0.08);
  if (swayBase <= 0.01) return segment;

  const out: Point[] = [start];
  let cursor = 0;
  let prng = seed >>> 0;

  while (cursor + maxStitchMm < length - 1e-6) {
    prng = lcgNext(prng);
    const stepFactor = lerp(
      PHOTO_RANDOM_MIN_STEP_FACTOR,
      PHOTO_RANDOM_MAX_STEP_FACTOR,
      prng / 0xffffffff,
    );
    const step = Math.min(maxStitchMm * stepFactor, length - cursor);
    cursor += step;
    if (cursor >= length - 1e-6) break;

    prng = lcgNext(prng);
    const sign = prng % 2 === 0 ? -1 : 1;
    prng = lcgNext(prng);
    const swayScale = 0.35 + 0.65 * (prng / 0xffffffff);
    const t = cursor / length;
    const fade = Math.sin(Math.PI * t);
    const sway = sign * swayBase * swayScale * fade;

    const candidate: Point = [
      start[0] + dir[0] * cursor + normal[0] * sway,
      start[1] + dir[1] * cursor + normal[1] * sway,
    ];
    out.push(pointInsideShape(shape, candidate)
      ? candidate
      : [start[0] + dir[0] * cursor, start[1] + dir[1] * cursor]);
  }

  out.push(end);
  return out;
}

function pointInsideShape(shape: Shape, point: Point): boolean {
  if (!pointInPolygonInclusive(shape.outer, point)) return false;
  return !shape.holes.some((hole) => pointInPolygonInclusive(hole, point));
}

function pointInPolygonInclusive(poly: Polygon, point: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (pointOnSegment([xi, yi], [xj, yj], point)) return true;
    const intersects =
      (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(a: Point, b: Point, p: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  if (dot < -1e-6) return false;
  const sqLen = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= sqLen + 1e-6;
}

function lcgNext(seed: number): number {
  return (1664525 * seed + 1013904223) >>> 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
