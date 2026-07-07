import type { DesignGraph, DesignGraphEdge, DesignGraphNode, GraphObjectType } from "./design-graph";
import type { EmbroideryObject, Point2D, Shape } from "./types";

type RunComponent = {
  objects: EmbroideryObject[];
  path: Point2D[];
  colorIndex: number;
  layer: string;
  merged: boolean;
  closed: boolean;
};

const MERGE_GAP_MM = 1.5;
const BRIDGE_MIN_GAP_MM = 0.2;
const MERGE_MIN_COS = Math.cos((40 * Math.PI) / 180);

export function connectLineArtRunObjects(graph: DesignGraph): DesignGraph {
  const runObjects = graph.design.objects.filter(isConnectableRunObject);
  if (runObjects.length === 0) return graph;

  const runIds = new Set(runObjects.map((object) => object.id));
  const unchanged = graph.design.objects.filter((object) => !runIds.has(object.id));
  const groups = groupRunObjects(runObjects);
  const connectedRuns = [...groups.values()].flatMap((objects) => connectRunGroup(objects));
  const objects = unchanged
    .concat(connectedRuns)
    .sort((a, b) => a.order - b.order);
  const design = { ...graph.design, objects };
  const nodes = buildNodes(objects);

  return {
    ...graph,
    design,
    nodes,
    edges: buildGraphEdges(nodes),
  };
}

function isConnectableRunObject(object: EmbroideryObject): boolean {
  return (
    object.kind === "run" &&
    object.strokeKind !== "border-satin" &&
    (object.strokeKind === "thin-run" || object.strokeKind === "bean-run")
  );
}

function groupRunObjects(objects: EmbroideryObject[]): Map<string, EmbroideryObject[]> {
  const groups = new Map<string, EmbroideryObject[]>();
  for (const object of objects) {
    const key = `${object.colorIndex}:${object.layer ?? "none"}`;
    groups.set(key, (groups.get(key) ?? []).concat(object));
  }
  return groups;
}

function connectRunGroup(objects: EmbroideryObject[]): EmbroideryObject[] {
  let components = objects.map((object) => ({
    objects: [object],
    path: objectRunPath(object),
    colorIndex: object.colorIndex,
    layer: object.layer ?? "none",
    merged: false,
    closed: false,
  }));

  let changed = true;
  while (changed) {
    changed = false;
    let best: { a: number; b: number; gap: number; component: RunComponent } | null = null;
    for (let i = 0; i < components.length; i++) {
      for (let j = i + 1; j < components.length; j++) {
        const candidate = bestMerge(components[i], components[j]);
        if (!candidate) continue;
        if (!best || candidate.gap < best.gap) best = { a: i, b: j, ...candidate };
      }
    }
    if (best) {
      components[best.a] = best.component;
      components.splice(best.b, 1);
      changed = true;
    }
  }

  return components
    .map(finalizeComponent)
    .filter((component) => !isNoiseComponent(component))
    .map(componentToObject);
}

function objectRunPath(object: EmbroideryObject): Point2D[] {
  return stripClosingDuplicate(object.shape.outer).map(([x, y]) => [x, y]);
}

function bestMerge(a: RunComponent, b: RunComponent): { gap: number; component: RunComponent } | null {
  if (a.colorIndex !== b.colorIndex || a.layer !== b.layer || a.closed || b.closed) return null;
  const variants: Array<[Point2D[], Point2D[]]> = [
    [a.path, b.path],
    [a.path, reversePath(b.path)],
    [reversePath(a.path), b.path],
    [reversePath(a.path), reversePath(b.path)],
  ];
  let best: { gap: number; path: Point2D[] } | null = null;
  for (const [left, right] of variants) {
    const gap = endpointDistance(left, right);
    if (gap > MERGE_GAP_MM) continue;
    if (!tangentCompatible(left, right)) continue;
    const path = mergePaths(left, right, gap);
    if (!best || gap < best.gap) best = { gap, path };
  }
  if (!best) return null;
  return {
    gap: best.gap,
    component: {
      objects: a.objects.concat(b.objects),
      path: best.path,
      colorIndex: a.colorIndex,
      layer: a.layer,
      merged: true,
      closed: false,
    },
  };
}

function finalizeComponent(component: RunComponent): RunComponent {
  const closed = inferClosed(component.path, component.objects.some((object) => object.shape.holes.length > 0));
  return {
    ...component,
    closed,
    path: closed ? ensureClosed(component.path) : component.path,
  };
}

function isNoiseComponent(component: RunComponent): boolean {
  if (component.closed || component.merged) return false;
  const length = pathLength(component.path);
  const box = bbox(component.path);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const pale = component.objects.some((object) => isPaleColor(object.rgb));
  return (
    length < 2 ||
    (width < 1 && height < 1) ||
    (pale && length < 6) ||
    length < 4
  );
}

