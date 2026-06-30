import { describe, expect, it } from "vitest";
import { groupObjectsByLayerOrder, layerOrderRank } from "../layer-ordering";
import type { EmbroideryObject } from "../types";

function obj(id: string, layer: EmbroideryObject["layer"], colorIndex: number): EmbroideryObject {
  return {
    id,
    layer,
    colorIndex,
    rgb: [0, 0, 0],
    order: 0,
    kind: "fill",
    shape: { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
    props: { densityMm: 0.4, maxStitchMm: 7 },
  };
}

describe("layer ordering", () => {
  it("orders embroidery layers from base fill to highlight", () => {
    expect([
      layerOrderRank("base-fill"),
      layerOrderRank("detail"),
      layerOrderRank("outline"),
      layerOrderRank("highlight"),
    ]).toEqual([0, 1, 2, 3]);
  });

  it("groups objects by layer order before color order", () => {
    const grouped = groupObjectsByLayerOrder([
      obj("outline", "outline", 0),
      obj("base", "base-fill", 9),
      obj("highlight", "highlight", 1),
      obj("detail", "detail", 2),
    ]);

    expect(grouped.map((group) => group.layer)).toEqual([
      "base-fill",
      "detail",
      "outline",
      "highlight",
    ]);
    expect(grouped.flatMap((group) => group.objects.map((item) => item.id))).toEqual([
      "base",
      "detail",
      "outline",
      "highlight",
    ]);
  });
});
