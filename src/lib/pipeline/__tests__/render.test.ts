import { describe, it, expect } from "vitest";
import {
  __internal,
  connectObjects,
  connectObjectsWithSafety,
  generateStitches,
  renderDesign,
  renderRun,
  renderSatin,
  renderFill,
  type RenderContext,
  type RenderOptions,
} from "../render";
import { TRIM_POLICY_BY_FORMAT } from "../policy";
import { buildObjects } from "../build-objects";
import { FABRIC_PROFILES } from "../fabric";
import type {
  EmbroideryDesign,
  EmbroideryObject,
  ObjectProps,
  Shape,
  StitchBlock,
} from "../types";
import type { ColorRegion } from "../vectorize";

const DUMMY_PROPS: ObjectProps = { densityMm: 1, maxStitchMm: 7 };
const CONTROL_KINDS = new Set(["jump", "trim", "stop"]);

function makeCtx(overrides: Partial<RenderContext["opts"]> = {}): RenderContext {
  // English note.
  // English note.
  // English note.
  const opts = {
    widthMm: 100,
    heightMm: 100,
    widthPx: 100,
    stitchDensityMm: 1,
    satinMaxWidthMm: 2,
    disableUnderlay: true,
    disableCompensation: true,
    disableLockstitch: true,
    ...overrides,
  };
  return { opts };
}

function maxRealStitchDistance(stitches: Array<{ x: number; y: number; kind: string }>): number {
  let max = 0;
  for (let i = 1; i < stitches.length; i++) {
    if (CONTROL_KINDS.has(stitches[i - 1].kind) || CONTROL_KINDS.has(stitches[i].kind)) continue;
    max = Math.max(max, Math.hypot(stitches[i].x - stitches[i - 1].x, stitches[i].y - stitches[i - 1].y));
  }
  return max;
}

const {
  fillStitches,
  intersectScanline,
  analyzeShape,
  appendStitchesWithJumps,
  resolveShapeFillAngle,
} = __internal;

describe("intersectScanline (multi-ring)", () => {
  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const xs = intersectScanline([outer], 0, 5, [1, 0]);
    xs.sort((a, b) => a - b);
    expect(xs.length).toBe(2);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[1]).toBeCloseTo(10);
  });

  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: [number, number][] = [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ];
    const xs = intersectScanline([outer, hole], 0, 5, [1, 0]);
    xs.sort((a, b) => a - b);
    expect(xs.length).toBe(4);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[1]).toBeCloseTo(3);
    expect(xs[2]).toBeCloseTo(7);
    expect(xs[3]).toBeCloseTo(10);
  });
});

describe("fillStitches with hole", () => {
  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const hole: [number, number][] = [
      [8, 8],
      [12, 8],
      [12, 12],
      [8, 12],
    ];
    const shape: Shape = { outer, holes: [hole] };
    // English note.
    const segments = fillStitches(shape, 1, 0);
    const allPts = segments.flat();
    // English note.
    for (let yi = 9; yi <= 11; yi++) {
      const onLine = allPts.filter(
        ([, y]: [number, number]) => Math.abs(y - yi) < 0.5,
      );
      const inHole = onLine.filter(
        ([x]: [number, number]) => x > 8.5 && x < 11.5,
      );
      expect(inHole.length).toBe(0);
    }
  });

  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const hole: [number, number][] = [
      [8, 8],
      [12, 8],
      [12, 12],
      [8, 12],
    ];
    const shape: Shape = { outer, holes: [hole] };
    const segments = fillStitches(shape, 1, 0);
    // English note.
    for (const seg of segments) {
      expect(seg.length).toBe(2);
    }
    // English note.
    const segsOnHoleLine = segments.filter(
      (seg) => Math.abs(seg[0][1] - 10) < 0.5,
    );
    expect(segsOnHoleLine.length).toBeGreaterThanOrEqual(2);
  });

  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const shape: Shape = { outer, holes: [] };
    const segments = fillStitches(shape, 1, 0);
    expect(segments.length).toBeGreaterThan(0);
    for (const seg of segments) {
      expect(seg.length).toBe(2);
    }
  });
});

describe("translated case", () => {
  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [0, 2],
    ];
    const r = analyzeShape(outer);
    expect(r.shortSide).toBeCloseTo(2, 1);
  });
});

