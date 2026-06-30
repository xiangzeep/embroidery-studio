# Phase 5 PR1: design store + 選択基盤 — TDD 計画

## 1. 概要

Phase 5 計画書「10. 実装ステップ」のステップ 1〜2 を実装する。具体的には:

1. **`src/components/design-store.ts` を新規作成** し、Zustand store として `design: EmbroideryDesign | null` / `selectedObjectId: string | null` / `editMode: "select" | "node" | "pen"` の 3 つの state と、`setDesign` / `setSelectedObjectId` / `setEditMode` / `updateObject(id, patch)` / `reorderObjects(newOrder)` の 5 つの action を提供する。
2. **`src/components/preview-canvas-editable.tsx` を新規作成** し、既存の `stitch-preview.tsx` の `StitchCanvas` を内部利用しつつ、object クリックで選択 (`selectedObjectId` を store に保存) + 選択中 object の外形ハイライト描画を追加する。クリック判定は **point-in-polygon (`EmbroideryObject.shape.outer` に対する ray casting)**。
3. **`zustand` を新規導入** する (`package.json` に追加)。既存の `embroidery-studio.tsx` の `useState` ベース実装は **破壊せず**、本 PR では新 store を**並行導入** するに留める (実画面の置き換えは後続 PR)。

本 PR は **store のロジック** と **プレビュー上の選択 UX 基盤** の 2 点に絞る。Object Inspector / Sewing Order / リアルタイム再生成 / ノード編集 / undo-redo はすべて後続 PR (ステップ 3 以降) に回す。

## 2. 依存関係

- **Phase 1 全体 (完了)**: `EmbroideryDesign`, `EmbroideryObject`, `Shape`, `Polygon` 型の存在を前提とする。本 PR では型のみ参照する。`EmbroideryDesign` が `{ widthMm, heightMm, objects: EmbroideryObject[], format, ... }` 形式、`EmbroideryObject` が `{ id, kind, shape, props, order, locked?, hidden? }` 形式である想定で進める。実型に差分があれば Cycle 1 着手時に store 側で `EmbroideryDesign` を import し直すだけで吸収できる粒度に留める。
- **Phase 2, 3, 4 (完了)**: 本 PR は stitch quality を変えないため直接の依存は無いが、マージ順は Phase 4 以降に置く (`renderStitches` が後続 PR で store と結線されるため)。
- **既存コンポーネント**: `src/components/stitch-preview.tsx`, `stitch-preview-3d.tsx`, `embroidery-studio.tsx` は **本 PR では編集しない**。`stitch-preview.tsx` の内部関数 (`StitchCanvas`) は **コピーまたは share extraction** で再利用するが、export を増やす最小限の変更に留める。
- **新規依存**: `zustand` (^5.x、MIT)。`package.json` に `dependencies` として追加。

## 3. 影響ファイル

### 新規

- `src/components/design-store.ts` — Zustand store 本体。型 `DesignState` / `DesignActions` を export。
- `src/components/__tests__/design-store.test.ts` — Vitest テスト (純ロジックなので Node 環境で動く)。
- `src/components/preview-canvas-editable.tsx` — 編集対応プレビュー。クリック選択 + 選択ハイライト。
- `src/components/__tests__/preview-canvas-editable.test.ts` — ヒットテスト (point-in-polygon) の純関数を対象にした unit test。`React` レンダリングを伴うテストは本 PR では行わず、ヒットテスト関数 (`hitTestObject(design, point)`) を export して単体で検証する。

### 編集

- `package.json` — `dependencies` に `"zustand": "^5.0.0"` を追加。
- `src/components/stitch-preview.tsx` — **エクスポート追加のみ**。既存 `StitchCanvas` を `preview-canvas-editable.tsx` から再利用するため `export function StitchCanvas` に切り出す (内部実装は触らない)。表示挙動は不変。

### 参照のみ

- `src/lib/pipeline/types.ts` — `Shape`, `Polygon` 型。
- `src/lib/design/*` (Phase 1 で導入済み想定) — `EmbroideryDesign`, `EmbroideryObject` 型。実パスが異なる場合は `import type { EmbroideryDesign } from "@/lib/...";` のパスのみを Cycle 1 着手時に確定する。

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **環境**: `vitest.config.ts` は `environment: "node"`。Zustand は Node でも動くため store テストはこのままで OK。React コンポーネントの DOM レンダリングは本 PR ではテスト対象としない (ヒットテストの純関数のみテストする)。
- **実行コマンド**:
  - 単発: `npx vitest run src/components/__tests__/design-store.test.ts`
  - 関連: `npx vitest run src/components/__tests__/`
  - 全件: `npx vitest run`
  - 型チェック: `npx tsc --noEmit`
