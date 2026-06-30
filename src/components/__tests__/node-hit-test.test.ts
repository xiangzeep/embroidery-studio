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
  it("translated case", () => {
    expect(pickVertex(triangle, [0.2, 0.2], 1)).toBe(0);
    expect(pickVertex(triangle, [9.8, 0.1], 1)).toBe(1);
    expect(pickVertex(triangle, [5.1, 8.05], 1)).toBe(2);
  });

  it("translated case", () => {
    expect(pickVertex(triangle, [5, 5], 1)).toBe(null);
  });

  it("translated case", () => {
    const poly: Polygon = [[0, 0], [0.1, 0]];
    expect(pickVertex(poly, [0.04, 0], 1)).toBe(0);
    expect(pickVertex(poly, [0.06, 0], 1)).toBe(1);
  });

  it("translated case", () => {
    expect(pickVertex([], [0, 0], 1)).toBe(null);
  });
});

describe("pickEdgeMidpoint", () => {
  it("translated case", () => {
    // English note.
    expect(pickEdgeMidpoint(triangle, [5, 0.1], 1)).toBe(0);
    // outer[1]→outer[2] 中点 = (7.5, 4)
    expect(pickEdgeMidpoint(triangle, [7.5, 4.1], 1)).toBe(1);
    // outer[2]→outer[0] 中点 = (2.5, 4)
    expect(pickEdgeMidpoint(triangle, [2.5, 4], 1)).toBe(2);
  });

  it("translated case", () => {
    expect(pickEdgeMidpoint(triangle, [0, 0], 0.5)).toBe(null);
  });

  it("translated case", () => {
    expect(pickEdgeMidpoint([[0, 0]], [0, 0], 1)).toBe(null);
    expect(pickEdgeMidpoint([], [0, 0], 1)).toBe(null);
  });
});

describe("insertVertexAt", () => {
  it("translated case", () => {
    const out = insertVertexAt(square, 0); // 辺 0→1 (= (0,0)→(10,0)) 中点 = (5, 0)
    expect(out).toEqual([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]);
    // input is not mutated
    expect(square.length).toBe(4);
  });

  it("translated case", () => {
    const out = insertVertexAt(square, 3); // 辺 3→0 (= (0,10)→(0,0)) 中点 = (0, 5)
    expect(out).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 5]]);
  });

  it("translated case", () => {
    const out = insertVertexAt(square, 99);
    expect(out).toEqual(square);
    expect(out).not.toBe(square);
  });
});

describe("removeVertexAt", () => {
  it("translated case", () => {
    const out = removeVertexAt(square, 1);
    expect(out).toEqual([[0, 0], [10, 10], [0, 10]]);
    // input is not mutated
    expect(square.length).toBe(4);
  });

  it("translated case", () => {
    expect(removeVertexAt(triangle, 0)).toBe(null);
  });

  it("translated case", () => {
    expect(removeVertexAt(square, -1)).toBe(null);
    expect(removeVertexAt(square, 99)).toBe(null);
  });
});

describe("moveVertexTo", () => {
  it("translated case", () => {
    const out = moveVertexTo(square, 0, [3, 4]);
    expect(out[0]).toEqual([3, 4]);
    expect(out[1]).toEqual([10, 0]);
    // input is not mutated
    expect(square[0]).toEqual([0, 0]);
  });

  it("translated case", () => {
    const out = moveVertexTo(square, 99, [3, 4]);
    expect(out).toEqual(square);
    expect(out).not.toBe(square);
  });
});
