import type { Shape } from "./types";

export type BackgroundShapeKind =
  | "not-white"
  | "background"
  | "interior-white"
  | "edge-white-noise";

export type BackgroundClassification = {
  kind: BackgroundShapeKind;
  keep: boolean;
  nearWhite: boolean;
  touchesEdge: boolean;
  areaPx: number;
};

export type BackgroundClassificationInput = {
  shape: Shape;
  rgb: [number, number, number];
  widthPx: number;
  heightPx?: number;
  nearWhiteThreshold?: number;
  edgeEpsilonPx?: number;
  minKeepAreaPx?: number;
};

const DEFAULT_NEAR_WHITE_THRESHOLD = 245;
const DEFAULT_EDGE_EPSILON_PX = 1;
const DEFAULT_MIN_KEEP_AREA_PX = 8;

export function classifyBackgroundShape(input: BackgroundClassificationInput): BackgroundClassification {
  const nearWhiteThreshold = input.nearWhiteThreshold ?? DEFAULT_NEAR_WHITE_THRESHOLD;
  const edgeEpsilonPx = input.edgeEpsilonPx ?? DEFAULT_EDGE_EPSILON_PX;
  const minKeepAreaPx = input.minKeepAreaPx ?? DEFAULT_MIN_KEEP_AREA_PX;
  const nearWhite = input.rgb.every((channel) => channel >= nearWhiteThreshold);
  const areaPx = shapeArea(input.shape);
  const touchesEdge = touchesCanvasEdge(input.shape, input.widthPx, input.heightPx, edgeEpsilonPx);

  if (!nearWhite) {
    return { kind: "not-white", keep: true, nearWhite, touchesEdge, areaPx };
  }
  if (!touchesEdge) {
    return { kind: "interior-white", keep: true, nearWhite, touchesEdge, areaPx };
  }
  const bbox = shapeBBox(input.shape);
  const shortSide = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (areaPx < minKeepAreaPx || shortSide <= 3) {
    return { kind: "edge-white-noise", keep: false, nearWhite, touchesEdge, areaPx };
  }
  return { kind: "background", keep: false, nearWhite, touchesEdge, areaPx };
}

export function shouldKeepNearWhiteShape(classification: BackgroundClassification): boolean {
  return classification.keep;
}

export function touchesCanvasEdge(
  shape: Shape,
  widthPx: number,
  heightPx: number | undefined,
  epsilonPx = DEFAULT_EDGE_EPSILON_PX,
): boolean {
  const maxX = widthPx;
  const maxY = heightPx;
  return shape.outer.some(([x, y]) => {
    if (x <= epsilonPx || x >= maxX - epsilonPx) return true;
    if (typeof maxY === "number" && (y <= epsilonPx || y >= maxY - epsilonPx)) return true;
    return false;
  });
}

export function shapeArea(shape: Shape): number {
  const holeArea = shape.holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
  return Math.max(0, polygonArea(shape.outer) - holeArea);
}

function shapeBBox(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of shape.outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function polygonArea(poly: Shape["outer"]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}
