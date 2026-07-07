import type { ObjectKind, Point2D, Polygon, Shape } from "./types";

export type ShapeRegularizerOptions = Partial<{
  rdpToleranceMm: number;
  smoothingIterations: number;
  minEdgeMm: number;
  resampleSpacingMm: number;
}>;

type RegularizerKind = ObjectKind;

const PRESETS: Record<RegularizerKind, Required<ShapeRegularizerOptions>> = {
  run: {
    rdpToleranceMm: 0.05,
    smoothingIterations: 1,
    minEdgeMm: 0.2,
    resampleSpacingMm: 0.6,
  },
  satin: {
    rdpToleranceMm: 0.12,
    smoothingIterations: 2,
    minEdgeMm: 0.3,
    resampleSpacingMm: 0.55,
  },
  fill: {
    rdpToleranceMm: 0.18,
    smoothingIterations: 3,
    minEdgeMm: 0.5,
    resampleSpacingMm: 0.75,
  },
};

export function regularizeShapeForStitch(
  shape: Shape,
  kind: RegularizerKind,
  opts: ShapeRegularizerOptions = {},
): Shape {
  const preset = { ...PRESETS[kind], ...opts };
  if (kind === "fill" && shouldEllipseRegularize(shape)) {
    return {
      outer: ellipseToPolygon(shape.outer, 96),
      holes: shape.holes.map((hole) => regularizePolygon(hole, PRESETS.satin)),
    };
  }

  return {
    outer: regularizePolygon(shape.outer, preset),
    holes: shape.holes.map((hole) => regularizePolygon(hole, kind === "run" ? PRESETS.run : PRESETS.satin)),
  };
}

function regularizePolygon(poly: Polygon, opts: Required<ShapeRegularizerOptions>): Polygon {
  const deduped = stripClosingDuplicate(removeDuplicatePoints(poly));
  if (deduped.length < 3) return ensureClosedPolygon(deduped);
  if (deduped.length <= 4) return ensureClosedPolygon(deduped);
  const filtered = removeShortEdges(deduped, opts.minEdgeMm);
  const simplified = simplifyClosedRdp(filtered.length >= 3 ? filtered : deduped, opts.rdpToleranceMm);
  const smoothed = chaikinClosed(simplified, opts.smoothingIterations);
  const fitted = closedCatmullRom(smoothed, 4);
  const resampled = resampleClosedByArcLength(fitted, opts.resampleSpacingMm);
  return ensureClosedPolygon(resampled);
}

function shouldEllipseRegularize(shape: Shape): boolean {
  if (shape.outer.length < 8 || shape.holes.length > 0) return false;
  const metrics = polygonMetrics(shape.outer);
  return (
    metrics.area > 20 &&
    metrics.compactness > 0.65 &&
    metrics.aspectRatio >= 0.75 &&
    metrics.aspectRatio <= 1.35
  );
}

function ellipseToPolygon(poly: Polygon, segments: number): Polygon {
  const loop = stripClosingDuplicate(poly);
  const center = centroid(loop);
  const box = bbox(loop);
  const rx = Math.max((box.maxX - box.minX) / 2, 0.01);
  const ry = Math.max((box.maxY - box.minY) / 2, 0.01);
  const out: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    out.push([center[0] + Math.cos(angle) * rx, center[1] + Math.sin(angle) * ry]);
  }
  return ensureClosedPolygon(out);
}

function removeDuplicatePoints(points: Polygon): Polygon {
  const out: Polygon = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && distance(prev, point) <= 1e-6) continue;
    out.push([point[0], point[1]]);
  }
  return out;
}

function removeShortEdges(points: Polygon, minEdgeMm: number): Polygon {
  if (points.length < 4) return points.map(([x, y]) => [x, y]);
  const out: Polygon = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const next = points[i];
    if (distance(prev, next) < minEdgeMm && i < points.length - 1) continue;
    out.push([next[0], next[1]]);
  }
  return out.length >= 3 ? out : points.map(([x, y]) => [x, y]);
}

function simplifyClosedRdp(points: Polygon, epsilon: number): Polygon {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 4 || epsilon <= 0) return loop.map(([x, y]) => [x, y]);
  const closed = loop.concat([[loop[0][0], loop[0][1]]]);
  const simplified = stripClosingDuplicate(simplifyRdp(closed, epsilon));
  return simplified.length >= 3 ? simplified : loop;
}

