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
    expect(result.palette).toHaveLength(2);
  });
});
