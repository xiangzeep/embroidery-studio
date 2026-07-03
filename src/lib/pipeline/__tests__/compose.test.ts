import { describe, it, expect } from "vitest";
import {
  convertImageToEmbroideryDirect,
  rerenderDesignAndWrite,
  resolveBuildMinRegionAreaPx,
  resolvePreprocessMaxDimension,
  resolveVectorizeTurdsize,
  resolveVectorizeDilatePx,
  runPrepipeline,
  runStitchAndWrite,
} from "../compose";
import * as pipeline from "../index";
import { FABRIC_PROFILES } from "../fabric";
import { makeDefaultConfig } from "../config";
import type { EmbroideryDesign } from "../types";

describe("compose", () => {
  it("translated case", () => {
    expect(typeof convertImageToEmbroideryDirect).toBe("function");
  });

  it("translated case", () => {
    expect(typeof runPrepipeline).toBe("function");
    expect(typeof runStitchAndWrite).toBe("function");
    expect(typeof rerenderDesignAndWrite).toBe("function");
  });

  it("translated case", () => {
    expect(pipeline.convertImageToEmbroideryDirect).toBe(
      convertImageToEmbroideryDirect,
    );
    expect(pipeline.runPrepipeline).toBe(runPrepipeline);
    expect(pipeline.runStitchAndWrite).toBe(runStitchAndWrite);
    expect(pipeline.rerenderDesignAndWrite).toBe(rerenderDesignAndWrite);
  });

  it("disables mask dilation for line-art prepipeline to avoid joining nearby thin strokes", () => {
    expect(resolveVectorizeDilatePx("line-art", 2)).toBe(0);
    expect(resolveVectorizeDilatePx("photo-stitch", 2)).toBe(2);
  });

  it("keeps enough line-art preprocessing resolution for thin stroke fidelity", () => {
    expect(resolvePreprocessMaxDimension("line-art", "fast")).toBe(256);
    expect(resolvePreprocessMaxDimension("line-art", "balanced")).toBe(256);
    expect(resolvePreprocessMaxDimension("line-art", "high")).toBe(384);
    expect(resolvePreprocessMaxDimension("line-art", "detail")).toBe(512);
    expect(resolvePreprocessMaxDimension("photo-stitch", "balanced")).toBe(384);
  });

  it("uses fine-grained line-art filters so small run-stitch details survive", () => {
    expect(resolveVectorizeTurdsize("line-art")).toBe(1);
    expect(resolveVectorizeTurdsize("photo-stitch")).toBe(8);
    expect(resolveBuildMinRegionAreaPx("line-art", 12)).toBe(1);
    expect(resolveBuildMinRegionAreaPx("photo-stitch", 12)).toBe(12);
  });

  it("rerenders from edited design instead of rebuilding from source regions", async () => {
    const design: EmbroideryDesign = {
      widthMm: 20,
      heightMm: 10,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        {
          id: "run-1",
          kind: "run",
          baseKind: "run",
          colorIndex: 0,
          rgb: [0, 0, 0],
          shape: { outer: [[0, 0], [20, 0], [20, 1], [0, 1]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 4 },
          strokeKind: "thin-run",
          strokeRole: "outline",
          strokeOverride: "use-global",
          order: 0,
        },
      ],
    };

    const result = await rerenderDesignAndWrite(
      design,
      {
        regions: [],
        widthMm: 20,
        heightMm: 10,
        widthPx: 200,
        heightPx: 100,
      },
      makeDefaultConfig("denim"),
    );

    expect(result.design.objects[0].id).toBe("run-1");
    expect(result.pattern.widthMm).toBe(20);
    expect(result.pattern.heightMm).toBe(10);
    expect(result.pattern.totalStitches).toBeGreaterThan(0);
    expect(result.stats.stitchCount).toBeGreaterThan(0);
  });
});
