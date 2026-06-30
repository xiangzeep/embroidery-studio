import { describe, expect, it } from "vitest";
import { medialAxisRun } from "../run";
import type { Shape } from "../types";

describe("medialAxisRun", () => {
  it("細長矩形 (0.4x10mm) で中心線 (x≈0.2) の polyline を返す", () => {
    const shape: Shape = {
      outer: [[0, 0], [0.4, 0], [0.4, 10], [0, 10]],
      holes: [],
    };
    const pts = medialAxisRun(shape, 0.5);
    expect(pts.length).toBeGreaterThan(5);
    // 全点 x が 0.2 近傍 (rasterize の中央 ±半ピクセル)
    for (const [x] of pts) {
      expect(Math.abs(x - 0.2)).toBeLessThan(0.15);
    }
    // y 方向は 0 〜 10 で resample
    const ys = pts.map(([, y]) => y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(0.5);
    expect(ys[ys.length - 1]).toBeGreaterThan(9.5);
  });

  it("退化 shape (面積過小) で空配列を返す", () => {
    const shape: Shape = {
      outer: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]],
      holes: [],
    };
    const pts = medialAxisRun(shape, 0.5);
    expect(pts).toEqual([]);
  });

  it("stitchLenMm <= 0 で空配列", () => {
    const shape: Shape = {
      outer: [[0, 0], [0.4, 0], [0.4, 10], [0, 10]],
      holes: [],
    };
    expect(medialAxisRun(shape, 0)).toEqual([]);
    expect(medialAxisRun(shape, -1)).toEqual([]);
  });

  it("入力 shape を変更しない (純関数)", () => {
    const outer: [number, number][] = [[0, 0], [0.4, 0], [0.4, 10], [0, 10]];
    const shape: Shape = { outer, holes: [] };
    const before = JSON.stringify(outer);
    medialAxisRun(shape, 0.5);
    expect(JSON.stringify(outer)).toBe(before);
  });
});
