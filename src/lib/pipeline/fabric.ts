import type { FabricKind, FabricProfile, UnderlayConfig, UnderlayPolicy } from "./types";

// ---- 基本パラメータ (Phase 計画書 3.3) ----

type FabricBaseValues = {
  defaultDensityMm: number;
  pullCompPerWidth: number;
  minPullCompMm: number;
  defaultPushCompMm: number;
};

const FABRIC_BASE_VALUES: Readonly<Record<FabricKind, FabricBaseValues>> = {
  denim:        { defaultDensityMm: 0.40, pullCompPerWidth: 0.025, minPullCompMm: 0.10, defaultPushCompMm: 0.05 },
  twill:        { defaultDensityMm: 0.40, pullCompPerWidth: 0.030, minPullCompMm: 0.10, defaultPushCompMm: 0.05 },
  canvas:       { defaultDensityMm: 0.42, pullCompPerWidth: 0.020, minPullCompMm: 0.10, defaultPushCompMm: 0.05 },
  "knit-light": { defaultDensityMm: 0.45, pullCompPerWidth: 0.060, minPullCompMm: 0.20, defaultPushCompMm: 0.10 },
  "knit-heavy": { defaultDensityMm: 0.48, pullCompPerWidth: 0.075, minPullCompMm: 0.25, defaultPushCompMm: 0.15 },
  terry:        { defaultDensityMm: 0.42, pullCompPerWidth: 0.080, minPullCompMm: 0.30, defaultPushCompMm: 0.20 },
  fleece:       { defaultDensityMm: 0.45, pullCompPerWidth: 0.060, minPullCompMm: 0.25, defaultPushCompMm: 0.15 },
  leather:      { defaultDensityMm: 0.50, pullCompPerWidth: 0.015, minPullCompMm: 0.05, defaultPushCompMm: 0.02 },
  silk:         { defaultDensityMm: 0.40, pullCompPerWidth: 0.020, minPullCompMm: 0.08, defaultPushCompMm: 0.03 },
  felt:         { defaultDensityMm: 0.42, pullCompPerWidth: 0.020, minPullCompMm: 0.10, defaultPushCompMm: 0.05 },
};

// ---- underlay policy (family-based, table-driven) ----
// NOTE (Phase 1 暫定):
//   - zigzag は実機では「zigzag + edge」の合成下打ち。Phase 2 で composite
//     underlay (例: { kind: "composite", parts: [...] }) に拡張するまでは
//     UnderlayConfig.kind="zigzag" 単独で代用する。
//   - terry/fleece の tatami underlay は kind="fill" + 密 spacing で代用する。

type SatinFamily = "twill" | "knit" | "terry" | "leather" | "silk";
type FillFamily = "twill" | "knitLight" | "knitHeavy" | "terry" | "leather" | "silkFelt";

const FABRIC_TO_SATIN_FAMILY: Readonly<Record<FabricKind, SatinFamily>> = {
  denim: "twill", twill: "twill", canvas: "twill", felt: "twill",
  "knit-light": "knit", "knit-heavy": "knit",
  terry: "terry", fleece: "terry",
  leather: "leather",
  silk: "silk",
};

const FABRIC_TO_FILL_FAMILY: Readonly<Record<FabricKind, FillFamily>> = {
  denim: "twill", twill: "twill", canvas: "twill",
  felt: "silkFelt", silk: "silkFelt",
  "knit-light": "knitLight",
  "knit-heavy": "knitHeavy",
  terry: "terry", fleece: "terry",
  leather: "leather",
};

// satin の三段分岐: widthMm < tier1Max → tier1, widthMm <= tier2Max → tier2, else tier3
// (`<` と `<=` の非対称は元コードの境界挙動を維持するため意図的)
type SatinTiers = {
  tier1Max: number;
  tier2Max: number;
  tier1: () => UnderlayConfig;
  tier2: () => UnderlayConfig;
  tier3: () => UnderlayConfig;
};

