import type {
  ObjectKind,
  ObjectProps,
  EmbroideryDesign,
  EmbroideryObject,
  FabricKind,
  FabricProfile,
} from "./types";

// 後続 PR (fabric.ts) で生地依存に差し替えやすいよう、既定値は名前付き定数に集約する。
const DEFAULT_DENSITY_MM = 0.4;
const DEFAULT_MAX_STITCH_MM = 4;
const SATIN_MAX_STITCH_MM = 7;
const SATIN_ANGLE_DEG = 0;
const FILL_ANGLE_DEG = 45;

/** kind に応じた ObjectProps の既定値を生成する。戻り値は呼び出しごとに独立。 */
export function createDefaultObjectProps(kind: ObjectKind): ObjectProps {
  const base: ObjectProps = {
    densityMm: DEFAULT_DENSITY_MM,
    maxStitchMm: DEFAULT_MAX_STITCH_MM,
  };
  if (kind === "satin") {
    return { ...base, maxStitchMm: SATIN_MAX_STITCH_MM, angleDeg: SATIN_ANGLE_DEG };
  }
  if (kind === "fill") return { ...base, angleDeg: FILL_ANGLE_DEG };
  return base; // run
}

/** objects が空の EmbroideryDesign を生成する。fabric は参照をそのまま保持する。 */
export function createEmptyDesign(args: {
  widthMm: number;
  heightMm: number;
  fabric: FabricProfile;
}): EmbroideryDesign {
  return {
    widthMm: args.widthMm,
    heightMm: args.heightMm,
    fabric: args.fabric,
    objects: [],
  };
}

/**
 * EmbroideryDesign の純データ表現。FabricProfile.underlayPolicy は関数フィールドのため
 * JSON 化できず、fabric は kind のみ残す。復元は deserializeDesign の resolver に委譲する。
 * (index.ts への re-export 可否は Phase 1 PR5 の compose 分割で判断する。)
 */
export type SerializedDesign = {
  widthMm: number;
  heightMm: number;
  fabric: { kind: FabricKind };
  objects: EmbroideryObject[]; // ObjectProps の関数フィールドなし、純データ
};

/** EmbroideryDesign を JSON シリアライズ可能な純データ表現に変換する。 */
export function serializeDesign(d: EmbroideryDesign): SerializedDesign {
  return {
    widthMm: d.widthMm,
    heightMm: d.heightMm,
    fabric: { kind: d.fabric.kind },
    // EmbroideryObject 内に関数値は無いため deep copy で十分
    objects: JSON.parse(JSON.stringify(d.objects)) as EmbroideryObject[],
  };
}

/** SerializedDesign を EmbroideryDesign に復元する。fabric は resolver で構築する。 */
export function deserializeDesign(
  s: SerializedDesign,
  fabricResolver: (kind: FabricKind) => FabricProfile,
): EmbroideryDesign {
  return {
    widthMm: s.widthMm,
    heightMm: s.heightMm,
    fabric: fabricResolver(s.fabric.kind),
    // SerializedDesign を直接受け取る経路でも mutation が漏れないよう deep copy する
    objects: JSON.parse(JSON.stringify(s.objects)) as EmbroideryObject[],
  };
}
