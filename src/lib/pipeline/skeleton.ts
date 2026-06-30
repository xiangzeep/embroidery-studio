import { __internal as underlayInternal } from "./underlay";
import type { BinaryMask, Point2D, SkeletonBranch, SkeletonGraph, SkeletonNode } from "./types";

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],            [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

type Pixel = [number, number];
type NodeCluster = {
  id: string;
  degree: number;
  pixels: Pixel[];
  x: number;
  y: number;
  componentId: number;
};

export function skeletonizeMask(mask: BinaryMask): SkeletonGraph {
  const thin = underlayInternal.thinMaskZhangSuen(mask.data, mask.width, mask.height);
  const { componentIds, components } = collectSkeletonComponents(thin, mask.width, mask.height);
  const nodeClusters = collectNodeClusters(thin, mask.width, mask.height, componentIds);
  const membership = new Map<string, NodeCluster>();
  const nodes: SkeletonNode[] = [];

  for (const cluster of nodeClusters) {
    nodes.push({
      id: cluster.id,
      x: cluster.x,
      y: cluster.y,
      degree: cluster.degree,
    });
    for (const [x, y] of cluster.pixels) membership.set(pixelKey(x, y), cluster);
  }

  const branches = collectBranches(
    thin,
    mask.width,
    mask.height,
    components,
    componentIds,
    nodeClusters,
    membership,
  );

  return {
    width: mask.width,
    height: mask.height,
    nodes,
    branches,
  };
}

function collectSkeletonComponents(
  skel: Uint8Array,
  width: number,
  height: number,
): { componentIds: Int32Array; components: Pixel[][] } {
  const componentIds = new Int32Array(width * height);
  componentIds.fill(-1);
  const components: Pixel[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (skel[idx] !== 1 || componentIds[idx] !== -1) continue;
      const componentId = components.length;
      const pixels: Pixel[] = [];
      const stack: Pixel[] = [[x, y]];
      componentIds[idx] = componentId;

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        pixels.push([cx, cy]);
        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (skel[nIdx] !== 1 || componentIds[nIdx] !== -1) continue;
          componentIds[nIdx] = componentId;
          stack.push([nx, ny]);
        }
      }

      components.push(pixels);
    }
  }

  return { componentIds, components };
}

function collectNodeClusters(
  skel: Uint8Array,
  width: number,
  height: number,
  componentIds: Int32Array,
): NodeCluster[] {
  const endpointPixels: Pixel[] = [];
  const junctionMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skel[y * width + x] !== 1) continue;
      const connectivity = connectivityNumber(skel, width, height, x, y);
      if (connectivity === 1) endpointPixels.push([x, y]);
      if (connectivity >= 3) junctionMask[y * width + x] = 1;
    }
  }

  const clusters: NodeCluster[] = [];
  const visitedJunction = new Uint8Array(width * height);
  let index = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (junctionMask[idx] !== 1 || visitedJunction[idx] === 1) continue;
      const pixels = floodPixels(junctionMask, width, height, x, y, visitedJunction);
      clusters.push(makeCluster(`junction-${index++}`, pixels, skel, width, height, componentIds));
    }
  }

  for (const [x, y] of endpointPixels) {
    clusters.push(makeCluster(`endpoint-${index++}`, [[x, y]], skel, width, height, componentIds));
  }

  return clusters;
}

function makeCluster(
  id: string,
  pixels: Pixel[],
  skel: Uint8Array,
  width: number,
  height: number,
  componentIds: Int32Array,
): NodeCluster {
  let sumX = 0;
  let sumY = 0;
  let degree = 0;
  for (const [x, y] of pixels) {
    sumX += x;
    sumY += y;
    degree = Math.max(degree, connectivityNumber(skel, width, height, x, y));
  }

  const [px, py] = pixels[0];
  return {
    id,
    degree,
    pixels,
    x: sumX / pixels.length,
    y: sumY / pixels.length,
    componentId: componentIds[py * width + px],
  };
}

