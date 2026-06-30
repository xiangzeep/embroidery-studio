import { describe, expect, it } from "vitest";
import { applyStrokeOverrideChange } from "../object-inspector-bindings";
import type { EmbroideryObject } from "@/lib/pipeline/types";
import type { ConversionConfig } from "@/lib/pipeline/config";

function makeConfig(
  overrides: Partial<ConversionConfig> = {},
): ConversionConfig {
  return {
    format: "dst",
    digitizingMode: "line-art",
    outlineFontStrategy: "prefer-run",
    fabric: "denim",
    qualityPreset: "balanced",
    widthMm: 100,
    colorCount: 6,
    stitchDensity: 0.4,
    satinMaxWidthMm: 5,
    smoothing: 2,
    boundaryDilatePx: 1,
    minRegionAreaPx: 12,
    removeWhiteBackground: true,
    fillAngleDeg: 45,
    fillAngleByColor: {},
    fillStrategy: "shape-long-axis",
    overrides: {},
    disableUnderlay: false,
    disableCompensation: false,
    ...overrides,
  };
}

function makeObject(
  overrides: Partial<EmbroideryObject> = {},
): EmbroideryObject {
  return {
    id: "obj-1",
    kind: "satin",
    baseKind: "satin",
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer: [[0, 0], [10, 0], [10, 2], [0, 2]], holes: [] },
    props: { densityMm: 0.4, maxStitchMm: 4 },
    strokeKind: "narrow-satin",
    strokeRole: "outline",
    strokeOverride: "use-global",
    order: 0,
    ...overrides,
  };
}

describe("applyStrokeOverrideChange", () => {
  it("forces run when override is force-run", () => {
    const patch = applyStrokeOverrideChange(makeObject(), "force-run", makeConfig());
    expect(patch.kind).toBe("run");
    expect(patch.strokeOverride).toBe("force-run");
  });

  it("restores the resolved global kind when override returns to use-global", () => {
    const patch = applyStrokeOverrideChange(
      makeObject({ kind: "run", strokeOverride: "force-run" }),
      "use-global",
      makeConfig({ digitizingMode: "photo-stitch", outlineFontStrategy: "auto" }),
    );
    expect(patch.kind).toBe("satin");
    expect(patch.strokeOverride).toBe("use-global");
  });
});