- **テストファイル配置**: `src/components/__tests__/*.test.ts`
- **Zustand のテスト戦略**: vanilla store (`createStore` from `zustand/vanilla`) を内部で使い、`useStore` を React 用に薄く wrap する。テストは vanilla 側 (`getState` / `setState` / subscribe) で完結させ、React 側のレンダリングは触らない。

## 5. インターフェース設計

### 5.1 `design-store.ts` の公開 API

```ts
// src/components/design-store.ts
import { create } from "zustand";
import type { EmbroideryDesign, EmbroideryObject } from "@/lib/design/types";
// ↑ 実パスは Phase 1 のものを参照。本 PR 着手時に確認。

export type EditMode = "select" | "node" | "pen";

export type DesignState = {
  design: EmbroideryDesign | null;
  selectedObjectId: string | null;
  editMode: EditMode;
};

export type DesignActions = {
  /** design 全体を差し替える。差し替え時に selectedObjectId が指す object が無ければ null にリセット。 */
  setDesign: (design: EmbroideryDesign | null) => void;

  /**
   * 選択中 object id をセット。editMode === "select" 以外でも値は保持する (move 中などで再選択可能)。
   * 引数が現 design に存在しない id なら何もしない (no-op)。
   */
  setSelectedObjectId: (id: string | null) => void;

  setEditMode: (mode: EditMode) => void;

  /**
   * 指定 id の object を **shallow merge** で更新する。
   * - design が null なら no-op
   * - 該当 id が無ければ no-op
   * - id 自体は patch で変更できない (型で除外)
   * - 他の object は参照を保つ (React の再レンダリング最小化のため)
   */
  updateObject: (
    id: string,
    patch: Partial<Omit<EmbroideryObject, "id">>,
  ) => void;

  /**
   * objects の順序を `newOrder` の id 配列で並べ替える。
   * - newOrder の id 集合が現 design の id 集合と完全一致しない場合は throw (テストで明示)
   * - 並べ替えと同時に各 object の `order` フィールドを 0..n-1 で再採番
   * - design が null なら throw
   */
  reorderObjects: (newOrder: string[]) => void;
};

export type DesignStore = DesignState & DesignActions;

/** React フック。コンポーネントから直接サブスクライブする。 */
export const useDesignStore: import("zustand").UseBoundStore<
  import("zustand").StoreApi<DesignStore>
>;

/**
 * 非 React 文脈 / テスト用。getState / setState / subscribe を直接叩く。
 * `useDesignStore.getState()` でも同じものが取れる。
 */
export const designStore: import("zustand").StoreApi<DesignStore>;
```

初期 state:

```ts
const initial: DesignState = {
  design: null,
  selectedObjectId: null,
  editMode: "select",
};
```

### 5.2 `preview-canvas-editable.tsx` の公開 API

```ts
// src/components/preview-canvas-editable.tsx
import type { StitchPattern } from "@/lib/pipeline/types";
import type { EmbroideryDesign, EmbroideryObject } from "@/lib/design/types";

export type PreviewCanvasEditableProps = {
  /** stitch を描画するためのパターン (任意。null なら背景のみ) */
  pattern: StitchPattern | null;
  /** クリックヒットテスト用の design (任意。null なら選択不可) */
  design: EmbroideryDesign | null;
};

export function PreviewCanvasEditable(props: PreviewCanvasEditableProps): JSX.Element;

/**
 * 純関数: design 上の (xMm, yMm) クリック点に対して最前面の object を返す。
 * - design.objects を `order` の降順 (= 後に縫う = 上に重なる) で走査
 * - 各 object の `shape.outer` に対して ray-casting point-in-polygon
 * - hidden = true の object は無視
 * - locked = true の object は **無視しない** (選択は可能。編集側で別途扱う)
 * - 該当無しなら null
 */
export function hitTestObject(
  design: EmbroideryDesign,
  point: [number, number],
): EmbroideryObject | null;
```

クリック時の挙動:

```ts
const handleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
  if (!design) return;
  const rect = ev.currentTarget.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  const xMm = px / scale;
  const yMm = py / scale;
  const hit = hitTestObject(design, [xMm, yMm]);
  designStore.getState().setSelectedObjectId(hit?.id ?? null);
};
```

ハイライト描画は `useDesignStore((s) => s.selectedObjectId)` を購読し、該当 object の `shape.outer` を `ctx.strokeStyle = "#3b82f6"`, `ctx.lineWidth = 1.5 / scale` で描画する (2D canvas の最終レイヤとして addStrokeOuter)。

### 5.3 ファイル構成

