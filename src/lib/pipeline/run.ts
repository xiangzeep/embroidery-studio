// run.ts — Run kind (細線) の medial-axis 抽出 (Phase 4 PR19)。
//
// 既存 renderRunTopOnly は shape.outer をそのまま resample していたため、1px 線でも
// 外形を 1 周なぞる「ループ run」になり中心線にならない欠点があった。本モジュール
// では Zhang-Suen thinning (underlay.ts に Phase 2 PR10 で実装済み) を再利用して
// shape を rasterize → 1px skeleton → 最長 path で medial-axis polyline を返す。
//
// `centerRunUnderlay` (underlay.ts) と内部実装は同一だが、用途が異なる:
//   - centerRunUnderlay: 細 satin の **下縫い** (top の下に隠れる骨格)
//   - medialAxisRun:     run kind の **表縫い** (medial-axis そのものを縫う)
//
// 純関数: 同一入力で同一出力。Shape は破壊しない。OpenCV / Worker 依存なし。

import { centerRunUnderlay } from "./underlay";
import type { Point2D, Shape } from "./types";

/**
 * shape から medial-axis polyline を抽出する。
 * 退化 shape (面積過小 / skeleton 過小) では空配列を返す (呼び出し側で
 * 外形 resample にフォールバックする想定)。
 *
 * @param shape       mm 単位の Shape
 * @param stitchLenMm 出力 polyline の resample 間隔 (mm)
 */
export function medialAxisRun(shape: Shape, stitchLenMm: number): Point2D[] {
  return centerRunUnderlay(shape, stitchLenMm);
}
