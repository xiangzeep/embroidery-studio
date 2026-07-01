"use client";

import type { ConversionConfig } from "./config";
import type { PrepipelineResult, PipelineResult } from "./compose";
import { deserializeDesign, type SerializedDesign } from "./design";
import { getFabricProfile } from "./fabric";

const DEFAULT_TIMEOUT_MS = 20_000;

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
  const worker = (options.workerFactory ?? createWorker)();
  const result = await requestStitch(worker, pre, config, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    pattern: result.pattern,
    design: deserializeDesign(result.design, getFabricProfile),
    stats: result.stats,
    fileBlob: new Blob([new Uint8Array(result.fileBuffer)], {
      type: "application/octet-stream",
    }),
  };
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
