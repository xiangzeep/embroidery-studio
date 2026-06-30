import { describe, expect, it } from "vitest";
import {
  isSafeTravelBetweenObjects,
  isSegmentInsideShape,
} from "../safe-travel";
import type { EmbroideryObject, Shape } from "../types";

function rect(x: number, y: number, width: number, height: number): Shape {
  return {
    outer: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
    holes: [],
  };
}

function object(id: string, shape: Shape, layer: EmbroideryObject["layer"]): EmbroideryObject {
  return {
    id,
    kind: "fill",
    layer,
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape,
    props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
    order: 0,
  };
}

function strokeObject(id: string, shape: Shape): EmbroideryObject {
  return {
    ...object(id, shape, "outline"),
    kind: "run",
    strokeKind: "bean-run",
    strokeMetrics: {
      areaMm2: 10,
      perimeterMm: 20,
      bboxWidthMm: 10,
      bboxHeightMm: 1,
      estimatedWidthMm: 1,
      estimatedLengthMm: 10,
      slenderness: 10,
      compactness: 0.1,
      holeCount: 0,
      isStrokeLike: true,
    },
  };
}

describe("safe travel geometry", () => {
  it("allows a travel segment fully inside one stitchable shape", () => {
    expect(isSegmentInsideShape(rect(0, 0, 10, 10), [2, 2], [8, 8])).toBe(true);
  });

  it("rejects a travel segment crossing a hole", () => {
    const donut: Shape = {
      outer: rect(0, 0, 10, 10).outer,
      holes: [rect(4, 4, 2, 2).outer],
    };

    expect(isSegmentInsideShape(donut, [2, 5], [8, 5])).toBe(false);
  });

  it("rejects travel between different layers", () => {
    const from = object("a", rect(0, 0, 10, 10), "base-fill");
    const to = object("a", rect(0, 0, 10, 10), "outline");

    expect(isSafeTravelBetweenObjects({ fromObject: from, toObject: to, from: [2, 2], to: [8, 8] })).toBe(false);
  });

  it("rejects travel between disconnected objects even when they share color and layer", () => {
    const from = object("a", rect(0, 0, 10, 10), "base-fill");
    const to = object("b", rect(12, 0, 10, 10), "base-fill");

    expect(isSafeTravelBetweenObjects({ fromObject: from, toObject: to, from: [10, 5], to: [12, 5] })).toBe(false);
  });

  it("allows short travel between touching objects that share color and layer", () => {
    const from = object("a", rect(0, 0, 10, 10), "outline");
    const to = object("b", rect(10, 0, 10, 10), "outline");

    expect(isSafeTravelBetweenObjects({ fromObject: from, toObject: to, from: [9.5, 5], to: [10.5, 5] })).toBe(true);
  });

  it("allows a tiny aligned connector between same-color stroke fragments", () => {
    const from = strokeObject("a", rect(0, 0, 10, 1));
    const to = strokeObject("b", rect(11.2, 0, 10, 1));

    expect(isSafeTravelBetweenObjects({ fromObject: from, toObject: to, from: [10, 0.5], to: [11.2, 0.5] })).toBe(true);
  });

  it("does not allow tiny connectors between ordinary fill fragments", () => {
    const from = object("a", rect(0, 0, 10, 1), "outline");
    const to = object("b", rect(11.2, 0, 10, 1), "outline");

    expect(isSafeTravelBetweenObjects({ fromObject: from, toObject: to, from: [10, 0.5], to: [11.2, 0.5] })).toBe(false);
  });

  it("rejects stroke connectors when the gap is not aligned with the stroke", () => {
    const from = strokeObject("a", rect(0, 0, 10, 1));
    const to = strokeObject("b", rect(11.2, 3, 10, 1));

    expect(isSafeTravelBetweenObjects({ fromObject: from, toObject: to, from: [10, 0.5], to: [11.2, 3.5] })).toBe(false);
  });

  it("allows tiny connectors when local endpoint tangents align even if the whole shape bends", () => {
    const bentStroke: Shape = {
      outer: [
        [0, 0],
        [6, 0],
        [6, 1],
        [3, 1],
        [3, 5],
        [2, 5],
        [2, 1],
        [0, 1],
      ],
      holes: [],
    };
    const to = strokeObject("b", rect(6.2, 0, 4, 1));

    expect(
      isSafeTravelBetweenObjects({
        fromObject: strokeObject("a", bentStroke),
        toObject: to,
        from: [6, 0.5],
        to: [6.2, 0.5],
      }),
    ).toBe(true);
  });
});
