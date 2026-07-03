import type { DigitizingMode } from "./config";

const DEFAULT_VECTORIZE_TURDSIZE = 8;
const LINE_ART_VECTORIZE_TURDSIZE = 1;
const LINE_ART_MIN_REGION_AREA_PX = 1;

export function resolveVectorizeTurdsize(digitizingMode: DigitizingMode): number {
  return digitizingMode === "line-art"
    ? LINE_ART_VECTORIZE_TURDSIZE
    : DEFAULT_VECTORIZE_TURDSIZE;
}

export function resolveBuildMinRegionAreaPx(
  digitizingMode: DigitizingMode,
  configuredMinRegionAreaPx: number,
): number {
  if (digitizingMode !== "line-art") return configuredMinRegionAreaPx;
  if (configuredMinRegionAreaPx <= 0) return configuredMinRegionAreaPx;
  return Math.min(configuredMinRegionAreaPx, LINE_ART_MIN_REGION_AREA_PX);
}
