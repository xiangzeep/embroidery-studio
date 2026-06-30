import { describe, expect, it } from "vitest";
import { assignLayers, classifyLayer, type LayerKind } from "../layers";
import type { ColorRegion } from "../vectorize";
import type { Shape } from "../types";

function rect(x: number, y: number, width: number, height: number): Shape {
  return {
    outer: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
    holes: [],
  };
}

function region(colorIndex: number, rgb: [number, number, number], shapes: Shape[]): ColorRegion {
  return { colorIndex, rgb, svgPath: "", shapes, polygons: shapes.map((shape) => shape.outer) };
}

describe("classifyLayer", () => {
  const canvas = { widthPx: 256, heightPx: 256 };

  it.each<[string, Shape, [number, number, number], LayerKind]>([
    ["edge white background", rect(0, 0, 256, 256), [250, 250, 250], "background"],
    ["interior white highlight", rect(96, 96, 24, 24), [252, 252, 252], "highlight"],
    ["large compact colored fill", rect(40, 40, 120, 110), [220, 80, 200], "base-fill"],
    ["long narrow colored outline", rect(20, 120, 180, 8), [20, 20, 80], "outline"],
    ["small meaningful color detail", rect(160, 100, 18, 18), [240, 120, 10], "detail"],
    ["tiny isolated noise", rect(200, 200, 2, 2), [20, 20, 20], "noise"],
  ])("classifies %s", (_name, shape, rgb, expected) => {
    expect(classifyLayer({ shape, rgb, ...canvas })).toBe(expected);
  });
});

describe("assignLayers", () => {
  it("keeps region identity while assigning layer kinds", () => {
    const regions: ColorRegion[] = [
      region(0, [250, 250, 250], [rect(0, 0, 256, 256)]),
      region(1, [20, 20, 80], [rect(20, 120, 180, 8), rect(160, 100, 18, 18)]),
    ];

    const layered = assignLayers({ regions, widthPx: 256, heightPx: 256 });

    expect(layered.map((item) => ({ colorIndex: item.colorIndex, shapeIndex: item.shapeIndex, layer: item.layer }))).toEqual([
      { colorIndex: 0, shapeIndex: 0, layer: "background" },
      { colorIndex: 1, shapeIndex: 0, layer: "outline" },
      { colorIndex: 1, shapeIndex: 1, layer: "detail" },
    ]);
  });
});
