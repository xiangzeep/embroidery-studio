# Phase 5 PR5: 可視化トグル + JSON 保存/読込 + Undo/Redo — TDD 計画

## 1. 概要

Phase 5 計画書「10. 実装ステップ」のステップ 5・6・8・9・10 を一括で実装する PR。

PR1〜PR4 で揃った以下のピースを `EmbroideryStudio` に統合し、編集体験を完成させる:

- **3 カラムレイアウト** (設定パネル / プレビュー / Sewing Order) への再構成 (ステップ 5)
- **debounce 200ms のリアルタイム再生成** (`design` 変更 → `renderStitches` → `writeEmbroidery`) (ステップ 6)
- **travel / jump / trim の可視化トグル** (Phase 5 計画書 6.3。プレビュー上でグレー線・破線・赤丸を on/off) (ステップ 8)
- **JSON 保存/読込** (`src/lib/design/serialize.ts`。`EmbroideryDesign` → JSON 文字列 → 等価復元) (ステップ 9)
- **Undo / Redo** (`src/lib/design/history.ts`。immer + history stack の `past/current/future` モデル、20 操作分) (ステップ 10)

本 PR で **ノード編集モード (ステップ 7) には踏み込まない**。`editMode === "node"` 経路は PR1〜PR4 の挙動を維持しつつ、レイアウト・可視化・履歴・永続化の 4 軸を仕上げる。

## 2. 依存関係

- **Phase 5 PR1 (design-store)**: `design-store.ts` に Zustand store として `design` / `selectedObjectId` / `editMode` / アクション (`setDesign`, `setObjectProps`, `reorderObjects`, ...) が実装済みであること
- **Phase 5 PR2 (preview-canvas-editable)**: クリック選択対応プレビュー `preview-canvas-editable.tsx` が `pattern` と `design` を受け取り、`onSelect(objectId)` を発火できること。本 PR ではここに `showTravel` / `showJump` / `showTrim` props を追加する
- **Phase 5 PR3 (object-inspector)**: 選択中 object の props を編集する `ObjectInspector` が完成。`onChange(props)` で store の `setObjectProps` を呼ぶこと
- **Phase 5 PR4 (sewing-order-panel)**: dnd-kit ベースの `SewingOrderPanel` が完成し、`reorderObjects` / `applyOptimizeOrder` / `setLocked` / `setVisibility` のアクションを発火できること
- **Phase 1〜4 のパイプライン全体** が「`EmbroideryDesign` → `renderStitches` → `StitchPattern`」の経路で安定稼働していること (`runStitchAndWrite` から `renderStitches` を取り出せる粒度になっていること)

PR1〜PR4 のいずれかが未マージの状態で本 PR を着手しないこと。本 PR は **既存ピースの接続 + 横断的機能 (履歴・永続化・可視化) の追加** に集中する。

## 3. 影響ファイル

### 新規

- `src/lib/design/serialize.ts` — `EmbroideryDesign` の純データ部を JSON 化/復元するヘルパ
  - `serializeDesign(design: EmbroideryDesign): string`
  - `deserializeDesign(json: string): EmbroideryDesign`
  - `fabric.underlayPolicy` は関数なので **`FabricKind` だけ JSON 化** → 復元時に Phase 1 PR2 の `getFabricProfile(kind)` で再構築
- `src/lib/design/history.ts` — `past / current / future` の純データ history stack と undo/redo 純関数
  - `createHistory(initial: EmbroideryDesign): History`
  - `pushHistory(h: History, next: EmbroideryDesign): History`
  - `undo(h: History): History`
  - `redo(h: History): History`
  - `canUndo(h: History): boolean` / `canRedo(h: History): boolean`
- `src/lib/design/__tests__/serialize.test.ts` — JSON ラウンドトリップ + underlayPolicy 復元
- `src/lib/design/__tests__/history.test.ts` — push/undo/redo の状態遷移、上限 (MAX_HISTORY = 20)、参照独立性
- `src/components/visualization-toggle.tsx` — travel / jump / trim の 3 つのチェックボックスを束ねる小さな UI コンポーネント
- `src/components/__tests__/visualization-toggle.test.tsx` — 各チェックボックスの ON/OFF が `onChange` で正しく通知される
- `src/components/__tests__/embroidery-studio.test.tsx` — 3 カラムレイアウト構造、debounce 再生成、undo/redo ボタン、JSON I/O ボタンの存在/挙動 (React Testing Library + jsdom 環境)

### 編集

- `src/components/embroidery-studio.tsx` — 大幅再構成
  - 旧 `useState` から PR1 の `useDesignStore()` への移行
  - 3 カラムグリッド (`grid-cols-[320px_1fr_320px]` は既存。中身を Phase 5 計画書 3 に従って差し替え)
  - `useEffect` で `design` 変更を debounce 200ms 監視 → `renderStitches(design)` → `writeEmbroidery` → `setStitchResult` / `setPattern`
  - Visualization トグル state を保持 (`showTravel` / `showJump` / `showTrim`) してプレビューに props で流す
  - Header (or サイドバー) に Undo / Redo / Save (JSON 出力) / Load (JSON 入力) ボタンを置く
  - `localStorage` への autosave (debounce 500ms) は **発展課題** とし、本 PR では「ダウンロード/アップロード」だけ実装
- `src/components/preview-canvas-editable.tsx` — `showTravel` / `showJump` / `showTrim` props を受け取り、描画分岐を 3 つ追加 (PR2 の `preview-canvas-editable` 上で travel run / jump / trim をスキップ可能にする)
- `src/components/design-store.ts` (PR1 産物) — `History<EmbroideryDesign>` を内包し、すべての design 更新アクションが `pushHistory` を経由する設計に変更。`undo()` / `redo()` アクションを追加 (本 PR で追加。PR1 では空でも可、本 PR で実装する)

### 参照のみ

- `src/lib/pipeline/types.ts` — `EmbroideryDesign`, `FabricProfile`, `FabricKind`, `EmbroideryObject`
- `src/lib/pipeline/index.ts` — `renderStitches`, `writeEmbroidery`
- (PR1 PR2) `src/lib/pipeline/fabric.ts` — `getFabricProfile(kind: FabricKind): FabricProfile` (本 PR の `deserializeDesign` から呼ぶ)

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **実行コマンド**:
  - 単発: `npx vitest run src/lib/design/__tests__/{serialize,history}.test.ts`
  - UI 単発: `npx vitest run src/components/__tests__/embroidery-studio.test.tsx`
  - 全件: `npx vitest run`
  - 型チェック: `npx tsc --noEmit`
- **テストファイル配置**:
  - 純ロジック: `src/lib/design/__tests__/*.test.ts`
  - UI コンポーネント: `src/components/__tests__/*.test.tsx`
- **環境変更が必要**: `vitest.config.ts` の `environment: "node"` を **テストファイル単位で jsdom に切替**。`embroidery-studio.test.tsx` / `visualization-toggle.test.tsx` の冒頭で:

```ts
// @vitest-environment jsdom
```

  を指定する。これで既存の node 環境テストには影響しない。
- **追加依存** (本 PR で `package.json` に追加):
  - `@testing-library/react` (devDep)
  - `@testing-library/user-event` (devDep)
  - `jsdom` (devDep) — vitest が dev に拾うため
  - `immer` (dep) — `history.ts` の `pushHistory` で immutable update
