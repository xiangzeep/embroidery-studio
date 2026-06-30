// English note.
//
// English note.
// English note.
// English note.

import type { EmbroideryObject } from "@/lib/pipeline/types";

/**
 * English note.
 */
export function sortByOrder(objects: EmbroideryObject[]): EmbroideryObject[] {
  return objects.slice().sort((a, b) => a.order - b.order);
}

/**
 * English note.
 * English note.
 * English note.
 * English note.
 */
export function reorderByDrag(
  objects: EmbroideryObject[],
  activeId: string,
  overId: string,
): string[] {
  const sorted = sortByOrder(objects);
  const ids = sorted.map((o) => o.id);
  if (activeId === overId) return ids;
  const fromIdx = ids.indexOf(activeId);
  const toIdx = ids.indexOf(overId);
  if (fromIdx === -1) throw new Error(`reorderByDrag: unknown activeId '${activeId}'`);
  if (toIdx === -1) throw new Error(`reorderByDrag: unknown overId '${overId}'`);
  const next = ids.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}
