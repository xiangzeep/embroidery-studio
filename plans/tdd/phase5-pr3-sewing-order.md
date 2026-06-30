# Phase 5 PR3: Sewing Order Panel — TDD 実装計画書

## 1. 概要

Phase 5 計画書「10. 実装ステップ」の **ステップ 4** と「6. Sewing Order パネル」を実装する。
`src/components/sewing-order-panel.tsx` を新規作成し、`design.objects` を `order` 昇順でリスト表示する。
各行は色チップ・kind アイコン・ラベル・lock トグル・show/hide・delete を持ち、`@dnd-kit/core` + `@dnd-kit/sortable`
でドラッグ並び替えできる。並び替えると design store の `reorderObjects` 経由で `EmbroideryObject.order` を再採番する。
「自動最適化」ボタンは Phase 3 PR2 で実装済みの純関数 `optimizeOrder(design)` を design store 経由で呼び出し、
`locked: true` の object は移動させない (これは `optimizeOrder` 側の責務で本 PR では呼び出し検証のみ行う)。
travel/jump 可視化トグルは Boolean を design store (もしくはローカル state) に書き込み、
プレビュー側の購読は本 PR の責務外 (受け渡しの口だけ用意する)。

## 2. 依存関係

### 上流依存 (本 PR 着手前にマージ済みである必要)
- **Phase 1 PR1**: `EmbroideryObject` / `EmbroideryDesign` / `ObjectKind` 型 (`src/lib/pipeline/types.ts`)
- **Phase 3 PR2**: 純関数 `optimizeOrder(design: EmbroideryDesign): EmbroideryDesign` (`src/lib/pipeline/pathing.ts`)
  - `locked: true` の object は元の `order` を保持することが PR2 で保証済み
- **Phase 5 PR1**: design store (Zustand or React Context) に以下が実装済みであること
  - `design: EmbroideryDesign | null`
  - `setDesign(design)` / `updateObject(id, patch)` / `removeObject(id)`
  - `reorderObjects(orderedIds: string[]): void` — `orderedIds` の並びに従って `objects[].order` を 0 始まりで再採番
  - `applyOptimizeOrder(): void` — 内部で `optimizeOrder(design)` を呼んで `design` を差し替え
  - 本 PR の test では design store を **mock** して上記 API の呼び出しを検証する
  - PR1 が未マージなら **本 PR を着手しない**

### 下流影響
- Phase 5 ステップ 5 (`EmbroideryStudio` のレイアウト再構成) は本 PR のパネルを取り込む側になる。
- Phase 5 PR4 以降のリアルタイム再生成 (debounce) は本 PR の `reorderObjects` 呼び出しを契機として動く。
  本 PR では debounce の配線は行わず、store の差分更新のみで完結させる。

## 3. 影響ファイル

### 新規
- `src/components/sewing-order-panel.tsx`
- `src/components/__tests__/sewing-order-panel.test.tsx`

### 編集
- `package.json` — `@dnd-kit/core` (MIT) と `@dnd-kit/sortable` を `dependencies` に追加
  - 期待バージョン例: `@dnd-kit/core@^6.x`, `@dnd-kit/sortable@^8.x`
  - React 19 / Next 16 と互換性が取れるバージョンを選定 (Phase 5 計画書 6.1 推奨ライブラリ)
- `vitest.config.ts` — `environment: "node"` から `environment: "jsdom"` (または "happy-dom") へ切り替え
  - 既存テスト (`stitch.test.ts`, `vectorize.test.ts`, `pathing.test.ts` 等) は DOM 非依存のため壊れない
  - jsdom 不採用なら happy-dom + `@testing-library/react` + `@testing-library/user-event` を devDeps に追加
- `package.json` (devDependencies) — `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`
- `src/components/embroidery-studio.tsx` — `<SewingOrderPanel />` を 3 カラムレイアウトの右側に配置
  - 本 PR では「import + 既存レイアウトの脇に配置」のみ。3 カラム化 (Phase 5 ステップ 5) はスコープ外
  - 既存 UI (`ImageUploader`, `ConversionSettings`, `StitchPreview`, `ResultPanel`, `ColorAngleEditor`) は touch しない

### 触らない (回帰確認のみ)
- `src/lib/pipeline/**` — 本 PR はパイプラインに変更を入れない
- 既存 vitest テスト群

## 4. テスト環境

- **フレームワーク**: Vitest + React Testing Library
- **DOM**: jsdom (`vitest.config.ts` の `environment` を `"jsdom"` に変更)
- **dnd 操作のテスト戦略**: `@dnd-kit/core` の純粋なマウス/タッチイベントは jsdom 上で再現しにくいので、
  以下 2 段構えにする:
  1. **API レベル**: 並び替えハンドラ (`handleDragEnd`) を直接呼び出し、`reorderObjects` への引数を assert
  2. **コンポーネント結合**: `DndContext` の `onDragEnd` プロパティに渡している関数が
     `reorderObjects(orderedIds)` を正しい引数で呼ぶことを spy で検証
  - 実マウスドラッグの再現は手動テストに委ねる (Phase 5 計画書 11. 「UI は手動テスト + Storybook 推奨」)