describe("appendStitchesWithJumps - basic", () => {
  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [],
    };
    appendStitchesWithJumps(
      block,
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      "run",
      0,
      7,
      8,
      true,
    );
    expect(block.stitches.every((s) => s.kind === "run")).toBe(true);
    expect(block.stitches.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [{ x: 0, y: 0, kind: "run", colorIndex: 0 }],
    };
    appendStitchesWithJumps(
      block,
      [
        [5, 0],
        [6, 0],
        [7, 0],
      ],
      "fill",
      0,
      7,
      8,
      true,
    );
    // 期待: prev(0,0), jump(5,0), fill(5,0), fill(6,0), fill(7,0)
    expect(block.stitches.length).toBe(5);
    expect(block.stitches[1]).toMatchObject({ x: 5, y: 0, kind: "jump" });
    expect(block.stitches[2]).toMatchObject({ x: 5, y: 0, kind: "fill" });
    expect(block.stitches[3]).toMatchObject({ x: 6, y: 0, kind: "fill" });
    expect(block.stitches[4]).toMatchObject({ x: 7, y: 0, kind: "fill" });
    // English note.
    const fillsInGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 0 && s.x < 5,
    );
    expect(fillsInGap.length).toBe(0);
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [{ x: 0, y: 0, kind: "fill", colorIndex: 0 }],
    };
    appendStitchesWithJumps(
      block,
      [
        [50, 0],
        [51, 0],
      ],
      "fill",
      0,
      7,
      8,
      true,
    );
    // 期待: prev(0,0), trim(0,0), jump(50,0), fill(50,0), fill(51,0)
    expect(block.stitches.length).toBe(5);
    expect(block.stitches[1]).toMatchObject({ x: 0, y: 0, kind: "trim" });
    expect(block.stitches[2]).toMatchObject({ x: 50, y: 0, kind: "jump" });
    expect(block.stitches[3]).toMatchObject({ x: 50, y: 0, kind: "fill" });
    expect(block.stitches[4]).toMatchObject({ x: 51, y: 0, kind: "fill" });
    // English note.
    const fillStitchesOnGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 0 && s.x < 50,
    );
    expect(fillStitchesOnGap.length).toBe(0);
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [{ x: 0, y: 0, kind: "run", colorIndex: 0 }],
    };
    appendStitchesWithJumps(
      block,
      [
        [3, 0],
        [6, 0],
      ],
      "run",
      0,
      7,
      8,
      false,
    );
    expect(block.stitches.length).toBe(3);
    expect(block.stitches.every((s) => s.kind === "run")).toBe(true);
    expect(block.stitches.map((s) => s.x)).toEqual([0, 3, 6]);
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [{ x: 0, y: 0, kind: "run", colorIndex: 0 }],
    };
    appendStitchesWithJumps(
      block,
      [
        [20, 0],
        [21, 0],
      ],
      "run",
      0,
      7,
      8,
      false,
    );
    // 期待: prev(0,0), trim(0,0), jump(20,0), run(20,0), run(21,0)
    expect(block.stitches[1].kind).toBe("trim");
    expect(block.stitches[2]).toMatchObject({ x: 20, y: 0, kind: "jump" });
    expect(block.stitches[3]).toMatchObject({ x: 20, y: 0, kind: "run" });
    expect(block.stitches[4]).toMatchObject({ x: 21, y: 0, kind: "run" });
    const runOnGap = block.stitches.filter(
      (s) => s.kind === "run" && s.x > 0 && s.x < 20,
    );
    expect(runOnGap.length).toBe(0);
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [{ x: 0, y: 0, kind: "fill", colorIndex: 0 }],
    };
    appendStitchesWithJumps(block, [[50, 0]], "fill", 0, 7, 8, true);
    // 期待: prev(0,0), trim(0,0), jump(50,0), fill(50,0)
    expect(block.stitches.length).toBe(4);
    expect(block.stitches[1].kind).toBe("trim");
    expect(block.stitches[2]).toMatchObject({ x: 50, y: 0, kind: "jump" });
    expect(block.stitches[3]).toMatchObject({ x: 50, y: 0, kind: "fill" });
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [],
    };
    appendStitchesWithJumps(
      block,
      [
        [0, 0],
        [14, 0],
      ],
      "fill",
      0,
      7,
      8,
      false,
    );
    expect(block.stitches.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [7, 0],
      [14, 0],
    ]);
    expect(block.stitches.every((s) => s.kind === "fill")).toBe(true);
  });

  it("translated case", () => {
    const block: StitchBlock = {
      colorIndex: 0,
      rgb: [0, 0, 0],
      stitches: [{ x: 0, y: 0, kind: "fill", colorIndex: 0 }],
    };
    appendStitchesWithJumps(
      block,
      [
        [100, 0],
        [101, 0],
      ],
      "fill",
      0,
      7,
      8,
      true,
    );
    // English note.
    const fillsInGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 0 && s.x < 100,
    );
    expect(fillsInGap.length).toBe(0);
    // English note.
    expect(block.stitches.filter((s) => s.kind === "jump").length).toBe(1);
    // English note.
    expect(
      block.stitches.some((s) => s.kind === "fill" && s.x === 100 && s.y === 0),
    ).toBe(true);
    expect(
      block.stitches.some((s) => s.kind === "fill" && s.x === 101 && s.y === 0),
    ).toBe(true);
  });
});

describe("resolveShapeFillAngle", () => {
  it("translated case", () => {
    const angle = resolveShapeFillAngle(
      30, // override
      "shape-long-axis",
      45, // global
      [0, 1], // vertical long axis
      10, // English note.
      1.5,
    );
    expect(angle).toBe(30);
  });

  it("translated case", () => {
    expect(
      resolveShapeFillAngle(undefined, "global-angle", 45, [0, 1], 10, 1.5),
    ).toBe(45);
  });

  it("translated case", () => {
    expect(
      resolveShapeFillAngle(undefined, "shape-long-axis", 45, [0, 1], 1.2, 1.5),
    ).toBe(45);
  });

  it("translated case", () => {
    // longAxis = [0,1] (垂直) → atan2(1,0) = 90°
    expect(
      resolveShapeFillAngle(undefined, "shape-long-axis", 0, [0, 1], 10, 1.5),
    ).toBeCloseTo(90);
    // longAxis = [1,0] (水平) → atan2(0,1) = 0°
    expect(
      resolveShapeFillAngle(undefined, "shape-long-axis", 0, [1, 0], 10, 1.5),
    ).toBeCloseTo(0);
  });

  it("translated case", () => {
    expect(
      resolveShapeFillAngle(undefined, "shape-cross-axis", 0, [0, 1], 10, 1.5),
    ).toBeCloseTo(180);
    expect(
      resolveShapeFillAngle(undefined, "shape-cross-axis", 0, [1, 0], 10, 1.5),
    ).toBeCloseTo(90);
  });
});