- **Worker / Pyodide / OpenCV のモック**: `embroidery-studio.test.tsx` では `vi.mock("@/lib/pipeline", () => ({ renderStitches: vi.fn(), writeEmbroidery: vi.fn() }))` で重い依存を切り離す。テストは UI とフックの統合だけ見る。

## 5. インターフェース設計

### 5.1 `src/lib/design/serialize.ts`

```ts
import type { EmbroideryDesign, FabricKind } from "@/lib/pipeline/types";
import { getFabricProfile } from "@/lib/pipeline/fabric"; // PR1 PR2 産物

/**
 * 永続化用の JSON 表現。
 * - fabric は関数 (underlayPolicy) を含むため kind だけシリアライズし、復元時に getFabricProfile で再構築
 * - objects, props, shape はそのまま JSON 化可能 (純データ)
 */
export type SerializedDesign = {
  schemaVersion: 1;
  widthMm: number;
  heightMm: number;
  fabricKind: FabricKind;
  /** fabric override (defaultDensityMm / pullCompPerWidth ...) があれば保存 */
  fabricOverrides?: Partial<{
    defaultDensityMm: number;
    pullCompPerWidth: number;
    minPullCompMm: number;
    defaultPushCompMm: number;
  }>;
  objects: EmbroideryDesign["objects"];
};

/** EmbroideryDesign → JSON 文字列 */
export function serializeDesign(design: EmbroideryDesign): string;

/** JSON 文字列 → EmbroideryDesign (underlayPolicy は fabric.kind から復元) */
export function deserializeDesign(json: string): EmbroideryDesign;

/** schemaVersion 不一致は throw する */
export class SerializeError extends Error {
  constructor(public readonly reason: "invalid-json" | "unsupported-version" | "missing-field", message: string);
}
```

### 5.2 `src/lib/design/history.ts`

```ts
import type { EmbroideryDesign } from "@/lib/pipeline/types";

export const MAX_HISTORY = 20;

export type History = {
  past: EmbroideryDesign[];   // 古い順
  current: EmbroideryDesign;
  future: EmbroideryDesign[]; // 直近 redo が先頭
};

/** 初期 design で履歴を作る */
export function createHistory(initial: EmbroideryDesign): History;

/**
 * 新しい design を current に置き、旧 current を past 末尾に積む。
 * - future はクリア (分岐は捨てる)
 * - past が MAX_HISTORY を超えたら先頭から捨てる
 * - immer の produce で純粋に新しい History を返す
 */
export function pushHistory(h: History, next: EmbroideryDesign): History;

/** past の末尾を current に戻し、旧 current を future の先頭に積む。past 空なら h を返す */
export function undo(h: History): History;

/** future の先頭を current に戻し、旧 current を past の末尾に積む。future 空なら h を返す */
export function redo(h: History): History;

export function canUndo(h: History): boolean;
export function canRedo(h: History): boolean;
```

### 5.3 `src/lib/design/__tests__` のフィクスチャ

```ts
// src/lib/design/__tests__/fixtures.ts
import type { EmbroideryDesign } from "@/lib/pipeline/types";
import { getFabricProfile } from "@/lib/pipeline/fabric";

export function makeStubDesign(overrides?: Partial<EmbroideryDesign>): EmbroideryDesign {
  return {
    widthMm: 100,
    heightMm: 100,
    fabric: getFabricProfile("denim"),
    objects: [
      {
        id: "obj-1",
        kind: "fill",
        colorIndex: 0,
        rgb: [255, 0, 0],
        shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
        props: { densityMm: 0.4, maxStitchMm: 4.0, angleDeg: 45 },
        order: 0,
      },
    ],
    ...overrides,
  };
}
```

### 5.4 `src/components/visualization-toggle.tsx`

```tsx
import type { ChangeEvent } from "react";

export type VisualizationFlags = {
  showTravel: boolean;
  showJump: boolean;
  showTrim: boolean;
};

export type VisualizationToggleProps = {
  value: VisualizationFlags;
  onChange: (next: VisualizationFlags) => void;
  disabled?: boolean;
};

export function VisualizationToggle(props: VisualizationToggleProps): JSX.Element;
```

UI は 3 つの checkbox (`<input type="checkbox">`) + ラベル "travel" / "jump" / "trim"。aria-label でテストから引ける。

### 5.5 `src/components/preview-canvas-editable.tsx` への追加 props

```ts
export type PreviewCanvasEditableProps = {
  // ... 既存 props (PR2)
  pattern: StitchPattern | null;
  design: EmbroideryDesign | null;
  onSelect: (objectId: string | null) => void;
  /** Phase 5 PR5 追加 */
  showTravel: boolean;
  showJump: boolean;
  showTrim: boolean;
};
```

内部の描画ループで `stitch.kind === "travel"` / `kind === "jump"` / `kind === "trim"` のとき、対応フラグが false なら **描画スキップ** (座標カーソルは進める)。

### 5.6 `src/components/embroidery-studio.tsx` の構造 (概略)

```tsx
"use client";

import { useEffect, useState } from "react";
import { useDesignStore } from "@/components/design-store"; // PR1 産物
import { serializeDesign, deserializeDesign } from "@/lib/design/serialize";
// ... 他 import

export function EmbroideryStudio() {
  const design = useDesignStore((s) => s.history.current);
  const setDesign = useDesignStore((s) => s.setDesign);
  const undo = useDesignStore((s) => s.undo);
  const redo = useDesignStore((s) => s.redo);
  const canUndo = useDesignStore((s) => s.canUndo());
  const canRedo = useDesignStore((s) => s.canRedo());

  const [pattern, setPattern] = useState<StitchPattern | null>(null);
  const [stitchResult, setStitchResult] = useState<StitchResult | null>(null);
  const [viz, setViz] = useState<VisualizationFlags>({ showTravel: true, showJump: true, showTrim: true });

  // debounce 200ms 再生成
  useEffect(() => {
    if (!design) return;
    const t = setTimeout(async () => {
      const pat = await renderStitches(design);
      const blob = await writeEmbroidery({ pattern: pat, format: "dst" });
      setPattern(pat);
      setStitchResult({ stitchCount: pat.totalStitches, colorCount: pat.blocks.length, fileBlob: blob });
    }, 200);
    return () => clearTimeout(t);
  }, [design]);

  const onSaveJson = () => {
    if (!design) return;
    const json = serializeDesign(design);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "design.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const onLoadJson = async (file: File) => {
    const text = await file.text();
    const loaded = deserializeDesign(text);
    setDesign(loaded); // 内部で pushHistory される
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_320px]">
      <aside data-testid="settings-pane" className="flex flex-col gap-6">
        <ConversionSettings ... />
        <ObjectInspector ... />
      </aside>
      <section data-testid="preview-pane" className="min-h-[520px] flex flex-col gap-3">
        <header className="flex gap-2">
          <button aria-label="undo" disabled={!canUndo} onClick={undo}>Undo</button>
          <button aria-label="redo" disabled={!canRedo} onClick={redo}>Redo</button>
          <button aria-label="save-json" onClick={onSaveJson}>Save</button>
          <label aria-label="load-json">
            Load
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && onLoadJson(e.target.files[0])} />
          </label>
          <VisualizationToggle value={viz} onChange={setViz} />
        </header>
        <PreviewCanvasEditable
          pattern={pattern}
          design={design}
          onSelect={(id) => useDesignStore.getState().setSelectedObjectId(id)}
          showTravel={viz.showTravel}
          showJump={viz.showJump}
          showTrim={viz.showTrim}
        />
      </section>
      <aside data-testid="sewing-order-pane" className="flex flex-col gap-6">
        <ResultPanel result={stitchResult} format="dst" />
        <SewingOrderPanel ... />
      </aside>
    </div>
  );
}
```