- **実行コマンド**:
  - 単発: `npx vitest run src/components/__tests__/sewing-order-panel.test.tsx`
  - 関連: `npx vitest run src/components/__tests__/`
  - 全件: `npx vitest run`
- **テストファイル配置**: `src/components/__tests__/*.test.tsx`
- `vitest.config.ts` の `include` は既存設定 `src/**/*.test.ts` と `src/**/*.test.tsx` を維持

## 5. インターフェース設計

### 5.1 `SewingOrderPanel` Props

```ts
// src/components/sewing-order-panel.tsx
import type { EmbroideryObject } from "@/lib/pipeline/types";

export type SewingOrderPanelProps = {
  /** order 昇順で渡される。null/undefined のときは「未生成」状態として空表示。 */
  objects: EmbroideryObject[];
  /**
   * orderedIds[i] = i 番目に縫う object の id。
   * Panel は order を直接書かず、id 配列だけ親 (= design store) に渡す。
   * store 側で order を 0..n-1 で再採番する責務を持つ。
   */
  onReorder: (orderedIds: string[]) => void;
  /** 個別 object の locked / visible トグル。差分 patch で渡す。 */
  onToggleLocked: (objectId: string, locked: boolean) => void;
  onToggleVisible: (objectId: string, visible: boolean) => void;
  /** object 削除 (確認ダイアログは本 PR では出さず即削除)。 */
  onDelete: (objectId: string) => void;
  /** 「自動最適化」ボタン押下時。中で optimizeOrder(design) を呼ぶ責務は親が持つ。 */
  onOptimize: () => void;
  /** travel/jump 可視化トグル (本 PR ではプロップだけ用意、購読側は別 PR)。 */
  showTravel: boolean;
  onShowTravelChange: (next: boolean) => void;
  /** 一括操作中の無効化用 (パイプライン再計算中など)。 */
  disabled?: boolean;
};
```

### 5.2 `EmbroideryObject` の拡張前提

Phase 1 PR1 で定義済みの `EmbroideryObject` は以下フィールドを持つ:
- `id: string`
- `kind: "run" | "satin" | "fill"`
- `colorIndex: number`
- `rgb: [number, number, number]`
- `order: number`
- `locked?: boolean`

**本 PR で追加が必要なフィールド** (Phase 5 計画書 6.1 の「visibility 切替」のため):
- `visible?: boolean` — undefined は `true` 扱い (= 既存データは全件表示)

`types.ts` への `visible?: boolean` 追加は **Phase 5 PR1 の責務** とし、本 PR では「PR1 で追加済み」を前提とする。
PR1 マージ前なら本 PR Cycle 3 (visibility テスト) はブロックされるので、PR1 で先に型を入れる調整を行う。

### 5.3 design store の想定 API (PR1 で実装済み前提)

```ts
// src/components/design-store.ts (PR1)
type DesignStore = {
  design: EmbroideryDesign | null;
  setDesign(d: EmbroideryDesign): void;
  updateObject(id: string, patch: Partial<EmbroideryObject>): void;
  removeObject(id: string): void;
  reorderObjects(orderedIds: string[]): void;
  applyOptimizeOrder(): void; // 内部で optimizeOrder(design) を呼ぶ
};
```

本 PR の test では `vi.fn()` で各メソッドを stub する。

### 5.4 ファイル構成

```
src/components/
  sewing-order-panel.tsx           NEW
  __tests__/
    sewing-order-panel.test.tsx    NEW
```

## 6. TDD サイクル

サイクル順序:

```
Cycle 1 (リスト表示 + order 昇順ソート)
  → Cycle 2 (ドラッグ並び替え → onReorder 呼び出し)
       → Cycle 3 (lock / visibility / delete 行操作)
            → Cycle 4 (自動最適化ボタン)
                 → Cycle 5 (travel/jump 可視化トグル + disabled 状態の回帰)
```

各サイクル境界で `npx vitest run` 全件 green が必須。

---

### Cycle 1: object 配列を `order` 昇順でリスト表示する

#### Red — 失敗するテスト

ファイル: `src/components/__tests__/sewing-order-panel.test.tsx` (新規)

テスト観点:
- props の `objects` を `order` 昇順に並び替えて行を表示する (入力配列の順序は問わない)
- 各行が color chip / kind icon / ラベルを表示する
- 空配列のとき empty-state テキストを表示する (例: 「object がありません」)

