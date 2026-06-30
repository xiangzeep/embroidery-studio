// fill.ts — tatami brick fill。
// 既存 `fillStitches` (render.ts) の単純往復スキャンラインは行ごとの端点 (a/b) が
// 一直線に並び、布上に縦の針穴ラインが出る欠点があった。本モジュールでは scanline
// ごとに `(line * shiftMm) mod patternLengthMm` の位相シフトを適用し、行内の針落ち
// 位置を行間でずらして needle perforation を分散する。
//
// 重要な保証: `shiftMm = 0` のとき本関数は `fillStitches` と bit-equal な座標出力
// を返す (Phase 4 PR16 Cycle 1)。同一入力で同一出力の純関数。

import { intersectScanline } from "./scanline";
import type { Point2D, Polygon, Shape } from "./types";

type Point = Point2D;

const PHASE_EPS = 1e-9;

/**
 * `(line * shiftMm) mod patternLengthMm` を ε ガード付きで計算する。
 * 結果が PHASE_EPS 以内 or patternLengthMm - PHASE_EPS 以上のとき 0 を返す
 * (floating-point 残差で 0 回帰行が "ほぼ 0" になる現象を吸収)。
 */
function computePhase(
  line: number,
  shiftMm: number,
  patternLengthMm: number,
): number {
  if (patternLengthMm <= 0) return 0;
  const raw = ((line * shiftMm) % patternLengthMm + patternLengthMm) %
    patternLengthMm;
  if (raw < PHASE_EPS) return 0;
  if (patternLengthMm - raw < PHASE_EPS) return 0;
  return raw;
}

/**
 * Tatami brick fill: scanline ごとに行 index に応じた位相シフトを適用し、
 * 行内の針落ち位置を `(line * shiftMm) mod patternLengthMm` だけずらす。
 *
 * `shiftMm = 0` のとき既存 `fillStitches` と座標 6 桁精度で一致 (回帰防止)。
 *
 * 業界標準値: `shiftMm = 1.5`, `patternLengthMm = 4.0`。
 */
export function tatamiBrick(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
  maxStitchMm: number,
  shiftMm = 1.5,
  patternLengthMm = 4.0,
): Point[][] {
  const rad = (angleDeg * Math.PI) / 180;
  const dir: Point = [Math.cos(rad), Math.sin(rad)];
  const perp: Point = [-dir[1], dir[0]];

  let minS = Infinity;
  let maxS = -Infinity;
  for (const [x, y] of shape.outer) {
    const s = x * perp[0] + y * perp[1];
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }

  const rings: Polygon[] = [shape.outer, ...shape.holes];
  const segments: Point[][] = [];
  let line = 0;
  for (let s = minS; s <= maxS; s += densityMm) {
    const ox = perp[0] * s;
    const oy = perp[1] * s;
    const crossings = intersectScanline(rings, ox, oy, dir);
    if (crossings.length < 2) continue; // line は既存 fillStitches と同じく前進させない
    crossings.sort((a, b) => a - b);
    if (crossings.length % 2 !== 0) crossings.pop();
    const phase = computePhase(line, shiftMm, patternLengthMm);

    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < crossings.length; i += 2) {
      pairs.push([crossings[i], crossings[i + 1]]);
    }

    const lineSegs: Point[][] = pairs.map(([a, b]) => {
      const pts: Point[] = [[ox + dir[0] * a, oy + dir[1] * a]];
      // phase === 0 は「内部点を打たない」分岐により Cycle 1 の bit-equivalence
      // (fillStitches と完全一致) を保つ暫定挙動。Refactor で全行 maxStitch 分割
      // を行う場合はここの分岐ごと外す必要がある。
      if (phase > 0) {
        let t = a + phase;
        while (t < b - PHASE_EPS) {
          pts.push([ox + dir[0] * t, oy + dir[1] * t]);
          t += maxStitchMm;
        }
      }
      pts.push([ox + dir[0] * b, oy + dir[1] * b]);
      return pts;
    });

    if (line % 2 === 0) {
      for (const seg of lineSegs) segments.push(seg);
    } else {
      // 奇数行は scanline を逆順 + 各 segment 自体も逆順 (boustrophedon)
      for (let i = lineSegs.length - 1; i >= 0; i--) {
        segments.push([...lineSegs[i]].reverse());
      }
    }
    line++;
  }
  return segments;
}
