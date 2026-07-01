import type { StitchPattern } from "./types";
import { analyzePattern, type PatternStats } from "./stats";
import { QUALITY_PRESETS, type ConversionConfig, type QualityPreset } from "./config";
import { optimizeOrder } from "./pathing";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { buildObjects } from "./build-objects";
import { renderDesign } from "./render";
import type { EmbroideryDesign } from "./types";
import { getFabricProfile } from "./fabric";
import { quantize, warmupOpenCV } from "./quantize";
import { quantizeLineArt } from "./line-art-quantize";
import { vectorizeViaWorker } from "./vectorize-worker";
import type { ColorRegion } from "./vectorize";
import { generateStitches } from "./render";
import { writeEmbroidery } from "./writer";
import { optimizePatternCommands } from "./command-optimizer";
import type { DigitizingMode } from "./config";
import { runStitchAndWriteViaWorker } from "./stitch-worker";

export type PipelineStage =
  | "loading-cv"
  | "loading-py"
  | "quantize"
  | "vectorize"
  | "stitch"
  | "write";

export type PipelineProgress = {
  stage: PipelineStage;
  percent: number;
  message?: string;
};

export type PipelineResult = {
  pattern: StitchPattern;
  design: EmbroideryDesign;
  fileBlob: Blob;
  stats: PatternStats;
};

/**
 * English note.
 * English note.
 */
export type PrepipelineResult = {
  regions: ColorRegion[];
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
};

/**
 * English note.
 * English note.
 * English note.
 * English note.
 */
