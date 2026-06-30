"use client";

/**
 * English note.
 * English note.
 * English note.
 */

import type { StitchPattern } from "./types";
import type { EmbroideryFormat } from "./config";

const WORKER_URL = "/pyodide.worker.js";
const INIT_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 60_000;

export type PyodideWorkerRequest = {
  type: "write";
  seq: number;
  patternJson: string;
  format: EmbroideryFormat;
};

export type PyodideWorkerResponse =
  | { type: "ready" }
  | { type: "result"; seq: number; buffer: ArrayBuffer }
  | { type: "error"; seq?: number; message: string };

export type PyodideWorkerStatus =
  | { state: "idle" }
  | { state: "warming" }
  | { state: "ready" }
  | { state: "error"; message: string };

let workerPromise: Promise<Worker> | null = null;
let workerStatus: PyodideWorkerStatus = { state: "idle" };
let seqCounter = 0;

function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerStatus = { state: "warming" };
  workerPromise = new Promise<Worker>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Pyodide worker can only run in the browser"));
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
          `Pyodide Worker initialization timed out after ${INIT_TIMEOUT_MS}ms`,
        ),
      );
    }, INIT_TIMEOUT_MS);
    const onReady = (e: MessageEvent<PyodideWorkerResponse>) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "ready") {
        clearTimeout(timer);
        w.removeEventListener("message", onReady);
        workerStatus = { state: "ready" };
        resolve(w);
      } else if (d.type === "error") {
        clearTimeout(timer);
        w.removeEventListener("message", onReady);
        workerStatus = { state: "error", message: d.message };
        reject(new Error(d.message));
      }
    };
    w.addEventListener("message", onReady);
    w.addEventListener("error", (ev) => {
      clearTimeout(timer);
      const message = `Pyodide Worker load error: ${ev.message || "unknown"}`;
      workerStatus = { state: "error", message };
      reject(new Error(message));
    });
  });
  workerPromise.catch((err) => {
    workerPromise = null;
    workerStatus = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  });
  return workerPromise;
}

export type WriteEmbroideryInput = {
  pattern: StitchPattern;
  format: EmbroideryFormat;
};

export async function writeEmbroideryViaWorker(
  input: WriteEmbroideryInput,
): Promise<Blob> {
  const w = await getWorker();
  const seq = ++seqCounter;

  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => {
      w.removeEventListener("message", onMessage);
      reject(new Error("Pyodide write timeout"));
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (e: MessageEvent<PyodideWorkerResponse>) => {
      const data = e.data;
      if (!data) return;
      if (data.type !== "result" && data.type !== "error") return;
      if ("seq" in data && data.seq !== seq) return;
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);

      if (data.type === "error") {
        reject(new Error(data.message));
        return;
      }
      resolve(
        new Blob([new Uint8Array(data.buffer)], {
          type: "application/octet-stream",
        }),
      );
    };
    w.addEventListener("message", onMessage);

    const req: PyodideWorkerRequest = {
      type: "write",
      seq,
      patternJson: JSON.stringify(input.pattern),
      format: input.format,
    };
    w.postMessage(req);
  });
}

export function getPyodideWorkerStatus(): PyodideWorkerStatus {
  return workerStatus;
}

/** English note. */
export function warmupPyodide(): Promise<Worker> {
  return getWorker();
}

/** English note. */
export function terminatePyodide(): void {
  if (!workerPromise) {
    workerStatus = { state: "idle" };
    return;
  }
  void workerPromise.then((w) => w.terminate());
  workerPromise = null;
  workerStatus = { state: "idle" };
}
