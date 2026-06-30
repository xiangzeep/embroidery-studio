import { describe, expect, it } from "vitest";
import { computeDistanceMap, measureSkeletonWidths } from "../distance-map";
import { skeletonizeMask } from "../skeleton";
import type { BinaryMask } from "../types";

function makeMask(rows: string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      data[y * width + x] = row[x] === "#" ? 1 : 0;
    }
  }
  return { data, width, height };
}

describe("distance map and width sampling", () => {
  it("measures consistent centerline width samples for a uniform bar", () => {
    const mask = makeMask([
      "...........",
      ".#########.",
      ".#########.",
      ".#########.",
      "...........",
    ]);

    const graph = skeletonizeMask(mask);
    const distanceMap = computeDistanceMap(mask);
    const samples = measureSkeletonWidths(graph, distanceMap, 0.5);

    expect(samples.length).toBeGreaterThanOrEqual(3);
    const maxWidth = Math.max(...samples.map((sample) => sample.widthMm));
    const minWidth = Math.min(...samples.map((sample) => sample.widthMm));

    expect(maxWidth).toBeGreaterThanOrEqual(2);
    expect(minWidth).toBeGreaterThanOrEqual(2);
    expect(maxWidth - minWidth).toBeLessThanOrEqual(0.01);
  });
});
