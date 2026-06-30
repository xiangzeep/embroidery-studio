// sewing-order-helpers.ts — Phase 5 PR22 純ロジック。
//
// SewingOrderPanel の DnD onDragEnd 結果を「並び替え後の id 配列」に変換する
// ロジックを React 非依存の純関数として切り出し、design-store 経由でテスト
// する (RTL/jsdom 不要)。

import type { EmbroideryObject } from "@/lib/pipeline/types";

/**
 * objects を order 昇順でソートしたコピーを返す (純関数)。
 */
export function sortByOrder(objects: EmbroideryObject[]): EmbroideryObject[] {
  return objects.slice().sort((a, b) => a.order - b.order);
}

/**
 * dnd-kit の onDragEnd から得られる activeId / overId をもとに、
 * 現在の order 昇順配列を並び替えた id 配列を返す。
 * - activeId === overId なら配列を変更せず返す
 * - 不正 id (現在の objects に無い) の場合は throw
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
