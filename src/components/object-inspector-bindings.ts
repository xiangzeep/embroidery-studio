// English note.
//
// English note.
// English note.
// English note.

import type {
  EmbroideryObject,
  ObjectKind,
  ObjectProps,
  StrokeOverride,
  UnderlayConfig,
} from "@/lib/pipeline/types";
import type { ConversionConfig } from "@/lib/pipeline/config";
import { resolveObjectKindForStroke } from "@/lib/pipeline/stroke-classifier";

/** English note. */
export function applyKindChange(
  kind: ObjectKind,
): Partial<Omit<EmbroideryObject, "id">> {
  return { kind };
}

/** English note. */
export function applyPropsChange(
  object: EmbroideryObject,
  patch: Partial<ObjectProps>,
): Partial<Omit<EmbroideryObject, "id">> {
  return { props: { ...object.props, ...patch } };
}

/**
 * English note.
 * English note.
 * English note.
 */
export function applyUnderlayKindChange(
  object: EmbroideryObject,
  kind: UnderlayConfig["kind"],
): Partial<Omit<EmbroideryObject, "id">> {
  const existing = object.props.underlay;
  const next = buildUnderlay(kind, existing);
  return { props: { ...object.props, underlay: next } };
}

export function applyStrokeOverrideChange(
  object: EmbroideryObject,
  strokeOverride: StrokeOverride,
  config: ConversionConfig,
): Partial<Omit<EmbroideryObject, "id">> {
  return {
    kind: resolveObjectKindForStroke(
      object.baseKind ?? object.kind,
      object.strokeKind ?? "none",
      object.strokeRole ?? "none",
      config.digitizingMode,
      config.outlineFontStrategy,
      strokeOverride,
    ),
    strokeOverride,
  };
}

function buildUnderlay(
  kind: UnderlayConfig["kind"],
  existing: UnderlayConfig | undefined,
): UnderlayConfig {
  if (existing && existing.kind === kind) return existing;
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "edge-run":
      return { kind: "edge-run", insetMm: 0.3, stitchLenMm: 2.0 };
    case "center-run":
      return { kind: "center-run", stitchLenMm: 2.0 };
    case "zigzag":
      return { kind: "zigzag", spacingMm: 1.5, insetMm: 0.3 };
    case "fill":
      return { kind: "fill", angleDeg: 0, spacingMm: 2.5 };
  }
}