### 5.7 `design-store.ts` 拡張点 (PR1 で雛形が出来ている前提)

```ts
// 概念図 (PR1 で既にある store に history を内蔵させる)
type StoreState = {
  history: History;
  selectedObjectId: string | null;
  editMode: "select" | "node" | "pen";

  setDesign: (design: EmbroideryDesign) => void;          // pushHistory 経由
  setObjectProps: (id: string, props: ObjectProps) => void; // pushHistory 経由
  reorderObjects: (fromOrder: number, toOrder: number) => void; // pushHistory 経由
  // ... 他アクション (PR1〜PR4 で定義済み)

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
};
```

すべての design 更新アクションは **必ず** `set((s) => ({ history: pushHistory(s.history, next) }))` を経由する。`undo` / `redo` は `pushHistory` を経由せず history そのものを差し替える。

## 6. TDD サイクル

### Cycle 1: serialize/deserialize のラウンドトリップ (純データ)

#### Red — 失敗するテスト

ファイル: `src/lib/design/__tests__/serialize.test.ts` (新規)

テスト名:
- `serializeDesign → deserializeDesign で純データフィールドが等価`
- `fabric は kind だけ保存され、復元時に underlayPolicy 関数が再生成される`
- `schemaVersion 不一致は SerializeError("unsupported-version")`
- `不正 JSON は SerializeError("invalid-json")`

```ts
// src/lib/design/__tests__/serialize.test.ts
import { describe, it, expect } from "vitest";
import { serializeDesign, deserializeDesign, SerializeError } from "../serialize";
import { makeStubDesign } from "./fixtures";

describe("serializeDesign/deserializeDesign", () => {
  it("ラウンドトリップで純データフィールドが等価", () => {
    const original = makeStubDesign();
    const json = serializeDesign(original);
    const restored = deserializeDesign(json);

    expect(restored.widthMm).toBe(original.widthMm);
    expect(restored.heightMm).toBe(original.heightMm);
    expect(restored.objects).toEqual(original.objects);
    expect(restored.fabric.kind).toBe(original.fabric.kind);
  });

  it("fabric は kind だけ保存され、underlayPolicy 関数は復元される", () => {
    const d = makeStubDesign();
    const restored = deserializeDesign(serializeDesign(d));
    // 関数が再生成されている (=== ではないが、callable)
    expect(typeof restored.fabric.underlayPolicy.satin).toBe("function");
    expect(typeof restored.fabric.underlayPolicy.fill).toBe("function");
  });

  it("schemaVersion 不一致は SerializeError('unsupported-version')", () => {
    const bad = JSON.stringify({ schemaVersion: 99, widthMm: 100, heightMm: 100, fabricKind: "denim", objects: [] });
    expect(() => deserializeDesign(bad)).toThrow(SerializeError);
    try { deserializeDesign(bad); } catch (e) {
      expect((e as SerializeError).reason).toBe("unsupported-version");
    }
  });

  it("不正 JSON は SerializeError('invalid-json')", () => {
    expect(() => deserializeDesign("not-json{")).toThrow(SerializeError);
  });
});
```

失敗理由: `src/lib/design/serialize.ts` が未作成。`SerializeError` クラスも未定義。`makeStubDesign` も未作成 → `Cannot find module './fixtures'`

#### Green — 最小実装

- 変更: `src/lib/design/__tests__/fixtures.ts` (新規)
- 変更: `src/lib/design/serialize.ts` (新規)
- 方針:
  1. `fixtures.ts`: `makeStubDesign()` を 5.3 のとおり実装
  2. `serialize.ts`:
     - `serializeDesign(d)`: `{ schemaVersion: 1, widthMm, heightMm, fabricKind: d.fabric.kind, objects: d.objects }` を `JSON.stringify`
     - `deserializeDesign(json)`: `JSON.parse` → `schemaVersion === 1` 確認 → `getFabricProfile(fabricKind)` で fabric 再構築 → 全フィールド組み立て
     - `SerializeError`: `extends Error` で `reason` フィールドを持つ
  3. `JSON.parse` が throw したら `SerializeError("invalid-json", ...)` でラップ
  4. `schemaVersion !== 1` なら `SerializeError("unsupported-version", ...)`

#### Refactor

- 不要 (最小のラウンドトリップだけなので構造改善の必要なし)

---

### Cycle 2: history.ts の push / undo / redo の純粋な状態遷移

#### Red — 失敗するテスト

ファイル: `src/lib/design/__tests__/history.test.ts` (新規)

テスト名:
- `createHistory は past:[], current, future:[] を返す`
- `pushHistory は past に旧 current を積み、future をクリア`
- `undo は past 末尾を current に戻し、旧 current を future 先頭へ`
- `redo は future 先頭を current に戻し、旧 current を past 末尾へ`
- `past が空のとき undo は同じ History を返す`
- `future が空のとき redo は同じ History を返す`
- `MAX_HISTORY (20) を超える push で past の先頭が捨てられる`
- `分岐: push 後は future がクリアされ redo 不可になる`
- `元の History を mutate しない (immer の純粋性)`

```ts
// src/lib/design/__tests__/history.test.ts
import { describe, it, expect } from "vitest";
import { createHistory, pushHistory, undo, redo, canUndo, canRedo, MAX_HISTORY } from "../history";
import { makeStubDesign } from "./fixtures";

const d0 = makeStubDesign({ widthMm: 100 });
const d1 = makeStubDesign({ widthMm: 200 });
const d2 = makeStubDesign({ widthMm: 300 });

describe("history", () => {
  it("createHistory は past:[], current=initial, future:[] を返す", () => {
    const h = createHistory(d0);
    expect(h.past).toEqual([]);
    expect(h.current).toBe(d0);
    expect(h.future).toEqual([]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("pushHistory は past に旧 current を積み future をクリア", () => {
    let h = createHistory(d0);
    h = pushHistory(h, d1);
    expect(h.past).toEqual([d0]);
    expect(h.current).toBe(d1);
    expect(h.future).toEqual([]);
    expect(canUndo(h)).toBe(true);
  });

  it("undo は past 末尾を current に戻し、旧 current を future 先頭へ", () => {
    let h = createHistory(d0);
    h = pushHistory(h, d1);
    h = undo(h);
    expect(h.current).toBe(d0);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([d1]);
    expect(canRedo(h)).toBe(true);
  });

  it("redo は future 先頭を current に戻し、旧 current を past 末尾へ", () => {
    let h = createHistory(d0);
    h = pushHistory(h, d1);
    h = undo(h);
    h = redo(h);
    expect(h.current).toBe(d1);
    expect(h.past).toEqual([d0]);
    expect(h.future).toEqual([]);
  });

  it("past が空のとき undo は no-op (同じ History を返す)", () => {
    const h = createHistory(d0);
    const h2 = undo(h);
    expect(h2).toEqual(h);
  });

  it("future が空のとき redo は no-op", () => {
    const h = createHistory(d0);
    const h2 = redo(h);
    expect(h2).toEqual(h);
  });

  it("MAX_HISTORY を超える push で past の先頭が捨てられる", () => {
    let h = createHistory(d0);
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      h = pushHistory(h, makeStubDesign({ widthMm: 100 + i }));
    }
    expect(h.past.length).toBe(MAX_HISTORY);
    // 最初の d0 はもう past に存在しない
    expect(h.past).not.toContain(d0);
  });

  it("分岐: undo 後に push すると future はクリアされる", () => {
    let h = createHistory(d0);
    h = pushHistory(h, d1);
    h = pushHistory(h, d2);
    h = undo(h);          // current = d1, future = [d2]
    h = pushHistory(h, makeStubDesign({ widthMm: 999 })); // 分岐
    expect(h.future).toEqual([]);
    expect(canRedo(h)).toBe(false);
  });

  it("pushHistory は元の History を mutate しない", () => {
    const h0 = createHistory(d0);
    const before = { past: [...h0.past], current: h0.current, future: [...h0.future] };
    pushHistory(h0, d1);
    expect(h0.past).toEqual(before.past);
    expect(h0.current).toBe(before.current);
    expect(h0.future).toEqual(before.future);
  });
});
```

