import type { ColorRegion } from "./vectorize";
import { buildShapesByContainment } from "./vectorize";
import type { Point2D, Polygon } from "./types";

type Edge = {
  from: Point2D;
  to: Point2D;
};

export function vectorizeRasterLabels(input: {
  labels: Uint8Array;
  width: number;
  height: number;
  palette: Array<[number, number, number]>;
}): ColorRegion[] {
  const { labels, width, height, palette } = input;
  const regions: ColorRegion[] = [];
  for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
    const polygons = traceLabelPolygons(labels, width, height, colorIndex);
    if (polygons.length === 0) continue;
    const shapes = buildShapesByContainment(polygons);
    if (shapes.length === 0) continue;
    regions.push({
      colorIndex,
      rgb: palette[colorIndex],
      svgPath: "",
      shapes,
      polygons: shapes.flatMap((shape) => [shape.outer, ...shape.holes]),
    });
  }
  return regions;
}

export function traceLabelPolygons(
  labels: Uint8Array,
  width: number,
  height: number,
  colorIndex: number,
): Polygon[] {
  const edges: Edge[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (labels[y * width + x] !== colorIndex) continue;
      if (!same(labels, width, height, x, y - 1, colorIndex)) {
        edges.push({ from: [x, y], to: [x + 1, y] });
      }
      if (!same(labels, width, height, x + 1, y, colorIndex)) {
        edges.push({ from: [x + 1, y], to: [x + 1, y + 1] });
      }
      if (!same(labels, width, height, x, y + 1, colorIndex)) {
        edges.push({ from: [x + 1, y + 1], to: [x, y + 1] });
      }
      if (!same(labels, width, height, x - 1, y, colorIndex)) {
        edges.push({ from: [x, y + 1], to: [x, y] });
      }
    }
  }
  return chainEdges(edges).filter((polygon) => polygon.length >= 4);
}

function same(
  labels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colorIndex: number,
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === colorIndex;
}

function chainEdges(edges: Edge[]): Polygon[] {
  const byStart = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = pointKey(edge.from);
    const bucket = byStart.get(key);
    if (bucket) bucket.push(edge);
    else byStart.set(key, [edge]);
  }

  const polygons: Polygon[] = [];
  for (const edge of edges) {
    if (!removeEdge(byStart, edge)) continue;
    const polygon: Polygon = [edge.from, edge.to];
    let cursor = edge.to;
    const startKey = pointKey(edge.from);

    for (let guard = 0; guard < edges.length + 1; guard++) {
      const cursorKey = pointKey(cursor);
      if (cursorKey === startKey) break;
      const next = takeNextEdge(byStart, cursor);
      if (!next) break;
      polygon.push(next.to);
      cursor = next.to;
    }

    if (pointKey(polygon[polygon.length - 1]) === startKey) {
      polygon.pop();
      polygons.push(removeDuplicateNeighbors(polygon));
    }
  }
  return polygons;
}

function takeNextEdge(byStart: Map<string, Edge[]>, point: Point2D): Edge | undefined {
  const key = pointKey(point);
  const bucket = byStart.get(key);
  if (!bucket || bucket.length === 0) return undefined;
  return bucket.pop();
}

function removeEdge(byStart: Map<string, Edge[]>, edge: Edge): boolean {
  const bucket = byStart.get(pointKey(edge.from));
  if (!bucket) return false;
  const index = bucket.indexOf(edge);
  if (index < 0) return false;
  bucket.splice(index, 1);
  return true;
}

function removeDuplicateNeighbors(polygon: Polygon): Polygon {
  const out: Polygon = [];
  for (const point of polygon) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) out.push(point);
  }
  return out;
}

function pointKey(point: Point2D): string {
  return `${point[0]},${point[1]}`;
}
