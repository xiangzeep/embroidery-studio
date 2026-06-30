// English note.
//
// English note.
// English note.
// English note.
//
// English note.

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
 * English note.
 * English note.
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

/** English note. */
export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return produce(h, (draft) => {
    const prev = draft.past.pop()!;
    draft.future.unshift(draft.current);
    draft.current = prev;
  });
}

/** English note. */
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
