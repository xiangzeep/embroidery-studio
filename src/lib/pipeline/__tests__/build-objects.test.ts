import { describe, it, expect } from "vitest";
import { buildObjects } from "../build-objects";
import { generateStitches } from "../stitch";
import { FABRIC_PROFILES } from "../fabric";
import type { ColorRegion } from "../vectorize";
import type { StitchKind } from "../types";

describe("buildObjects — 基本", () => {
  it("translated case", () => {
    const result = buildObjects({
      regions: [],
      widthMm: 100,
      widthPx: 1000,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toEqual([]);
  });

  it("translated case", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{ outer: [[0, 0], [1, 1]], holes: [] }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 100,
      widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toEqual([]);
  });
});

describe("buildObjects — kind 判定: fill", () => {
  it("translated case", () => {
    const square: ColorRegion = {
      colorIndex: 0,
      rgb: [255, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]], // px coordinates
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [square],
      widthMm: 10, widthPx: 100, // 1px = 0.1mm
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "fill",
      colorIndex: 0,
      rgb: [255, 0, 0],
      order: 0,
    });
    // English note.
    expect(result[0].shape.outer).toEqual([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ]);
    expect(result[0].shape.holes).toEqual([]);
  });

  it("translated case", () => {
    const region: ColorRegion = {
      colorIndex: 2,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [
        { outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] },
        { outer: [[200, 200], [300, 200], [300, 300], [200, 300]], holes: [] },
      ],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 30, widthPx: 300,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result.map((o) => o.id)).toEqual(["2-0", "2-1"]);
    expect(result.map((o) => o.order)).toEqual([0, 1]);
  });
});

describe("buildObjects — kind 判定: satin / run", () => {
  it("forces run when outlineFontStrategy is prefer-run for ambiguous line-art strokes", () => {
    const stripe: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [[0, 0], [180, 0], [180, 18], [0, 18]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 18,
      widthPx: 180,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      digitizingMode: "line-art",
      outlineFontStrategy: "prefer-run",
    });
    expect(result[0].strokeRole).toBe("outline");
    expect(result[0].kind).toBe("run");
  });

  it("keeps decorative bands on satin in auto mode", () => {
    const stripe: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [[0, 0], [220, 0], [220, 26], [0, 26]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 22,
      widthPx: 220,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      digitizingMode: "photo-stitch",
      outlineFontStrategy: "auto",
    });
    expect(result[0].strokeRole).toBe("decorative-band");
    expect(result[0].kind).toBe("satin");
  });

  it("routes medium-width line-art contour loops to run instead of satin", () => {
    const contourLoop: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [[0, 0], [180, 0], [180, 23], [0, 23]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [contourLoop],
      widthMm: 18,
      widthPx: 180,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      digitizingMode: "line-art",
      outlineFontStrategy: "auto",
    });
    expect(result[0].strokeKind).toBe("bean-run");
    expect(result[0].strokeRole).toBe("outline");
    expect(result[0].kind).toBe("run");
  });

  it("routes narrow closed line-art loops to run using sampled skeleton width", () => {
    const contourLoop: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [
          [0, 0], [120, 0], [120, 100], [0, 100],
        ],
        holes: [[
          [20, 20], [100, 20], [100, 80], [20, 80],
        ]],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [contourLoop],
      widthMm: 12,
      widthPx: 120,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      digitizingMode: "line-art",
      outlineFontStrategy: "auto",
    });

    expect(result[0].strokeKind).toBe("bean-run");
    expect(result[0].strokeRole).toBe("outline");
    expect(result[0].kind).toBe("run");
  });

  it("keeps broader closed line-art loop bands on satin", () => {
    const contourLoop: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [
          [0, 0], [120, 0], [120, 100], [0, 100],
        ],
        holes: [[
          [30, 30], [90, 30], [90, 70], [30, 70],
        ]],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [contourLoop],
      widthMm: 12,
      widthPx: 120,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      digitizingMode: "line-art",
      outlineFontStrategy: "auto",
    });

    expect(result[0].strokeKind).toBe("narrow-satin");
    expect(result[0].strokeRole).toBe("decorative-band");
    expect(result[0].kind).toBe("satin");
  });

  it("keeps flared petal-like line-art loop bands on satin", () => {
    const contourLoop: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [
          [0, 50], [20, 10], [85, 0], [120, 35], [110, 70], [70, 100], [20, 90],
        ],
        holes: [[
          [18, 50], [32, 28], [78, 22], [92, 44], [86, 62], [62, 78], [32, 72],
        ]],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [contourLoop],
      widthMm: 12,
      widthPx: 120,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      digitizingMode: "line-art",
      outlineFontStrategy: "auto",
    });

    expect(result[0].strokeKind).toBe("narrow-satin");
    expect(result[0].strokeRole).toBe("decorative-band");
    expect(result[0].kind).toBe("satin");
  });

  it("translated case", () => {
    // 100px x 8px = 10mm x 0.8mm (mmPerPx = 0.1)
    const stripe: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 8], [0, 8]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 10, widthPx: 100,
      digitizingMode: "photo-stitch",
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("satin");
  });

  it("translated case", () => {
    // 100px x 4px → 10mm x 0.4mm
    const thin: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 4], [0, 4]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [thin],
      widthMm: 10, widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      runMaxWidthMm: 0.6,
      satinMaxWidthMm: 6,
    });
    expect(result[0].kind).toBe("run");
  });

  it("translated case", () => {
    // 100px x 50px → 10mm x 5mm, aspect = 2
    const chubby: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 50], [0, 50]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [chubby],
      widthMm: 10, widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("fill");
  });
});

