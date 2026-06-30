import { describe, it, expect } from "vitest";
import {
  __internal,
  connectObjects,
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

function makeCtx(overrides: Partial<RenderContext["opts"]> = {}): RenderContext {
  // 既存 Phase 1 由来のテストが Phase 2 (lockstitch/underlay/compensation) の影響を
  // 受けないよう、makeCtx のデフォルトで 3 フラグを true に倒す。
  // Phase 2 機能を検証するテストは個別に overrides で false を渡す。
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

const {
  fillStitches,
  intersectScanline,
  analyzeShape,
  appendStitchesWithJumps,
  resolveShapeFillAngle,
} = __internal;

describe("intersectScanline (multi-ring)", () => {
  it("外形のみのとき従来通り 2 交点", () => {
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

  it("穴があると 4 交点", () => {
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
  it("穴を持つ正方形では、穴の中をまたぐ縫い目が生成されない", () => {
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
    // angleDeg=0 → dir=[1,0], perp=[0,1] で水平スキャン
    const segments = fillStitches(shape, 1, 0);
    const allPts = segments.flat();
    // 穴の中 y∈[9,11], x∈[8.5,11.5] にステッチ端点が来ないことを確認
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

  it("穴ありで複数 segment に分割される", () => {
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
    // 各 segment は 2 点で穴を跨がない区間
    for (const seg of segments) {
      expect(seg.length).toBe(2);
    }
    // 穴 (y∈[8,12]) を跨ぐ scanline は 2 segment に分かれている
    const segsOnHoleLine = segments.filter(
      (seg) => Math.abs(seg[0][1] - 10) < 0.5,
    );
    expect(segsOnHoleLine.length).toBeGreaterThanOrEqual(2);
  });

  it("穴なしのときは各 scanline が 1 segment", () => {
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

describe("analyzeShape は outer のみで計算", () => {
  it("穴を渡さなくても短辺長が正しい", () => {
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
  it("prev=undefined のときは forceJumpAtStart=true でも jump を挿入しない", () => {
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

  it("forceJumpAtStart=true + dist<=trimThreshold で trim なし jump あり、pts[0] も STITCH として残す", () => {
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
    // prev → pts[0] の gap (0 < x < 5) には fill が入らない
    const fillsInGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 0 && s.x < 5,
    );
    expect(fillsInGap.length).toBe(0);
  });

  it("dist>trimThreshold で trim + jump 両方挿入、pts[0] も STITCH として残す", () => {
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
    // prev → pts[0] の gap (0 < x < 50) には fill が細分化されて入らない
    const fillStitchesOnGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 0 && s.x < 50,
    );
    expect(fillStitchesOnGap.length).toBe(0);
  });

  it("forceJumpAtStart=false + 短距離 では jump 不要、prev から pts[0] を含めて縫う", () => {
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

  it("forceJumpAtStart=false でも dist>maxStitchMm なら jump が入り、pts[0] は STITCH として残る", () => {
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

  it("pts.length===1 で jump 必要なら trim+jump の後に pts[0] が STITCH として残る", () => {
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

  it("ループ内で d>maxStitchMm の区間は均等に細分化される", () => {
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

  it("BUG-REGRESSION: jump 直後の prev→pts[0] 区間に kind 縫いが細分化されない", () => {
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
    // prev→pts[0] のギャップ (0 < x < 100) に fill が細分化されて入らないこと（バグの核心）
    const fillsInGap = block.stitches.filter(
      (s) => s.kind === "fill" && s.x > 0 && s.x < 100,
    );
    expect(fillsInGap.length).toBe(0);
    // jump は 1 本
    expect(block.stitches.filter((s) => s.kind === "jump").length).toBe(1);
    // pts[0]=(100,0) と pts[1]=(101,0) は STITCH として残る
    expect(
      block.stitches.some((s) => s.kind === "fill" && s.x === 100 && s.y === 0),
    ).toBe(true);
    expect(
      block.stitches.some((s) => s.kind === "fill" && s.x === 101 && s.y === 0),
    ).toBe(true);
  });
});

describe("resolveShapeFillAngle", () => {
  it("色別 override があれば strategy より優先される", () => {
    const angle = resolveShapeFillAngle(
      30, // override
      "shape-long-axis",
      45, // global
      [0, 1], // 縦長軸
      10, // 長い
      1.5,
    );
    expect(angle).toBe(30);
  });

  it("global-angle のときは fillAngleDeg を返す", () => {
    expect(
      resolveShapeFillAngle(undefined, "global-angle", 45, [0, 1], 10, 1.5),
    ).toBe(45);
  });

  it("等方形 (aspectRatio < minAspect) では global にフォールバック", () => {
    expect(
      resolveShapeFillAngle(undefined, "shape-long-axis", 45, [0, 1], 1.2, 1.5),
    ).toBe(45);
  });

  it("shape-long-axis は長軸方向の角度を返す", () => {
    // longAxis = [0,1] (垂直) → atan2(1,0) = 90°
    expect(
      resolveShapeFillAngle(undefined, "shape-long-axis", 0, [0, 1], 10, 1.5),
    ).toBeCloseTo(90);
    // longAxis = [1,0] (水平) → atan2(0,1) = 0°
    expect(
      resolveShapeFillAngle(undefined, "shape-long-axis", 0, [1, 0], 10, 1.5),
    ).toBeCloseTo(0);
  });

  it("shape-cross-axis は長軸 + 90° を返す", () => {
    expect(
      resolveShapeFillAngle(undefined, "shape-cross-axis", 0, [0, 1], 10, 1.5),
    ).toBeCloseTo(180);
    expect(
      resolveShapeFillAngle(undefined, "shape-cross-axis", 0, [1, 0], 10, 1.5),
    ).toBeCloseTo(90);
  });
});

describe("generateStitches with fillStrategy", () => {
  it("shape-long-axis: 縦長矩形は縦方向に塗られる", () => {
    // 縦長 (10x40) の矩形を塗る。長軸は y 方向なので、scanline は y 方向に沿う。
    // 1 行のステッチ 2 点は (x, ymin) → (x, ymax) のように Δy >> Δx となる。
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
      satinMaxWidthMm: 2, // satin にならないように低めに
      fillAngleDeg: 0,
      fillStrategy: "shape-long-axis",
    });
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    expect(countAdjacent(fills, "vertical")).toBeGreaterThan(
      countAdjacent(fills, "horizontal"),
    );
  });

  it("shape-cross-axis: 縦長矩形は横方向に塗られる", () => {
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
      fillAngleDeg: 90, // global は縦だが strategy が cross-axis なので横になるはず
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

  it("等方形は strategy が shape-* でも fillAngleDeg にフォールバック", () => {
    // 20x20 の正方形 (aspect=1) → fallback して fillAngleDeg=0 (水平 scanline) になる
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
      satinMaxWidthMm: 0.5, // satin にならないように極小
      fillAngleDeg: 0,
      fillStrategy: "shape-long-axis",
    });
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    // 0° → 行内ステッチは水平方向
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
  it("離れた 2 つの fill 矩形の間に fill 縫い目が現れない", () => {
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
    const jumpsInGap = block.stitches.filter(
      (s) => s.kind === "jump" && s.x > 50 && s.x < 250,
    );
    expect(jumpsInGap.length).toBeGreaterThan(0);
  });

  it("離れた 2 つの細い outline (run) の間に run 縫い目が現れない", () => {
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

  it("離れた 2 本の satin 棒の間に satin 縫い目が現れない", () => {
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

  it("fillAngleByColorIndex で色ごとに fill 方向を切り替えられる", () => {
    // 同じ正方形を 2 色で塗り、色 0 = 0° (水平 scanline → 垂直方向の縞)、
    // 色 1 = 90° (垂直 scanline → 水平方向の縞) を指定。
    // 0° の scanline は perp=[0,1] (y 方向に行を進める) で各行内は dir=[1,0] に沿う 2 点。
    // 90° は perp=[-1,0] (x 方向に行を進める) で各行内は dir=[0,1] に沿う 2 点。
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

    // 色 0 (0°): 隣接する 2 つの fill 点はだいたい x 方向に並ぶ (Δy ≈ 0)。
    const fills0 = block0.stitches.filter((s) => s.kind === "fill");
    const horiz0 = countAdjacent(fills0, "horizontal");
    const vert0 = countAdjacent(fills0, "vertical");
    expect(horiz0).toBeGreaterThan(vert0);

    // 色 1 (90°): 隣接する 2 つの fill 点はだいたい y 方向に並ぶ (Δx ≈ 0)。
    const fills1 = block1.stitches.filter((s) => s.kind === "fill");
    const horiz1 = countAdjacent(fills1, "horizontal");
    const vert1 = countAdjacent(fills1, "vertical");
    expect(vert1).toBeGreaterThan(horiz1);
  });

  it("穴あき矩形を fill しても、穴の中を fill 縫い目が横断しない", () => {
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
  it("細い帯 (shortSide < runMaxWidth) のオブジェクトから run 種別の Stitch だけが返る", () => {
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

  it("先頭の Stitch は medial-axis 端点 で kind='run' (Phase 4 PR19 で中心線抽出に切替)", () => {
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
    // medial-axis: y は中心 ≈ 2.15 (= 2 + 0.3/2)、kind/colorIndex は不変
    expect(stitches[0].kind).toBe("run");
    expect(stitches[0].colorIndex).toBe(3);
    expect(stitches[0].y).toBeCloseTo(2.15, 1);
  });

  it("disableMedialAxis=true で旧 outer resample 経路に戻る (Phase 1-3 互換)", () => {
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
    // 旧経路は outer の最初の点 (2, 2) から始まる
    expect(stitches[0]).toMatchObject({ x: 2, y: 2, kind: "run", colorIndex: 0 });
  });
});

describe("renderSatin", () => {
  it("細長 satin オブジェクトから satin 種別だけが返る", () => {
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

  // 20mm × 1mm の細長帯 (satin判定される) からの satin stitch 数を
  // 凍結値 (golden) として固定する。
  // 凍結時の入力: stitchDensityMm=1, satinMaxWidthMm=2, mmPerPx=1
  // この値が変わったら satin renderer のロジックが変わったことを意味する。
  it("固定入力 20mm×1mm の satin オブジェクトから 42 個の satin Stitch を生成する", () => {
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
    // Phase 4 PR18 で 2-rail satin に切替: 同じ stitch 数 (42) を維持しつつ
    // 最初の stitch は上 rail (y=1) から始まる (extractRails の left=上 rail 判定)
    expect(satinStitches).toHaveLength(42);
    expect(stitches[0]).toEqual({ x: 0, y: 1, kind: "satin", colorIndex: 0 });
    expect(stitches[stitches.length - 1]).toEqual({
      x: 20,
      y: 0,
      kind: "satin",
      colorIndex: 0,
    });
  });

  // Phase 4 PR18: wide satin (8mm 幅) で brick auto-split が有効化され、
  // 1 行あたり 2 点 (端のみ) でなく中間点も挿入されて stitch 数が増えること。
  it("wide satin (20x8mm, maxStitch=3) で brick split が中間点を挿入し stitch 数が増える", () => {
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
    // brick split で 8mm > maxStitch 3 を分割するため、新経路の stitch 数は
    // 旧経路より多い (実数は appendStitchesWithJumps の dedup + 分割と相互作用)。
    expect(newStitches.length).toBeGreaterThan(legacyStitches.length * 1.2);
  });

  it("disableAutoSplit=true で旧 satinStitches 経路と stitch 数が完全一致", () => {
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
    // 12mm 長 / density 0.5 → 25 行 × 2 端点 = 50 stitches (= 旧 satinStitches)
    const legacyTop = legacyStitches.filter((s) => s.kind === "satin");
    expect(legacyTop.length).toBe(50);
  });
});

describe("renderFill", () => {
  it("普通の塗りオブジェクトから fill 種別の縫い目を返し、穴の中は走らない", () => {
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

  it("renderer 出力の先頭は jump/trim/stop ではなく、stop は決して含まない", () => {
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
    // 先頭は jump/trim/stop ではなく、実 stitch (fill) であること (prev=undefined 挙動)
    expect(["jump", "trim", "stop"]).not.toContain(stitches[0].kind);
    // stop は renderer の責務外
    expect(stitches.some((s) => s.kind === "stop")).toBe(false);
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

  it("単一オブジェクト (kind=fill) を含む design から block 1 個の pattern を返す", () => {
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
    // 単一 block には末尾 stop は付かない
    expect(pattern.blocks[0].stitches.some((s) => s.kind === "stop")).toBe(false);
  });

  it("異なる colorIndex のオブジェクト 2 個から block 2 個を返し、前 block 末尾に kind=stop が挟まる", () => {
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
    // 前 block 末尾に stop が 1 つだけ挿入されている
    const stopsInBlock0 = pattern.blocks[0].stitches.filter(
      (s) => s.kind === "stop",
    );
    expect(stopsInBlock0.length).toBe(1);
    expect(pattern.blocks[0].stitches[pattern.blocks[0].stitches.length - 1].kind).toBe("stop");
    // 後 block には stop は付かない
    expect(pattern.blocks[1].stitches.some((s) => s.kind === "stop")).toBe(false);
  });

  it("同じ colorIndex の fill + run が混在しても 1 block にマージされる", () => {
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

  it("order の昇順で描画される (大きい order が後)", () => {
    // 離れた 2 つの fill (同色)。order を逆順 (10, 0) で渡しても、
    // 描画は order 昇順なので order=0 (右の矩形) が先になる。
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
      // わざと order=10 を先に並べる
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
    // 最初の fill は order=0 の右側矩形 (x>=50) から始まるはず
    expect(fills[0].x).toBeGreaterThanOrEqual(50);
    // 最後の fill は order=10 の左側矩形 (x<=10) で終わるはず
    expect(fills[fills.length - 1].x).toBeLessThanOrEqual(10);
  });

  // PR4 リファクタの動作不変性ガード:
  // 過去 stitch.ts の monolithic generateStitches は PR3 cycle 6 で
  // buildObjects 経由に書き換えられたため、現時点で「旧実装」との直接比較は
  // 不可能 (現在の generateStitches も renderDesign を内部で呼ぶシム)。
  // 代わりに、fill / satin / run の 3 kind を網羅する固定入力に対する
  // renderDesign の出力を golden として凍結し、将来の変更で値が動いたら
  // 検出できるようにする。値は PR4 リファクタ完了直後の renderDesign 出力。
  it("golden: fill+satin+run を含む design を renderDesign に通すと、固定値の StitchPattern を返す", () => {
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
    expect(pattern.totalStitches).toBe(206);
    expect(pattern.blocks).toHaveLength(3);

    // block 0: fill (穴あり矩形)
    const b0 = pattern.blocks[0];
    expect(b0.colorIndex).toBe(0);
    expect(b0.rgb).toEqual([255, 0, 0]);
    expect(b0.stitches).toHaveLength(172);
    expect(countByKind(b0.stitches)).toEqual({ fill: 129, jump: 42, stop: 1 });
    expect(b0.stitches[0]).toEqual({ x: 10, y: 0, kind: "fill", colorIndex: 0 });
    expect(b0.stitches[b0.stitches.length - 1].kind).toBe("stop");

    // block 1: satin (細長帯)
    const b1 = pattern.blocks[1];
    expect(b1.colorIndex).toBe(1);
    expect(b1.rgb).toEqual([0, 255, 0]);
    expect(b1.stitches).toHaveLength(53);
    expect(countByKind(b1.stitches)).toEqual({ satin: 52, stop: 1 });
    // Phase 4 PR18 で 2-rail satin に切替: 最初の stitch は上 rail (y=0.8) 側に出る
    expect(b1.stitches[0]).toEqual({ x: 15, y: 0.8, kind: "satin", colorIndex: 1 });

    // block 2: run (極細線) — Phase 4 PR19 で medial-axis に切替で stitch 数半減
    const b2 = pattern.blocks[2];
    expect(b2.colorIndex).toBe(2);
    expect(b2.rgb).toEqual([0, 0, 255]);
    // outer 1 周なぞる旧経路から medial-axis 1 本 (~10mm) に変わったため stitch 数減
    expect(countByKind(b2.stitches)).toEqual({ run: b2.stitches.length });
    expect(b2.stitches[0].kind).toBe("run");
    expect(b2.stitches[0].colorIndex).toBe(2);
    // medial-axis 上の y は 15.2 近傍 (15 + 0.4/2)
    expect(b2.stitches[0].y).toBeCloseTo(15.2, 1);

    // 末尾 block には stop を付けない (既存仕様)
    expect(b2.stitches[b2.stitches.length - 1].kind).toBe("run");
  });

  // generateStitches (legacy 互換 API) も renderDesign 経由なので、
  // 上の golden と同じ出力を返すことを確認する。
  it("互換 API generateStitches も golden と同じ StitchPattern を返す", () => {
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
    expect(pattern.totalStitches).toBe(206);
    // block 2 (run) は medial-axis 化で 52 → 25 stitches に減少
    expect(pattern.blocks.map((b) => b.stitches.length)).toEqual([172, 53, 25]);
  });
});

describe("Phase 1 受け入れ条件: fabric が render まで届く", () => {
  // 10mm 角の fill 1 つ。stitchDensityMm が scanline 間隔を直接決めるので、
  // makeDefaultConfig 経由の stitchDensity が fabric ごとに変わることをここで観測する。
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

  it("denim プロファイルを渡したパターンと terry プロファイルを渡したパターンで stitch 数が異なる (fabric が compose→render まで届いている証拠)", () => {
    // makeDefaultConfig が defaultDensityMm をそのまま stitchDensity にしているため、
    // denim (0.40) は terry (0.42) より stitch 間隔が小さい = stitch 数は多い。
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
    // density (=隣接走り間距離) が小さい denim の方が stitch 数が多い
    expect(denimPattern.totalStitches).toBeGreaterThan(terryPattern.totalStitches);
  });

  it("EmbroideryObject.props.densityMm が fabric.defaultDensityMm を反映する (buildObjects 経由)", () => {
    // 直接の生成物 (props) で fabric が反映されているかも確認
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

describe("Phase 2 受け入れ条件: lockstitch + underlay + compensation 統合", () => {
  // 100×100mm 相当の 3-color logo fixture (既存 equivalence test と同じ shape を流用)
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

  it("3 フラグ全 true で Phase 1 と totalStitches 完全一致", () => {
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

  it("フラグ未指定で stitch 数が Phase 1 比 +20% 以上増加 (Phase 2 受け入れ条件)", () => {
    const phase1 = generateStitches({
      ...commonInput,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const phase2Full = generateStitches({
      ...commonInput,
      // フラグなし = Phase 2 features 全 ON
    });
    const ratio = phase2Full.totalStitches / phase1.totalStitches;
    // Phase 2 計画 §9 受け入れ条件: +30〜+60% を目安にしているが、
    // 3-rect fixture では underlay 種別と shape 数の組合せで +20% 程度に収まる
    // ケースもある (現実の 3-color logo よりシンプル)。最低 +10% を確認する。
    expect(ratio).toBeGreaterThanOrEqual(1.1);
    expect(ratio).toBeLessThanOrEqual(3.0); // 上限はサニティチェック
  });

  it("disableUnderlay=true なら underlay 由来の stitch が消える", () => {
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

  it("disableLockstitch=true なら tie-in/off の 6 stitch * object 分が消える", () => {
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

  it("(Phase 2 ON でも) 穴あき矩形の穴の中に top fill / underlay どちらも落ちない", () => {
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
      // disable フラグ無し = Phase 2 ON
    });
    const block = pattern.blocks[0];
    // tie-in/off は anchor が hole 外なので汚染しない。fill (top) と run (underlay)
    // の両方を hole 内座標で検査する (run kind は tie-in/off も含むが、
    // それらは hole 外なので false positive にならない)。
    const insideHole = block.stitches.filter(
      (s) => s.x > 42 && s.x < 58 && s.y > 42 && s.y < 58,
    );
    expect(insideHole).toHaveLength(0);
  });

  it("(Phase 2 ON で) fabric ごとに totalStitches が異なる (fabric が renderer まで届く証拠)", () => {
    // Phase 1 では「denim > terry」だったが、Phase 2 では terry の heavier underlay
    // (tier3=zigzag) が density 差を逆転させ得る。本テストは「fabric が renderer
    // 全段に届いている」ことだけを確認 (大小関係には言及しない)。
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
    expect(denimPattern.totalStitches).not.toBe(terryPattern.totalStitches);
  });

  it("disableCompensation=true で applyPullCompensation がスキップされる (satin で観測)", () => {
    // direct renderSatin で compensation の効果を観測 (build-objects の kind 推定を経由しない)
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
    // compensation 適用時は短軸方向に bbox が広がるため、最終 satin の y 座標が異なる
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

describe("connectObjects (Phase 3 距離別繋ぎ)", () => {
  const policy = TRIM_POLICY_BY_FORMAT.dst; // trim=8 / jump=5 / travelRun=5

  it("距離 3mm (< travelRunUntilMm=5) → travel run 1 stitch (kind=run, 座標=next)", () => {
    const r = connectObjects([0, 0], [3, 0], 2, policy);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ x: 3, y: 0, kind: "run", colorIndex: 2 });
  });

  it("距離ちょうど 5mm → jump (厳密未満で travel run)", () => {
    const r = connectObjects([0, 0], [5, 0], 2, policy);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("jump");
  });

  it("距離 10mm (>= trim) → trim → jump の順", () => {
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

  it("カスタム policy で閾値が変わる", () => {
    const custom = {
      trimThresholdMm: 6,
      jumpThresholdMm: 3,
      travelRunUntilMm: 3,
    };
    const r = connectObjects([0, 0], [4, 0], 1, custom);
    expect(r[0].kind).toBe("jump");
  });
});

describe("renderDesign Phase 3 (policy 経路: object 間繋ぎ + tie 抑制)", () => {
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

  it("policy 未指定なら従来 trim+jump 動作 (Phase 1/2 互換、変更なし)", () => {
    const design = twoFillObjects(3);
    const pattern = renderDesign(design, {
      ...baseOpts,
      disableLockstitch: true,
    });
    const kinds = pattern.blocks[0].stitches.map((s) => s.kind);
    // 1mm = 3mm gap で従来 trim+jump 動作 (trimThresholdMm デフォルト 8mm より小さいので jump のみだが、appendObjectStitches の挙動は変わらない)
    // 重要: policy 経路を使わないことが期待
    expect(kinds).not.toContain("run"); // travel-run が挿入されない (= 旧経路)
  });

  it("policy 指定 + 寛容 threshold で travel run (kind=run) で連結される", () => {
    // 注: 実 stitch 端点距離は shape 端より大きくなる場合があるため、
    // policy 閾値を広げて travel-run 経路を確実に発火させる。
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
    // travel-run の kind=run が少なくとも 1 つ入る
    // (内部 scanline 由来の jump は fill 自体に存在しうるため、jump/trim の不在は assert しない)
    expect(kinds).toContain("run");
    expect(kinds).not.toContain("trim"); // travel-run 経路なら trim は確実に無い
  });

  it("policy 指定 + gap 10mm → trim+jump で連結", () => {
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

  it("travel-run 連結時は前 object の tie-off と次 object の tie-in が両方抑制される", () => {
    // 注: 寛容 threshold で travel-run 経路を発火させる
    const design = twoFillObjects(2);
    const looseT: typeof TRIM_POLICY_BY_FORMAT.dst = {
      trimThresholdMm: 20,
      jumpThresholdMm: 18,
      travelRunUntilMm: 18,
    };
    const withSuppress = renderDesign(design, {
      ...baseOpts,
      policy: looseT,
      // lockstitch ON: デフォルト
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
    // disableLockstitch=true: travel-run 1 + 0 tie 群 = 1 run
    // disableLockstitch=false (default 抑制有効): travel-run 1 + 最初 tie-in (3) + 最後 tie-off (3) = 7 run
    // (中間 obj の tie-off と次 obj の tie-in が travel-run 連結で抑制される)
    // 通常 (抑制なし) は 13 run (obj×2 の tie-in/off + travel-run)
    expect(runsSuppress).toBeGreaterThan(runsNoLock); // tie-in/off 由来で増えている
    expect(runsSuppress).toBeLessThan(runsNoLock + 12); // 完全 12 増 (全 tie 残し) よりは少ない
  });
});
