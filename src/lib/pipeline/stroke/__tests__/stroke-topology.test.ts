import { describe, expect, it } from "vitest";
import { detectClosedStroke } from "../loop-detector";
import { mergeSimilarStrokePaths } from "../path-merger";
import { deduplicateStitches } from "../path-deduplicator";
import type { StrokePath } from "../stroke-types";
import type { Point2D } from "../../types";

describe("stroke topology repair", () => {
  it("closes near-closed stroke paths with an explicit bridge back to the start", () => {
    const path = makePath("loop", [[0, 0], [4, 0], [4, 4], [0.7, 0.4]]);

    const closed = detectClosedStroke(path);

    expect(closed.closed).toBe(true);
    expect(closed.points.at(-1)).toEqual(closed.points[0]);
    expect(closed.points.length).toBeGreaterThan(path.points.length);
  });

  it("keeps open strokes open when the gap is too large", () => {
    const path = makePath("open", [[0, 0], [4, 0], [8, 2]]);

    const closed = detectClosedStroke(path);

    expect(closed.closed).toBe(false);
    expect(closed.points.at(-1)).toEqual([8, 2]);
  });

  it("removes duplicated similar stroke paths and keeps the longest one", () => {
    const paths: StrokePath[] = [
      makePath("short", [[0, 0], [4, 0], [8, 0]]),
      makePath("long", [[0, 0.1], [4, 0.1], [8.2, 0.1]]),
      makePath("other", [[0, 3], [4, 3], [8, 3]]),
    ];

    const merged = mergeSimilarStrokePaths(paths);

    expect(merged.map((path) => path.id)).toEqual(["long", "other"]);
  });

  it("deduplicates repeated stitch polylines by start, end, length, and direction", () => {
    const paths: Point2D[][] = [
      [[0, 0], [4, 0], [8, 0]],
      [[0.03, 0.02], [4, 0], [8.04, -0.01]],
      [[0, 2], [4, 2]],
    ];

    const deduped = deduplicateStitches(paths);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toEqual(paths[0]);
    expect(deduped[1]).toEqual(paths[2]);
  });
});

function makePath(id: string, points: Array<[number, number]>): StrokePath {
  return {
    id,
    points,
    closed: false,
    length: length(points),
    color: 0,
  };
}

function length(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}
