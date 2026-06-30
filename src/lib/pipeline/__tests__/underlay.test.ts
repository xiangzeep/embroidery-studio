import { describe, it, expect } from "vitest";
import {
  __internal,
  centerRunUnderlay,
  edgeRunUnderlay,
  fillUnderlay,
  generateUnderlayStitches,
  zigzagUnderlay,
} from "../underlay";
import type { EmbroideryObject, Shape } from "../types";

describe("edgeRunUnderlay (rectangle, no hole)", () => {
  const square10: Shape = {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [],
  };

  it("translated case", () => {
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
  });

  it("translated case", () => {
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    for (const [x, y] of rings[0]) {
      expect(x).toBeGreaterThanOrEqual(0.4 - 0.05);
      expect(x).toBeLessThanOrEqual(9.6 + 0.05);
      expect(y).toBeGreaterThanOrEqual(0.4 - 0.05);
      expect(y).toBeLessThanOrEqual(9.6 + 0.05);
      const d = Math.min(
        Math.abs(x - 0.4),
        Math.abs(x - 9.6),
        Math.abs(y - 0.4),
        Math.abs(y - 9.6),
      );
      expect(d).toBeLessThanOrEqual(0.1);
    }
  });

  it("translated case", () => {
    // English note.
    // English note.
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    const ring = rings[0];
    for (let i = 1; i < ring.length; i++) {
      const d = Math.hypot(
        ring[i][0] - ring[i - 1][0],
        ring[i][1] - ring[i - 1][1],
      );
      expect(d).toBeGreaterThanOrEqual(2.5 / Math.SQRT2 - 0.05);
      expect(d).toBeLessThanOrEqual(2.5 * 1.05);
    }
  });
});

describe("edgeRunUnderlay (rectangle with hole)", () => {
  const ringShape: Shape = {
    outer: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
    holes: [
      [
        [6, 6],
        [14, 6],
        [14, 14],
        [6, 14],
      ],
    ],
  };

  it("translated case", () => {
    const rings = edgeRunUnderlay(ringShape, 0.4, 2.5);
    expect(rings).toHaveLength(2);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
    expect(rings[1].length).toBeGreaterThanOrEqual(4);
  });

  it("translated case", () => {
    // English note.
    // English note.
    const rings = edgeRunUnderlay(ringShape, 0.4, 2.5);
    function bboxSpan(r: [number, number][]): number {
      let lo = Infinity,
        hi = -Infinity;
      for (const [x] of r) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return hi - lo;
    }
    const sorted = [...rings].sort((a, b) => bboxSpan(a) - bboxSpan(b));
    const holeRing = sorted[0];
    expect(bboxSpan(holeRing)).toBeLessThan(12); // hole bbox span is about 8.8
    for (const [x, y] of holeRing) {
      expect(x).toBeGreaterThanOrEqual(5.6 - 0.1);
      expect(x).toBeLessThanOrEqual(14.4 + 0.1);
      expect(y).toBeGreaterThanOrEqual(5.6 - 0.1);
      expect(y).toBeLessThanOrEqual(14.4 + 0.1);
    }
  });
});

describe("centerRunUnderlay (thin rectangle)", () => {
  const thinBar: Shape = {
    outer: [
      [0, 0],
      [20, 0],
      [20, 2],
      [0, 2],
    ],
    holes: [],
  };

  it("translated case", () => {
    const line = centerRunUnderlay(thinBar, 2.5);
    expect(line.length).toBeGreaterThanOrEqual(6);
    expect(line.length).toBeLessThanOrEqual(12);
    for (const [, y] of line) {
      expect(y).toBeGreaterThanOrEqual(1.0 - 0.3);
      expect(y).toBeLessThanOrEqual(1.0 + 0.3);
    }
    const xs = line.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(15);
  });

  it("translated case", () => {
    const line = centerRunUnderlay(thinBar, 2.5);
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot(
        line[i][0] - line[i - 1][0],
        line[i][1] - line[i - 1][1],
      );
      expect(d).toBeGreaterThanOrEqual(2.5 * 0.8);
      expect(d).toBeLessThanOrEqual(2.5 * 1.2);
    }
  });

  it("translated case", () => {
    const dot: Shape = {
      outer: [
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ],
      holes: [],
    };
    expect(centerRunUnderlay(dot, 2.5)).toEqual([]);
  });
});

