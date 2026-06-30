import { describe, expect, test } from "vitest";
import { renderCurvedStrokeSatin, shouldRenderAsStrokeSatin } from "../curved-satin";
import { renderDesign } from "../render";
import type { EmbroideryDesign, EmbroideryObject, Shape } from "../types";

const shape: Shape = {
  outer: [
    [0, 0],
    [30, 0],
    [30, 2],
    [0, 2],
  ],
  holes: [],
};

const object: EmbroideryObject = {
  id: "medium-stroke",
  kind: "fill",
  layer: "outline",
  colorIndex: 0,
  rgb: [0, 120, 255],
  shape,
  strokeKind: "narrow-satin",
  props: {
    densityMm: 2,
    maxStitchMm: 7,
    underlay: { kind: "none" },
    lockstitch: false,
  },
  order: 0,
};

const design: EmbroideryDesign = {
  widthMm: 40,
  heightMm: 10,
  fabric: {
    kind: "twill",
    defaultDensityMm: 2,
    pullCompPerWidth: 0,
    minPullCompMm: 0,
    defaultPushCompMm: 0,
    underlayPolicy: {
      run: () => ({ kind: "none" }),
      satin: () => ({ kind: "none" }),
      fill: () => ({ kind: "none" }),
    },
  },
  objects: [object],
};

describe("shouldRenderAsStrokeSatin", () => {
  test("uses satin for narrow and border stroke kinds", () => {
    expect(shouldRenderAsStrokeSatin("narrow-satin")).toBe(true);
    expect(shouldRenderAsStrokeSatin("border-satin")).toBe(true);
  });

  test("does not use satin for run-oriented stroke kinds", () => {
    expect(shouldRenderAsStrokeSatin("thin-run")).toBe(false);
    expect(shouldRenderAsStrokeSatin("bean-run")).toBe(false);
    expect(shouldRenderAsStrokeSatin("none")).toBe(false);
  });
});

describe("renderDesign stroke satin routing", () => {
  test("respects final object kind instead of forcing satin from strokeKind alone", () => {
    const pattern = renderDesign(design, {
      widthMm: 40,
      heightMm: 10,
      widthPx: 40,
      stitchDensityMm: 2,
      satinMaxWidthMm: 6,
      disableUnderlay: true,
      disableLockstitch: true,
      disableCompensation: true,
    });

    const stitches = pattern.blocks.flatMap((block) => block.stitches);

    expect(stitches.some((stitch) => stitch.kind === "fill")).toBe(true);
    expect(stitches.some((stitch) => stitch.kind === "satin")).toBe(false);
  });
});

describe("renderCurvedStrokeSatin", () => {
  test("rotates satin spans with the local curve instead of using one global direction", () => {
    const bentStroke: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 2],
        [6, 2],
        [6, 8],
        [8, 8],
        [8, 10],
        [0, 10],
        [0, 8],
        [4, 8],
        [4, 2],
        [0, 2],
      ],
      holes: [],
    };

    const stitches = renderCurvedStrokeSatin(bentStroke, 1, 7);

    expect(stitches.length).toBeGreaterThan(10);
    const spanAngles: number[] = [];
    for (let i = 0; i + 1 < stitches.length; i += 2) {
      const a = stitches[i];
      const b = stitches[i + 1];
      spanAngles.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    const normalized = spanAngles.map((angle) => {
      const wrapped = Math.abs(angle) % Math.PI;
      return wrapped > Math.PI / 2 ? Math.PI - wrapped : wrapped;
    });
    expect(Math.max(...normalized) - Math.min(...normalized)).toBeGreaterThan(0.5);
  });
});