```tsx
// src/components/__tests__/sewing-order-panel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SewingOrderPanel } from "../sewing-order-panel";
import type { EmbroideryObject } from "@/lib/pipeline/types";

const noop = () => {};
const baseProps = {
  onReorder: noop,
  onToggleLocked: noop,
  onToggleVisible: noop,
  onDelete: noop,
  onOptimize: noop,
  showTravel: false,
  onShowTravelChange: noop,
} as const;

const makeObj = (overrides: Partial<EmbroideryObject>): EmbroideryObject => ({
  id: overrides.id ?? "o1",
  kind: overrides.kind ?? "fill",
  colorIndex: overrides.colorIndex ?? 0,
  rgb: overrides.rgb ?? [255, 0, 0],
  shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
  props: { densityMm: 0.4, maxStitchMm: 4 },
  order: overrides.order ?? 0,
  ...overrides,
});

describe("SewingOrderPanel - リスト表示", () => {
  it("objects が order 昇順で表示される (入力順序が逆でも昇順に並ぶ)", () => {
    const objects: EmbroideryObject[] = [
      makeObj({ id: "c", order: 2, kind: "fill", rgb: [0, 0, 255] }),
      makeObj({ id: "a", order: 0, kind: "run",  rgb: [255, 0, 0] }),
      makeObj({ id: "b", order: 1, kind: "satin", rgb: [0, 255, 0] }),
    ];
    render(<SewingOrderPanel {...baseProps} objects={objects} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // 表示順 = order 昇順
    expect(rows[0]).toHaveAttribute("data-object-id", "a");
    expect(rows[1]).toHaveAttribute("data-object-id", "b");
    expect(rows[2]).toHaveAttribute("data-object-id", "c");
  });

  it("各行に色チップ / kind ラベル / object ラベルを表示する", () => {
    const objects = [makeObj({ id: "a", kind: "fill", colorIndex: 2, rgb: [10, 20, 30], order: 0 })];
    render(<SewingOrderPanel {...baseProps} objects={objects} />);
    const row = screen.getByRole("listitem");
    // 色チップは backgroundColor で識別
    const chip = within(row).getByTestId("color-chip");
    expect(chip).toHaveStyle({ backgroundColor: "rgb(10, 20, 30)" });
    // kind ラベル
    expect(within(row).getByText(/fill/i)).toBeInTheDocument();
    // object id を含むラベル
    expect(within(row).getByText(/a/)).toBeInTheDocument();
  });

  it("objects が空のとき empty-state を表示する", () => {
    render(<SewingOrderPanel {...baseProps} objects={[]} />);
    expect(screen.getByText(/object がありません|まだ object が|empty/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
```

**失敗理由**:
- `src/components/sewing-order-panel.tsx` が存在せず `Cannot find module '../sewing-order-panel'`
- `@testing-library/react` / `jsdom` がインストールされておらず、`render` が動かない
- `vitest.config.ts` の environment が `"node"` のままで `document` が undefined

#### Green — 最小実装

1. `package.json` の devDeps に追加:
   - `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`
2. `package.json` の deps に追加:
   - `@dnd-kit/core`, `@dnd-kit/sortable`
3. `vitest.config.ts`: `environment: "jsdom"` に変更
4. `src/components/sewing-order-panel.tsx` (新規) を以下方針で実装:

```tsx
"use client";

import { useMemo } from "react";
import type { EmbroideryObject } from "@/lib/pipeline/types";

export type SewingOrderPanelProps = {
  objects: EmbroideryObject[];
  onReorder: (orderedIds: string[]) => void;
  onToggleLocked: (objectId: string, locked: boolean) => void;
  onToggleVisible: (objectId: string, visible: boolean) => void;
  onDelete: (objectId: string) => void;
  onOptimize: () => void;
  showTravel: boolean;
  onShowTravelChange: (next: boolean) => void;
  disabled?: boolean;
};

const rgbCss = ([r, g, b]: readonly [number, number, number]) =>
  `rgb(${r}, ${g}, ${b})`;

export function SewingOrderPanel(props: SewingOrderPanelProps) {
  const sorted = useMemo(
    () => props.objects.slice().sort((a, b) => a.order - b.order),
    [props.objects],
  );

  if (sorted.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        object がありません。画像を変換すると一覧が表示されます。
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="Sewing Order">
      {sorted.map((obj) => (
        <li
          key={obj.id}
          data-object-id={obj.id}
          className="flex items-center gap-2 rounded-sm border px-2 py-1"
        >
          <span
            data-testid="color-chip"
            className="size-4 shrink-0 rounded-sm border"
            style={{ backgroundColor: rgbCss(obj.rgb) }}
          />
          <span className="text-xs font-mono">{obj.kind}</span>
          <span className="text-sm truncate">{obj.id}</span>
        </li>
      ))}
    </ul>
  );
}
```

#### Refactor

- color chip と kind icon の Tailwind クラスは後続 Cycle で重複するので、`Row` 内部コンポーネントへの抽出は Cycle 3 で判断する
- empty-state 文言は i18n を未導入なため日本語直書き (既存コンポーネントと整合)

---

### Cycle 2: ドラッグ並び替えで `onReorder(orderedIds)` が呼ばれる

#### Red — 失敗するテスト

`@dnd-kit/core` の `onDragEnd` は `DragEndEvent` を受け取り `active.id` / `over.id` を含む。
本サイクルでは「コンポーネントが onDragEnd ハンドラを `DndContext` に渡す」ことと
「ハンドラが `arrayMove` ロジックで orderedIds を計算して `onReorder` を呼ぶ」ことを 2 段でテストする。

dnd-kit を mock してハンドラを取り出せるようにする:

```tsx
// テスト先頭でモック
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: vi.fn(({ children, onDragEnd }: any) => {
      // テストから取り出せるように handler を window に置く
      (globalThis as any).__lastDragEnd = onDragEnd;
      return <div data-testid="dnd-context">{children}</div>;
    }),
  };
});
```

