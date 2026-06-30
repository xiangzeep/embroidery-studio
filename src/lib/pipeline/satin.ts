// satin.ts — 2-rail satin renderer (Phase 4 PR17)。
//
// 既存 `satinStitches` (render.ts) は PCA 単一長軸方向のスキャンラインだけで、
// C / S / 円弧型 satin の「角の薄い部分で糸が浮く / 厚い部分で糸が潰れる」
// 欠点があった。本モジュールでは:
//   1. shape.outer から **2 本の長辺 rail (left/right)** を抽出 (`extractRails`)
//   2. 両 rail を arc-length 同期で等分割して left(t) → right(t) のジグザグを
//      出力 (`renderSatin2Rail`)
// を提供する純関数群を導入する。renderer 差し替えは Phase 4 PR18 (auto-split)
// 完了後に別 PR で行うため、本 PR は新規モジュール追加のみで orchestration 層
// への影響ゼロ。
//
// 純関数: 同一入力で同一出力。入力 Shape / SatinRails は破壊しない。

import type { Point2D, Shape } from "./types";

type Point = Point2D;

const MIDLINE_SAMPLE_COUNT = 200;
const CAP_GROUP_TOLERANCE_RATIO = 0.02; // axis span の 2% 以内を cap グループ扱い

/**
 * 2-rail satin の左右レール。
 * - left / right はそれぞれ start → end の順に並んだ polyline
 * - 頂点数は left / right で揃わなくてもよい (arc-length で同期)
 */
export type SatinRails = {
  left: Point[];
  right: Point[];
};

/**
 * shape.outer から 2 本の長辺 rail を抽出する。
 *
 * アルゴリズム:
 *   1. outer の閉じた重複点を除去 (pts)
 *   2. 凸包の最長エッジ方向を主軸 (axis) とする (PCA は C 字に弱いため)
 *   3. pts を axis に射影、min / max を取る
 *   4. 投影が min 近傍 / max 近傍にあって polyline 上で連続するグループを
 *      start cap / end cap として識別 (矩形では 2 頂点ずつ、C 字では 1 頂点ずつ)
 *   5. cap 間の 2 つの polyline 弧を rail とする
 *   6. axis 法線 (perp) 上の平均射影で left / right を確定
 *
 * 退化 shape (頂点 < 3 / axis 0 / cap 識別失敗) では outer 自身を rail とする
 * 安全フォールバックを返す。純関数。入力 Shape は破壊しない。
 */
export function extractRails(shape: Shape): SatinRails {
  const pts = stripClosingDuplicate(shape.outer);
  if (pts.length < 3) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }

  const hull = convexHull(pts);
  const axis = longestHullEdgeAxis(hull) ?? diameterAxis(hull);
  if (axis === null) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }

  const projs = pts.map((p) => p[0] * axis[0] + p[1] * axis[1]);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const v of projs) {
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
  }
  const span = maxP - minP;
  if (span <= 0) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }
  const tol = span * CAP_GROUP_TOLERANCE_RATIO;

  // cyclic 連続な start cap (proj - minP < tol) / end cap (maxP - proj < tol) を識別
  const inStart = projs.map((v) => v - minP <= tol);
  const inEnd = projs.map((v) => maxP - v <= tol);
  const startCap = findCyclicRun(inStart);
  const endCap = findCyclicRun(inEnd);
  if (startCap === null || endCap === null) {
    const copy = pts.slice();
    return { left: copy.slice(), right: copy.slice() };
  }

  // Rail 1: polyline forward from "last of startCap" to "first of endCap"
  // Rail 2: polyline forward from "last of endCap" to "first of startCap"
  //         (端点を反転して start → end 方向に揃える)
  const rail1 = sliceCyclic(pts, startCap.last, endCap.first);
  const rail2 = sliceCyclic(pts, endCap.last, startCap.first).slice().reverse();

  const perp: Point = [-axis[1], axis[0]];
  const projA = meanProjection(rail1, perp);
  const projB = meanProjection(rail2, perp);
  return projA >= projB
    ? { left: rail1, right: rail2 }
    : { left: rail2, right: rail1 };
}