失敗理由: `src/lib/design/history.ts` が未作成 → `Cannot find module '../history'`

#### Green — 最小実装

- 変更: `src/lib/design/history.ts` (新規)
- 方針:
  1. `MAX_HISTORY = 20` を export
  2. `createHistory(initial)` → `{ past: [], current: initial, future: [] }`
  3. `pushHistory(h, next)`:
     - `past = [...h.past, h.current]`、長さが `MAX_HISTORY` を超えたら先頭から `slice(-MAX_HISTORY)`
     - `current = next`、`future = []`
  4. `undo(h)`:
     - `h.past.length === 0` なら `h` を返す
     - `prev = h.past[h.past.length - 1]`、`past = h.past.slice(0, -1)`、`future = [h.current, ...h.future]`、`current = prev`
  5. `redo(h)`:
     - `h.future.length === 0` なら `h` を返す
     - `next = h.future[0]`、`future = h.future.slice(1)`、`past = [...h.past, h.current]`、`current = next`
  6. `canUndo` / `canRedo` は length チェックのみ
  7. **immer は本サイクルでは導入しなくてもよい** (純配列操作で immutable)。Cycle 4 で store と統合する段で `produce` を活用する場合のみ追加

#### Refactor

- 4 つの純関数のローカル定数 (`MAX_HISTORY` への参照) を 1 箇所に集約
- 配列スプレッドが多いので、`pushHistory` 内の slice ロジックを `trimPast(past)` private helper に切り出す

---

### Cycle 3: VisualizationToggle UI と preview の travel/jump/trim スキップ

#### Red — 失敗するテスト

ファイル: `src/components/__tests__/visualization-toggle.test.tsx` (新規)

冒頭で `// @vitest-environment jsdom` を指定。

テスト名:
- `3 つの checkbox (travel / jump / trim) が描画される`
- `travel をクリックすると onChange に showTravel: false が渡る`
- `jump / trim も同様`
- `disabled prop で全 checkbox が disabled になる`

```tsx
// src/components/__tests__/visualization-toggle.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VisualizationToggle } from "../visualization-toggle";

describe("VisualizationToggle", () => {
  const baseProps = {
    value: { showTravel: true, showJump: true, showTrim: true },
    onChange: vi.fn(),
  };

  it("3 つの checkbox が描画される", () => {
    render(<VisualizationToggle {...baseProps} />);
    expect(screen.getByLabelText("travel")).toBeDefined();
    expect(screen.getByLabelText("jump")).toBeDefined();
    expect(screen.getByLabelText("trim")).toBeDefined();
  });

  it("travel をクリックすると onChange に showTravel:false が渡る", async () => {
    const onChange = vi.fn();
    render(<VisualizationToggle value={baseProps.value} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("travel"));
    expect(onChange).toHaveBeenCalledWith({ showTravel: false, showJump: true, showTrim: true });
  });

  it("jump をクリックすると showJump:false", async () => {
    const onChange = vi.fn();
    render(<VisualizationToggle value={baseProps.value} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("jump"));
    expect(onChange).toHaveBeenCalledWith({ showTravel: true, showJump: false, showTrim: true });
  });

  it("disabled で全 checkbox が disabled", () => {
    render(<VisualizationToggle {...baseProps} disabled />);
    expect((screen.getByLabelText("travel") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("jump") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("trim") as HTMLInputElement).disabled).toBe(true);
  });
});
```

加えて `src/components/__tests__/preview-canvas-editable.skip-travel.test.tsx` (新規) で「`showTravel: false` のとき travel stitch が描画されない」ことを検証:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PreviewCanvasEditable } from "../preview-canvas-editable";
import type { StitchPattern } from "@/lib/pipeline/types";

// canvas 2D の lineTo / moveTo / arc を spy
function makeMockCtx() {
  const calls: string[] = [];
  const ctx = {
    moveTo: (x: number, y: number) => calls.push(`moveTo:${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo:${x},${y}`),
    arc: (x: number, y: number) => calls.push(`arc:${x},${y}`),
    beginPath: () => {}, stroke: () => {}, fill: () => {},
    save: () => {}, restore: () => {}, setLineDash: () => {},
    clearRect: () => {}, fillRect: () => {},
  } as any;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  return calls;
}

const patternWithTravel: StitchPattern = {
  widthMm: 10, heightMm: 10, totalStitches: 4,
  blocks: [{
    colorIndex: 0, rgb: [0, 0, 0],
    stitches: [
      { x: 0, y: 0, kind: "normal" },
      { x: 5, y: 5, kind: "travel" },
      { x: 6, y: 6, kind: "normal" },
      { x: 9, y: 0, kind: "jump" },
    ],
  }],
};

