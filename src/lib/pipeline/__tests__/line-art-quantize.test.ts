import { describe, expect, it } from "vitest";

if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  (globalThis as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

import { BACKGROUND_LABEL } from "../opencv-worker";
import { quantizeLineArt } from "../line-art-quantize";

describe("quantizeLineArt", () => {
  it("keeps white pixels as background and quantizes only colored line pixels", () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
        40, 130, 230, 255,
        44, 134, 232, 255,
        10, 40, 170, 255,
      ]),
      4,
      1,
    );

    const result = quantizeLineArt({
      imageData,
      colorCount: 2,
      removeWhiteBackground: true,
    });

    expect(result.labels[0]).toBe(BACKGROUND_LABEL);
    expect(result.labels[1]).not.toBe(BACKGROUND_LABEL);
    expect(result.labels[2]).not.toBe(BACKGROUND_LABEL);
    expect(result.labels[3]).not.toBe(BACKGROUND_LABEL);
    expect(result.palette.length).toBeGreaterThan(0);
    expect(result.palette.length).toBeLessThanOrEqual(2);
  });

  it("merges anti-aliased shades of the same line color into one label", () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
        38, 132, 238, 255,
        88, 166, 247, 255,
        14, 72, 202, 255,
        232, 48, 50, 255,
      ]),
      5,
      1,
    );

    const result = quantizeLineArt({
      imageData,
      colorCount: 6,
      removeWhiteBackground: true,
    });

    expect(result.palette).toHaveLength(2);
    expect(result.labels[1]).toBe(result.labels[2]);
    expect(result.labels[2]).toBe(result.labels[3]);
    expect(result.labels[4]).not.toBe(result.labels[1]);
  });

  it("keeps distant same-hue line and fill colors separate to avoid oversized masks", () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
        112, 184, 250, 255,
        0, 72, 178, 255,
      ]),
      3,
      1,
    );

    const result = quantizeLineArt({
      imageData,
      colorCount: 6,
      removeWhiteBackground: true,
    });

    expect(result.palette).toHaveLength(2);
    expect(result.labels[1]).not.toBe(result.labels[2]);
  });
});
