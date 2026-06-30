// Phase 2 計画書 §4 Pull Compensation / §5 Push Compensation。
// 純関数 API: 入力 EmbroideryObject を破壊せず、shape のみ差し替えた新オブジェクトを返す。
// 設計順序 (§4.5): underlay は元 shape、top stitches は補正後 shape に対して計算する。
// PR9 完了状態:
//   - applyPullCompensation: Satin (自前 normal offset) と Fill (clipper-lib) に対応
//   - applyPushCompensation: 異色 neighbor との重なり検出時のみ内側オフセット
// per-side rail 単位の pull comp は Phase 4 (2-rail satin 実装と統合) で対応する。

import type {
  EmbroideryObject,
  FabricProfile,
  Point2D,
  Polygon,
  Shape,
} from "./types";
import { pullCompForWidth } from "./fabric";
import { analyzeShape } from "./geometry";
import { offsetShape, polygonsOverlap } from "./polygon-offset";

/**
 * Pull compensation を適用する。
 *
 * - `kind="run"`: 補正不要、入力をそのまま参照同一で返す
 * - `kind="satin"`: PCA 短軸方向に外側オフセット (自前 normal offset, clipper 不要)
 * - `kind="fill"`: outer を +amount / holes を -amount で clipper オフセット
 *
 * 補正量の解決優先順位:
 *   1. `props.pullCompMm`
 *   2. `props.pullCompPerSideMm` の `(left + right) / 2`
 *   3. `pullCompForWidth(fabric, shortSideMm)`
 */
export function applyPullCompensation(
  obj: EmbroideryObject,
  fabric: FabricProfile,
): EmbroideryObject {
  if (obj.kind === "run") return obj;
  const amount = resolvePullAmount(obj, fabric);
  if (obj.kind === "fill") {
    if (amount === 0) return { ...obj, shape: cloneShape(obj.shape) };
    return { ...obj, shape: offsetShape(obj.shape, +amount, -amount) };
  }
  return { ...obj, shape: offsetSatinByNormal(obj.shape, amount) };
}

/**
 * Push compensation を適用する (Phase 2 §5)。
 *
 * 異色 neighbor との重なりが検出された場合のみ shape を内側オフセットする。
 * 同色 neighbor の重なりは Phase 3 で branching と統合するため対象外。
 *
 * - `kind === "run"`: 重なり判定対象外、参照同一返却
 * - `amount = obj.props.pushCompMm ?? 0`
 * - `amount <= 0`: 参照同一返却
 * - 異色 neighbor との重なりが無い: 参照同一返却
 * - 異色 neighbor が複数あっても shape の縮みは 1 回ぶんのみ
 * - outer 消失時は `offsetShape` のフォールバックで元 shape を保つ
 */
export function applyPushCompensation(
  obj: EmbroideryObject,
  neighbors: readonly EmbroideryObject[],
): EmbroideryObject {
  if (obj.kind === "run") return obj;
  const amount = obj.props.pushCompMm ?? 0;
  if (amount <= 0) return obj;
  const diffColor = neighbors.filter((n) => n.colorIndex !== obj.colorIndex);
  if (diffColor.length === 0) return obj;
  const hit = diffColor.some((n) => polygonsOverlap(obj.shape, n.shape));
  if (!hit) return obj;
  return { ...obj, shape: offsetShape(obj.shape, -amount, +amount) };
}

function resolvePullAmount(
  obj: EmbroideryObject,
  fabric: FabricProfile,
): number {
  if (obj.props.pullCompMm !== undefined) return obj.props.pullCompMm;
  if (obj.props.pullCompPerSideMm) {
    const { left, right } = obj.props.pullCompPerSideMm;
    return (left + right) / 2;
  }
  const { shortSide } = analyzeShape(obj.shape.outer);
  return pullCompForWidth(fabric, shortSide);
}

function cloneShape(shape: Shape): Shape {
  return {
    outer: shape.outer.map(([x, y]) => [x, y] as Point2D),
    holes: shape.holes.map((h) => h.map(([x, y]) => [x, y] as Point2D)),
  };
}

function offsetSatinByNormal(shape: Shape, amountMm: number): Shape {
  if (amountMm === 0) return cloneShape(shape);
  const { longAxis, center } = analyzeShape(shape.outer);
  const shortAxis: Point2D = [-longAxis[1], longAxis[0]];
  const outer: Polygon = shape.outer.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    const s = dx * shortAxis[0] + dy * shortAxis[1];
    const sign = s >= 0 ? 1 : -1;
    return [
      x + shortAxis[0] * amountMm * sign,
      y + shortAxis[1] * amountMm * sign,
    ] as Point2D;
  });
  return { outer, holes: shape.holes.map((h) => h.map(([x, y]) => [x, y] as Point2D)) };
}

/** テスト専用に内部ヘルパを公開する (本番コードから参照しないこと)。 */
export const __internal = {
  resolvePullAmount,
  offsetSatinByNormal,
};
