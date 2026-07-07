import type { Point2D } from "../types";
import type { CleanStrokeGraph, StrokeGraphBranch, StrokePath } from "./stroke-types";
import { dedupeSequential, polylineLength } from "./stroke-cleaner";

export function reconstructStrokePaths(graph: CleanStrokeGraph): StrokePath[] {
  const branches = graph.branches.map((branch) => ({ ...branch, points: branch.points.map(([x, y]) => [x, y] as Point2D) }));
  const byNode = new Map<string, StrokeGraphBranch[]>();
  for (const branch of branches) {
    for (const nodeId of [branch.startNodeId, branch.endNodeId]) {
      if (!nodeId) continue;
      byNode.set(nodeId, (byNode.get(nodeId) ?? []).concat(branch));
    }
  }

  const visited = new Set<string>();
  const paths: StrokePath[] = [];
  const starts = branches
    .filter((branch) => !branch.isLoop && (nodeDegree(graph, branch.startNodeId) <= 1 || nodeDegree(graph, branch.endNodeId) <= 1))
    .concat(branches.filter((branch) => branch.isLoop));

  for (const branch of starts.concat(branches)) {
    if (visited.has(branch.id)) continue;
    const oriented = nodeDegree(graph, branch.startNodeId) <= 1 ? branch : reverseBranch(branch);
    const points = tracePath(oriented, byNode, visited, graph);
    if (points.length < 2) continue;
    paths.push(makeStrokePath(`stroke-${paths.length}`, points, branch.isLoop));
  }

  return paths;
}

function tracePath(
  start: StrokeGraphBranch,
  byNode: Map<string, StrokeGraphBranch[]>,
  visited: Set<string>,
  graph: CleanStrokeGraph,
): Point2D[] {
  let current = start;
  let exitNode = current.endNodeId;
  const points = current.points.map(([x, y]) => [x, y] as Point2D);
  visited.add(current.id);

  while (exitNode && nodeDegree(graph, exitNode) === 2) {
    const next = (byNode.get(exitNode) ?? []).find((branch) => !visited.has(branch.id));
    if (!next) break;
    const oriented = next.startNodeId === exitNode ? next : reverseBranch(next);
    visited.add(oriented.id);
    points.push(...oriented.points.slice(1).map(([x, y]) => [x, y] as Point2D));
    exitNode = oriented.endNodeId;
  }

  return dedupeSequential(points);
}

function reverseBranch(branch: StrokeGraphBranch): StrokeGraphBranch {
  return {
    ...branch,
    points: branch.points.map(([x, y]) => [x, y] as Point2D).reverse(),
    startNodeId: branch.endNodeId,
    endNodeId: branch.startNodeId,
  };
}

function nodeDegree(graph: CleanStrokeGraph, nodeId: string | null): number {
  if (!nodeId) return 0;
  return graph.nodes.find((node) => node.id === nodeId)?.degree ?? 0;
}

function makeStrokePath(id: string, points: Point2D[], closed: boolean): StrokePath {
  return {
    id,
    points,
    closed,
    length: polylineLength(points),
    color: 0,
  };
}
