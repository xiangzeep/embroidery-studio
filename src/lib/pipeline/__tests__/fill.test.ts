import { describe, expect, it } from "vitest";
import { photoRandomFill, tatamiBrick } from "../fill";
import { FABRIC_PROFILES } from "../fabric";
import { __internal, generateStitches } from "../stitch";
import type { Shape } from "../types";
import type { ColorRegion } from "../vectorize";

const { fillStitches } = __internal;

describe("tatamiBrick — shiftMm=0 equivalence", () => {
  it("translated case", () => {
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

  it("translated case", () => {
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
  it("translated case", () => {
    const shape: Shape = {
      outer: [[0, 0], [50, 0], [50, 30], [0, 30]],
      holes: [],
    };
    // English note.
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);

    // English note.
    const segByLine = new Map<number, Array<[number, number]>>();
    for (const seg of segs) {
      const y = Math.round(seg[0][1] * 1000) / 1000;
      if (!segByLine.has(y)) segByLine.set(y, seg);
    }
    const ys = [...segByLine.keys()].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(4);

    // English note.
    expect(segByLine.get(ys[0])!.length).toBe(2);

    // English note.
    // English note.
    const row1 = segByLine.get(ys[1])!;
    // English note.
    expect(row1[0][0]).toBeCloseTo(50, 4);
    expect(row1[row1.length - 1][0]).toBeCloseTo(0, 4);
    // English note.
    expect(row1.length).toBeGreaterThan(2);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [[0, 0], [50, 0], [50, 30], [0, 30]],
      holes: [],
    };
    // English note.
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
  it("translated case", () => {
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

  it("translated case", () => {
    const shape: Shape = {
      outer: [[0, 0], [20, 0], [20, 20], [0, 20]],
      holes: [[[8, 8], [12, 8], [12, 12], [8, 12]]],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const onHoleLine = segs.filter((seg) => Math.abs(seg[0][1] - 10) < 0.5);
    expect(onHoleLine.length).toBeGreaterThanOrEqual(2);
  });
});

describe("photoRandomFill", () => {
  it("adds interior variation beyond straight tatami rows", () => {
    const shape: Shape = {
      outer: [[0, 0], [24, 0], [24, 12], [0, 12]],
      holes: [],
    };

    const base = tatamiBrick(shape, 1, 0, 4);
    const random = photoRandomFill(shape, 1, 0, 4, 17);

    expect(random).toHaveLength(base.length);
    expect(random.some((segment, index) => segment.length > base[index].length)).toBe(true);
  });

  it("keeps randomized points inside the shape body", () => {
    const shape: Shape = {
      outer: [[0, 0], [24, 0], [24, 12], [0, 12]],
      holes: [[[9, 4], [15, 4], [15, 8], [9, 8]]],
    };

    const random = photoRandomFill(shape, 1, 0, 4, 23);

    const inHole = random.flat().filter(
      ([x, y]) => x > 9.1 && x < 14.9 && y > 4.1 && y < 7.9,
    );

    expect(inHole.length).toBe(0);
  });
});

describe("generateStitches — uses tatamiBrick for fill", () => {
  it("translated case", () => {
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
    // English note.
    expect(internalXs.size).toBeGreaterThan(5);
  });
});
