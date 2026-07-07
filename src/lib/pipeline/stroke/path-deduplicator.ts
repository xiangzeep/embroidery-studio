import type { Point2D } from "../types";
import { polylineLength } from "./stroke-cleaner";

export function deduplicateStitches(paths: Point2D[][]): Point2D[][] {
  const seen = new Set<string>();
  const out: Point2D[][] = [];
  for (const path of paths) {
    const hash = stitchPathHash(path);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(path);
  }
  return out;
}

function stitchPathHash(path: Point2D[]): string {
  const first = path[0] ?? [0, 0];
  const last = path.at(-1) ?? first;
  const length = polylineLength(path);
  const dir = Math.atan2(last[1] - first[1], last[0] - first[0]);
  return [
    quantize(first[0]),
    quantize(first[1]),
    quantize(last[0]),
    quantize(last[1]),
    quantize(length),
    quantize(dir),
  ].join("_");
}

function quantize(value: number): number {
  return Math.round(value * 10);
}
