import type { ColorRegion } from "./vectorize";
import type {
  EmbroideryObject,
  FabricProfile,
  ObjectKind,
  ObjectProps,
  Shape,
  ShapeMetrics,
} from "./types";
import { analyzeShape, computeAspectRatio, scaleShape } from "./geometry";
import { pullCompForWidth } from "./fabric";
import { classifyBackgroundShape, shapeArea } from "./background";
import { simplifyShapeBoundary } from "./region-merge";
import { classifyLayer } from "./layers";
import { resolveLayerStitchPolicy } from "./layer-stitch-policy";
import {
  classifyStrokeKind,
  classifyStrokeRole,
  resolveObjectKindForStroke,
} from "./stroke-classifier";
import { analyzeStrokeMetrics } from "./stroke-metrics";
import type { DigitizingMode, OutlineFontStrategy } from "./config";
import type { StrokeOverride } from "./types";

export type BuildObjectsInput = {
  regions: ColorRegion[];
  /**
   * English note.
   * English note.
   */
  widthMm: number;
  widthPx: number;
  heightPx?: number;
  fabric: FabricProfile;
  /** English note. */
  runMaxWidthMm?: number; // default 0.6
  /** English note. */
  satinMaxWidthMm: number;
  /** English note. */
  satinMinAspectRatio?: number;
  /** Minimum shape area in source pixels before an object is created. */
  minRegionAreaPx?: number;
  /** Minimum shape area in square millimeters before an object is created. */
  minRegionAreaMm2?: number;
  /** Remove near-white shapes connected to the image edge. */
  removeWhiteBackground?: boolean;
  /** Simplify low-amplitude jagged boundaries before scaling to millimeters. */
  boundarySimplifyTolerancePx?: number;
  /** Stroke classification/render preference profile. */
  digitizingMode?: DigitizingMode;
  outlineFontStrategy?: OutlineFontStrategy;
};

const DEFAULT_RUN_MAX_WIDTH_MM = 0.6;
const DEFAULT_SATIN_MIN_ASPECT_RATIO = 4;
const DEFAULT_MAX_STITCH_MM = 7;
const DEFAULT_MIN_REGION_AREA_PX = 0;
const DEFAULT_BOUNDARY_SIMPLIFY_TOLERANCE_PX = 0.6;
const RUN_MIN_ASPECT_RATIO = 3;

/**
 * English note.
 * English note.
 */
export function determineKind(
  shape: Shape,
  runMaxWidthMm: number,
  satinMaxWidthMm: number,
  satinMinAspectRatio: number,
): { kind: ObjectKind; shortSide: number; aspectRatio: number } {
  const metrics = measureShapeMetrics(shape);
  const { shortSide } = analyzeShape(shape.outer);
  return {
    kind: classifyObject(metrics, {
      shortSideMm: shortSide,
      runMaxWidthMm,
      satinMaxWidthMm,
      satinMinAspectRatio,
    }),
    shortSide,
    aspectRatio: metrics.aspectRatio,
  };
}

export function classifyObject(
  metrics: ShapeMetrics,
  opts: {
    shortSideMm: number;
    runMaxWidthMm: number;
    satinMaxWidthMm: number;
    satinMinAspectRatio: number;
  },
): ObjectKind {
  if (metrics.holeCount > 0) return "fill";
  if (opts.shortSideMm < opts.runMaxWidthMm) {
    return metrics.aspectRatio >= RUN_MIN_ASPECT_RATIO ? "run" : "fill";
  }
  if (
    opts.shortSideMm < opts.satinMaxWidthMm &&
    metrics.aspectRatio > opts.satinMinAspectRatio
  ) {
    return "satin";
  }
  return "fill";
}

function deriveDefaultProps(
  kind: ObjectKind,
  shortSideMm: number,
  fabric: FabricProfile,
): ObjectProps {
  const underlay =
    kind === "satin"
      ? fabric.underlayPolicy.satin(shortSideMm)
      : kind === "fill"
        ? fabric.underlayPolicy.fill()
        : fabric.underlayPolicy.run();
  const props: ObjectProps = {
    densityMm: fabric.defaultDensityMm,
    maxStitchMm: DEFAULT_MAX_STITCH_MM,
    pushCompMm: fabric.defaultPushCompMm,
    underlay,
  };
  if (kind === "satin") {
    props.pullCompMm = pullCompForWidth(fabric, shortSideMm);
  }
  return props;
}

type BuildOptions = {
  mmPerPx: number;
  widthPx: number;
  heightPx?: number;
  runMaxWidthMm: number;
  satinMaxWidthMm: number;
  satinMinAspectRatio: number;
  fabric: FabricProfile;
  minRegionAreaPx: number;
  minRegionAreaMm2: number;
  removeWhiteBackground: boolean;
  boundarySimplifyTolerancePx: number;
  digitizingMode: DigitizingMode;
  outlineFontStrategy: OutlineFontStrategy;
};

export function measureShapeMetrics(shape: Shape): ShapeMetrics {
  const areaMm2 = shapeArea(shape);
  const perimeterMm = polygonPerimeter(shape.outer) +
    shape.holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0);
  const xs = shape.outer.map(([x]) => x);
  const ys = shape.outer.map(([, y]) => y);
  const bboxWidthMm = Math.max(...xs) - Math.min(...xs);
  const bboxHeightMm = Math.max(...ys) - Math.min(...ys);
  const shortSide = Math.min(bboxWidthMm, bboxHeightMm);
  const longSide = Math.max(bboxWidthMm, bboxHeightMm);
  const aspectRatio = shortSide <= 1e-9 ? Infinity : longSide / shortSide;
  const compactness = perimeterMm <= 1e-9 ? 0 :
    (4 * Math.PI * areaMm2) / (perimeterMm * perimeterMm);

  return {
    areaMm2,
    perimeterMm,
    bboxWidthMm,
    bboxHeightMm,
    compactness,
    aspectRatio,
    holeCount: shape.holes.length,
  };
}

