import { describe, expect, it } from "vitest";
import { medialAxisRun } from "../run";
import type { Shape } from "../types";

describe("medialAxisRun", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [[0, 0], [0.4, 0], [0.4, 10], [0, 10]],
      holes: [],
    };
    const pts = medialAxisRun(shape, 0.5);
    expect(pts.length).toBeGreaterThan(5);
    // English note.
    for (const [x] of pts) {
      expect(Math.abs(x - 0.2)).toBeLessThan(0.15);
    }
    // English note.
    const ys = pts.map(([, y]) => y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(0.5);
    expect(ys[ys.length - 1]).toBeGreaterThan(9.5);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]],
      holes: [],
    };
    const pts = medialAxisRun(shape, 0.5);
    expect(pts).toEqual([]);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [[0, 0], [0.4, 0], [0.4, 10], [0, 10]],
      holes: [],
    };
    expect(medialAxisRun(shape, 0)).toEqual([]);
    expect(medialAxisRun(shape, -1)).toEqual([]);
  });

  it("translated case", () => {
    const outer: [number, number][] = [[0, 0], [0.4, 0], [0.4, 10], [0, 10]];
    const shape: Shape = { outer, holes: [] };
    const before = JSON.stringify(outer);
    medialAxisRun(shape, 0.5);
    expect(JSON.stringify(outer)).toBe(before);
  });

  it("falls back to a rail midline for jagged thin leaf strokes", () => {
    const shape: Shape = {
      outer: [
        [0, 0.08104374944288806],
        [0.75, -0.17897871760980902],
        [1.5, 0.33037315188781435],
        [2.25, 0.29198387453752983],
        [3, 0.4218243930479915],
        [3.75, 0.21342704623956332],
        [4.5, 0.51383574125453],
        [5.25, 0.5454626246512988],
        [6, 0.19792239729576216],
        [6.75, 0.5513926795633066],
        [7.5, 0.316707570947218],
        [8.25, 0.2512450808982192],
        [9, -0.10765907640133654],
        [9.75, 0.12124791550606896],
        [10.5, 0.17542590301941113],
        [11.25, -0.06407281690059302],
        [12, 0.4527024552635629],
        [12.75, 0.3925330820204314],
        [13.5, 0.46650824033549254],
        [14.25, 0.17559370093416343],
        [15, 0.383971546058307],
        [15.75, 0.3353741064601625],
        [16.5, -0.06189236860493219],
        [17.25, 0.2823087368076842],
        [18, 0.07643892021458404],
        [18, -0.23290883290441536],
        [17.25, -0.16841352875241306],
        [16.5, -0.152270340127316],
        [15.75, -0.3373522172171032],
        [15, -0.04249765791948007],
        [14.25, -0.2904843490188822],
        [13.5, -0.40188799261986785],
        [12.75, -0.36697240912965745],
        [12, -0.20082718381768488],
        [11.25, -0.10421288159079169],
        [10.5, -0.23895919209351524],
        [9.75, 0.07157583244614839],
        [9, -0.19491268695869854],
        [8.25, -0.3536501133894826],
        [7.5, -0.38544100175521556],
        [6.75, -0.2931259472649951],
        [6, -0.2641202044088927],
        [5.25, -0.4476532768969486],
        [4.5, -0.156971775463227],
        [3.75, -0.40817078860094186],
        [3, -0.5150607789208086],
        [2.25, -0.4620799640773791],
        [1.5, -0.2603303784363593],
        [0.75, -0.10907601150473711],
        [0, -0.1714593957002804],
      ],
      holes: [],
    };

    const pts = medialAxisRun(shape, 0.8);

    expect(pts.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x))).toBeGreaterThan(15);
    const avgAbsY = pts.reduce((sum, [, y]) => sum + Math.abs(y), 0) / pts.length;
    expect(avgAbsY).toBeLessThan(0.25);
  });

  it("routes branched thin strokes through both side arms and the stem", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [6, 0],
        [6, 1],
        [3.5, 1],
        [3.5, 6],
        [2.5, 6],
        [2.5, 1],
        [0, 1],
      ],
      holes: [],
    };

    const pts = medialAxisRun(shape, 0.5);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);

    expect(Math.min(...xs)).toBeLessThan(0.8);
    expect(Math.max(...xs)).toBeGreaterThan(5.2);
    expect(Math.max(...ys)).toBeGreaterThan(5.2);
  });

  it("extracts a centered run path for narrow loop bands with a hole", () => {
    const shape: Shape = {
      outer: [[0, 0], [10, 0], [10, 6], [0, 6]],
      holes: [[[2, 2], [8, 2], [8, 4], [2, 4]]],
    };

    const pts = medialAxisRun(shape, 0.6);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);

    expect(pts.length).toBeGreaterThanOrEqual(12);
    expect(Math.min(...xs)).toBeGreaterThan(0.4);
    expect(Math.max(...xs)).toBeLessThan(9.6);
    expect(Math.min(...ys)).toBeGreaterThan(0.4);
    expect(Math.max(...ys)).toBeLessThan(5.6);
  });

  it("keeps both the loop and the handle in a keyhole-like thin stroke", () => {
    const shape: Shape = {
      outer: [[3, 0], [7, 0], [7, 4], [10, 4], [10, 10], [0, 10], [0, 4], [3, 4]],
      holes: [[[4, 5], [6, 5], [6, 8], [4, 8]]],
    };

    const pts = medialAxisRun(shape, 0.6);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);

    expect(pts.length).toBeGreaterThanOrEqual(14);
    expect(Math.min(...xs)).toBeLessThan(2.6);
    expect(Math.max(...xs)).toBeGreaterThan(7.4);
    expect(Math.min(...ys)).toBeLessThan(0.8);
    expect(Math.max(...ys)).toBeGreaterThan(8.4);
  });

  it("does not emit run paths at skeleton-pixel density for curved loop bands", () => {
    const shape: Shape = {
      outer: [
        [0, 5], [2, 1], [8, 0], [12, 4], [11, 8], [7, 11], [2, 10],
      ],
      holes: [[
        [2, 5], [3.2, 3.1], [7.2, 2.5], [8.7, 4.2], [8.1, 6.2], [6.1, 7.5], [3.3, 7.1],
      ]],
    };

    const pts = medialAxisRun(shape, 2.0);
    expect(pts.length).toBeGreaterThanOrEqual(5);

    let minStep = Infinity;
    let maxStep = 0;
    for (let i = 1; i < pts.length; i++) {
      const step = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      minStep = Math.min(minStep, step);
      maxStep = Math.max(maxStep, step);
    }

    expect(minStep).toBeGreaterThan(0.7);
    expect(maxStep).toBeLessThan(3.2);
  });
});
