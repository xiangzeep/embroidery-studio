import type { LayerKind } from "./layers";
import type { ObjectKind, UnderlayConfig } from "./types";

export type LayerStitchPolicyInput = {
  layer: LayerKind;
  objectKind: ObjectKind;
  defaultUnderlay?: UnderlayConfig;
};

export type LayerStitchPolicy = {
  renderable: boolean;
  underlay?: UnderlayConfig;
  lockstitch: boolean;
};

export function resolveLayerStitchPolicy(input: LayerStitchPolicyInput): LayerStitchPolicy {
  if (input.layer === "background" || input.layer === "noise") {
    return {
      renderable: false,
      underlay: { kind: "none" },
      lockstitch: false,
    };
  }

  if (
    input.layer === "outline" ||
    input.layer === "detail" ||
    input.layer === "highlight"
  ) {
    return {
      renderable: true,
      underlay: { kind: "none" },
      lockstitch: false,
    };
  }

  return {
    renderable: true,
    underlay: input.defaultUnderlay,
    lockstitch: true,
  };
}