function polygonPerimeter(poly: Shape["outer"]): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function classifyWhiteShape(region: ColorRegion, shapePx: Shape, opts: BuildOptions) {
  return classifyBackgroundShape({
    shape: shapePx,
    rgb: region.rgb,
    widthPx: opts.widthPx,
    heightPx: opts.heightPx,
  });
}

function isRemovableWhiteBackground(region: ColorRegion, shapePx: Shape, opts: BuildOptions): boolean {
  return opts.removeWhiteBackground && !classifyWhiteShape(region, shapePx, opts).keep;
}

function shouldBypassAreaCleanup(region: ColorRegion, shapePx: Shape, opts: BuildOptions): boolean {
  if (!opts.removeWhiteBackground) return false;
  return classifyWhiteShape(region, shapePx, opts).kind === "interior-white";
}




function shouldKeepShape(shapePx: Shape, opts: BuildOptions, bypassAreaCleanup = false): boolean {
  if (bypassAreaCleanup) return true;
  const areaPx = shapeArea(shapePx);
  if (areaPx < opts.minRegionAreaPx) return false;
  if (opts.minRegionAreaMm2 > 0) {
    const areaMm2 = areaPx * opts.mmPerPx * opts.mmPerPx;
    if (areaMm2 < opts.minRegionAreaMm2) return false;
  }
  return true;
}

/** English note. */
function buildObjectForShape(
  region: ColorRegion,
  shapeIndex: number,
  shapePx: Shape,
  opts: BuildOptions,
  order: number,
): EmbroideryObject | null {
  if (shapePx.outer.length < 3) return null;
  if (isRemovableWhiteBackground(region, shapePx, opts)) return null;
  if (!shouldKeepShape(shapePx, opts, shouldBypassAreaCleanup(region, shapePx, opts))) return null;
  const simplifiedShapePx = simplifyShapeBoundary(shapePx, opts.boundarySimplifyTolerancePx);
  const shapeMm = scaleShape(simplifiedShapePx, opts.mmPerPx);
  const metrics = measureShapeMetrics(shapeMm);
  const layer = classifyLayer({
    shape: simplifiedShapePx,
    rgb: region.rgb,
    widthPx: opts.widthPx,
    heightPx: opts.heightPx ?? opts.widthPx,
  });
  const { kind: baseKind, shortSide } = determineKind(
    shapeMm,
    opts.runMaxWidthMm,
    opts.satinMaxWidthMm,
    opts.satinMinAspectRatio,
  );
  const strokeMetrics = analyzeStrokeMetrics(shapeMm);
  const strokeKind = classifyStrokeKind(strokeMetrics, opts.digitizingMode);
  const strokeRole = classifyStrokeRole(strokeMetrics, strokeKind, opts.digitizingMode);
  const strokeOverride: StrokeOverride = "use-global";
  const kind = resolveObjectKindForStroke(
    baseKind,
    strokeKind,
    strokeRole,
    opts.digitizingMode,
    opts.outlineFontStrategy,
    strokeOverride,
  );
  const defaultProps = deriveDefaultProps(kind, shortSide, opts.fabric);
  const policy = resolveLayerStitchPolicy({
    layer,
    objectKind: kind,
    defaultUnderlay: defaultProps.underlay,
  });
  if (!policy.renderable) return null;
  return {
    id: `${region.colorIndex}-${shapeIndex}`,
    kind,
    baseKind,
    layer,
    colorIndex: region.colorIndex,
    rgb: region.rgb,
    shape: shapeMm,
    props: {
      ...defaultProps,
      underlay: policy.underlay,
      lockstitch: policy.lockstitch,
    },
    metrics,
    strokeKind,
    strokeRole,
    strokeMetrics,
    strokeOverride,
    order,
  };
}

/**
 * English note.
 * English note.
 */
export function buildObjects(input: BuildObjectsInput): EmbroideryObject[] {
  const opts: BuildOptions = {
    mmPerPx: input.widthMm / input.widthPx,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    runMaxWidthMm: input.runMaxWidthMm ?? DEFAULT_RUN_MAX_WIDTH_MM,
    satinMaxWidthMm: input.satinMaxWidthMm,
    satinMinAspectRatio: input.satinMinAspectRatio ?? DEFAULT_SATIN_MIN_ASPECT_RATIO,
    fabric: input.fabric,
    minRegionAreaPx: input.minRegionAreaPx ?? DEFAULT_MIN_REGION_AREA_PX,
    minRegionAreaMm2: input.minRegionAreaMm2 ?? 0,
    removeWhiteBackground: input.removeWhiteBackground ?? false,
    boundarySimplifyTolerancePx: input.boundarySimplifyTolerancePx ?? DEFAULT_BOUNDARY_SIMPLIFY_TOLERANCE_PX,
    digitizingMode: input.digitizingMode ?? "line-art",
    outlineFontStrategy: input.outlineFontStrategy ?? "auto",
  };
  const result: EmbroideryObject[] = [];
  const sorted = [...input.regions].sort((a, b) => a.colorIndex - b.colorIndex);
  let order = 0;
  for (const region of sorted) {
    region.shapes.forEach((shapePx, shapeIndex) => {
      const obj = buildObjectForShape(region, shapeIndex, shapePx, opts, order);
      if (obj === null) return;
      result.push(obj);
      order++;
    });
  }
  return result;
}
