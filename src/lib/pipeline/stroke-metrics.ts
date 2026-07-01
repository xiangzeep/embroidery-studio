import type { Point2D, Shape, StrokeMetrics } from "./types";
import { __internal as underlayInternal } from "./underlay";
import { skeletonizeMask } from "./skeleton";
import { computeDistanceMap, measureSkeletonWidths } from "./distance-map";

export type { StrokeMetrics } from "./types";

const STROKE_MIN_SLENDERNESS = 3;
const STROKE_MAX_COMPACTNESS = 0.45;
const STROKE_WIDTH_SAMPLE_PX_PER_MM = 10;
const MAX_STROKE_WIDTH_SAMPLE_PIXELS = 180_000;

export function analyzeStrokeMetrics(shape: Shape): StrokeMetrics {
  const outerArea = Math.abs(polygonArea(shape.outer));
  const holeArea = shape.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
  const areaMm2 = Math.max(0, outerArea - holeArea);
  const perimeterMm = polygonPerimeter(shape.outer) +
    shape.holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0);
  const { width, height } = bbox(shape.outer);
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const slenderness = shortSide <= 1e-9 ? Infinity : longSide / shortSide;
  const estimatedWidthMm = perimeterMm <= 1e-9 ? 0 : (2 * areaMm2) / perimeterMm;
  const estimatedLengthMm = estimatedWidthMm <= 1e-9 ? 0 : areaMm2 / estimatedWidthMm;
  const compactness = perimeterMm <= 1e-9 ? 0 :
    (4 * Math.PI * areaMm2) / (perimeterMm * perimeterMm);
  const canSampleSkeleton =
    estimatedRasterPixels(width, height, STROKE_WIDTH_SAMPLE_PX_PER_MM) <=
    MAX_STROKE_WIDTH_SAMPLE_PIXELS;
  const skeletonData = canSampleSkeleton
    ? sampleSkeletonWidths(shape)
    : { widthSamples: [], loopCount: 0, junctionCount: 0, branchCount: 0 };
  const widthSamples = skeletonData.widthSamples;
  const widthMinMm = widthSamples.length > 0
    ? Math.min(...widthSamples.map((sample) => sample.widthMm))
    : undefined;
  const widthMaxMm = widthSamples.length > 0
    ? Math.max(...widthSamples.map((sample) => sample.widthMm))
    : undefined;
  const widthAvgMm = widthSamples.length > 0
    ? widthSamples.reduce((sum, sample) => sum + sample.widthMm, 0) / widthSamples.length
    : undefined;
  const preferredWidthMm = widthAvgMm ?? estimatedWidthMm;
  const loopCount = skeletonData.loopCount;
  const junctionCount = skeletonData.junctionCount;
  const hasStableSkeleton = widthSamples.length >= 3;
  const hasNarrowLoopStroke =
    hasStableSkeleton &&
    loopCount > 0 &&
    preferredWidthMm > 0 &&
    preferredWidthMm <= 1.6;
  const hasNarrowRingOutline =
    shape.holes.length > 0 &&
    preferredWidthMm > 0 &&
    preferredWidthMm <= 2.4 &&
    compactness <= 0.25;
  const hasStableLoopBand =
    hasStableSkeleton &&
    loopCount > 0 &&
    preferredWidthMm > 0 &&
    preferredWidthMm <= 3.5;

  return {
    areaMm2,
    perimeterMm,
    bboxWidthMm: width,
    bboxHeightMm: height,
    estimatedWidthMm,
    estimatedLengthMm,
    slenderness,
    compactness,
    holeCount: shape.holes.length,
    widthMinMm,
    widthAvgMm,
    widthMaxMm,
    hasStableSkeleton,
    branchCount: skeletonData.branchCount,
    junctionCount,
    loopCount,
    isStrokeLike:
      areaMm2 > 0 &&
      (
        hasNarrowLoopStroke ||
        hasNarrowRingOutline ||
        hasStableLoopBand ||
        (
          slenderness >= STROKE_MIN_SLENDERNESS &&
          compactness <= STROKE_MAX_COMPACTNESS
        )
      ),
  };
}

function sampleSkeletonWidths(shape: Shape): {
  widthSamples: Array<{ widthMm: number }>;
  loopCount: number;
  junctionCount: number;
  branchCount: number;
} {
  const raster = underlayInternal.rasterizeShapeToMask(shape, STROKE_WIDTH_SAMPLE_PX_PER_MM);
  const binaryMask = {
    data: raster.mask,
    width: raster.width,
    height: raster.height,
  };
  const skeleton = skeletonizeMask(binaryMask);
  return {
    widthSamples: measureSkeletonWidths(
      skeleton,
      computeDistanceMap(binaryMask),
      1 / STROKE_WIDTH_SAMPLE_PX_PER_MM,
    ),
    loopCount: skeleton.branches.filter((branch) => branch.isLoop).length,
    junctionCount: skeleton.nodes.filter((node) => node.degree > 2).length,
    branchCount: skeleton.branches.length,
  };
}

function estimatedRasterPixels(widthMm: number, heightMm: number, pxPerMm: number): number {
  return Math.max(1, Math.ceil(widthMm * pxPerMm) + 4) *
    Math.max(1, Math.ceil(heightMm * pxPerMm) + 4);
}

function polygonArea(poly: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function polygonPerimeter(poly: Point2D[]): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function bbox(poly: Point2D[]): { width: number; height: number } {
  if (poly.length === 0) return { width: 0, height: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
  };
}