/**
 * 2-rail を arc-length 同期で等分割し、ジグザグ satin 縫い目を生成する。
 *
 * 1. left / right それぞれの累積 arc-length を計算
 * 2. 細サンプル (MIDLINE_SAMPLE_COUNT) で中点曲線の実測長 L_mid を求める
 * 3. ステップ数 N = max(2, ceil(L_mid / densityMm))
 * 4. i = 0..N で t_i = i / N から left(t_i), right(t_i) を取得
 * 5. 偶数 i は [left, right]、奇数 i は [right, left] を push (zigzag)
 *
 * `maxStitchMm` は本 PR では受け取るのみ未使用。横幅 (rail 間) が `maxStitchMm`
 * を超える wide satin の brick split は Phase 4 PR18 で追加する。シグネチャを
 * 残すことで後続 PR の差分を局所化する。
 *
 * 純関数: 同一入力で同一出力。入力 SatinRails を破壊しない。
 */
export function renderSatin2Rail(
  rails: SatinRails,
  densityMm: number,
  _maxStitchMm: number,
): Point[] {
  void _maxStitchMm; // brickSplit は renderer 側 (render.ts applyBrickSplit) で呼ぶ
  const left = rails.left.slice();
  const right = rails.right.slice();
  if (left.length === 0 || right.length === 0) return [];

  const cumL = cumulativeLengths(left);
  const cumR = cumulativeLengths(right);
  if (cumL.total === 0 && cumR.total === 0) return [];

  const midTotal = estimateMidlineLength(left, cumL, right, cumR);
  const effectiveDensity = densityMm > 0 ? densityMm : 1;
  const N = Math.max(2, Math.ceil(midTotal / effectiveDensity));

  const out: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pl = arcLengthSample(left, cumL.lens, cumL.total, t);
    const pr = arcLengthSample(right, cumR.lens, cumR.total, t);
    if (i % 2 === 0) out.push(pl, pr);
    else out.push(pr, pl);
  }
  return out;
}

/**
 * Wide satin の 1 stitch (left → right) を maxStitchMm で分割し、行ごとに 1/3
 * 位相シフト (`phase = (rowIndex % 3) / 3`) を加えて needle perforation line を
 * 分散する (Phase 4 計画書 §4.2 / Wilcom Auto Split 相当)。
 *
 * - 距離 ≤ `maxStitchMm` のとき分割せず `[left, right]` をそのまま返す
 * - 距離 > `maxStitchMm` のとき `segs = ceil(dist / maxStitchMm)` 個の中間点を
 *   `t = clamp01(((i - 1) + phase) / segs)` で生成し、`[left, ...mid, right]`
 *   (長さ `segs + 2`) を返す
 *
 * 純関数: 同一入力で同一出力。入力 Point は破壊しない。
 */
export function brickSplit(
  left: Point,
  right: Point,
  maxStitchMm: number,
  rowIndex: number,
): Point[] {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const dist = Math.hypot(dx, dy);
  if (dist <= maxStitchMm || maxStitchMm <= 0) {
    return [[left[0], left[1]], [right[0], right[1]]];
  }
  const segs = Math.ceil(dist / maxStitchMm);
  const phase = (((rowIndex % 3) + 3) % 3) / 3;
  const out: Point[] = [[left[0], left[1]]];
  for (let i = 1; i <= segs; i++) {
    const t = clamp01(((i - 1) + phase) / segs);
    out.push(lerp(left, right, t));
  }
  out.push([right[0], right[1]]);
  return out;
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** テスト容易性のため (brickSplit, lerp を直接呼びたい場面) */
export const __internal = {
  brickSplit,
  lerp,
};

// ──────────────────────────────────────────────────────────────────────────────
// internal helpers (export しない)

function stripClosingDuplicate(poly: ReadonlyArray<Point>): Point[] {
  if (poly.length < 2) return poly.slice();
  const first = poly[0];
  const last = poly[poly.length - 1];
  if (last[0] === first[0] && last[1] === first[1]) {
    return poly.slice(0, -1);
  }
  return poly.slice();
}

/** Andrew's monotone chain で凸包を求める (CCW, 末尾重複なし)。 */
function convexHull(pts: Point[]): Point[] {
  const sorted = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** 凸包の最長エッジ単位ベクトルを返す (CCW なので向きは任意で OK)。 */
function longestHullEdgeAxis(hull: Point[]): Point | null {
  if (hull.length < 2) return null;
  let bestLen2 = 0;
  let bestAxis: Point | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 > bestLen2) {
      bestLen2 = l2;
      bestAxis = [dx, dy];
    }
  }
  if (bestAxis === null || bestLen2 === 0) return null;
  const len = Math.sqrt(bestLen2);
  return [bestAxis[0] / len, bestAxis[1] / len];
}