describe("translated case", () => {
  it("translated case", () => {
    const donut: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [200, 0], [200, 200], [0, 200]], // 20mm 角
        holes: [[[80, 80], [120, 80], [120, 120], [80, 120]]], // English note.
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [donut],
      widthMm: 20, widthPx: 200,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("fill"); // English note.
    expect(result[0].shape.holes).toEqual([
      [[8, 8], [12, 8], [12, 12], [8, 12]],
    ]);
  });

  it("translated case", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
        holes: [[[10, 10], [20, 10]]], // English note.
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 10, widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result[0].shape.holes).toEqual([]);
  });
});

describe("buildObjects — layer stitch policy", () => {
  it("uses no underlay or lockstitch for narrow outline layers", () => {
    const stripe: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [{ outer: [[10, 10], [110, 10], [110, 18], [10, 18]], holes: [] }],
      polygons: [],
    };

    const result = buildObjects({
      regions: [stripe],
      widthMm: 20,
      widthPx: 200,
      heightPx: 200,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });

    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe("outline");
    expect(result[0].props.underlay).toEqual({ kind: "none" });
    expect(result[0].props.lockstitch).toBe(false);
  });

  it("keeps underlay and lockstitch for base fill layers", () => {
    const fill: ColorRegion = {
      colorIndex: 0,
      rgb: [20, 40, 180],
      svgPath: "",
      shapes: [{ outer: [[20, 20], [150, 20], [150, 150], [20, 150]], holes: [] }],
      polygons: [],
    };

    const result = buildObjects({
      regions: [fill],
      widthMm: 20,
      widthPx: 200,
      heightPx: 200,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });

    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe("base-fill");
    expect(result[0].props.underlay?.kind).not.toBe("none");
    expect(result[0].props.lockstitch).toBe(true);
  });
});

describe("translated case", () => {
  it("translated case", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 10, widthPx: 100,
      fabric: FABRIC_PROFILES.denim, // defaultDensityMm = 0.40
      satinMaxWidthMm: 6,
    });
    expect(result[0].props.densityMm).toBeCloseTo(0.40);
    expect(result[0].props.pushCompMm).toBe(FABRIC_PROFILES.denim.defaultPushCompMm);
    expect(result[0].props.maxStitchMm).toBe(7);
  });

  it("translated case", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
      polygons: [],
    };
    const opts = {
      regions: [region],
      widthMm: 10, widthPx: 100,
      satinMaxWidthMm: 6,
    };
    const denim = buildObjects({ ...opts, fabric: FABRIC_PROFILES.denim });
    const terry = buildObjects({ ...opts, fabric: FABRIC_PROFILES.terry });
    expect(terry[0].props.densityMm).toBeGreaterThan(denim[0].props.densityMm);
  });

  it("translated case", () => {
    // 100px x 8px → 10mm x 0.8mm 帯
    const stripe: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 8], [0, 8]], holes: [] }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 10, widthPx: 100,
      digitizingMode: "photo-stitch",
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("satin");
    // pullCompForWidth(denim, 0.8) = max(0.10, 0.025 * 0.8) = max(0.10, 0.02) = 0.10
    expect(result[0].props.pullCompMm).toBeCloseTo(0.10);
  });

  it("translated case", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 10, widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result[0].props.underlay).toEqual(
      FABRIC_PROFILES.denim.underlayPolicy.fill(),
    );
  });
});

