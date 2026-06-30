import { describe, expect, it } from "vitest";
import { simplifyPolygon, simplifyShapeBoundary } from "../region-merge";
import type { Shape } from "../types";

describe("simplifyPolygon", () => {
  it("removes low-amplitude jagged points while preserving the main slanted edge", () => {
    const jagged: Array<[number, number]> = [
      [0, 0],
      [10, 0.4],
      [20, -0.3],
      [30, 0.2],
      [40, 0],
      [40, 20],
      [0, 20],
    ];

    const simplified = simplifyPolygon(jagged, 0.75);

    expect(simplified.length).toBeLessThan(jagged.length);
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified).toContainEqual([40, 0]);
  });

  it("keeps rectangular polygons stable", () => {
    const rect: Array<[number, number]> = [[0, 0], [20, 0], [20, 10], [0, 10]];

    expect(simplifyPolygon(rect, 0.75)).toEqual(rect);
  });
});

describe("simplifyShapeBoundary", () => {
  it("simplifies outer and hole boundaries", () => {
    const shape: Shape = {
      outer: [[0, 0], [10, 0.2], [20, 0], [20, 20], [0, 20]],
      holes: [[[5, 5], [8, 5.2], [11, 5], [11, 11], [5, 11]]],
    };

    const simplified = simplifyShapeBoundary(shape, 0.5);

    expect(simplified.outer.length).toBeLessThan(shape.outer.length);
    expect(simplified.holes[0].length).toBeLessThan(shape.holes[0].length);
  });
});
