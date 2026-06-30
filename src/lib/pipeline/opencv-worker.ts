"use client";

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */

const WORKER_URL = "/opencv-kmeans.worker.js";
const INIT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

type WorkerReadyMsg = { type: "ready" };
type WorkerErrorMsg = { type: "error"; seq?: number; message: string };
type WorkerResultMsg = {
  type: "result";
  seq: number;
  width: number;
  height: number;
  colorCount: number;
  paletteBuf: ArrayBuffer;
  labelsBuf: ArrayBuffer;
  outBuf: ArrayBuffer;
};
type WorkerMsg = WorkerReadyMsg | WorkerErrorMsg | WorkerResultMsg;

let workerPromise: Promise<Worker> | null = null;
let seqCounter = 0;

function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = new Promise<Worker>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("OpenCV worker can only run in the browser"));
      return;
    }
    let w: Worker;
    try {
      w = new Worker(WORKER_URL);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      w.terminate();
      reject(
        new Error(
          `OpenCV Worker initialization timed out after ${INIT_TIMEOUT_MS}ms`,
        ),
      );
    }, INIT_TIMEOUT_MS);
    const onReady = (e: MessageEvent<WorkerMsg>) => {
      if (e.data?.type === "ready") {
        clearTimeout(timer);
        w.removeEventListener("message", onReady);
        resolve(w);
      } else if (e.data?.type === "error") {
        clearTimeout(timer);
        w.removeEventListener("message", onReady);
        reject(new Error(e.data.message));
      }
    };
    w.addEventListener("message", onReady);
    w.addEventListener("error", (ev) => {
      clearTimeout(timer);
      reject(new Error(`OpenCV Worker load error: ${ev.message || "unknown"}`));
    });
  });
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

export type QuantizeInput = {
  imageData: ImageData;
  /** English note. */
  opaqueMask?: Uint8Array;
  colorCount: number;
  iterations?: number;
  epsilon?: number;
  /**
   * English note.
   * English note.
   * English note.
   */
  smoothing?: number;
};

/** English note. */
export const BACKGROUND_LABEL = 0xff;

export type QuantizedImage = {
  imageData: ImageData;
  palette: Array<[number, number, number]>;
  labels: Uint8Array;
};

export async function quantizeViaWorker(
  input: QuantizeInput,
): Promise<QuantizedImage> {
  const w = await getWorker();
  const seq = ++seqCounter;

  return new Promise<QuantizedImage>((resolve, reject) => {
    const timer = setTimeout(() => {
      w.removeEventListener("message", onMessage);
      reject(new Error("OpenCV quantize timeout"));
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (e: MessageEvent<WorkerMsg>) => {
      const data = e.data;
      if (!data || (data.type !== "result" && data.type !== "error")) return;
      if ("seq" in data && data.seq !== seq) return;
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);

      if (data.type === "error") {
        reject(new Error(data.message));
        return;
      }
      const p = new Uint8Array(data.paletteBuf);
      const palette: Array<[number, number, number]> = [];
      for (let k = 0; k < data.colorCount; k++) {
        palette.push([p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
      }
      const labels = new Uint8Array(data.labelsBuf);
      const out = new Uint8ClampedArray(data.outBuf);
      const imageData = new ImageData(out, data.width, data.height);
      resolve({ imageData, palette, labels });
    };
    w.addEventListener("message", onMessage);

    const srcBuf = input.imageData.data.buffer;
    const transfer = srcBuf.slice(0) as ArrayBuffer;
    const transferables: ArrayBuffer[] = [transfer];
    let maskTransfer: ArrayBuffer | undefined;
    if (input.opaqueMask) {
      maskTransfer = input.opaqueMask.buffer.slice(0) as ArrayBuffer;
      transferables.push(maskTransfer);
    }
    w.postMessage(
      {
        type: "quantize",
        seq,
        width: input.imageData.width,
        height: input.imageData.height,
        buffer: transfer,
        maskBuffer: maskTransfer,
        colorCount: input.colorCount,
        iterations: input.iterations,
        epsilon: input.epsilon,
        smoothing: input.smoothing,
      },
      transferables,
    );
  });
}

/** English note. */
export function warmupOpenCV(): Promise<Worker> {
  return getWorker();
}

/** English note. */
export function terminateOpenCV(): void {
  if (!workerPromise) return;
  void workerPromise.then((w) => w.terminate());
  workerPromise = null;
}
