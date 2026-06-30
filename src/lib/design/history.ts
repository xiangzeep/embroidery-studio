// history.ts — Phase 5 PR24 Undo / Redo 純データ構造。
//
// past / current / future の 3 リストで history stack を表現する。すべての
// 状態遷移は純関数で表現し、入力 History は破壊しない (immer の produce で
// 新オブジェクトを作る)。
//
// past は古い順 (末尾が直近)、future は redo 順 (先頭が次の redo 対象)。

import { produce } from "immer";
import type { EmbroideryDesign } from "@/lib/pipeline/types";

export const MAX_HISTORY = 20;

export type History = {
  past: EmbroideryDesign[];
  current: EmbroideryDesign;
  future: EmbroideryDesign[];
};

export function createHistory(initial: EmbroideryDesign): History {
  return { past: [], current: initial, future: [] };
}

/**
 * 新しい design を current に置き、旧 current を past 末尾に積む。
 * future はクリア (分岐放棄)、past が MAX_HISTORY 超過なら先頭から捨てる。
 */
export function pushHistory(
  h: History,
  next: EmbroideryDesign,
): History {
  return produce(h, (draft) => {
    draft.past.push(draft.current);
    if (draft.past.length > MAX_HISTORY) draft.past.shift();
    draft.current = next;
    draft.future = [];
  });
}

/** past 末尾を current に戻し、旧 current を future 先頭に積む。past 空なら不変。 */
export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return produce(h, (draft) => {
    const prev = draft.past.pop()!;
    draft.future.unshift(draft.current);
    draft.current = prev;
  });
}

/** future 先頭を current に進め、旧 current を past 末尾に積む。future 空なら不変。 */
export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return produce(h, (draft) => {
    const next = draft.future.shift()!;
    draft.past.push(draft.current);
    draft.current = next;
  });
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}
