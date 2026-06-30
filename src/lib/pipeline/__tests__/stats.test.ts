import { describe, expect, it } from "vitest";
import { analyzePattern } from "../stats";
import type { StitchPattern } from "../types";

function makePattern(overrides: Partial<StitchPattern> = {}): StitchPattern {
  return {
    widthMm: 30,
    heightMm: 20,
    blocks: [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        stitches: [
          { x: 0, y: 0, kind: "run", colorIndex: 0 },
          { x: 3, y: 4, kind: "run", colorIndex: 0 },
          { x: 15, y: 4, kind: "jump", colorIndex: 0 },
          { x: 15, y: 4, kind: "trim", colorIndex: 0 },
        ],
      },
      {
        colorIndex: 1,
        rgb: [255, 0, 0],
        stitches: [
          { x: 1, y: 1, kind: "satin", colorIndex: 1 },
          { x: 4, y: 5, kind: "satin", colorIndex: 1 },
          { x: 4, y: 5, kind: "stop", colorIndex: 1 },
        ],
      },
    ],
    totalStitches: 4,
    ...overrides,
  };
}

describe("analyzePattern", () => {
  it("counts stitch categories, colors, blocks, and distances", () => {
    const stats = analyzePattern(makePattern());

    expect(stats.stitchCount).toBe(4);
    expect(stats.blockCount).toBe(2);
    expect(stats.colorCount).toBe(2);
    expect(stats.jumpCount).toBe(1);
    expect(stats.trimCount).toBe(1);
    expect(stats.stopCount).toBe(1);
    expect(stats.maxStitchLengthMm).toBeCloseTo(5);
    expect(stats.averageStitchLengthMm).toBeCloseTo(5);
    expect(stats.threadLengthMm).toBeCloseTo(10);
    expect(stats.travelLengthMm).toBeCloseTo(12);
    expect(stats.tinyBlockCount).toBe(2);
    expect(stats.warnings).toEqual([]);
  });

  it("reports warnings for risky machine output", () => {
    const pattern = makePattern({
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "run", colorIndex: 0 },
            { x: 20, y: 0, kind: "run", colorIndex: 0 },
            ...Array.from({ length: 9 }, (_, i) => ({
              x: i,
              y: 1,
              kind: "jump" as const,
              colorIndex: 0,
            })),
          ],
        },
      ],
      totalStitches: 50001,
    });

    const stats = analyzePattern(pattern);

    expect(stats.warnings.map((warning) => warning.code)).toEqual([
      "long-stitch",
      "many-jumps",
      "high-stitch-count",
    ]);
    expect(stats.warnings.map((warning) => warning.level)).toEqual([
      "warning",
      "warning",
      "danger",
    ]);
  });
});