export async function convertImageToEmbroideryDirect(
  imageBitmap: ImageBitmap,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult & PrepipelineResult> {
  const pre = await runPrepipeline(imageBitmap, config, onProgress);
  const post = await runStitchAndWrite(pre, config, onProgress);
  return { ...pre, ...post };
}

/**
 * English note.
 * English note.
 */
export async function runPrepipeline(
  imageBitmap: ImageBitmap,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PrepipelineResult> {
  onProgress?.({ stage: "loading-cv", percent: 5 });
  if (config.digitizingMode !== "line-art") {
    await warmupOpenCV();
  }

  const { imageData, opaqueMask } = bitmapToImageData(
    imageBitmap,
    resolvePreprocessMaxDimension(config.digitizingMode, config.qualityPreset),
  );
  const aspect = imageBitmap.height / imageBitmap.width;
  const widthMm = config.widthMm;
  const heightMm = widthMm * aspect;

  onProgress?.({ stage: "quantize", percent: 25 });
  const quantized = config.digitizingMode === "line-art"
    ? quantizeLineArt({
        imageData,
        opaqueMask,
        colorCount: config.colorCount,
        removeWhiteBackground: config.removeWhiteBackground,
      })
    : await quantize({
        imageData,
        opaqueMask,
        colorCount: config.colorCount,
        smoothing: config.smoothing,
      });

  onProgress?.({ stage: "vectorize", percent: 50 });
  const regions = await vectorizeViaWorker({
    labels: quantized.labels,
    width: imageData.width,
    height: imageData.height,
    palette: quantized.palette,
    dilatePx: resolveVectorizeDilatePx(config.digitizingMode, config.boundaryDilatePx),
  });

  return {
    regions,
    widthMm,
    heightMm,
    widthPx: imageData.width,
    heightPx: imageData.height,
  };
}

export function resolveVectorizeDilatePx(
  digitizingMode: DigitizingMode,
  configuredDilatePx: number,
): number {
  return digitizingMode === "line-art" ? 0 : configuredDilatePx;
}

export function resolvePreprocessMaxDimension(
  digitizingMode: DigitizingMode,
  qualityPreset: QualityPreset,
): number {
  const configured = QUALITY_PRESETS[qualityPreset].maxDimension;
  if (digitizingMode !== "line-art") return configured;
  const lineArtCap = qualityPreset === "detail" ? 256 : qualityPreset === "high" ? 192 : 128;
  return Math.min(configured, lineArtCap);
}

/**
 * English note.
 * English note.
 */
export async function runStitchAndWrite(
  pre: PrepipelineResult,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  onProgress?.({ stage: "stitch", percent: 75 });
  if (typeof Worker !== "undefined" && config.format === "dst") {
    return runStitchAndWriteViaWorker(pre, config);
  }
  return runStitchAndWriteDirect(pre, config, onProgress);
}

export async function runStitchAndWriteDirect(
  pre: PrepipelineResult,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  onProgress?.({ stage: "stitch", percent: 75 });
  // Local pathing flow: buildObjects -> optimizeOrder -> renderDesign.
  // English note.
  // English note.
  const fabric = getFabricProfile(config.fabric);
  const objects = buildObjects({
    regions: pre.regions,
    widthMm: pre.widthMm,
    widthPx: pre.widthPx,
    heightPx: pre.heightPx,
    fabric,
    digitizingMode: config.digitizingMode,
    outlineFontStrategy: config.outlineFontStrategy,
    satinMaxWidthMm: config.satinMaxWidthMm,
    minRegionAreaPx: config.minRegionAreaPx,
    removeWhiteBackground: config.removeWhiteBackground,
  });
  const baseDesign: EmbroideryDesign = {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    fabric,
    objects,
  };
  const optimized = optimizeOrder(baseDesign);
  const renderedPattern = renderDesign(optimized, {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    widthPx: pre.widthPx,
    digitizingMode: config.digitizingMode,
    stitchDensityMm: config.stitchDensity,
    satinMaxWidthMm: config.satinMaxWidthMm,
    fillAngleDeg: config.fillAngleDeg,
    fillAngleByColorIndex: config.fillAngleByColor,
    fillStrategy: config.fillStrategy,
    fabric,
    disableUnderlay: config.disableUnderlay,
    disableCompensation: config.disableCompensation,
    policy: TRIM_POLICY_BY_FORMAT[config.format],
  });
  const pattern = optimizePatternCommands(renderedPattern);

  onProgress?.({ stage: "write", percent: 90 });
  const stats = analyzePattern(pattern);
  const fileBlob = await writeEmbroidery({
    pattern,
    format: config.format,
  });

  return { pattern, design: optimized, fileBlob, stats };
}

export async function rerenderDesignAndWrite(
  design: EmbroideryDesign,
  pre: PrepipelineResult,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  onProgress?.({ stage: "stitch", percent: 75 });

  const visibleDesign: EmbroideryDesign = {
    ...design,
    objects: design.objects.filter((object) => object.visible !== false),
  };

  const renderedPattern = renderDesign(visibleDesign, {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    widthPx: pre.widthPx,
    digitizingMode: config.digitizingMode,
    outlineFontStrategy: config.outlineFontStrategy,
    stitchDensityMm: config.stitchDensity,
    satinMaxWidthMm: config.satinMaxWidthMm,
    fillAngleDeg: config.fillAngleDeg,
    fillAngleByColorIndex: config.fillAngleByColor,
    fillStrategy: config.fillStrategy,
    fabric: visibleDesign.fabric,
    disableUnderlay: config.disableUnderlay,
    disableCompensation: config.disableCompensation,
    policy: TRIM_POLICY_BY_FORMAT[config.format],
  });
  const pattern = optimizePatternCommands(renderedPattern);

  onProgress?.({ stage: "write", percent: 90 });
  const stats = analyzePattern(pattern);
  const fileBlob = await writeEmbroidery({
    pattern,
    format: config.format,
  });

  return { pattern, design: visibleDesign, fileBlob, stats };
}

function bitmapToImageData(bitmap: ImageBitmap, maxDimension: number): {
  imageData: ImageData;
  /** English note. */
  opaqueMask: Uint8Array;
} {
  const { width: w, height: h } = bitmap;
  const scale = Math.min(1, maxDimension / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));

  // English note.
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(dw, dh)
      : Object.assign(document.createElement("canvas"), {
          width: dw,
          height: dh,
        });
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Could not get the Canvas 2D context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(bitmap, 0, 0, dw, dh);
  const imageData = ctx.getImageData(0, 0, dw, dh);

  // English note.
  // English note.
  const maskCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(dw, dh)
      : Object.assign(document.createElement("canvas"), {
          width: dw,
          height: dh,
        });
  const mctx = maskCanvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!mctx) throw new Error("Could not get the Canvas 2D mask context");
  mctx.clearRect(0, 0, dw, dh);
  mctx.drawImage(bitmap, 0, 0, dw, dh);
  const maskData = mctx.getImageData(0, 0, dw, dh).data;
  const opaqueMask = new Uint8Array(dw * dh);
  for (let i = 0; i < dw * dh; i++) {
    opaqueMask[i] = maskData[i * 4 + 3] >= 128 ? 1 : 0;
  }
  return { imageData, opaqueMask };
}
