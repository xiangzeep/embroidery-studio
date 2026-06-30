import { describe, expect, it } from "vitest";
import { tatamiBrick } from "../fill";
import { FABRIC_PROFILES } from "../fabric";
import { __internal, generateStitches } from "../stitch";
import type { Shape } from "../types";
import type { ColorRegion } from "../vectorize";

const { fillStitches } = __internal;

describe("tatamiBrick — shiftMm=0 equivalence", () => {
  it("10mm 矩形 / shiftMm=0 で fillStitches と座標一致", () => {
    const shape: Shape = {
      outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [],
    };
    const expected = fillStitches(shape, 1, 0);
    const actual = tatamiBrick(shape, 1, 0, 7, 0, 4.0);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i].length).toBe(expected[i].length);
      for (let j = 0; j < expected[i].length; j++) {
        expect(actual[i][j][0]).toBeCloseTo(expected[i][j][0], 6);
        expect(actual[i][j][1]).toBeCloseTo(expected[i][j][1], 6);
      }
    }
  });

  it("穴あり矩形 / shiftMm=0 で fillStitches と一致", () => {
    const shape: Shape = {
      outer: [[0, 0], [20, 0], [20, 20], [0, 20]],
      holes: [[[8, 8], [12, 8], [12, 12], [8, 12]]],
    };
    const expected = fillStitches(shape, 1, 0);
    const actual = tatamiBrick(shape, 1, 0, 7, 0, 4.0);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i].length).toBe(expected[i].length);
      for (let j = 0; j < expected[i].length; j++) {
        expect(actual[i][j][0]).toBeCloseTo(expected[i][j][0], 6);
        expect(actual[i][j][1]).toBeCloseTo(expected[i][j][1], 6);
      }
    }
  });
});

describe("tatamiBrick — row-to-row phase shift", () => {
  it("行 1 (偶数行は phase=0) は端点だけ、行 2 で内部点に phase 適用", () => {
    const shape: Shape = {
      outer: [[0, 0], [50, 0], [50, 30], [0, 30]],
      holes: [],
    };
    // angleDeg=0: scanline は x 軸沿いで、y が密度刻みで進む。
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);

    // 各 segment の代表 y で行を識別
    const segByLine = new Map<number, Array<[number, number]>>();
    for (const seg of segs) {
      const y = Math.round(seg[0][1] * 1000) / 1000;
      if (!segByLine.has(y)) segByLine.set(y, seg);
    }
    const ys = [...segByLine.keys()].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(4);

    // 行 0: phase=0 → 端点 2 点のみ
    expect(segByLine.get(ys[0])!.length).toBe(2);

    // 行 1: phase=1.5 → 0 から始めて 1.5, 4.5, 7.5, ... と内部点を生成
    // (偶数行は left→right。奇数行は逆順なので first internal x は b - phase 起点)
    const row1 = segByLine.get(ys[1])!;
    // 奇数行: 反転されているので row1[0] が右端 (~50)、最後の要素が左端 (0)
    expect(row1[0][0]).toBeCloseTo(50, 4);
    expect(row1[row1.length - 1][0]).toBeCloseTo(0, 4);
    // 内部点が >= 1 個ある
    expect(row1.length).toBeGreaterThan(2);
  });

  it("phase=patternLengthMm の倍数になる行は端点 2 点のみ (周期回帰)", () => {
    const shape: Shape = {
      outer: [[0, 0], [50, 0], [50, 30], [0, 30]],
      holes: [],
    };
    // shiftMm=1.0, patternLengthMm=4.0 → 行 4 で (4*1.0) mod 4.0 = 0 → 端点だけ
    const segs = tatamiBrick(shape, 1, 0, 3, 1.0, 4.0);
    const segByLine = new Map<number, Array<[number, number]>>();
    for (const seg of segs) {
      const y = Math.round(seg[0][1] * 1000) / 1000;
      if (!segByLine.has(y)) segByLine.set(y, seg);
    }
    const ys = [...segByLine.keys()].sort((a, b) => a - b);
    expect(segByLine.get(ys[4])!.length).toBe(2);
  });
});

describe("tatamiBrick — respects holes", () => {
  it("穴の中に針落ち点が来ない", () => {
    const shape: Shape = {
      outer: [[0, 0], [20, 0], [20, 20], [0, 20]],
      holes: [[[8, 8], [12, 8], [12, 12], [8, 12]]],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const inHole = segs.flat().filter(
      ([x, y]) => x > 8.5 && x < 11.5 && y > 8.5 && y < 11.5,
    );
    expect(inHole.length).toBe(0);
  });

  it("穴跨ぎ scanline は 2 segment 以上に分割", () => {
    const shape: Shape = {
      outer: [[0, 0], [20, 0], [20, 20], [0, 20]],
      holes: [[[8, 8], [12, 8], [12, 12], [8, 12]]],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const onHoleLine = segs.filter((seg) => Math.abs(seg[0][1] - 10) < 0.5);
    expect(onHoleLine.length).toBeGreaterThanOrEqual(2);
  });
});

describe("generateStitches — uses tatamiBrick for fill", () => {
  it("50x50 矩形 fill で内部針落ち x が brick 分散する", () => {
    const regions: ColorRegion[] = [{
      colorIndex: 0,
      rgb: [0, 0, 0],
      svgPath: "",
      polygons: [],
      shapes: [{ outer: [[0, 0], [50, 0], [50, 50], [0, 50]], holes: [] }],
    }];
    const pattern = generateStitches({
      regions,
      fabric: FABRIC_PROFILES.denim,
      widthMm: 50,
      heightMm: 50,
      widthPx: 50,
      heightPx: 50,
      stitchDensityMm: 1,
      satinMaxWidthMm: 2,
      maxStitchMm: 3,
      fillAngleDeg: 0,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const fills = pattern.blocks[0].stitches.filter((s) => s.kind === "fill");
    const internalXs = new Set(
      fills
        .map((s) => Math.round(s.x * 10) / 10)
        .filter((x) => x > 0.05 && x < 49.95),
    );
    // brick 分散により、内部針落ち位置の種類は >5
    expect(internalXs.size).toBeGreaterThan(5);
  });
});
