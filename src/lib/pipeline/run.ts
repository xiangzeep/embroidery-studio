// English note.
//
// English note.
// English note.
// English note.
// English note.
//
// English note.
// English note.
// English note.
//
// English note.

import { skeletonizeMask } from "./skeleton";
import { centerRunUnderlay } from "./underlay";
import { __internal as underlayInternal } from "./underlay";
import { extractRails } from "./satin";
import type { Point2D, Shape, SkeletonBranch, SkeletonGraph } from "./types";

const MIN_RAIL_MIDLINE_AREA_MM2 = 0.25;
const SKELETON_RUN_PX_PER_MM = 10;
const SKELETON_NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],            [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
export function medialAxisRun(shape: Shape, stitchLenMm: number): Point2D[] {
  const routed = branchAwareSkeletonRun(shape, stitchLenMm);
  if (routed.length >= 2) return routed;
  const skeleton = centerRunUnderlay(shape, stitchLenMm);
  if (skeleton.length >= 2) return finalizeRunPath(skeleton, shape);
  const rail = railMidlineRun(shape, stitchLenMm);
  return rail.length >= 2 ? finalizeRunPath(rail, shape) : rail;
}

function branchAwareSkeletonRun(shape: Shape, stitchLenMm: number): Point2D[] {
  if (stitchLenMm <= 0 || shape.outer.length < 3) return [];
  if (Math.abs(polygonArea(shape.outer)) < MIN_RAIL_MIDLINE_AREA_MM2) return [];

  const raster = underlayInternal.rasterizeShapeToMask(shape, SKELETON_RUN_PX_PER_MM);
  const thin = underlayInternal.thinMaskZhangSuen(raster.mask, raster.width, raster.height);
  const graph = skeletonizeMask({
    data: raster.mask,
    width: raster.width,
    height: raster.height,
  });
  const sampled = routeSkeletonGraphBranches(graph, raster, stitchLenMm, shape);
  if (sampled.length < 2) return [];

  return shouldExtendBranchAwarePath(shape, thin, raster.width, raster.height)
    ? extendOpenPathToShape(sampled, shape)
    : sampled;
}

function railMidlineRun(shape: Shape, stitchLenMm: number): Point2D[] {
  if (stitchLenMm <= 0 || shape.outer.length < 3 || shape.holes.length > 0) {
    return [];
  }
  if (Math.abs(polygonArea(shape.outer)) < MIN_RAIL_MIDLINE_AREA_MM2) return [];

  const rails = extractRails(shape);
  if (rails.left.length < 2 || rails.right.length < 2) return [];

  const left = stripClosingDuplicate(rails.left);
  const right = stripClosingDuplicate(rails.right);
  if (left.length < 2 || right.length < 2) return [];

  const leftLengths = cumulativeLengths(left);
  const rightLengths = cumulativeLengths(right);
  const total = Math.max(leftLengths.total, rightLengths.total);
  if (total <= 1e-6) return [];

  const sampleCount = Math.max(2, Math.ceil(total / stitchLenMm));
  const midline: Point2D[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const a = arcLengthSample(left, leftLengths.lens, leftLengths.total, t);
    const b = arcLengthSample(right, rightLengths.lens, rightLengths.total, t);
    midline.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return dedupeSequential(midline);
}

function stripClosingDuplicate(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first[0] - last[0]) <= 1e-6 && Math.abs(first[1] - last[1]) <= 1e-6) {
    return points.slice(0, -1);
  }
  return points.slice();
}

function cumulativeLengths(points: Point2D[]): { lens: number[]; total: number } {
  const lens = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(total);
  }
  return { lens, total };
}

