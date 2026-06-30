// English note.
//
// English note.
// English note.

import type { Point2D, Polygon } from "@/lib/pipeline/types";

/**
 * English note.
 * English note.
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
 * English note.
 * English note.
 * English note.
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
 * English note.
 * English note.
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
 * English note.
 * English note.
 * English note.
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
 * English note.
 * English note.
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
