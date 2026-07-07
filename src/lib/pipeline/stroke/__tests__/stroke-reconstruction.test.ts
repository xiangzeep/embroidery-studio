import { describe, expect, it } from "vitest";
import { cleanStrokeGraph } from "../stroke-cleaner";
import { repairSkeletonGraph } from "../graph-repair";
import { reconstructStrokePaths } from "../stroke-reconstructor";
import type { CleanStrokeGraph, StrokeGraph } from "../stroke-types";

describe("stroke reconstruction pipeline", () => {
  it("removes isolated short endpoint branches but preserves nearby bridge branches", () => {
    const graph: StrokeGraph = {
      width: 100,
      height: 40,
      nodes: [
        { id: "a", x: 0, y: 0, degree: 1 },
        { id: "b", x: 6, y: 0, degree: 2 },
        { id: "c", x: 12, y: 0, degree: 1 },
        { id: "noise-a", x: 30, y: 10, degree: 1 },
        { id: "noise-b", x: 31, y: 10, degree: 1 },
      ],
      branches: [
        { id: "main-a", points: [[0, 0], [6, 0]], isLoop: false, startNodeId: "a", endNodeId: "b" },
        { id: "main-b", points: [[6, 0], [12, 0]], isLoop: false, startNodeId: "b", endNodeId: "c" },
        { id: "near-bridge", points: [[6, 0.4], [7, 0.4]], isLoop: false, startNodeId: "b", endNodeId: null },
        { id: "noise", points: [[30, 10], [31, 10]], isLoop: false, startNodeId: "noise-a", endNodeId: "noise-b" },
      ],
    };

    const cleaned = cleanStrokeGraph(graph);

    expect(cleaned.branches.map((branch) => branch.id)).toContain("near-bridge");
    expect(cleaned.branches.map((branch) => branch.id)).not.toContain("noise");
  });

  it("bridges aligned endpoint gaps into one branch", () => {
    const graph: StrokeGraph = {
      width: 100,
      height: 40,
      nodes: [
        { id: "a", x: 0, y: 0, degree: 1 },
        { id: "b", x: 5, y: 0, degree: 1 },
        { id: "c", x: 6.7, y: 0.1, degree: 1 },
        { id: "d", x: 12, y: 0.1, degree: 1 },
      ],
      branches: [
        { id: "left", points: [[0, 0], [5, 0]], isLoop: false, startNodeId: "a", endNodeId: "b" },
        { id: "right", points: [[6.7, 0.1], [12, 0.1]], isLoop: false, startNodeId: "c", endNodeId: "d" },
      ],
    };

    const cleaned = cleanStrokeGraph(graph);

    expect(cleaned.branches).toHaveLength(1);
    expect(cleaned.branches[0].points[0]).toEqual([0, 0]);
    expect(cleaned.branches[0].points.at(-1)).toEqual([12, 0.1]);
  });

  it("merges junction clusters within one millimeter", () => {
    const graph: StrokeGraph = {
      width: 100,
      height: 40,
      nodes: [
        { id: "j1", x: 10, y: 10, degree: 3 },
        { id: "j2", x: 10.5, y: 10.2, degree: 3 },
        { id: "a", x: 0, y: 10, degree: 1 },
        { id: "b", x: 20, y: 10, degree: 1 },
      ],
      branches: [
        { id: "left", points: [[0, 10], [10, 10]], isLoop: false, startNodeId: "a", endNodeId: "j1" },
        { id: "right", points: [[10.5, 10.2], [20, 10]], isLoop: false, startNodeId: "j2", endNodeId: "b" },
      ],
    };

    const repaired = repairSkeletonGraph(graph);
    const junctions = repaired.nodes.filter((node) => node.degree >= 3);

    expect(junctions).toHaveLength(1);
    expect(new Set(repaired.branches.flatMap((branch) => [branch.startNodeId, branch.endNodeId]))).toContain(junctions[0].id);
  });

  it("reconstructs chained edges into one continuous stroke path", () => {
    const graph: CleanStrokeGraph = {
      width: 100,
      height: 40,
      nodes: [
        { id: "a", x: 0, y: 0, degree: 1 },
        { id: "b", x: 4, y: 0, degree: 2 },
        { id: "c", x: 8, y: 0, degree: 2 },
        { id: "d", x: 12, y: 0, degree: 1 },
      ],
      branches: [
        { id: "ab", points: [[0, 0], [4, 0]], isLoop: false, startNodeId: "a", endNodeId: "b" },
        { id: "bc", points: [[4, 0], [8, 0]], isLoop: false, startNodeId: "b", endNodeId: "c" },
        { id: "cd", points: [[8, 0], [12, 0]], isLoop: false, startNodeId: "c", endNodeId: "d" },
      ],
    };

    const paths = reconstructStrokePaths(graph);

    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(false);
    expect(paths[0].points).toEqual([[0, 0], [4, 0], [8, 0], [12, 0]]);
  });
});
