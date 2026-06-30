// Pull and push compensation helpers.
// English note.
// English note.
// Local implementation status:
// English note.
// English note.
// English note.

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
 * English note.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
 *   1. `props.pullCompMm`
 * English note.
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
 * English note.
 *
 * English note.
 * English note.
 *
 * English note.
 * - `amount = obj.props.pushCompMm ?? 0`
 * - `amount <= 0`: return the same reference
 * English note.
 * English note.
 * English note.
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

/** English note. */
export const __internal = {
  resolvePullAmount,
  offsetSatinByNormal,
};