- 新規: `src/components/design-store.ts`
- 新規: `src/components/preview-canvas-editable.tsx`
- 新規: `src/components/__tests__/design-store.test.ts`
- 新規: `src/components/__tests__/preview-canvas-editable.test.ts`
- 編集: `src/components/stitch-preview.tsx` (`StitchCanvas` を export するだけ)
- 編集: `package.json` (zustand 追加)
- 編集: `package-lock.json` (npm install による自動更新)

## 6. TDD サイクル

### Cycle 1: 初期 state と `setDesign` — store の骨格

#### Red — 失敗するテスト

```ts
// src/components/__tests__/design-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { designStore } from "../design-store";
import type { EmbroideryDesign } from "@/lib/design/types";

function makeDesign(): EmbroideryDesign {
  return {
    widthMm: 100,
    heightMm: 100,
    format: "dst",
    objects: [
      { id: "o1", kind: "fill", shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] }, props: {}, order: 0 },
      { id: "o2", kind: "satin", shape: { outer: [[20, 0], [30, 0], [30, 10], [20, 10]], holes: [] }, props: {}, order: 1 },
    ],
  } as EmbroideryDesign;
}

describe("designStore (initial state)", () => {
  beforeEach(() => {
    designStore.setState({ design: null, selectedObjectId: null, editMode: "select" });
  });

  it("starts with design=null, selectedObjectId=null, editMode='select'", () => {
    const s = designStore.getState();
    expect(s.design).toBeNull();
    expect(s.selectedObjectId).toBeNull();
    expect(s.editMode).toBe("select");
  });

  it("setDesign replaces the design", () => {
    const d = makeDesign();
    designStore.getState().setDesign(d);
    expect(designStore.getState().design).toBe(d);
  });

  it("setDesign(null) resets selectedObjectId to null", () => {
    designStore.setState({ design: makeDesign(), selectedObjectId: "o1", editMode: "select" });
    designStore.getState().setDesign(null);
    expect(designStore.getState().selectedObjectId).toBeNull();
  });

  it("setDesign keeps selectedObjectId when the id still exists in the new design", () => {
    const d1 = makeDesign();
    designStore.setState({ design: d1, selectedObjectId: "o2", editMode: "select" });
    const d2 = makeDesign(); // 同じ id 構成
    designStore.getState().setDesign(d2);
    expect(designStore.getState().selectedObjectId).toBe("o2");
  });

  it("setDesign clears selectedObjectId when the id no longer exists", () => {
    designStore.setState({ design: makeDesign(), selectedObjectId: "o1", editMode: "select" });
    const d2: EmbroideryDesign = { ...makeDesign(), objects: [{ id: "X", kind: "fill", shape: { outer: [[0,0],[1,0],[1,1]], holes: [] }, props: {}, order: 0 }] };
    designStore.getState().setDesign(d2);
    expect(designStore.getState().selectedObjectId).toBeNull();
  });
});
```

失敗理由:
- `src/components/design-store.ts` が未作成 → ModuleNotFound
- `zustand` がまだ `package.json` に無ければ install 必要

#### Green — 最小実装

- 変更: `package.json` に `"zustand": "^5.0.0"` を追加し `npm install`
- 変更: `src/components/design-store.ts` を新規作成
- 方針:
  1. `import { create } from "zustand"`
  2. `create<DesignStore>()((set, get) => ({ design: null, selectedObjectId: null, editMode: "select", setDesign: (d) => set((s) => ({ design: d, selectedObjectId: shouldKeep(s.selectedObjectId, d) ? s.selectedObjectId : null })), /* 他はまだ throw or noop で OK */ }))` を export
  3. `shouldKeep(id, design)` は `design?.objects.some((o) => o.id === id) ?? false`
  4. `designStore` は `useDesignStore` の internal vanilla store: `export const designStore = useDesignStore` で代用 (zustand v5 は store 自体が `getState / setState / subscribe` を持つ)。テスト側は `designStore.getState()` で読み書きする
  5. Cycle 1 では `setSelectedObjectId / setEditMode / updateObject / reorderObjects` はとりあえず空関数 (本サイクルではテスト無し)

#### Refactor

- 最初のサイクルのため不要

---

### Cycle 2: `setSelectedObjectId` と `setEditMode` — 選択モード周辺

#### Red — 失敗するテスト

