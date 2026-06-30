// Phase 2 計画書 §3 Underlay。
// PR10 + PR11 完了状態:
//   - edgeRunUnderlay: 外形を内側オフセット + 各 hole を外側オフセットして resample
//   - centerRunUnderlay: Zhang-Suen thinning で medial-axis polyline を抽出
//   - fillUnderlay: 表縫いに直交方向の粗 scanline (fill 用)
//   - zigzagUnderlay: 細長 satin の両 rail 間を spacing で往復する単一 polyline
// 純関数: Shape + 数値のみを入力とし、EmbroideryObject / UnderlayConfig には触らない。
// generateUnderlayStitches 統合は PR12 で行う。

import type { EmbroideryObject, Point2D, Polygon, Shape, Stitch } from "./types";
import { analyzeShape } from "./geometry";
import { offsetPolygon } from "./polygon-offset";
import { intersectScanline } from "./scanline";
import { pointInPolygon } from "./vectorize";

const PX_PER_MM = 10; // center-run の rasterize 解像度 (1px = 0.1mm)
const MIN_SKELETON_PIXELS = 12; // これ未満の skeleton は退化扱いで空配列
const MIN_AREA_MM2 = 0.25; // 極小 shape の早期除外閾値

/**
 * Edge-run underlay (Phase 2 §3.1 中幅 satin / fill 用)。
 *
 * 戻り値の `Point2D[][]` は「複数の閉ループ polyline」を表す:
 *   - `[0]`:    外形を `insetMm` 内側に縮めたリング (1 本)
 *   - `[1..]`:  各 hole を `insetMm` 外側に膨らませたリング (入力順)
 *
 * **外形が消失した場合は空配列を返す** (holes だけが残ると順序契約が崩れ、
 * 下縫いの意味を成さないため)。任意の hole が消失したらその hole のリングだけを落とす。
 * `insetMm <= 0` や `stitchLenMm <= 0` の不正入力には早期 return で空配列を返す。
 */
export function edgeRunUnderlay(
  shape: Shape,
  insetMm: number,
  stitchLenMm: number,
): Point2D[][] {
  if (insetMm <= 0 || stitchLenMm <= 0) return [];
  const outerOff = offsetPolygon(shape.outer, -insetMm);
  if (!outerOff || outerOff.length === 0) return [];
  const outerRing = pickLargest(outerOff);
  if (!outerRing) return [];

  const rings: Point2D[][] = [resampleClosedRing(outerRing, stitchLenMm)];
  for (const hole of shape.holes) {
    const holeOff = offsetPolygon(hole, +insetMm);
    if (!holeOff || holeOff.length === 0) continue;
    const ring = pickLargest(holeOff);
    if (ring) rings.push(resampleClosedRing(ring, stitchLenMm));
  }
  return rings;
}

/**
 * Center-run underlay (Phase 2 §3.1 細 satin 用)。
 *
 * `shape` を `PX_PER_MM` 解像度のマスクにラスタライズし、Zhang-Suen thinning で 1px 幅 skeleton
 * を抽出。skeleton の **直径 (BFS 2 回で求める最長単純パス)** を mm 座標に逆変換して
 * `stitchLenMm` で resample する。
 *
 * 退化条件で空配列を返す:
 *   - `stitchLenMm <= 0`
 *   - shape の面積が `MIN_AREA_MM2` 未満
 *   - skeleton ピクセル数が `MIN_SKELETON_PIXELS` 未満
 */
export function centerRunUnderlay(
  shape: Shape,
  stitchLenMm: number,
): Point2D[] {
  if (stitchLenMm <= 0) return [];
  if (polygonArea(shape.outer) < MIN_AREA_MM2) return [];

  const raster = rasterizeShapeToMask(shape, PX_PER_MM);
  const skel = thinMaskZhangSuen(raster.mask, raster.width, raster.height);
  if (countOn(skel) < MIN_SKELETON_PIXELS) return [];

  const pathPx = traceLongestSkeletonPath(skel, raster.width, raster.height);
  if (pathPx.length < 2) return [];

  const pathMm: Polygon = pathPx.map(([px, py]) => [
    raster.offsetX + (px + 0.5) / PX_PER_MM,
    raster.offsetY + (py + 0.5) / PX_PER_MM,
  ]);
  return resampleOpenLine(pathMm, stitchLenMm);
}

