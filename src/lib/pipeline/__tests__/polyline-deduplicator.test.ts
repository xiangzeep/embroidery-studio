import { describe, expect, it } from "vitest";
import { buildDesignGraph } from "../design-graph";
import { removeDuplicatePaths, removeDuplicatePolyline } from "../polyline-deduplicator";
import { FABRIC_PROFILES } from "../fabric";
import type { EmbroideryDesign, EmbroideryObject, Point2D } from "../types";

const makeRun = (id: string, outer: Point2D[], order: number): EmbroideryObject => ({
  id,
  kind: "run",
  baseKind: "run",
  colorIndex: 0,
  rgb: [0, 128, 255],
  shape: { outer, holes: [] },
  props: { densityMm: 0.4, maxStitchMm: 4 },
  strokeKind: "thin-run",
  strokeRole: "outline",
  order,
});

describe("polyline-deduplicator", () => {
  it("detects duplicate polylines even when one is reversed", () => {
    const a: Point2D[] = [[0, 0], [2, 0], [4, 0]];
    const b: Point2D[] = [[4, 0.08], [2, 0.06], [0, 0.05]];

    expect(removeDuplicatePolyline([a, b])).toHaveLength(1);
  });

  it("keeps distinct nearby decorative paths", () => {
    const a: Point2D[] = [[0, 0], [2, 0], [4, 0]];
    const b: Point2D[] = [[0, 0.8], [2, 0.8], [4, 0.8]];

    expect(removeDuplicatePolyline([a, b])).toHaveLength(2);
  });

  it("removes duplicate run objects from design graph while preserving order", () => {
    const graph = buildDesignGraph(makeDesign([
      makeRun("main", [[0, 0], [2, 0], [4, 0]], 0),
      makeRun("main-reversed", [[4, 0.05], [2, 0.05], [0, 0.05]], 1),
      makeRun("other", [[0, 2], [2, 2], [4, 2]], 2),
    ]));

    const deduped = removeDuplicatePaths(graph);
    const ids = deduped.design.objects.map((object) => object.id);

    expect(ids).toEqual(["main", "other"]);
    expect(deduped.nodes.map((node) => node.id)).toEqual(ids);
  });
});

function makeDesign(objects: EmbroideryObject[]): EmbroideryDesign {
  return {
    widthMm: 12,
    heightMm: 8,
    fabric: FABRIC_PROFILES.denim,
    objects,
  };
}
