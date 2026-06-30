import type { EmbroideryObject, Point2D, Shape } from "./types";

export type SafeTravelInput = {
  fromObject: EmbroideryObject;
  toObject: EmbroideryObject;
  from: Point2D;
  to: Point2D;
};

const STROKE_GAP_TRAVEL_MAX_MM = 1.5;
const STROKE_GAP_MIN_ALIGNMENT = 0.75;

export function isSafeTravelBetweenObjects(input: SafeTravelInput): boolean {
  if (input.fromObject.layer !== input.toObject.layer) return false;
  if (input.fromObject.id === input.toObject.id) {
    return isSegmentInsideShape(input.toObject.shape, input.from, input.to);
  }
  if (input.fromObject.colorIndex !== input.toObject.colorIndex) return false;
  if (isSafeStrokeGapTravel(input)) return true;
  if (!shapesTouch(input.fromObject.shape, input.toObject.shape)) return false;
  return isSegmentInsideEitherShape(input.fromObject.shape, input.toObject.shape, input.from, input.to);
}

function isSafeStrokeGapTravel(input: SafeTravelInput): boolean {
  if (!isStrokeLike(input.fromObject) || !isStrokeLike(input.toObject)) return false;
  const gap = Math.hypot(input.to[0] - input.from[0], input.to[1] - input.from[1]);
  if (gap <= 1e-7) return true;
  if (gap > STROKE_GAP_TRAVEL_MAX_MM) return false;

  const gapDir: Point2D = [
    (input.to[0] - input.from[0]) / gap,
    (input.to[1] - input.from[1]) / gap,
  ];
  const fromAlignment = bestStrokeDirectionAlignment(input.fromObject.shape, input.from, gapDir);
  const toAlignment = bestStrokeDirectionAlignment(input.toObject.shape, input.to, gapDir);
  return (
    fromAlignment >= STROKE_GAP_MIN_ALIGNMENT &&
    toAlignment >= STROKE_GAP_MIN_ALIGNMENT
  );
}

function isStrokeLike(obj: EmbroideryObject): boolean {
  return (
    obj.strokeKind !== undefined &&
    obj.strokeKind !== "none" &&
    obj.strokeMetrics?.isStrokeLike === true
  );
}

function longAxisUnit(shape: Shape): Point2D {
  const points = shape.outer;
  if (points.length < 2) return [1, 0];
  let bestA = points[0];
  let bestB = points[1];
  let bestDist = -Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j][0] - points[i][0];
      const dy = points[j][1] - points[i][1];
      const distSq = dx * dx + dy * dy;
      if (distSq > bestDist) {
        bestDist = distSq;
        bestA = points[i];
        bestB = points[j];
      }
    }
  }
  const length = Math.hypot(bestB[0] - bestA[0], bestB[1] - bestA[1]);
  if (length <= 1e-7) return [1, 0];
  return [(bestB[0] - bestA[0]) / length, (bestB[1] - bestA[1]) / length];
}

function bestStrokeDirectionAlignment(shape: Shape, anchor: Point2D, gapDir: Point2D): number {
  let best = axisAlignment(gapDir, longAxisUnit(shape));
  for (const dir of localBoundaryDirections(shape.outer, anchor)) {
    best = Math.max(best, axisAlignment(gapDir, dir));
  }
  return best;
}

function localBoundaryDirections(poly: Point2D[], anchor: Point2D): Point2D[] {
  if (poly.length < 2) return [];
  const ranked: Array<{ index: number; distance: number }> = [];

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = pointToSegmentDistance(anchor, a, b);
    ranked.push({ index: i, distance: d });
  }
  ranked.sort((a, b) => a.distance - b.distance);

  const directions: Point2D[] = [];
  const seen = new Set<string>();
  for (const { index } of ranked.slice(0, 3)) {
    const start = poly[index];
    const end = poly[(index + 1) % poly.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-7) continue;
    const dir: Point2D = [dx / length, dy / length];
    const key = `${Math.abs(dir[0]).toFixed(4)},${Math.abs(dir[1]).toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    directions.push(dir);
  }
  return directions;
}

function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + dx * t;
  const cy = a[1] + dy * t;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function axisAlignment(a: Point2D, b: Point2D): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1]);
}

export function isSegmentInsideShape(
  shape: Shape,
  from: Point2D,
  to: Point2D,
  samples = 12,
): boolean {
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point: Point2D = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ];
    if (!pointInShape(shape, point)) return false;
  }
  return true;
}

function isSegmentInsideEitherShape(
  a: Shape,
  b: Shape,
  from: Point2D,
  to: Point2D,
  samples = 12,
): boolean {
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point: Point2D = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ];
    if (!pointInShape(a, point) && !pointInShape(b, point)) return false;
  }
  return true;
}

function pointInShape(shape: Shape, point: Point2D): boolean {
  if (!pointInPolygonInclusive(shape.outer, point)) return false;
  return !shape.holes.some((hole) => pointInPolygonInclusive(hole, point));
}

function shapesTouch(a: Shape, b: Shape): boolean {
  if (a.outer.length < 3 || b.outer.length < 3) return false;
  for (const point of a.outer) {
    if (pointInPolygonInclusive(b.outer, point)) return true;
  }
  for (const point of b.outer) {
    if (pointInPolygonInclusive(a.outer, point)) return true;
  }
  for (let i = 0; i < a.outer.length; i++) {
    const a1 = a.outer[i];
    const a2 = a.outer[(i + 1) % a.outer.length];
    for (let j = 0; j < b.outer.length; j++) {
      const b1 = b.outer[j];
      const b2 = b.outer[(j + 1) % b.outer.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
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

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  if (pointOnSegment(a, b, c) || pointOnSegment(a, b, d)) return true;
  if (pointOnSegment(c, d, a) || pointOnSegment(c, d, b)) return true;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(value) < 1e-7) return 0;
  return value > 0 ? 1 : -1;
}
