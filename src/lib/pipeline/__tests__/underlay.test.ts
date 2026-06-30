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

  it("10mm 正方形に対して 1 本の閉ループ polyline を返す", () => {
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
  });

  it("各点は外形から insetMm だけ内側にある (±0.1mm)", () => {
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

  it("隣接点間距離は stitchLenMm 以下 (90° 角での corner cut を許容)", () => {
    // 90° 角の corner cut では Euclidean = 直線歩行距離/√2 まで縮みうるため、
    // 物理ステッチ長を表す **上限**側のみ strict にチェックする。下限は ≥ stitch/√2 程度。
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

  it("外形リング + 穴リングの計 2 本を返す", () => {
    const rings = edgeRunUnderlay(ringShape, 0.4, 2.5);
    expect(rings).toHaveLength(2);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
    expect(rings[1].length).toBeGreaterThanOrEqual(4);
  });

  it("穴リングは穴を insetMm だけ外側に膨らませたリング ([5.6..14.4] bbox)", () => {
    // outer と hole は中心が同じ (10,10) で重心では区別不能なので、
    // 「より小さい bbox 範囲のリング」= 穴リング、で識別する。
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
    expect(bboxSpan(holeRing)).toBeLessThan(12); // 穴 bbox span ≒ 8.8
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

  it("細長矩形の中央線 (y ≒ 1.0, ±0.3mm) を返す", () => {
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

  it("隣接点間距離は stitchLenMm の ±20% 以内", () => {
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

  it("極小面積の shape (≦ 0.25mm²) に対して空配列を返す", () => {
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
  it("offsetShapeInward は outer -delta / 穴 +delta で 2 本", () => {
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

  it("thinMaskZhangSuen は 10×3 horizontal bar を中央行 1 ピクセル幅にする", () => {
    // 標準 Zhang-Suen は端点を侵食するため、10px 幅入力に対して skeleton は概ね 6-10px。
    // 全ピクセルが中央行 (y=2) に集まる「1px 厚」の性質のみを strict にチェックする。
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

  it("edgeRunUnderlay: insetMm <= 0 / stitchLenMm <= 0 で空配列", () => {
    expect(edgeRunUnderlay(sq, 0, 2.5)).toEqual([]);
    expect(edgeRunUnderlay(sq, -0.1, 2.5)).toEqual([]);
    expect(edgeRunUnderlay(sq, 0.4, 0)).toEqual([]);
  });

  it("edgeRunUnderlay: inset が大きすぎて外形消失で空配列", () => {
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

  it("edgeRunUnderlay: 外形消失時は holes があっても空配列 (順序契約の保護)", () => {
    // [0,1]² の outer (1mm 角) を 0.6mm 内側オフセット → 消失。
    // 一方 hole は 0.4mm 角を +0.6mm 外側オフセットしても残るため、
    // 順序契約が破られないよう実装側で全体を [] にする必要がある。
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

  it("centerRunUnderlay: 三角形でも 2 点以上の polyline", () => {
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
  it("表縫い angle=0 (水平) に直交した垂直スキャンを spacingMm 間隔で生成", () => {
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
      expect(p0[0]).toBeCloseTo(p1[0], 4); // 垂直 = x 同一
      const ys = [p0[1], p1[1]].sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(0, 4);
      expect(ys[1]).toBeCloseTo(10, 4);
    }
  });

  it("spacingMm を半分にすると scanline 本数がおおむね倍", () => {
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

  it("穴を持つ shape では穴内部に scanline 点が落ちない", () => {
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

  it("spacingMm <= 0 や outer 退化で空配列", () => {
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
  it("幅 5mm × 長さ 30mm の satin で両 rail 間を spacingMm で往復する単一 polyline", () => {
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
    // 隣接点は必ず逆 rail (zigzag 性)
    for (let i = 1; i < pts.length; i++) {
      const prevHigh = pts[i - 1][1] > 2.5;
      const currHigh = pts[i][1] > 2.5;
      expect(currHigh).not.toBe(prevHigh);
    }
  });

  it("spacingMm が小さいほどステップ数が増える", () => {
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

  it("insetMm を 1.0 に増やすと rail 位置が内側に寄る", () => {
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

  it("insetMm が shortSide/2 を超えると空配列 (退化ケース)", () => {
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

  it('kind="none" なら空配列', () => {
    expect(generateUnderlayStitches(fillObj({ kind: "none" }))).toEqual([]);
  });

  it("underlay 未定義でも空配列", () => {
    expect(generateUnderlayStitches(fillObj(undefined))).toEqual([]);
  });

  it('kind="edge-run" は kind=run の連続で inset 0.4mm の枠内座標', () => {
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

  it('kind="center-run" は細長 satin で polyline 化', () => {
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

  it('kind="zigzag" は両 rail 間 polyline', () => {
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

  it('kind="fill" は segments を flatten', () => {
    const r = generateUnderlayStitches(
      fillObj({ kind: "fill", angleDeg: 0, spacingMm: 3 }),
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.kind === "run")).toBe(true);
  });
});