/**
 * Fill underlay (Phase 2 §3.1 fill object 用)。
 *
 * 表縫いの方向 `angleDeg` に対して **直交方向** (= `angleDeg + 90°`) で粗い scanline を生成。
 * `spacingMm` 間隔で走査し、各スキャンラインが outer/holes と交わる区間を 2 点セグメント
 * (`[startPoint, endPoint]`) として返す。穴の中には点が落ちないよう even-odd でペア化する。
 *
 * - 戻り値 `Point2D[][]`: 各要素は 2 点ちょうどの線分 (`segments[i].length === 2`)
 * - `outer.length < 3` / `spacingMm <= 0` で空配列
 * - 各 scanline の交点が奇数なら末尾を切り捨てて偶数に揃える (退化保護)
 */
export function fillUnderlay(
  shape: Shape,
  angleDeg: number,
  spacingMm: number,
): Point2D[][] {
  if (shape.outer.length < 3 || spacingMm <= 0) return [];
  // 直交方向に走らせる: stitch dir = angleDeg + 90°
  const rad = ((angleDeg + 90) * Math.PI) / 180;
  const dir: [number, number] = [Math.cos(rad), Math.sin(rad)];
  const perp: [number, number] = [-dir[1], dir[0]];

  let minS = Infinity,
    maxS = -Infinity;
  for (const [x, y] of shape.outer) {
    const s = x * perp[0] + y * perp[1];
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }

  const rings: Polygon[] = [shape.outer, ...shape.holes];
  const segments: Point2D[][] = [];
  for (let s = minS; s <= maxS + 1e-9; s += spacingMm) {
    const ox = perp[0] * s;
    const oy = perp[1] * s;
    const crossings = intersectScanline(rings, ox, oy, dir);
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    if (crossings.length % 2 !== 0) crossings.pop();
    for (let i = 0; i < crossings.length; i += 2) {
      const a = crossings[i];
      const b = crossings[i + 1];
      segments.push([
        [ox + dir[0] * a, oy + dir[1] * a],
        [ox + dir[0] * b, oy + dir[1] * b],
      ]);
    }
  }
  return segments;
}

/**
 * Zigzag underlay (Phase 2 §3.1 幅広 satin 用)。
 *
 * PCA で長軸を取り、両 rail (= 短軸方向に `±(shortSide/2 - insetMm)`) の間を
 * `spacingMm` 刻みで往復する **単一 polyline** を返す。点は左 rail / 右 rail を交互に並ぶ。
 *
 * - 退化条件 (`shortSide/2 <= insetMm`) では空配列
 * - `shape.outer.length < 3` / `spacingMm <= 0` で空配列
 * - `shape.holes` は無視 (satin underlay 用途のため)
 */
export function zigzagUnderlay(
  shape: Shape,
  spacingMm: number,
  insetMm: number,
): Point2D[] {
  if (shape.outer.length < 3 || spacingMm <= 0) return [];
  const { shortSide, longAxis, center } = analyzeShape(shape.outer);
  const halfWidth = shortSide / 2 - insetMm;
  if (halfWidth <= 0) return [];
  const shortAxis: [number, number] = [-longAxis[1], longAxis[0]];

  let minL = Infinity,
    maxL = -Infinity;
  for (const [x, y] of shape.outer) {
    const l = (x - center[0]) * longAxis[0] + (y - center[1]) * longAxis[1];
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }
  const span = maxL - minL;
  const steps = Math.max(1, Math.round(span / spacingMm));
  const out: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const l = minL + (span * i) / steps;
    const side = i % 2 === 0 ? -halfWidth : +halfWidth;
    out.push([
      center[0] + longAxis[0] * l + shortAxis[0] * side,
      center[1] + longAxis[1] * l + shortAxis[1] * side,
    ]);
  }
  return out;
}

