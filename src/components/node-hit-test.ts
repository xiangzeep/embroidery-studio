// node-hit-test.ts — Phase 5 PR23 ノード編集 (パス編集) 純ロジック。
//
// 編集座標は **mm 単位**。polygon は EmbroideryObject.shape.outer。
// 結果は immutable (入力 polygon は破壊しない、新配列を返す)。

import type { Point2D, Polygon } from "@/lib/pipeline/types";

/**
 * クリック座標 (mm) に最も近い頂点 index を返す。指定半径外なら null。
 * 複数頂点が近接する場合は最初に見つかった最小距離を採用。
 */
export function pickVertex(
  outer: Polygon,
  pt: Point2D,
  hitRadiusMm: number,
): number | null {
  if (outer.length === 0) return null;
  let best: { idx: number; d2: number } | null = null;
  const r2 = hitRadiusMm * hitRadiusMm;
  for (let i = 0; i < outer.length; i++) {
    const dx = outer[i][0] - pt[0];
    const dy = outer[i][1] - pt[1];
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (best === null || d2 < best.d2) best = { idx: i, d2 };
  }
  return best?.idx ?? null;
}

/**
 * クリック座標 (mm) に最も近い「辺の中点」index を返す。
 * index は **辺の始点 index** = outer[i] と outer[(i+1)%n] を結ぶ辺。
 * 指定半径外なら null。
 */
export function pickEdgeMidpoint(
  outer: Polygon,
  pt: Point2D,
  hitRadiusMm: number,
): number | null {
  if (outer.length < 2) return null;
  let best: { idx: number; d2: number } | null = null;
  const r2 = hitRadiusMm * hitRadiusMm;
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = mx - pt[0];
    const dy = my - pt[1];
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (best === null || d2 < best.d2) best = { idx: i, d2 };
  }
  return best?.idx ?? null;
}

/**
 * edgeIndex の辺の中点に新頂点を挿入した polygon (immutable)。
 * edgeIndex は [0, outer.length - 1] の範囲。範囲外なら入力を返す (no-op)。
 */
export function insertVertexAt(outer: Polygon, edgeIndex: number): Polygon {
  if (outer.length < 2) return outer.slice();
  const n = outer.length;
  if (edgeIndex < 0 || edgeIndex >= n) return outer.slice();
  const a = outer[edgeIndex];
  const b = outer[(edgeIndex + 1) % n];
  const mid: Point2D = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const next = outer.slice();
  next.splice(edgeIndex + 1, 0, mid);
  return next;
}

/**
 * vertexIndex を削除した polygon (immutable)。
 * 結果が頂点数 3 未満になる場合は null (削除拒否)。
 * 範囲外 vertexIndex は null。
 */
export function removeVertexAt(
  outer: Polygon,
  vertexIndex: number,
): Polygon | null {
  if (outer.length <= 3) return null;
  if (vertexIndex < 0 || vertexIndex >= outer.length) return null;
  const next = outer.slice();
  next.splice(vertexIndex, 1);
  return next;
}

/**
 * vertexIndex の頂点を新座標 pt に移動した polygon (immutable)。
 * 範囲外 index は入力を返す (no-op)。
 */
export function moveVertexTo(
  outer: Polygon,
  vertexIndex: number,
  pt: Point2D,
): Polygon {
  if (vertexIndex < 0 || vertexIndex >= outer.length) return outer.slice();
  const next = outer.slice();
  next[vertexIndex] = [pt[0], pt[1]];
  return next;
}