function simplifyRdp(points: Polygon, epsilon: number): Polygon {
  if (points.length <= 2) return points.map(([x, y]) => [x, y]);
  let maxDistance = 0;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], start, end);
    if (d > maxDistance) {
      maxDistance = d;
      splitIndex = i;
    }
  }
  if (maxDistance <= epsilon || splitIndex === -1) return [[start[0], start[1]], [end[0], end[1]]];
  const left = simplifyRdp(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function chaikinClosed(points: Polygon, iterations: number): Polygon {
  let current = stripClosingDuplicate(points).map(([x, y]) => [x, y] as Point2D);
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;
    const next: Polygon = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    current = next;
  }
  return current;
}

function closedCatmullRom(points: Polygon, samplesPerSegment: number): Polygon {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 3) return loop.map(([x, y]) => [x, y]);
  const out: Polygon = [];
  const samples = Math.max(2, Math.floor(samplesPerSegment));
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[(i - 1 + loop.length) % loop.length];
    const p1 = loop[i];
    const p2 = loop[(i + 1) % loop.length];
    const p3 = loop[(i + 2) % loop.length];
    for (let s = 0; s < samples; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / samples));
    }
  }
  return out;
}

function resampleClosedByArcLength(points: Polygon, spacingMm: number): Polygon {
  const loop = stripClosingDuplicate(points);
  if (loop.length < 3 || spacingMm <= 0) return loop.map(([x, y]) => [x, y]);
  const lengths = [0];
  let total = 0;
  for (let i = 1; i <= loop.length; i++) {
    total += distance(loop[i - 1], loop[i % loop.length]);
    lengths.push(total);
  }
  if (total <= 1e-6) return loop;
  const count = Math.max(8, Math.round(total / spacingMm));
  const out: Polygon = [];
  for (let i = 0; i < count; i++) {
    out.push(sampleClosed(loop, lengths, (total * i) / count));
  }
  return out;
}

function sampleClosed(points: Polygon, lengths: number[], target: number): Point2D {
  const total = lengths[lengths.length - 1];
  const wrapped = ((target % total) + total) % total;
  let hi = 1;
  while (hi < lengths.length && lengths[hi] < wrapped) hi++;
  const lo = hi - 1;
  const start = points[lo % points.length];
  const end = points[hi % points.length];
  const span = lengths[hi] - lengths[lo];
  if (span <= 1e-6) return [start[0], start[1]];
  const t = (wrapped - lengths[lo]) / span;
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

function ensureClosedPolygon(points: Polygon): Polygon {
  if (points.length === 0) return [];
  const out = points.map(([x, y]) => [x, y] as Point2D);
  const first = out[0];
  const last = out[out.length - 1];
  if (distance(first, last) > 1e-6) out.push([first[0], first[1]]);
  else out[out.length - 1] = [first[0], first[1]];
  return out;
}

function stripClosingDuplicate(points: Polygon): Polygon {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) <= 1e-6) return points.slice(0, -1).map(([x, y]) => [x, y]);
  return points.map(([x, y]) => [x, y]);
}

function polygonMetrics(poly: Polygon): { area: number; compactness: number; aspectRatio: number } {
  const area = Math.abs(polygonArea(poly));
  const perimeter = polygonPerimeter(poly);
  const box = bbox(poly);
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  return {
    area,
    compactness: perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
    aspectRatio: width >= height ? width / height : height / width,
  };
}

function polygonArea(poly: Polygon): number {
  const loop = stripClosingDuplicate(poly);
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function polygonPerimeter(poly: Polygon): number {
  const loop = stripClosingDuplicate(poly);
  let total = 0;
  for (let i = 0; i < loop.length; i++) total += distance(loop[i], loop[(i + 1) % loop.length]);
  return total;
}

function bbox(points: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function centroid(points: Polygon): Point2D {
  const loop = stripClosingDuplicate(points);
  const total = loop.reduce<Point2D>((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
  return [total[0] / Math.max(loop.length, 1), total[1] / Math.max(loop.length, 1)];
}

function pointToSegmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 1e-12) return distance(point, a);
  const t = Math.min(Math.max(((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / abLen2, 0), 1);
  return distance(point, [a[0] + abx * t, a[1] + aby * t]);
}

function catmullRom(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const tt = t * t;
  const ttt = tt * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * tt + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * ttt),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * tt + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * ttt),
  ];
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
