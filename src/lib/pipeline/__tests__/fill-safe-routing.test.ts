import { describe, expect, it } from "vitest";
import { routeFillSegmentsSafely } from "../fill";
import type { Shape } from "../types";

function rect(x: number, y: number, width: number, height: number): Shape {
  return {
    outer: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
    holes: [],
  };
}

describe("fill safe routing", () => {
  it("keeps short fill connectors inside one continuous area", () => {
    const stitches = routeFillSegmentsSafely({
      shape: rect(0, 0, 10, 10),
      segments: [
        [[0, 1], [10, 1]],
        [[10, 2], [0, 2]],
      ],
      colorIndex: 0,
      kind: "fill",
      maxStitchMm: 7,
      trimThresholdMm: 8,
    });

    expect(stitches.every((stitch) => stitch.kind === "fill")).toBe(true);
    expect(stitches.length).toBeGreaterThanOrEqual(4);
  });

  it("jumps instead of creating a visible long connector between fill rows", () => {
    const stitches = routeFillSegmentsSafely({
      shape: rect(0, 0, 10, 10),
      segments: [
        [[0, 1], [5, 1]],
        [[5, 5], [0, 5]],
      ],
      colorIndex: 0,
      kind: "fill",
      maxStitchMm: 7,
      trimThresholdMm: 8,
    });

    expect(stitches).toContainEqual({ x: 5, y: 5, kind: "jump", colorIndex: 0 });
    expect(stitches.map((stitch) => stitch.kind)).toEqual(["fill", "fill", "jump", "fill", "fill"]);
  });

  it("jumps instead of stitching across a hole-separated interval", () => {
    const shape: Shape = {
      outer: rect(0, 0, 10, 10).outer,
      holes: [rect(4, 4, 2, 2).outer],
    };
    const stitches = routeFillSegmentsSafely({
      shape,
      segments: [
        [[0, 5], [4, 5]],
        [[6, 5], [10, 5]],
      ],
      colorIndex: 0,
      kind: "fill",
      maxStitchMm: 7,
      trimThresholdMm: 8,
    });

    expect(stitches).toContainEqual({ x: 6, y: 5, kind: "jump", colorIndex: 0 });
    const holeFills = stitches.filter(
      (stitch) => stitch.kind === "fill" && stitch.x > 4 && stitch.x < 6 && stitch.y === 5,
    );
    expect(holeFills).toEqual([]);
  });

  it("reorders hole-split fill rows to reduce unnecessary jumps", () => {
    const shape: Shape = {
      outer: rect(0, 0, 10, 4).outer,
      holes: [rect(4.5, 0.5, 1, 2).outer],
    };
    const stitches = routeFillSegmentsSafely({
      shape,
      segments: [
        [[0, 1], [4.4, 1]],
        [[5.6, 1], [10, 1]],
        [[10, 2], [5.6, 2]],
        [[4.4, 2], [0, 2]],
      ],
      colorIndex: 0,
      kind: "fill",
      maxStitchMm: 7,
      trimThresholdMm: 8,
    });

    expect(stitches.filter((stitch) => stitch.kind === "jump")).toHaveLength(1);
    expect(stitches.filter((stitch) => stitch.kind === "trim")).toHaveLength(0);
  });
});
