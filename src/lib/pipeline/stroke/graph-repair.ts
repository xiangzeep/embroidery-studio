import type { Point2D } from "../types";
import type { StrokeGraph, StrokeGraphNode } from "./stroke-types";

const JUNCTION_CLUSTER_MM = 1.0;

export function repairSkeletonGraph(graph: StrokeGraph): StrokeGraph {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const parent = new Map(nodes.map((node) => [node.id, node.id]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].degree < 3 || nodes[j].degree < 3) continue;
      if (distance([nodes[i].x, nodes[i].y], [nodes[j].x, nodes[j].y]) <= JUNCTION_CLUSTER_MM) {
        parent.set(find(parent, nodes[j].id), find(parent, nodes[i].id));
      }
    }
  }

  const groups = new Map<string, StrokeGraphNode[]>();
  for (const node of nodes) {
    const root = find(parent, node.id);
    groups.set(root, (groups.get(root) ?? []).concat(node));
  }

  const remap = new Map<string, string>();
  const repairedNodes: StrokeGraphNode[] = [];
  for (const [root, group] of groups) {
    if (group.length === 1) {
      repairedNodes.push(group[0]);
      remap.set(group[0].id, group[0].id);
      continue;
    }
    const merged: StrokeGraphNode = {
      id: `junction-cluster-${root}`,
      x: group.reduce((sum, node) => sum + node.x, 0) / group.length,
      y: group.reduce((sum, node) => sum + node.y, 0) / group.length,
      degree: Math.max(...group.map((node) => node.degree)),
    };
    repairedNodes.push(merged);
    for (const node of group) remap.set(node.id, merged.id);
  }

  return {
    ...graph,
    nodes: repairedNodes,
    branches: graph.branches.map((branch) => ({
      ...branch,
      startNodeId: branch.startNodeId ? remap.get(branch.startNodeId) ?? branch.startNodeId : null,
      endNodeId: branch.endNodeId ? remap.get(branch.endNodeId) ?? branch.endNodeId : null,
    })),
  };
}

function find(parent: Map<string, string>, id: string): string {
  let current = parent.get(id) ?? id;
  while ((parent.get(current) ?? current) !== current) {
    current = parent.get(current) ?? current;
  }
  return current;
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