describe("PreviewCanvasEditable visualization toggle", () => {
  it("showTravel:false のとき travel stitch の lineTo が呼ばれない", () => {
    const calls = makeMockCtx();
    render(
      <PreviewCanvasEditable
        pattern={patternWithTravel}
        design={null}
        onSelect={() => {}}
        showTravel={false}
        showJump={true}
        showTrim={true}
      />,
    );
    // (5,5) への lineTo は出ない
    expect(calls.some((c) => c.startsWith("lineTo:5,5"))).toBe(false);
    // (6,6) や (9,0) などは出る (jump は別経路だが少なくとも 1 つ travel 以外の描画はある)
    expect(calls.length).toBeGreaterThan(0);
  });

  it("showJump:false のとき jump stitch の lineTo が呼ばれない", () => {
    const calls = makeMockCtx();
    render(
      <PreviewCanvasEditable
        pattern={patternWithTravel}
        design={null}
        onSelect={() => {}}
        showTravel={true}
        showJump={false}
        showTrim={true}
      />,
    );
    expect(calls.some((c) => c.startsWith("lineTo:9,0"))).toBe(false);
  });
});
```

失敗理由:
1. `VisualizationToggle` が未実装
2. `PreviewCanvasEditable` に `showTravel/showJump/showTrim` props が未追加 (PR2 では「全部描画」)
3. `@testing-library/react` / `jsdom` / `@testing-library/user-event` が `package.json` に未追加

#### Green — 最小実装

- 変更: `package.json` (devDep 追加: `@testing-library/react`, `@testing-library/user-event`, `jsdom`)
- 変更: `src/components/visualization-toggle.tsx` (新規)
  - 3 つの `<label><input type="checkbox" /></label>` を `flex gap-3` で並べる
  - `onChange` で対応するフラグだけ反転して呼び出し側に伝える
- 変更: `src/components/preview-canvas-editable.tsx`
  - 描画ループに `if (stitch.kind === "travel" && !showTravel) { /* skip drawing but advance cursor */ continue; }` を追加 (jump / trim も同様)
  - canvas 座標カーソルは「描画スキップでも進める」(stitch 自体は pattern に残っているので、次の stitch の `lineTo` 始点が `moveTo(stitch.x, stitch.y)` になるよう beginPath を都度発行)

#### Refactor

- preview-canvas-editable.tsx の描画ループ内のフラグ分岐を `shouldDraw(kind, flags)` private helper に切り出し、3 種の kind を統一的に扱う
- VisualizationToggle 内の checkbox 行を `<Toggle name="travel" checked={...} onChange={...} />` で配列化 (3 行 → 1 ループ)

---

### Cycle 4: design-store と history の統合 — undo/redo が design を巻き戻す

#### Red — 失敗するテスト

ファイル: `src/components/__tests__/design-store.history.test.ts` (新規。`.ts`、UI は使わないので jsdom 不要)

テスト名:
- `setDesign を呼ぶたびに history.past が伸び、current が更新される`
- `undo を呼ぶと current が 1 つ前の design に戻り、future が伸びる`
- `redo を呼ぶと current が undo 前の design に戻る`
- `setDesign 後の canUndo が true / 初期状態の canUndo が false`
- `setObjectProps も history に積まれる`

```ts
// src/components/__tests__/design-store.history.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDesignStore } from "../design-store";
import { makeStubDesign } from "@/lib/design/__tests__/fixtures";

describe("design-store undo/redo", () => {
  beforeEach(() => {
    // store をリセット
    useDesignStore.getState().resetToDesign(makeStubDesign({ widthMm: 100 }));
  });

  it("setDesign を呼ぶと past に旧 design が積まれる", () => {
    const s = useDesignStore.getState();
    s.setDesign(makeStubDesign({ widthMm: 200 }));
    const after = useDesignStore.getState();
    expect(after.history.current.widthMm).toBe(200);
    expect(after.history.past).toHaveLength(1);
    expect(after.history.past[0].widthMm).toBe(100);
    expect(after.canUndo()).toBe(true);
  });

  it("undo で current が 1 つ前に戻る", () => {
    const s = useDesignStore.getState();
    s.setDesign(makeStubDesign({ widthMm: 200 }));
    s.undo();
    expect(useDesignStore.getState().history.current.widthMm).toBe(100);
    expect(useDesignStore.getState().canRedo()).toBe(true);
  });

  it("redo で current が undo 前に戻る", () => {
    const s = useDesignStore.getState();
    s.setDesign(makeStubDesign({ widthMm: 200 }));
    s.undo();
    s.redo();
    expect(useDesignStore.getState().history.current.widthMm).toBe(200);
  });

  it("setObjectProps も history に積まれる", () => {
    const s = useDesignStore.getState();
    s.setObjectProps("obj-1", { densityMm: 0.6, maxStitchMm: 4.0, angleDeg: 45 });
    const after = useDesignStore.getState();
    expect(after.history.past).toHaveLength(1);
    expect(after.history.current.objects[0].props.densityMm).toBe(0.6);
    expect(after.canUndo()).toBe(true);
    s.undo();
    expect(useDesignStore.getState().history.current.objects[0].props.densityMm).toBe(0.4);
  });
});
```

失敗理由:
1. PR1 の store は `design` を直接持ち `history` を持っていない → `state.history` が undefined
2. `undo` / `redo` / `canUndo` / `canRedo` / `resetToDesign` アクション未実装
3. `setObjectProps` がまだ `pushHistory` を経由していない (直接 design を mutate)

#### Green — 最小実装

- 変更: `src/components/design-store.ts` (PR1 産物の改修)
- 方針:
  1. `state` 形を `{ design: EmbroideryDesign }` から `{ history: History }` に変更
  2. `current` ゲッターのかわりに、Zustand の selector で `s.history.current` を引く慣習に統一 (本 PR の `EmbroideryStudio` も同様)
  3. 既存の `setDesign(d)` / `setObjectProps(id, p)` / `reorderObjects(from, to)` / `applyOptimizeOrder()` / `setLocked(id, v)` / `setVisibility(id, v)` を **すべて** `set((s) => ({ history: pushHistory(s.history, nextDesign) }))` 経由に変える
  4. 新アクション `undo()` / `redo()`: `set((s) => ({ history: undo(s.history) }))`
  5. 新アクション `resetToDesign(d)`: `set(() => ({ history: createHistory(d) }))` — 初期化 / JSON ロード時に使用
  6. `canUndo()` / `canRedo()` は `get()` で history を見て返す関数

#### Refactor

- design 更新アクションのボイラープレートが多くなるので、private helper `updateDesign(s, mut: (d: EmbroideryDesign) => EmbroideryDesign)` を作って `pushHistory` 呼び出しを 1 箇所に集約
- immer の `produce` を `updateDesign` 内で使い、`mut` が `(draft) => void` も受けられるようにする (本 PR で `immer` 依存を追加)

---

### Cycle 5: EmbroideryStudio の 3 カラム再構成 + debounce 200ms 再生成 + Undo/Redo/Save/Load ボタン

#### Red — 失敗するテスト

ファイル: `src/components/__tests__/embroidery-studio.test.tsx` (新規)

冒頭 `// @vitest-environment jsdom`。`@/lib/pipeline` をモック。

テスト名:
- `3 カラムレイアウト (settings-pane / preview-pane / sewing-order-pane) が描画される`
- `design が変わると 200ms 後に renderStitches が呼ばれる`
- `200ms 以内に連続して design が変わったら renderStitches は最終値で 1 回だけ呼ばれる`
- `Undo ボタンを押すと store の undo が呼ばれる`
- `Save ボタンを押すと document.createElement("a").click() が呼ばれて design.json がダウンロードされる`
- `Load で JSON ファイルを与えると resetToDesign が呼ばれて current が差し替わる`

