import { describe, expect, it } from "vitest";

import { traceLabelPolygons, vectorizeRasterLabels } from "../raster-vectorize";

describe("traceLabelPolygons", () => {
  it("traces a filled block into one closed polygon", () => {
    const labels = new Uint8Array([
      0, 0, 0,
      0, 0, 0,
    ]);

    const polygons = traceLabelPolygons(labels, 3, 2, 0);

    expect(polygons).toHaveLength(1);
    expect(polygons[0].length).toBeGreaterThanOrEqual(4);
  });

  it("keeps raster rings bounded while preserving the inner hole", () => {
    const labels = new Uint8Array([
      0, 0, 0, 0, 0,
      0, 255, 255, 255, 0,
      0, 255, 255, 255, 0,
      0, 255, 255, 255, 0,
      0, 0, 0, 0, 0,
    ]);

    const regions = vectorizeRasterLabels({
      labels,
      width: 5,
      height: 5,
      palette: [[20, 120, 220]],
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].shapes).toHaveLength(1);
    expect(regions[0].shapes[0].outer.length).toBeGreaterThanOrEqual(4);
    expect(regions[0].shapes[0].holes).toHaveLength(1);
    expect(regions[0].shapes[0].holes[0].length).toBeGreaterThanOrEqual(4);
  });
});