describe("__internal helpers", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
        ],
      ],
    };
    expect(__internal.offsetShapeInward(shape, 0.5)).toHaveLength(2);
  });

  it("translated case", () => {
    // English note.
    // English note.
    const w = 12,
      h = 5;
    const mask = new Uint8Array(w * h);
    for (let y = 1; y <= 3; y++)
      for (let x = 1; x <= 10; x++) mask[y * w + x] = 1;
    const skel = __internal.thinMaskZhangSuen(mask, w, h);
    let centerCells = 0,
      otherCells = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!skel[y * w + x]) continue;
        if (y === 2) centerCells++;
        else otherCells++;
      }
    expect(centerCells).toBeGreaterThanOrEqual(6);
    expect(otherCells).toBeLessThanOrEqual(2);
  });
});

describe("edge cases", () => {
  const sq: Shape = {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [],
  };

  it("translated case", () => {
    expect(edgeRunUnderlay(sq, 0, 2.5)).toEqual([]);
    expect(edgeRunUnderlay(sq, -0.1, 2.5)).toEqual([]);
    expect(edgeRunUnderlay(sq, 0.4, 0)).toEqual([]);
  });

  it("translated case", () => {
    const tiny: Shape = {
      outer: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      holes: [],
    };
    expect(edgeRunUnderlay(tiny, 0.6, 2.5)).toEqual([]);
  });

  it("translated case", () => {
    // English note.
    // English note.
    // English note.
    const withHole: Shape = {
      outer: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      holes: [
        [
          [0.3, 0.3],
          [0.7, 0.3],
          [0.7, 0.7],
          [0.3, 0.7],
        ],
      ],
    };
    expect(edgeRunUnderlay(withHole, 0.6, 2.5)).toEqual([]);
  });

  it("translated case", () => {
    const tri: Shape = {
      outer: [
        [0, 0],
        [5, 0],
        [2.5, 4],
      ],
      holes: [],
    };
    expect(centerRunUnderlay(tri, 1.0).length).toBeGreaterThanOrEqual(2);
  });
});

describe("fillUnderlay", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const segs = fillUnderlay(shape, 0, 3);
    expect(segs.length).toBeGreaterThanOrEqual(3);
    expect(segs.length).toBeLessThanOrEqual(5);
    for (const seg of segs) {
      expect(seg.length).toBe(2);
      const [p0, p1] = seg;
      expect(p0[0]).toBeCloseTo(p1[0], 4); // 垂直 = x 相同
      const ys = [p0[1], p1[1]].sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(0, 4);
      expect(ys[1]).toBeCloseTo(10, 4);
    }
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
      holes: [],
    };
    const coarse = fillUnderlay(shape, 0, 4);
    const fine = fillUnderlay(shape, 0, 2);
    expect(fine.length).toBeGreaterThan(coarse.length * 1.8);
    expect(fine.length).toBeLessThan(coarse.length * 2.2);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
      holes: [
        [
          [8, 8],
          [12, 8],
          [12, 12],
          [8, 12],
        ],
      ],
    };
    const segs = fillUnderlay(shape, 0, 1);
    const pts = segs.flat();
    const insideHole = pts.filter(
      ([x, y]) => x > 8.5 && x < 11.5 && y > 9 && y < 11,
    );
    expect(insideHole.length).toBe(0);
  });

  it("translated case", () => {
    const sq: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    expect(fillUnderlay(sq, 0, 0)).toEqual([]);
    expect(
      fillUnderlay(
        {
          outer: [
            [0, 0],
            [1, 0],
          ],
          holes: [],
        },
        0,
        1,
      ),
    ).toEqual([]);
  });
});