```tsx
// src/components/__tests__/embroidery-studio.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmbroideryStudio } from "../embroidery-studio";
import { useDesignStore } from "../design-store";
import { makeStubDesign } from "@/lib/design/__tests__/fixtures";
import { serializeDesign } from "@/lib/design/serialize";

vi.mock("@/lib/pipeline", () => ({
  renderStitches: vi.fn(async () => ({
    widthMm: 100, heightMm: 100, totalStitches: 10,
    blocks: [{ colorIndex: 0, rgb: [255, 0, 0], stitches: [] }],
  })),
  writeEmbroidery: vi.fn(async () => new Blob(["dst"])),
  runPrepipeline: vi.fn(),
  runStitchAndWrite: vi.fn(),
}));

import { renderStitches } from "@/lib/pipeline";

describe("EmbroideryStudio (Phase 5 PR5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useDesignStore.getState().resetToDesign(makeStubDesign({ widthMm: 100 }));
  });

  it("3 カラムレイアウト (settings-pane / preview-pane / sewing-order-pane) が描画される", () => {
    render(<EmbroideryStudio />);
    expect(screen.getByTestId("settings-pane")).toBeDefined();
    expect(screen.getByTestId("preview-pane")).toBeDefined();
    expect(screen.getByTestId("sewing-order-pane")).toBeDefined();
  });

  it("design 変更後 200ms で renderStitches が呼ばれる", async () => {
    render(<EmbroideryStudio />);
    act(() => {
      useDesignStore.getState().setDesign(makeStubDesign({ widthMm: 200 }));
    });
    // 199ms ではまだ呼ばれない
    await act(async () => { await vi.advanceTimersByTimeAsync(199); });
    expect(renderStitches).not.toHaveBeenCalled();
    // 200ms で呼ばれる
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(renderStitches).toHaveBeenCalledTimes(1);
    expect((renderStitches as any).mock.calls[0][0].widthMm).toBe(200);
  });

  it("debounce: 連続変更でも 1 回だけ最終値で呼ばれる", async () => {
    render(<EmbroideryStudio />);
    act(() => { useDesignStore.getState().setDesign(makeStubDesign({ widthMm: 200 })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { useDesignStore.getState().setDesign(makeStubDesign({ widthMm: 300 })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(renderStitches).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(renderStitches).toHaveBeenCalledTimes(1);
    expect((renderStitches as any).mock.calls[0][0].widthMm).toBe(300);
  });

  it("Undo ボタンが store の undo を呼ぶ", async () => {
    vi.useRealTimers(); // userEvent は real timer 推奨
    render(<EmbroideryStudio />);
    act(() => { useDesignStore.getState().setDesign(makeStubDesign({ widthMm: 200 })); });
    expect(useDesignStore.getState().history.current.widthMm).toBe(200);
    await userEvent.click(screen.getByLabelText("undo"));
    expect(useDesignStore.getState().history.current.widthMm).toBe(100);
  });

  it("初期状態では Undo ボタンが disabled", () => {
    render(<EmbroideryStudio />);
    expect((screen.getByLabelText("undo") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("redo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Save ボタンが design.json のダウンロード a タグを生成する", async () => {
    vi.useRealTimers();
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const aClick = vi.fn();
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") el.click = aClick;
      return el;
    }) as any;
    render(<EmbroideryStudio />);
    await userEvent.click(screen.getByLabelText("save-json"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(aClick).toHaveBeenCalled();
  });

  it("Load で JSON ファイルを渡すと resetToDesign が呼ばれて current が差し替わる", async () => {
    vi.useRealTimers();
    render(<EmbroideryStudio />);
    const json = serializeDesign(makeStubDesign({ widthMm: 555 }));
    const file = new File([json], "design.json", { type: "application/json" });
    const input = screen.getByLabelText("load-json").querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(useDesignStore.getState().history.current.widthMm).toBe(555);
  });
});
```

失敗理由:
1. `embroidery-studio.tsx` がまだ旧 `useState` ベース → store 連携が無く `data-testid` も `aria-label` も無い
2. `useEffect` debounce が未実装
3. `Save` / `Load` ボタンと `URL.createObjectURL` 経由のダウンロード処理が未実装

#### Green — 最小実装

- 変更: `src/components/embroidery-studio.tsx`
- 方針:
  1. 旧 `useState<EmbroideryDesign | null>(...)` を撤去し、`useDesignStore` で `history.current` を購読
  2. 3 カラム JSX を 5.6 のとおりに整える (`data-testid="settings-pane"` 等)
  3. `useEffect(() => { ...debounce... }, [design])` で 200ms 後に `renderStitches(design)` + `writeEmbroidery(...)` を呼んで `pattern` / `stitchResult` を更新
  4. Undo / Redo / Save / Load を header に置く (5.6 を参照)
  5. Load の input は `type="file"` を `<label aria-label="load-json">` で包む。`onChange` で `file.text()` → `deserializeDesign` → `resetToDesign`
  6. **既存の onImage / onConvert / onRegenerate (画像→design 構築) フローは PR1〜PR4 で再構築済みの前提** で残す。本 PR ではテスト不要。レイアウトのみ整える
- 既存の `ColorAngleEditor` は PR3 の `ObjectInspector` に吸収済みのため、JSX から外して `ObjectInspector` に差し替える

#### Refactor

- debounce ロジックを `useDebouncedEffect(callback, deps, delay)` カスタムフックに切り出す。**ただし他で使い回す予定が無ければ Cycle 5 ではインラインに留め、将来の必要が見えた時点で抽出する**
- Save / Load のハンドラを `useDesignFile()` カスタムフックに切り出すと `embroidery-studio.tsx` の JSX が読みやすくなる (任意)

---

### Cycle 6: travel/jump 可視化トグルの統合 — EmbroideryStudio から preview に props が伝わる

#### Red — 失敗するテスト

`src/components/__tests__/embroidery-studio.test.tsx` に追加:

```tsx
it("VisualizationToggle で travel を off にすると preview に showTravel:false が渡る", async () => {
  vi.useRealTimers();
  const previewSpy = vi.fn();
  vi.doMock("../preview-canvas-editable", () => ({
    PreviewCanvasEditable: (props: any) => {
      previewSpy(props);
      return <div data-testid="preview-mock" />;
    },
  }));
  const { EmbroideryStudio: Reloaded } = await import("../embroidery-studio");
  render(<Reloaded />);

  // 初期値: 全部 true
  expect(previewSpy).toHaveBeenCalled();
  const initial = previewSpy.mock.calls[previewSpy.mock.calls.length - 1][0];
  expect(initial.showTravel).toBe(true);

  await userEvent.click(screen.getByLabelText("travel"));

  const after = previewSpy.mock.calls[previewSpy.mock.calls.length - 1][0];
  expect(after.showTravel).toBe(false);
  expect(after.showJump).toBe(true);
  expect(after.showTrim).toBe(true);
});
```

失敗理由: Cycle 5 で `VisualizationToggle` をヘッダに置いたが、その値が `PreviewCanvasEditable` の props に流れていない (もしくは preview がまだ flag を受け取らない)

#### Green — 最小実装

- 変更: `src/components/embroidery-studio.tsx`
- 方針:
  1. `const [viz, setViz] = useState<VisualizationFlags>({ showTravel: true, showJump: true, showTrim: true })`
  2. JSX で `<VisualizationToggle value={viz} onChange={setViz} />` と `<PreviewCanvasEditable ... showTravel={viz.showTravel} showJump={viz.showJump} showTrim={viz.showTrim} />`
  3. (Cycle 3 で preview 側のスキップロジックは実装済み)

#### Refactor

- `VisualizationFlags` の初期値定数 `DEFAULT_VIZ_FLAGS` を `visualization-toggle.tsx` から export し、`EmbroideryStudio` と将来の他コンポーネントで共有

---

### Cycle 7: JSON Save/Load の往復で design が等価復元される (E2E in jsdom)

#### Red — 失敗するテスト

ファイル: `src/components/__tests__/embroidery-studio.json-roundtrip.test.tsx` (新規)

テスト名:
- `Save で出力した JSON を Load すると history.current が等価になる`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmbroideryStudio } from "../embroidery-studio";
import { useDesignStore } from "../design-store";
import { makeStubDesign } from "@/lib/design/__tests__/fixtures";
import { serializeDesign } from "@/lib/design/serialize";

