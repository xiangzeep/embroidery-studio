import { describe, expect, it } from "vitest";
import {
  brickSplit,
  extractRails,
  renderSatin2Rail,
  type SatinRails,
} from "../satin";
import type { Shape } from "../types";

describe("extractRails — straight satin", () => {
  it("アスペクト比 8 の長矩形で 2 本の平行 rail を返す", () => {
    const shape: Shape = {
      outer: [[0, 0], [80, 0], [80, 10], [0, 10]],
      holes: [],
    };
    const rails = extractRails(shape);
    expect(rails.left.length).toBeGreaterThanOrEqual(2);
    expect(rails.right.length).toBeGreaterThanOrEqual(2);
    expect(rails.left[0][0]).toBeCloseTo(0, 4);
    expect(rails.right[0][0]).toBeCloseTo(0, 4);
    expect(rails.left.at(-1)![0]).toBeCloseTo(80, 4);
    expect(rails.right.at(-1)![0]).toBeCloseTo(80, 4);
    const leftY = rails.left[Math.floor(rails.left.length / 2)][1];
    const rightY = rails.right[Math.floor(rails.right.length / 2)][1];
    expect(Math.abs(leftY - rightY)).toBeCloseTo(10, 4);
  });
});

describe("extractRails — C-shaped satin", () => {
  it("C 字 satin で内側 rail と外側 rail に分かれる", () => {
    const cx = 40, cy = 40, rOuter = 40, rInner = 30;
    const outerArc: [number, number][] = [];
    const innerArc: [number, number][] = [];
    const N = 36;
    const tStart = (-150 * Math.PI) / 180;
    const tEnd = (150 * Math.PI) / 180;
    for (let i = 0; i <= N; i++) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      outerArc.push([cx + rOuter * Math.cos(t), cy + rOuter * Math.sin(t)]);
    }
    for (let i = N; i >= 0; i--) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      innerArc.push([cx + rInner * Math.cos(t), cy + rInner * Math.sin(t)]);
    }
    const shape: Shape = { outer: [...outerArc, ...innerArc], holes: [] };
    const rails = extractRails(shape);

    const leftMid = rails.left[Math.floor(rails.left.length / 2)];
    const rightMid = rails.right[Math.floor(rails.right.length / 2)];
    const distLeft = Math.hypot(leftMid[0] - cx, leftMid[1] - cy);
    const distRight = Math.hypot(rightMid[0] - cx, rightMid[1] - cy);
    const radii = [distLeft, distRight].sort((a, b) => a - b);
    expect(radii[0]).toBeGreaterThan(28);
    expect(radii[0]).toBeLessThan(32);
    expect(radii[1]).toBeGreaterThan(38);
    expect(radii[1]).toBeLessThan(42);
  });
});

describe("renderSatin2Rail — zigzag output", () => {
  it("直線 satin で出力が left↔right を交互する", () => {
    const shape: Shape = {
      outer: [[0, 0], [40, 0], [40, 5], [0, 5]],
      holes: [],
    };
    const rails = extractRails(shape);
    const stitches = renderSatin2Rail(rails, 1.0, 7.0);
    // 中点曲線 ≒ 40mm / density 1 → N ≒ 40, 出力点 ≒ 82 (各 i で 2 点 push)
    expect(stitches.length).toBeGreaterThanOrEqual(40);
    // y 座標は 0 と 5 の 2 種類
    const ySet = new Set(stitches.map((p) => Math.round(p[1])));
    expect(ySet.has(0)).toBe(true);
    expect(ySet.has(5)).toBe(true);
    expect(ySet.size).toBe(2);
  });
});

describe("renderSatin2Rail — midline pitch", () => {
  it("中点曲線上の隣接 stitch ピッチが densityMm の ±5% (直線)", () => {
    const shape: Shape = {
      outer: [[0, 0], [60, 0], [60, 6], [0, 6]],
      holes: [],
    };
    const rails = extractRails(shape);
    const density = 1.5;
    const stitches = renderSatin2Rail(rails, density, 7.0);
    const midPoints: [number, number][] = [];
    for (let i = 0; i < stitches.length - 1; i += 2) {
      const a = stitches[i];
      const b = stitches[i + 1];
      midPoints.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    const pitches: number[] = [];
    for (let i = 1; i < midPoints.length; i++) {
      const dx = midPoints[i][0] - midPoints[i - 1][0];
      const dy = midPoints[i][1] - midPoints[i - 1][1];
      pitches.push(Math.hypot(dx, dy));
    }
    const avg = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    expect(avg).toBeGreaterThan(density * 0.95);
    expect(avg).toBeLessThan(density * 1.05);
  });

  it("C 字 satin でも中点曲線ピッチが densityMm の ±10%", () => {
    const cx = 30, cy = 30, rOuter = 30, rInner = 22;
    const outerArc: [number, number][] = [];
    const innerArc: [number, number][] = [];
    const N = 48;
    const tStart = (-120 * Math.PI) / 180;
    const tEnd = (120 * Math.PI) / 180;
    for (let i = 0; i <= N; i++) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      outerArc.push([cx + rOuter * Math.cos(t), cy + rOuter * Math.sin(t)]);
    }
    for (let i = N; i >= 0; i--) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      innerArc.push([cx + rInner * Math.cos(t), cy + rInner * Math.sin(t)]);
    }
    const shape: Shape = { outer: [...outerArc, ...innerArc], holes: [] };
    const rails = extractRails(shape);
    const density = 1.2;
    const stitches = renderSatin2Rail(rails, density, 7.0);

    const midPoints: [number, number][] = [];
    for (let i = 0; i < stitches.length - 1; i += 2) {
      const a = stitches[i];
      const b = stitches[i + 1];
      midPoints.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    const pitches: number[] = [];
    for (let i = 1; i < midPoints.length; i++) {
      const dx = midPoints[i][0] - midPoints[i - 1][0];
      const dy = midPoints[i][1] - midPoints[i - 1][1];
      pitches.push(Math.hypot(dx, dy));
    }
    const avg = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    expect(avg).toBeGreaterThan(density * 0.9);
    expect(avg).toBeLessThan(density * 1.1);
  });
});

