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
import { buildDesignGraph } from "../design-graph";
import { TRIM_POLICY_BY_FORMAT } from "../policy";
import { vectorizeRasterLabels } from "../raster-vectorize";
import { renderDesignGraph } from "../render";
import { assertPrepipelineWithinStitchBudget } from "../stitch-budget";
import { fitPrepipelineWithinStitchBudget } from "../stitch-budget";
import { compactVectorizeRegionsForTransfer } from "../vectorize-payload";

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

    expect(maxDimension).toBe(192);
    expect(width).toBe(192);
    expect(resolveVectorizeTurdsize("line-art")).toBe(1);
    expect(resolveBuildMinRegionAreaPx("line-art", config.minRegionAreaPx)).toBe(1);
    expect(foreground).toBeGreaterThan(6_000);
    expect(foreground).toBeLessThan(14_000);
    expect(paleBlueForeground).toBeGreaterThan(450);
    expect(neutralNearWhiteForeground).toBe(0);
  });

  it("auto-fits c_00012 before graph rendering instead of failing on complexity", async () => {
    const { config, width, height, quantized } = await loadQuantizedSample();
    const rawRegions = vectorizeRasterLabels({
      labels: quantized.labels,
      width,
      height,
      palette: quantized.palette,
    });
    const regions = compactVectorizeRegionsForTransfer(rawRegions);
    const widthMm = config.widthMm;
    const heightMm = widthMm * (height / width);
    const rawPre = {
      regions,
      widthMm,
      heightMm,
      widthPx: width,
      heightPx: height,
    };
    const pre = fitPrepipelineWithinStitchBudget(rawPre, config);

    const transferredPointCount = regions.reduce((sum, region) =>
      sum + region.shapes.reduce((shapeSum, shape) =>
        shapeSum + shape.outer.length + shape.holes.reduce((holeSum, hole) => holeSum + hole.length, 0),
      0),
    0);
    const rawShapeCount = regions.reduce((sum, region) => sum + region.shapes.length, 0);
    const fittedShapeCount = pre.regions.reduce((sum, region) => sum + region.shapes.length, 0);
    const rawBounds = boundsForRegions(regions);
    const fittedBounds = boundsForRegions(pre.regions);
    expect(rawRegions.length).toBeGreaterThan(0);
    expect(regions.every((region) => region.polygons.length === 0 && region.svgPath === "")).toBe(true);
    expect(rawShapeCount).toBeGreaterThan(500);
    expect(fittedShapeCount).toBeGreaterThanOrEqual(360);
    expect(fittedShapeCount).toBeLessThanOrEqual(420);
    expect(fittedBounds.minX).toBeLessThanOrEqual(rawBounds.minX + width * 0.03);
    expect(fittedBounds.maxX).toBeGreaterThanOrEqual(rawBounds.maxX - width * 0.03);
    expect(fittedBounds.minY).toBeLessThanOrEqual(rawBounds.minY + height * 0.03);
    expect(fittedBounds.maxY).toBeGreaterThanOrEqual(rawBounds.maxY - height * 0.03);
    expect(transferredPointCount).toBeLessThan(80_000);
    expect(() => assertPrepipelineWithinStitchBudget(pre, config)).not.toThrow();

    const graph = buildDesignGraph(pre, config);
    const runNodes = graph.nodes.filter((node) => node.object.kind === "run");
    const lineNodes = graph.nodes.filter((node) =>
      node.object.kind === "run" ||
      node.object.strokeKind === "narrow-satin" ||
      node.object.strokeKind === "border-satin",
    );
    const unclassifiedFillNodes = graph.nodes.filter((node) =>
      node.object.kind === "fill" && node.object.strokeKind === "none",
    );
    expect(graph.nodes.length).toBeGreaterThanOrEqual(100);
    expect(runNodes.length).toBeGreaterThanOrEqual(65);
    expect(lineNodes.length).toBeGreaterThanOrEqual(95);
    expect(unclassifiedFillNodes.length).toBeLessThanOrEqual(5);
    const pattern = renderDesignGraph(graph, {
      widthMm,
      heightMm,
      widthPx: width,
      digitizingMode: config.digitizingMode,
      stitchDensityMm: config.stitchDensity,
      satinMaxWidthMm: config.satinMaxWidthMm,
      fillAngleDeg: config.fillAngleDeg,
      fillAngleByColorIndex: config.fillAngleByColor,
      fillStrategy: config.fillStrategy,
      fabric: graph.design.fabric,
      disableUnderlay: config.disableUnderlay,
      disableCompensation: config.disableCompensation,
      policy: TRIM_POLICY_BY_FORMAT[config.format],
    });
    expect(pattern.totalStitches).toBeGreaterThan(100);
    expect(pattern.totalStitches).toBeLessThanOrEqual(60_000);
  }, 30_000);
});

function boundsForRegions(regions: ReturnType<typeof compactVectorizeRegionsForTransfer>) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const region of regions) {
    for (const shape of region.shapes) {
      for (const [x, y] of shape.outer) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}
