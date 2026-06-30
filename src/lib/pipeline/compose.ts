import type { StitchPattern } from "./types";
import type { ConversionConfig } from "./config";
import { optimizeOrder } from "./pathing";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { buildObjects } from "./build-objects";
import { renderDesign } from "./render";
import type { EmbroideryDesign } from "./types";
import { getFabricProfile } from "./fabric";
import { warmupPyodide } from "./pyodide-loader";
import { quantize, warmupOpenCV } from "./quantize";
import { vectorize, type ColorRegion } from "./vectorize";
import { generateStitches } from "./render";
import { writeEmbroidery } from "./writer";

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
  fileBlob: Blob;
};

/**
 * 量子化 + ベクター化までで得られる中間データ。色別に角度を変えて何度も
 * 再生成するときは、これをキャッシュして `runStitchAndWrite` に渡し直す。
 */
export type PrepipelineResult = {
  regions: ColorRegion[];
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
};

/**
 * OpenCV.js のメモリ消費と imagetracerjs の処理時間を抑えるため入力解像度を絞る。
 * 必要なら段階的に上げる。
 */
const MAX_DIMENSION = 384;

/**
 * 画像 → 刺繍データの変換パイプライン。
 * - OpenCV.js は Web Worker で動かす (opencv-worker.ts)
 * - Pyodide も Web Worker で動かす (pyodide-worker.ts)
 * - imagetracerjs (pure JS) はメインスレッドで動かす
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
 * 量子化 + ベクター化までを実行して `regions` を得る。
 * 角度だけを変えて再生成したい場合はここの結果を使い回す。
 */
export async function runPrepipeline(
  imageBitmap: ImageBitmap,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PrepipelineResult> {
  onProgress?.({ stage: "loading-cv", percent: 5 });
  await warmupOpenCV();

  onProgress?.({ stage: "loading-py", percent: 15 });
  await warmupPyodide();

  const { imageData, opaqueMask } = bitmapToImageData(imageBitmap);
  const aspect = imageBitmap.height / imageBitmap.width;
  const widthMm = config.widthMm;
  const heightMm = widthMm * aspect;

  onProgress?.({ stage: "quantize", percent: 25 });
  const quantized = await quantize({
    imageData,
    opaqueMask,
    colorCount: config.colorCount,
    smoothing: config.smoothing,
  });

  onProgress?.({ stage: "vectorize", percent: 50 });
  const regions = await vectorize({
    labels: quantized.labels,
    width: imageData.width,
    height: imageData.height,
    palette: quantized.palette,
    dilatePx: config.boundaryDilatePx,
  });

  return {
    regions,
    widthMm,
    heightMm,
    widthPx: imageData.width,
    heightPx: imageData.height,
  };
}

/**
 * `regions` から刺繍ステッチを生成し、刺繍ファイルに書き出す。
 * `config.fillAngleDeg` / `config.fillAngleByColor` を反映する。
 */
export async function runStitchAndWrite(
  pre: PrepipelineResult,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  onProgress?.({ stage: "stitch", percent: 75 });
  // Phase 3 §4 pathing 統合: buildObjects → optimizeOrder → renderDesign (policy 経路)。
  // Phase 1/2 互換のため generateStitches 互換 API は維持するが、本番 pipeline からは
  // 上記の明示経路を使い、format に応じた TRIM_POLICY と訪問順最適化を反映する。
  const fabric = getFabricProfile(config.fabric);
  const objects = buildObjects({
    regions: pre.regions,
    widthMm: pre.widthMm,
    widthPx: pre.widthPx,
    fabric,
    satinMaxWidthMm: config.satinMaxWidthMm,
  });
  const baseDesign: EmbroideryDesign = {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    fabric,
    objects,
  };
  const optimized = optimizeOrder(baseDesign);
  const pattern = renderDesign(optimized, {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    widthPx: pre.widthPx,
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

  onProgress?.({ stage: "write", percent: 90 });
  const fileBlob = await writeEmbroidery({
    pattern,
    format: config.format,
  });

  return { pattern, fileBlob };
}

function bitmapToImageData(bitmap: ImageBitmap): {
  imageData: ImageData;
  /** 1 = 不透明 (ステッチ対象)、0 = 透明 (背景としてステッチ対象外) */
  opaqueMask: Uint8Array;
} {
  const { width: w, height: h } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));

  // 1) 白で塗りつぶしてから drawImage。透過部分の RGB を (0,0,0,0) ではなく白に統一する。
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
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できません");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(bitmap, 0, 0, dw, dh);
  const imageData = ctx.getImageData(0, 0, dw, dh);

  // 2) アルファだけを別 canvas で取得して背景マスクを作る。
  //    白合成後の imageData では alpha が常に 255 になるため、別取りが必要。
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
  if (!mctx) throw new Error("Canvas 2D コンテキスト (mask) を取得できません");
  mctx.clearRect(0, 0, dw, dh);
  mctx.drawImage(bitmap, 0, 0, dw, dh);
  const maskData = mctx.getImageData(0, 0, dw, dh).data;
  const opaqueMask = new Uint8Array(dw * dh);
  for (let i = 0; i < dw * dh; i++) {
    opaqueMask[i] = maskData[i * 4 + 3] >= 128 ? 1 : 0;
  }
  return { imageData, opaqueMask };
}
