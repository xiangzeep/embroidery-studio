import { describe, expect, test } from "vitest";
import { beanStitchPolyline } from "../bean-stitch";
import { renderRun, type RenderContext } from "../render";
import type { EmbroideryObject, Shape } from "../types";

const shape: Shape = {
  outer: [
    [0, 0],
    [12, 0],
    [12, 1],
    [0, 1],
  ],
  holes: [],
};

const baseObject: EmbroideryObject = {
  id: "stroke",
  kind: "run",
  layer: "outline",
  colorIndex: 0,
  rgb: [0, 120, 255],
  shape,
  props: {
    densityMm: 2,
    maxStitchMm: 7,
    underlay: { kind: "none" },
    lockstitch: false,
  },
  order: 0,
};

const ctx: RenderContext = {
  opts: {
    widthMm: 20,
    heightMm: 10,
    widthPx: 20,
    stitchDensityMm: 2,
    satinMaxWidthMm: 6,
    disableUnderlay: true,
    disableLockstitch: true,
    disableCompensation: true,
    disableMedialAxis: true,
  },
};

describe("beanStitchPolyline", () => {
  test("emits forward-back-forward points for each segment", () => {
    expect(beanStitchPolyline([[0, 0], [2, 0], [4, 0]], 7)).toEqual([
      [0, 0],
      [2, 0],
      [0, 0],
      [2, 0],
      [4, 0],
      [2, 0],
      [4, 0],
    ]);
  });

  test("splits long source segments before bean reinforcement", () => {
    const pts = beanStitchPolyline([[0, 0], [6, 0]], 2);

    expect(pts).toEqual([
      [0, 0],
      [2, 0],
      [0, 0],
      [2, 0],
      [4, 0],
      [2, 0],
      [4, 0],
      [6, 0],
      [4, 0],
      [6, 0],
    ]);
  });
});

describe("renderRun bean-run integration", () => {
  test("bean-run emits more reinforcing run stitches than normal run", () => {
    const normal = renderRun(baseObject, ctx).filter((s) => s.kind === "run");
    const bean = renderRun({
      ...baseObject,
      strokeKind: "bean-run",
    }, ctx).filter((s) => s.kind === "run");

    expect(bean.length).toBeGreaterThan(normal.length);
  });
});
