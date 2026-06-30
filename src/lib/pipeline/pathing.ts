// English note.
// English note.
// English note.
// English note.

import type {
  BranchGroup,
  EmbroideryDesign,
  EmbroideryObject,
  Point2D,
  Shape,
} from "./types";
import { groupObjectsByLayerOrder } from "./layer-ordering";
import { isStrokeBranchGroup, orderStrokeBranchObjects } from "./stroke-graph";

export type { BranchGroup } from "./types";

export type EdgePoint = {
  objId: string;
  pt: Point2D;
  side: "outer" | "hole";
  index: number;
};

const DEFAULT_TOUCH_EPSILON_MM = 0.5;
const STROKE_BRANCH_GAP_EPSILON_MM = 1.5;
const TWO_OPT_OBJECT_CAP = 48;
const TWO_OPT_MAX_PASSES = 2;

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 */
export function shapesTouch(
  a: Shape,
  b: Shape,
  epsilon: number = DEFAULT_TOUCH_EPSILON_MM,
): boolean {
  if (a.outer.length < 3 || b.outer.length < 3) return false;
  const bbA = polygonBBox(a.outer);
  const bbB = polygonBBox(b.outer);
  if (!bboxesOverlap(bbA, bbB, epsilon)) return false;
  // English note.
  for (let i = 0; i < a.outer.length; i++) {
    const p1 = a.outer[i];
    const p2 = a.outer[(i + 1) % a.outer.length];
    for (let j = 0; j < b.outer.length; j++) {
      const p3 = b.outer[j];
      const p4 = b.outer[(j + 1) % b.outer.length];
      if (segmentDistance(p1, p2, p3, p4) < epsilon) return true;
    }
  }
  return false;
}

/**
 * English note.
 * English note.
 * English note.
 * English note.
 *
 * English note.
 */
export function findBranches(objects: EmbroideryObject[]): BranchGroup[] {
  const n = objects.length;
  if (n === 0) return [];
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (objects[i].colorIndex !== objects[j].colorIndex) continue;
      const epsilon = strokeBranchGapEpsilon(objects[i], objects[j]);
      if (shapesTouch(objects[i].shape, objects[j].shape, epsilon)) uf.union(i, j);
    }
  }
  const groupsByRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const arr = groupsByRoot.get(root) ?? [];
    arr.push(i);
    groupsByRoot.set(root, arr);
  }
  const groups: BranchGroup[] = [];
  for (const indices of groupsByRoot.values()) {
    indices.sort((a, b) => a - b);
    groups.push({
      objectIds: indices.map((i) => objects[i].id),
      colorIndex: objects[indices[0]].colorIndex,
    });
  }
  // English note.
  groups.sort((g1, g2) => {
    const i1 = objects.findIndex((o) => o.id === g1.objectIds[0]);
    const i2 = objects.findIndex((o) => o.id === g2.objectIds[0]);
    return i1 - i2;
  });
  return groups;
}

function strokeBranchGapEpsilon(
  a: EmbroideryObject,
  b: EmbroideryObject,
): number {
  if (
    a.layer === b.layer &&
    a.strokeKind !== undefined &&
    a.strokeKind !== "none" &&
    b.strokeKind !== undefined &&
    b.strokeKind !== "none" &&
    a.strokeMetrics?.isStrokeLike === true &&
    b.strokeMetrics?.isStrokeLike === true
  ) {
    return STROKE_BRANCH_GAP_EPSILON_MM;
  }
  return DEFAULT_TOUCH_EPSILON_MM;
}

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
export function chooseEntryExit(
  obj: EmbroideryObject,
  prevExit: Point2D,
  _nextEntry?: Point2D,
): { entry: EdgePoint; exit: EdgePoint } {
  const outer = obj.shape.outer;
  if (outer.length < 2) {
    throw new Error(
      `chooseEntryExit: outer must have >=2 vertices (objId=${obj.id})`,
    );
  }
  if (obj.kind === "run") {
    const startIdx = 0;
    const endIdx = outer.length - 1;
    const start = outer[startIdx];
    const end = outer[endIdx];
    const dStart = distSq(start, prevExit);
    const dEnd = distSq(end, prevExit);
    if (dStart <= dEnd) {
      return {
        entry: mkEP(obj.id, start, startIdx),
        exit: mkEP(obj.id, end, endIdx),
      };
    }
    return {
      entry: mkEP(obj.id, end, endIdx),
      exit: mkEP(obj.id, start, startIdx),
    };
  }
  if (obj.kind === "satin") {
    const ends = findLongAxisEnds(outer);
    const a = outer[ends.iA];
    const b = outer[ends.iB];
    const dA = distSq(a, prevExit);
    const dB = distSq(b, prevExit);
    if (dA <= dB) {
      return { entry: mkEP(obj.id, a, ends.iA), exit: mkEP(obj.id, b, ends.iB) };
    }
    return { entry: mkEP(obj.id, b, ends.iB), exit: mkEP(obj.id, a, ends.iA) };
  }
  // fill
  const entryIdx = findNearestVertexIndex(outer, prevExit);
  const exitIdx = findFarthestVertexIndex(outer, outer[entryIdx]);
  return {
    entry: mkEP(obj.id, outer[entryIdx], entryIdx),
    exit: mkEP(obj.id, outer[exitIdx], exitIdx),
  };
}

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 * English note.
 * English note.
 *
 * English note.
 */
