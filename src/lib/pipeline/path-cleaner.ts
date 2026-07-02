import type { Point2D } from "./types";

export type CleanPathOptions = {
  targetSpacingMm?: number;
  minDistanceMm?: number;
  closed?: boolean;
};

const DEFAULT_RUN_SPACING_MM = 2;
const DEFAULT_MIN_DISTANCE_MM = 0.08;

export function cleanPath(points: Point2D[], opts: CleanPathOptions = {}): Point2D[] {
  const targetSpacing = opts.targetSpacingMm ?? DEFAULT_RUN_SPACING_MM;
  const minDistance = opts.minDistanceMm ?? DEFAULT_MIN_DISTANCE_MM;
  const closed = opts.closed ?? false;
  const filtered = filterNearDuplicates(points, minDistance, closed);
  if (filtered.length < 2) return filtered;
  return closed
    ? resampleClosed(filtered, targetSpacing)
    : resampleOpen(filtered, targetSpacing);
}

export function filterNearDuplicates(
  points: Point2D[],
  minDistanceMm = DEFAULT_MIN_DISTANCE_MM,
  closed = false,
): Point2D[] {
  const out: Point2D[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, point) >= minDistanceMm) {
      out.push([point[0], point[1]]);
    }
  }
  if (closed && out.length > 2 && distance(out[0], out[out.length - 1]) < minDistanceMm) {
    out.pop();
  }
  return out;
}

export function resampleOpen(points: Point2D[], targetSpacingMm = DEFAULT_RUN_SPACING_MM): Point2D[] {
  if (points.length < 2 || targetSpacingMm <= 0) return points.map(copyPoint);
  const total = polylineLength(points, false);
  if (total <= 1e-6) return [copyPoint(points[0])];

  const count = Math.max(2, Math.ceil(total / targetSpacingMm) + 1);
  const step = total / (count - 1);
  const out: Point2D[] = [];
  for (let i = 0; i < count; i++) {
    out.push(sampleOpen(points, Math.min(total, step * i)));
  }
  return filterNearDuplicates(out, 1e-6, false);
}

export function resampleClosed(points: Point2D[], targetSpacingMm = DEFAULT_RUN_SPACING_MM): Point2D[] {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 3 || targetSpacingMm <= 0) return loop.map(copyPoint);
  const total = polylineLength(loop, true);
  if (total <= 1e-6) return [copyPoint(loop[0])];

  const count = Math.max(6, Math.round(total / targetSpacingMm));
  const step = total / count;
  const out: Point2D[] = [];
  for (let i = 0; i < count; i++) {
    out.push(sampleClosed(loop, step * i));
  }
  return filterNearDuplicates(out, 1e-6, true);
}

export function polylineLength(points: Point2D[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  if (closed && points.length > 2) total += distance(points[points.length - 1], points[0]);
  return total;
}

function sampleOpen(points: Point2D[], target: number): Point2D {
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const len = distance(prev, next);
    if (walked + len >= target) {
      const t = len <= 1e-6 ? 0 : (target - walked) / len;
      return lerp(prev, next, t);
    }
    walked += len;
  }
  return copyPoint(points[points.length - 1]);
}

function sampleClosed(points: Point2D[], target: number): Point2D {
  const total = polylineLength(points, true);
  let wrapped = ((target % total) + total) % total;
  for (let i = 0; i < points.length; i++) {
    const prev = points[i];
    const next = points[(i + 1) % points.length];
    const len = distance(prev, next);
    if (wrapped <= len) {
      const t = len <= 1e-6 ? 0 : wrapped / len;
      return lerp(prev, next, t);
    }
    wrapped -= len;
  }
  return copyPoint(points[0]);
}

function stripClosingDuplicate(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.map(copyPoint);
  const out = points.map(copyPoint);
  if (distance(out[0], out[out.length - 1]) <= 1e-6) out.pop();
  return out;
}

function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function copyPoint(point: Point2D): Point2D {
  return [point[0], point[1]];
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
