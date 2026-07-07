import type { DesignGraph, DesignGraphEdge, DesignGraphNode, GraphObjectType } from "./design-graph";
import type { EmbroideryObject, Point2D } from "./types";

const DUPLICATE_HAUSDORFF_MM = 0.2;
const DUPLICATE_LENGTH_RATIO = 0.05;

export function removeDuplicatePaths(graph: DesignGraph): DesignGraph {
  const kept: EmbroideryObject[] = [];
  const runPaths: Point2D[][] = [];
  for (const object of graph.design.objects) {
    if (!isRunObject(object)) {
      kept.push(object);
      continue;
    }
    const duplicate = runPaths.some((path) => isDuplicatePolyline(path, object.shape.outer));
    if (duplicate) continue;
    kept.push(object);
    runPaths.push(object.shape.outer);
  }
  if (kept.length === graph.design.objects.length) return graph;
  const design = { ...graph.design, objects: kept };
  const nodes = buildNodes(kept);
  return { ...graph, design, nodes, edges: buildGraphEdges(nodes) };
}

export function removeDuplicatePolyline(paths: Point2D[][]): Point2D[][] {
  const kept: Point2D[][] = [];
  for (const path of paths) {
    if (kept.some((candidate) => isDuplicatePolyline(candidate, path))) continue;
    kept.push(path.map(([x, y]) => [x, y]));
  }
  return kept;
}

function isDuplicatePolyline(a: Point2D[], b: Point2D[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const lenA = polylineLength(a);
  const lenB = polylineLength(b);
  const longer = Math.max(lenA, lenB);
  if (longer <= 1e-6) return false;
  if (Math.abs(lenA - lenB) / longer > DUPLICATE_LENGTH_RATIO) return false;
  return hausdorffDistance(a, b) < DUPLICATE_HAUSDORFF_MM;
}

function hausdorffDistance(a: Point2D[], b: Point2D[]): number {
  return Math.max(directedHausdorff(a, b), directedHausdorff(b, a));
}

function directedHausdorff(a: Point2D[], b: Point2D[]): number {
  let worst = 0;
  for (const point of a) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < b.length; i++) {
      best = Math.min(best, pointToSegmentDistance(point, b[i - 1], b[i]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

function pointToSegmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-12) return distance(point, a);
  const t = Math.min(Math.max(((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / len2, 0), 1);
  return distance(point, [a[0] + abx * t, a[1] + aby * t]);
}

function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

function isRunObject(object: EmbroideryObject): boolean {
  return object.kind === "run" && (object.strokeKind === "thin-run" || object.strokeKind === "bean-run");
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

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
