import type { Point2D, Polygon, Shape } from "./types";

/**
 * px 座標の Shape を mm 座標に変換する。
 * 3 点未満の holes はスキップ (closed polygon にならないため)。
 */
export function scaleShape(shapePx: Shape, mmPerPx: number): Shape {
  return {
    outer: shapePx.outer.map(([x, y]) => [x * mmPerPx, y * mmPerPx]),
    holes: shapePx.holes
      .filter((h) => h.length >= 3)
      .map((h) => h.map(([x, y]) => [x * mmPerPx, y * mmPerPx])),
  };
}

/**
 * PCA で polygon の長軸方向と短辺長を求める。
 * - longAxis: 単位ベクトル
 * - shortSide: 長軸と直交する短軸方向に投影した範囲
 * - center: 重心
 */
export function analyzeShape(polygon: Polygon): {
  shortSide: number;
  longAxis: Point2D;
  center: Point2D;
} {
  const n = polygon.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of polygon) {
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;

  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const sqd = Math.sqrt(disc);
  const lambda1 = tr / 2 + sqd;
  const lambda2 = tr / 2 - sqd;

  let vx: number;
  let vy: number;
  if (Math.abs(sxy) > 1e-9) {
    vx = lambda1 - syy;
    vy = sxy;
  } else if (sxx >= syy) {
    vx = 1;
    vy = 0;
  } else {
    vx = 0;
    vy = 1;
  }
  const mag = Math.hypot(vx, vy) || 1;
  const longAxis: Point2D = [vx / mag, vy / mag];

  let minS = Infinity;
  let maxS = -Infinity;
  const shortAxis: Point2D = [-longAxis[1], longAxis[0]];
  for (const [x, y] of polygon) {
    const s = (x - cx) * shortAxis[0] + (y - cy) * shortAxis[1];
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }
  const shortSide = maxS - minS;
  void lambda2;
  return { shortSide, longAxis, center: [cx, cy] };
}

/** 長軸方向と短軸方向への投影範囲から aspect ratio (longSide / shortSide) を求める。 */
export function computeAspectRatio(
  polygon: Polygon,
  longAxis: Point2D,
  center: Point2D,
): number {
  let minL = Infinity;
  let maxL = -Infinity;
  let minS = Infinity;
  let maxS = -Infinity;
  const shortAxis: Point2D = [-longAxis[1], longAxis[0]];
  for (const [x, y] of polygon) {
    const dx = x - center[0];
    const dy = y - center[1];
    const l = dx * longAxis[0] + dy * longAxis[1];
    const s = dx * shortAxis[0] + dy * shortAxis[1];
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }
  const longSide = maxL - minL;
  const shortSide = maxS - minS;
  if (shortSide < 1e-9) return Infinity;
  return longSide / shortSide;
}