```ts
// src/components/__tests__/design-store.test.ts (追記)
describe("setSelectedObjectId", () => {
  beforeEach(() => {
    designStore.setState({ design: makeDesign(), selectedObjectId: null, editMode: "select" });
  });

  it("sets the selected id when it exists in the design", () => {
    designStore.getState().setSelectedObjectId("o1");
    expect(designStore.getState().selectedObjectId).toBe("o1");
  });

  it("ignores unknown ids (no-op)", () => {
    designStore.getState().setSelectedObjectId("ghost");
    expect(designStore.getState().selectedObjectId).toBeNull();
  });

  it("accepts null to clear selection regardless of design", () => {
    designStore.setState({ design: makeDesign(), selectedObjectId: "o1", editMode: "select" });
    designStore.getState().setSelectedObjectId(null);
    expect(designStore.getState().selectedObjectId).toBeNull();
  });

  it("ignores any id when design is null", () => {
    designStore.setState({ design: null, selectedObjectId: null, editMode: "select" });
    designStore.getState().setSelectedObjectId("o1");
    expect(designStore.getState().selectedObjectId).toBeNull();
  });
});

describe("setEditMode", () => {
  beforeEach(() => {
    designStore.setState({ design: makeDesign(), selectedObjectId: "o1", editMode: "select" });
  });

  it("switches mode to node / pen / select", () => {
    designStore.getState().setEditMode("node");
    expect(designStore.getState().editMode).toBe("node");
    designStore.getState().setEditMode("pen");
    expect(designStore.getState().editMode).toBe("pen");
    designStore.getState().setEditMode("select");
    expect(designStore.getState().editMode).toBe("select");
  });

  it("preserves selectedObjectId across mode changes", () => {
    designStore.getState().setEditMode("node");
    expect(designStore.getState().selectedObjectId).toBe("o1");
  });
});
```

失敗理由: `setSelectedObjectId` / `setEditMode` がまだ空関数で、状態が更新されない

#### Green — 最小実装

- 変更: `src/components/design-store.ts`
- 方針:
  1. `setSelectedObjectId: (id) => set((s) => { if (id === null) return { selectedObjectId: null }; if (!s.design) return {}; return s.design.objects.some((o) => o.id === id) ? { selectedObjectId: id } : {}; })`
  2. `setEditMode: (mode) => set({ editMode: mode })`

#### Refactor

- `shouldKeep` (Cycle 1) と `existsId` (Cycle 2) を共通の `hasObjectId(design, id)` ヘルパに統合

---

### Cycle 3: `updateObject` — 単一 object の shallow merge

#### Red — 失敗するテスト

```ts
// src/components/__tests__/design-store.test.ts (追記)
describe("updateObject", () => {
  beforeEach(() => {
    designStore.setState({ design: makeDesign(), selectedObjectId: null, editMode: "select" });
  });

  it("merges patch into the target object only", () => {
    designStore.getState().updateObject("o1", { kind: "satin" });
    const d = designStore.getState().design!;
    const o1 = d.objects.find((o) => o.id === "o1")!;
    const o2 = d.objects.find((o) => o.id === "o2")!;
    expect(o1.kind).toBe("satin");
    expect(o2.kind).toBe("satin"); // 元から satin (makeDesign の定義)
    // 他フィールドは保持
    expect(o1.order).toBe(0);
    expect(o1.shape.outer).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });

  it("keeps references of untouched objects (for React re-render minimisation)", () => {
    const before = designStore.getState().design!;
    const o2Before = before.objects.find((o) => o.id === "o2")!;
    designStore.getState().updateObject("o1", { kind: "run" });
    const after = designStore.getState().design!;
    const o2After = after.objects.find((o) => o.id === "o2")!;
    expect(o2After).toBe(o2Before); // same reference
    // design root / objects array は新規参照
    expect(after).not.toBe(before);
    expect(after.objects).not.toBe(before.objects);
  });

  it("is a no-op when design is null", () => {
    designStore.setState({ design: null, selectedObjectId: null, editMode: "select" });
    designStore.getState().updateObject("o1", { kind: "fill" });
    expect(designStore.getState().design).toBeNull();
  });

  it("is a no-op when the id does not exist", () => {
    const before = designStore.getState().design!;
    designStore.getState().updateObject("ghost", { kind: "fill" });
    const after = designStore.getState().design!;
    // 完全に同じ参照を返す (state 変更なし)
    expect(after).toBe(before);
  });
});
```

失敗理由: `updateObject` が未実装で state が変わらない、または参照が変わってしまう

#### Green — 最小実装

- 変更: `src/components/design-store.ts`
- 方針:
  1. `updateObject: (id, patch) => set((s) => { if (!s.design) return {}; const idx = s.design.objects.findIndex((o) => o.id === id); if (idx < 0) return {}; const next = [...s.design.objects]; next[idx] = { ...next[idx], ...patch }; return { design: { ...s.design, objects: next } }; })`
  2. 「no-op で同じ参照を返す」テストのため、見つからなければ `set` を呼ばない (空 object を返すと Zustand は state を変えないので参照保持される。v5 で動作確認)

#### Refactor

- shallow merge 部分を `replaceObjectAt(design, idx, patch)` ヘルパに抽出 (次サイクルの reorder で再利用)

---

### Cycle 4: `reorderObjects` — 並び替え + order 再採番

