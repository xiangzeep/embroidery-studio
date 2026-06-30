import type { FabricKind, FabricProfile, UnderlayConfig, UnderlayPolicy } from "./types";

// English note.

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
// NOTE:
// English note.
// English note.
// English note.
// English note.

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

// English note.
// English note.
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
    tier3: () => ({ kind: "zigzag", spacingMm: 1.0, insetMm: 0.35 }), // English note.
  },
  terry: {
    // English note.
    tier1Max: 0,
    tier2Max: 4,
    tier1: () => ({ kind: "edge-run", insetMm: 0.4, stitchLenMm: 1.8 }),
    tier2: () => ({ kind: "edge-run", insetMm: 0.4, stitchLenMm: 1.8 }),
    tier3: () => ({ kind: "zigzag", spacingMm: 1.2, insetMm: 0.4 }),
  },
  leather: {
    // English note.
    tier1Max: 2,
    tier2Max: Number.POSITIVE_INFINITY,
    tier1: () => ({ kind: "center-run", stitchLenMm: 2.5 }),
    tier2: () => ({ kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }),
    tier3: () => ({ kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }),
  },
  silk: {
    // English note.
    tier1Max: 2,
    tier2Max: 4,
    tier1: () => ({ kind: "none" }),
    tier2: () => ({ kind: "center-run", stitchLenMm: 2.2 }),
    tier3: () => ({ kind: "edge-run", insetMm: 0.25, stitchLenMm: 2.2 }),
  },
};

const FILL_ANGLE_DEG = 90; // English note.

const FILL_TABLE: Readonly<Record<FillFamily, () => UnderlayConfig>> = {
  twill: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 3.0 }), // English note.
  knitLight: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.5 }), // English note.
  knitHeavy: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.2 }), // English note.
  terry: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.0 }), // tatami 代用
  leather: () => ({ kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }), // fill 禁止
  silkFelt: () => ({ kind: "fill", angleDeg: FILL_ANGLE_DEG, spacingMm: 2.8 }), // 中庸
};

function satinFor(family: SatinFamily, widthMm: number): UnderlayConfig {
  const t = SATIN_TABLE[family];
  // English note.
  // English note.
  // English note.
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

// English note.
// English note.
// English note.
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

/** English note. */
export function getFabricProfile(kind: FabricKind): FabricProfile {
  return FABRIC_PROFILES[kind];
}

/**
 * English note.
 * 公式: max(profile.minPullCompMm, widthMm * profile.pullCompPerWidth)
 * English note.
 */
export function pullCompForWidth(profile: FabricProfile, widthMm: number): number {
  const w = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 0;
  return Math.max(profile.minPullCompMm, w * profile.pullCompPerWidth);
}