export function optimizeOrder(design: EmbroideryDesign): EmbroideryDesign {
  if (design.objects.length === 0) return { ...design, objects: [] };
  const cloned = design.objects.map((o) => ({ ...o }));
  const locked = cloned.filter((o) => o.locked === true);
  const movable = cloned.filter((o) => o.locked !== true);
  const lockedOrders = new Set(locked.map((o) => o.order));

  // English note.
  const ordered: EmbroideryObject[] = [];
  if (movable.length > 0) {
    let anchor: Point2D = [0, 0];
    for (const layerGroup of groupObjectsByLayerOrder(movable)) {
      const colors = [...new Set(layerGroup.objects.map((o) => o.colorIndex))].sort(
        (a, b) => a - b,
      );
      for (const ci of colors) {
        const colorObjs = layerGroup.objects.filter((o) => o.colorIndex === ci);
        const groups = findBranches(colorObjs);
        const idMap = new Map(colorObjs.map((o) => [o.id, o]));
        // English note.
        const remainingGroups = [...groups];
        const colorStart = anchor;
        const colorRoute: EmbroideryObject[] = [];
        while (remainingGroups.length > 0) {
          let bestGI = 0;
          let bestD = Infinity;
          for (let gi = 0; gi < remainingGroups.length; gi++) {
            const groupObjs = remainingGroups[gi].objectIds
              .map((id) => idMap.get(id)!)
              .filter(Boolean);
            // English note.
            for (const obj of groupObjs) {
              const ee = chooseEntryExit(obj, anchor);
              const d = distSq(ee.entry.pt, anchor);
              if (d < bestD) {
                bestD = d;
                bestGI = gi;
              }
            }
          }
          const pickedGroup = remainingGroups.splice(bestGI, 1)[0];
          const groupObjs = pickedGroup.objectIds
            .map((id) => idMap.get(id)!)
            .filter(Boolean);
          const route = routeBranchGroup(groupObjs, anchor);
          colorRoute.push(...route.orderedObjects);
          anchor = route.lastExit;
        }
        const improvedColorRoute = improveRouteWithTwoOpt(colorRoute, colorStart);
        ordered.push(...improvedColorRoute);
        anchor = routeLastExit(improvedColorRoute, colorStart);
      }
    }
  }

  // English note.
  let counter = 0;
  const nextOrder = (): number => {
    while (lockedOrders.has(counter)) counter++;
    return counter++;
  };
  for (const obj of ordered) {
    obj.order = nextOrder();
  }

  const all = [...ordered, ...locked].sort((a, b) => a.order - b.order);
  return { ...design, objects: all };
}

function routeBranchGroup(
  groupObjects: EmbroideryObject[],
  prevAnchor: Point2D,
): { orderedObjects: EmbroideryObject[]; lastExit: Point2D } {
  if (isStrokeBranchGroup(groupObjects)) {
    const orderedObjects = orderStrokeBranchObjects(groupObjects, prevAnchor);
    return { orderedObjects, lastExit: routeLastExit(orderedObjects, prevAnchor) };
  }

  const remaining = [...groupObjects];
  const nearestNeighbor: EmbroideryObject[] = [];
  let anchor = prevAnchor;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
    let bestExit: Point2D = anchor;
    for (let i = 0; i < remaining.length; i++) {
      const ee = chooseEntryExit(remaining[i], anchor);
      const d = distSq(ee.entry.pt, anchor);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
        bestExit = ee.exit.pt;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    nearestNeighbor.push(picked);
    anchor = bestExit;
  }

  const orderedObjects = improveRouteWithTwoOpt(nearestNeighbor, prevAnchor);
  return { orderedObjects, lastExit: routeLastExit(orderedObjects, prevAnchor) };
}

