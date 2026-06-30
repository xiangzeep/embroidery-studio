// scanline.ts — multi-ring polyline / scanline 交点計算ユーティリティ。
// render.ts と underlay.ts の両方から参照されるため、両者から独立した下層モジュールに置く
// (PR12 で render → underlay の依存が入っても循環を避けるための配置)。

import type { Point2D, Polygon } from "./types";

/**
 * 複数リング (outer + holes 等) と、点 `(ox, oy)` を通り方向 `dir` の直線との交点を、
 * その直線上の符号付き距離として返す。
 *
 * even-odd 塗りでは、外形と穴の交点を全部集めてソート→ペア化で穴抜き塗りになる。
 *
 * 戻り値: 各交点までの距離 (`dir` 上で符号付き)。`dir` は単位ベクトルである必要がある。
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
