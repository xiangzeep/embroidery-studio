import type { ConversionConfig } from "./config";
import type { PrepipelineResult } from "./compose";
import type { ColorRegion } from "./vectorize";

const MAX_LINE_ART_STITCH_SHAPES = 120;
const MAX_LINE_ART_STITCH_POINTS = 80_000;
const MAX_LINE_ART_SINGLE_SHAPE_POINTS = 8_000;

export function fitPrepipelineWithinStitchBudget(
  pre: PrepipelineResult,
  config: ConversionConfig,
): PrepipelineResult {
  if (config.digitizingMode !== "line-art") return pre;
  return {
    ...pre,
    regions: limitLineArtShapes(pre.regions),
  };
}

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

function limitLineArtShapes(regions: ColorRegion[]): ColorRegion[] {
  const entries = regions.flatMap((region, regionIndex) =>
    region.shapes.map((shape, shapeIndex) => ({
      regionIndex,
      shapeIndex,
      area: polygonArea(shape.outer),
    })),
  );
  if (entries.length <= MAX_LINE_ART_STITCH_SHAPES) return regions;

  const keep = new Set(
    entries
      .sort((a, b) => b.area - a.area || a.regionIndex - b.regionIndex || a.shapeIndex - b.shapeIndex)
      .slice(0, MAX_LINE_ART_STITCH_SHAPES)
      .map((entry) => `${entry.regionIndex}:${entry.shapeIndex}`),
  );

  return regions
    .map((region, regionIndex) => ({
      ...region,
      shapes: region.shapes.filter((_, shapeIndex) => keep.has(`${regionIndex}:${shapeIndex}`)),
      polygons: [],
      svgPath: "",
    }))
    .filter((region) => region.shapes.length > 0);
}

function polygonArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
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
