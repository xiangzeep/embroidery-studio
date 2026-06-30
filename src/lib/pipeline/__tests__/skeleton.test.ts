import { describe, expect, it } from "vitest";
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

describe("skeletonizeMask", () => {
  it("extracts a single branch with two endpoints from a thin bar mask", () => {
    const mask = makeMask([
      "..........",
      ".########.",
      "..........",
    ]);

    const graph = skeletonizeMask(mask);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.branches).toHaveLength(1);
    expect(graph.branches[0].isLoop).toBe(false);
    expect(graph.branches[0].points.length).toBeGreaterThanOrEqual(6);
  });

  it("extracts a loop branch with no explicit endpoints from a ring mask", () => {
    const mask = makeMask([
      "..........",
      "..#####...",
      "..#...#...",
      "..#...#...",
      "..#####...",
      "..........",
    ]);

    const graph = skeletonizeMask(mask);

    expect(graph.branches).toHaveLength(1);
    expect(graph.branches[0].isLoop).toBe(true);
    expect(graph.branches[0].points.length).toBeGreaterThanOrEqual(8);
    expect(graph.nodes.filter((node) => node.degree === 1)).toHaveLength(0);
  });

  it("merges a clustered skeleton junction into a single node", () => {
    const mask = makeMask([
      "...........",
      ".....#.....",
      ".....#.....",
      ".#########.",
      ".....#.....",
      ".....#.....",
      "...........",
    ]);

    const graph = skeletonizeMask(mask);
    const junctions = graph.nodes.filter((node) => node.degree >= 3);

    expect(junctions).toHaveLength(1);
    expect(graph.branches.length).toBeGreaterThanOrEqual(4);
  });
});
