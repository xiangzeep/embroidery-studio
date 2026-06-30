// design-store.ts - local design store state.
//
// English note.
// English note.
//   - selectedObjectId: string | null    selected object id
//   - editMode: "select" | "node" | "pen"
// English note.
// English note.
//
// English note.
// English note.

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { optimizeOrder } from "@/lib/pipeline/pathing";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  type History,
  pushHistory,
  redo as historyRedo,
  undo as historyUndo,
} from "@/lib/design/history";
import type { EmbroideryDesign, EmbroideryObject } from "@/lib/pipeline/types";

export type EditMode = "select" | "node" | "pen";

export type VisualizationFlags = {
  showTravel: boolean;
  showJump: boolean;
  showTrim: boolean;
  showStitchTypes: boolean;
};

export type DesignState = {
  design: EmbroideryDesign | null;
  selectedObjectId: string | null;
  editMode: EditMode;
  /** English note. */
  history: History | null;
  /** English note. */
  visualization: VisualizationFlags;
};

export type DesignActions = {
  setDesign: (design: EmbroideryDesign | null) => void;
  setSelectedObjectId: (id: string | null) => void;
  setEditMode: (mode: EditMode) => void;
  updateObject: (
    id: string,
    patch: Partial<Omit<EmbroideryObject, "id">>,
  ) => void;
  reorderObjects: (newOrder: string[]) => void;
  /** English note. */
  removeObject: (id: string) => void;
  /** English note. */
  applyOptimizeOrder: () => void;
  /** English note. */
  undo: () => void;
  /** English note. */
  redo: () => void;
  /** Controls local visualization overlays. */
  setVisualization: (patch: Partial<VisualizationFlags>) => void;
};

export type DesignStore = DesignState & DesignActions;

const initialState: DesignState = {
  design: null,
  selectedObjectId: null,
  editMode: "select",
  history: null,
  visualization: { showTravel: false, showJump: false, showTrim: false, showStitchTypes: false },
};

/**
 * English note.
 * English note.
 */
export const designStore = createStore<DesignStore>((set, get) => ({
  ...initialState,

  setDesign: (design) => {
    const prev = get();
    // English note.
    const stillExists =
      design !== null &&
      prev.selectedObjectId !== null &&
      design.objects.some((o) => o.id === prev.selectedObjectId);
    // English note.
    // English note.
    set({
      design,
      selectedObjectId: stillExists ? prev.selectedObjectId : null,
      history: design ? createHistory(design) : null,
    });
  },

  setSelectedObjectId: (id) => {
    if (id === null) {
      set({ selectedObjectId: null });
      return;
    }
    const { design } = get();
    if (design === null) return;
    if (!design.objects.some((o) => o.id === id)) return; // English note.
    set({ selectedObjectId: id });
  },

  setEditMode: (mode) => set({ editMode: mode }),

  updateObject: (id, patch) => {
    const { design, history } = get();
    if (design === null) return;
    const idx = design.objects.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const next = design.objects.slice();
    next[idx] = { ...next[idx], ...patch, id: next[idx].id };
    const nextDesign: EmbroideryDesign = { ...design, objects: next };
    set({
      design: nextDesign,
      history: history ? pushHistory(history, nextDesign) : createHistory(nextDesign),
    });
  },

  reorderObjects: (newOrder) => {
    const { design } = get();
    if (design === null) throw new Error("reorderObjects: design is null");
    const current = design.objects;
    if (newOrder.length !== current.length) {
      throw new Error(
        `reorderObjects: id array length ${newOrder.length} does not match design.objects.length ${current.length}`,
      );
    }
    const lookup = new Map(current.map((o) => [o.id, o] as const));
    for (const id of newOrder) {
      if (!lookup.has(id)) {
        throw new Error(`reorderObjects: unknown id '${id}'`);
      }
    }
    if (new Set(newOrder).size !== newOrder.length) {
      throw new Error("reorderObjects: newOrder contains duplicate ids");
    }
    const reordered = newOrder.map((id, i) => ({
      ...lookup.get(id)!,
      order: i,
    }));
    const nextDesign: EmbroideryDesign = { ...design, objects: reordered };
    const { history } = get();
    set({
      design: nextDesign,
      history: history ? pushHistory(history, nextDesign) : createHistory(nextDesign),
    });
  },

  removeObject: (id) => {
    const { design, selectedObjectId, history } = get();
    if (design === null) return;
    const next = design.objects.filter((o) => o.id !== id);
    if (next.length === design.objects.length) return; // English note.
    const nextDesign: EmbroideryDesign = { ...design, objects: next };
    set({
      design: nextDesign,
      selectedObjectId: selectedObjectId === id ? null : selectedObjectId,
      history: history ? pushHistory(history, nextDesign) : createHistory(nextDesign),
    });
  },

  applyOptimizeOrder: () => {
    const { design, history } = get();
    if (design === null) return;
    const nextDesign = optimizeOrder(design);
    set({
      design: nextDesign,
      history: history ? pushHistory(history, nextDesign) : createHistory(nextDesign),
    });
  },

  undo: () => {
    const { history } = get();
    if (!history || !historyCanUndo(history)) return;
    const next = historyUndo(history);
    set({ history: next, design: next.current });
  },

  redo: () => {
    const { history } = get();
    if (!history || !historyCanRedo(history)) return;
    const next = historyRedo(history);
    set({ history: next, design: next.current });
  },

  setVisualization: (patch) => {
    const { visualization } = get();
    set({ visualization: { ...visualization, ...patch } });
  },
}));

/** English note. */
export function useDesignStore<T>(selector: (state: DesignStore) => T): T {
  return useStore(designStore, selector);
}
