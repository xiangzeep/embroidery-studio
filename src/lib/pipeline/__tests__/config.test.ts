import { describe, it, expect } from "vitest";
import {
  QUALITY_PRESETS,
  applyFabricDefaults,
  applyQualityPreset,
  makeDefaultConfig,
  type ConversionConfig,
} from "../config";
import { FABRIC_PROFILES } from "../fabric";

describe("makeDefaultConfig", () => {
  it("translated case", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.fabric).toBe("denim");
    expect(cfg.stitchDensity).toBe(FABRIC_PROFILES.denim.defaultDensityMm);
    expect(cfg.stitchDensity).toBeCloseTo(0.4);
    expect(cfg.overrides).toEqual({});
  });

  it("translated case", () => {
    const cfg = makeDefaultConfig("terry");
    expect(cfg.fabric).toBe("terry");
    expect(cfg.stitchDensity).toBeCloseTo(0.42);
  });

  it("translated case", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.format).toBe("dst");
    expect(cfg.digitizingMode).toBe("line-art");
    expect(cfg.widthMm).toBe(100);
    expect(cfg.colorCount).toBe(6);
    expect(cfg.satinMaxWidthMm).toBe(5);
    expect(cfg.smoothing).toBe(2);
    expect(cfg.boundaryDilatePx).toBe(1);
    expect(cfg.minRegionAreaPx).toBe(12);
    expect(cfg.removeWhiteBackground).toBe(true);
    expect(cfg.fillAngleDeg).toBe(45);
    expect(cfg.fillAngleByColor).toEqual({});
    expect(cfg.fillStrategy).toBe("shape-long-axis");
  });
});

describe("applyFabricDefaults", () => {
  it("translated case", () => {
    const prev = makeDefaultConfig("denim");
    expect(prev.stitchDensity).toBeCloseTo(0.4);

    const next = applyFabricDefaults(prev, "terry");
    expect(next.fabric).toBe("terry");
    expect(next.stitchDensity).toBeCloseTo(0.42);
    expect(next.overrides).toEqual({});
  });

  it("translated case", () => {
    const prev = {
      ...makeDefaultConfig("denim"),
      widthMm: 200,
      colorCount: 8,
      fillAngleDeg: 30,
    };
    const next = applyFabricDefaults(prev, "knit-heavy");
    expect(next.widthMm).toBe(200);
    expect(next.colorCount).toBe(8);
    expect(next.fillAngleDeg).toBe(30);
  });

  it("translated case", () => {
    const prev = makeDefaultConfig("twill");
    const next = applyFabricDefaults(prev, "twill");
    expect(next).toEqual(prev);
  });

  it("translated case", () => {
    const prev = makeDefaultConfig("twill");
    expect(applyFabricDefaults(prev, "twill")).toBe(prev);
  });

  it("translated case", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.55,
      overrides: { stitchDensity: true },
    };
    expect(applyFabricDefaults(prev, "denim")).toBe(prev);
  });
});

describe("applyFabricDefaults — override 保持", () => {
  it("translated case", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.55,
      overrides: { stitchDensity: true },
    };

    const next = applyFabricDefaults(prev, "terry");
    expect(next.fabric).toBe("terry");
    expect(next.stitchDensity).toBeCloseTo(0.55);
    expect(next.overrides.stitchDensity).toBe(true);
  });

  it("translated case", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.4,
      overrides: {},
    };
    const next = applyFabricDefaults(prev, "terry");
    expect(next.stitchDensity).toBeCloseTo(0.42);
  });
});

describe("translated case", () => {
  it("translated case", () => {
    let cfg = makeDefaultConfig("denim");
    expect(cfg.stitchDensity).toBeCloseTo(0.4);

    cfg = {
      ...cfg,
      stitchDensity: 0.5,
      overrides: { ...cfg.overrides, stitchDensity: true },
    };

    cfg = applyFabricDefaults(cfg, "fleece");

    expect(cfg.fabric).toBe("fleece");
    expect(cfg.stitchDensity).toBeCloseTo(0.5);
  });

  it("translated case", () => {
    let cfg = makeDefaultConfig("denim");
    cfg = applyFabricDefaults(cfg, "terry");
    expect(cfg.stitchDensity).toBeCloseTo(0.42);
    cfg = applyFabricDefaults(cfg, "leather");
    expect(cfg.stitchDensity).toBeCloseTo(0.5);
  });
});

describe("ConversionConfig disable flags", () => {
  it("translated case", () => {
    const c = makeDefaultConfig("denim");
    expect(c.disableUnderlay).toBe(false);
    expect(c.disableCompensation).toBe(false);
  });

  it("translated case", () => {
    const cfg: ReturnType<typeof makeDefaultConfig> = {
      ...makeDefaultConfig("denim"),
      disableUnderlay: true,
      disableCompensation: true,
    };
    const next = applyFabricDefaults(cfg, "terry");
    expect(next.disableUnderlay).toBe(true);
    expect(next.disableCompensation).toBe(true);
  });
});

describe("quality presets", () => {
  it("uses balanced quality by default", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.qualityPreset).toBe("balanced");
  });

  it("maps each quality preset to deterministic processing limits", () => {
    expect(QUALITY_PRESETS.fast.maxDimension).toBe(256);
    expect(QUALITY_PRESETS.balanced.maxDimension).toBe(384);
    expect(QUALITY_PRESETS.high.maxDimension).toBe(640);
    expect(QUALITY_PRESETS.detail.maxDimension).toBe(768);
  });

  it("applies preset defaults and clamps colors that exceed the preset limit", () => {
    const cfg: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      colorCount: 12,
      smoothing: 4,
    };

    const next = applyQualityPreset(cfg, "fast");

    expect(next.qualityPreset).toBe("fast");
    expect(next.colorCount).toBe(6);
    expect(next.smoothing).toBe(1);
  });
});

describe("fill quality defaults", () => {
  it("defaults to automatic long-axis fill direction", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.fillStrategy).toBe("shape-long-axis");
  });
});
