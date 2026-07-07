import { describe, expect, it } from "vitest";
import { detectClosedLoop, ensureClosedLoop } from "../closed-loop-detector";
import type { Point2D, Shape } from "../types";

describe("closed-loop-detector", () => {
  it("detects component-level loops by relative endpoint gap", () => {
    const points: Point2D[] = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
      [0.35, 0.25],
    ];

    expect(detectClosedLoop(points)).toBe(true);
    expect(ensureClosedLoop(points).at(-1)).toEqual([0, 0]);
  });

  it("uses loop-like shape context when fragmented path endpoints are near the source shape", () => {
    const shape: Shape = {
      outer: [[0, 0], [5, 0], [5, 3], [3, 4], [0, 3], [0, 0]],
      holes: [],
    };
    const points: Point2D[] = [[0, 0], [5, 0], [5, 3], [3, 4], [0.9, 1.2]];

    expect(detectClosedLoop(points, shape)).toBe(true);
  });

  it("does not close clearly open decorative lines", () => {
    const points: Point2D[] = [[0, 0], [4, 0], [8, 0]];

    expect(detectClosedLoop(points)).toBe(false);
  });
});