const SATIN_TABLE: Readonly<Record<SatinFamily, SatinTiers>> = {
  twill: {
    tier1Max: 2,
    tier2Max: 4,
    tier1: () => ({ kind: "center-run", stitchLenMm: 2.0 }),
    tier2: () => ({ kind: "edge-run", insetMm: 0.3, stitchLenMm: 2.0 }),
    tier3: () => ({ kind: "zigzag", spacingMm: 1.5, insetMm: 0.3 }),
  },
  knit: {
    tier1Max: 2,
    tier2Max: 4,
    tier1: () => ({ kind: "center-run", stitchLenMm: 1.8 }),
    tier2: () => ({ kind: "edge-run", insetMm: 0.35, stitchLenMm: 1.8 }),
    tier3: () => ({ kind: "zigzag", spacingMm: 1.0, insetMm: 0.35 }), // denim より強め
  },
  terry: {
    // 毛足が長いので細幅でも center-run は使わない → tier1Max=0 で tier1 を実質無効化
    tier1Max: 0,
    tier2Max: 4,
    tier1: () => ({ kind: "edge-run", insetMm: 0.4, stitchLenMm: 1.8 }),
    tier2: () => ({ kind: "edge-run", insetMm: 0.4, stitchLenMm: 1.8 }),
    tier3: () => ({ kind: "zigzag", spacingMm: 1.2, insetMm: 0.4 }),
  },
  leather: {
    // zigzag 不使用 (針穴跡を最小化) → tier2Max=Infinity で tier3 を実質無効化
    tier1Max: 2,
    tier2Max: Number.POSITIVE_INFINITY,
    tier1: () => ({ kind: "center-run", stitchLenMm: 2.5 }),
    tier2: () => ({ kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }),
    tier3: () => ({ kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }),
  },
  silk: {
    // 軽め (細幅では下打ちなし)
    tier1Max: 2,
    tier2Max: 4,
    tier1: () => ({ kind: "none" }),
    tier2: () => ({ kind: "center-run", stitchLenMm: 2.2 }),
    tier3: () => ({ kind: "edge-run", insetMm: 0.25, stitchLenMm: 2.2 }),
  },
};

const FILL_ANGLE_DEG = 90; // underlay fill は top stitch と直交させる前提

const FILL_TABLE: Readonly<Record<FillFamily, () => UnderlayConfig>> = {
  twill: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 3.0 }), // 粗め
  knitLight: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.5 }), // 強め
  knitHeavy: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.2 }), // さらに強め
  terry: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.0 }), // tatami 代用
  leather: () => ({ kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }), // fill 禁止
  silkFelt: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.8 }), // 中庸
};

function satinFor(family: SatinFamily, widthMm: number): UnderlayConfig {
  const t = SATIN_TABLE[family];
  // 非有限値 / 負数は 0 にクランプして「最も軽い tier1 (terry のみ tier2)」に倒す。
  // pullCompForWidth と防御方針を揃え、不正入力が zigzag/重い underlay に
  // フォールバックして針穴を増やすのを防ぐ。
  const w = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 0;
  if (w < t.tier1Max) return t.tier1();
  if (w <= t.tier2Max) return t.tier2();
  return t.tier3();
}

const runForAll = (): UnderlayConfig => ({ kind: "none" });

function underlayPolicyFor(kind: FabricKind): UnderlayPolicy {
  const satinFamily = FABRIC_TO_SATIN_FAMILY[kind];
  const fillFamily = FABRIC_TO_FILL_FAMILY[kind];
  return {
    satin: (widthMm: number) => satinFor(satinFamily, widthMm),
    fill: FILL_TABLE[fillFamily],
    run: runForAll,
  };
}

// ---- FABRIC_PROFILES 構築 + 公開 API ----

const FABRIC_KINDS = Object.keys(FABRIC_BASE_VALUES) as FabricKind[];

// shallow freeze だと profile / underlayPolicy が mutate 可能だったため、
// FabricProfile 単位と underlayPolicy 単位でも freeze する。Phase 5 で UI から
// 値を上書きする際は必ず複製経由で行うことを構造的に保証する。
export const FABRIC_PROFILES: Readonly<Record<FabricKind, FabricProfile>> = Object.freeze(
  Object.fromEntries(
    FABRIC_KINDS.map((kind): [FabricKind, FabricProfile] => [
      kind,
      Object.freeze({
        kind,
        ...FABRIC_BASE_VALUES[kind],
        underlayPolicy: Object.freeze(underlayPolicyFor(kind)),
      }),
    ]),
  ) as Record<FabricKind, FabricProfile>,
);

/** FabricKind から対応する FabricProfile を返す純ルックアップ。 */
export function getFabricProfile(kind: FabricKind): FabricProfile {
  return FABRIC_PROFILES[kind];
}

/**
 * satin 幅依存の pull compensation を返す。
 * 公式: max(profile.minPullCompMm, widthMm * profile.pullCompPerWidth)
 * 負数 / NaN / 非有限値は minPullCompMm にクランプ。
 */
export function pullCompForWidth(profile: FabricProfile, widthMm: number): number {
  const w = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 0;
  return Math.max(profile.minPullCompMm, w * profile.pullCompPerWidth);
}
