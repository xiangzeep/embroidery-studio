import { describe, expect, it, vi } from "vitest";

class FakeWorker {
  readonly url: string;
  private listeners = new Set<(event: MessageEvent) => void>();
  terminated = false;
  messages: unknown[] = [];

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent);
    }
  }
}

describe("pyodide worker readiness", () => {
  it("tracks idle, warming, and ready states", async () => {
    vi.resetModules();
    const workers: FakeWorker[] = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("Worker", class extends FakeWorker {
      constructor(url: string) {
        super(url);
        workers.push(this);
      }
    });

    const mod = await import("../pyodide-worker");

    expect(mod.getPyodideWorkerStatus()).toEqual({ state: "idle" });
    const warmup = mod.warmupPyodide();
    expect(mod.getPyodideWorkerStatus()).toEqual({ state: "warming" });
    workers[0].emit({ type: "ready" });
    await warmup;
    expect(mod.getPyodideWorkerStatus()).toEqual({ state: "ready" });

    mod.terminatePyodide();
    expect(mod.getPyodideWorkerStatus()).toEqual({ state: "idle" });
    vi.unstubAllGlobals();
  });
});
