import type { Point2D } from "./types";

export function beanStitchPolyline(points: Point2D[], maxStitchMm: number): Point2D[] {
  if (points.length < 2) return [...points];
  const safeMax = Number.isFinite(maxStitchMm) && maxStitchMm > 0 ? maxStitchMm : 7;
  const split = splitLongSegments(points, safeMax);
  if (split.length < 2) return split;

  const out: Point2D[] = [split[0]];
  for (let i = 1; i < split.length; i++) {
    const prev = split[i - 1];
    const next = split[i];
    out.push(next, prev, next);
  }
  return out;
}

function splitLongSegments(points: Point2D[], maxStitchMm: number): Point2D[] {
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const next = points[i];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const dist = Math.hypot(dx, dy);
    if (dist <= maxStitchMm || dist <= 1e-9) {
      out.push(next);
      continue;
    }
    const steps = Math.ceil(dist / maxStitchMm);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push([
        prev[0] + dx * t,
        prev[1] + dy * t,
      ]);
    }
  }
  return out;
}
