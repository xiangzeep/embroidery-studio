import type { Point2D, Polygon, Shape } from "./types";

export function simplifyShapeBoundary(shape: Shape, tolerancePx: number): Shape {
  if (tolerancePx <= 0) {
    return {
      outer: shape.outer.map(copyPoint),
      holes: shape.holes.map((hole) => hole.map(copyPoint)),
    };
  }
  return {
    outer: simplifyPolygon(shape.outer, tolerancePx),
    holes: shape.holes
      .map((hole) => simplifyPolygon(hole, tolerancePx))
      .filter((hole) => hole.length >= 3),
  };
}

export function simplifyPolygon(polygon: Polygon, tolerancePx: number): Polygon {
  if (polygon.length <= 4 || tolerancePx <= 0) return polygon.map(copyPoint);
  const closed = pointsEqual(polygon[0], polygon[polygon.length - 1]);
  const open = closed ? polygon.slice(0, -1) : polygon.slice();
  if (open.length <= 4) return open.map(copyPoint);

  const anchorIndex = farthestPointIndex(open, open[0]);
  const rotated = open.slice(anchorIndex).concat(open.slice(0, anchorIndex));
  const doubled = rotated.concat([rotated[0]]);
  const simplified = removeCollinearDuplicates(rdp(doubled, tolerancePx).slice(0, -1));
  return rotateToNearestStart(simplified, open[0]).map(copyPoint);
}

function rotateToNearestStart(points: Point2D[], start: Point2D): Point2D[] {
  if (points.length === 0) return points;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const distance = Math.hypot(points[i][0] - start[0], points[i][1] - start[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return points.slice(bestIndex).concat(points.slice(0, bestIndex));
}

function rdp(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) return points.map(copyPoint);
  const first = points[0];
  const last = points[points.length - 1];
  let bestIndex = -1;
  let bestDistance = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointLineDistance(points[i], first, last);
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  if (bestDistance <= tolerance || bestIndex === -1) {
    return [copyPoint(first), copyPoint(last)];
  }
  const left = rdp(points.slice(0, bestIndex + 1), tolerance);
  const right = rdp(points.slice(bestIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

function pointLineDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const x = a[0] + dx * t;
  const y = a[1] + dy * t;
  return Math.hypot(p[0] - x, p[1] - y);
}

function farthestPointIndex(points: Point2D[], from: Point2D): number {
  let best = 0;
  let bestDist = -1;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.hypot(points[i][0] - from[0], points[i][1] - from[1]);
    if (dist > bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function removeCollinearDuplicates(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points;
  const out: Point2D[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const cross = (curr[0] - prev[0]) * (next[1] - curr[1]) - (curr[1] - prev[1]) * (next[0] - curr[0]);
    if (Math.abs(cross) > 1e-9) out.push(curr);
  }
  return out.length >= 3 ? out : points;
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function copyPoint(point: Point2D): Point2D {
  return [point[0], point[1]];
}