function floodPixels(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8Array,
): Pixel[] {
  const pixels: Pixel[] = [];
  const stack: Pixel[] = [[startX, startY]];
  visited[startY * width + startX] = 1;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    pixels.push([x, y]);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const idx = ny * width + nx;
      if (mask[idx] !== 1 || visited[idx] === 1) continue;
      visited[idx] = 1;
      stack.push([nx, ny]);
    }
  }

  return pixels;
}

function collectBranches(
  skel: Uint8Array,
  width: number,
  height: number,
  components: Pixel[][],
  componentIds: Int32Array,
  nodeClusters: NodeCluster[],
  membership: Map<string, NodeCluster>,
): SkeletonBranch[] {
  const branches: SkeletonBranch[] = [];
  const visitedEdges = new Set<string>();
  let branchIndex = 0;

  for (let componentId = 0; componentId < components.length; componentId++) {
    const component = components[componentId];
    const nodes = nodeClusters.filter((node) => node.componentId === componentId);
    const componentKeySet = new Set(component.map(([x, y]) => pixelKey(x, y)));

    if (nodes.length === 0) {
      const loop = traceClosedLoop(component, skel, width, height, componentKeySet, visitedEdges);
      if (loop.length >= 3) {
        branches.push({
          id: `branch-${branchIndex++}`,
          points: loop,
          isLoop: true,
          startNodeId: null,
          endNodeId: null,
        });
      }
      continue;
    }

    for (const node of nodes) {
      for (const [sx, sy] of outwardStarts(node, skel, width, height, membership, componentIds)) {
        const prev = nearestClusterPixelToward(node, [sx, sy]);
        if (!prev) continue;
        if (visitedEdges.has(edgeKey(prev[0], prev[1], sx, sy))) continue;

        const trace = traceBranch(
          node,
          [sx, sy],
          skel,
          width,
          height,
          componentIds,
          membership,
          visitedEdges,
        );

        if (trace.points.length < 2) continue;
        branches.push({
          id: `branch-${branchIndex++}`,
          points: trace.points,
          isLoop: false,
          startNodeId: node.id,
          endNodeId: trace.endNodeId,
        });
      }
    }
  }

  return branches;
}

function outwardStarts(
  node: NodeCluster,
  skel: Uint8Array,
  width: number,
  height: number,
  membership: Map<string, NodeCluster>,
  componentIds: Int32Array,
): Pixel[] {
  const starts: Pixel[] = [];
  const seen = new Set<string>();

  for (const [x, y] of node.pixels) {
    for (const [nx, ny] of activeNeighbors(skel, width, height, x, y)) {
      const neighborKey = pixelKey(nx, ny);
      if (membership.get(neighborKey)?.id === node.id) continue;
      if (componentIds[ny * width + nx] !== node.componentId) continue;
      if (seen.has(neighborKey)) continue;
      seen.add(neighborKey);
      starts.push([nx, ny]);
    }
  }

  return starts;
}

function traceBranch(
  startNode: NodeCluster,
  first: Pixel,
  skel: Uint8Array,
  width: number,
  height: number,
  componentIds: Int32Array,
  membership: Map<string, NodeCluster>,
  visitedEdges: Set<string>,
): { points: Point2D[]; endNodeId: string | null } {
  const points: Point2D[] = [[startNode.x, startNode.y]];
  let prev: Pixel | null = nearestClusterPixelToward(startNode, first);
  let current: Pixel = first;
  const componentId = startNode.componentId;

  if (prev) visitedEdges.add(edgeKey(prev[0], prev[1], current[0], current[1]));
  points.push([current[0], current[1]]);

  while (true) {
    const currentNode = membership.get(pixelKey(current[0], current[1]));
    if (currentNode && currentNode.id !== startNode.id) {
      points[points.length - 1] = [currentNode.x, currentNode.y];
      return { points: dedupeSequential(points), endNodeId: currentNode.id };
    }

    const nextCandidates = activeNeighbors(skel, width, height, current[0], current[1])
      .filter(([nx, ny]) => componentIds[ny * width + nx] === componentId)
      .filter(([nx, ny]) => !(prev && nx === prev[0] && ny === prev[1]))
      .filter(([nx, ny]) => membership.get(pixelKey(nx, ny))?.id !== startNode.id);

    if (nextCandidates.length === 0) {
      return { points: dedupeSequential(points), endNodeId: null };
    }

    const next = chooseBestForwardNeighbor(prev, current, nextCandidates);
    visitedEdges.add(edgeKey(current[0], current[1], next[0], next[1]));
    prev = current;
    current = next;
    points.push([current[0], current[1]]);
  }
}

