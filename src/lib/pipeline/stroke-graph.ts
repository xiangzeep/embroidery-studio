import type { EmbroideryObject, Point2D } from "./types";
import { isSafeTravelBetweenObjects } from "./safe-travel";

const EXACT_STROKE_ROUTE_OBJECT_CAP = 12;
const SAFE_TRAVEL_COST_MULTIPLIER = 0.2;

export function isStrokeBranchGroup(objects: EmbroideryObject[]): boolean {
  return objects.length > 0 && objects.every((obj) =>
    obj.strokeKind !== undefined &&
    obj.strokeKind !== "none" &&
    obj.strokeMetrics?.isStrokeLike === true
  );
}

export function orderStrokeBranchObjects(
  objects: EmbroideryObject[],
  start: Point2D,
): EmbroideryObject[] {
  if (!isStrokeBranchGroup(objects)) return objects.slice();

  const exact = findOptimalStrokeBranchOrder(objects, start);
  if (exact) return exact;

  return findBestGreedyStrokeBranchOrder(objects, start);
}

function findOptimalStrokeBranchOrder(
  objects: EmbroideryObject[],
  start: Point2D,
): EmbroideryObject[] | null {
  const n = objects.length;
  if (n === 0) return [];
  if (n > EXACT_STROKE_ROUTE_OBJECT_CAP) return null;

  const endpoints = objects.map((obj) => strokeEndpoints(obj));
  const fullMask = (1 << n) - 1;
  const stateCost = new Map<number, number>();
  const previous = new Map<number, { prevKey: number | null; objectIndex: number }>();

  for (let i = 0; i < n; i++) {
    for (let direction = 0 as 0 | 1; direction <= 1; direction++) {
      const entry = endpoints[i][direction];
      const key = encodeState(1 << i, i, direction);
      stateCost.set(key, Math.sqrt(distSq(start, entry)));
      previous.set(key, { prevKey: null, objectIndex: i });
    }
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    for (let lastIndex = 0; lastIndex < n; lastIndex++) {
      if ((mask & (1 << lastIndex)) === 0) continue;
      for (let direction = 0 as 0 | 1; direction <= 1; direction++) {
        const key = encodeState(mask, lastIndex, direction);
        const currentCost = stateCost.get(key);
        if (currentCost === undefined) continue;
        const exit = endpoints[lastIndex][direction === 0 ? 1 : 0];
        for (let nextIndex = 0; nextIndex < n; nextIndex++) {
          if ((mask & (1 << nextIndex)) !== 0) continue;
          const nextMask = mask | (1 << nextIndex);
          for (let nextDirection = 0 as 0 | 1; nextDirection <= 1; nextDirection++) {
            const entry = endpoints[nextIndex][nextDirection];
            const nextKey = encodeState(nextMask, nextIndex, nextDirection);
            const nextCost =
              currentCost +
              strokeTransitionCost(objects[lastIndex], objects[nextIndex], exit, entry);
            const bestCost = stateCost.get(nextKey);
            if (bestCost === undefined || nextCost + 1e-6 < bestCost) {
              stateCost.set(nextKey, nextCost);
              previous.set(nextKey, { prevKey: key, objectIndex: nextIndex });
            }
          }
        }
      }
    }
  }

  let bestKey: number | null = null;
  let bestCost = Infinity;
  for (let lastIndex = 0; lastIndex < n; lastIndex++) {
    for (let direction = 0 as 0 | 1; direction <= 1; direction++) {
      const key = encodeState(fullMask, lastIndex, direction);
      const cost = stateCost.get(key);
      if (cost !== undefined && cost < bestCost) {
        bestCost = cost;
        bestKey = key;
      }
    }
  }

  if (bestKey === null) return null;

  const reversedIndices: number[] = [];
  let cursor: number | null = bestKey;
  while (cursor !== null) {
    const step = previous.get(cursor);
    if (!step) break;
    reversedIndices.push(step.objectIndex);
    cursor = step.prevKey;
  }

  return reversedIndices.reverse().map((index) => objects[index]);
}

function findBestGreedyStrokeBranchOrder(
  objects: EmbroideryObject[],
  start: Point2D,
): EmbroideryObject[] {
  let bestOrder: EmbroideryObject[] | null = null;
  let bestCost = Infinity;

  for (let i = 0; i < objects.length; i++) {
    const candidate = buildGreedyStrokeBranchOrder(objects, start, i);
    const cost = estimateStrokeTravelLength(candidate, start);
    if (bestOrder === null || cost + 1e-6 < bestCost) {
      bestOrder = candidate;
      bestCost = cost;
    }
  }

  return bestOrder ?? objects.slice();
}

function buildGreedyStrokeBranchOrder(
  objects: EmbroideryObject[],
  start: Point2D,
  firstIndex: number,
): EmbroideryObject[] {
  const remaining = objects.slice();
  const ordered: EmbroideryObject[] = [];
  let anchor: Point2D = [start[0], start[1]];

  const first = remaining.splice(firstIndex, 1)[0];
  ordered.push(first);
  anchor = strokeExitPoint(first, anchor);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const entry = nearestStrokeEndpoint(remaining[i], anchor);
      const d = strokeTransitionCost(ordered[ordered.length - 1], remaining[i], anchor, entry);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    const picked = remaining.splice(bestIndex, 1)[0];
    ordered.push(picked);
    anchor = strokeExitPoint(picked, anchor);
  }

  return ordered;
}

function estimateStrokeTravelLength(
  objects: EmbroideryObject[],
  start: Point2D,
): number {
  let total = 0;
  let anchor: Point2D = [start[0], start[1]];
  let previous: EmbroideryObject | null = null;
  for (const obj of objects) {
    const entry = nearestStrokeEndpoint(obj, anchor);
    total += previous
      ? strokeTransitionCost(previous, obj, anchor, entry)
      : Math.sqrt(distSq(anchor, entry));
    anchor = strokeExitPoint(obj, anchor);
    previous = obj;
  }
  return total;
}

function strokeExitPoint(obj: EmbroideryObject, anchor: Point2D): Point2D {
  const [a, b] = strokeEndpoints(obj);
  return distSq(a, anchor) <= distSq(b, anchor) ? b : a;
}

function nearestStrokeEndpoint(obj: EmbroideryObject, anchor: Point2D): Point2D {
  const [a, b] = strokeEndpoints(obj);
  return distSq(a, anchor) <= distSq(b, anchor) ? a : b;
}

function strokeEndpoints(obj: EmbroideryObject): [Point2D, Point2D] {
  const points = obj.shape.outer;
  if (points.length === 0) return [[0, 0], [0, 0]];
  let bestA = points[0];
  let bestB = points[0];
  let bestDistance = -Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distSq(points[i], points[j]);
      if (d > bestDistance) {
        bestDistance = d;
        bestA = points[i];
        bestB = points[j];
      }
    }
  }
  return [
    [bestA[0], bestA[1]],
    [bestB[0], bestB[1]],
  ];
}

function distSq(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function encodeState(mask: number, lastIndex: number, direction: 0 | 1): number {
  return (mask << 8) | (lastIndex << 1) | direction;
}

function strokeTransitionCost(
  fromObj: EmbroideryObject,
  toObj: EmbroideryObject,
  from: Point2D,
  to: Point2D,
): number {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (distance <= 1e-7) return 0;
  const safe = isSafeTravelBetweenObjects({
    fromObject: fromObj,
    toObject: toObj,
    from,
    to,
  });
  return safe ? distance * SAFE_TRAVEL_COST_MULTIPLIER : distance;
}
