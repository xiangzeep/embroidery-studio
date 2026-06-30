// serialize.ts — Phase 5 PR24 EmbroideryDesign の JSON 永続化。
//
// fabric.underlayPolicy は関数を含むため、fabric.kind のみシリアライズし、
// 復元時に getFabricProfile(kind) で UnderlayPolicy 含む FabricProfile を再構築。
// objects / props / shape は純データなのでそのまま JSON 化可能。
//
// schemaVersion を持たせて将来のスキーマ進化を吸収できる形にする。

import { getFabricProfile } from "@/lib/pipeline/fabric";
import type {
  EmbroideryDesign,
  EmbroideryObject,
  FabricKind,
} from "@/lib/pipeline/types";

export const SCHEMA_VERSION = 1 as const;

export type SerializedDesign = {
  schemaVersion: typeof SCHEMA_VERSION;
  widthMm: number;
  heightMm: number;
  fabricKind: FabricKind;
  fabricOverrides?: Partial<{
    defaultDensityMm: number;
    pullCompPerWidth: number;
    minPullCompMm: number;
    defaultPushCompMm: number;
  }>;
  objects: EmbroideryObject[];
};

export class SerializeError extends Error {
  constructor(
    public readonly reason:
      | "invalid-json"
      | "unsupported-version"
      | "missing-field"
      | "unknown-fabric",
    message: string,
  ) {
    super(message);
    this.name = "SerializeError";
  }
}

/** EmbroideryDesign → JSON 文字列 (整形なし)。fabric は kind のみ保存。 */
export function serializeDesign(design: EmbroideryDesign): string {
  const profile = design.fabric;
  const overrides: SerializedDesign["fabricOverrides"] = {};
  const baseline = getFabricProfile(profile.kind);
  if (profile.defaultDensityMm !== baseline.defaultDensityMm) {
    overrides.defaultDensityMm = profile.defaultDensityMm;
  }
  if (profile.pullCompPerWidth !== baseline.pullCompPerWidth) {
    overrides.pullCompPerWidth = profile.pullCompPerWidth;
  }
  if (profile.minPullCompMm !== baseline.minPullCompMm) {
    overrides.minPullCompMm = profile.minPullCompMm;
  }
  if (profile.defaultPushCompMm !== baseline.defaultPushCompMm) {
    overrides.defaultPushCompMm = profile.defaultPushCompMm;
  }
  const payload: SerializedDesign = {
    schemaVersion: SCHEMA_VERSION,
    widthMm: design.widthMm,
    heightMm: design.heightMm,
    fabricKind: profile.kind,
    objects: design.objects,
    ...(Object.keys(overrides).length > 0 ? { fabricOverrides: overrides } : {}),
  };
  return JSON.stringify(payload);
}

/** JSON 文字列 → EmbroideryDesign (fabric を kind から再構築)。 */
export function deserializeDesign(json: string): EmbroideryDesign {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SerializeError("invalid-json", "JSON parse error");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SerializeError("invalid-json", "payload is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new SerializeError(
      "unsupported-version",
      `unsupported schemaVersion: ${String(obj.schemaVersion)}`,
    );
  }
  for (const field of ["widthMm", "heightMm", "fabricKind", "objects"]) {
    if (!(field in obj)) {
      throw new SerializeError("missing-field", `missing field: ${field}`);
    }
  }
  const profile = getFabricProfile(obj.fabricKind as FabricKind);
  if (!profile) {
    throw new SerializeError(
      "unknown-fabric",
      `unknown fabricKind: ${String(obj.fabricKind)}`,
    );
  }
  // overrides は profile を spread で上書き (underlayPolicy は関数のため保持)
  const overrides = (obj.fabricOverrides ?? {}) as Partial<typeof profile>;
  const mergedProfile = { ...profile, ...overrides };
  return {
    widthMm: obj.widthMm as number,
    heightMm: obj.heightMm as number,
    fabric: mergedProfile,
    objects: obj.objects as EmbroideryObject[],
  };
}
