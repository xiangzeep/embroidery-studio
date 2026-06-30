import type { EmbroideryObject, ObjectLayerKind } from "./types";

export type LayerObjectGroup = {
  layer: ObjectLayerKind;
  objects: EmbroideryObject[];
};

const LAYER_ORDER: ObjectLayerKind[] = [
  "base-fill",
  "detail",
  "outline",
  "highlight",
  "background",
  "noise",
];

export function layerOrderRank(layer: ObjectLayerKind | undefined): number {
  const index = LAYER_ORDER.indexOf(layer ?? "detail");
  return index === -1 ? LAYER_ORDER.indexOf("detail") : index;
}

export function groupObjectsByLayerOrder(objects: EmbroideryObject[]): LayerObjectGroup[] {
  const sortedLayers = [...new Set(objects.map((object) => object.layer ?? "detail"))]
    .sort((a, b) => layerOrderRank(a) - layerOrderRank(b));
  return sortedLayers.map((layer) => ({
    layer,
    objects: objects
      .filter((object) => (object.layer ?? "detail") === layer)
      .sort((a, b) => a.colorIndex - b.colorIndex || a.order - b.order),
  }));
}
