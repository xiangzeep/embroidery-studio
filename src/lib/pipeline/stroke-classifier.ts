import type { StrokeMetrics } from "./stroke-metrics";
import type { ObjectKind, StrokeOverride, StrokeRole } from "./types";
import type { DigitizingMode, OutlineFontStrategy } from "./config";

export type StrokeKind =
  | "none"
  | "thin-run"
  | "bean-run"
  | "narrow-satin"
  | "border-satin";

const THIN_RUN_MAX_WIDTH_MM = 0.7;
const LINE_ART_PLAIN_RUN_MAX_WIDTH_MM = 1.8;
const LINE_ART_SHORT_LOOP_RUN_MAX_WIDTH_MM = 1.45;
const LINE_ART_SHORT_LOOP_MAX_LENGTH_MM = 16;
const LINE_ART_SHORT_LOOP_MAX_SLENDERNESS = 8;
const LINE_ART_MEDIUM_CONTOUR_RUN_MAX_WIDTH_MM = 2.4;
const LINE_ART_MEDIUM_CONTOUR_RUN_MAX_LENGTH_MM = 28;
const LINE_ART_MEDIUM_CONTOUR_RUN_MAX_COMPACTNESS = 0.36;
const LINE_ART_MEDIUM_CONTOUR_RUN_MIN_SLENDERNESS = 5.5;
const LINE_ART_LOOP_SATIN_MAX_WIDTH_TRIGGER_MM = 2.4;
const LINE_ART_LOOP_SATIN_MIN_AVG_WIDTH_MM = 1.8;
const LINE_ART_STABLE_LOOP_RUN_MAX_WIDTH_MM = 3.0;
const BEAN_RUN_MAX_WIDTH_MM = 1.4;
const LONG_MEDIUM_STROKE_SATIN_MIN_WIDTH_MM = 0.95;
const LONG_MEDIUM_STROKE_SATIN_MIN_LENGTH_MM = 14;
const LONG_MEDIUM_STROKE_SATIN_MIN_SLENDERNESS = 6;
const NARROW_SATIN_MAX_WIDTH_MM = 3.5;
const BORDER_SATIN_MAX_WIDTH_MM = 6;

export function classifyStrokeKind(
  metrics: StrokeMetrics,
  mode: DigitizingMode = "photo-stitch",
): StrokeKind {
  const width = metrics.widthAvgMm ?? metrics.estimatedWidthMm;
  const widthMax = metrics.widthMaxMm ?? width;
  if (!Number.isFinite(width) || width <= 0) return "none";
  if (
    mode === "line-art" &&
    metrics.holeCount > 0 &&
    metrics.hasStableSkeleton &&
    width <= LINE_ART_STABLE_LOOP_RUN_MAX_WIDTH_MM
  ) {
    return "bean-run";
  }
  if (
    mode === "line-art" &&
    metrics.holeCount > 0 &&
    width >= LINE_ART_LOOP_SATIN_MIN_AVG_WIDTH_MM &&
    widthMax >= LINE_ART_LOOP_SATIN_MAX_WIDTH_TRIGGER_MM &&
    width <= NARROW_SATIN_MAX_WIDTH_MM
  ) {
    return "narrow-satin";
  }
  if (
    mode === "line-art" &&
    metrics.holeCount > 0 &&
    width <= LINE_ART_MEDIUM_CONTOUR_RUN_MAX_WIDTH_MM
  ) {
    return "bean-run";
  }
  if (
    mode === "line-art" &&
    metrics.holeCount > 0 &&
    width <= NARROW_SATIN_MAX_WIDTH_MM
  ) {
    return "narrow-satin";
  }
  if (!metrics.isStrokeLike) return "none";
  if (
    mode === "line-art" &&
    metrics.hasStableSkeleton &&
    (metrics.loopCount ?? 0) > 0 &&
    width <= LINE_ART_MEDIUM_CONTOUR_RUN_MAX_WIDTH_MM
  ) {
    return width < LINE_ART_PLAIN_RUN_MAX_WIDTH_MM ? "thin-run" : "bean-run";
  }
  if (metrics.holeCount > 0) return "none";
  if (width < THIN_RUN_MAX_WIDTH_MM) return "thin-run";
  if (mode === "line-art" && width < LINE_ART_PLAIN_RUN_MAX_WIDTH_MM) {
    return "thin-run";
  }
  if (
    mode === "line-art" &&
    width < LINE_ART_SHORT_LOOP_RUN_MAX_WIDTH_MM &&
    metrics.estimatedLengthMm <= LINE_ART_SHORT_LOOP_MAX_LENGTH_MM &&
    metrics.slenderness <= LINE_ART_SHORT_LOOP_MAX_SLENDERNESS
  ) {
    return "thin-run";
  }
  if (
    mode === "line-art" &&
    width < LINE_ART_MEDIUM_CONTOUR_RUN_MAX_WIDTH_MM &&
    metrics.estimatedLengthMm <= LINE_ART_MEDIUM_CONTOUR_RUN_MAX_LENGTH_MM &&
    metrics.compactness <= LINE_ART_MEDIUM_CONTOUR_RUN_MAX_COMPACTNESS &&
    metrics.slenderness >= LINE_ART_MEDIUM_CONTOUR_RUN_MIN_SLENDERNESS
  ) {
    return "bean-run";
  }
  if (
    width >= LONG_MEDIUM_STROKE_SATIN_MIN_WIDTH_MM &&
    width < BEAN_RUN_MAX_WIDTH_MM &&
    metrics.estimatedLengthMm >= LONG_MEDIUM_STROKE_SATIN_MIN_LENGTH_MM &&
    metrics.slenderness >= LONG_MEDIUM_STROKE_SATIN_MIN_SLENDERNESS
  ) {
    return "narrow-satin";
  }
  if (width < BEAN_RUN_MAX_WIDTH_MM) return "bean-run";
  if (width < NARROW_SATIN_MAX_WIDTH_MM) return "narrow-satin";
  if (width < BORDER_SATIN_MAX_WIDTH_MM) return "border-satin";
  return "none";
}

