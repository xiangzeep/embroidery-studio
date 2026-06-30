import { medialAxisRun } from "./run";
import { intersectScanline } from "./scanline";
import { brickSplit } from "./satin";
import type { Point2D, Shape, StrokeKind } from "./types";

export function shouldRenderAsStrokeSatin(strokeKind: StrokeKind | undefined): boolean {
  return strokeKind === "narrow-satin" || strokeKind === "border-satin";
}

export function renderCurvedStrokeSatin(
  shape: Shape,
  densityMm: number,
  maxStitchMm: number,
  preferredEntry?: Point2D,
): Point2D[] {
  const centerline = orientOpenLine(
    medialAxisRun(shape, densityMm),
    preferredEntry,
  );
  if (centerline.length < 2) return [];

  const rings = [shape.outer, ...shape.holes];
  const out: Point2D[] = [];
  let rowIndex = 0;

  for (let i = 0; i < centerline.length; i++) {
    const center = centerline[i];
    const tangent = localTangent(centerline, i);
    if (!tangent) continue;
    const normal: Point2D = [-tangent[1], tangent[0]];
    const crossings = intersectScanline(rings, center[0], center[1], normal)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    const leftOffset = farthestNegativeNearZero(crossings);
    const rightOffset = smallestPositiveNearZero(crossings);
    if (leftOffset === null || rightOffset === null) continue;
    const left: Point2D = [
      center[0] + normal[0] * leftOffset,
      center[1] + normal[1] * leftOffset,
    ];
    const right: Point2D = [
      center[0] + normal[0] * rightOffset,
      center[1] + normal[1] * rightOffset,
    ];
    const segment = rowIndex % 2 === 0
      ? brickSplit(left, right, maxStitchMm, rowIndex)
      : brickSplit(right, left, maxStitchMm, rowIndex);
    appendPoints(out, segment);
    rowIndex++;
  }

  return out;
}

function orientOpenLine(points: Point2D[], preferredEntry?: Point2D): Point2D[] {
  if (!preferredEntry || points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const firstDist = Math.hypot(first[0] - preferredEntry[0], first[1] - preferredEntry[1]);
  const lastDist = Math.hypot(last[0] - preferredEntry[0], last[1] - preferredEntry[1]);
  return lastDist + 1e-6 < firstDist ? points.slice().reverse() : points;
}

function localTangent(points: Point2D[], index: number): Point2D | null {
  const prev = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  const dx = next[0] - prev[0];
  const dy = next[1] - prev[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-6) return null;
  return [dx / length, dy / length];
}

function farthestNegativeNearZero(values: number[]): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value >= 0) break;
    best = value;
  }
  return best;
}

function smallestPositiveNearZero(values: number[]): number | null {
  for (const value of values) {
    if (value > 0) return value;
  }
  return null;
}

function appendPoints(out: Point2D[], points: Point2D[]): void {
  if (points.length === 0) return;
  if (out.length === 0) {
    out.push(...points);
    return;
  }
  const last = out[out.length - 1];
  const first = points[0];
  if (Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]) < 1e-6) {
    out.push(...points.slice(1));
    return;
  }
  out.push(...points);
}
