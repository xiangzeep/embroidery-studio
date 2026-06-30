import { describe, expect, it } from "vitest";
import { resolveLayerStitchPolicy } from "../layer-stitch-policy";

describe("layer stitch policy", () => {
  it("keeps support stitches for base fills", () => {
    const policy = resolveLayerStitchPolicy({
      layer: "base-fill",
      objectKind: "fill",
      defaultUnderlay: { kind: "fill", angleDeg: 90, spacingMm: 2 },
    });

    expect(policy.renderable).toBe(true);
    expect(policy.underlay).toEqual({ kind: "fill", angleDeg: 90, spacingMm: 2 });
    expect(policy.lockstitch).toBe(true);
  });

  it("suppresses helper stitches on outline, detail, and highlight layers", () => {
    const layers = ["outline", "detail", "highlight"] as const;

    for (const layer of layers) {
      const policy = resolveLayerStitchPolicy({
        layer,
        objectKind: layer === "outline" ? "satin" : "fill",
        defaultUnderlay: { kind: "fill", angleDeg: 90, spacingMm: 2 },
      });

      expect(policy.renderable).toBe(true);
      expect(policy.underlay).toEqual({ kind: "none" });
      expect(policy.lockstitch).toBe(false);
    }
  });

  it("marks background and noise as non-renderable", () => {
    expect(resolveLayerStitchPolicy({
      layer: "background",
      objectKind: "fill",
      defaultUnderlay: { kind: "fill", angleDeg: 90, spacingMm: 2 },
    }).renderable).toBe(false);
    expect(resolveLayerStitchPolicy({
      layer: "noise",
      objectKind: "run",
      defaultUnderlay: { kind: "center-run", stitchLenMm: 1 },
    }).renderable).toBe(false);
  });
});
