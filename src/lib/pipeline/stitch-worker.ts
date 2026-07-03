"use client";

import type { ConversionConfig } from "./config";
import type { PrepipelineResult, PipelineResult } from "./compose";
import { deserializeDesign, type SerializedDesign } from "./design";
import { getFabricProfile } from "./fabric";
import {
  assertPrepipelineWithinStitchBudget,
  summarizePrepipelineComplexity,
} from "./stitch-budget";

const BASE_TIMEOUT_MS = 30_000;
const COMPLEX_LINE_ART_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 60_000;
const COMPLEX_LINE_ART_SHAPES = 40;
const COMPLEX_LINE_ART_POINTS = 3_000;

type StitchWorkerRequest = {
  type: "stitch";
  seq: number;
  pre: PrepipelineResult;
  config: ConversionConfig;
};

type StitchWorkerResultMsg = {
  type: "result";
  seq: number;
  pattern: PipelineResult["pattern"];
  design: SerializedDesign;
  stats: PipelineResult["stats"];
  fileBuffer: ArrayBuffer;
};

type StitchWorkerErrorMsg = {
  type: "error";
  seq: number;
  message: string;
};

type StitchWorkerMsg = StitchWorkerResultMsg | StitchWorkerErrorMsg;

export type StitchWorkerOptions = {
  workerFactory?: () => Worker;
  timeoutMs?: number;
};

let seqCounter = 0;

export async function runStitchAndWriteViaWorker(
  pre: PrepipelineResult,
  config: ConversionConfig,
  options: StitchWorkerOptions = {},
): Promise<PipelineResult> {
  assertPrepipelineWithinStitchBudget(pre, config);
  const worker = (options.workerFactory ?? createWorker)();
  const result = await requestStitch(
    worker,
    pre,
    config,
    options.timeoutMs ?? resolveStitchWorkerTimeoutMs(pre, config),
  );
  return {
    pattern: result.pattern,
    design: deserializeDesign(result.design, getFabricProfile),
    stats: result.stats,
    fileBlob: new Blob([new Uint8Array(result.fileBuffer)], {
      type: "application/octet-stream",
    }),
  };
}

export function resolveStitchWorkerTimeoutMs(
  pre: PrepipelineResult,
  config: ConversionConfig,
): number {
  if (config.digitizingMode !== "line-art") return BASE_TIMEOUT_MS;
  const complexity = summarizePrepipelineComplexity(pre);
  let timeoutMs = BASE_TIMEOUT_MS;
  if (
    complexity.shapeCount >= COMPLEX_LINE_ART_SHAPES ||
    complexity.pointCount >= COMPLEX_LINE_ART_POINTS
  ) {
    timeoutMs = COMPLEX_LINE_ART_TIMEOUT_MS;
  }
  const extraShapeBuckets = Math.floor(Math.max(0, complexity.shapeCount - COMPLEX_LINE_ART_SHAPES) / 40);
  const extraPointBuckets = Math.floor(Math.max(0, complexity.pointCount - COMPLEX_LINE_ART_POINTS) / 3_000);
  return Math.min(MAX_TIMEOUT_MS, timeoutMs + Math.max(extraShapeBuckets, extraPointBuckets) * 15_000);
}

function createWorker(): Worker {
  if (typeof Worker === "undefined") {
    throw new Error("Stitch worker can only run in a browser-like environment");
  }
  return new Worker(new URL("./stitch.browser.worker.ts", import.meta.url), {
    type: "module",
  });
}

function requestStitch(
  worker: Worker,
  pre: PrepipelineResult,
  config: ConversionConfig,
  timeoutMs: number,
): Promise<StitchWorkerResultMsg> {
  const seq = ++seqCounter;
  return new Promise<StitchWorkerResultMsg>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Stitch worker timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };

    const onMessage = (event: MessageEvent<StitchWorkerMsg>) => {
      const data = event.data;
      if (!data || data.seq !== seq) return;
      cleanup();
      if (data.type === "error") {
        reject(new Error(data.message));
        return;
      }
      resolve(data);
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "Stitch worker failed"));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const request: StitchWorkerRequest = {
      type: "stitch",
      seq,
      pre,
      config,
    };
    worker.postMessage(request);
  });
}
