import { describe, expect, it } from "vitest";
import { runStitchAndWriteViaWorker } from "../stitch-worker";
import { makeDefaultConfig } from "../config";
import type { PrepipelineResult } from "../compose";

const pre: PrepipelineResult = {
  regions: [{
    colorIndex: 0,
    rgb: [0, 120, 255],
    svgPath: "",
    shapes: [{
      outer: [[0, 0], [100, 0], [100, 10], [0, 10]],
      holes: [],
    }],
    polygons: [],
  }],
  widthMm: 20,
  heightMm: 10,
  widthPx: 100,
  heightPx: 50,
};

describe("runStitchAndWriteViaWorker", () => {
  it("uses a worker result instead of running the stitch stage on the caller thread", async () => {
    const result = await runStitchAndWriteViaWorker(pre, makeDefaultConfig("denim"), {
      workerFactory: () => new SuccessWorker() as unknown as Worker,
      timeoutMs: 100,
    });

    expect(result.pattern.totalStitches).toBe(1);
    expect(result.design.fabric.kind).toBe("denim");
    expect(typeof result.design.fabric.underlayPolicy.satin).toBe("function");
    expect(result.design.objects).toHaveLength(0);
    expect(result.stats.stitchCount).toBe(1);
    expect(await result.fileBlob.arrayBuffer()).toHaveProperty("byteLength", 3);
  });

  it("rejects worker errors instead of falling back to a blocking caller-thread render", async () => {
    await expect(runStitchAndWriteViaWorker(pre, makeDefaultConfig("denim"), {
      workerFactory: () => new ErrorWorker() as unknown as Worker,
      timeoutMs: 100,
    })).rejects.toThrow("stitch exploded");
  });

  it("terminates slow stitch workers before the page can become unresponsive", async () => {
    await expect(runStitchAndWriteViaWorker(pre, makeDefaultConfig("denim"), {
      workerFactory: () => new SlowWorker() as unknown as Worker,
      timeoutMs: 10,
    })).rejects.toThrow("Stitch worker timeout");
  });
});

class SuccessWorker {
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(request: { seq: number }) {
    queueMicrotask(() => {
      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const event = {
        data: {
          type: "result",
          seq: request.seq,
          pattern: {
            widthMm: 20,
            heightMm: 10,
            totalStitches: 1,
            blocks: [{ colorIndex: 0, rgb: [0, 120, 255], stitches: [{ x: 0, y: 0, kind: "run", colorIndex: 0 }] }],
          },
          design: { widthMm: 20, heightMm: 10, fabric: { kind: "denim" }, objects: [] },
          stats: {
            stitchCount: 1,
            blockCount: 1,
            colorCount: 1,
            jumpCount: 0,
            trimCount: 0,
            stopCount: 0,
            maxStitchLengthMm: 0,
            averageStitchLengthMm: 0,
            threadLengthMm: 0,
            travelLengthMm: 0,
            tinyBlockCount: 1,
            warnings: [],
          },
          fileBuffer: buffer,
        },
      } as MessageEvent;
      for (const listener of this.listeners.get("message") ?? []) listener(event);
    });
  }

  terminate() {}
}

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

  postMessage(request: { seq: number }) {
    queueMicrotask(() => {
      const event = { data: { type: "error", seq: request.seq, message: "stitch exploded" } } as MessageEvent;
      for (const listener of this.listeners.get("message") ?? []) listener(event);
    });
  }

  terminate() {}
}

class SlowWorker {
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  terminated = false;

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage() {}

  terminate() {
    this.terminated = true;
  }
}