/**
 * `obj.props.underlay.kind` に応じて適切な underlay 関数を dispatch し
 * `Stitch[]` (kind="run", colorIndex は obj 由来) に変換して返す。
 *
 * - `kind === "none"` or `obj.props.underlay` 未定義: 空配列
 * - `kind === "edge-run"`: `edgeRunUnderlay(obj.shape, insetMm, stitchLenMm).flat()`
 * - `kind === "center-run"`: `centerRunUnderlay(obj.shape, stitchLenMm)`
 * - `kind === "zigzag"`: `zigzagUnderlay(obj.shape, spacingMm, insetMm)`
 * - `kind === "fill"`: `fillUnderlay(obj.shape, angleDeg, spacingMm).flat()`
 *
 * jump/trim 挿入は呼び出し側 (`render.ts`) の責務。
 */
export function generateUnderlayStitches(obj: EmbroideryObject): Stitch[] {
  const u = obj.props.underlay;
  if (!u || u.kind === "none") return [];
  let points: Point2D[] = [];
  switch (u.kind) {
    case "edge-run":
      points = edgeRunUnderlay(obj.shape, u.insetMm, u.stitchLenMm).flat();
      break;
    case "center-run":
      points = centerRunUnderlay(obj.shape, u.stitchLenMm);
      break;
    case "zigzag":
      points = zigzagUnderlay(obj.shape, u.spacingMm, u.insetMm);
      break;
    case "fill":
      points = fillUnderlay(obj.shape, u.angleDeg, u.spacingMm).flat();
      break;
  }
  return points.map(([x, y]) => ({
    x,
    y,
    kind: "run" as const,
    colorIndex: obj.colorIndex,
  }));
}

// --- private helpers ---

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

/**
 * 閉ループ polyline を `stitchLenMm` 間隔で resample する。
 * 出力は始点 (入力の頂点ではなく resampling の起点) から `(perimeter / stitchLenMm)` 個程度の点列。
 * 周長が `stitchLenMm` に満たない場合は始点のみ。
 */
function resampleClosedRing(ring: Polygon, stitchLenMm: number): Point2D[] {
  if (ring.length < 2 || stitchLenMm <= 0) return ring.length > 0 ? [[ring[0][0], ring[0][1]]] : [];
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  if (perimeter < stitchLenMm) return [[ring[0][0], ring[0][1]]];
  const count = Math.max(2, Math.round(perimeter / stitchLenMm));
  const step = perimeter / count;
  const out: Point2D[] = [];
  let cursor = 0; // 走査済み長さ
  let nextEmit = 0; // 次に出力する距離
  let edgeIdx = 0;
  let edgeStart = ring[0];
  let edgeEnd = ring[1 % ring.length];
  let edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
  while (out.length < count) {
    const target = nextEmit;
    while (cursor + edgeLen < target) {
      cursor += edgeLen;
      edgeIdx = (edgeIdx + 1) % ring.length;
      edgeStart = ring[edgeIdx];
      edgeEnd = ring[(edgeIdx + 1) % ring.length];
      edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
    }
    const t = edgeLen === 0 ? 0 : (target - cursor) / edgeLen;
    out.push([
      edgeStart[0] + (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] + (edgeEnd[1] - edgeStart[1]) * t,
    ]);
    nextEmit += step;
  }
  return out;
}

/**
 * 開いた polyline を `stitchLenMm` 間隔で resample する。
 * 始点と終点を必ず含み、中間点を distance 内挿で配置する。
 */