テスト本体:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { SewingOrderPanel } from "../sewing-order-panel";

describe("SewingOrderPanel - ドラッグ並び替え", () => {
  beforeEach(() => {
    (globalThis as any).__lastDragEnd = undefined;
  });

  it("行を 0→2 に動かすと onReorder が orderedIds=[b, c, a] で呼ばれる", () => {
    const onReorder = vi.fn();
    const objects = [
      makeObj({ id: "a", order: 0 }),
      makeObj({ id: "b", order: 1 }),
      makeObj({ id: "c", order: 2 }),
    ];
    render(<SewingOrderPanel {...baseProps} objects={objects} onReorder={onReorder} />);

    // a (top) を c の位置にドラッグ → 結果は [b, c, a]
    const handler = (globalThis as any).__lastDragEnd as (e: any) => void;
    expect(handler).toBeTypeOf("function");
    handler({ active: { id: "a" }, over: { id: "c" } });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("行を 2→0 に動かすと onReorder が orderedIds=[c, a, b] で呼ばれる (上方向ドラッグ)", () => {
    const onReorder = vi.fn();
    const objects = [
      makeObj({ id: "a", order: 0 }),
      makeObj({ id: "b", order: 1 }),
      makeObj({ id: "c", order: 2 }),
    ];
    render(<SewingOrderPanel {...baseProps} objects={objects} onReorder={onReorder} />);
    const handler = (globalThis as any).__lastDragEnd as (e: any) => void;
    // c を a の位置に持ち上げる → [c, a, b]
    handler({ active: { id: "c" }, over: { id: "a" } });
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("over=null (ドロップ先なし) のときは onReorder を呼ばない", () => {
    const onReorder = vi.fn();
    const objects = [makeObj({ id: "a", order: 0 }), makeObj({ id: "b", order: 1 })];
    render(<SewingOrderPanel {...baseProps} objects={objects} onReorder={onReorder} />);
    const handler = (globalThis as any).__lastDragEnd as (e: any) => void;
    handler({ active: { id: "a" }, over: null });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("同じ位置にドロップ (active.id === over.id) のときは onReorder を呼ばない", () => {
    const onReorder = vi.fn();
    const objects = [makeObj({ id: "a", order: 0 }), makeObj({ id: "b", order: 1 })];
    render(<SewingOrderPanel {...baseProps} objects={objects} onReorder={onReorder} />);
    const handler = (globalThis as any).__lastDragEnd as (e: any) => void;
    handler({ active: { id: "a" }, over: { id: "a" } });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
```

**失敗理由**: Cycle 1 の最小実装は `<ul><li />` を直接描画しており `DndContext` を使っていない。
`globalThis.__lastDragEnd` は undefined のまま呼び出せず、テストは失敗する。

#### Green — 最小実装

`sewing-order-panel.tsx` を拡張:

```tsx
import { DndContext, type DragEndEvent, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ...

export function SewingOrderPanel(props: SewingOrderPanelProps) {
  const sorted = useMemo(
    () => props.objects.slice().sort((a, b) => a.order - b.order),
    [props.objects],
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = sorted.map((o) => o.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    props.onReorder(next);
  };

  if (sorted.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">object がありません。…</div>;
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={sorted.map((o) => o.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-1" aria-label="Sewing Order">
          {sorted.map((obj) => (
            <SortableRow key={obj.id} obj={obj} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ obj }: { obj: EmbroideryObject }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: obj.id });
  return (
    <li
      ref={setNodeRef}
      data-object-id={obj.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 rounded-sm border px-2 py-1"
    >
      <span
        data-testid="color-chip"
        className="size-4 shrink-0 rounded-sm border"
        style={{ backgroundColor: rgbCss(obj.rgb) }}
      />
      <span className="text-xs font-mono">{obj.kind}</span>
      <span className="text-sm truncate">{obj.id}</span>
    </li>
  );
}
```

#### Refactor

- `handleDragEnd` 内の `String(active.id)` キャスト (`dnd-kit` の `id` は `UniqueIdentifier = string | number`)
  を型ガード関数に切り出すかは Cycle 3 で再評価
- `SortableRow` を別ファイルに切り出すかは Cycle 3 で行操作 UI を足してから判断 (現状は同一ファイル内で十分)

---

### Cycle 3: lock トグル / visibility トグル / delete 行操作

#### Red — 失敗するテスト

```tsx
import userEvent from "@testing-library/user-event";

describe("SewingOrderPanel - 行操作", () => {
  it("lock ボタンをクリックすると onToggleLocked(id, true) が呼ばれる", async () => {
    const onToggleLocked = vi.fn();
    const objects = [makeObj({ id: "a", order: 0, locked: false })];
    render(<SewingOrderPanel {...baseProps} objects={objects} onToggleLocked={onToggleLocked} />);
    await userEvent.click(screen.getByRole("button", { name: /lock|ロック/i }));
    expect(onToggleLocked).toHaveBeenCalledWith("a", true);
  });

  it("locked=true の object では lock ボタンが押された状態 (aria-pressed=true) になり、再押下で false に戻る", async () => {
    const onToggleLocked = vi.fn();
    const objects = [makeObj({ id: "a", order: 0, locked: true })];
    render(<SewingOrderPanel {...baseProps} objects={objects} onToggleLocked={onToggleLocked} />);
    const btn = screen.getByRole("button", { name: /lock|ロック/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(onToggleLocked).toHaveBeenCalledWith("a", false);
  });

  it("visibility ボタンクリックで onToggleVisible(id, false) が呼ばれる (visible=undefined は true 扱い)", async () => {
    const onToggleVisible = vi.fn();
    const objects = [makeObj({ id: "a", order: 0 })]; // visible 未指定 = true
    render(<SewingOrderPanel {...baseProps} objects={objects} onToggleVisible={onToggleVisible} />);
    await userEvent.click(screen.getByRole("button", { name: /show|hide|表示/i }));
    expect(onToggleVisible).toHaveBeenCalledWith("a", false);
  });

  it("delete ボタンクリックで onDelete(id) が呼ばれる", async () => {
    const onDelete = vi.fn();
    const objects = [makeObj({ id: "a", order: 0 })];
    render(<SewingOrderPanel {...baseProps} objects={objects} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete|削除/i }));
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("lock ボタン押下で onReorder は呼ばれない (ドラッグハンドラと干渉しない)", async () => {
    const onReorder = vi.fn();
    const onToggleLocked = vi.fn();
    const objects = [makeObj({ id: "a", order: 0 })];
    render(
      <SewingOrderPanel
        {...baseProps}
        objects={objects}
        onReorder={onReorder}
        onToggleLocked={onToggleLocked}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /lock|ロック/i }));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
```

**失敗理由**: Cycle 2 の実装には lock / visibility / delete のボタンが存在しない。
`getByRole("button", { name: /lock/i })` は要素なしで throw する。

#### Green — 最小実装

`SortableRow` にボタンを追加し、ドラッグハンドラ (`listeners`) を行全体ではなく
ドラッグ用 grip 領域だけに付けることでクリックとの干渉を避ける:

```tsx
import { GripVertical, Lock, LockOpen, Eye, EyeOff, Trash2 } from "lucide-react";

type RowProps = {
  obj: EmbroideryObject;
  onToggleLocked: (id: string, locked: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onDelete: (id: string) => void;
};

function SortableRow({ obj, onToggleLocked, onToggleVisible, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: obj.id });
  const locked = obj.locked === true;
  const visible = obj.visible !== false; // undefined = true

  return (
    <li
      ref={setNodeRef}
      data-object-id={obj.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-2 rounded-sm border px-2 py-1"
    >
      {/* drag handle は grip にだけ付与 */}
      <button
        type="button"
        aria-label="drag"
        className="cursor-grab"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </button>
      <span
        data-testid="color-chip"
        className="size-4 shrink-0 rounded-sm border"
        style={{ backgroundColor: rgbCss(obj.rgb) }}
      />
      <span className="text-xs font-mono">{obj.kind}</span>
      <span className="text-sm truncate flex-1">{obj.id}</span>
      <button
        type="button"
        aria-label={locked ? "ロック解除" : "ロック"}
        aria-pressed={locked}
        onClick={() => onToggleLocked(obj.id, !locked)}
      >
        {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
      </button>
      <button
        type="button"
        aria-label={visible ? "非表示にする" : "表示する"}
        aria-pressed={!visible}
        onClick={() => onToggleVisible(obj.id, !visible)}
      >
        {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </button>
      <button
        type="button"
        aria-label="削除"
        onClick={() => onDelete(obj.id)}
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
```

親側で props を引き渡す:

```tsx
<SortableRow
  key={obj.id}
  obj={obj}
  onToggleLocked={props.onToggleLocked}
  onToggleVisible={props.onToggleVisible}
  onDelete={props.onDelete}
/>
```

#### Refactor

- 各ボタンの aria-label を `lucide-react` のアイコン名と二重定義しているので、
  ロケール辞書 (`const LABELS = { lock: "ロック", unlock: "ロック解除", ... }`) を本ファイル先頭に集約
- `SortableRow` がやや肥大化するが、本 PR では分割せず Phase 5 PR4 で複数行コンポーネント
  (Object Inspector の小行と共有可能) になった段階で抽出を検討

---

### Cycle 4: 「自動最適化」ボタン

#### Red — 失敗するテスト

```tsx
describe("SewingOrderPanel - 自動最適化", () => {
  it("自動最適化ボタンを押すと onOptimize が呼ばれる", async () => {
    const onOptimize = vi.fn();
    const objects = [
      makeObj({ id: "a", order: 0 }),
      makeObj({ id: "b", order: 1 }),
    ];
    render(<SewingOrderPanel {...baseProps} objects={objects} onOptimize={onOptimize} />);
    await userEvent.click(screen.getByRole("button", { name: /自動最適化|optimize/i }));
    expect(onOptimize).toHaveBeenCalledTimes(1);
  });

  it("objects が空のとき自動最適化ボタンは disabled になる", () => {
    const onOptimize = vi.fn();
    render(<SewingOrderPanel {...baseProps} objects={[]} onOptimize={onOptimize} />);
    // empty-state でもボタン自体は存在させる (上部固定 UI)
    const btn = screen.queryByRole("button", { name: /自動最適化|optimize/i });
    if (btn) expect(btn).toBeDisabled();
  });

  it("disabled=true (パイプライン再計算中) のとき自動最適化ボタンは押せない", async () => {
    const onOptimize = vi.fn();
    const objects = [makeObj({ id: "a", order: 0 })];
    render(<SewingOrderPanel {...baseProps} objects={objects} onOptimize={onOptimize} disabled />);
    const btn = screen.getByRole("button", { name: /自動最適化|optimize/i });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onOptimize).not.toHaveBeenCalled();
  });

  it("locked object があっても自動最適化ボタンは押せる (locked の保護は親 optimizeOrder の責務)", async () => {
    const onOptimize = vi.fn();
    const objects = [
      makeObj({ id: "a", order: 0, locked: true }),
      makeObj({ id: "b", order: 1 }),
    ];
    render(<SewingOrderPanel {...baseProps} objects={objects} onOptimize={onOptimize} />);
    const btn = screen.getByRole("button", { name: /自動最適化|optimize/i });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onOptimize).toHaveBeenCalledTimes(1);
  });
});
```

**失敗理由**: Cycle 3 まではボタンが存在しないので `getByRole("button", { name: /自動最適化/i })` で throw。

> 補足: 「locked object は optimizeOrder で動かない」ことのアサートは Phase 3 PR2 の test (`pathing.test.ts`) で
> 既に担保されている。本 PR ではパネルが `onOptimize` を呼ぶことだけ確認する。

#### Green — 最小実装

パネル上部にヘッダー領域を追加:

```tsx
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";

// JSX 内、ul の前にヘッダーを追加
return (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between p-2">
      <span className="text-sm font-semibold">Sewing Order</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={props.onOptimize}
        disabled={props.disabled || sorted.length === 0}
      >
        <Wand2 className="size-4 mr-1" />
        自動最適化
      </Button>
    </div>
    {sorted.length === 0 ? (
      <div className="p-4 text-sm text-muted-foreground">…</div>
    ) : (
      <DndContext /* ... */>{/* ul */}</DndContext>
    )}
  </div>
);
```

#### Refactor

- ヘッダー領域は次サイクルで「travel toggle」も足すので、`<PanelHeader />` 内部コンポーネントへ切り出す候補
- Button の `variant="outline"` は既存 `color-angle-editor.tsx` の「適用」ボタンと整合 (`<Button>` shadcn 系)

---

### Cycle 5: travel/jump 可視化トグル + disabled 状態の全体回帰

#### Red — 失敗するテスト

```tsx
describe("SewingOrderPanel - travel toggle / disabled", () => {
  it("travel toggle をクリックすると onShowTravelChange(true) が呼ばれる", async () => {
    const onShowTravelChange = vi.fn();
    render(
      <SewingOrderPanel
        {...baseProps}
        objects={[makeObj({ id: "a", order: 0 })]}
        showTravel={false}
        onShowTravelChange={onShowTravelChange}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: /travel|trim|可視化/i }));
    expect(onShowTravelChange).toHaveBeenCalledWith(true);
  });

  it("showTravel=true のとき toggle が ON 状態 (aria-checked=true)", () => {
    render(
      <SewingOrderPanel
        {...baseProps}
        objects={[makeObj({ id: "a", order: 0 })]}
        showTravel={true}
      />,
    );
    expect(screen.getByRole("switch", { name: /travel|trim|可視化/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("disabled=true のとき lock / visibility / delete ボタンも押せない", async () => {
    const onToggleLocked = vi.fn();
    const onDelete = vi.fn();
    render(
      <SewingOrderPanel
        {...baseProps}
        objects={[makeObj({ id: "a", order: 0 })]}
        onToggleLocked={onToggleLocked}
        onDelete={onDelete}
        disabled
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /lock|ロック/i }));
    await userEvent.click(screen.getByRole("button", { name: /削除|delete/i }));
    expect(onToggleLocked).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
```

**失敗理由**:
- Cycle 4 の段階では switch がレンダーされていない
- 行ボタンの `disabled` バインディングが未実装で disabled=true でも click が通る

#### Green — 最小実装

1. ヘッダーに travel toggle を追加。shadcn の Switch が無い場合は `<button role="switch" aria-checked={x}>` で自作 (or `@base-ui/react` の Switch を使う; 既に依存にある):

```tsx
<button
  role="switch"
  aria-checked={props.showTravel}
  aria-label="travel/jump を表示"
  onClick={() => props.onShowTravelChange(!props.showTravel)}
  disabled={props.disabled}
  className={cn(
    "h-5 w-9 rounded-full border transition-colors",
    props.showTravel ? "bg-primary" : "bg-muted",
  )}
>
  <span
    className={cn(
      "block size-4 rounded-full bg-white transition-transform",
      props.showTravel && "translate-x-4",
    )}
  />
</button>
```

2. `SortableRow` に `disabled` を伝播し、各ボタンに `disabled={disabled}` を付与。
   ドラッグハンドル (grip) にも `disabled` で `pointer-events: none` を当てる:

```tsx
<SortableRow
  key={obj.id}
  obj={obj}
  disabled={props.disabled}
  onToggleLocked={props.onToggleLocked}
  onToggleVisible={props.onToggleVisible}
  onDelete={props.onDelete}
/>
```

#### Refactor

- Switch UI の実装は `@base-ui/react` の `<Switch>` に置換すると `color-angle-editor.tsx` 等と統一できる
  (本 PR では Cycle 5 のテスト緑化後に置換)
- `disabled` の伝播は Row props で行うが、props 数が増えてきたので `useDisabled` Context にする案もある (本 PR ではスコープ外)
- ヘッダー (auto-optimize ボタン + travel switch) を `<PanelHeader />` に切り出して `sewing-order-panel.tsx` の関数長を 100 行未満に保つ

---

## 7. サイクル依存グラフ

```
Cycle 1 (リスト表示)
   ↓
Cycle 2 (ドラッグ並び替え)
   ↓
Cycle 3 (行操作 lock/visible/delete)
   ↓
Cycle 4 (自動最適化ボタン)
   ↓
Cycle 5 (travel toggle + disabled 回帰)
```

すべて直列。Cycle 1 で導入する jsdom + Testing Library のセットアップは他全 Cycle の前提。
Cycle 3 で導入する `userEvent.click` パターンは Cycle 4-5 でも再利用する。

## 8. 回帰防止

1. **既存 vitest テストの environment 変更の影響を確認**:
   - `vitest.config.ts` を `environment: "node"` → `"jsdom"` にすると、既存 `stitch.test.ts` / `vectorize.test.ts` /
     `pathing.test.ts` 等が壊れる可能性がある。これらは Pure JS / TS なので jsdom でも動くはずだが、
     Pyodide / OpenCV / Three.js のグローバル参照が `window` に依存して問題を起こす可能性に注意
   - 必要に応じて test ファイルごとに `// @vitest-environment node` ディレクティブを付ける
2. **既存テストが全件 green**: 各 Cycle 完了時に `npx vitest run` 全件 (Phase 1-4 のテスト含む) を実行
3. **TypeScript 型エラーなし**: `npx tsc --noEmit` を Cycle 5 完了時に実行
4. **既存 UI が壊れない**:
   - 本 PR では `embroidery-studio.tsx` に `<SewingOrderPanel />` を追加配置するだけで既存コンポーネントは touch しない
   - 既存の `ImageUploader` / `ConversionSettings` / `StitchPreview` / `ResultPanel` / `ColorAngleEditor` の動作・スタイル変更なし
5. **`optimizeOrder` 自体の挙動回帰**: Phase 3 PR2 の `pathing.test.ts` が green であることを Cycle 4 完了時に確認
6. **依存追加によるバンドルサイズ**: `@dnd-kit/core` (~12kB gz) + `@dnd-kit/sortable` (~6kB gz) は許容範囲
7. **`@dnd-kit` の React 19 互換性**: 着手前に `@dnd-kit/core@^6.x` が React 19 で warning なく動くことを確認
   (peerDep の `react` 範囲が `>=16.8.0` であれば OK)

## 9. 受け入れ条件

- [ ] `src/components/sewing-order-panel.tsx` が新規作成され、`SewingOrderPanel` / `SewingOrderPanelProps` を export
- [ ] `src/components/__tests__/sewing-order-panel.test.tsx` の全テストが green
- [ ] `package.json` の `dependencies` に `@dnd-kit/core` と `@dnd-kit/sortable` が追加されている
- [ ] `package.json` の `devDependencies` に `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` が追加されている
- [ ] `vitest.config.ts` の `environment` が `"jsdom"` に切り替わっている
- [ ] **Cycle 1**: `objects` を `order` 昇順で表示し、各行に color chip / kind / id ラベルを持つ。空配列で empty-state
- [ ] **Cycle 2**: ドラッグ並び替えで `onReorder(orderedIds: string[])` が 0-indexed 順の id 配列で呼ばれる。`over=null` / 自身ドロップでは呼ばれない
- [ ] **Cycle 3**: lock / visibility / delete ボタンが各行に存在し、それぞれ `onToggleLocked(id, next)` / `onToggleVisible(id, next)` / `onDelete(id)` を呼ぶ。`locked=true` の行は aria-pressed=true
- [ ] **Cycle 4**: 「自動最適化」ボタンが `onOptimize()` を呼ぶ。`objects` が空または `disabled=true` のとき disabled
- [ ] **Cycle 5**: travel toggle (`role="switch"`) が `onShowTravelChange(next)` を呼ぶ。`disabled=true` のときすべての操作系ボタンが disabled
- [ ] `embroidery-studio.tsx` に `<SewingOrderPanel />` がインポート・配置されている (props は design store の値を渡す)
- [ ] **回帰**: `npx vitest run` 全件 green (Phase 1-4 + 新規)
- [ ] **回帰**: `npx tsc --noEmit` 型エラーなし
- [ ] **手動**: ブラウザで実際にドラッグして並び替えが反映される (Phase 5 計画書 12. 受け入れ条件「Sewing Order パネルで先頭の object を末尾にドラッグできる」)
- [ ] **手動**: 「自動最適化」ボタン押下で `locked: true` の object が動かないことを目視確認
- [ ] Phase 5 計画書 6.1 / 6.2 / 6.3 の仕様 (色チップ・kind アイコン・order・lock・visibility、自動最適化、travel 可視化トグル) を満たす

## 10. コミット粒度

TDD サイクル単位で 1 コミット (Red と Green を 1 コミットに含めるか、別コミットにするかは PR 内で統一)。
本 PR ではテストと実装を **同じコミットに含める** (各 Cycle が独立した「機能 + テスト」の単位として読める形)。

| Commit | サイクル | 内容 |
|---|---|---|
| 1 | 環境整備 | `chore(deps): add @dnd-kit, jsdom, testing-library and switch vitest env to jsdom` |
| 2 | Cycle 1 | `feat(ui): render sewing order list sorted by order field` |
| 3 | Cycle 2 | `feat(ui): wire @dnd-kit drag-and-drop to onReorder callback` |
| 4 | Cycle 3 | `feat(ui): add lock / visibility / delete row actions to sewing order panel` |
| 5 | Cycle 4 | `feat(ui): add auto-optimize button delegating to optimizeOrder` |
| 6 | Cycle 5 | `feat(ui): add travel visualization toggle and disabled state propagation` |
| 7 | 統合 | `feat(ui): mount SewingOrderPanel in EmbroideryStudio` |

各コミット境界で `npx vitest run` 全件 green が必須。Commit 7 は手動テストでの目視確認のみで自動テスト追加なし。

## 11. 想定 PR タイトル

`feat(ui): add sewing order panel with drag-and-drop and auto-optimize (phase 5 pr3)`

PR 本文には:
- Phase 5 計画書 (`plans/50-phase5-editor.md`) の「10. 実装ステップ 4」「6. Sewing Order パネル」に対応する旨
- 依存: Phase 5 PR1 (design store) / Phase 3 PR2 (`optimizeOrder`)
- 後続 PR (PR4: リアルタイム再生成 debounce / PR5: 3 カラムレイアウト) との接続点
- vitest environment を jsdom に切り替えたこと (既存テストへの影響なし)

を 4-6 行で記載する。

## 12. 注意事項

- **`@dnd-kit` の `id` 型は `UniqueIdentifier = string | number`**: パネルでは `EmbroideryObject.id: string` のみ扱うので `String(active.id)` でキャストし、`indexOf` で位置検索する
- **`@dnd-kit/sortable` の `arrayMove(items, from, to)`** は新配列を返す純関数。`onReorder` には常に新配列を渡す (in-place mutation 禁止)
- **`onReorder` の責務分離**: パネルは `orderedIds: string[]` のみ親に渡す。`EmbroideryObject.order` の再採番は design store (PR1) の `reorderObjects` が担う。これにより panel は order 値の生成ロジックを持たず、Phase 3 PR2 の `optimizeOrder` 経由の更新と「並び替えだけ別経路」になる二重実装を避ける
- **`locked: true` と自動最適化の関係**: パネルは `onOptimize()` を呼ぶだけで、locked 保護のロジックは `optimizeOrder` (Phase 3 PR2) が担う。本 PR の test では「locked 行があってもボタンが押せる」「click で onOptimize が呼ばれる」までを検証し、locked 保護のテストは `pathing.test.ts` に委ねる
- **`visible?: boolean` フィールド**: Phase 5 PR1 の責務として `EmbroideryObject` に追加される前提。`undefined === true` (= visible) の扱いを panel 側で吸収する
- **vitest environment の切り替えリスク**: `environment: "jsdom"` に切り替えると Pyodide / OpenCV / Three.js を import するモジュールがロードされたときに `window` 関連の I/O で例外を起こす可能性がある。test ファイル単位で `// @vitest-environment node` を付ける逃げ道を確保しておく
- **`role="listitem"`**: `<ul><li>` 構造で自動的に付与される。`data-object-id` 属性で id を取り出してアサートする
- **`role="switch"` と `role="button"`**: travel toggle は switch、lock / visibility / delete はそれぞれ意味的に switch (toggle) と button だが、本 PR では lock / visibility は `aria-pressed` を持つ button として実装し、travel toggle のみ switch とする (lock/visibility は per-row、travel は global の差を UI で示す)
- **`@base-ui/react` の `Switch`**: 既に依存にあるので利用可能。Cycle 5 の Green では `<button role="switch">` の手書きにし、Refactor で `<Switch>` への置換を行う
- **`embroidery-studio.tsx` への配線は Commit 7 で行う**: Cycle 1-5 はパネル単独でユニットテスト可能なため、`embroidery-studio.tsx` への配置は最後にまとめて行う。配線テストは「Phase 5 計画書 12. 受け入れ条件」で手動確認する
- **既存 `color-angle-editor.tsx` のテストは未存在**: 本 PR で「初の component テスト」を導入することになるので、後続の Phase 5 PR でも同様の testing-library パターンを再利用できるよう、`makeObj` ヘルパや `baseProps` 定数は明示的に export せず test 内に閉じるが、コメントで「次 PR で共通化を検討」と残す
- **AGENTS.md 警告**: Next.js 16 の breaking changes に注意。本 PR は React コンポーネントのみで `app/` ルーティングや Server Components の挙動に触れないため、影響は限定的
