import { describe, expect, it } from "vitest";
import {
  insertVertexAt,
  moveVertexTo,
  pickEdgeMidpoint,
  pickVertex,
  removeVertexAt,
} from "../node-hit-test";
import type { Polygon } from "@/lib/pipeline/types";

const triangle: Polygon = [[0, 0], [10, 0], [5, 8]];
const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe("pickVertex", () => {
  it("頂点に近い点で index を返す", () => {
    expect(pickVertex(triangle, [0.2, 0.2], 1)).toBe(0);
    expect(pickVertex(triangle, [9.8, 0.1], 1)).toBe(1);
    expect(pickVertex(triangle, [5.1, 8.05], 1)).toBe(2);
  });

  it("半径外は null", () => {
    expect(pickVertex(triangle, [5, 5], 1)).toBe(null);
  });

  it("近接複数頂点では最小距離を採用", () => {
    const poly: Polygon = [[0, 0], [0.1, 0]];
    expect(pickVertex(poly, [0.04, 0], 1)).toBe(0);
    expect(pickVertex(poly, [0.06, 0], 1)).toBe(1);
  });

  it("空 polygon は null", () => {
    expect(pickVertex([], [0, 0], 1)).toBe(null);
  });
});

describe("pickEdgeMidpoint", () => {
  it("辺中点近傍で辺始点 index を返す", () => {
    // 三角形 outer[0]→outer[1] の中点 (5, 0)
    expect(pickEdgeMidpoint(triangle, [5, 0.1], 1)).toBe(0);
    // outer[1]→outer[2] 中点 = (7.5, 4)
    expect(pickEdgeMidpoint(triangle, [7.5, 4.1], 1)).toBe(1);
    // outer[2]→outer[0] 中点 = (2.5, 4)
    expect(pickEdgeMidpoint(triangle, [2.5, 4], 1)).toBe(2);
  });

  it("辺中点から離れた点は null", () => {
    expect(pickEdgeMidpoint(triangle, [0, 0], 0.5)).toBe(null);
  });

  it("2 点未満は null", () => {
    expect(pickEdgeMidpoint([[0, 0]], [0, 0], 1)).toBe(null);
    expect(pickEdgeMidpoint([], [0, 0], 1)).toBe(null);
  });
});

describe("insertVertexAt", () => {
  it("辺の中点に頂点を挿入する (immutable)", () => {
    const out = insertVertexAt(square, 0); // 辺 0→1 (= (0,0)→(10,0)) 中点 = (5, 0)
    expect(out).toEqual([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]);
    // 入力非破壊
    expect(square.length).toBe(4);
  });

  it("最終辺 (closing edge) も扱える", () => {
    const out = insertVertexAt(square, 3); // 辺 3→0 (= (0,10)→(0,0)) 中点 = (0, 5)
    expect(out).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 5]]);
  });

  it("範囲外 edgeIndex は no-op コピーを返す", () => {
    const out = insertVertexAt(square, 99);
    expect(out).toEqual(square);
    expect(out).not.toBe(square);
  });
});

describe("removeVertexAt", () => {
  it("頂点を削除した polygon を返す (immutable)", () => {
    const out = removeVertexAt(square, 1);
    expect(out).toEqual([[0, 0], [10, 10], [0, 10]]);
    // 入力非破壊
    expect(square.length).toBe(4);
  });

  it("頂点数 3 で削除は null (頂点 < 3 を作らない)", () => {
    expect(removeVertexAt(triangle, 0)).toBe(null);
  });

  it("範囲外 index は null", () => {
    expect(removeVertexAt(square, -1)).toBe(null);
    expect(removeVertexAt(square, 99)).toBe(null);
  });
});

describe("moveVertexTo", () => {
  it("指定頂点を新座標に移動する (immutable)", () => {
    const out = moveVertexTo(square, 0, [3, 4]);
    expect(out[0]).toEqual([3, 4]);
    expect(out[1]).toEqual([10, 0]);
    // 入力非破壊
    expect(square[0]).toEqual([0, 0]);
  });

  it("範囲外 index は no-op コピー", () => {
    const out = moveVertexTo(square, 99, [3, 4]);
    expect(out).toEqual(square);
    expect(out).not.toBe(square);
  });
});
