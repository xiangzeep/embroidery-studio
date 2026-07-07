import type { ConversionConfig } from "./config";
import type { PrepipelineResult } from "./compose";
import type { ColorRegion } from "./vectorize";

const MAX_LINE_ART_STITCH_SHAPES = 420;
const MAX_LINE_ART_STITCH_POINTS = 80_000;
const MAX_LINE_ART_SINGLE_SHAPE_POINTS = 8_000;
const LINE_ART_COVERAGE_GRID_COLUMNS = 6;
const LINE_ART_COVERAGE_GRID_ROWS = 6;
const LINE_ART_TILE_SHAPE_QUOTA = 5;
const LINE_ART_GLOBAL_ANCHOR_COUNT = 72;

export function fitPrepipelineWithinStitchBudget(
  pre: PrepipelineResult,
  config: ConversionConfig,
): PrepipelineResult {
  if (config.digitizingMode !== "line-art") return pre;
  return {
    ...pre,
    regions: limitLineArtShapes(pre.regions, pre.widthPx, pre.heightPx),
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

function limitLineArtShapes(
  regions: ColorRegion[],
  widthPx: number,
  heightPx: number,
): ColorRegion[] {
  const entries = regions.flatMap((region, regionIndex) =>
    region.shapes.map((shape, shapeIndex) => {
      const area = polygonArea(shape.outer);
      const perimeter = polygonPerimeter(shape.outer);
      const bounds = polygonBounds(shape.outer);
      const centroidX = (bounds.minX + bounds.maxX) / 2;
      const centroidY = (bounds.minY + bounds.maxY) / 2;
      const tileX = clamp(
        Math.floor((centroidX / Math.max(1, widthPx)) * LINE_ART_COVERAGE_GRID_COLUMNS),
        0,
        LINE_ART_COVERAGE_GRID_COLUMNS - 1,
      );
      const tileY = clamp(
        Math.floor((centroidY / Math.max(1, heightPx)) * LINE_ART_COVERAGE_GRID_ROWS),
        0,
        LINE_ART_COVERAGE_GRID_ROWS - 1,
      );
      return {
        regionIndex,
        shapeIndex,
        area,
        perimeter,
        tileKey: `${tileX}:${tileY}`,
        score: perimeter + Math.sqrt(area) * 3,
      };
    }),
  );
  if (entries.length <= MAX_LINE_ART_STITCH_SHAPES) return regions;

  const keep = new Set<string>();
  const addEntry = (entry: (typeof entries)[number]) => {
    if (keep.size >= MAX_LINE_ART_STITCH_SHAPES) return;
    keep.add(`${entry.regionIndex}:${entry.shapeIndex}`);
  };
  const compareByArea = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
    b.area - a.area || b.perimeter - a.perimeter || a.regionIndex - b.regionIndex || a.shapeIndex - b.shapeIndex;
  const compareByScore = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
    b.score - a.score || b.area - a.area || a.regionIndex - b.regionIndex || a.shapeIndex - b.shapeIndex;

  entries
    .toSorted(compareByArea)
    .slice(0, Math.min(LINE_ART_GLOBAL_ANCHOR_COUNT, MAX_LINE_ART_STITCH_SHAPES))
    .forEach(addEntry);

  const byTile = new Map<string, typeof entries>();
  for (const entry of entries) {
    const bucket = byTile.get(entry.tileKey);
    if (bucket) bucket.push(entry);
    else byTile.set(entry.tileKey, [entry]);
  }
  for (const bucket of byTile.values()) {
    bucket
      .toSorted(compareByScore)
      .slice(0, LINE_ART_TILE_SHAPE_QUOTA)
      .forEach(addEntry);
  }

  entries.toSorted(compareByScore).forEach(addEntry);

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

function polygonPerimeter(points: Array<[number, number]>): number {
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  return perimeter;
}

function polygonBounds(points: Array<[number, number]>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
