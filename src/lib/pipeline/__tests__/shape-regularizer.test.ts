import { describe, expect, it } from "vitest";
import { regularizeShapeForStitch } from "../shape-regularizer";
import type { Shape } from "../types";

describe("regularizeShapeForStitch", () => {
  it("smooths jagged fill polygons more strongly than run polygons", () => {
    const jagged: Shape = {
      outer: [
        [0, 0], [2, 0.25], [4, 0], [6, 0.35], [8, 0],
        [8.2, 2], [8, 4], [8.25, 6], [8, 8],
        [6, 8.2], [4, 8], [2, 8.25], [0, 8],
        [-0.2, 6], [0, 4], [-0.25, 2],
      ],
      holes: [],
    };

    const run = regularizeShapeForStitch(jagged, "run");
    const fill = regularizeShapeForStitch(jagged, "fill");

    expect(fill.outer.length).toBeGreaterThan(run.outer.length);
    expect(maxTurn(fill.outer)).toBeLessThan(maxTurn(run.outer));
    expect(isClosed(fill.outer)).toBe(true);
  });

  it("regularizes compact circular fill shapes into an ellipse polygon", () => {
    const noisyCircle: Shape = {
      outer: Array.from({ length: 40 }, (_, index) => {
        const angle = (index / 40) * Math.PI * 2;
        const radius = index % 2 === 0 ? 4.8 : 5.2;
        return [10 + Math.cos(angle) * radius, 10 + Math.sin(angle) * radius] as [number, number];
      }),
      holes: [],
    };

    const fill = regularizeShapeForStitch(noisyCircle, "fill");

    expect(fill.outer.length).toBe(97);
    expect(isClosed(fill.outer)).toBe(true);
    expect(maxRadiusDeviation(fill.outer)).toBeLessThan(0.4);
  });
});

function isClosed(points: Array<[number, number]>): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-6;
}

function maxTurn(points: Array<[number, number]>): number {
  const loop = points.slice(0, -1);
  let max = 0;
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const current = loop[i];
    const next = loop[(i + 1) % loop.length];
    const ax = current[0] - prev[0];
    const ay = current[1] - prev[1];
    const bx = next[0] - current[0];
    const by = next[1] - current[1];
    const al = Math.hypot(ax, ay);
    const bl = Math.hypot(bx, by);
    if (al <= 1e-6 || bl <= 1e-6) continue;
    const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
    max = Math.max(max, Math.acos(dot));
  }
  return max;
}

function maxRadiusDeviation(points: Array<[number, number]>): number {
  const loop = points.slice(0, -1);
  const cx = loop.reduce((sum, [x]) => sum + x, 0) / loop.length;
  const cy = loop.reduce((sum, [, y]) => sum + y, 0) / loop.length;
  const radii = loop.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const avg = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  return Math.max(...radii.map((radius) => Math.abs(radius - avg)));
}