function componentToObject(component: RunComponent): EmbroideryObject {
  const source = component.objects[0];
  if (component.objects.length === 1 && !component.merged && !component.closed) {
    return source;
  }
  const path = component.path.map(([x, y]) => [x, y] as Point2D);
  return {
    ...source,
    id: component.objects.map((object) => object.id).join("+"),
    shape: {
      outer: path,
      holes: component.objects.flatMap((object) => object.shape.holes),
    },
    order: Math.min(...component.objects.map((object) => object.order)),
  };
}

function stripClosingDuplicate(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points;
  const out = points.map(([x, y]) => [x, y] as Point2D);
  if (distance(out[0], out[out.length - 1]) <= 1e-6) out.pop();
  return out;
}

function inferClosed(path: Point2D[], hasHoles: boolean): boolean {
  if (path.length < 3) return false;
  const gap = distance(path[0], path[path.length - 1]);
  const length = pathLength(path);
  return gap <= 1.2 || (gap <= 2 && length > 0 && gap / length <= 0.06) || (hasHoles && gap <= 2.5);
}

function ensureClosed(path: Point2D[]): Point2D[] {
  if (path.length === 0) return [];
  const out = path.map(([x, y]) => [x, y] as Point2D);
  if (distance(out[0], out[out.length - 1]) > 1e-6) out.push([out[0][0], out[0][1]]);
  return out;
}

function mergePaths(left: Point2D[], right: Point2D[], gap: number): Point2D[] {
  const out = left.map(([x, y]) => [x, y] as Point2D);
  if (gap > BRIDGE_MIN_GAP_MM) {
    const a = left[left.length - 1];
    const b = right[0];
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  out.push(...right.map(([x, y]) => [x, y] as Point2D));
  return dedupe(out);
}

function tangentCompatible(left: Point2D[], right: Point2D[]): boolean {
  if (left.length < 2 || right.length < 2) return true;
  const bridge: Point2D = [right[0][0] - left[left.length - 1][0], right[0][1] - left[left.length - 1][1]];
  if (Math.hypot(bridge[0], bridge[1]) <= 1e-6) return true;
  const leftDir: Point2D = [left[left.length - 1][0] - left[left.length - 2][0], left[left.length - 1][1] - left[left.length - 2][1]];
  const rightDir: Point2D = [right[1][0] - right[0][0], right[1][1] - right[0][1]];
  return normalizedDot(leftDir, bridge) >= MERGE_MIN_COS && normalizedDot(bridge, rightDir) >= MERGE_MIN_COS;
}

function buildNodes(objects: EmbroideryObject[]): DesignGraphNode[] {
  return objects.map((object) => {
    const entry = object.shape.outer[0] ?? [0, 0];
    const exit = object.shape.outer[object.shape.outer.length - 1] ?? entry;
    return {
      id: object.id,
      type: mapObjectType(object),
      object,
      entry: [entry[0], entry[1]],
      exit: [exit[0], exit[1]],
    };
  });
}

function buildGraphEdges(nodes: DesignGraphNode[]): DesignGraphEdge[] {
  const edges: DesignGraphEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const next = nodes[i];
    const distanceMm = distance(prev.exit, next.entry);
    edges.push({
      fromObjectId: prev.id,
      toObjectId: next.id,
      distanceMm,
      command: distanceMm > 3 ? "trim" : "jump",
    });
  }
  return edges;
}

function mapObjectType(object: EmbroideryObject): GraphObjectType {
  if (object.kind === "run") return "RUN";
  if (object.kind === "satin") return "SATIN";
  return "TATAMI";
}

function dedupe(points: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && distance(prev, point) <= 1e-6) continue;
    out.push([point[0], point[1]]);
  }
  return out;
}

function reversePath(path: Point2D[]): Point2D[] {
  return path.slice().reverse().map(([x, y]) => [x, y]);
}

function endpointDistance(left: Point2D[], right: Point2D[]): number {
  return distance(left[left.length - 1], right[0]);
}

function pathLength(path: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
  return total;
}

function bbox(points: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function normalizedDot(a: Point2D, b: Point2D): number {
  const al = Math.hypot(a[0], a[1]);
  const bl = Math.hypot(b[0], b[1]);
  if (al <= 1e-6 || bl <= 1e-6) return 1;
  return (a[0] * b[0] + a[1] * b[1]) / (al * bl);
}

function isPaleColor(rgb: [number, number, number]): boolean {
  const [r, g, b] = rgb;
  return b >= 180 && r >= 120 && g >= 160;
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
