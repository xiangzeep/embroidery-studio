// hit-test.ts — Phase 5 PR20 プレビュー上のクリックヒットテスト。
//
// React 非依存の純関数として hitTestObject(design, point) を提供する。
// クリック座標 (mm 単位) を受け取り、最も上 (= objects 配列で order が大きい)
// の object のうち outer に含まれる id を返す。holes は無視 (穴の中をクリック
// しても穴の外側 object を選択する Wilcom 流儀)。
//
// 座標は **mm 単位** で渡される想定。canvas pixel → mm 変換は呼び出し側で行う。

import { pointInPolygon } from "@/lib/pipeline/vectorize";
import type { EmbroideryDesign, Point2D } from "@/lib/pipeline/types";

/**
 * design.objects のうち outer に point が含まれる中で、最も order が大きい
 * (= 最後に縫う = 視覚的に上に来る) object の id を返す。
 * 該当無し / design null は null。
 */
export function hitTestObject(
  design: EmbroideryDesign | null,
  point: Point2D,
): string | null {
  if (design === null) return null;
  let best: { id: string; order: number } | null = null;
  for (const obj of design.objects) {
    if (!pointInPolygon(point, obj.shape.outer)) continue;
    if (best === null || obj.order > best.order) {
      best = { id: obj.id, order: obj.order };
    }
  }
  return best?.id ?? null;
}
