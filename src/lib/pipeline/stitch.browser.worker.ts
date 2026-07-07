/// <reference lib="webworker" />

import type { ConversionConfig } from "./config";
import type { PrepipelineResult } from "./compose";
import { buildDesignGraph } from "./design-graph";
import { connectLineArtRunObjects } from "./line-art-stroke-connector";
import { removeDuplicatePaths } from "./polyline-deduplicator";
import { regularizeShapes } from "./shape-regularizer";
import { normalizeThreadColors } from "./thread-normalizer";
import { renderDesignGraph } from "./render";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { optimizePatternCommands } from "./command-optimizer";
import { analyzePattern } from "./stats";
import { writeDstBytes } from "./dst-writer";
import { serializeDesign } from "./design";
import { assertPrepipelineWithinStitchBudget } from "./stitch-budget";

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
    assertPrepipelineWithinStitchBudget(pre, config);
    const builtGraph = buildDesignGraph(pre, config);
    const normalizedGraph = normalizeThreadColors(builtGraph, { digitizingMode: config.digitizingMode });
    const regularizedGraph = regularizeShapes(normalizedGraph);
    const graph = config.digitizingMode === "line-art"
      ? removeDuplicatePaths(connectLineArtRunObjects(regularizedGraph))
      : regularizedGraph;
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
    const stats = analyzePattern(pattern);
    const bytes = writeDstBytes(pattern);
    const fileBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(fileBuffer).set(bytes);

    self.postMessage({
      type: "result",
      seq: input.seq,
      pattern,
      design: serializeDesign(graph.design),
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
