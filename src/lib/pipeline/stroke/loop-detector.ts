import type { Point2D } from "../types";
import type { StrokePath } from "./stroke-types";
import { dedupeSequential, polylineLength } from "./stroke-cleaner";

const CLOSE_GAP_MM = 2.0;
const CLOSE_RELATIVE_GAP = 0.05;

export function detectClosedStroke(path: StrokePath): StrokePath {
  if (path.closed || path.points.length < 3) {
    return path.closed ? { ...path, points: ensureClosed(path.points), closed: true } : path;
  }
  const first = path.points[0];
  const last = path.points[path.points.length - 1];
  const gap = distance(first, last);
  const length = Math.max(path.length, polylineLength(path.points));
  const shouldClose = gap <= CLOSE_GAP_MM || (length > 0 && gap / length <= CLOSE_RELATIVE_GAP);
  if (!shouldClose) return path;

  const bridged = gap > 0.2
    ? path.points.concat(bezierBridge(last, first))
    : ensureClosed(path.points);
  const points = ensureClosed(dedupeSequential(bridged));
  return {
    ...path,
    points,
    closed: true,
    length: polylineLength(points),
  };
}

function bezierBridge(from: Point2D, to: Point2D): Point2D[] {
  const mid: Point2D = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return [
    [from[0] * 0.75 + mid[0] * 0.25, from[1] * 0.75 + mid[1] * 0.25],
    [from[0] * 0.25 + mid[0] * 0.75, from[1] * 0.25 + mid[1] * 0.75],
    [to[0], to[1]],
  ];
}

function ensureClosed(points: Point2D[]): Point2D[] {
  if (points.length === 0) return [];
  const out = points.map(([x, y]) => [x, y] as Point2D);
  if (distance(out[0], out[out.length - 1]) > 1e-6) out.push([out[0][0], out[0][1]]);
  return out;
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