describe("generateStitches with fillStrategy", () => {
  it("translated case", () => {
    // English note.
    // English note.
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [10, 0],
              [10, 40],
              [0, 40],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 50,
      heightMm: 50,
      widthPx: 50,
      heightPx: 50,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2, // English note.
      fillAngleDeg: 0,
      fillStrategy: "shape-long-axis",
    });
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    expect(countAdjacent(fills, "vertical")).toBeGreaterThan(
      countAdjacent(fills, "horizontal"),
    );
  });

  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [10, 0],
              [10, 40],
              [0, 40],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 50,
      heightMm: 50,
      widthPx: 50,
      heightPx: 50,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
      fillAngleDeg: 90, // English note.
      fillStrategy: "shape-cross-axis",
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    expect(countAdjacent(fills, "horizontal")).toBeGreaterThan(
      countAdjacent(fills, "vertical"),
    );
  });

  it("translated case", () => {
    // English note.
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [20, 0],
              [20, 20],
              [0, 20],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 50,
      heightMm: 50,
      widthPx: 50,
      heightPx: 50,
      stitchDensityMm: 1,
      satinMaxWidthMm: 0.5, // English note.
      fillAngleDeg: 0,
      fillStrategy: "shape-long-axis",
    });
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    // English note.
    expect(countAdjacent(fills, "horizontal")).toBeGreaterThan(
      countAdjacent(fills, "vertical"),
    );
  });
});

function countAdjacent(
  stitches: { x: number; y: number }[],
  axis: "horizontal" | "vertical",
): number {
  let n = 0;
  for (let i = 1; i < stitches.length; i++) {
    const dx = Math.abs(stitches[i].x - stitches[i - 1].x);
    const dy = Math.abs(stitches[i].y - stitches[i - 1].y);
    if (axis === "horizontal" && dx > dy) n++;
    if (axis === "vertical" && dy > dx) n++;
  }
  return n;
}

describe("generateStitches integration - jump-after-init bug", () => {
  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [50, 0],
              [50, 50],
              [0, 50],
            ],
            holes: [],
          },
          {
            outer: [
              [200, 0],
              [250, 0],
              [250, 50],
              [200, 50],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 300,
      heightMm: 300,
      widthPx: 300,
      heightPx: 300,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
    });
    const block = pattern.blocks[0];
    const fillsInGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 55 && s.x < 195,
    );
    expect(fillsInGap.length).toBe(0);
    expect(block.stitches.some((s) => s.kind === "jump")).toBe(true);
  });

  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [10, 0],
              [10, 0.5],
              [0, 0.5],
            ],
            holes: [],
          },
          {
            outer: [
              [100, 0],
              [110, 0],
              [110, 0.5],
              [100, 0.5],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 200,
      heightMm: 200,
      widthPx: 200,
      heightPx: 200,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
    });
    const block = pattern.blocks[0];
    const runsInGap = block.stitches.filter(
      (s) => s.kind === "run" && s.x > 15 && s.x < 95,
    );
    expect(runsInGap.length).toBe(0);
  });

  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [20, 0],
              [20, 1],
              [0, 1],
            ],
            holes: [],
          },
          {
            outer: [
              [100, 0],
              [120, 0],
              [120, 1],
              [100, 1],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 200,
      heightMm: 200,
      widthPx: 200,
      heightPx: 200,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
    });
    const block = pattern.blocks[0];
    const satinsInGap = block.stitches.filter(
      (s) => s.kind === "satin" && s.x > 25 && s.x < 95,
    );
    expect(satinsInGap.length).toBe(0);
  });

  it("translated case", () => {
    // English note.
    // English note.
    // English note.
    // English note.
    const outer: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [255, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [{ outer, holes: [] }],
      },
      {
        colorIndex: 1,
        rgb: [0, 0, 255],
        svgPath: "",
        polygons: [],
        shapes: [{ outer, holes: [] }],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 20,
      heightMm: 20,
      widthPx: 20,
      heightPx: 20,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
      fillAngleDeg: 0,
      fillAngleByColorIndex: { 1: 90 },
    });

    const block0 = pattern.blocks.find((b) => b.colorIndex === 0)!;
    const block1 = pattern.blocks.find((b) => b.colorIndex === 1)!;

    // English note.
    const fills0 = block0.stitches.filter((s) => s.kind === "fill");
    const horiz0 = countAdjacent(fills0, "horizontal");
    const vert0 = countAdjacent(fills0, "vertical");
    expect(horiz0).toBeGreaterThan(vert0);

    // English note.
    const fills1 = block1.stitches.filter((s) => s.kind === "fill");
    const horiz1 = countAdjacent(fills1, "horizontal");
    const vert1 = countAdjacent(fills1, "vertical");
    expect(vert1).toBeGreaterThan(horiz1);
  });

  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
            holes: [
              [
                [40, 40],
                [60, 40],
                [60, 60],
                [40, 60],
              ],
            ],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 100,
      heightMm: 100,
      widthPx: 100,
      heightPx: 100,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const block = pattern.blocks[0];
    const fillsInHole = block.stitches.filter(
      (s) =>
        s.kind === "fill" && s.x > 41 && s.x < 59 && s.y > 41 && s.y < 59,
    );
    expect(fillsInHole.length).toBe(0);
  });
});

