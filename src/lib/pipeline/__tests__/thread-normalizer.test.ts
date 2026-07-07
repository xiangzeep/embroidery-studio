import { describe, expect, it } from "vitest";
import { buildDesignGraph } from "../design-graph";
import { FABRIC_PROFILES } from "../fabric";
import { normalizeThreadColors } from "../thread-normalizer";
import type { EmbroideryDesign, EmbroideryObject, Point2D } from "../types";

describe("normalizeThreadColors", () => {
  it("forces all line-art objects to one color index", () => {
    const graph = buildDesignGraph(makeDesign([
      makeRun("a", [[0, 0], [2, 0]], 0, [0, 128, 255]),
      makeRun("b", [[0, 1], [2, 1]], 1, [140, 200, 255]),
    ]));

    const normalized = normalizeThreadColors(graph, { digitizingMode: "line-art" });

    expect(new Set(normalized.design.objects.map((object) => object.colorIndex))).toEqual(new Set([0]));
    expect(new Set(normalized.nodes.map((node) => node.object.colorIndex))).toEqual(new Set([0]));
    expect(normalized.design.objects.every((object) => object.rgb[2] === 255)).toBe(true);
  });

  it("does not alter non-line-art graphs", () => {
    const graph = buildDesignGraph(makeDesign([
      makeRun("a", [[0, 0], [2, 0]], 0, [0, 128, 255]),
      makeRun("b", [[0, 1], [2, 1]], 1, [255, 0, 0]),
    ]));

    const normalized = normalizeThreadColors(graph, { digitizingMode: "photo-stitch" });

    expect(normalized.design.objects.map((object) => object.colorIndex)).toEqual([0, 1]);
  });
});

function makeRun(
  id: string,
  outer: Point2D[],
  colorIndex: number,
  rgb: [number, number, number],
): EmbroideryObject {
  return {
    id,
    kind: "run",
    baseKind: "run",
    colorIndex,
    rgb,
    shape: { outer, holes: [] },
    props: { densityMm: 0.4, maxStitchMm: 4 },
    strokeKind: "thin-run",
    strokeRole: "outline",
    order: colorIndex,
  };
}

function makeDesign(objects: EmbroideryObject[]): EmbroideryDesign {
  return {
    widthMm: 12,
    heightMm: 8,
    fabric: FABRIC_PROFILES.denim,
    objects,
  };
}
