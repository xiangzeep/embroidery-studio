import { describe, expect, it } from "vitest";

import { compactVectorizeRegionsForTransfer } from "../vectorize-payload";
import type { ColorRegion } from "../vectorize";
import type { Point2D } from "../types";

describe("compactVectorizeRegionsForTransfer", () => {
  it("removes bulky path fields and simplifies shape boundaries before worker transfer", () => {
    const outer = makeNoisyRectangle();
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [12, 34, 56],
      svgPath: "M " + outer.map((point) => point.join(" ")).join(" L ") + " Z",
      shapes: [{ outer, holes: [] }],
      polygons: [outer],
    };

    const compacted = compactVectorizeRegionsForTransfer([region], 0.8);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].svgPath).toBe("");
    expect(compacted[0].polygons).toEqual([]);
    expect(compacted[0].shapes[0].outer.length).toBeLessThan(outer.length);
    expect(compacted[0].shapes[0].outer.length).toBeGreaterThanOrEqual(3);
  });
});

function makeNoisyRectangle(): Point2D[] {
  const points: Point2D[] = [];
  for (let x = 0; x <= 100; x++) points.push([x, 0]);
  for (let y = 1; y <= 80; y++) points.push([100, y]);
  for (let x = 99; x >= 0; x--) points.push([x, 80]);
  for (let y = 79; y >= 1; y--) points.push([0, y]);
  return points;
}
