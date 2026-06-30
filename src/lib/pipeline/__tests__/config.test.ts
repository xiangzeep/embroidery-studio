import { describe, it, expect } from "vitest";
import {
  applyFabricDefaults,
  makeDefaultConfig,
  type ConversionConfig,
} from "../config";
import { FABRIC_PROFILES } from "../fabric";

describe("makeDefaultConfig", () => {
  it("denim を渡すと fabric='denim' で stitchDensity=0.4 になる", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.fabric).toBe("denim");
    expect(cfg.stitchDensity).toBe(FABRIC_PROFILES.denim.defaultDensityMm);
    expect(cfg.stitchDensity).toBeCloseTo(0.4);
    expect(cfg.overrides).toEqual({});
  });

  it("terry を渡すと stitchDensity=0.42 になる", () => {
    const cfg = makeDefaultConfig("terry");
    expect(cfg.fabric).toBe("terry");
    expect(cfg.stitchDensity).toBeCloseTo(0.42);
  });

  it("既存フィールド (widthMm, colorCount, format 等) は従来のデフォルトを保つ", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.format).toBe("dst");
    expect(cfg.widthMm).toBe(100);
    expect(cfg.colorCount).toBe(6);
    expect(cfg.satinMaxWidthMm).toBe(5);
    expect(cfg.smoothing).toBe(2);
    expect(cfg.boundaryDilatePx).toBe(1);
    expect(cfg.fillAngleDeg).toBe(45);
    expect(cfg.fillAngleByColor).toEqual({});
    expect(cfg.fillStrategy).toBe("global-angle");
  });
});

describe("applyFabricDefaults", () => {
  it("未 override の状態で denim → terry に切り替えると stitchDensity が 0.42 に追従する", () => {
    const prev = makeDefaultConfig("denim");
    expect(prev.stitchDensity).toBeCloseTo(0.4);

    const next = applyFabricDefaults(prev, "terry");
    expect(next.fabric).toBe("terry");
    expect(next.stitchDensity).toBeCloseTo(0.42);
    expect(next.overrides).toEqual({});
  });

  it("fabric 以外のフィールドはそのまま維持される", () => {
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

  it("同じ fabric を再指定しても idempotent (副作用なし)", () => {
    const prev = makeDefaultConfig("twill");
    const next = applyFabricDefaults(prev, "twill");
    expect(next).toEqual(prev);
  });

  it("同じ fabric を再指定したときは参照同一を返す (React 再レンダー抑制)", () => {
    const prev = makeDefaultConfig("twill");
    expect(applyFabricDefaults(prev, "twill")).toBe(prev);
  });

  it("override 済み stitchDensity を持つ同 fabric 再指定でも参照同一", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.55,
      overrides: { stitchDensity: true },
    };
    expect(applyFabricDefaults(prev, "denim")).toBe(prev);
  });
});

describe("applyFabricDefaults — override 保持", () => {
  it("overrides.stitchDensity=true が立っていれば fabric 切替で stitchDensity が消えない", () => {
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

  it("override が空 ({}) なら fabric 切替で stitchDensity が追従する (Cycle 2 と整合)", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.4,
      overrides: {},
    };
    const next = applyFabricDefaults(prev, "terry");
    expect(next.stitchDensity).toBeCloseTo(0.42);
  });
});

describe("UI 統合シナリオ (純関数で再現)", () => {
  it("シナリオ: denim 起動 → stitchDensity スライダで 0.5 に → fleece に切替 → stitchDensity=0.5 のまま", () => {
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

  it("シナリオ: denim → terry → leather と切替し、いずれも未 override なら defaultDensityMm に追従", () => {
    let cfg = makeDefaultConfig("denim");
    cfg = applyFabricDefaults(cfg, "terry");
    expect(cfg.stitchDensity).toBeCloseTo(0.42);
    cfg = applyFabricDefaults(cfg, "leather");
    expect(cfg.stitchDensity).toBeCloseTo(0.5);
  });
});

describe("ConversionConfig Phase 2 disable flags", () => {
  it("makeDefaultConfig は disableUnderlay=false / disableCompensation=false を返す", () => {
    const c = makeDefaultConfig("denim");
    expect(c.disableUnderlay).toBe(false);
    expect(c.disableCompensation).toBe(false);
  });

  it("applyFabricDefaults は disable フラグを保持する", () => {
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
