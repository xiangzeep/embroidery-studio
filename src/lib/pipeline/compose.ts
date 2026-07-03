import type { StitchPattern } from "./types";
import { analyzePattern, type PatternStats } from "./stats";
import { QUALITY_PRESETS, type ConversionConfig, type QualityPreset } from "./config";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { renderDesignGraph } from "./render";
import type { EmbroideryDesign } from "./types";
import { quantize, warmupOpenCV } from "./quantize";
import { quantizeLineArt } from "./line-art-quantize";
import { vectorizeViaWorker } from "./vectorize-worker";
import type { ColorRegion } from "./vectorize";
import { generateStitches } from "./render";
import { writeEmbroidery } from "./writer";
import { optimizePatternCommands } from "./command-optimizer";
import type { DigitizingMode } from "./config";
import { runStitchAndWriteViaWorker } from "./stitch-worker";
import { buildDesignGraph } from "./design-graph";
export {
  resolveBuildMinRegionAreaPx,
  resolveVectorizeTurdsize,
} from "./line-art-settings";
import {
  resolveBuildMinRegionAreaPx,
  resolveVectorizeTurdsize,
} from "./line-art-settings";

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
    turdsize: resolveVectorizeTurdsize(config.digitizingMode),
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
  const lineArtCap = qualityPreset === "detail" ? 512 : qualityPreset === "high" ? 384 : 256;
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
  const graph = buildDesignGraph(pre, config);
  const renderedPattern = renderDesignGraph(graph, {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    widthPx: pre.widthPx,
    digitizingMode: config.digitizingMode,
    stitchDensityMm: config.stitchDensity,
    satinMaxWidthMm: config.satinMaxWidthMm,
    fillAngleDeg: config.fillAngleDeg,
    fillAngleByColorIndex: config.fillAngleByColor,
    fillStrategy: config.fillStrategy,
    fabric: graph.design.fabric,
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

  return { pattern, design: graph.design, fileBlob, stats };
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

  const graph = buildDesignGraph(visibleDesign);
  const renderedPattern = renderDesignGraph(graph, {
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

  return { pattern, design: graph.design, fileBlob, stats };
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