describe("renderRun", () => {
  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [10, 0],
          [10, 0.3],
          [0, 0.3],
        ],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderRun(obj, makeCtx());
    expect(stitches.length).toBeGreaterThan(0);
    for (const s of stitches) {
      expect(s.kind).toBe("run");
    }
  });

  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "run",
      colorIndex: 3,
      rgb: [1, 2, 3],
      shape: {
        outer: [
          [2, 2],
          [12, 2],
          [12, 2.3],
          [2, 2.3],
        ],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderRun(obj, makeCtx());
    expect(stitches.length).toBeGreaterThan(0);
    // English note.
    expect(stitches[0].kind).toBe("run");
    expect(stitches[0].colorIndex).toBe(3);
    expect(stitches[0].y).toBeCloseTo(2.15, 1);
  });

  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [[2, 2], [12, 2], [12, 2.3], [2, 2.3]],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderRun(obj, makeCtx({ disableMedialAxis: true }));
    expect(stitches.length).toBeGreaterThan(0);
    // English note.
    expect(stitches[0]).toMatchObject({ x: 2, y: 2, kind: "run", colorIndex: 0 });
  });

  it("starts a run from the end nearest to the preferred entry point", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [[2, 2], [12, 2], [12, 2.3], [2, 2.3]],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const ctx = makeCtx({ disableMedialAxis: true });
    (ctx.opts as RenderOptions & { preferredEntry: [number, number] }).preferredEntry = [12, 2];

    const stitches = renderRun(obj, ctx);

    expect(stitches[0]).toMatchObject({ x: 12, y: 2, kind: "run", colorIndex: 0 });
  });

  it("uses a looser stitch length for thin-run than the global fill density", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "run",
      strokeKind: "thin-run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [[2, 2], [18, 2], [18, 3.1], [2, 3.1]],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };

    const stitches = renderRun(obj, makeCtx({ stitchDensityMm: 0.4 }));
    const runStitches = stitches.filter((s) => s.kind === "run");

    expect(runStitches.length).toBeLessThanOrEqual(16);
    expect(maxRealStitchDistance(runStitches)).toBeGreaterThanOrEqual(1.2);
  });

  it("respects final run kind even when strokeKind still looks like narrow satin", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "run",
      strokeKind: "narrow-satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [[2, 2], [22, 2], [22, 3.4], [2, 3.4]],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const design: EmbroideryDesign = {
      widthMm: 30,
      heightMm: 10,
      objects: [obj],
      fabric: FABRIC_PROFILES.denim,
    };

    const pattern = renderDesign(design, {
      widthMm: 30,
      heightMm: 10,
      widthPx: 300,
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 5,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    const stitchKinds = new Set(pattern.blocks[0]?.stitches.map((s) => s.kind));
    expect(stitchKinds.has("run")).toBe(true);
    expect(stitchKinds.has("satin")).toBe(false);
  });
});

describe("renderSatin", () => {
  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [20, 0],
          [20, 1],
          [0, 1],
        ],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderSatin(obj, makeCtx());
    expect(stitches.length).toBeGreaterThan(0);
    for (const s of stitches) {
      expect(s.kind).toBe("satin");
    }
  });

  // English note.
  // English note.
  // English note.
  // English note.
  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 1],
      [0, 1],
    ];
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer, holes: [] },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderSatin(obj, makeCtx());
    const satinStitches = stitches.filter((s) => s.kind === "satin");
    // English note.
    // English note.
    expect(satinStitches).toHaveLength(42);
    expect(stitches[0]).toEqual({ x: 0, y: 1, kind: "satin", colorIndex: 0 });
    expect(stitches[stitches.length - 1]).toEqual({
      x: 20,
      y: 0,
      kind: "satin",
      colorIndex: 0,
    });
  });

  // English note.
  // English note.
  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [20, 0], [20, 8], [0, 8]], holes: [] },
      props: DUMMY_PROPS,
      order: 0,
    };
    const newStitches = renderSatin(
      obj,
      makeCtx({ stitchDensityMm: 0.4, maxStitchMm: 3 }),
    );
    const legacyStitches = renderSatin(
      obj,
      makeCtx({
        stitchDensityMm: 0.4,
        maxStitchMm: 3,
        disableAutoSplit: true,
      }),
    );
    // English note.
    // English note.
    expect(newStitches.length).toBeGreaterThan(legacyStitches.length * 1.2);
  });

  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [12, 0], [12, 3], [0, 3]], holes: [] },
      props: DUMMY_PROPS,
      order: 0,
    };
    const legacyStitches = renderSatin(
      obj,
      makeCtx({ stitchDensityMm: 0.5, disableAutoSplit: true }),
    );
    // 12mm length / density 0.5 -> 25 rows x 2 endpoints = 50 stitches (= old satinStitches)
    const legacyTop = legacyStitches.filter((s) => s.kind === "satin");
    expect(legacyTop.length).toBe(50);
  });
});


  it("routes unsafe wide satin to fill stitches", () => {
    const obj: EmbroideryObject = {
      id: "wide-satin",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [[0, 0], [40, 0], [40, 12], [0, 12]],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };

    const stitches = renderSatin(obj, makeCtx({ satinMaxWidthMm: 6 }));

    expect(stitches.some((s) => s.kind === "fill")).toBe(true);
    expect(stitches.some((s) => s.kind === "satin")).toBe(false);
  });

describe("renderFill", () => {
  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        holes: [
          [
            [40, 40],
            [60, 40],
            [60, 60],
            [40, 60],
          ],
        ],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderFill(obj, makeCtx());
    const fills = stitches.filter((s) => s.kind === "fill");
    expect(fills.length).toBeGreaterThan(0);
    const fillsInHole = fills.filter(
      (s) => s.x > 41 && s.x < 59 && s.y > 41 && s.y < 59,
    );
    expect(fillsInHole.length).toBe(0);
  });

  it("translated case", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        holes: [],
      },
      props: DUMMY_PROPS,
      order: 0,
    };
    const stitches = renderFill(obj, makeCtx());
    expect(stitches.length).toBeGreaterThan(0);
    // English note.
    expect(["jump", "trim", "stop"]).not.toContain(stitches[0].kind);
    // English note.
    expect(stitches.some((s) => s.kind === "stop")).toBe(false);
  });

  it("does not stitch directly between lockstitch, underlay, and top fill sections", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [60, 0],
          [60, 60],
          [0, 60],
        ],
        holes: [],
      },
      props: {
        densityMm: 1,
        maxStitchMm: 7,
        underlay: { kind: "edge-run", insetMm: 1, stitchLenMm: 2 },
        lockstitch: true,
      },
      order: 0,
    };
    const stitches = renderFill(obj, makeCtx({
      disableUnderlay: false,
      disableLockstitch: false,
      maxStitchMm: 7,
      trimThresholdMm: 8,
    }));

    expect(maxRealStitchDistance(stitches)).toBeLessThanOrEqual(7);
  });

  it("does not flatten fill underlay scanline segments into long real stitches", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [60, 0],
          [60, 60],
          [0, 60],
        ],
        holes: [],
      },
      props: {
        densityMm: 1,
        maxStitchMm: 7,
        underlay: { kind: "fill", angleDeg: 0, spacingMm: 3 },
        lockstitch: false,
      },
      order: 0,
    };
    const stitches = renderFill(obj, makeCtx({
      disableUnderlay: false,
      disableLockstitch: false,
      maxStitchMm: 7,
      trimThresholdMm: 8,
    }));

    expect(maxRealStitchDistance(stitches)).toBeLessThanOrEqual(7);
  });
});

