import { describe, expect, it } from "vitest";
import { optimizePatternCommands, optimizeStitches } from "../command-optimizer";
import type { StitchPattern } from "../types";

describe("command optimizer", () => {
  it("removes zero-distance jumps and trims", () => {
    const optimized = optimizeStitches([
      { x: 0, y: 0, kind: "fill", colorIndex: 0 },
      { x: 0, y: 0, kind: "jump", colorIndex: 0 },
      { x: 0, y: 0, kind: "trim", colorIndex: 0 },
      { x: 1, y: 0, kind: "fill", colorIndex: 0 },
    ]);

    expect(optimized.map((stitch) => stitch.kind)).toEqual(["fill", "fill"]);
  });

  it("merges consecutive jumps to the final target", () => {
    const optimized = optimizeStitches([
      { x: 0, y: 0, kind: "fill", colorIndex: 0 },
      { x: 2, y: 0, kind: "jump", colorIndex: 0 },
      { x: 4, y: 0, kind: "jump", colorIndex: 0 },
      { x: 6, y: 0, kind: "jump", colorIndex: 0 },
      { x: 6, y: 1, kind: "fill", colorIndex: 0 },
    ]);

    expect(optimized).toEqual([
      { x: 0, y: 0, kind: "fill", colorIndex: 0 },
      { x: 6, y: 0, kind: "jump", colorIndex: 0 },
      { x: 6, y: 1, kind: "fill", colorIndex: 0 },
    ]);
  });

  it("splits long jump travel into shorter jump steps", () => {
    const optimized = optimizeStitches([
      { x: 0, y: 0, kind: "fill", colorIndex: 0 },
      { x: 25, y: 0, kind: "jump", colorIndex: 0 },
      { x: 25, y: 1, kind: "fill", colorIndex: 0 },
    ]);

    const jumps = optimized.filter((stitch) => stitch.kind === "jump");
    expect(jumps.length).toBeGreaterThan(1);
    expect(jumps[jumps.length - 1]).toEqual({
      x: 25,
      y: 0,
      kind: "jump",
      colorIndex: 0,
    });
    for (let i = 1; i < optimized.length; i++) {
      if (optimized[i].kind !== "jump") continue;
      const previous = optimized[i - 1];
      expect(Math.hypot(optimized[i].x - previous.x, optimized[i].y - previous.y)).toBeLessThanOrEqual(10);
    }
  });

  it("keeps one trim before a travel jump and removes meaningless trailing trim", () => {
    const optimized = optimizeStitches([
      { x: 0, y: 0, kind: "fill", colorIndex: 0 },
      { x: 0, y: 0, kind: "trim", colorIndex: 0 },
      { x: 10, y: 0, kind: "jump", colorIndex: 0 },
      { x: 10, y: 1, kind: "fill", colorIndex: 0 },
      { x: 10, y: 1, kind: "trim", colorIndex: 0 },
    ]);

    expect(optimized.map((stitch) => stitch.kind)).toEqual(["fill", "trim", "jump", "fill"]);
  });

  it("keeps stop only for real color changes", () => {
    const pattern: StitchPattern = {
      widthMm: 20,
      heightMm: 20,
      totalStitches: 3,
      blocks: [
        {
          colorIndex: 0,
          rgb: [255, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "fill", colorIndex: 0 },
            { x: 0, y: 0, kind: "stop", colorIndex: 0 },
          ],
        },
        {
          colorIndex: 1,
          rgb: [0, 0, 255],
          stitches: [
            { x: 1, y: 0, kind: "fill", colorIndex: 1 },
            { x: 1, y: 0, kind: "stop", colorIndex: 1 },
          ],
        },
      ],
    };

    const optimized = optimizePatternCommands(pattern);

    expect(optimized.blocks[0].stitches.map((stitch) => stitch.kind)).toEqual(["fill", "stop"]);
    expect(optimized.blocks[1].stitches.map((stitch) => stitch.kind)).toEqual(["fill"]);
    expect(optimized.totalStitches).toBe(2);
  });
});
