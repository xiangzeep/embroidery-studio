import type { Point2D } from "../types";
import type { StrokePath } from "./stroke-types";
import { polylineLength } from "./stroke-cleaner";

const LENGTH_RATIO_TOLERANCE = 0.1;
const HAUSDORFF_DUPLICATE_MM = 0.5;

export function mergeSimilarStrokePaths(paths: StrokePath[]): StrokePath[] {
  const kept: StrokePath[] = [];
  const sorted = paths.slice().sort((a, b) => b.length - a.length);
  for (const path of sorted) {
    if (kept.some((existing) => similarPath(existing, path))) continue;
    kept.push(path);
  }
  return kept.sort((a, b) => paths.indexOf(a) - paths.indexOf(b));
}

function similarPath(a: StrokePath, b: StrokePath): boolean {
  const longer = Math.max(a.length, b.length, 1e-6);
  if (Math.abs(a.length - b.length) / longer >= LENGTH_RATIO_TOLERANCE) return false;
  if (directionDot(a.points, b.points) < 0.8) return false;
  return hausdorffDistance(a.points, b.points) < HAUSDORFF_DUPLICATE_MM;
}

function hausdorffDistance(a: Point2D[], b: Point2D[]): number {
  return Math.max(directedDistance(a, b), directedDistance(b, a));
}

function directedDistance(a: Point2D[], b: Point2D[]): number {
  let worst = 0;
  for (const point of a) {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) best = Math.min(best, pointToSegmentDistance(point, b[i - 1], b[i]));
    worst = Math.max(worst, best);
  }
  return worst;
}

function directionDot(a: Point2D[], b: Point2D[]): number {
  const av = vector(a);
  const bv = vector(b);
  const al = Math.hypot(av[0], av[1]);
  const bl = Math.hypot(bv[0], bv[1]);
  if (al <= 1e-6 || bl <= 1e-6 || polylineLength(a) <= 1e-6 || polylineLength(b) <= 1e-6) return 1;
  return Math.abs((av[0] * bv[0] + av[1] * bv[1]) / (al * bl));
}

function vector(points: Point2D[]): Point2D {
  return [points.at(-1)![0] - points[0][0], points.at(-1)![1] - points[0][1]];
}

function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}