/** 凸包頂点の全 pair から最遠 pair の単位ベクトルを返す (fallback)。 */
function diameterAxis(hull: Point[]): Point | null {
  if (hull.length < 2) return null;
  let bestD2 = 0;
  let bestA: Point = hull[0];
  let bestB: Point = hull[0];
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const dx = hull[j][0] - hull[i][0];
      const dy = hull[j][1] - hull[i][1];
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) {
        bestD2 = d2;
        bestA = hull[i];
        bestB = hull[j];
      }
    }
  }
  if (bestD2 === 0) return null;
  const len = Math.sqrt(bestD2);
  return [(bestB[0] - bestA[0]) / len, (bestB[1] - bestA[1]) / len];
}

/**
 * 真偽配列の中で「cyclic に連続する true の run」を 1 つ識別し、
 * {first, last} (polyline index) を返す。複数の run が存在する場合は最長を選ぶ。
 * true が無ければ null。
 */
function findCyclicRun(mask: boolean[]): { first: number; last: number } | null {
  const n = mask.length;
  if (n === 0) return null;
  if (mask.every((m) => m)) return { first: 0, last: n - 1 };
  if (mask.every((m) => !m)) return null;

  // false を 1 つ以上含むので、false の直後 (cyclic) を run の開始候補とする
  let bestLen = 0;
  let bestStart = -1;
  let bestEnd = -1;
  for (let start = 0; start < n; start++) {
    const prev = (start - 1 + n) % n;
    if (!mask[start] || mask[prev]) continue; // run の開始は (prev=false, start=true)
    // start から true が続く長さを cyclic に測る
    let len = 0;
    let i = start;
    while (mask[i]) {
      len++;
      i = (i + 1) % n;
      if (i === start) break;
    }
    if (len > bestLen) {
      bestLen = len;
      bestStart = start;
      bestEnd = (start + len - 1) % n;
    }
  }
  if (bestStart === -1) return null;
  return { first: bestStart, last: bestEnd };
}

/** pts を周回して fromIdx → toIdx (両端含む) を取り出す。 */
function sliceCyclic(pts: Point[], fromIdx: number, toIdx: number): Point[] {
  const n = pts.length;
  const out: Point[] = [];
  let i = fromIdx;
  while (true) {
    out.push(pts[i]);
    if (i === toIdx) break;
    i = (i + 1) % n;
  }
  return out;
}

function meanProjection(path: Point[], dir: Point): number {
  if (path.length === 0) return 0;
  let sum = 0;
  for (const [x, y] of path) sum += x * dir[0] + y * dir[1];
  return sum / path.length;
}

/** polyline の累積長 (lens[i] は 0..i 区間の積算) と総長を返す。 */
function cumulativeLengths(poly: Point[]): { lens: number[]; total: number } {
  const lens: number[] = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i][0] - poly[i - 1][0];
    const dy = poly[i][1] - poly[i - 1][1];
    total += Math.hypot(dx, dy);
    lens.push(total);
  }
  return { lens, total };
}

/**
 * polyline 上で arc-length 比 `t ∈ [0,1]` に対応する点を線形補間で返す。
 * total = 0 (1 点 / 全頂点同位置) のときは先頭点を返す。
 */
function arcLengthSample(
  poly: Point[],
  cum: number[],
  total: number,
  t: number,
): Point {
  if (poly.length === 0) return [0, 0];
  if (poly.length === 1 || total === 0) return [poly[0][0], poly[0][1]];
  const target = Math.max(0, Math.min(total, total * t));
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const segLen = cum[lo] - cum[lo - 1];
  const ratio = segLen > 0 ? (target - cum[lo - 1]) / segLen : 0;
  const a = poly[lo - 1];
  const b = poly[lo];
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

/** 中点曲線 (left + right を t で同期した平均) の実測総長を返す。 */
function estimateMidlineLength(
  left: Point[],
  cumL: { lens: number[]; total: number },
  right: Point[],
  cumR: { lens: number[]; total: number },
): number {
  let prev: Point | null = null;
  let total = 0;
  for (let i = 0; i <= MIDLINE_SAMPLE_COUNT; i++) {
    const t = i / MIDLINE_SAMPLE_COUNT;
    const pl = arcLengthSample(left, cumL.lens, cumL.total, t);
    const pr = arcLengthSample(right, cumR.lens, cumR.total, t);
    const m: Point = [(pl[0] + pr[0]) / 2, (pl[1] + pr[1]) / 2];
    if (prev !== null) total += Math.hypot(m[0] - prev[0], m[1] - prev[1]);
    prev = m;
  }
  return total;
}
