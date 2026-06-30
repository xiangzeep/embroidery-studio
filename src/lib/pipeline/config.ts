import type { FabricKind } from "./types";
import { FABRIC_PROFILES } from "./fabric";
import type { FillStrategy } from "./render";

/** English note. */
export type EmbroideryFormat = "dst" | "pes" | "jef" | "exp" | "vp3";

export type QualityPreset = "fast" | "balanced" | "high" | "detail";

export type DigitizingMode = "line-art" | "photo-stitch";
export type OutlineFontStrategy = "auto" | "prefer-run" | "prefer-satin";

export const QUALITY_PRESETS: Record<QualityPreset, {
  label: string;
  maxDimension: number;
  defaultSmoothing: number;
  maxColorCount: number;
}> = {
  fast: {
    label: "Fast",
    maxDimension: 256,
    defaultSmoothing: 1,
    maxColorCount: 6,
  },
  balanced: {
    label: "Balanced",
    maxDimension: 384,
    defaultSmoothing: 2,
    maxColorCount: 12,
  },
  high: {
    label: "High",
    maxDimension: 640,
    defaultSmoothing: 2,
    maxColorCount: 16,
  },
  detail: {
    label: "Detail",
    maxDimension: 768,
    defaultSmoothing: 1,
    maxColorCount: 16,
  },
};

/** English note. */
export type FabricOverrideKey = "stitchDensity";

/**
 * English note.
 * English note.
 */
export type ConversionConfig = {
  format: EmbroideryFormat;
  digitizingMode: DigitizingMode;
  outlineFontStrategy: OutlineFontStrategy;
  fabric: FabricKind;
  qualityPreset: QualityPreset;
  widthMm: number;
  colorCount: number;
  stitchDensity: number;
  satinMaxWidthMm: number;
  /**
   * English note.
   * English note.
   */
  smoothing: number;
  /**
   * English note.
   * English note.
   */
  boundaryDilatePx: number;
  /** Minimum traced region area kept for stitch generation, measured in source pixels. */
  minRegionAreaPx: number;
  /** Remove near-white shapes connected to the image edge. */
  removeWhiteBackground: boolean;
  /** English note. */
  fillAngleDeg: number;
  /** English note. */
  fillAngleByColor: Record<number, number>;
  /** English note. */
  fillStrategy: FillStrategy;
  /** English note. */
  overrides: Partial<Record<FabricOverrideKey, true>>;
  /** English note. */
  disableUnderlay: boolean;
  /** English note. */
  disableCompensation: boolean;
};

/** English note. */
export function makeDefaultConfig(fabric: FabricKind): ConversionConfig {
  return {
    format: "dst",
    digitizingMode: "line-art",
    outlineFontStrategy: "auto",
    fabric,
    qualityPreset: "balanced",
    widthMm: 100,
    colorCount: 6,
    stitchDensity: FABRIC_PROFILES[fabric].defaultDensityMm,
    satinMaxWidthMm: 5,
    smoothing: 2,
    boundaryDilatePx: 0,
    minRegionAreaPx: 12,
    removeWhiteBackground: true,
    fillAngleDeg: 45,
    fillAngleByColor: {},
    fillStrategy: "shape-long-axis",
    overrides: {},
    disableUnderlay: false,
    disableCompensation: false,
  };
}

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
export function applyFabricDefaults(
  prev: ConversionConfig,
  nextFabric: FabricKind,
): ConversionConfig {
  const profile = FABRIC_PROFILES[nextFabric];
  const stitchDensity = prev.overrides.stitchDensity
    ? prev.stitchDensity
    : profile.defaultDensityMm;
  if (prev.fabric === nextFabric && prev.stitchDensity === stitchDensity) {
    return prev;
  }
  return {
    ...prev,
    fabric: nextFabric,
    stitchDensity,
  };
}

export function applyQualityPreset(
  prev: ConversionConfig,
  preset: QualityPreset,
): ConversionConfig {
  const quality = QUALITY_PRESETS[preset];
  return {
    ...prev,
    qualityPreset: preset,
    colorCount: Math.min(prev.colorCount, quality.maxColorCount),
    smoothing: quality.defaultSmoothing,
  };
}
