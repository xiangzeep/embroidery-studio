import type { Shape } from "./types";
import type { ColorRegion } from "./vectorize";

export type LayerKind =
  | "background"
  | "base-fill"
  | "detail"
  | "outline"
  | "highlight"
  | "noise";

export type LayerClassificationInput = {
  shape: Shape;
  rgb: [number, number, number];
  widthPx: number;
  heightPx: number;
  nearWhiteThreshold?: number;
  minNoiseAreaPx?: number;
};

export type LayeredShape = {
  layer: LayerKind;
  colorIndex: number;
  rgb: [number, number, number];
  shape: Shape;
  shapeIndex: number;
  areaPx2: number;
  bboxWidthPx: number;
  bboxHeightPx: number;
  aspectRatio: number;
};

export type AssignLayersInput = {
  regions: ColorRegion[];
  widthPx: number;
  heightPx: number;
};

export function assignLayers(input: AssignLayersInput): LayeredShape[] {
  const out: LayeredShape[] = [];
  for (const region of input.regions) {
    region.shapes.forEach((shape, shapeIndex) => {
      const metrics = measureLayerShape(shape);
      out.push({
        layer: classifyLayer({
          shape,
          rgb: region.rgb,
          widthPx: input.widthPx,
          heightPx: input.heightPx,
        }),
        colorIndex: region.colorIndex,
        rgb: region.rgb,
        shape,
        shapeIndex,
        ...metrics,
      });
    });
  }
  return out;
}

export function classifyLayer(input: LayerClassificationInput): LayerKind {
  const nearWhiteThreshold = input.nearWhiteThreshold ?? 245;
  const minNoiseAreaPx = input.minNoiseAreaPx ?? 8;
  const metrics = measureLayerShape(input.shape);
  const canvasArea = Math.max(1, input.widthPx * input.heightPx);
  const areaRatio = metrics.areaPx2 / canvasArea;
  const nearWhite = input.rgb.every((channel) => channel >= nearWhiteThreshold);

  if (nearWhite) {
    if (touchesCanvasEdge(input.shape, input.widthPx, input.heightPx) && areaRatio >= 0.01) {
      return "background";
    }
    return "highlight";
  }

  const shortSide = Math.min(metrics.bboxWidthPx, metrics.bboxHeightPx);
  if (metrics.aspectRatio >= 5 && shortSide <= 14) return "outline";

  if (metrics.areaPx2 <= minNoiseAreaPx) return "noise";

  if (areaRatio >= 0.02 || metrics.areaPx2 >= 900) return "base-fill";

  return "detail";
}

export function measureLayerShape(shape: Shape): {
  areaPx2: number;
  bboxWidthPx: number;
  bboxHeightPx: number;
  aspectRatio: number;
} {
  const bbox = shapeBBox(shape);
  const bboxWidthPx = Math.max(0, bbox.maxX - bbox.minX);
  const bboxHeightPx = Math.max(0, bbox.maxY - bbox.minY);
  const shortSide = Math.max(1e-9, Math.min(bboxWidthPx, bboxHeightPx));
  const longSide = Math.max(bboxWidthPx, bboxHeightPx);
  const holesArea = shape.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
  const areaPx2 = Math.max(0, Math.abs(polygonArea(shape.outer)) - holesArea);
  return {
    areaPx2,
    bboxWidthPx,
    bboxHeightPx,
    aspectRatio: longSide / shortSide,
  };
}

function touchesCanvasEdge(shape: Shape, widthPx: number, heightPx: number): boolean {
  const bbox = shapeBBox(shape);
  const eps = 1;
  return (
    bbox.minX <= eps ||
    bbox.minY <= eps ||
    bbox.maxX >= widthPx - eps ||
    bbox.maxY >= heightPx - eps
  );
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

function polygonArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}
