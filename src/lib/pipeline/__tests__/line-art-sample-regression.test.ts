import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  resolveBuildMinRegionAreaPx,
  resolvePreprocessMaxDimension,
  resolveVectorizeTurdsize,
} from "../compose";
import { makeDefaultConfig } from "../config";
import { quantizeLineArt } from "../line-art-quantize";

class TestImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = TestImageData as unknown as typeof ImageData;
}

describe("line-art c_00012 regression", () => {
  async function loadQuantizedSample() {
    const config = makeDefaultConfig("denim");
    const maxDimension = resolvePreprocessMaxDimension("line-art", config.qualityPreset);
    const sourcePath = path.join(process.cwd(), "public/phase3-samples/c_00012.png");
    const source = sharp(await readFile(sourcePath));
    const metadata = await source.metadata();
    const sourceWidth = metadata.width ?? maxDimension;
    const sourceHeight = metadata.height ?? maxDimension;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const { data } = await source
      .resize(width, height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
    const opaqueMask = new Uint8Array(width * height);
    for (let i = 0; i < opaqueMask.length; i++) {
      opaqueMask[i] = imageData.data[i * 4 + 3] >= 128 ? 1 : 0;
    }

    const quantized = quantizeLineArt({
      imageData,
      opaqueMask,
      colorCount: config.colorCount,
      removeWhiteBackground: config.removeWhiteBackground,
    });
    return { config, maxDimension, width, height, imageData, quantized };
  }

  it("keeps pale blue strokes while discarding near-white background noise", async () => {
    const { config, maxDimension, width, imageData, quantized } = await loadQuantizedSample();
    let foreground = 0;
    let paleBlueForeground = 0;
    let neutralNearWhiteForeground = 0;
    for (let i = 0; i < quantized.labels.length; i++) {
      if (quantized.labels[i] === 255) continue;
      foreground++;
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (r >= 238 && g >= 238 && b >= 238 && b - r >= 6) paleBlueForeground++;
      if (r >= 238 && g >= 238 && b >= 238 && max - min <= 4) neutralNearWhiteForeground++;
    }

    expect(maxDimension).toBe(256);
    expect(width).toBe(256);
    expect(resolveVectorizeTurdsize("line-art")).toBe(1);
    expect(resolveBuildMinRegionAreaPx("line-art", config.minRegionAreaPx)).toBe(1);
    expect(foreground).toBeGreaterThan(10_000);
    expect(foreground).toBeLessThan(25_000);
    expect(paleBlueForeground).toBeGreaterThan(750);
    expect(neutralNearWhiteForeground).toBe(0);
  });
});
