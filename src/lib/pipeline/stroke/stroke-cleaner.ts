import type { Point2D } from "../types";
import type { CleanStrokeGraph, StrokeGraph, StrokeGraphBranch } from "./stroke-types";
import { repairSkeletonGraph } from "./graph-repair";

const SHORT_NOISE_BRANCH_MM = 2.0;
const MAIN_STROKE_NEAR_MM = 1.5;
const ENDPOINT_BRIDGE_MM = 2.0;
const ENDPOINT_BRIDGE_MIN_COS = Math.cos((45 * Math.PI) / 180);

export function cleanStrokeGraph(graph: StrokeGraph): CleanStrokeGraph {
  const repaired = repairSkeletonGraph(graph);
  const branches = repaired.branches.filter((branch) => !isIsolatedShortEndpointBranch(branch, repaired.branches));
  return {
    ...repaired,
    branches: mergeEndpointGaps(branches, new Map(repaired.nodes.map((node) => [node.id, node.degree]))),
  };
}

function isIsolatedShortEndpointBranch(branch: StrokeGraphBranch, branches: StrokeGraphBranch[]): boolean {
  if (branch.isLoop || polylineLength(branch.points) >= SHORT_NOISE_BRANCH_MM) return false;
  const endpointDegree = Number(Boolean(branch.startNodeId)) + Number(Boolean(branch.endNodeId));
  if (endpointDegree === 0) return true;
  return !branches.some((other) => other.id !== branch.id && minPolylineDistance(branch.points, other.points) < MAIN_STROKE_NEAR_MM);
}

function mergeEndpointGaps(input: StrokeGraphBranch[], nodeDegrees: Map<string, number>): StrokeGraphBranch[] {
  const branches = input.map((branch) => ({ ...branch, points: clonePoints(branch.points) }));
  let changed = true;
  while (changed) {
    changed = false;
    let best: { a: number; b: number; gap: number; branch: StrokeGraphBranch } | null = null;
    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        const candidate = bestBranchMerge(branches[i], branches[j], nodeDegrees);
        if (!candidate) continue;
        if (!best || candidate.gap < best.gap) best = { a: i, b: j, ...candidate };
      }
    }
    if (best) {
      branches[best.a] = best.branch;
      branches.splice(best.b, 1);
      changed = true;
    }
  }
  return branches;
}

function bestBranchMerge(
  a: StrokeGraphBranch,
  b: StrokeGraphBranch,
  nodeDegrees: Map<string, number>,
): { gap: number; branch: StrokeGraphBranch } | null {
  if (a.isLoop || b.isLoop) return null;
  const variants: Array<[StrokeGraphBranch, StrokeGraphBranch]> = [
    [a, b],
    [a, reverseBranch(b)],
    [reverseBranch(a), b],
    [reverseBranch(a), reverseBranch(b)],
  ];
  let best: { gap: number; branch: StrokeGraphBranch } | null = null;
  for (const [left, right] of variants) {
    if (nodeDegree(nodeDegrees, left.endNodeId) >= 3 || nodeDegree(nodeDegrees, right.startNodeId) >= 3) continue;
    const gap = distance(left.points[left.points.length - 1], right.points[0]);
    if (gap > ENDPOINT_BRIDGE_MM || !tangentsCompatible(left.points, right.points)) continue;
    const merged: StrokeGraphBranch = {
      id: `${left.id}+${right.id}`,
      points: dedupeSequential(left.points.concat(gap > 0.2 ? [midpoint(left.points.at(-1)!, right.points[0])] : [], right.points)),
      isLoop: false,
      startNodeId: left.startNodeId,
      endNodeId: right.endNodeId,
    };
    if (!best || gap < best.gap) best = { gap, branch: merged };
  }
  return best;
}

function nodeDegree(nodeDegrees: Map<string, number>, nodeId: string | null): number {
  if (!nodeId) return 1;
  return nodeDegrees.get(nodeId) ?? 1;
}

function reverseBranch(branch: StrokeGraphBranch): StrokeGraphBranch {
  return {
    ...branch,
    points: clonePoints(branch.points).reverse(),
    startNodeId: branch.endNodeId,
    endNodeId: branch.startNodeId,
  };
}

function tangentsCompatible(left: Point2D[], right: Point2D[]): boolean {
  if (left.length < 2 || right.length < 2) return true;
  const bridge: Point2D = [right[0][0] - left.at(-1)![0], right[0][1] - left.at(-1)![1]];
  return normalizedDot([left.at(-1)![0] - left.at(-2)![0], left.at(-1)![1] - left.at(-2)![1]], bridge) >= ENDPOINT_BRIDGE_MIN_COS &&
    normalizedDot(bridge, [right[1][0] - right[0][0], right[1][1] - right[0][1]]) >= ENDPOINT_BRIDGE_MIN_COS;
}

function minPolylineDistance(a: Point2D[], b: Point2D[]): number {
  let best = Infinity;
  for (const point of a) {
    for (let i = 1; i < b.length; i++) best = Math.min(best, pointToSegmentDistance(point, b[i - 1], b[i]));
  }
  for (const point of b) {
    for (let i = 1; i < a.length; i++) best = Math.min(best, pointToSegmentDistance(point, a[i - 1], a[i]));
  }
  return best;
}

function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return distance(p, [a[0] + dx * t, a[1] + dy * t]);
}

export function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

export function dedupeSequential(points: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const point of points) {
    if (out.length > 0 && distance(out.at(-1)!, point) <= 1e-6) continue;
    out.push([point[0], point[1]]);
  }
  return out;
}

function normalizedDot(a: Point2D, b: Point2D): number {
  const al = Math.hypot(a[0], a[1]);
  const bl = Math.hypot(b[0], b[1]);
  if (al <= 1e-6 || bl <= 1e-6) return 1;
  return (a[0] * b[0] + a[1] * b[1]) / (al * bl);
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function clonePoints(points: Point2D[]): Point2D[] {
  return points.map(([x, y]) => [x, y]);
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