export function classifyStrokeRole(
  metrics: StrokeMetrics,
  strokeKind: StrokeKind,
  mode: DigitizingMode = "photo-stitch",
): StrokeRole {
  const sampledWidth = metrics.widthAvgMm ?? metrics.estimatedWidthMm;
  const sampledWidthMax = metrics.widthMaxMm ?? sampledWidth;
  if (
    metrics.holeCount > 0 &&
    !(
      mode === "line-art" &&
      (
        (metrics.hasStableSkeleton && (metrics.loopCount ?? 0) > 0) ||
        (
          sampledWidth > 0 &&
          sampledWidth <= NARROW_SATIN_MAX_WIDTH_MM
        ) ||
        (
          metrics.hasStableSkeleton &&
          sampledWidth > 0 &&
          sampledWidth <= LINE_ART_MEDIUM_CONTOUR_RUN_MAX_WIDTH_MM &&
          sampledWidthMax <= LINE_ART_LOOP_SATIN_MAX_WIDTH_TRIGGER_MM
        )
      )
    )
  ) {
    return "none";
  }
  if (strokeKind === "none") return "area";
  if (
    mode === "line-art" &&
    metrics.holeCount > 0 &&
    (strokeKind === "narrow-satin" || strokeKind === "border-satin")
  ) {
    return "decorative-band";
  }
  if (!metrics.isStrokeLike) return "none";
  if (mode === "line-art") return "outline";
  if (strokeKind === "narrow-satin" || strokeKind === "border-satin") {
    return "decorative-band";
  }
  if (strokeKind === "thin-run" || strokeKind === "bean-run") return "outline";
  return "outline";
}

export function resolveObjectKindForStroke(
  baseKind: ObjectKind,
  strokeKind: StrokeKind,
  strokeRole: StrokeRole,
  mode: DigitizingMode = "photo-stitch",
  strategy: OutlineFontStrategy = "auto",
  strokeOverride: StrokeOverride = "use-global",
): ObjectKind {
  if (strokeOverride === "force-run") return "run";
  if (strokeOverride === "force-satin") return "satin";
  if (strokeOverride === "force-fill") return "fill";
  if (strokeRole === "area") return "fill";
  if (mode !== "line-art" && baseKind !== "fill") return baseKind;
  if (strokeRole === "outline" || strokeRole === "font") return "run";
  if (strokeRole === "decorative-band") {
    return strategy === "prefer-run" && mode === "line-art" ? "run" : "satin";
  }
  if (strokeKind === "thin-run" || strokeKind === "bean-run") return "run";
  if (strokeKind === "narrow-satin" || strokeKind === "border-satin") return "satin";
  return baseKind;
}
