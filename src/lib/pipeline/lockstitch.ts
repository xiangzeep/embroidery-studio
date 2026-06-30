// Phase 2 計画書 §6 Lockstitch (tie-in / tie-off)。
// 各 object の最初/最後に 3 stitch (kind="run") のバックタックを挿入し、糸抜けを防ぐ。
// Phase 3 で travel-run による object 連結を行う際、color 内で連結している境界では
// tie-in/off を抑制する設計に差し替える (assembleWithLockstitch 側の判断)。

import type { Stitch } from "./types";

export type Point = [number, number];

const DEFAULT_BACK_DIST_MM = 0.8;

/**
 * tie-in: anchor の手前 (`firstDir` の逆方向に `backDistMm`) → anchor → 手前 の
 * 3 stitch (すべて `kind="run"`) を返す。
 */
export function emitTieIn(
  anchor: Point,
  firstDir: Point,
  colorIndex: number,
  backDistMm: number = DEFAULT_BACK_DIST_MM,
): Stitch[] {
  const back: Point = [
    anchor[0] - firstDir[0] * backDistMm,
    anchor[1] - firstDir[1] * backDistMm,
  ];
  return [
    { x: back[0], y: back[1], kind: "run", colorIndex },
    { x: anchor[0], y: anchor[1], kind: "run", colorIndex },
    { x: back[0], y: back[1], kind: "run", colorIndex },
  ];
}

/**
 * tie-off: 進行方向 (`lastDir`) の逆方向に `backDistMm` 後退する 3 stitch。
 * 構造は `emitTieIn` と同じ (anchor → back → anchor → back のうち 3 点)。
 */
export function emitTieOff(
  anchor: Point,
  lastDir: Point,
  colorIndex: number,
  backDistMm: number = DEFAULT_BACK_DIST_MM,
): Stitch[] {
  return emitTieIn(anchor, lastDir, colorIndex, backDistMm);
}
