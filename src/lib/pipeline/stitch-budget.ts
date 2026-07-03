import type { ConversionConfig } from "./config";
import type { PrepipelineResult } from "./compose";

const MAX_LINE_ART_STITCH_SHAPES = 500;
const MAX_LINE_ART_STITCH_POINTS = 80_000;
const MAX_LINE_ART_SINGLE_SHAPE_POINTS = 8_000;

export function assertPrepipelineWithinStitchBudget(
  pre: PrepipelineResult,
  config: ConversionConfig,
): void {
  if (config.digitizingMode !== "line-art") return;
  const complexity = summarizePrepipelineComplexity(pre);
  if (
    complexity.shapeCount <= MAX_LINE_ART_STITCH_SHAPES &&
    complexity.pointCount <= MAX_LINE_ART_STITCH_POINTS &&
    complexity.maxShapePointCount <= MAX_LINE_ART_SINGLE_SHAPE_POINTS
  ) {
    return;
  }
  throw new Error(
    `Line-art stitch job is too complex (${complexity.shapeCount.toLocaleString()} shapes, ` +
    `${complexity.pointCount.toLocaleString()} points). ` +
    "Reduce image detail, color count, or output size and try again.",
  );
}

export function summarizePrepipelineComplexity(pre: PrepipelineResult): {
  shapeCount: number;
  pointCount: number;
  maxShapePointCount: number;
} {
  let shapeCount = 0;
  let pointCount = 0;
  let maxShapePointCount = 0;
  for (const region of pre.regions) {
    shapeCount += region.shapes.length;
    for (const shape of region.shapes) {
      let shapePointCount = shape.outer.length;
      for (const hole of shape.holes) shapePointCount += hole.length;
      pointCount += shapePointCount;
      maxShapePointCount = Math.max(maxShapePointCount, shapePointCount);
    }
  }
  return { shapeCount, pointCount, maxShapePointCount };
}
