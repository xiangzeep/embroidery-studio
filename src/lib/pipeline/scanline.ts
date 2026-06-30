// English note.
// English note.
// English note.

import type { Point2D, Polygon } from "./types";

/**
 * English note.
 * English note.
 *
 * English note.
 *
 * English note.
 */
export function intersectScanline(
  rings: Polygon[],
  ox: number,
  oy: number,
  dir: Point2D,
): number[] {
  const out: number[] = [];
  const nx = -dir[1];
  const ny = dir[0];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      const s1 = (x1 - ox) * nx + (y1 - oy) * ny;
      const s2 = (x2 - ox) * nx + (y2 - oy) * ny;
      if ((s1 > 0 && s2 > 0) || (s1 < 0 && s2 < 0)) continue;
      if (s1 === s2) continue;
      const t = s1 / (s1 - s2);
      const ix = x1 + (x2 - x1) * t;
      const iy = y1 + (y2 - y1) * t;
      const d = (ix - ox) * dir[0] + (iy - oy) * dir[1];
      out.push(d);
    }
  }
  return out;
}