function arcLengthSample(
  points: Point2D[],
  lengths: number[],
  total: number,
  t: number,
): Point2D {
  if (points.length === 0) return [0, 0];
  if (points.length === 1 || total <= 1e-6) return [points[0][0], points[0][1]];

  const target = total * clamp01(t);
  let hi = 1;
  while (hi < lengths.length && lengths[hi] < target) hi++;
  if (hi >= lengths.length) {
    const last = points[points.length - 1];
    return [last[0], last[1]];
  }
  const lo = hi - 1;
  const start = points[lo];
  const end = points[hi];
  const span = lengths[hi] - lengths[lo];
  if (span <= 1e-6) return [start[0], start[1]];
  const localT = (target - lengths[lo]) / span;
  return [
    start[0] + (end[0] - start[0]) * localT,
    start[1] + (end[1] - start[1]) * localT,
  ];
}

function dedupeSequential(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points;
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const next = points[i];
    if (Math.abs(prev[0] - next[0]) <= 1e-6 && Math.abs(prev[1] - next[1]) <= 1e-6) {
      continue;
    }
    out.push(next);
  }
  return out;
}

function finalizeRunPath(points: Point2D[], shape: Shape): Point2D[] {
  return extendOpenPathToShape(dedupeSequential(points), shape);
}

function shouldExtendBranchAwarePath(
  shape: Shape,
  skel: Uint8Array,
  width: number,
  height: number,
): boolean {
  if (shape.holes.length === 0) return true;
  let leafCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skel[y * width + x] !== 1) continue;
      if (activeSkeletonNeighbors(skel, width, height, x, y).length <= 1) {
        leafCount++;
        if (leafCount > 0) return true;
      }
    }
  }
  return false;
}

function resampleOpenLine(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 2 || stitchLenMm <= 0) {
    return line.length > 0 ? [[line[0][0], line[0][1]]] : [];
  }
  let totalLen = 0;
  for (let i = 1; i < line.length; i++) {
    totalLen += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  if (totalLen < stitchLenMm) {
    return [
      [line[0][0], line[0][1]],
      [line[line.length - 1][0], line[line.length - 1][1]],
    ];
  }

  const count = Math.max(2, Math.round(totalLen / stitchLenMm) + 1);
  const step = totalLen / (count - 1);
  const out: Point2D[] = [];
  let cursor = 0;
  let edgeIdx = 0;
  let edgeStart = line[0];
  let edgeEnd = line[1];
  let edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);

  for (let k = 0; k < count; k++) {
    const target = step * k;
    while (cursor + edgeLen < target && edgeIdx < line.length - 2) {
      cursor += edgeLen;
      edgeIdx += 1;
      edgeStart = line[edgeIdx];
      edgeEnd = line[edgeIdx + 1];
      edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
    }
    const t = edgeLen === 0 ? 0 : Math.min(1, (target - cursor) / edgeLen);
    out.push([
      edgeStart[0] + (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] + (edgeEnd[1] - edgeStart[1]) * t,
    ]);
  }

  return dedupeSequential(out);
}

function prepareRunPolyline(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 3) return line.map(([x, y]) => [x, y]);

  const toleranceMm = clamp(stitchLenMm * 0.08, 0.1, 0.25);
  const simplified = simplifyRdp(line, toleranceMm);
  const smoothingIterations = simplified.length >= 6 ? 2 : 1;
  const smoothed = chaikinSmoothOpenLine(simplified, smoothingIterations);
  return dedupeSequential(smoothed);
}

