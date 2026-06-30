import { describe, expect, test } from "vitest";
import { analyzeStrokeMetrics } from "../stroke-metrics";
import type { Shape } from "../types";

const rect = (w: number, h: number): Shape => ({
  outer: [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ],
  holes: [],
});

describe("analyzeStrokeMetrics", () => {
  test("classifies a long narrow rectangle as stroke-like", () => {
    const metrics = analyzeStrokeMetrics(rect(40, 2));

    expect(metrics.estimatedWidthMm).toBeCloseTo(1.9, 1);
    expect(metrics.estimatedLengthMm).toBeGreaterThan(35);
    expect(metrics.slenderness).toBe(20);
    expect(metrics.isStrokeLike).toBe(true);
  });

  test("does not classify compact square fill as stroke-like", () => {
    const metrics = analyzeStrokeMetrics(rect(10, 10));

    expect(metrics.slenderness).toBe(1);
    expect(metrics.isStrokeLike).toBe(false);
  });

  test("accounts for holes when estimating stroke area", () => {
    const shape: Shape = {
      outer: rect(10, 10).outer,
      holes: [rect(4, 4).outer.map(([x, y]) => [x + 3, y + 3])],
    };

    const metrics = analyzeStrokeMetrics(shape);

    expect(metrics.areaMm2).toBe(84);
    expect(metrics.holeCount).toBe(1);
  });
});
