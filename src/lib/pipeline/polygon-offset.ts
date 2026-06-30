// English note.
// English note.
// English note.

import ClipperLib, { type IntPoint, type Path, type Paths } from "clipper-lib";
import type { Point2D, Polygon, Shape } from "./types";

const DEFAULT_SCALE = 1000; // 1 mm = 1000 clipper unit (1µm 精度)
const DEFAULT_MITER_LIMIT = 2;
const DEFAULT_ARC_TOLERANCE = 0.25; // English note.

const JOIN_TYPE_MAP = {
  miter: ClipperLib.JoinType.jtMiter,
  round: ClipperLib.JoinType.jtRound,
  square: ClipperLib.JoinType.jtSquare,
} as const;

export type OffsetOpts = {
  scale?: number;
  jointType?: keyof typeof JOIN_TYPE_MAP;
};

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 */
export function offsetPolygon(
  polygon: Polygon,
  deltaMm: number,
  opts?: OffsetOpts,
): Polygon[] | null {
  if (polygon.length < 3) return null;
  const scale = opts?.scale ?? DEFAULT_SCALE;
  const joinType = JOIN_TYPE_MAP[opts?.jointType ?? "miter"];
  try {
    const co = new ClipperLib.ClipperOffset(
      DEFAULT_MITER_LIMIT,
      DEFAULT_ARC_TOLERANCE,
    );
    co.AddPath(toClipperPath(polygon, scale), joinType, ClipperLib.EndType.etClosedPolygon);
    const solution: Paths = [];
    co.Execute(solution, deltaMm * scale);
    return solution.map((p) => fromClipperPath(p, scale));
  } catch {
    return null;
  }
}

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 */
export function offsetShape(
  shape: Shape,
  outerDeltaMm: number,
  holeDeltaMm: number,
  opts?: { scale?: number },
): Shape {
  const outerOff = offsetPolygon(shape.outer, outerDeltaMm, opts);
  if (outerOff === null || outerOff.length === 0) return cloneShape(shape);
  const newOuter = pickLargest(outerOff);
  if (!newOuter) return cloneShape(shape);

  const newHoles: Polygon[] = [];
  for (const hole of shape.holes) {
    const off = offsetPolygon(hole, holeDeltaMm, opts);
    if (!off || off.length === 0) continue;
    const pick = pickLargest(off);
    if (pick) newHoles.push(pick);
  }
  return { outer: newOuter, holes: newHoles };
}

/**
 * English note.
 * English note.
 * English note.
 */
export function polygonsOverlap(a: Shape, b: Shape): boolean {
  if (a.outer.length < 3 || b.outer.length < 3) return false;
  if (!bboxIntersects(a.outer, b.outer)) return false;
  const scale = DEFAULT_SCALE;
  try {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPath(toClipperPath(a.outer, scale), ClipperLib.PolyType.ptSubject, true);
    clipper.AddPath(toClipperPath(b.outer, scale), ClipperLib.PolyType.ptClip, true);
    const solution: Paths = [];
    const ok = clipper.Execute(
      ClipperLib.ClipType.ctIntersection,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );
    if (!ok) return false;
    return solution.some((p) => p.length >= 3);
  } catch {
    return false;
  }
}

// --- private helpers ---

function cloneShape(shape: Shape): Shape {
  return {
    outer: shape.outer.map(([x, y]) => [x, y] as Point2D),
    holes: shape.holes.map((h) => h.map(([x, y]) => [x, y] as Point2D)),
  };
}

function toClipperPath(polygon: Polygon, scale: number): Path {
  return polygon.map(([x, y]) => ({
    X: Math.round(x * scale),
    Y: Math.round(y * scale),
  }));
}

function fromClipperPath(path: Path, scale: number): Polygon {
  return path.map((p: IntPoint) => [p.X / scale, p.Y / scale] as Point2D);
}

function polygonArea(polygon: Polygon): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function pickLargest(polys: Polygon[]): Polygon | null {
  if (polys.length === 0) return null;
  let best = polys[0];
  let bestArea = polygonArea(best);
  for (let i = 1; i < polys.length; i++) {
    const a = polygonArea(polys[i]);
    if (a > bestArea) {
      best = polys[i];
      bestArea = a;
    }
  }
  return bestArea > 0 ? best : null;
}

function bboxIntersects(a: Polygon, b: Polygon): boolean {
  let aMinX = Infinity,
    aMaxX = -Infinity,
    aMinY = Infinity,
    aMaxY = -Infinity;
  for (const [x, y] of a) {
    if (x < aMinX) aMinX = x;
    if (x > aMaxX) aMaxX = x;
    if (y < aMinY) aMinY = y;
    if (y > aMaxY) aMaxY = y;
  }
  let bMinX = Infinity,
    bMaxX = -Infinity,
    bMinY = Infinity,
    bMaxY = -Infinity;
  for (const [x, y] of b) {
    if (x < bMinX) bMinX = x;
    if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y;
    if (y > bMaxY) bMaxY = y;
  }
  return aMaxX >= bMinX && bMaxX >= aMinX && aMaxY >= bMinY && bMaxY >= aMinY;
}