function resampleAdaptiveOpenLine(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 2 || stitchLenMm <= 0) return resampleOpenLine(line, stitchLenMm);

  const minStep = clamp(stitchLenMm * 0.7, 1.2, 1.6);
  const curveStep = clamp(stitchLenMm, 1.8, 2.2);
  const maxStep = clamp(stitchLenMm * 1.15, 2.3, 2.8);
  const out: Point2D[] = [[line[0][0], line[0][1]]];
  let distSinceLast = 0;

  for (let i = 1; i < line.length; i++) {
    let start: Point2D = [line[i - 1][0], line[i - 1][1]];
    const end = line[i];
    let segLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (segLen <= 1e-6) continue;

    while (segLen > 1e-6) {
      const stepTarget = desiredRunStep(line, i - 1, minStep, curveStep, maxStep);
      if (distSinceLast + segLen < stepTarget - 1e-6) {
        distSinceLast += segLen;
        break;
      }

      const needed = Math.max(stepTarget - distSinceLast, 0);
      const t = segLen <= 1e-6 ? 1 : needed / segLen;
      const placed: Point2D = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
      out.push(placed);
      start = placed;
      segLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
      distSinceLast = 0;
    }
  }

  const last = line[line.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1e-6) {
    out.push([last[0], last[1]]);
  }

  return dedupeSequential(out);
}

function desiredRunStep(
  line: Point2D[],
  segmentStartIndex: number,
  minStep: number,
  curveStep: number,
  maxStep: number,
): number {
  const turn = localTurnAngle(line, Math.min(segmentStartIndex + 1, line.length - 2));
  if (turn >= Math.PI * 0.45) return minStep;
  if (turn >= Math.PI * 0.18) {
    const t = (turn - Math.PI * 0.18) / (Math.PI * 0.27);
    return curveStep + (minStep - curveStep) * clamp01(t);
  }
  const t = clamp01(turn / (Math.PI * 0.18));
  return maxStep + (curveStep - maxStep) * t;
}

function localTurnAngle(line: Point2D[], index: number): number {
  if (index <= 0 || index >= line.length - 1) return 0;
  const prev = line[index - 1];
  const current = line[index];
  const next = line[index + 1];
  const ax = current[0] - prev[0];
  const ay = current[1] - prev[1];
  const bx = next[0] - current[0];
  const by = next[1] - current[1];
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(bx, by);
  if (al <= 1e-6 || bl <= 1e-6) return 0;
  const dot = clamp((ax * bx + ay * by) / (al * bl), -1, 1);
  return Math.acos(dot);
}

function simplifyRdp(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2 || epsilon <= 0) return points.map(([x, y]) => [x, y]);

  let maxDistance = 0;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointToSegmentDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= epsilon || splitIndex === -1) {
    return [
      [start[0], start[1]],
      [end[0], end[1]],
    ];
  }

  const left = simplifyRdp(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function pointToSegmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = clamp(((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / abLen2, 0, 1);
  const projX = a[0] + abx * t;
  const projY = a[1] + aby * t;
  return Math.hypot(point[0] - projX, point[1] - projY);
}

function chaikinSmoothOpenLine(points: Point2D[], iterations: number): Point2D[] {
  let current = points.map(([x, y]) => [x, y] as Point2D);
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;
    const next: Point2D[] = [[current[0][0], current[0][1]]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      const q: Point2D = [
        a[0] * 0.75 + b[0] * 0.25,
        a[1] * 0.75 + b[1] * 0.25,
      ];
      const r: Point2D = [
        a[0] * 0.25 + b[0] * 0.75,
        a[1] * 0.25 + b[1] * 0.75,
      ];
      next.push(q, r);
    }
    next.push([current[current.length - 1][0], current[current.length - 1][1]]);
    current = dedupeSequential(next);
  }
  return current;
}

function extendOpenPathToShape(points: Point2D[], shape: Shape): Point2D[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const endGap = Math.hypot(first[0] - last[0], first[1] - last[1]);
  if (endGap <= 1e-3 || isLoopLikeOpenPath(points, endGap)) return points;

  const extended = points.map(([x, y]) => [x, y] as Point2D);
  extended[0] = extendEndpointTowardBoundary(points[0], points[1], shape);
  extended[extended.length - 1] = extendEndpointTowardBoundary(
    points[points.length - 1],
    points[points.length - 2],
    shape,
  );
  return extended;
}

function isLoopLikeOpenPath(points: Point2D[], endGap: number): boolean {
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    totalLength += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }
  return endGap <= 1.2 || (totalLength > 0 && endGap / totalLength <= 0.08);
}

