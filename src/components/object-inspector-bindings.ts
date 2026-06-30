// object-inspector-bindings.ts — Phase 5 PR21 純ロジック (patch ビルダ)。
//
// ObjectInspector の各コントロールが updateObject(id, patch) に渡す patch
// を構築する関数群。React 非依存の純関数として切り出し、design-store 経由で
// テストする (RTL 不要)。

import type {
  EmbroideryObject,
  ObjectKind,
  ObjectProps,
  UnderlayConfig,
} from "@/lib/pipeline/types";

/** kind 変更パッチ (props は維持) */
export function applyKindChange(
  kind: ObjectKind,
): Partial<Omit<EmbroideryObject, "id">> {
  return { kind };
}

/** props サブセット merge パッチ (object.props を base に shallow merge) */
export function applyPropsChange(
  object: EmbroideryObject,
  patch: Partial<ObjectProps>,
): Partial<Omit<EmbroideryObject, "id">> {
  return { props: { ...object.props, ...patch } };
}

/**
 * underlay.kind 変更パッチ。kind 切替で必要パラメータ (insetMm / stitchLenMm /
 * spacingMm / angleDeg) のデフォルト値を補う。
 * 既存 props.underlay が同じ kind の場合は値を維持する。
 */
export function applyUnderlayKindChange(
  object: EmbroideryObject,
  kind: UnderlayConfig["kind"],
): Partial<Omit<EmbroideryObject, "id">> {
  const existing = object.props.underlay;
  const next = buildUnderlay(kind, existing);
  return { props: { ...object.props, underlay: next } };
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
