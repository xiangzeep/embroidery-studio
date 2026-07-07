import type { Point2D, Shape } from "./types";

export type ClosedLoopDetectionOptions = Partial<{
  gapMm: number;
  relativeGap: number;
  shapeGapMm: number;
}>;

const DEFAULT_GAP_MM = 1.2;
const DEFAULT_RELATIVE_GAP = 0.06;
const DEFAULT_SHAPE_GAP_MM = 2.5;

export function detectClosedLoop(
  points: Point2D[],
  shape?: Shape,
  opts: ClosedLoopDetectionOptions = {},
): boolean {
  if (points.length < 3) return false;
  const gapMm = opts.gapMm ?? DEFAULT_GAP_MM;
  const relativeGap = opts.relativeGap ?? DEFAULT_RELATIVE_GAP;
  const shapeGapMm = opts.shapeGapMm ?? DEFAULT_SHAPE_GAP_MM;
  const gap = distance(points[0], points[points.length - 1]);
  const length = polylineLength(points);
  return (
    gap <= gapMm ||
    (gap <= 2 && length > 0 && gap / length <= relativeGap) ||
    (isLoopLikeShape(shape) && gap <= shapeGapMm)
  );
}

export function ensureClosedLoop(points: Point2D[]): Point2D[] {
  if (points.length === 0) return [];
  const out = points.map(([x, y]) => [x, y] as Point2D);
  if (distance(out[0], out[out.length - 1]) > 1e-6) {
    out.push([out[0][0], out[0][1]]);
  } else {
    out[out.length - 1] = [out[0][0], out[0][1]];
  }
  return out;
}

export function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

function isLoopLikeShape(shape: Shape | undefined): boolean {
  if (!shape) return false;
  if (shape.holes.length > 0) return true;
  const loop = stripClosingDuplicate(shape.outer);
  if (loop.length < 5) return false;
  const box = bbox(loop);
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  const aspect = width >= height ? width / height : height / width;
  const area = Math.abs(polygonArea(loop));
  const perimeter = polygonPerimeter(loop);
  const compactness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  return compactness > 0.25 && aspect <= 5;
}

function stripClosingDuplicate(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);
  return distance(points[0], points[points.length - 1]) <= 1e-6
    ? points.slice(0, -1).map(([x, y]) => [x, y])
    : points.map(([x, y]) => [x, y]);
}

function polygonArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function polygonPerimeter(points: Point2D[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += distance(points[i], points[(i + 1) % points.length]);
  return total;
}

function bbox(points: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