describe("renderDesign", () => {
  const baseOpts: RenderOptions = {
    widthMm: 100,
    heightMm: 100,
    widthPx: 100,
    stitchDensityMm: 1,
    satinMaxWidthMm: 2,
    disableUnderlay: true,
    disableCompensation: true,
    disableLockstitch: true,
  };

  function makeFillObj(
    id: string,
    colorIndex: number,
    order: number,
    outer: [number, number][],
  ): EmbroideryObject {
    return {
      id,
      kind: "fill",
      colorIndex,
      rgb: [colorIndex * 50, 0, 0],
      shape: { outer, holes: [] },
      props: DUMMY_PROPS,
      order,
    };
  }

  it("translated case", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 100,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeFillObj("0-0", 0, 0, [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ]),
      ],
    };
    const pattern = renderDesign(design, baseOpts);
    expect(pattern.blocks.length).toBe(1);
    expect(pattern.blocks[0].colorIndex).toBe(0);
    expect(pattern.blocks[0].stitches.length).toBeGreaterThan(0);
    // English note.
    expect(pattern.blocks[0].stitches.some((s) => s.kind === "stop")).toBe(false);
  });

  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 100,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeFillObj("0-0", 0, 0, outer),
        makeFillObj("1-0", 1, 1, outer),
      ],
    };
    const pattern = renderDesign(design, baseOpts);
    expect(pattern.blocks.length).toBe(2);
    expect(pattern.blocks[0].colorIndex).toBe(0);
    expect(pattern.blocks[1].colorIndex).toBe(1);
    // English note.
    const stopsInBlock0 = pattern.blocks[0].stitches.filter(
      (s) => s.kind === "stop",
    );
    expect(stopsInBlock0.length).toBe(1);
    expect(pattern.blocks[0].stitches[pattern.blocks[0].stitches.length - 1].kind).toBe("stop");
    // English note.
    expect(pattern.blocks[1].stitches.some((s) => s.kind === "stop")).toBe(false);
  });

  it("translated case", () => {
    const fillOuter: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const runOuter: [number, number][] = [
      [30, 0],
      [40, 0],
      [40, 0.3],
      [30, 0.3],
    ];
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 100,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeFillObj("0-0", 0, 0, fillOuter),
        {
          id: "0-1",
          kind: "run",
          colorIndex: 0,
          rgb: [0, 0, 0],
          shape: { outer: runOuter, holes: [] },
          props: DUMMY_PROPS,
          order: 1,
        },
      ],
    };
    const pattern = renderDesign(design, baseOpts);
    expect(pattern.blocks.length).toBe(1);
    const kinds = new Set(pattern.blocks[0].stitches.map((s) => s.kind));
    expect(kinds.has("fill")).toBe(true);
    expect(kinds.has("run")).toBe(true);
  });

  it("translated case", () => {
    // English note.
    // English note.
    const leftSquare: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const rightSquare: [number, number][] = [
      [50, 0],
      [60, 0],
      [60, 10],
      [50, 10],
    ];
    const objects: EmbroideryObject[] = [
      // English note.
      makeFillObj("0-1", 0, 10, leftSquare),
      makeFillObj("0-0", 0, 0, rightSquare),
    ];
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 100,
      fabric: FABRIC_PROFILES.denim,
      objects,
    };
    const pattern = renderDesign(design, baseOpts);
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    // English note.
    expect(fills[0].x).toBeGreaterThanOrEqual(50);
    // English note.
    expect(fills[fills.length - 1].x).toBeLessThanOrEqual(10);
  });

  // English note.
  // English note.
  // English note.
  // English note.
  // English note.
  // English note.
  // English note.
  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [255, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
            holes: [
              [
                [40, 40],
                [60, 40],
                [60, 60],
                [40, 60],
              ],
            ],
          },
        ],
      },
      {
        colorIndex: 1,
        rgb: [0, 255, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [150, 0],
              [250, 0],
              [250, 8],
              [150, 8],
            ],
            holes: [],
          },
        ],
      },
      {
        colorIndex: 2,
        rgb: [0, 0, 255],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 150],
              [100, 150],
              [100, 154],
              [0, 154],
            ],
            holes: [],
          },
        ],
      },
    ];
    const sharedOpts = {
      widthMm: 50,
      heightMm: 50,
      widthPx: 500,
      heightPx: 500,
      stitchDensityMm: 0.4,
      satinMaxWidthMm: 6,
      digitizingMode: "photo-stitch" as const,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    };

    const objects = buildObjects({
      ...sharedOpts,
      regions,
      fabric: FABRIC_PROFILES.denim,
    });
    const design: EmbroideryDesign = {
      widthMm: sharedOpts.widthMm,
      heightMm: sharedOpts.heightMm,
      fabric: FABRIC_PROFILES.denim,
      objects,
    };
    const pattern = renderDesign(design, sharedOpts);

    expect(pattern.widthMm).toBe(50);
    expect(pattern.heightMm).toBe(50);
    expect(pattern.totalStitches).toBe(184);
    expect(pattern.blocks).toHaveLength(3);

    // English note.
    const b0 = pattern.blocks[0];
    expect(b0.colorIndex).toBe(0);
    expect(b0.rgb).toEqual([255, 0, 0]);
    expect(b0.stitches).toHaveLength(132);
    expect(countByKind(b0.stitches)).toEqual({ fill: 124, jump: 7, stop: 1 });
    expect(b0.stitches[0]).toEqual({ x: 10, y: 0, kind: "fill", colorIndex: 0 });
    expect(b0.stitches[b0.stitches.length - 1].kind).toBe("stop");

    // block 1: satin (narrow band)
    const b1 = pattern.blocks[1];
    expect(b1.colorIndex).toBe(1);
    expect(b1.rgb).toEqual([0, 255, 0]);
    expect(b1.stitches).toHaveLength(53);
    expect(countByKind(b1.stitches)).toEqual({ satin: 52, stop: 1 });
    // English note.
    expect(b1.stitches[0]).toEqual({ x: 15, y: 0.8, kind: "satin", colorIndex: 1 });

    // English note.
    const b2 = pattern.blocks[2];
    expect(b2.colorIndex).toBe(2);
    expect(b2.rgb).toEqual([0, 0, 255]);
    // English note.
    expect(countByKind(b2.stitches)).toEqual({ run: b2.stitches.length });
    expect(b2.stitches[0].kind).toBe("run");
    expect(b2.stitches[0].colorIndex).toBe(2);
    // English note.
    expect(b2.stitches[0].y).toBeCloseTo(15.2, 1);

    // English note.
    expect(b2.stitches[b2.stitches.length - 1].kind).toBe("run");
  });

  // English note.
  // English note.
  it("translated case", () => {
    const regions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [255, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
            holes: [
              [
                [40, 40],
                [60, 40],
                [60, 60],
                [40, 60],
              ],
            ],
          },
        ],
      },
      {
        colorIndex: 1,
        rgb: [0, 255, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [150, 0],
              [250, 0],
              [250, 8],
              [150, 8],
            ],
            holes: [],
          },
        ],
      },
      {
        colorIndex: 2,
        rgb: [0, 0, 255],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 150],
              [100, 150],
              [100, 154],
              [0, 154],
            ],
            holes: [],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      digitizingMode: "photo-stitch",
      widthMm: 50,
      heightMm: 50,
      widthPx: 500,
      heightPx: 500,
      stitchDensityMm: 0.4,
      satinMaxWidthMm: 6,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    expect(pattern.totalStitches).toBe(184);
    // English note.
    expect(pattern.blocks.map((b) => b.stitches.length)).toEqual([132, 53, 8]);
  });
});

