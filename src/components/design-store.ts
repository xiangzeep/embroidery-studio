// design-store.ts — Phase 5 PR20 design store。
//
// Zustand store として下記の state / action を提供する:
//   - design: EmbroideryDesign | null   現在編集中のデザイン
//   - selectedObjectId: string | null    選択中 object id
//   - editMode: "select" | "node" | "pen"
// 既存 embroidery-studio.tsx の useState ベース実装は破壊せず、Phase 5 後続 PR で
// 順次差し替える想定の並行導入。
//
// 純ロジック (React 非依存) は vanilla store (`zustand/vanilla`) で表現し、
// `useDesignStore` React hook も同 store を共有する。テストは vanilla 側で完結。

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
};

export type DesignState = {
  design: EmbroideryDesign | null;
  selectedObjectId: string | null;
  editMode: EditMode;
  /** Phase 5 PR24 undo/redo 用 history。design=null のとき null。 */
  history: History | null;
  /** Phase 5 PR24 travel/jump/trim 可視化トグル。 */
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
  /** 指定 id の object を削除。selectedObjectId が消えれば null にリセット。design=null は no-op。 */
  removeObject: (id: string) => void;
  /** Phase 3 PR14 の optimizeOrder を design に適用 (locked は元 order を保持)。design=null は no-op。 */
  applyOptimizeOrder: () => void;
  /** Phase 5 PR24 undo: history.past 末尾に戻る。past 空 / design=null は no-op。 */
  undo: () => void;
  /** Phase 5 PR24 redo: history.future 先頭に進む。future 空 / design=null は no-op。 */
  redo: () => void;
  /** Phase 5 PR24 visualization flag patch。 */
  setVisualization: (patch: Partial<VisualizationFlags>) => void;
};

export type DesignStore = DesignState & DesignActions;

const initialState: DesignState = {
  design: null,
  selectedObjectId: null,
  editMode: "select",
  history: null,
  visualization: { showTravel: false, showJump: false, showTrim: false },
};

/**
 * vanilla Zustand store。React 非依存。テストから直接 `getState` / `setState`
 * で操作可能。React からは `useDesignStore` 経由で購読する。
 */
export const designStore = createStore<DesignStore>((set, get) => ({
  ...initialState,

  setDesign: (design) => {
    const prev = get();
    // 選択中 id が新 design に存在しなければ null にリセット
    const stillExists =
      design !== null &&
      prev.selectedObjectId !== null &&
      design.objects.some((o) => o.id === prev.selectedObjectId);
    // setDesign は「初期化 / ファイル読込 / 大きな差し替え」の入口。
    // history は新規作成 (= 過去を捨てる)。
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
    if (!design.objects.some((o) => o.id === id)) return; // 不正 id は no-op
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
        `reorderObjects: id 配列長 ${newOrder.length} が design.objects.length ${current.length} と不一致`,
      );
    }
    const lookup = new Map(current.map((o) => [o.id, o] as const));
    for (const id of newOrder) {
      if (!lookup.has(id)) {
        throw new Error(`reorderObjects: unknown id '${id}'`);
      }
    }
    if (new Set(newOrder).size !== newOrder.length) {
      throw new Error("reorderObjects: newOrder に重複 id が含まれている");
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
    if (next.length === design.objects.length) return; // 不在 id は no-op
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

/** React 側 hook。state slice を selector で取り出す既存 Zustand 流儀に合わせる。 */
export function useDesignStore<T>(selector: (state: DesignStore) => T): T {
  return useStore(designStore, selector);
}