function traceClosedLoop(
  component: Pixel[],
  skel: Uint8Array,
  width: number,
  height: number,
  componentKeySet: Set<string>,
  visitedEdges: Set<string>,
): Point2D[] {
  if (component.length === 0) return [];
  const start = component
    .slice()
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  const startKey = pixelKey(start[0], start[1]);
  const points: Point2D[] = [[start[0], start[1]]];
  let prev: Pixel | null = null;
  let current: Pixel = start;

  for (let step = 0; step < component.length + 2; step++) {
    const nextCandidates = activeNeighbors(skel, width, height, current[0], current[1])
      .filter(([nx, ny]) => componentKeySet.has(pixelKey(nx, ny)))
      .filter(([nx, ny]) => !(prev && nx === prev[0] && ny === prev[1]));

    if (nextCandidates.length === 0) break;

    const next = chooseBestForwardNeighbor(prev, current, nextCandidates);
    const eKey = edgeKey(current[0], current[1], next[0], next[1]);
    if (visitedEdges.has(eKey) && pixelKey(next[0], next[1]) !== startKey) break;
    visitedEdges.add(eKey);

    prev = current;
    current = next;
    if (pixelKey(current[0], current[1]) === startKey) break;
    points.push([current[0], current[1]]);
  }

  return dedupeSequential(points);
}

function nearestClusterPixelToward(cluster: NodeCluster, target: Pixel): Pixel | null {
  let best: Pixel | null = null;
  let bestDist = Infinity;
  for (const pixel of cluster.pixels) {
    const dist = Math.hypot(target[0] - pixel[0], target[1] - pixel[1]);
    if (dist < bestDist) {
      bestDist = dist;
      best = pixel;
    }
  }
  return best;
}

function chooseBestForwardNeighbor(prev: Pixel | null, current: Pixel, candidates: Pixel[]): Pixel {
  if (!prev || candidates.length === 1) return candidates[0];

  const dirX = current[0] - prev[0];
  const dirY = current[1] - prev[1];
  let best = candidates[0];
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const nextX = candidate[0] - current[0];
    const nextY = candidate[1] - current[1];
    const score = dirX * nextX + dirY * nextY;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function activeNeighbors(
  skel: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): Pixel[] {
  const neighbors: Pixel[] = [];
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (skel[ny * width + nx] !== 1) continue;
    neighbors.push([nx, ny]);
  }
  return neighbors;
}

function connectivityNumber(
  skel: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const ring = [
    sampleSkeleton(skel, width, height, x, y - 1),
    sampleSkeleton(skel, width, height, x + 1, y - 1),
    sampleSkeleton(skel, width, height, x + 1, y),
    sampleSkeleton(skel, width, height, x + 1, y + 1),
    sampleSkeleton(skel, width, height, x, y + 1),
    sampleSkeleton(skel, width, height, x - 1, y + 1),
    sampleSkeleton(skel, width, height, x - 1, y),
    sampleSkeleton(skel, width, height, x - 1, y - 1),
  ];

  let transitions = 0;
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (current === 0 && next === 1) transitions++;
  }
  return transitions;
}

function sampleSkeleton(
  skel: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return skel[y * width + x] === 1 ? 1 : 0;
}

function dedupeSequential(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.slice();
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const point = points[i];
    if (Math.abs(prev[0] - point[0]) <= 1e-6 && Math.abs(prev[1] - point[1]) <= 1e-6) continue;
    out.push(point);
  }
  return out;
}

function pixelKey(x: number, y: number): string {
  return `${x},${y}`;
}

function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  return pixelKey(ax, ay) < pixelKey(bx, by)
    ? `${pixelKey(ax, ay)}->${pixelKey(bx, by)}`
    : `${pixelKey(bx, by)}->${pixelKey(ax, ay)}`;
}