export function estimateRouteTravelLength(
  objects: EmbroideryObject[],
  start: Point2D = [0, 0],
): number {
  let anchor: Point2D = [start[0], start[1]];
  let total = 0;
  for (const obj of objects) {
    const ee = chooseEntryExit(obj, anchor);
    total += Math.hypot(ee.entry.pt[0] - anchor[0], ee.entry.pt[1] - anchor[1]);
    anchor = ee.exit.pt;
  }
  return total;
}

export function improveRouteWithTwoOpt(
  objects: EmbroideryObject[],
  start: Point2D = [0, 0],
): EmbroideryObject[] {
  if (objects.length < 4) return objects.slice();
  if (objects.length > TWO_OPT_OBJECT_CAP) {
    const out: EmbroideryObject[] = [];
    let anchor: Point2D = [start[0], start[1]];
    for (let i = 0; i < objects.length; i += TWO_OPT_OBJECT_CAP) {
      const chunk = objects.slice(i, i + TWO_OPT_OBJECT_CAP);
      const improvedChunk = improveRouteWithTwoOpt(chunk, anchor);
      out.push(...improvedChunk);
      anchor = routeLastExit(improvedChunk, anchor);
    }
    return out;
  }

  let best = objects.slice();
  let bestLength = estimateRouteTravelLength(best, start);

  for (let pass = 0; pass < TWO_OPT_MAX_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const candidateLength = estimateRouteTravelLength(candidate, start);
        if (candidateLength + 1e-6 < bestLength) {
          best = candidate;
          bestLength = candidateLength;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return best;
}

function routeLastExit(objects: EmbroideryObject[], start: Point2D): Point2D {
  let anchor: Point2D = [start[0], start[1]];
  for (const obj of objects) {
    anchor = chooseEntryExit(obj, anchor).exit.pt;
  }
  return anchor;
}

// --- private helpers ---

function mkEP(objId: string, pt: Point2D, index: number): EdgePoint {
  return { objId, pt: [pt[0], pt[1]], side: "outer", index };
}

function distSq(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

type BBox = { minX: number; maxX: number; minY: number; maxY: number };

function polygonBBox(poly: Point2D[]): BBox {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function bboxesOverlap(a: BBox, b: BBox, eps: number): boolean {
  return !(
    a.maxX + eps < b.minX ||
    b.maxX + eps < a.minX ||
    a.maxY + eps < b.minY ||
    b.maxY + eps < a.minY
  );
}

function pointSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + dx * t;
  const cy = a[1] + dy * t;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function segmentsIntersect(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D,
): boolean {
  const s = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const o = (a: Point2D, b: Point2D, c: Point2D) =>
    s((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const o1 = o(p1, p2, p3);
  const o2 = o(p1, p2, p4);
  const o3 = o(p3, p4, p1);
  const o4 = o(p3, p4, p2);
  return o1 !== o2 && o3 !== o4;
}

function segmentDistance(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D,
): number {
  if (segmentsIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(
    pointSegmentDistance(p1, p3, p4),
    pointSegmentDistance(p2, p3, p4),
    pointSegmentDistance(p3, p1, p2),
    pointSegmentDistance(p4, p1, p2),
  );
}

function findNearestVertexIndex(poly: Point2D[], target: Point2D): number {
  let best = 0;
  let bestD = distSq(poly[0], target);
  for (let i = 1; i < poly.length; i++) {
    const d = distSq(poly[i], target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function findFarthestVertexIndex(poly: Point2D[], source: Point2D): number {
  let best = 0;
  let bestD = distSq(poly[0], source);
  for (let i = 1; i < poly.length; i++) {
    const d = distSq(poly[i], source);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function findLongAxisEnds(poly: Point2D[]): { iA: number; iB: number } {
  let bestD = -1;
  let iA = 0,
    iB = 1;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const d = distSq(poly[i], poly[j]);
      if (d > bestD) {
        bestD = d;
        iA = i;
        iB = j;
      }
    }
  }
  return { iA, iB };
}

class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}
