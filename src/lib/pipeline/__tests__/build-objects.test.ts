import { describe, it, expect } from "vitest";
import { buildObjects } from "../build-objects";
import { generateStitches } from "../stitch";
import { FABRIC_PROFILES } from "../fabric";
import type { ColorRegion } from "../vectorize";
import type { StitchKind } from "../types";

describe("buildObjects — 基本", () => {
  it("regions が空なら空配列を返す", () => {
    const result = buildObjects({
      regions: [],
      widthMm: 100,
      widthPx: 1000,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toEqual([]);
  });

  it("shape.outer が 3 点未満の region は無視される", () => {
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
  it("正方形 (10mm 角) の region は kind=fill になる", () => {
    const square: ColorRegion = {
      colorIndex: 0,
      rgb: [255, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]], // px 座標
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
    // mm 座標に変換されている (10mm × 10mm の正方形)
    expect(result[0].shape.outer).toEqual([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ]);
    expect(result[0].shape.holes).toEqual([]);
  });

  it("id が `${colorIndex}-${shapeIndex}` 形式で安定する", () => {
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
  it("細長い帯 (幅 0.8mm, 長さ 10mm, aspect > 4) は kind=satin", () => {
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
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("satin");
  });

  it("極細線 (幅 0.4mm < runMaxWidthMm 0.6mm) は kind=run", () => {
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

  it("aspect ratio が 4 以下なら satin にならず fill になる", () => {
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

describe("buildObjects — 穴の保持", () => {
  it("外形に穴があると shape.holes が mm 座標で保持される", () => {
    const donut: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [200, 0], [200, 200], [0, 200]], // 20mm 角
        holes: [[[80, 80], [120, 80], [120, 120], [80, 120]]], // 中央 4mm 角の穴
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
    expect(result[0].kind).toBe("fill"); // holes ありなので satin にはならない
    expect(result[0].shape.holes).toEqual([
      [[8, 8], [12, 8], [12, 12], [8, 12]],
    ]);
  });

  it("3 点未満の holes はスキップされる", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
        holes: [[[10, 10], [20, 10]]], // 2 点のみ
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

describe("buildObjects — props のデフォルト派生", () => {
  it("densityMm が fabric.defaultDensityMm を採用する", () => {
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

  it("terry は denim より高い densityMm を持つ", () => {
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

  it("satin オブジェクトには pullCompMm が幅 (shortSide) から派生する", () => {
    // 100px x 8px → 10mm x 0.8mm 帯
    const stripe: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 8], [0, 8]], holes: [] }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 10, widthPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("satin");
    // pullCompForWidth(denim, 0.8) = max(0.10, 0.025 * 0.8) = max(0.10, 0.02) = 0.10
    expect(result[0].props.pullCompMm).toBeCloseTo(0.10);
  });

  it("underlay が fabric.underlayPolicy[kind](width) で派生する", () => {
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

describe("buildObjects — generateStitches との整合性", () => {
  // NOTE (documentation-level regression guard):
  //   Cycle 6 で generateStitches の kind 判定は determineKind() に委譲された。
  //   よって本テストの両側は同一 determineKind の戻り値を 2 経路で観測しているに
  //   過ぎず、判定ロジックが恒等的に壊れた場合 (例: 常に "fill" を返す) しか
  //   failure を検出できない。
  //   将来 stitch.ts 内に独自の kind 判定を再導入するリファクタが発生した場合の
  //   ガードとして残し、それ以外の用途では強い回帰検出は期待しない。
  it("同じ region 入力から buildObjects が返す kind 構成が、generateStitches の stitch.kind 構成に含まれる", () => {
    // mmPerPx = 50/500 = 0.1
    // Region 0: 100×100 px = 10×10 mm 正方形 → fill
    // Region 1: 100×8  px = 10×0.8 mm 帯, aspect=12.5 > 4 → satin
    // Region 2: 100×4  px = 10×0.4 mm 細線, shortSide < 0.6 → run
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
    };

    const objects = buildObjects({
      ...sharedOpts,
      regions,
      fabric: FABRIC_PROFILES.denim,
    });
    const pattern = generateStitches({
      ...sharedOpts,
      // generateStitches は legacy StitchInput を受け取るため heightMm/heightPx を補う
      heightMm: 50, heightPx: 500,
      regions,
      fabric: FABRIC_PROFILES.denim,
      stitchDensityMm: 0.4,
      // Phase 2 features を OFF: この test は Phase 1 の kind 構成 (run/satin/fill 単独)
      // を assert するため、underlay/lockstitch で kind=run が増えると整合性が崩れる。
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    // 期待: 3 オブジェクト (fill / satin / run)
    expect(objects.map((o) => o.kind)).toEqual(["fill", "satin", "run"]);

    // 各 block の run/satin/fill kind 集合と、対応する object.kind が一致
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
    // colorIndex 順に並んだ blocks の kind 集合と objects の kind が一致
    expect(kindsByBlock).toEqual([["fill"], ["satin"], ["run"]]);
  });
});