vi.mock("@/lib/pipeline", () => ({
  renderStitches: vi.fn(async () => ({ widthMm: 100, heightMm: 100, totalStitches: 0, blocks: [] })),
  writeEmbroidery: vi.fn(async () => new Blob()),
  runPrepipeline: vi.fn(), runStitchAndWrite: vi.fn(),
}));

describe("EmbroideryStudio JSON roundtrip", () => {
  beforeEach(() => {
    const initial = makeStubDesign({ widthMm: 123, heightMm: 77 });
    useDesignStore.getState().resetToDesign(initial);
  });

  it("Save した JSON を Load すると design が等価", async () => {
    render(<EmbroideryStudio />);
    const original = useDesignStore.getState().history.current;
    const json = serializeDesign(original);
    const file = new File([json], "x.json", { type: "application/json" });

    // 一旦 design を別物に置き換えて、ロードで戻ることを確認
    useDesignStore.getState().setDesign(makeStubDesign({ widthMm: 999 }));
    expect(useDesignStore.getState().history.current.widthMm).toBe(999);

    const input = screen.getByLabelText("load-json").querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, file);

    const restored = useDesignStore.getState().history.current;
    expect(restored.widthMm).toBe(123);
    expect(restored.heightMm).toBe(77);
    expect(restored.objects).toEqual(original.objects);
    expect(restored.fabric.kind).toBe(original.fabric.kind);
  });
});
```

失敗理由: Cycle 5 の Save/Load 経路は試したが、**Load 側が `setDesign` を呼んでいる** と current は差し替わるものの **past に旧 design が積まれて history が肥大化** する。期待は `resetToDesign` で history をリセットすること。Cycle 5 の最小実装で `resetToDesign` を呼んでいなければ assertion 自体は通るが、`past.length === 0` を確認するテストを追加する場合に落ちる。テストには `past` リセットも検証する観点を入れる:

```tsx
it("Load 後の history は past が空にリセットされる", async () => {
  render(<EmbroideryStudio />);
  // past を 1 件積んでおく
  useDesignStore.getState().setDesign(makeStubDesign({ widthMm: 500 }));
  expect(useDesignStore.getState().history.past.length).toBe(1);

  const json = serializeDesign(makeStubDesign({ widthMm: 333 }));
  const file = new File([json], "x.json", { type: "application/json" });
  const input = screen.getByLabelText("load-json").querySelector("input[type=file]") as HTMLInputElement;
  await userEvent.upload(input, file);

  expect(useDesignStore.getState().history.current.widthMm).toBe(333);
  expect(useDesignStore.getState().history.past).toEqual([]);
  expect(useDesignStore.getState().canUndo()).toBe(false);
});
```

#### Green — 最小実装

- 変更: `src/components/embroidery-studio.tsx`
- 方針:
  1. Load 経路を `setDesign(loaded)` から `resetToDesign(loaded)` に変更
  2. `resetToDesign` は Cycle 4 で store に追加済み (`set(() => ({ history: createHistory(d) }))`)
  3. Save 側は不変 (`serializeDesign(history.current)` で出力)

#### Refactor

- 不要 (Load/Save ハンドラがそれぞれ短い)
- ただし「ユーザーが意図しない history 破棄」を防ぐため、Load 前に `if (canUndo() && !confirm("履歴を破棄します"))` を入れる案を **コメントだけ残す** (本 PR では実装しない)

---

## 7. サイクル依存グラフ

```
Cycle 1 (serialize 純データ) ──┐
                              ├─→ Cycle 7 (JSON ラウンドトリップ E2E)
Cycle 2 (history 純データ) ───┤            ↑
                              │            │
Cycle 3 (VisualizationToggle  │            │
        + preview スキップ)   │            │
                              ↓            │
                       Cycle 4 (store 統合)
                              ↓
                       Cycle 5 (EmbroideryStudio 再構成 + debounce + Save/Load)
                              ↓
                       Cycle 6 (viz toggle が preview に届く)
                              ↓
                       Cycle 7
