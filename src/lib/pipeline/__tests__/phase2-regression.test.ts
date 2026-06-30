import { describe, expect, it } from "vitest";
import {
  getPhase2RealSamples,
  getPhase2DstBaselines,
} from "./fixtures/real-samples/phase2-real-samples";

describe("phase 2 real sample baselines", () => {
  it("tracks the c_00000 and e_00000 regression samples", () => {
    const samples = getPhase2RealSamples();

    expect(samples.map((sample) => sample.id)).toEqual(["c_00000", "e_00000"]);
    expect(samples.every((sample) => sample.widthPx === 256 && sample.heightPx === 256)).toBe(true);
    expect(samples.find((sample) => sample.id === "c_00000")?.concerns).toContain("excessive-function-codes");
    expect(samples.find((sample) => sample.id === "e_00000")?.concerns).toEqual(
      expect.arrayContaining([
        "missing-right-middle-detail",
        "messy-slanted-and-bottom-edges",
        "excessive-function-codes",
      ]),
    );
  });

  it("records current DST command baselines for comparison", () => {
    const baselines = getPhase2DstBaselines();

    expect(baselines).toHaveLength(2);
    expect(baselines[0]).toMatchObject({
      id: "embroidery-1",
      recordCount: 1283,
      stitchCount: 986,
      jumpCount: 292,
      stopCount: 4,
      maxConsecutiveJumpRun: 8,
    });
    expect(baselines[1]).toMatchObject({
      id: "embroidery-3",
      recordCount: 885,
      stitchCount: 747,
      jumpCount: 133,
      stopCount: 4,
      maxConsecutiveJumpRun: 7,
    });
    expect(baselines[0].jumpRatio).toBeCloseTo(0.228, 3);
    expect(baselines[1].jumpRatio).toBeCloseTo(0.15, 3);
  });
});