#### Red — 失敗するテスト

```ts
// src/components/__tests__/design-store.test.ts (追記)
describe("reorderObjects", () => {
  beforeEach(() => {
    // 3 個に拡張
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill",  shape: { outer: [[0,0],[1,0],[1,1]], holes: [] }, props: {}, order: 0 },
        { id: "b", kind: "satin", shape: { outer: [[2,0],[3,0],[3,1]], holes: [] }, props: {}, order: 1 },
        { id: "c", kind: "run",   shape: { outer: [[4,0],[5,0],[5,1]], holes: [] }, props: {}, order: 2 },
      ],
    } as EmbroideryDesign;
    designStore.setState({ design: d, selectedObjectId: null, editMode: "select" });
  });

  it("reorders objects to match newOrder and renumbers .order from 0", () => {
    designStore.getState().reorderObjects(["c", "a", "b"]);
    const d = designStore.getState().design!;
    expect(d.objects.map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(d.objects.map((o) => o.order)).toEqual([0, 1, 2]);
  });

  it("throws when newOrder length differs from current objects", () => {
    expect(() => designStore.getState().reorderObjects(["a", "b"])).toThrow();
  });

  it("throws when newOrder contains unknown ids", () => {
    expect(() => designStore.getState().reorderObjects(["a", "b", "X"])).toThrow();
  });

  it("throws when newOrder contains duplicates", () => {
    expect(() => designStore.getState().reorderObjects(["a", "a", "b"])).toThrow();
  });

  it("throws when design is null", () => {
    designStore.setState({ design: null, selectedObjectId: null, editMode: "select" });
    expect(() => designStore.getState().reorderObjects([])).toThrow();
  });
});
```

失敗理由: `reorderObjects` が未実装

#### Green — 最小実装

- 変更: `src/components/design-store.ts`
- 方針:
  1. design null チェック → throw
  2. 集合一致チェック: `newOrder.length === objects.length && new Set(newOrder).size === newOrder.length && newOrder.every((id) => objects.some((o) => o.id === id))` を満たさなければ throw
  3. `const map = new Map(objects.map((o) => [o.id, o]))` を作り、`newOrder.map((id, i) => ({ ...map.get(id)!, order: i }))` で並べ替え
  4. `set({ design: { ...design, objects: newObjects } })`

#### Refactor

- バリデーションエラーを `class ReorderError extends Error` で型付け (オプション。本 PR では `throw new Error(message)` で十分)
- `Cycle 3` の `replaceObjectAt` と本サイクルの並び替えで共通する「`design` を不変更新するヘルパ」を `updateDesign(design, transform)` に抽出

---

### Cycle 5: `hitTestObject` — point-in-polygon と order 降順

#### Red — 失敗するテスト

```ts
// src/components/__tests__/preview-canvas-editable.test.ts
import { describe, it, expect } from "vitest";
import { hitTestObject } from "../preview-canvas-editable";
import type { EmbroideryDesign } from "@/lib/design/types";

function rectShape(x: number, y: number, w: number, h: number) {
  return { outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][], holes: [] };
}

describe("hitTestObject", () => {
  it("returns null when no object contains the point", () => {
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: rectShape(0, 0, 10, 10), props: {}, order: 0 },
      ],
    } as EmbroideryDesign;
    expect(hitTestObject(d, [50, 50])).toBeNull();
  });

  it("returns the only matching object", () => {
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: rectShape(0, 0, 10, 10), props: {}, order: 0 },
      ],
    } as EmbroideryDesign;
    const hit = hitTestObject(d, [5, 5]);
    expect(hit?.id).toBe("a");
  });

  it("prefers the topmost (highest order) object when overlapping", () => {
    // 完全重なり: a (order=0, 下) と b (order=1, 上)
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: rectShape(0, 0, 20, 20), props: {}, order: 0 },
        { id: "b", kind: "fill", shape: rectShape(5, 5, 10, 10), props: {}, order: 1 },
      ],
    } as EmbroideryDesign;
    expect(hitTestObject(d, [10, 10])?.id).toBe("b");
    // b の外側で a の内側
    expect(hitTestObject(d, [2, 2])?.id).toBe("a");
  });

  it("skips hidden objects", () => {
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: rectShape(0, 0, 10, 10), props: {}, order: 0, hidden: true },
      ],
    } as EmbroideryDesign;
    expect(hitTestObject(d, [5, 5])).toBeNull();
  });

  it("does NOT skip locked objects (selection is still allowed)", () => {
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: rectShape(0, 0, 10, 10), props: {}, order: 0, locked: true },
      ],
    } as EmbroideryDesign;
    expect(hitTestObject(d, [5, 5])?.id).toBe("a");
  });

  it("treats edge points consistently (no double-hit on shared edge)", () => {
    // 隣接する 2 つの矩形が x=10 を共有
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: rectShape(0, 0, 10, 10), props: {}, order: 0 },
        { id: "b", kind: "fill", shape: rectShape(10, 0, 10, 10), props: {}, order: 1 },
      ],
    } as EmbroideryDesign;
    // 境界 x=10 上の点はどちらかには必ず属する (両方には属さない)
    const hit = hitTestObject(d, [10, 5]);
    expect(hit).not.toBeNull();
  });
});
```