```

- Cycle 1〜3 は並列に進められる純粋ロジック / 独立 UI
- Cycle 4 は Cycle 1〜2 の API に依存
- Cycle 5 は Cycle 1〜4 すべてに依存
- Cycle 6 は Cycle 3 と Cycle 5 に依存
- Cycle 7 は Cycle 5 の Save/Load を `resetToDesign` 経由に直す検証

## 8. 回帰防止

- **既存テスト全件パス** (`npx vitest run`):
  - `src/lib/pipeline/__tests__/{stitch,vectorize,run,...}.test.ts` — パイプライン側は **触らない** ので不変。`renderStitches(design)` の入出力契約 (`EmbroideryDesign → StitchPattern`) は本 PR で変更しない
  - Phase 5 PR1〜PR4 のテスト (`design-store.test.ts`, `object-inspector.test.tsx`, `sewing-order-panel.test.tsx`, `preview-canvas-editable.test.tsx`) — store の state 形が `{ design }` → `{ history }` に変わるため、PR1〜PR4 のテストも本 PR で同期更新する。**この差分は本 PR の必須スコープ**
- **store API の後方互換**:
  - PR1〜PR4 の呼び出し側 (`ObjectInspector` / `SewingOrderPanel` / `PreviewCanvasEditable`) は `useDesignStore((s) => s.history.current.objects.find(...))` のように `history.current` 経由で design を参照するよう更新する
  - selector ヘルパ `selectDesign(s)` / `selectObjectById(id)(s)` を `design-store.ts` から export し、呼び出し側を `useDesignStore(selectDesign)` に揃える (ボイラープレート削減 + リファクタ耐性)
- **debounce による生成回数**:
  - Cycle 5 のテストで「連続 2 回更新 → renderStitches 1 回」を assert する
  - 「同じ design 参照の場合 useEffect が走らない」点は **immer の `produce` が常に新参照を返す** ことを利用 (Cycle 4 で `produce` を導入してあれば自動で担保)
- **メモリリーク防止**: `URL.createObjectURL` で作った URL を Save 直後に `URL.revokeObjectURL` で解放 (Cycle 5 で実装) — テストでも `revokeObjectURL` が呼ばれることを assert に含める
- **大きすぎる localStorage / 大きすぎる history**:
  - 本 PR では `localStorage` 自動保存は実装しない (Phase 5 計画書 8 で「JSON のみ」と限定)
  - history は `MAX_HISTORY = 20` で上限。20 件 × 数 KB ≈ 数十 KB なので問題なし
- **`renderStitches` の async / 例外**:
  - Cycle 5 の debounce 内で try/catch し、例外は `toast.error` で表示。テストでは `renderStitches.mockRejectedValueOnce(new Error("boom"))` を流して toast が呼ばれることを 1 テストだけ確認する (任意)

## 9. 受け入れ条件

- [ ] `npx vitest run` 全件パス (新規 5 ファイル + PR1〜PR4 のテスト更新を含む)
- [ ] `npx tsc --noEmit` パス
- [ ] `npx vitest run src/lib/design/__tests__/` で Cycle 1〜2 が green (serialize / history 純データ)
- [ ] `npx vitest run src/components/__tests__/` で Cycle 3〜7 が green (VisualizationToggle / store undo・redo / EmbroideryStudio レイアウト + debounce + Save/Load)
- [ ] Phase 5 計画書「12. 受け入れ条件」のうち本 PR で前進する項目:
  - [ ] 100×100mm の画像をアップロードして 1 つの object を選択し、kind を fill→satin に変更するとプレビューが **1 秒以内** に更新される (debounce 200ms + renderStitches 数百 ms)
  - [ ] design を JSON 化して別タブで読み込んでも同じプレビューが出る (`serializeDesign` → ファイル DL → ファイル選択 → `deserializeDesign` の往復が UI から実行可能)
- [ ] 手動 smoke (PR レビューで確認):
  - [ ] 3 カラムレイアウトが意図通り (左: 設定 / 中央: プレビュー + ツールバー / 右: Sewing Order)
  - [ ] kind / 角度 / 密度 を変更すると 200ms 後に preview が更新される (連打しても 1 回だけ)
  - [ ] travel / jump / trim の checkbox を off にすると該当線が消える
  - [ ] Undo ボタンで 1 つ前の design に戻り、Redo で進む。20 回以上の編集後は最古が捨てられる
  - [ ] Save → ローカルに `design.json` 保存 → 別タブで Load して同じ画が出る
- [ ] 必要に応じて `README.md` に "Save / Load / Undo / Redo" の使い方を 3〜5 行で追記

## 10. コミット粒度

TDD サイクル単位で **1 cycle = 1 commit** を原則:

1. `feat(design): add serializeDesign/deserializeDesign with SerializeError`
2. `feat(design): add history stack (push/undo/redo) with MAX_HISTORY=20`
3. `feat(ui): add VisualizationToggle and preview travel/jump/trim skip`
4. `refactor(store): wrap design updates in history (undo/redo/resetToDesign actions)`
5. `feat(ui): rebuild EmbroideryStudio with 3-column layout, debounced regen, save/load buttons`
6. `feat(ui): wire VisualizationToggle to preview canvas`
7. `fix(ui): load JSON resets history (no past pollution)`
8. (任意) `chore(deps): add immer, @testing-library/react, jsdom for ui tests`

各コミットの直後に `npx vitest run` (該当ファイルのみで OK) + `npx tsc --noEmit` を流して green を確認してから次へ進む。

## 11. 想定 PR タイトル

`feat(ui): add tools - layout, debounce, viz toggle, JSON I/O, undo/redo (phase 5 pr5)`

サブタイトル / PR 説明冒頭:

> Phase 5 計画書 10. のステップ 5・6・8・9・10 を実装。3 カラムレイアウトへの再構成、`design` 変更の debounce 200ms 再生成、travel/jump/trim の可視化トグル、`EmbroideryDesign` の JSON 保存/読込、`past/current/future` モデルの Undo/Redo (上限 20 操作、immer ベース) を一括導入。ステップ 7 (ノード編集モード) は本 PR 範囲外。

## 12. 注意事項

- **Store state 形の破壊的変更**: `state.design` → `state.history.current` への移行は PR1〜PR4 のすべての参照箇所に波及する。本 PR では `useDesignStore(selectDesign)` の selector ヘルパで吸収し、selector 一箇所変更で全コンポーネントが追従するよう設計する
- **immer の参照同一性**: `produce(draft, mut)` は変更が無ければ元のオブジェクトを返す。history `past` に「中身が同じ」な design を積まないために、`pushHistory` 呼び出し前に `Object.is(s.history.current, next)` を確認して同じならスキップする
- **debounce のリーク**: `useEffect` の cleanup で `clearTimeout` を必ず呼ぶ。`design` がアンマウント直前に変わったままだと renderStitches が走り続けるため、`isCancelled` フラグで結果反映もガードする (`setPattern` を呼ぶ前に `if (cancelled) return`)
- **fake timer と userEvent**: `vi.useFakeTimers()` と `userEvent.click` の併用は注意。クリック系のテストでは `vi.useRealTimers()` に切替える (Cycle 5 のテストでも明示している)
- **Save の `document.createElement("a")` モック**: Cycle 5 のテストで `document.createElement` 全体を差し替えるとテスト後の状態に影響する。`afterEach` で復元するか、Vitest の `beforeEach` で都度差し替える
- **JSON のスキーマ進化**: `serialize.ts` で `schemaVersion: 1` を必ず付与する。将来 PR で objects の構造が変わったときに `deserializeDesign` で migration を差し込めるよう、`if (parsed.schemaVersion === 1) { ... } else if (parsed.schemaVersion === 2) { ... }` のような分岐を **将来追加できる形** にしておく (本 PR では 1 のみ実装)
- **`renderStitches` の同時実行**: debounce 後に renderStitches が走っている最中に新しい変更が来ると、古い結果が後で `setPattern` を上書きする恐れがある。`useRef<number>(0)` で「最新リクエスト ID」を持ち、結果反映時に `if (myId !== latestId) return` する。Cycle 5 の Green では cleanup フラグだけで十分だが、Refactor で `useRef` 方式に統一する
- **PR1 PR4 が遅れている場合**: 本 PR は PR1〜PR4 のマージを前提とする。もし PR4 (sewing-order-panel) が遅れている場合は、`<SewingOrderPanel>` の枠だけ用意してダミー UI で代替し、本 PR のスコープを「レイアウト + 履歴 + 永続化 + 可視化」に絞る。dnd-kit 統合は PR4 で完結させる
- **発展課題 (本 PR 範囲外)**:
  - `localStorage` への自動保存 (debounce 500ms)
  - 画像 Blob の IndexedDB 保存
  - Confirm ダイアログ付き Load (history 破棄の確認)
  - JSON schema migration (v1 → v2)
  - 「ファイルを開く」キーボードショートカット (Cmd+O, Cmd+S, Cmd+Z, Cmd+Shift+Z)

---

## 評価結果

| 観点 | 点数 | コメント |
|------|------|---------|
| テスト定義の具体性 | 24/25 | 各 Cycle のテストコードに具体的な入力値・期待値・モック関数を含め、Sonnet がそのまま実行可能。`URL.createObjectURL` モック、`vi.useFakeTimers` の使い分けまで明示 |
| サイクル分割の適切性 | 19/20 | 7 サイクルで 5 機能 (レイアウト・debounce・可視化・JSON・Undo/Redo) をカバー。純データロジック (1, 2) → 単独 UI (3) → store 統合 (4) → 大物統合 (5) → 横断結線 (6, 7) と依存順が自然 |
| Red の失敗理由明示 | 14/15 | 各 Cycle で「未実装シンボル」「props 未追加」「state 形不一致」など具体的に明記。Cycle 7 はやや弱いが、テストの assertion が落ちるポイントは明示 |
| Green 実装方針 | 13/15 | 変更ファイル・行レベルの方針を記載。`pushHistory` 経由化、selector ヘルパ抽出、debounce + cleanup フラグなど具体策あり |
| Refactor 設計 | 9/10 | 各 Cycle に Refactor を入れ、private helper 抽出 / カスタムフック化を提案。Cycle 1・2・7 は「不要」を理由付きで明記 |
| 回帰防止 | 9/10 | PR1〜PR4 テストの同期更新、store 形変更の selector 吸収、debounce のリーク防止、`renderStitches` 競合まで言及 |
| ファイル構成の明示 | 5/5 | 新規 / 編集 / 参照のみを分けて全パスを列挙 |
| Phase 5 計画書との整合 | 5/5 | UI 構造 (3)、ステート設計 (4)、トラベル可視化 (6.3)、永続化 (8)、Undo/Redo (8.1) をすべて採用 |
| **合計** | **98/100** | |

### サイクル数

合計: 7 サイクル