describe("satin — purity & structure", () => {
  it("extractRails は同一 shape に対して同一結果を返す (純関数)", () => {
    const shape: Shape = {
      outer: [[0, 0], [50, 0], [50, 8], [0, 8]],
      holes: [],
    };
    const r1 = extractRails(shape);
    const r2 = extractRails(shape);
    expect(r1.left).toEqual(r2.left);
    expect(r1.right).toEqual(r2.right);
  });

  it("extractRails は入力 shape.outer を変更しない", () => {
    const outer: [number, number][] = [[0, 0], [50, 0], [50, 8], [0, 8]];
    const shape: Shape = { outer, holes: [] };
    const before = JSON.stringify(outer);
    extractRails(shape);
    expect(JSON.stringify(outer)).toBe(before);
  });

  it("renderSatin2Rail は入力 rails を変更しない", () => {
    const rails: SatinRails = {
      left: [[0, 0], [10, 0], [20, 0]],
      right: [[0, 5], [10, 5], [20, 5]],
    };
    const beforeL = JSON.stringify(rails.left);
    const beforeR = JSON.stringify(rails.right);
    renderSatin2Rail(rails, 1, 7);
    expect(JSON.stringify(rails.left)).toBe(beforeL);
    expect(JSON.stringify(rails.right)).toBe(beforeR);
  });

  it("退化 shape (3 点以下) で extractRails が破綻せず配列 rail を返す", () => {
    const shape: Shape = {
      outer: [[0, 0], [1, 0], [0.5, 0.5]],
      holes: [],
    };
    const rails = extractRails(shape);
    expect(Array.isArray(rails.left)).toBe(true);
    expect(Array.isArray(rails.right)).toBe(true);
  });
});

describe("brickSplit", () => {
  it("距離が maxStitchMm 以下のとき分割せず [left, right] を返す", () => {
    const result = brickSplit([0, 0], [5, 0], 7, 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0, 0]);
    expect(result[1]).toEqual([5, 0]);
  });

  it("距離が maxStitchMm ちょうどでも分割しない", () => {
    const result = brickSplit([0, 0], [7, 0], 7, 0);
    expect(result).toHaveLength(2);
  });

  it("行 0 (phase=0) で 8mm を maxStitchMm=3 に分割: segs+2=5 点 / 中間 t=0,1/3,2/3", () => {
    const result = brickSplit([0, 0], [8, 0], 3, 0);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([8, 0]);
    // i=1 → t=0 → (0,0)、i=2 → t=1/3 → (8/3,0)、i=3 → t=2/3 → (16/3,0)
    expect(result[1][0]).toBeCloseTo(0, 5);
    expect(result[2][0]).toBeCloseTo(8 / 3, 5);
    expect(result[3][0]).toBeCloseTo(16 / 3, 5);
  });

  it("行 0/1/2 で 1/3 位相シフト: 最初の中間点 x が 0, 1, 2 にずれる (9mm/maxStitch 3)", () => {
    const r0 = brickSplit([0, 0], [9, 0], 3, 0);
    const r1 = brickSplit([0, 0], [9, 0], 3, 1);
    const r2 = brickSplit([0, 0], [9, 0], 3, 2);
    expect(r0).toHaveLength(5);
    expect(r1).toHaveLength(5);
    expect(r2).toHaveLength(5);
    // i=1 (最初の中間点)
    expect(r0[1][0]).toBeCloseTo(0, 5); // phase 0 → t=0
    expect(r1[1][0]).toBeCloseTo(1, 5); // phase 1/3 → t=1/9 → 1
    expect(r2[1][0]).toBeCloseTo(2, 5); // phase 2/3 → t=2/9 → 2
  });

  it("行 3 は行 0 と同位相 (周期 3)", () => {
    const r0 = brickSplit([0, 0], [9, 0], 3, 0);
    const r3 = brickSplit([0, 0], [9, 0], 3, 3);
    for (let i = 0; i < r0.length; i++) {
      expect(r3[i][0]).toBeCloseTo(r0[i][0], 5);
      expect(r3[i][1]).toBeCloseTo(r0[i][1], 5);
    }
  });

  it("斜め stitch でも y 成分が正しく補間される (6,8 / maxStitch 4 / 行 0)", () => {
    const result = brickSplit([0, 0], [6, 8], 4, 0);
    // dist=10, segs=3
    expect(result).toHaveLength(5);
    expect(result[result.length - 1][0]).toBeCloseTo(6, 5);
    expect(result[result.length - 1][1]).toBeCloseTo(8, 5);
    // i=3, t=2/3 → (4, 16/3)
    expect(result[3][0]).toBeCloseTo(4, 5);
    expect(result[3][1]).toBeCloseTo(16 / 3, 5);
  });
});