失敗理由: `preview-canvas-editable.tsx` が未作成。`hitTestObject` シンボル解決できず ModuleNotFound

#### Green — 最小実装

- 変更: `src/components/preview-canvas-editable.tsx` (新規)
- 方針:
  1. ファイル冒頭で `"use client"` を宣言
  2. `pointInPolygon(point: [number, number], polygon: [number, number][])` を ray casting で実装 (`stitch.ts` の同関数を真似る。`rasterizeShape` の解説と同等)
  3. `hitTestObject(design, point)`:
     ```ts
     const visible = design.objects.filter((o) => !o.hidden);
     const sorted = [...visible].sort((a, b) => b.order - a.order);
     for (const obj of sorted) {
       if (pointInPolygon(point, obj.shape.outer)) return obj;
     }
     return null;
     ```
  4. holes は本 PR では考慮しない (Phase 5 計画書 5.1 の v1 仕様)。穴があるドーナツ形でも穴の中で hit する可能性は残るが、後続 PR の改善余地としてコメント
  5. `PreviewCanvasEditable` 本体はまだ Cycle 6 で実装するため、本サイクルでは関数のみ export しておく (空の TSX を返すスタブでも可)

#### Refactor

- `pointInPolygon` を `src/lib/geometry/point-in-polygon.ts` に切り出すかどうかは Phase 5 PR2 以降の判断とし、本 PR では `preview-canvas-editable.tsx` 内に閉じる
- `Cycle 5` 完了時点で `design-store.test.ts` (Cycle 1〜4) と `preview-canvas-editable.test.ts` の両方が green

---

### Cycle 6: store と Canvas の結線 — クリックで `selectedObjectId` が更新される

#### Red — 失敗するテスト

```ts
// src/components/__tests__/preview-canvas-editable.test.ts (追記)
import { designStore } from "../design-store";

describe("hit test → store integration (pure logic)", () => {
  it("clicking inside an object sets selectedObjectId in the store", () => {
    // canvas を直接レンダリングはせず、クリックハンドラ相当の関数を export して呼ぶ
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] }, props: {}, order: 0 },
      ],
    } as EmbroideryDesign;
    designStore.setState({ design: d, selectedObjectId: null, editMode: "select" });

    // クリックハンドラ相当: 内部で hitTestObject + designStore.setSelectedObjectId を呼ぶ
    handleCanvasClickAtMm([5, 5]);  // preview-canvas-editable から export

    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("clicking outside any object clears selectedObjectId", () => {
    const d: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] }, props: {}, order: 0 },
      ],
    } as EmbroideryDesign;
    designStore.setState({ design: d, selectedObjectId: "a", editMode: "select" });

    handleCanvasClickAtMm([50, 50]);
    expect(designStore.getState().selectedObjectId).toBeNull();
  });

  it("hit testing uses the live design from the store", () => {
    // store 上の design が差し替わると次のクリックは新しい design を見る
    const d1: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "a", kind: "fill", shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] }, props: {}, order: 0 },
      ],
    } as EmbroideryDesign;
    const d2: EmbroideryDesign = {
      widthMm: 100, heightMm: 100, format: "dst",
      objects: [
        { id: "b", kind: "fill", shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] }, props: {}, order: 0 },
      ],
    } as EmbroideryDesign;
    designStore.setState({ design: d1, selectedObjectId: null, editMode: "select" });
    handleCanvasClickAtMm([5, 5]);
    expect(designStore.getState().selectedObjectId).toBe("a");

    designStore.getState().setDesign(d2);
    handleCanvasClickAtMm([5, 5]);
    expect(designStore.getState().selectedObjectId).toBe("b");
  });
});

// import 部に追記:
import { handleCanvasClickAtMm } from "../preview-canvas-editable";
```

失敗理由: `handleCanvasClickAtMm` が未 export、または store との結線が未実装

#### Green — 最小実装

