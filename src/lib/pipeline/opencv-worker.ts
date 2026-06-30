"use client";

/**
 * OpenCV.js (WASM) を classic Web Worker に隔離して動かすクライアント。
 * メインスレッドから cv を直接触らないため、k-means や形態学演算で
 * OOM になっても UI スレッドが巻き込まれない。
 *
 * 設計は engr-gemini-conte-ocr (/lib/detectRulings.ts + /public/opencv-detect.worker.js)
 * のパターンを踏襲。Worker は /public/opencv-kmeans.worker.js。
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
      reject(new Error("OpenCV worker は ブラウザでのみ起動可能"));
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
          `OpenCV Worker の初期化が ${INIT_TIMEOUT_MS}ms でタイムアウトしました`,
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
  /** 1=不透明, 0=透明。透明ピクセルは k-means から除外し、labels に sentinel BACKGROUND_LABEL を入れる */
  opaqueMask?: Uint8Array;
  colorCount: number;
  iterations?: number;
  epsilon?: number;
  /**
   * k-means 前段の bilateralFilter 強度 (0..4)。
   * 0 でフィルタ無効。境界を保ったまま中間色を均すのでクラスタリングが安定し、
   * 細い影色が背景に吸われるのを抑える。
   */
  smoothing?: number;
};

/** labels に入る背景 sentinel 値。Uint8Array なので 0..colorCount-1 とぶつからない 255 を使う。 */
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

/** Worker を事前ウォームアップ (UI を見せる前に呼んでおくと初回が速い) */
export function warmupOpenCV(): Promise<Worker> {
  return getWorker();
}

/** テスト/再起動用 */
export function terminateOpenCV(): void {
  if (!workerPromise) return;
  void workerPromise.then((w) => w.terminate());
  workerPromise = null;
}
