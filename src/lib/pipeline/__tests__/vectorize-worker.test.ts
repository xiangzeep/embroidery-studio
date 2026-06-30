import { describe, expect, it } from "vitest";

if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  (globalThis as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

import { vectorizeViaWorker } from "../vectorize-worker";
import type { Tracer, VectorizeInput } from "../vectorize";

function makeInput(): VectorizeInput {
  return {
    labels: new Uint8Array(100 * 100).fill(0),
    width: 100,
    height: 100,
    palette: [[0, 0, 0]],
  };
}

const tracer: Tracer = {
  async trace() {
    return ["M 0 0 L 100 0 L 100 100 L 0 100 Z"];
  },
};

describe("vectorizeViaWorker", () => {
  it("falls back to direct vectorization when Worker is unavailable", async () => {
    const regions = await vectorizeViaWorker(makeInput(), {
      tracer,
      workerFactory: () => {
        throw new Error("Worker unavailable");
      },
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].shapes).toHaveLength(1);
  });

  it("falls back to direct vectorization when the worker reports an error", async () => {
    const regions = await vectorizeViaWorker(makeInput(), {
      tracer,
      workerFactory: () => new ErrorWorker() as unknown as Worker,
      timeoutMs: 100,
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].colorIndex).toBe(0);
  });
});

class ErrorWorker {
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage() {
    queueMicrotask(() => {
      const event = { data: { type: "error", seq: 1, message: "boom" } } as MessageEvent;
      for (const listener of this.listeners.get("message") ?? []) listener(event);
    });
  }

  terminate() {}
}