- 変更: `src/components/preview-canvas-editable.tsx`
- 方針:
  1. `export function handleCanvasClickAtMm(pointMm: [number, number]): void` を追加 (純関数として store を直接叩く)
     ```ts
     export function handleCanvasClickAtMm(pointMm: [number, number]) {
       const { design, setSelectedObjectId } = designStore.getState();
       if (!design) return;
       const hit = hitTestObject(design, pointMm);
       setSelectedObjectId(hit?.id ?? null);
     }
     ```
  2. `PreviewCanvasEditable` 内で `onClick={(ev) => handleCanvasClickAtMm(toMm(ev))}` を canvas に渡す。`toMm` は canvas BCR と scale から計算
  3. 選択中 object の外形ハイライト描画:
     - `useDesignStore((s) => s.selectedObjectId)` で id を購読 (React 側のみ。テストでは検証しない)
     - `useEffect` 内で `if (selectedObjectId) { ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 1.5 / scale; const obj = design?.objects.find((o) => o.id === selectedObjectId); if (obj) { ctx.beginPath(); polyline(ctx, obj.shape.outer, true); ctx.stroke(); } }` を `StitchCanvas` の描画後に追加レイヤとして描く
  4. `StitchCanvas` 自体は `stitch-preview.tsx` から再利用するため、stitch-preview.tsx 側で `export function StitchCanvas(...)` に切り出す (export 追加のみ)

#### Refactor

- `handleCanvasClickAtMm` は内部で store を直接触っているのでテスト容易性は確保済み。React component と純関数の境界を明確にしたまま完了
- `Cycle 5` で書いた `hitTestObject` を `preview-canvas-editable.tsx` 内に閉じている状態を見直し、`__tests__` から touch しやすければ別ファイル化は保留

---

## 7. サイクル依存グラフ

```
Cycle 1 (初期 state + setDesign)
   ↓
Cycle 2 (setSelectedObjectId + setEditMode)
   ↓
Cycle 3 (updateObject)
   ↓
Cycle 4 (reorderObjects)
   ↓
Cycle 5 (hitTestObject 純関数)
   ↓
Cycle 6 (canvas クリック → store 結線)
```

Cycle 1〜4 は store 単独。Cycle 5 は preview-canvas-editable の純関数のみ。Cycle 6 で初めて両者が結合する。
Cycle 5 は Cycle 1〜4 と並行着手も可能だが、PR レビューしやすさのため上記順を推奨。

## 8. 回帰防止

- **既存 unit test 全件パス** (`npx vitest run`): 本 PR は既存のテスト対象ファイルに**ロジック変更を加えない**ため理論上は影響無し。確認項目:
  - `src/lib/pipeline/__tests__/*.test.ts` の全テストが green
- **`stitch-preview.tsx` の表示挙動が壊れない**:
  - 本 PR で唯一加える変更は `StitchCanvas` の `export` 化のみ。`StitchPreview` コンポーネントから内部呼び出しの形は変えない (`<StitchCanvas pattern={pattern} />` のまま)
  - 手動確認: `npm run dev` で起動し、画像をアップロードして 2D / 3D タブ切替が従来通り動くこと
- **`embroidery-studio.tsx` を触らない**: 既存 `useState` ベースの実装は破壊しない。design-store は**未配線のまま** dormant に存在する状態で PR を切る (実画面の置き換えは後続 PR)
- **型チェック**: `npx tsc --noEmit` が pass すること
- **zustand 導入の副作用**: `package.json` への追加と `npm install` のみ。SSR で問題が起きないよう `design-store.ts` は `"use client"` 不要 (純粋な state) だが、`preview-canvas-editable.tsx` には `"use client"` を付与
- **React 19 互換性**: zustand v5 は React 19 をサポート。`package.json` の `"react": "19.2.4"` と整合する版を指定する

## 9. 受け入れ条件

- [ ] `npx vitest run` 全件パス
- [ ] `npx vitest run src/components/__tests__/design-store.test.ts` が green (Cycle 1〜4 のテスト全件)
- [ ] `npx vitest run src/components/__tests__/preview-canvas-editable.test.ts` が green (Cycle 5〜6 のテスト全件)
- [ ] `npx tsc --noEmit` が pass
- [ ] `npm run lint` が pass
- [ ] `package.json` の `dependencies` に `zustand` が追加され、`package-lock.json` も更新済み
- [ ] `useDesignStore` と vanilla `designStore` の両方が export されており、React コンポーネント / テストの両方から購読可能
- [ ] `designStore.getState().updateObject(id, patch)` が **未変更 object の参照を保つ** (Cycle 3 のテストで担保)
- [ ] `designStore.getState().reorderObjects(newOrder)` の入力検証が完全 (長さ・集合一致・重複なし。Cycle 4 で網羅)
- [ ] `hitTestObject` が `order` 降順で最前面 object を返す (Cycle 5 で担保)
- [ ] `handleCanvasClickAtMm` がストアの `setSelectedObjectId` を呼ぶ (Cycle 6 で担保)
- [ ] 既存 `embroidery-studio.tsx` / `stitch-preview.tsx` の表示挙動が変わらない (manual smoke: 画像アップロード → 2D プレビュー / 3D プレビュー / DST 書き出しが従来通り動く)
- [ ] `design-store.ts` から `embroidery-studio.tsx` への配線は本 PR に**含めない** (後続 PR でステップ 5 と合わせて実施)

