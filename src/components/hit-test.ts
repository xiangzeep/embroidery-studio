// English note.
//
// English note.
// English note.
// English note.
// English note.
//
// English note.

import { pointInPolygon } from "@/lib/pipeline/vectorize";
import type { EmbroideryDesign, Point2D } from "@/lib/pipeline/types";

/**
 * English note.
 * English note.
 * English note.
 */
export function hitTestObject(
  design: EmbroideryDesign | null,
  point: Point2D,
): string | null {
  if (design === null) return null;
  let best: { id: string; order: number } | null = null;
  for (const obj of design.objects) {
    if (!pointInPolygon(point, obj.shape.outer)) continue;
    if (best === null || obj.order > best.order) {
      best = { id: obj.id, order: obj.order };
    }
  }
  return best?.id ?? null;
}
