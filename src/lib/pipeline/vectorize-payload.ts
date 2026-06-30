import { simplifyShapeBoundary } from "./region-merge";
import type { ColorRegion } from "./vectorize";

const DEFAULT_TRANSFER_SIMPLIFY_TOLERANCE_PX = 0.6;

export function compactVectorizeRegionsForTransfer(
  regions: ColorRegion[],
  tolerancePx = DEFAULT_TRANSFER_SIMPLIFY_TOLERANCE_PX,
): ColorRegion[] {
  return regions.map((region) => ({
    colorIndex: region.colorIndex,
    rgb: region.rgb,
    shapes: region.shapes.map((shape) => simplifyShapeBoundary(shape, tolerancePx)),
    svgPath: "",
    polygons: [],
  }));
}
