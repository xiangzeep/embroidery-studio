import type { ColorRegion } from "./vectorize";
import type {
  EmbroideryObject,
  FabricProfile,
  ObjectKind,
  ObjectProps,
  Shape,
} from "./types";
import { analyzeShape, computeAspectRatio, scaleShape } from "./geometry";
import { pullCompForWidth } from "./fabric";

export type BuildObjectsInput = {
  regions: ColorRegion[];
  /**
   * mm 換算用のスケール。x と y は scaleShape で同一スカラー (widthMm/widthPx) を使うため
   * 呼び出し側で等方スケールが保証されている前提。非等方スケールは現状サポートしない。
   */
  widthMm: number;
  widthPx: number;
  fabric: FabricProfile;
  /** kind 判定の閾値オーバーライド。未指定なら既定値を使う */
  runMaxWidthMm?: number; // default 0.6
  /** satin 判定の最大幅。呼び出し側で必須指定する想定 */
  satinMaxWidthMm: number;
  /** satin 判定の aspect ratio 下限 (既定 4) */
  satinMinAspectRatio?: number;
};

const DEFAULT_RUN_MAX_WIDTH_MM = 0.6;
const DEFAULT_SATIN_MIN_ASPECT_RATIO = 4;
const DEFAULT_MAX_STITCH_MM = 7;

/**
 * shape の幾何特徴 (shortSide / aspectRatio / holes) から ObjectKind を決定する。
 * stitch.ts の generateStitches からも import される (Phase 1 PR3 Cycle 6)。
 */
export function determineKind(
  shape: Shape,
  runMaxWidthMm: number,
  satinMaxWidthMm: number,
  satinMinAspectRatio: number,
): { kind: ObjectKind; shortSide: number; aspectRatio: number } {
  const { shortSide, longAxis, center } = analyzeShape(shape.outer);
  const aspectRatio = computeAspectRatio(shape.outer, longAxis, center);
  const hasHoles = shape.holes.length > 0;
  if (shortSide < runMaxWidthMm) return { kind: "run", shortSide, aspectRatio };
  if (!hasHoles && shortSide < satinMaxWidthMm && aspectRatio > satinMinAspectRatio) {
    return { kind: "satin", shortSide, aspectRatio };
  }
  return { kind: "fill", shortSide, aspectRatio };
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
  runMaxWidthMm: number;
  satinMaxWidthMm: number;
  satinMinAspectRatio: number;
  fabric: FabricProfile;
};

/** 単一 shape から EmbroideryObject を 1 つ構築する。outer < 3 の場合は null。 */
function buildObjectForShape(
  region: ColorRegion,
  shapeIndex: number,
  shapePx: Shape,
  opts: BuildOptions,
  order: number,
): EmbroideryObject | null {
  if (shapePx.outer.length < 3) return null;
  const shapeMm = scaleShape(shapePx, opts.mmPerPx);
  const { kind, shortSide } = determineKind(
    shapeMm,
    opts.runMaxWidthMm,
    opts.satinMaxWidthMm,
    opts.satinMinAspectRatio,
  );
  return {
    id: `${region.colorIndex}-${shapeIndex}`,
    kind,
    colorIndex: region.colorIndex,
    rgb: region.rgb,
    shape: shapeMm,
    props: deriveDefaultProps(kind, shortSide, opts.fabric),
    order,
  };
}

/**
 * ColorRegion[] から EmbroideryObject[] を構築する。
 * order は region.colorIndex 昇順 × region 内 shape 出現順で 0-based 連番。
 */
export function buildObjects(input: BuildObjectsInput): EmbroideryObject[] {
  const opts: BuildOptions = {
    mmPerPx: input.widthMm / input.widthPx,
    runMaxWidthMm: input.runMaxWidthMm ?? DEFAULT_RUN_MAX_WIDTH_MM,
    satinMaxWidthMm: input.satinMaxWidthMm,
    satinMinAspectRatio: input.satinMinAspectRatio ?? DEFAULT_SATIN_MIN_ASPECT_RATIO,
    fabric: input.fabric,
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