function resampleOpenLine(line: Polygon, stitchLenMm: number): Point2D[] {
  if (line.length < 2 || stitchLenMm <= 0) return line.length > 0 ? [[line[0][0], line[0][1]]] : [];
  let totalLen = 0;
  for (let i = 1; i < line.length; i++) {
    totalLen += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  if (totalLen < stitchLenMm) {
    return [
      [line[0][0], line[0][1]],
      [line[line.length - 1][0], line[line.length - 1][1]],
    ];
  }
  const count = Math.max(2, Math.round(totalLen / stitchLenMm) + 1);
  const step = totalLen / (count - 1);
  const out: Point2D[] = [];
  let cursor = 0;
  let edgeIdx = 0;
  let edgeStart = line[0];
  let edgeEnd = line[1];
  let edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
  for (let k = 0; k < count; k++) {
    const target = step * k;
    while (cursor + edgeLen < target && edgeIdx < line.length - 2) {
      cursor += edgeLen;
      edgeIdx += 1;
      edgeStart = line[edgeIdx];
      edgeEnd = line[edgeIdx + 1];
      edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
    }
    const t = edgeLen === 0 ? 0 : Math.min(1, (target - cursor) / edgeLen);
    out.push([
      edgeStart[0] + (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] + (edgeEnd[1] - edgeStart[1]) * t,
    ]);
  }
  return out;
}

/**
 * Shape を `pxPerMm` 解像度のバイナリマスクに焼く。
 * outer 内かつ全 hole 外であるピクセルを 1 にする。
 * 戻り値の `offsetX/Y` は左上原点を mm 座標に戻すためのオフセット。
 */
function rasterizeShapeToMask(
  shape: Shape,
  pxPerMm: number,
): {
  mask: Uint8Array;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of shape.outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = Math.max(1, Math.ceil((maxX - minX) * pxPerMm) + 2);
  const height = Math.max(1, Math.ceil((maxY - minY) * pxPerMm) + 2);
  const offsetX = minX - 1 / pxPerMm;
  const offsetY = minY - 1 / pxPerMm;
  const mask = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    const wy = offsetY + (py + 0.5) / pxPerMm;
    for (let px = 0; px < width; px++) {
      const wx = offsetX + (px + 0.5) / pxPerMm;
      if (!pointInPolygon([wx, wy], shape.outer)) continue;
      let inHole = false;
      for (const h of shape.holes) {
        if (pointInPolygon([wx, wy], h)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) mask[py * width + px] = 1;
    }
  }
  return { mask, width, height, offsetX, offsetY };
}

/**
 * Zhang-Suen (1984) thinning。8 近傍ベースの 1px 幅 skeleton 化を破壊的に行う。
 * 入力 mask は変更されない (内部でコピーする)。
 */
function thinMaskZhangSuen(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(mask);
  // P2..P9: N, NE, E, SE, S, SW, W, NW
  const idx = (x: number, y: number) => y * width + x;
  const neighbors = (x: number, y: number): number[] => [
    out[idx(x, y - 1)], // P2 N
    out[idx(x + 1, y - 1)], // P3 NE
    out[idx(x + 1, y)], // P4 E
    out[idx(x + 1, y + 1)], // P5 SE
    out[idx(x, y + 1)], // P6 S
    out[idx(x - 1, y + 1)], // P7 SW
    out[idx(x - 1, y)], // P8 W
    out[idx(x - 1, y - 1)], // P9 NW
  ];
  const countTransitions = (nb: number[]): number => {
    let cnt = 0;
    for (let i = 0; i < 8; i++) {
      if (nb[i] === 0 && nb[(i + 1) % 8] === 1) cnt++;
    }
    return cnt;
  };
  let changed = true;
  while (changed) {
    changed = false;
    // sub-iter 1
    const toRemove1: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (out[idx(x, y)] !== 1) continue;
        const nb = neighbors(x, y);
        const B = nb.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        if (countTransitions(nb) !== 1) continue;
        const [P2, , P4, , P6, , P8] = nb;
        if (P2 * P4 * P6 !== 0) continue;
        if (P4 * P6 * P8 !== 0) continue;
        toRemove1.push(idx(x, y));
      }
    }
    if (toRemove1.length > 0) {
      for (const i of toRemove1) out[i] = 0;
      changed = true;
    }
    // sub-iter 2
    const toRemove2: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (out[idx(x, y)] !== 1) continue;
        const nb = neighbors(x, y);
        const B = nb.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        if (countTransitions(nb) !== 1) continue;
        const [P2, , P4, , P6, , P8] = nb;
        if (P2 * P4 * P8 !== 0) continue;
        if (P2 * P6 * P8 !== 0) continue;
        toRemove2.push(idx(x, y));
      }
    }
    if (toRemove2.length > 0) {
      for (const i of toRemove2) out[i] = 0;
      changed = true;
    }
  }
  return out;
}

