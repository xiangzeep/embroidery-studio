import type { FabricKind } from "./types";
import { FABRIC_PROFILES } from "./fabric";
import type { FillStrategy } from "./render";

/** 対応する刺繍機ファイル形式。 */
export type EmbroideryFormat = "dst" | "pes" | "jef" | "exp" | "vp3";

/** fabric によって既定値が変わるフィールド名。 */
export type FabricOverrideKey = "stitchDensity";

/**
 * UI で扱う変換設定。pipeline のドメインに属するため、UI コンポーネントには
 * 依存しない (compose.ts や config.ts から import するときに循環参照を避ける)。
 */
export type ConversionConfig = {
  format: EmbroideryFormat;
  fabric: FabricKind;
  widthMm: number;
  colorCount: number;
  stitchDensity: number;
  satinMaxWidthMm: number;
  /**
   * 量子化前の色平滑化強度 (0..4)。bilateralFilter のプリセットにマップされ、
   * 境界を保ったまま中間色を潰すので影色などの細いクラスタが背景に吸われにくくなる。
   */
  smoothing: number;
  /**
   * 各色レイヤーのマスクを何 px 膨張させてからトレースするか (0..3)。
   * 隣接色レイヤーが互いに重なって pull gap を埋める。
   */
  boundaryDilatePx: number;
  /** 全体の fill 縫い向き (deg)。0=水平、90=垂直。 */
  fillAngleDeg: number;
  /** 色 (colorIndex) ごとの fill 向き override (deg)。 */
  fillAngleByColor: Record<number, number>;
  /** shape 形状ベースで fill 方向を決めるかどうか。 */
  fillStrategy: FillStrategy;
  /** ユーザーが明示的に上書きした fabric-driven フィールドの集合。 */
  overrides: Partial<Record<FabricOverrideKey, true>>;
  /** Phase 2 §3 Underlay 生成をスキップ (デバッグ / Phase 1 互換用)。 */
  disableUnderlay: boolean;
  /** Phase 2 §4 Pull Compensation をスキップ (デバッグ / Phase 1 互換用)。 */
  disableCompensation: boolean;
};

/** fabric を指定して初期 ConversionConfig を作る。 */
export function makeDefaultConfig(fabric: FabricKind): ConversionConfig {
  return {
    format: "dst",
    fabric,
    widthMm: 100,
    colorCount: 6,
    stitchDensity: FABRIC_PROFILES[fabric].defaultDensityMm,
    satinMaxWidthMm: 5,
    smoothing: 2,
    boundaryDilatePx: 1,
    fillAngleDeg: 45,
    fillAngleByColor: {},
    fillStrategy: "global-angle",
    overrides: {},
    disableUnderlay: false,
    disableCompensation: false,
  };
}

/**
 * fabric 切替時に、ユーザーが触っていない fabric-driven フィールドだけを
 * 新しい fabric の既定値に差し替えた config を返す。
 * overrides に key が立っているフィールドは保持される。
 *
 * 何も変わらない場合 (fabric 同一かつ stitchDensity 同一) は同一参照を返し、
 * 不要な再レンダーを抑える。
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