describe("translated case", () => {
  // English note.
  // English note.
  const regions: ColorRegion[] = [
    {
      colorIndex: 0,
      rgb: [255, 0, 0],
      svgPath: "",
      polygons: [],
      shapes: [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
    },
  ];
  const common = {
    regions,
    widthMm: 10,
    heightMm: 10,
    widthPx: 100,
    heightPx: 100,
    satinMaxWidthMm: 6,
  } as const;

  it("translated case", () => {
    // English note.
    // English note.
    const denimPattern = generateStitches({
      ...common,
      fabric: FABRIC_PROFILES.denim,
      stitchDensityMm: FABRIC_PROFILES.denim.defaultDensityMm,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const terryPattern = generateStitches({
      ...common,
      fabric: FABRIC_PROFILES.terry,
      stitchDensityMm: FABRIC_PROFILES.terry.defaultDensityMm,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    expect(denimPattern.totalStitches).not.toBe(terryPattern.totalStitches);
    // English note.
    expect(denimPattern.totalStitches).toBeGreaterThan(terryPattern.totalStitches);
  });

  it("translated case", () => {
    // English note.
    const objects = buildObjects({
      regions,
      widthMm: 10,
      widthPx: 100,
      satinMaxWidthMm: 6,
      fabric: FABRIC_PROFILES.terry,
    });
    expect(objects[0].props.densityMm).toBeCloseTo(FABRIC_PROFILES.terry.defaultDensityMm);
    expect(objects[0].props.pushCompMm).toBe(FABRIC_PROFILES.terry.defaultPushCompMm);
  });
});

function countByKind(stitches: { kind: string }[]): Record<string, number> {
  return stitches.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1;
    return acc;
  }, {});
}

describe("translated case", () => {
  // English note.
  const fixture: ColorRegion[] = [
    {
      colorIndex: 0,
      rgb: [255, 0, 0],
      svgPath: "",
      polygons: [],
      shapes: [{ outer: [[0, 0], [100, 0], [100, 30], [0, 30]], holes: [] }],
    },
    {
      colorIndex: 1,
      rgb: [0, 255, 0],
      svgPath: "",
      polygons: [],
      shapes: [{ outer: [[0, 40], [100, 40], [100, 70], [0, 70]], holes: [] }],
    },
    {
      colorIndex: 2,
      rgb: [0, 0, 255],
      svgPath: "",
      polygons: [],
      shapes: [{ outer: [[0, 80], [100, 80], [100, 95], [0, 95]], holes: [] }],
    },
  ];

  const commonInput = {
    regions: fixture,
    fabric: FABRIC_PROFILES.denim,
    widthMm: 100,
    heightMm: 100,
    widthPx: 1000,
    heightPx: 1000,
    stitchDensityMm: FABRIC_PROFILES.denim.defaultDensityMm,
    satinMaxWidthMm: 6,
  } as const;

  it("translated case", () => {
    const phase1 = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const phase2WithFlags = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    expect(phase2WithFlags.totalStitches).toBe(phase1.totalStitches);
    expect(phase2WithFlags.blocks.length).toBe(phase1.blocks.length);
    for (let bi = 0; bi < phase1.blocks.length; bi++) {
      expect(phase2WithFlags.blocks[bi].stitches.length).toBe(
        phase1.blocks[bi].stitches.length,
      );
    }
  });

  it("translated case", () => {
    const phase1 = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const phase2Full = generateStitches({
      ...commonInput,
      // English note.
    });
    const ratio = phase2Full.totalStitches / phase1.totalStitches;
    // English note.
    // English note.
    // English note.
    expect(ratio).toBeGreaterThanOrEqual(1.1);
    expect(ratio).toBeLessThanOrEqual(3.0); // English note.
  });

  it("translated case", () => {
    const without = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableLockstitch: true,
    });
    const with_ = generateStitches({
      ...commonInput,
      disableLockstitch: true,
    });
    expect(with_.totalStitches).toBeGreaterThan(without.totalStitches);
  });

  it("translated case", () => {
    const withLock = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableCompensation: true,
    });
    const noLock = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    // 3 object × 6 stitch = 18 増
    expect(withLock.totalStitches).toBe(noLock.totalStitches + 18);
  });

  it("translated case", () => {
    const holeRegions: ColorRegion[] = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        polygons: [],
        shapes: [
          {
            outer: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
            holes: [
              [
                [40, 40],
                [60, 40],
                [60, 60],
                [40, 60],
              ],
            ],
          },
        ],
      },
    ];
    const pattern = generateStitches({
      ...commonInput,
      regions: holeRegions,
      // English note.
    });
    const block = pattern.blocks[0];
    // English note.
    // English note.
    // English note.
    const insideHole = block.stitches.filter(
      (s) => s.x > 42 && s.x < 58 && s.y > 42 && s.y < 58,
    );
    expect(insideHole).toHaveLength(0);
  });

  it("translated case", () => {
    // English note.
    // English note.
    // English note.
    const denimPattern = generateStitches({
      ...commonInput,
      fabric: FABRIC_PROFILES.denim,
      stitchDensityMm: FABRIC_PROFILES.denim.defaultDensityMm,
    });
    const terryPattern = generateStitches({
      ...commonInput,
      fabric: FABRIC_PROFILES.terry,
      stitchDensityMm: FABRIC_PROFILES.terry.defaultDensityMm,
    });
    expect(denimPattern.totalStitches).toBe(terryPattern.totalStitches);
  });

  it("translated case", () => {
    // English note.
    const ctx: RenderContext = {
      opts: {
        widthMm: 40,
        heightMm: 5,
        widthPx: 400,
        stitchDensityMm: 0.4,
        satinMaxWidthMm: 6,
        fabric: FABRIC_PROFILES.denim,
        disableUnderlay: true,
        disableLockstitch: true,
      },
    };
    const obj: EmbroideryObject = {
      id: "0",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [40, 0],
          [40, 1.5],
          [0, 1.5],
        ],
        holes: [],
      },
      order: 0,
      props: { densityMm: 0.4, maxStitchMm: 7, pullCompMm: 0.3 },
    };
    const withComp = renderSatin(obj, {
      ...ctx,
      opts: { ...ctx.opts, disableCompensation: false },
    });
    const noComp = renderSatin(obj, {
      ...ctx,
      opts: { ...ctx.opts, disableCompensation: true },
    });
    // English note.
    const yRangeWith =
      Math.max(...withComp.map((s) => s.y)) -
      Math.min(...withComp.map((s) => s.y));
    const yRangeNo =
      Math.max(...noComp.map((s) => s.y)) -
      Math.min(...noComp.map((s) => s.y));
    expect(yRangeWith).toBeGreaterThan(yRangeNo);
    expect(yRangeWith - yRangeNo).toBeCloseTo(0.6, 1); // pullCompMm=0.3 × 2 sides
  });
});

