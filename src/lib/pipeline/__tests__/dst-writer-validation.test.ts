import { describe, expect, it } from "vitest";
import { analyzeDstBytes } from "../dst-analyzer";
import { buildStitchCommands, writeDstBytes } from "../dst-writer";
import { optimizePatternCommands } from "../command-optimizer";
import type { StitchPattern } from "../types";

describe("DST writer validation", () => {
  it("builds an explicit command stream before DST encoding", () => {
    const pattern: StitchPattern = {
      widthMm: 20,
      heightMm: 20,
      totalStitches: 2,
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 1, y: 0, kind: "run", colorIndex: 0 },
            { x: 5, y: 0, kind: "jump", colorIndex: 0 },
            { x: 5, y: 0, kind: "stop", colorIndex: 0 },
            { x: 6, y: 0, kind: "fill", colorIndex: 1 },
          ],
        },
      ],
    };

    expect(buildStitchCommands(pattern).map((command) => command.type)).toEqual([
      "MOVE",
      "STITCH",
      "JUMP",
      "COLOR_CHANGE",
      "STITCH",
    ]);
  });

  it("does not reintroduce zero-distance function codes after command optimization", () => {
    const pattern: StitchPattern = {
      widthMm: 20,
      heightMm: 20,
      totalStitches: 2,
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "fill", colorIndex: 0 },
            { x: 0, y: 0, kind: "jump", colorIndex: 0 },
            { x: 0, y: 0, kind: "trim", colorIndex: 0 },
            { x: 1, y: 0, kind: "fill", colorIndex: 0 },
          ],
        },
      ],
    };

    const bytes = writeDstBytes(optimizePatternCommands(pattern));
    const analysis = analyzeDstBytes(bytes);

    expect(analysis.stitchCount).toBe(2);
    expect(analysis.jumpCount).toBe(0);
    expect(analysis.stopCount).toBe(0);
    expect(analysis.endCount).toBe(1);
  });

  it("splits long jump moves only into jump records", () => {
    const pattern: StitchPattern = {
      widthMm: 300,
      heightMm: 20,
      totalStitches: 2,
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "fill", colorIndex: 0 },
            { x: 26.4, y: 0, kind: "jump", colorIndex: 0 },
            { x: 26.4, y: 1, kind: "fill", colorIndex: 0 },
          ],
        },
      ],
    };

    const bytes = writeDstBytes(optimizePatternCommands(pattern));
    const analysis = analyzeDstBytes(bytes);

    expect(analysis.stitchCount).toBe(2);
    expect(analysis.jumpCount).toBe(3);
    expect(analysis.stopCount).toBe(0);
    expect(analysis.longestJumpMm).toBeLessThanOrEqual(12.1);
  });

  it("splits diagonal jump records by actual movement length", () => {
    const pattern: StitchPattern = {
      widthMm: 30,
      heightMm: 30,
      totalStitches: 2,
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "fill", colorIndex: 0 },
            { x: 12.1, y: 12.1, kind: "jump", colorIndex: 0 },
            { x: 12.1, y: 13, kind: "fill", colorIndex: 0 },
          ],
        },
      ],
    };

    const bytes = writeDstBytes(pattern);
    const analysis = analyzeDstBytes(bytes);

    expect(analysis.jumpCount).toBeGreaterThan(1);
    expect(analysis.longestJumpMm).toBeLessThanOrEqual(10);
  });
});
