import { describe, expect, it } from "vitest";
import { assertValidStitches, validateStitches } from "../stitch-validator";
import type { StitchPattern } from "../types";

describe("stitch-validator", () => {
  it("reports too-short and too-long real stitches", () => {
    const report = validateStitches(makePattern([
      { x: 0, y: 0, kind: "run", colorIndex: 0 },
      { x: 0.1, y: 0, kind: "run", colorIndex: 0 },
      { x: 20, y: 0, kind: "run", colorIndex: 0 },
    ]));

    expect(report.warnings.some((warning) => warning.code === "stitch-too-short")).toBe(true);
    expect(report.errors.some((error) => error.code === "stitch-too-long")).toBe(true);
  });

  it("ignores jump distance for stitch-length validation", () => {
    const report = validateStitches(makePattern([
      { x: 0, y: 0, kind: "run", colorIndex: 0 },
      { x: 30, y: 0, kind: "jump", colorIndex: 0 },
      { x: 30, y: 2, kind: "run", colorIndex: 0 },
    ]));

    expect(report.errors.some((error) => error.code === "stitch-too-long")).toBe(false);
  });

  it("throws when severe stitch errors exist", () => {
    expect(() => assertValidStitches(makePattern([
      { x: 0, y: 0, kind: "run", colorIndex: 0 },
      { x: 20, y: 0, kind: "run", colorIndex: 0 },
    ]))).toThrow(/stitch-too-long/);
  });
});

function makePattern(stitches: StitchPattern["blocks"][number]["stitches"]): StitchPattern {
  return {
    widthMm: 20,
    heightMm: 20,
    blocks: [{ colorIndex: 0, rgb: [0, 128, 255], stitches }],
    totalStitches: stitches.filter((stitch) => stitch.kind !== "jump" && stitch.kind !== "trim" && stitch.kind !== "stop").length,
  };
}
