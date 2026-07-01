/// <reference lib="webworker" />

import type { ConversionConfig } from "./config";
import type { PrepipelineResult } from "./compose";
import { getFabricProfile } from "./fabric";
import { buildObjects } from "./build-objects";
import { optimizeOrder } from "./pathing";
import { renderDesign } from "./render";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { optimizePatternCommands } from "./command-optimizer";
import { analyzePattern } from "./stats";
import { writeDstBytes } from "./dst-writer";
import { serializeDesign } from "./design";
import { resolveBuildMinRegionAreaPx } from "./line-art-settings";

type StitchWorkerRequest = {
  type: "stitch";
  seq: number;
  pre: PrepipelineResult;
  config: ConversionConfig;
};

self.onmessage = (event: MessageEvent<StitchWorkerRequest>) => {
  const input = event.data;
  if (!input || input.type !== "stitch") return;
  try {
    if (input.config.format !== "dst") {
      throw new Error("Background stitch generation currently supports DST output only.");
    }

    const { pre, config } = input;
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
      minRegionAreaPx: resolveBuildMinRegionAreaPx(config.digitizingMode, config.minRegionAreaPx),
      removeWhiteBackground: config.removeWhiteBackground,
    });
    const baseDesign = {
      widthMm: pre.widthMm,
      heightMm: pre.heightMm,
      fabric,
      objects,
    };
    const design = optimizeOrder(baseDesign);
    const renderedPattern = renderDesign(design, {
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
    const stats = analyzePattern(pattern);
    const bytes = writeDstBytes(pattern);
    const fileBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(fileBuffer).set(bytes);

    self.postMessage({
      type: "result",
      seq: input.seq,
      pattern,
      design: serializeDesign(design),
      stats,
      fileBuffer,
    }, [fileBuffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      seq: input.seq,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