describe("translated case", () => {
  // NOTE (documentation-level regression guard):
  // English note.
  // English note.
  // English note.
  // English note.
  // English note.
  // English note.
  it("translated case", () => {
    // mmPerPx = 50/500 = 0.1
    // Region 0: 100×100 px = 10×10 mm 正方形 → fill
    // Region 1: 100×8  px = 10×0.8 mm 帯, aspect=12.5 > 4 → satin
    // Region 2: 100x4 px = 10x0.4 mm thin line, shortSide < 0.6 -> run
    const regions: ColorRegion[] = [
      {
        colorIndex: 0, rgb: [255, 0, 0], svgPath: "",
        shapes: [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
        polygons: [],
      },
      {
        colorIndex: 1, rgb: [0, 255, 0], svgPath: "",
        shapes: [{ outer: [[150, 0], [250, 0], [250, 8], [150, 8]], holes: [] }],
        polygons: [],
      },
      {
        colorIndex: 2, rgb: [0, 0, 255], svgPath: "",
        shapes: [{ outer: [[0, 150], [100, 150], [100, 154], [0, 154]], holes: [] }],
        polygons: [],
      },
    ];
    const sharedOpts = {
      widthMm: 50, widthPx: 500,
      satinMaxWidthMm: 6,
      digitizingMode: "photo-stitch" as const,
    };

    const objects = buildObjects({
      ...sharedOpts,
      regions,
      fabric: FABRIC_PROFILES.denim,
    });
    const pattern = generateStitches({
      ...sharedOpts,
      // English note.
      heightMm: 50, heightPx: 500,
      regions,
      fabric: FABRIC_PROFILES.denim,
      stitchDensityMm: 0.4,
      // English note.
      // English note.
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    // 期待: 3 Object (fill / satin / run)
    expect(objects.map((o) => o.kind)).toEqual(["fill", "satin", "run"]);

    // English note.
    const renderableKinds: StitchKind[] = ["run", "satin", "fill"];
    const kindsByBlock = pattern.blocks.map((b) =>
      Array.from(
        new Set(
          b.stitches
            .filter((s) => renderableKinds.includes(s.kind))
            .map((s) => s.kind),
        ),
      ),
    );
    // English note.
    expect(kindsByBlock).toEqual([["fill"], ["satin"], ["run"]]);
  });
});

describe("buildObjects small-region cleanup", () => {
  it("drops shapes below the minimum pixel area", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [
        { outer: [[0, 0], [2, 0], [2, 2], [0, 2]], holes: [] },
        { outer: [[10, 10], [20, 10], [20, 20], [10, 20]], holes: [] },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 20,
      widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      minRegionAreaPx: 12,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("0-1");
    expect(result[0].shape.outer).toEqual([
      [2, 2], [4, 2], [4, 4], [2, 4],
    ]);
  });

  it("uses outer area minus hole area when applying the cleanup threshold", () => {
    const region: ColorRegion = {
      colorIndex: 1,
      rgb: [255, 0, 0],
      svgPath: "",
      shapes: [
        {
          outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
          holes: [[[1, 1], [9, 1], [9, 9], [1, 9]]],
        },
        { outer: [[20, 0], [30, 0], [30, 10], [20, 10]], holes: [] },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 30,
      widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      minRegionAreaPx: 40,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1-1");
  });
});

describe("buildObjects white background cleanup", () => {
  it("drops near-white shapes that touch the canvas edge", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [250, 250, 250],
      svgPath: "",
      shapes: [
        { outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 100,
      widthPx: 100,
      heightPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      removeWhiteBackground: true,
    });

    expect(result).toEqual([]);
  });

  it("keeps near-white shapes that do not touch the canvas edge", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [250, 250, 250],
      svgPath: "",
      shapes: [
        { outer: [[20, 20], [80, 20], [80, 80], [20, 80]], holes: [] },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 100,
      widthPx: 100,
      heightPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      removeWhiteBackground: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].rgb).toEqual([250, 250, 250]);
  });
});

describe("buildObjects shape metrics classification", () => {
  it("classifies compact tiny shapes as fill instead of run", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [20, 20, 20],
      svgPath: "",
      shapes: [
        { outer: [[0, 0], [4, 0], [4, 4], [0, 4]], holes: [] },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 10,
      widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      minRegionAreaPx: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("fill");
    expect(result[0].metrics).toMatchObject({
      areaMm2: expect.any(Number),
      holeCount: 0,
    });
  });

  it("keeps long thin shapes as run", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [20, 20, 20],
      svgPath: "",
      shapes: [
        { outer: [[0, 0], [100, 0], [100, 4], [0, 4]], holes: [] },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 10,
      widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });

    expect(result[0].kind).toBe("run");
    expect(result[0].metrics?.aspectRatio).toBeGreaterThan(10);
  });
});

describe("buildObjects boundary simplification", () => {
  it("simplifies low-amplitude jagged boundaries before object creation", () => {
    const region: ColorRegion = {
      colorIndex: 0,
      rgb: [220, 80, 200],
      svgPath: "",
      shapes: [
        {
          outer: [[0, 0], [10, 0.4], [20, -0.3], [30, 0.2], [40, 0], [40, 20], [0, 20]],
          holes: [],
        },
      ],
      polygons: [],
    };

    const result = buildObjects({
      regions: [region],
      widthMm: 40,
      widthPx: 40,
      heightPx: 20,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      boundarySimplifyTolerancePx: 0.75,
    });

    expect(result).toHaveLength(1);
    expect(result[0].shape.outer.length).toBeLessThan(region.shapes[0].outer.length);
  });
});
