// Phase 2 計画書 §3-§5 で利用する polygon ブール演算 / オフセットの clipper-lib ラッパ。
// clipper-lib は整数座標で動くため、mm → 1/1000mm にスケールして渡し、戻り値で逆変換する。
// 53bit safe integer (~9e15) に対し、200mm × 1000 = 2e5 → スケール後の積でも安全。

import ClipperLib, { type IntPoint, type Path, type Paths } from "clipper-lib";
import type { Point2D, Polygon, Shape } from "./types";

const DEFAULT_SCALE = 1000; // 1 mm = 1000 clipper unit (1µm 精度)
const DEFAULT_MITER_LIMIT = 2;
const DEFAULT_ARC_TOLERANCE = 0.25; // clipper 単位、square/miter join では未使用

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
 * 単一 polygon を `deltaMm` だけオフセットする。
 *
 * - delta > 0: 外側に拡大
 * - delta < 0: 内側に縮小。結果が消失したら空配列を返す
 * - 入力が 3 点未満、または clipper が例外を投げた場合は `null` を返す
 * - 戻り値は複数 polygon になり得る (鋭角での自己交差解消などで分裂する場合)
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
 * Shape (outer + holes) を一括オフセットする。
 *
 * - `outerDeltaMm`: outer ring に適用 (正で拡大、負で縮小)
 * - `holeDeltaMm`: 各 hole ring に適用 (正で穴を拡大、負で縮小)
 * - outer 消失時は元 shape を **そのまま参照同一返却** (フォールバック)
 * - outer が分裂した場合は最大面積のもの 1 つだけを採用 (Phase 2 ではシンプル化)
 * - 結果が消失した hole は holes 配列から落とす
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
 * 2 shape の outer ring が重なるかを返す。
 * bbox 先行判定で確実に非重なりを除外し、残りは clipper の Intersection で確認する。
 * `holes` は無視する (Phase 2 では outer 同士の重なり判定で十分)。
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