describe("translated case", () => {
  const policy = TRIM_POLICY_BY_FORMAT.dst; // trim=8 / jump=5 / travelRun=5

  it("distance 3mm (< travelRunUntilMm=5) -> one travel-run stitch (kind=run, coordinate=next)", () => {
    const r = connectObjects([0, 0], [3, 0], 2, policy);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ x: 3, y: 0, kind: "run", colorIndex: 2 });
  });

  it("translated case", () => {
    const r = connectObjects([0, 0], [5, 0], 2, policy);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("jump");
  });

  it("translated case", () => {
    const r = connectObjects([0, 0], [10, 0], 4, policy);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ x: 0, y: 0, kind: "trim", colorIndex: 4 });
    expect(r[1]).toMatchObject({ x: 10, y: 0, kind: "jump", colorIndex: 4 });
  });

  it("Euclidean 距離 (3-4-5)", () => {
    const r = connectObjects([0, 0], [3, 4], 1, policy);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("jump");
  });

  it("translated case", () => {
    const custom = {
      trimThresholdMm: 6,
      jumpThresholdMm: 3,
      travelRunUntilMm: 3,
    };
    const r = connectObjects([0, 0], [4, 0], 1, custom);
    expect(r[0].kind).toBe("jump");
  });
});

describe("translated case", () => {
  const baseOpts = {
    widthMm: 50,
    heightMm: 50,
    widthPx: 500,
    stitchDensityMm: 0.4,
    satinMaxWidthMm: 6,
    disableUnderlay: true,
    disableCompensation: true,
  };

  const twoFillObjects = (gapMm: number): EmbroideryDesign => ({
    widthMm: 50,
    heightMm: 50,
    fabric: { kind: "denim" } as never,
    objects: [
      {
        id: "0-0",
        kind: "fill",
        colorIndex: 0,
        rgb: [0, 0, 0],
        shape: {
          outer: [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 5],
          ],
          holes: [],
        },
        props: {
          densityMm: 0.4,
          maxStitchMm: 7,
          underlay: { kind: "none" },
        },
        order: 0,
      },
      {
        id: "0-1",
        kind: "fill",
        colorIndex: 0,
        rgb: [0, 0, 0],
        shape: {
          outer: [
            [5 + gapMm, 0],
            [10 + gapMm, 0],
            [10 + gapMm, 5],
            [5 + gapMm, 5],
          ],
          holes: [],
        },
        props: {
          densityMm: 0.4,
          maxStitchMm: 7,
          underlay: { kind: "none" },
        },
        order: 1,
      },
    ],
  });

  it("translated case", () => {
    const design = twoFillObjects(3);
    const pattern = renderDesign(design, {
      ...baseOpts,
      disableLockstitch: true,
    });
    const kinds = pattern.blocks[0].stitches.map((s) => s.kind);
    // English note.
    // English note.
    expect(kinds).not.toContain("run"); // English note.
  });

  it("does not use visible travel runs between disconnected objects", () => {
    const design = twoFillObjects(2);
    const looseT: typeof TRIM_POLICY_BY_FORMAT.dst = {
      trimThresholdMm: 20,
      jumpThresholdMm: 18,
      travelRunUntilMm: 18,
    };
    const pattern = renderDesign(design, {
      ...baseOpts,
      policy: looseT,
      disableLockstitch: true,
    });
    const kinds = pattern.blocks[0].stitches.map((s) => s.kind);
    expect(kinds).toContain("jump");
    expect(kinds).not.toContain("run");
    expect(kinds).not.toContain("trim"); // English note.
  });

  it("extends hidden safe travel runs up to the trim threshold", () => {
    const fillObject = (
      id: string,
      outer: [number, number][],
      order: number,
    ): EmbroideryObject => ({
      id,
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer, holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order,
      layer: "outline",
    });

    const from = fillObject("a", [[0, 0], [10, 0], [10, 2], [0, 2]], 0);
    const to = fillObject("b", [[10, 0], [20, 0], [20, 2], [10, 2]], 1);
    const r = connectObjectsWithSafety(
      from,
      to,
      [4, 1],
      [10, 1],
      0,
      {
        trimThresholdMm: 8,
        jumpThresholdMm: 5,
        travelRunUntilMm: 5,
      },
    );

    expect(r).toEqual([
      { x: 10, y: 1, kind: "run", colorIndex: 0 },
    ]);
  });

  it("translated case", () => {
    const design = twoFillObjects(10);
    const pattern = renderDesign(design, {
      ...baseOpts,
      policy: TRIM_POLICY_BY_FORMAT.dst,
      disableLockstitch: true,
    });
    const kinds = pattern.blocks[0].stitches.map((s) => s.kind);
    expect(kinds).toContain("trim");
    expect(kinds).toContain("jump");
  });

  it("translated case", () => {
    // English note.
    const design = twoFillObjects(2);
    const looseT: typeof TRIM_POLICY_BY_FORMAT.dst = {
      trimThresholdMm: 20,
      jumpThresholdMm: 18,
      travelRunUntilMm: 18,
    };
    const withSuppress = renderDesign(design, {
      ...baseOpts,
      policy: looseT,
      // English note.
    });
    const noLockstitch = renderDesign(design, {
      ...baseOpts,
      policy: looseT,
      disableLockstitch: true,
    });
    const runsSuppress = withSuppress.blocks[0].stitches.filter(
      (s) => s.kind === "run",
    ).length;
    const runsNoLock = noLockstitch.blocks[0].stitches.filter(
      (s) => s.kind === "run",
    ).length;
    expect(runsSuppress).toBeGreaterThan(runsNoLock);
  });

  it("orients a following run object toward the previous object exit", () => {
    const runObj = (
      id: string,
      outer: [number, number][],
      order: number,
    ): EmbroideryObject => ({
      id,
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer, holes: [] },
      props: { densityMm: 1, maxStitchMm: 7, underlay: { kind: "none" } },
      order,
    });
    const design: EmbroideryDesign = {
      widthMm: 50,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        runObj("first", [[0, 0], [10, 0], [10, 0.3], [0, 0.3]], 0),
        runObj("second", [[30, 0], [20, 0], [20, 0.3], [30, 0.3]], 1),
      ],
    };

    const pattern = renderDesign(design, {
      ...baseOpts,
      policy: TRIM_POLICY_BY_FORMAT.dst,
      disableMedialAxis: true,
      disableLockstitch: true,
    });
    const block = pattern.blocks[0];
    const jumpIndex = block.stitches.findIndex((s) => s.kind === "jump");

    expect(jumpIndex).toBeGreaterThan(0);
    expect(block.stitches[jumpIndex + 1].kind).toBe("run");
    expect(block.stitches[jumpIndex + 1].x).toBeCloseTo(20);
    expect(block.stitches[jumpIndex + 1].y).toBeCloseTo(0);
  });

  it("honors per-object lockstitch=false", () => {
    const [object] = twoFillObjects(2).objects;
    const designWithLock: EmbroideryDesign = {
      widthMm: 50,
      heightMm: 50,
      fabric: { kind: "denim" } as never,
      objects: [{ ...object, props: { ...object.props, lockstitch: true } }],
    };
    const designWithoutLock: EmbroideryDesign = {
      widthMm: 50,
      heightMm: 50,
      fabric: { kind: "denim" } as never,
      objects: [{ ...object, props: { ...object.props, lockstitch: false } }],
    };

    const withLock = renderDesign(designWithLock, baseOpts);
    const withoutLock = renderDesign(designWithoutLock, baseOpts);
    const runCount = (pattern: typeof withLock) =>
      pattern.blocks[0].stitches.filter((stitch) => stitch.kind === "run").length;

    expect(runCount(withoutLock)).toBe(0);
    expect(runCount(withLock)).toBeGreaterThan(runCount(withoutLock));
  });
});