function extendEndpointTowardBoundary(
  endpoint: Point2D,
  neighbor: Point2D,
  shape: Shape,
): Point2D {
  const dx = endpoint[0] - neighbor[0];
  const dy = endpoint[1] - neighbor[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-6) return [endpoint[0], endpoint[1]];

  const dir: Point2D = [dx / length, dy / length];
  const stepMm = 0.05;
  const maxSteps = 240;
  let best: Point2D = [endpoint[0], endpoint[1]];

  for (let i = 1; i <= maxSteps; i++) {
    const candidate: Point2D = [
      endpoint[0] + dir[0] * stepMm * i,
      endpoint[1] + dir[1] * stepMm * i,
    ];
    if (!pointInShape(shape, candidate)) break;
    best = candidate;
  }

  return best;
}

type RoutedAdj = {
  branch: SkeletonBranch;
  nextNodeId: string;
  length: number;
};

type SkeletonRasterInfo = {
  offsetX: number;
  offsetY: number;
};

function routeSkeletonGraphBranches(
  graph: SkeletonGraph,
  raster: SkeletonRasterInfo,
  stitchLenMm: number,
  shape: Shape,
): Point2D[] {
  if (graph.branches.length === 0) return [];

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const prepared = new Map<string, Point2D[]>();
  for (const branch of graph.branches) {
    const line = prepareSkeletonBranch(branch, raster, stitchLenMm, shape, nodeMap);
    if (line.length >= 2) prepared.set(branch.id, line);
  }
  if (prepared.size === 0) return [];

  if (graph.branches.length === 1) {
    const only = prepared.get(graph.branches[0].id);
    return only ? only.map(([x, y]) => [x, y]) : [];
  }

  const adjacency = buildSkeletonAdjacency(graph);
  const visitedBranches = new Set<string>();
  const routed: Point2D[] = [];
  const startNodes = graph.nodes
    .slice()
    .sort((a, b) => nodeStartRank(a) - nodeStartRank(b) || a.y - b.y || a.x - b.x);

  const visitNode = (nodeId: string): void => {
    const edges = (adjacency.get(nodeId) ?? [])
      .filter((edge) => !visitedBranches.has(edge.branch.id))
      .sort((a, b) => {
        const an = nodeMap.get(a.nextNodeId);
        const bn = nodeMap.get(b.nextNodeId);
        return (an?.y ?? 0) - (bn?.y ?? 0) || (an?.x ?? 0) - (bn?.x ?? 0) || a.length - b.length;
      });

    for (const edge of edges) {
      if (visitedBranches.has(edge.branch.id)) continue;
      const forward = orientPreparedBranch(edge.branch, nodeId, prepared);
      if (forward.length < 2) continue;
      visitedBranches.add(edge.branch.id);
      appendPoints(routed, forward);
      visitNode(edge.nextNodeId);
      appendPoints(routed, forward.slice().reverse());
    }
  };

  for (const node of startNodes) {
    if ((adjacency.get(node.id) ?? []).some((edge) => !visitedBranches.has(edge.branch.id))) {
      visitNode(node.id);
    }
  }

  for (const branch of graph.branches) {
    if (visitedBranches.has(branch.id)) continue;
    const line = prepared.get(branch.id);
    if (!line || line.length < 2) continue;
    visitedBranches.add(branch.id);
    appendPoints(routed, line);
  }

  return dedupeSequential(routed);
}

