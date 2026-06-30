import { buildObjects } from "./build-objects";
import type { ConversionConfig } from "./config";
import { getFabricProfile } from "./fabric";
import { optimizeOrder } from "./pathing";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { renderDesign } from "./render";
import { analyzePattern } from "./stats";
import { optimizePatternCommands } from "./command-optimizer";
import { writeDstBytes } from "./dst-writer";
import { analyzeDstBytes } from "./dst-analyzer";
import type { ColorRegion } from "./vectorize";

export type BenchmarkInput = {
  name: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  regions: ColorRegion[];
};

export type Phase2BenchmarkRow = {
  fixture: string;
  objectCount: number;
  layerCount: number;
  strokeLikeObjectCount: number;
  fillUsedOnStrokeCount: number;
  beanRunObjectCount: number;
  satinStrokeObjectCount: number;
  stitchCount: number;
  runStitchRatio: number;
  satinStitchRatio: number;
  fillStitchRatio: number;
  jumpCount: number;
  jumpRatio: number;
  stopCount: number;
  trimCount: number;
  travelLengthMm: number;
  maxJumpMm: number;
  generationTimeMs: number;
  dstSizeBytes: number;
};

export function runBenchmarkFixture(
  fixture: BenchmarkInput,
  config: ConversionConfig,
): Phase2BenchmarkRow {
  const started = nowMs();
  const fabric = getFabricProfile(config.fabric);
  const objects = buildObjects({
    regions: fixture.regions,
    widthMm: fixture.widthMm,
    widthPx: fixture.widthPx,
    heightPx: fixture.heightPx,
    fabric,
    digitizingMode: config.digitizingMode,
    outlineFontStrategy: config.outlineFontStrategy,
    satinMaxWidthMm: config.satinMaxWidthMm,
    minRegionAreaPx: config.minRegionAreaPx,
    removeWhiteBackground: config.removeWhiteBackground,
  });
  const design = optimizeOrder({
    widthMm: fixture.widthMm,
    heightMm: fixture.heightMm,
    fabric,
    objects,
  });
  const pattern = optimizePatternCommands(renderDesign(design, {
    widthMm: fixture.widthMm,
    heightMm: fixture.heightMm,
    widthPx: fixture.widthPx,
    stitchDensityMm: config.stitchDensity,
    satinMaxWidthMm: config.satinMaxWidthMm,
    fillAngleDeg: config.fillAngleDeg,
    fillStrategy: config.fillStrategy,
    fabric,
    policy: TRIM_POLICY_BY_FORMAT[config.format],
  }));
  const stats = analyzePattern(pattern);
  const dstBytes = writeDstBytes(pattern);
  const dst = analyzeDstBytes(dstBytes);
  const strokeStats = summarizeBenchmarkStrokes(objects, pattern);

  return {
    fixture: fixture.name,
    objectCount: objects.length,
    layerCount: new Set(objects.map((object) => object.layer ?? "detail")).size,
    strokeLikeObjectCount: strokeStats.strokeLikeObjectCount,
    fillUsedOnStrokeCount: strokeStats.fillUsedOnStrokeCount,
    beanRunObjectCount: strokeStats.beanRunObjectCount,
    satinStrokeObjectCount: strokeStats.satinStrokeObjectCount,
    stitchCount: stats.stitchCount,
    runStitchRatio: strokeStats.runStitchRatio,
    satinStitchRatio: strokeStats.satinStitchRatio,
    fillStitchRatio: strokeStats.fillStitchRatio,
    jumpCount: stats.jumpCount,
    jumpRatio: dst.jumpRatio,
    stopCount: stats.stopCount,
    trimCount: stats.trimCount,
    travelLengthMm: Number(stats.travelLengthMm.toFixed(1)),
    maxJumpMm: Number(dst.longestJumpMm.toFixed(1)),
    generationTimeMs: Number((nowMs() - started).toFixed(2)),
    dstSizeBytes: dstBytes.byteLength,
  };
}

function summarizeBenchmarkStrokes(
  objects: ReturnType<typeof buildObjects>,
  pattern: ReturnType<typeof renderDesign>,
): {
  strokeLikeObjectCount: number;
  fillUsedOnStrokeCount: number;
  beanRunObjectCount: number;
  satinStrokeObjectCount: number;
  runStitchRatio: number;
  satinStitchRatio: number;
  fillStitchRatio: number;
} {
  let strokeLikeObjectCount = 0;
  let fillUsedOnStrokeCount = 0;
  let beanRunObjectCount = 0;
  let satinStrokeObjectCount = 0;

  for (const object of objects) {
    if (object.strokeKind && object.strokeKind !== "none") {
      strokeLikeObjectCount++;
      if (object.kind === "fill") fillUsedOnStrokeCount++;
      if (object.strokeKind === "bean-run") beanRunObjectCount++;
      if (
        object.strokeKind === "narrow-satin" ||
        object.strokeKind === "border-satin"
      ) {
        satinStrokeObjectCount++;
      }
    }
  }

  let runCount = 0;
  let satinCount = 0;
  let fillCount = 0;
  for (const block of pattern.blocks) {
    for (const stitch of block.stitches) {
      if (stitch.kind === "run") runCount++;
      if (stitch.kind === "satin") satinCount++;
      if (stitch.kind === "fill") fillCount++;
    }
  }
  const total = runCount + satinCount + fillCount;
  const ratio = (count: number) =>
    total === 0 ? 0 : Number((count / total).toFixed(3));

  return {
    strokeLikeObjectCount,
    fillUsedOnStrokeCount,
    beanRunObjectCount,
    satinStrokeObjectCount,
    runStitchRatio: ratio(runCount),
    satinStitchRatio: ratio(satinCount),
    fillStitchRatio: ratio(fillCount),
  };
}

function nowMs(): number {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
}
