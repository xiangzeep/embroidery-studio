import { describe, expect, test } from "vitest";
import { beanStitchPolyline } from "../bean-stitch";
import { renderRun, type RenderContext } from "../render";
import {
  doubleRunPolyline,
  styleRunSegment,
  tripleRunPolyline,
} from "../run-style";
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

describe("run stitch style controller", () => {
  test("uses double run for very short decorative open paths", () => {
    expect(doubleRunPolyline([[0, 0], [2, 0], [4, 0]])).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
      [2, 0],
      [0, 0],
    ]);
  });

  test("uses triple run for long backbone paths", () => {
    expect(tripleRunPolyline([[0, 0], [2, 0], [4, 0]])).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
      [2, 0],
      [0, 0],
      [2, 0],
      [4, 0],
    ]);
  });

  test("selects closed bean, generic reinforcement, and single thin-run styles", () => {
    const closed = styleRunSegment(
      [[0, 0], [2, 0], [2, 2], [0.6, 1.8]],
      { closed: true, maxStitchMm: 7 },
    );
    const genericLong = styleRunSegment(
      [[0, 0], [12, 0], [24, 0]],
      { maxStitchMm: 7 },
    );
    const genericShort = styleRunSegment(
      [[0, 0], [2, 0], [4, 0]],
      { maxStitchMm: 7 },
    );
    const thinRun = styleRunSegment(
      [[0, 0], [2, 0], [4, 0]],
      { strokeKind: "thin-run", maxStitchMm: 7 },
    );

    expect(closed.length).toBeGreaterThan(4);
    expect(genericLong).toEqual(tripleRunPolyline([[0, 0], [12, 0], [24, 0]]));
    expect(genericShort).toEqual(doubleRunPolyline([[0, 0], [2, 0], [4, 0]]));
    expect(thinRun).toEqual([[0, 0], [2, 0], [4, 0]]);
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
