import { describe, it, expect } from "vitest";
import {
  convertImageToEmbroideryDirect,
  runPrepipeline,
  runStitchAndWrite,
} from "../compose";
import * as pipeline from "../index";

describe("compose", () => {
  it("convertImageToEmbroideryDirect が compose.ts から import できる", () => {
    expect(typeof convertImageToEmbroideryDirect).toBe("function");
  });

  it("runPrepipeline / runStitchAndWrite が compose.ts から export されている", () => {
    expect(typeof runPrepipeline).toBe("function");
    expect(typeof runStitchAndWrite).toBe("function");
  });

  it("旧 index.ts 経由でも同名でアクセスできる (re-export が機能している)", () => {
    expect(pipeline.convertImageToEmbroideryDirect).toBe(
      convertImageToEmbroideryDirect,
    );
    expect(pipeline.runPrepipeline).toBe(runPrepipeline);
    expect(pipeline.runStitchAndWrite).toBe(runStitchAndWrite);
  });
});