describe("zigzagUnderlay", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 5],
        [0, 5],
      ],
      holes: [],
    };
    const pts = zigzagUnderlay(shape, 2, 0.5);
    expect(pts.length).toBeGreaterThanOrEqual(14);
    expect(pts.length).toBeLessThanOrEqual(18);
    const ys = pts.map(([, y]) => y);
    const railLow = ys.filter((y) => Math.abs(y - 0.5) < 0.15).length;
    const railHigh = ys.filter((y) => Math.abs(y - 4.5) < 0.15).length;
    expect(railLow + railHigh).toBe(pts.length);
    expect(Math.abs(railLow - railHigh)).toBeLessThanOrEqual(1);
    // English note.
    for (let i = 1; i < pts.length; i++) {
      const prevHigh = pts[i - 1][1] > 2.5;
      const currHigh = pts[i][1] > 2.5;
      expect(currHigh).not.toBe(prevHigh);
    }
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [40, 0],
        [40, 6],
        [0, 6],
      ],
      holes: [],
    };
    const sparse = zigzagUnderlay(shape, 4, 0.5);
    const dense = zigzagUnderlay(shape, 1, 0.5);
    expect(dense.length).toBeGreaterThan(sparse.length * 3);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [20, 0],
        [20, 5],
        [0, 5],
      ],
      holes: [],
    };
    const small = zigzagUnderlay(shape, 2, 0.5);
    const large = zigzagUnderlay(shape, 2, 1.0);
    const yMinSmall = Math.min(...small.map(([, y]) => y));
    const yMinLarge = Math.min(...large.map(([, y]) => y));
    expect(yMinLarge).toBeGreaterThan(yMinSmall);
    expect(yMinSmall).toBeCloseTo(0.5, 1);
    expect(yMinLarge).toBeCloseTo(1.0, 1);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [20, 0],
        [20, 2],
        [0, 2],
      ],
      holes: [],
    };
    expect(zigzagUnderlay(shape, 2, 2.0)).toEqual([]);
  });
});

describe("generateUnderlayStitches dispatch", () => {
  function fillObj(
    underlay?: EmbroideryObject["props"]["underlay"],
  ): EmbroideryObject {
    return {
      id: "o",
      kind: "fill",
      colorIndex: 7,
      rgb: [0, 0, 0],
      shape: {
        outer: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holes: [],
      },
      order: 0,
      props: {
        densityMm: 0.4,
        maxStitchMm: 7,
        ...(underlay !== undefined ? { underlay } : {}),
      },
    };
  }

  it('kind="none" returns an empty array', () => {
    expect(generateUnderlayStitches(fillObj({ kind: "none" }))).toEqual([]);
  });

  it("translated case", () => {
    expect(generateUnderlayStitches(fillObj(undefined))).toEqual([]);
  });

  it('kind="edge-run" returns run stitches inside the inset frame', () => {
    const r = generateUnderlayStitches(
      fillObj({ kind: "edge-run", insetMm: 0.4, stitchLenMm: 2 }),
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.kind === "run")).toBe(true);
    expect(r.every((s) => s.colorIndex === 7)).toBe(true);
    for (const s of r) {
      expect(s.x).toBeGreaterThanOrEqual(0.4 - 1e-3);
      expect(s.x).toBeLessThanOrEqual(9.6 + 1e-3);
    }
  });

  it('kind="center-run" produces a polyline for narrow satin', () => {
    const obj: EmbroideryObject = {
      ...fillObj({ kind: "center-run", stitchLenMm: 2 }),
      kind: "satin",
      shape: {
        outer: [
          [0, 0],
          [20, 0],
          [20, 2],
          [0, 2],
        ],
        holes: [],
      },
    };
    const r = generateUnderlayStitches(obj);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.kind === "run")).toBe(true);
  });

  it('kind="zigzag" returns a polyline between rails', () => {
    const obj: EmbroideryObject = {
      ...fillObj({ kind: "zigzag", spacingMm: 2, insetMm: 0.5 }),
      kind: "satin",
      shape: {
        outer: [
          [0, 0],
          [30, 0],
          [30, 5],
          [0, 5],
        ],
        holes: [],
      },
    };
    const r = generateUnderlayStitches(obj);
    expect(r.length).toBeGreaterThan(10);
  });

  it('kind="fill" routes scanline segments safely', () => {
    const r = generateUnderlayStitches(
      fillObj({ kind: "fill", angleDeg: 0, spacingMm: 3 }),
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((s) => s.kind === "run")).toBe(true);
    expect(r.some((s) => s.kind === "jump")).toBe(true);
  });
});