function prepareSkeletonBranch(
  branch: SkeletonBranch,
  raster: SkeletonRasterInfo,
  stitchLenMm: number,
  shape: Shape,
  nodeMap: Map<string, { degree: number }>,
): Point2D[] {
  const points = branch.points.map(([px, py]) => pixelToMm(px, py, raster));
  if (branch.isLoop && points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
      points.push([first[0], first[1]]);
    }
  } else if (points.length >= 2) {
    const startNode = branch.startNodeId ? nodeMap.get(branch.startNodeId) : undefined;
    const endNode = branch.endNodeId ? nodeMap.get(branch.endNodeId) : undefined;
    if (startNode && startNode.degree <= 1) {
      points[0] = extendEndpointTowardBoundary(points[0], points[1], shape);
    }
    if (endNode && endNode.degree <= 1) {
      const lastIndex = points.length - 1;
      points[lastIndex] = extendEndpointTowardBoundary(points[lastIndex], points[lastIndex - 1], shape);
    }
  }
  return processRunPolyline(points, stitchLenMm);
}

function processRunPolyline(line: Point2D[], stitchLenMm: number): Point2D[] {
  if (line.length < 2) return line.map(([x, y]) => [x, y]);
  const prepared = prepareRunPolyline(dedupeSequential(line), stitchLenMm);
  return resampleAdaptiveOpenLine(prepared, stitchLenMm);
}

function pixelToMm(px: number, py: number, raster: SkeletonRasterInfo): Point2D {
  return [
    raster.offsetX + (px + 0.5) / SKELETON_RUN_PX_PER_MM,
    raster.offsetY + (py + 0.5) / SKELETON_RUN_PX_PER_MM,
  ];
}

function nodeStartRank(node: { degree: number }): number {
  if (node.degree <= 1) return 0;
  return 1;
}

function orientPreparedBranch(
  branch: SkeletonBranch,
  fromNodeId: string,
  prepared: Map<string, Point2D[]>,
): Point2D[] {
  const points = prepared.get(branch.id) ?? [];
  if (branch.startNodeId === fromNodeId) return points.map(([x, y]) => [x, y]);
  return points.slice().reverse().map(([x, y]) => [x, y]);
}

function buildSkeletonAdjacency(graph: SkeletonGraph): Map<string, RoutedAdj[]> {
  const adjacency = new Map<string, RoutedAdj[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const branch of graph.branches) {
    if (!branch.startNodeId || !branch.endNodeId) continue;
    const length = branchPixelLength(branch);
    adjacency.get(branch.startNodeId)?.push({
      branch,
      nextNodeId: branch.endNodeId,
      length,
    });
    adjacency.get(branch.endNodeId)?.push({
      branch,
      nextNodeId: branch.startNodeId,
      length,
    });
  }
  return adjacency;
}

function appendPoints(target: Point2D[], points: Point2D[]): void {
  for (const point of points) {
    const prev = target[target.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    target.push([point[0], point[1]]);
  }
}

function activeSkeletonNeighbors(
  skel: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): Array<[number, number]> {
  const neighbors: Array<[number, number]> = [];
  for (const [dx, dy] of SKELETON_NEIGHBOR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (skel[ny * width + nx] !== 1) continue;
    neighbors.push([nx, ny]);
  }
  return neighbors;
}

function pointInShape(shape: Shape, point: Point2D): boolean {
  if (!pointInPolygonInclusive(shape.outer, point)) return false;
  return !shape.holes.some((hole) => pointInPolygonInclusive(hole, point));
}

function pointInPolygonInclusive(poly: Point2D[], point: Point2D): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    if (pointOnSegment(poly[i], poly[(i + 1) % poly.length], point)) return true;
  }

  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > py !== yj > py;
    if (!crosses) continue;
    const xAtY = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < xAtY) inside = !inside;
  }
  return inside;
}

function pointOnSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  if (dot < -1e-7) return false;
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= lenSq + 1e-7;
}

function branchPixelLength(branch: SkeletonBranch): number {
  let total = 0;
  for (let i = 1; i < branch.points.length; i++) {
    total += Math.hypot(
      branch.points[i][0] - branch.points[i - 1][0],
      branch.points[i][1] - branch.points[i - 1][1],
    );
  }
  return total;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function polygonArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