/**
 * Skeleton の **直径 (最長単純パス)** を BFS 2 回で抽出する。
 * 戻り値はピクセル座標 `[x, y]` の polyline (連結順)。skeleton が空なら空配列。
 */
function traceLongestSkeletonPath(
  skel: Uint8Array,
  width: number,
  height: number,
): Array<[number, number]> {
  const seeds: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skel[y * width + x] === 1) seeds.push([x, y]);
    }
  }
  if (seeds.length === 0) return [];
  const farFromSeed = bfsFarthest(skel, width, height, seeds[0]);
  if (!farFromSeed) return [];
  const result = bfsFarthestWithPath(skel, width, height, farFromSeed);
  return result?.path ?? [];
}

function bfsFarthest(
  skel: Uint8Array,
  width: number,
  height: number,
  start: [number, number],
): [number, number] | null {
  const dist = new Int32Array(width * height).fill(-1);
  dist[start[1] * width + start[0]] = 0;
  let head = 0;
  const queue: Array<[number, number]> = [start];
  let farthest = start;
  let farthestDist = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const d = dist[y * width + x];
    if (d > farthestDist) {
      farthestDist = d;
      farthest = [x, y];
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (skel[ny * width + nx] !== 1) continue;
        if (dist[ny * width + nx] !== -1) continue;
        dist[ny * width + nx] = d + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return farthest;
}

function bfsFarthestWithPath(
  skel: Uint8Array,
  width: number,
  height: number,
  start: [number, number],
): { path: Array<[number, number]> } | null {
  const dist = new Int32Array(width * height).fill(-1);
  const parent = new Int32Array(width * height).fill(-1);
  dist[start[1] * width + start[0]] = 0;
  let head = 0;
  const queue: Array<[number, number]> = [start];
  let farthest = start;
  let farthestDist = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const d = dist[y * width + x];
    if (d > farthestDist) {
      farthestDist = d;
      farthest = [x, y];
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (skel[ny * width + nx] !== 1) continue;
        if (dist[ny * width + nx] !== -1) continue;
        dist[ny * width + nx] = d + 1;
        parent[ny * width + nx] = y * width + x;
        queue.push([nx, ny]);
      }
    }
  }
  // reconstruct path
  const path: Array<[number, number]> = [];
  let cur: number = farthest[1] * width + farthest[0];
  while (cur !== -1) {
    path.push([cur % width, Math.floor(cur / width)]);
    cur = parent[cur];
  }
  path.reverse();
  return { path };
}

function countOn(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++;
  return n;
}

function offsetShapeInward(shape: Shape, insetMm: number): Polygon[] {
  const rings: Polygon[] = [];
  const outerOff = offsetPolygon(shape.outer, -insetMm);
  if (outerOff) rings.push(...outerOff);
  for (const h of shape.holes) {
    const holeOff = offsetPolygon(h, +insetMm);
    if (holeOff) rings.push(...holeOff);
  }
  return rings;
}

/** テスト専用に内部ヘルパを公開する (本番コードから参照しないこと)。 */
export const __internal = {
  offsetShapeInward,
  rasterizeShapeToMask,
  thinMaskZhangSuen,
  traceLongestSkeletonPath,
  resampleClosedRing,
};
