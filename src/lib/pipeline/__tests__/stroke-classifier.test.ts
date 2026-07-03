import { describe, expect, it } from "vitest";
import { classifyStrokeKind, classifyStrokeRole } from "../stroke-classifier";
import type { StrokeMetrics } from "../types";

function makeMetrics(overrides: Partial<StrokeMetrics> = {}): StrokeMetrics {
  return {
    areaMm2: 8,
    perimeterMm: 42,
    bboxWidthMm: 18,
    bboxHeightMm: 1.2,
    estimatedWidthMm: 1.2,
    estimatedLengthMm: 24,
    slenderness: 12,
    compactness: 0.2,
    holeCount: 0,
    isStrokeLike: true,
    ...overrides,
  };
}

describe("classifyStrokeRole", () => {
  it("classifies line-art medium contour strokes as outline role", () => {
    const metrics = makeMetrics();
    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");
    expect(role).toBe("outline");
  });

  it("keeps medium-width line-art contour strokes on a run-oriented stroke kind", () => {
    const metrics = makeMetrics({
      areaMm2: 22,
      perimeterMm: 48,
      bboxWidthMm: 18,
      bboxHeightMm: 2.3,
      estimatedWidthMm: 2.05,
      estimatedLengthMm: 18,
      slenderness: 7.8,
      compactness: 0.22,
    });

    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");

    expect(strokeKind).toBe("bean-run");
    expect(role).toBe("outline");
  });

  it("classifies photo decorative bands as decorative-band role", () => {
    const metrics = makeMetrics({
      estimatedWidthMm: 2.2,
      estimatedLengthMm: 26,
      slenderness: 10,
      bboxHeightMm: 2.2,
    });
    const strokeKind = classifyStrokeKind(metrics, "photo-stitch");
    const role = classifyStrokeRole(metrics, strokeKind, "photo-stitch");
    expect(role).toBe("decorative-band");
  });

  it("prefers run-oriented classification over perimeter-width satin for narrow line-art loops", () => {
    const metrics = makeMetrics({
      areaMm2: 14,
      perimeterMm: 38,
      bboxWidthMm: 10,
      bboxHeightMm: 8,
      estimatedWidthMm: 2.1,
      estimatedLengthMm: 12,
      slenderness: 4.5,
      compactness: 0.28,
      widthMinMm: 1.0,
      widthAvgMm: 1.2,
      widthMaxMm: 1.35,
      loopCount: 1,
      hasStableSkeleton: true,
    });

    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");

    expect(["thin-run", "bean-run"]).toContain(strokeKind);
    expect(role).toBe("outline");
  });

  it("keeps stable closed line-art loops up to 3mm on bean run instead of satin", () => {
    const metrics = makeMetrics({
      areaMm2: 28,
      perimeterMm: 56,
      bboxWidthMm: 13,
      bboxHeightMm: 10,
      estimatedWidthMm: 2.8,
      estimatedLengthMm: 16,
      slenderness: 3.8,
      compactness: 0.24,
      holeCount: 1,
      widthMinMm: 2.4,
      widthAvgMm: 2.9,
      widthMaxMm: 3.3,
      loopCount: 1,
      hasStableSkeleton: true,
      isStrokeLike: true,
    });

    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");

    expect(strokeKind).toBe("bean-run");
    expect(role).toBe("outline");
  });

  it("keeps flared stable line-art loops on bean run when the average width is narrow", () => {
    const metrics = makeMetrics({
      areaMm2: 22,
      perimeterMm: 48,
      bboxWidthMm: 11,
      bboxHeightMm: 9,
      estimatedWidthMm: 2.1,
      estimatedLengthMm: 14,
      slenderness: 3.2,
      compactness: 0.23,
      holeCount: 1,
      widthMinMm: 1.2,
      widthAvgMm: 2.1,
      widthMaxMm: 3.1,
      loopCount: 1,
      hasStableSkeleton: true,
      isStrokeLike: true,
    });

    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");

    expect(strokeKind).toBe("bean-run");
    expect(role).toBe("outline");
  });

  it("keeps truly wider closed line-art bands on satin", () => {
    const metrics = makeMetrics({
      areaMm2: 36,
      perimeterMm: 60,
      bboxWidthMm: 14,
      bboxHeightMm: 10,
      estimatedWidthMm: 3.25,
      estimatedLengthMm: 16,
      slenderness: 3.2,
      compactness: 0.23,
      holeCount: 1,
      widthMinMm: 2.8,
      widthAvgMm: 3.2,
      widthMaxMm: 3.4,
      loopCount: 1,
      hasStableSkeleton: true,
      isStrokeLike: true,
    });

    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");

    expect(strokeKind).toBe("narrow-satin");
    expect(role).toBe("decorative-band");
  });

  it("keeps sampled narrow loop contours on outline role even when perimeter width overestimates them", () => {
    const metrics = makeMetrics({
      areaMm2: 18,
      perimeterMm: 44,
      bboxWidthMm: 12,
      bboxHeightMm: 10,
      estimatedWidthMm: 3.8,
      estimatedLengthMm: 13,
      slenderness: 4.2,
      compactness: 0.24,
      holeCount: 1,
      widthMinMm: 1.1,
      widthAvgMm: 1.7,
      widthMaxMm: 2.2,
      loopCount: 0,
      hasStableSkeleton: true,
      isStrokeLike: true,
    });

    const strokeKind = classifyStrokeKind(metrics, "line-art");
    const role = classifyStrokeRole(metrics, strokeKind, "line-art");

    expect(strokeKind).toBe("bean-run");
    expect(role).toBe("outline");
  });
});
