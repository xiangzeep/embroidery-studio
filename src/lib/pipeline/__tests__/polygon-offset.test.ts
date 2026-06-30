import { describe, it, expect } from "vitest";
import {
  offsetPolygon,
  offsetShape,
  polygonsOverlap,
} from "../polygon-offset";
import type { Polygon, Shape } from "../types";

function bbox(polys: Polygon[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of polys)
    for (const [x, y] of p) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  return { w: maxX - minX, h: maxY - minY, minX, maxX, minY, maxY };
}

describe("offsetPolygon", () => {
  const rect5x1: Polygon = [
    [0, 0],
    [5, 0],
    [5, 1],
    [0, 1],
  ];

  it("5mm 矩形を +0.2mm 外側オフセットすると bbox 幅が約 5.4mm に広がる", () => {
    const out = offsetPolygon(rect5x1, 0.2);
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(0);
    const b = bbox(out!);
    expect(b.w).toBeCloseTo(5.4, 1);
    expect(b.h).toBeCloseTo(1.4, 1);
    expect(b.minX).toBeCloseTo(-0.2, 1);
  });

  it("5mm 矩形を -0.2mm 内側オフセットすると bbox 幅が約 4.6mm に縮む", () => {
    const out = offsetPolygon(rect5x1, -0.2);
    expect(out).not.toBeNull();
    const b = bbox(out!);
    expect(b.w).toBeCloseTo(4.6, 1);
    expect(b.h).toBeCloseTo(0.6, 1);
  });

  it("5mm 正方形を -3mm 内側オフセットすると空配列を返す (消失)", () => {
    const sq: Polygon = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ];
    expect(offsetPolygon(sq, -3)).toEqual([]);
  });

  it("3 点未満の polygon は null を返す", () => {
    expect(
      offsetPolygon(
        [
          [0, 0],
          [1, 1],
        ],
        0.1,
      ),
    ).toBeNull();
  });
});

describe("offsetShape", () => {
  it("outer を +0.2 / hole を -0.2 でオフセットし outer は拡大 hole は縮小", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      ],
    };
    const r = offsetShape(shape, 0.2, -0.2);
    const ob = bbox([r.outer]);
    expect(ob.w).toBeCloseTo(10.4, 1);
    expect(r.holes).toHaveLength(1);
    const hb = bbox([r.holes[0]]);
    expect(hb.w).toBeCloseTo(3.6, 1);
  });

  it("outer が消失する内側オフセットでは元 shape の深いコピーを返す (フォールバック)", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      holes: [],
    };
    const r = offsetShape(shape, -2, 0);
    expect(r).toEqual(shape);
    expect(r).not.toBe(shape);
    expect(r.outer).not.toBe(shape.outer);
  });

  it("hole が消失したら holes 配列から落とすが outer は維持", () => {
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
          [5, 4],
          [5, 5],
          [4, 5],
        ],
      ],
    };
    const r = offsetShape(shape, 0, -2);
    expect(r.holes).toHaveLength(0);
    expect(bbox([r.outer]).w).toBeCloseTo(10, 2);
  });
});

describe("polygonsOverlap", () => {
  const s = (pts: Polygon): Shape => ({ outer: pts, holes: [] });

  it("完全に分離した 2 矩形は false", () => {
    expect(
      polygonsOverlap(
        s([
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ]),
        s([
          [10, 10],
          [15, 10],
          [15, 15],
          [10, 15],
        ]),
      ),
    ).toBe(false);
  });

  it("bbox は接触するが多角形は重ならないケースは false", () => {
    expect(
      polygonsOverlap(
        s([
          [0, 0],
          [10, 0],
          [0, 10],
        ]),
        s([
          [10, 10],
          [10, 5],
          [5, 10],
        ]),
      ),
    ).toBe(false);
  });

  it("半分重なる 2 矩形は true", () => {
    expect(
      polygonsOverlap(
        s([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
        s([
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ]),
      ),
    ).toBe(true);
  });

  it("完全に内包される矩形は true", () => {
    expect(
      polygonsOverlap(
        s([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
        s([
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ]),
      ),
    ).toBe(true);
  });
});
