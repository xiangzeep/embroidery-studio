// Phase 3 §4 Pathing: object 訪問順最適化と branching 検出。
// PR13 スコープ: shapesTouch (接触判定) / findBranches (Union-Find グループ化) /
// chooseEntryExit (進入退出点選定)。optimizeOrder は PR14、render 配線は PR15。
// 純関数: 入力 EmbroideryObject / Shape を破壊せず、新オブジェクトを返す。

import type {
  BranchGroup,
  EmbroideryDesign,
  EmbroideryObject,
  Point2D,
  Shape,
} from "./types";

export type { BranchGroup } from "./types";

export type EdgePoint = {
  objId: string;
  pt: Point2D;
  side: "outer" | "hole";
  index: number;
};

const DEFAULT_TOUCH_EPSILON_MM = 0.5;

/**
 * 2 つの Shape が `epsilon` (mm) 以内で接触/重なるかを判定する。
 * bbox 先行枝刈り → outer-outer 全線分 pair の最短距離が `< epsilon` で true。
 * holes は無視 (Phase 3 では outer 接触のみで branch group を構築する)。
 *
 * 計算量: O(N×M) where N, M は outer の頂点数。object 数 < 50 想定で許容範囲。
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
  // 全線分 pair で最短距離を計算 (距離 < epsilon で touch とみなす)
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
 * 同色 EmbroideryObject 群を Union-Find で接触判定 → branch group 化する。
 * 異色 object は必ず別 group。孤立 object も 1 要素 group として返る。
 * 出力 group の順序は「group 内の最小入力 index」昇順で決定的。
 * 入力 objects は mutate しない。
 *
 * 計算量: O(N²) (全 pair の `shapesTouch`)。
 */
export function findBranches(objects: EmbroideryObject[]): BranchGroup[] {
  const n = objects.length;
  if (n === 0) return [];
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (objects[i].colorIndex !== objects[j].colorIndex) continue;
      if (shapesTouch(objects[i].shape, objects[j].shape)) uf.union(i, j);
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
  // group は「最小入力 index」の昇順で並べる (決定性のため)
  groups.sort((g1, g2) => {
    const i1 = objects.findIndex((o) => o.id === g1.objectIds[0]);
    const i2 = objects.findIndex((o) => o.id === g2.objectIds[0]);
    return i1 - i2;
  });
  return groups;
}

/**
 * EmbroideryObject の進入点と退出点を `prevExit` からの最近接で選定する。
 *
 * - kind="run":   outer の 2 端 (`[0]` と `[N-1]`) から prevExit に近い方が entry、反対が exit
 * - kind="satin": outer の全頂点 pair で最遠の 2 点 (長軸 2 端) のうち prevExit に近い方が entry
 * - kind="fill":  outer 頂点中 prevExit に最も近い点が entry、entry から最も遠い outer 頂点が exit
 *
 * `nextEntry` は将来 (PR15) の 2-way 最適化用フックで本 PR では未使用 (`_nextEntry`)。
 * 等距離タイの場合は **小さい index** を優先する (決定性確保)。
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
 * Phase 3 §4.1 訪問順最適化。`design.objects` を以下の手順で再採番した新 Design を返す。
 *
 *   Step A: colorIndex 昇順で stable group 化
 *   Step B: 各色グループ内で findBranches を呼ぶ
 *   Step C: 色 anchor を引き継ぎつつ、branch group 間/内とも nearest-neighbor で順序付け
 *   Step D: `locked: true` の object は元の order を保持し、再採番されない (衝突回避)
 *
 * - 入力 `design` / `objects` は mutate しない
 * - 出力 `objects` は入力と同じ要素数・同じ id 集合、`order` と配列順のみ変化
 * - 出力 `objects` は `order` 昇順でソート済み
 * - 空 `objects` なら `{ ...design, objects: [] }` を返す
 *
 * 計算量: O(N²) (`findBranches` 内の `shapesTouch` ペア走査が支配的)。object 数 < 50 想定。
 */
export function optimizeOrder(design: EmbroideryDesign): EmbroideryDesign {
  if (design.objects.length === 0) return { ...design, objects: [] };
  const cloned = design.objects.map((o) => ({ ...o }));
  const locked = cloned.filter((o) => o.locked === true);
  const movable = cloned.filter((o) => o.locked !== true);
  const lockedOrders = new Set(locked.map((o) => o.order));

  // movable を color → branch group → branch 内 NN の順で並べる
  const ordered: EmbroideryObject[] = [];
  if (movable.length > 0) {
    const colors = [...new Set(movable.map((o) => o.colorIndex))].sort(
      (a, b) => a - b,
    );
    let anchor: Point2D = [0, 0];
    for (const ci of colors) {
      const colorObjs = movable.filter((o) => o.colorIndex === ci);
      const groups = findBranches(colorObjs);
      const idMap = new Map(colorObjs.map((o) => [o.id, o]));
      // branch group 間も nearest-neighbor
      const remainingGroups = [...groups];
      while (remainingGroups.length > 0) {
        let bestGI = 0;
        let bestD = Infinity;
        for (let gi = 0; gi < remainingGroups.length; gi++) {
          const groupObjs = remainingGroups[gi].objectIds
            .map((id) => idMap.get(id)!)
            .filter(Boolean);
          // group 内の最近 entry までの距離を group 評価値とする
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
        ordered.push(...route.orderedObjects);
        anchor = route.lastExit;
      }
    }
  }

  // movable に order を採番 (locked の order をスキップして衝突回避)
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
  const remaining = [...groupObjects];
  const orderedObjects: EmbroideryObject[] = [];
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
    orderedObjects.push(picked);
    anchor = bestExit;
  }
  return { orderedObjects, lastExit: anchor };
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
