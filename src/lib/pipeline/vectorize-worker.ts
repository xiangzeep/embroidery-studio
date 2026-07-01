"use client";

import {
  vectorize,
  type ColorRegion,
  type Tracer,
  type VectorizeInput,
} from "./vectorize";

const DEFAULT_TIMEOUT_MS = 60_000;

type WorkerResultMsg = {
  type: "result";
  seq: number;
  regions: ColorRegion[];
};

type WorkerErrorMsg = {
  type: "error";
  seq: number;
  message: string;
};

type WorkerMsg = WorkerResultMsg | WorkerErrorMsg;

type VectorizeWorkerRequest = VectorizeInput & {
  type: "vectorize";
  seq: number;
};

export type VectorizeWorkerOptions = {
  tracer?: Tracer;
  workerFactory?: () => Worker;
  timeoutMs?: number;
  allowDirectFallback?: boolean;
};

let seqCounter = 0;

export async function vectorizeViaWorker(
  input: VectorizeInput,
  options: VectorizeWorkerOptions = {},
): Promise<ColorRegion[]> {
  if (options.tracer && !options.workerFactory) return vectorize(input, options.tracer);

  try {
    const worker = (options.workerFactory ?? createWorker)();
    return await requestVectorize(worker, input, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (error) {
    if (options.allowDirectFallback && options.tracer) {
      return vectorize(input, options.tracer);
    }
    throw error;
  }
}

function createWorker(): Worker {
  if (typeof Worker === "undefined") {
    throw new Error("Vectorize worker can only run in a browser-like environment");
  }
  return new Worker(new URL("./vectorize.browser.worker.ts", import.meta.url), {
    type: "module",
  });
}

function requestVectorize(
  worker: Worker,
  input: VectorizeInput,
  timeoutMs: number,
): Promise<ColorRegion[]> {
  const seq = ++seqCounter;
  return new Promise<ColorRegion[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Vectorize worker timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };

    const onMessage = (event: MessageEvent<WorkerMsg>) => {
      const data = event.data;
      if (!data || data.seq !== seq) return;
      cleanup();
      if (data.type === "error") {
        reject(new Error(data.message));
        return;
      }
      resolve(data.regions);
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "Vectorize worker failed"));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const request: VectorizeWorkerRequest = {
      ...input,
      type: "vectorize",
      seq,
      labels: new Uint8Array(input.labels),
      palette: input.palette.map((rgb) => [...rgb] as [number, number, number]),
    };
    worker.postMessage(request, [request.labels.buffer]);
  });
}