## 10. コミット粒度

TDD サイクル単位で **1 cycle = 1 commit** を原則とする:

1. `chore(deps): add zustand for design state management`
2. `feat(store): introduce design store with setDesign (phase 5 pr1)`
3. `feat(store): add setSelectedObjectId and setEditMode actions`
4. `feat(store): add updateObject with shallow merge and reference stability`
5. `feat(store): add reorderObjects with input validation and order renumbering`
6. `feat(preview): add hitTestObject for point-in-polygon object pick`
7. `feat(preview): wire canvas click to design store for selection`
8. (任意) `refactor(preview): extract StitchCanvas from stitch-preview for reuse`

各コミット直後に `npx vitest run src/components/__tests__/` が green であること、Cycle 7 (= 上の 7) 完了時点で `npx vitest run` 全件 + `npx tsc --noEmit` を必ず流す。

## 11. 想定 PR タイトル

`feat(ui): introduce design store and selectable preview (phase 5 pr1)`

サブタイトル / PR 説明冒頭:

> Phase 5 計画書「10. 実装ステップ」のステップ 1〜2 を実装。Zustand ベースの `design-store` (design / selectedObjectId / editMode + 5 actions) を新規導入し、`preview-canvas-editable.tsx` で 2D プレビュー上の object クリック選択 (point-in-polygon) + 選択ハイライトを実現する。既存 `embroidery-studio.tsx` の `useState` 配線は **本 PR では触らず**、後続 PR で段階的に移行する。

## 12. 注意事項

- **EmbroideryDesign / EmbroideryObject 型の実パス**: Phase 1 で定義されている型の実際の import パス (`@/lib/design/types` を想定) を Cycle 1 着手前に確認すること。違っていれば import 行のみ修正。型シェイプ自体が異なる場合 (例: `objects` ではなく `layers`、`shape` ではなく `path` 等) は Cycle 1 の前にメモを残し、計画書のテストコードの型注釈をそれに合わせて書き換える
- **zustand v5 の `create` 関数シグネチャ**: `create<T>()(initializer)` の二重呼び出しが v5 仕様。v4 と異なるため import 文と call form に注意
- **vanilla store の取り出し方**: zustand v5 では `useDesignStore.getState()` / `useDesignStore.setState()` / `useDesignStore.subscribe()` が `useDesignStore` 自体から直接呼べる。`designStore` は `useDesignStore` のエイリアスとして export する (`export const designStore = useDesignStore;`)。これでテスト側は React フックを使わずに直接ストアを叩ける
- **`updateObject` の参照保持**: Cycle 3 のテストで未変更 object の参照が同一であることを assert している。zustand の `set` は浅い merge なので、`{ ...next[idx], ...patch }` で新 object を作っても他の object は配列 spread (`[...s.design.objects]`) で参照が保たれる
- **`reorderObjects` の throw 方針**: Phase 5 計画書「11. テスト」に明記の動作。一見ユーザー操作で誤入力が来そうだが、reorder UI 側 (Phase 5 PR4 の sewing-order-panel) で正当な id 列のみ渡される前提。万一バグれば落として検出するほうがよい
- **Phase 1 の `EmbroideryObject` に `locked` / `hidden` が無い場合**: Cycle 5 のテストで使う `locked` / `hidden` フィールドが Phase 1 で未定義なら、本 PR 内で型拡張 (`Partial<{ locked: boolean; hidden: boolean }>` を `EmbroideryObject` に optional 追加) を別 PR で先行させるか、本 PR の Cycle 5 のテストから一時的に該当ケースを外す。計画書の意図としては前者推奨だが、影響範囲によっては後者で妥協
- **hidden / holes の扱い**: 本 PR では `hidden` のみハンドルし、`shape.holes` の中で hit しても hit 扱いとする (Phase 5 計画書 5.1 の v1 仕様。穴の中での pick は後続 PR で改善)
- **React コンポーネントの DOM テスト**: `PreviewCanvasEditable` 本体のレンダリングは本 PR ではテストしない。`handleCanvasClickAtMm` を export して**純関数として** store 結合をテストすることで、jsdom + canvas モックの煩雑さを回避する
- **`"use client"` の付与**: `design-store.ts` には不要 (zustand store は SSR セーフに使うため最初のレンダリングは window アクセス無しで成立)。`preview-canvas-editable.tsx` は `useEffect` と DOM API を使うため必須
