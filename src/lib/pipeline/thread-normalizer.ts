import type { DigitizingMode } from "./config";
import type { DesignGraph, DesignGraphEdge, DesignGraphNode, GraphObjectType } from "./design-graph";
import type { EmbroideryObject, Point2D } from "./types";

export type ThreadNormalizerOptions = {
  digitizingMode: DigitizingMode;
};

export function normalizeThreadColors(
  graph: DesignGraph,
  opts: ThreadNormalizerOptions,
): DesignGraph {
  if (opts.digitizingMode !== "line-art") return graph;
  if (graph.design.objects.length === 0) return graph;
  const threadRgb = chooseLineArtThreadColor(graph.design.objects);
  const objects = graph.design.objects.map((object) => ({
    ...object,
    colorIndex: 0,
    rgb: threadRgb,
  }));
  const design = { ...graph.design, objects };
  const nodes = buildNodes(objects);
  return { ...graph, design, nodes, edges: buildGraphEdges(nodes) };
}

function chooseLineArtThreadColor(objects: EmbroideryObject[]): [number, number, number] {
  const candidates = objects
    .map((object) => object.rgb)
    .filter(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 20);
  if (candidates.length === 0) return objects[0].rgb;
  return candidates.sort((a, b) => colorStrength(b) - colorStrength(a))[0];
}

function colorStrength([r, g, b]: [number, number, number]): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function buildNodes(objects: EmbroideryObject[]): DesignGraphNode[] {
  return objects.map((object) => {
    const entry = object.shape.outer[0] ?? [0, 0];
    const exit = object.shape.outer[object.shape.outer.length - 1] ?? entry;
    return {
      id: object.id,
      type: mapObjectType(object),
      object,
      entry: copyPoint(entry),
      exit: copyPoint(exit),
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

function copyPoint(point: Point2D): Point2D {
  return [point[0], point[1]];
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
