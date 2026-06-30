# Phase 5 PR4: Node Editor (パス編集) — TDD 実装計画書

## 1. 概要

Phase 5 PR4 では `src/components/preview-canvas-editable.tsx` に **ノード編集モード (`editMode === "node"`)** を追加し、`design-store` (PR1) が保持する `selectedObjectId` で示された object の外形 polygon (`shape.outer`) を、ユーザがプレビュー上で頂点単位に直接編集できるようにする。
具体的には (a) 選択中 object の各頂点を丸点として描画、(b) 丸点ドラッグで `shape.outer[i]` を移動、(c) 辺の中点クリックで頂点挿入、(d) 選択中頂点を Delete キーで削除 (頂点数 3 未満になる削除は拒否) を実装する。
編集中は `useEffect` の再生成 debounce を 200ms → **100ms** に縮め、操作のレスポンス感を確保する。すべての頂点更新は `useDesignStore` の `updateObject(id, { shape: ... })` を経由するため、Sewing Order / Object Inspector / Stitch 再計算は既存の購読経路で自動追従する。
本 PR の範囲は Phase 5 計画書「10. 実装ステップ」の **ステップ 7** + 「5.2 ノード編集モード」のみ。ペンモード (5.3) / travel 可視化 (ステップ 8) / JSON 保存 / Undo はスコープ外。

## 2. 依存関係

- **完了済み前提**: Phase 5 PR1 (`design-store.ts` で `design` / `selectedObjectId` / `editMode` / `updateObject(id, patch)` が export 済み), Phase 5 PR2 (`object-inspector.tsx` 経由で `editMode = "node"` への切替トグルが UI 上に存在)
- **型依存**: `src/lib/pipeline/types.ts` の `Shape`, `Polygon`, `Point2D` (`shape.outer: Polygon = Point2D[]`)
- **既存コンポーネント参照**: `src/components/stitch-preview.tsx` (canvas のスケール換算 `Math.min(480 / widthMm, 480 / heightMm)` を踏襲)
- **後続依存**:
  - Phase 5 PR5 (Undo/Redo) で本 PR の `updateObject` 呼び出しが history stack に積まれる前提
  - Phase 5 PR6 (発展 = ペンモード) では本 PR で導入する `hit-test` ユーティリティを再利用する

## 3. 影響ファイル

### 編集
- `src/components/preview-canvas-editable.tsx` — ノード編集モードのレンダリング・ヒットテスト・ドラッグ / クリック / Delete ハンドラを追加。`editMode === "node"` で overlay を表示。
- `src/components/__tests__/preview-canvas-editable.test.tsx` — Cycle 1-5 のテストを追加 (jsdom 環境、`@testing-library/react`)

### 新規 (本 PR で抽出)
- `src/components/preview-canvas/node-hit-test.ts` — `pickVertex`, `pickEdgeMidpoint`, `insertVertexAt`, `removeVertexAt` などの純関数ユーティリティ。Refactor フェーズで切り出し、テスト容易性と PR6 ペンモードでの再利用性を確保。
- `src/components/preview-canvas/__tests__/node-hit-test.test.ts` — 純関数ユニットテスト (Cycle 5 で追加)

### 参照のみ
- `src/components/design-store.ts` (PR1 で導入済み): `useDesignStore`, `updateObject(id, patch)`, `selectedObjectId`, `editMode`
- `src/lib/pipeline/types.ts`: `Shape`, `Polygon`, `Point2D`

## 4. テスト環境

- フレームワーク: **vitest 4.1.6** + **@testing-library/react** + **jsdom**
- 既存設定 (`vitest.config.ts`) は `environment: "node"` だが、本 PR で `.test.tsx` を扱う際に jsdom が必要。`describe.concurrent` ではなく、ファイル先頭に `// @vitest-environment jsdom` プラグマを付与する方針 (vitest.config への影響を避ける)。
- 実行コマンド: `npm test`
- テストファイル配置: `src/components/__tests__/<component>.test.tsx`
- import 規約: `import { describe, it, expect, vi } from "vitest";` + `import { render, fireEvent, screen } from "@testing-library/react";`
- 補助: jsdom には pointer event がないため、`mousedown`/`mousemove`/`mouseup` の `fireEvent` で代用。canvas は jsdom で `getContext` がスタブのため、描画検証は「`useDesignStore` への副作用」と「DOM 上の SVG ノード」で行う (= 描画レイヤは **SVG を選定**、§5.1 参照)。

## 5. レンダリング戦略の選定

### 5.1 SVG 採用 (canvas 不採用)

ノード編集モードの overlay 部分は **SVG** で実装する。理由:

1. **テスト容易性**: jsdom は canvas の描画 API をスタブするため、丸点や辺ハンドルの存在を assert できない。SVG なら `<circle data-testid="vertex-0">` のような DOM ノードで TDD 駆動が可能。
2. **ヒットテストの簡素化**: SVG 要素は `onMouseDown` / `onClick` を要素単位で発火できるので、「どの頂点 / どの辺がクリックされたか」を React イベントハンドラの引数で受け取れる。canvas の場合は `getBoundingClientRect()` + 座標逆算 + 自前の `pickVertex` が必須。
3. **アクセシビリティ**: 将来 `role="button"` / `aria-label` を貼って tab navigation を提供しやすい。
4. **既存実装との整合**: `stitch-preview.tsx` の stitch 描画は canvas のままで、その上に position: absolute の SVG overlay を重ねる構成にする。stitch 自体は SVG で扱うとパス本数で重くなるので **canvas は維持** する。
5. **scale 計算**: canvas と同じ `scale = Math.min(480 / widthMm, 480 / heightMm)` を使い、SVG の `viewBox="0 0 widthMm heightMm"` で mm → px 変換を SVG ネイティブに任せられる。

> 結論: **stitch は canvas、編集 overlay (頂点・辺ハンドル) は SVG**。

### 5.2 mm ↔ px 変換

- `viewBox="0 0 widthMm heightMm"` を使うため、頂点座標 `[x, y]` (px 単位だが imagetracerjs 経由で原画像 px と一致) を design の `widthMm / imageWidthPx` でスケールして SVG 座標に乗せる。
- `mousedown` 等のイベントは `event.clientX / clientY` を取得 → `svg.getScreenCTM().inverse()` で `viewBox` 座標へ逆変換 → さらに `imageWidthPx / widthMm` を掛けて画像 px に戻して `shape.outer` を更新。
- ヒット判定の半径は SVG ピクセル基準で 6px (= mm 換算で `6 / scale`)。

## 6. インターフェース設計

```tsx
// src/components/preview-canvas-editable.tsx
"use client";
import { useDesignStore } from "@/components/design-store";

type Props = {
  // stitch 描画は親で計算済みのものを渡す (既存 stitch-preview.tsx と同じ流れ)。
};

export function PreviewCanvasEditable(props: Props): JSX.Element;
```

```ts
// src/components/preview-canvas/node-hit-test.ts
import type { Polygon, Point2D } from "@/lib/pipeline/types";

/** クリック座標 (画像 px) に最も近い頂点 index。指定半径外なら null。 */
export function pickVertex(
  outer: Polygon,
  px: Point2D,
  hitRadiusPx: number,
): number | null;

/** クリック座標に最も近い辺の中点 index (= 辺の始点 index)。指定半径外なら null。 */
export function pickEdgeMidpoint(
  outer: Polygon,
  px: Point2D,
  hitRadiusPx: number,
): number | null;

/** edgeIndex の辺の中点に新頂点を挿入した polygon を返す (immutable)。 */
export function insertVertexAt(outer: Polygon, edgeIndex: number): Polygon;

/**
 * vertexIndex を削除した polygon を返す。
 * 結果の頂点数が 3 未満になる場合は null を返す (拒否)。
 */
export function removeVertexAt(outer: Polygon, vertexIndex: number): Polygon | null;
```

## 7. TDD サイクル

### Cycle 1: 選択中 object の各頂点が丸点として描画される

#### Red — 失敗するテスト

```tsx
// src/components/__tests__/preview-canvas-editable.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PreviewCanvasEditable } from "../preview-canvas-editable";
import { useDesignStore } from "../design-store";

const triangleShape = { outer: [[0, 0], [100, 0], [50, 80]], holes: [] };

beforeEach(() => {
  useDesignStore.setState({
    design: {
      widthMm: 100,
      heightMm: 80,
      imageWidthPx: 100,
      imageHeightPx: 80,
      objects: [{ id: "obj-1", shape: triangleShape, kind: "fill", /* ... */ }],
    },
    selectedObjectId: "obj-1",
    editMode: "node",
  });
});

it("renders one vertex handle per outer vertex when editMode is node", () => {
  const { container } = render(<PreviewCanvasEditable />);
  const handles = container.querySelectorAll('[data-testid^="vertex-handle-"]');
  expect(handles).toHaveLength(3);
  expect(container.querySelector('[data-testid="vertex-handle-0"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="vertex-handle-2"]')).not.toBeNull();
});

it("does NOT render vertex handles when editMode is select", () => {
  useDesignStore.setState({ editMode: "select" });
  const { container } = render(<PreviewCanvasEditable />);
  expect(container.querySelectorAll('[data-testid^="vertex-handle-"]')).toHaveLength(0);
});
```

**観点**: `editMode === "node"` のとき、選択中 object の `shape.outer` の頂点数ぶん `data-testid="vertex-handle-{i}"` を持つ `<circle>` (SVG) が描画される。他モードでは描画されない。

**失敗理由**: 現状 `PreviewCanvasEditable` は存在しないか、ノード編集 overlay が未実装。`querySelectorAll` の結果が 0。

#### Green — 最小実装

- 変更: `src/components/preview-canvas-editable.tsx`
- 方針:
  - `useDesignStore` から `design`, `selectedObjectId`, `editMode` を取得
  - 既存 stitch canvas (`<canvas>`) の上に `position: absolute` で SVG overlay を重ねる
  - `editMode === "node" && selectedObject` のとき、`selectedObject.shape.outer.map((p, i) => <circle data-testid={`vertex-handle-${i}`} cx={p[0]} cy={p[1]} r={4 / scale} />)` を描画
  - SVG の `viewBox` は `0 0 ${imageWidthPx} ${imageHeightPx}` (内部座標 = 画像 px)
  - `scale = Math.min(480 / widthMm, 480 / heightMm)` を引き続き使用 (handle 半径の見た目を一定にする)

#### Refactor

- 不要 (最初のサイクル、まだ重複なし)

---

### Cycle 2: 頂点ドラッグで `shape.outer[i]` の座標が更新される

#### Red — 失敗するテスト

```tsx
it("updates shape.outer[i] when a vertex handle is dragged", () => {
  const updateObject = vi.fn();
  useDesignStore.setState({ updateObject });

  const { container } = render(<PreviewCanvasEditable />);
  const handle1 = container.querySelector('[data-testid="vertex-handle-1"]')!;
  const svg = container.querySelector("svg")!;

  // 画像 px (100, 0) に居る頂点 1 を画像 px (120, 10) へドラッグ
  fireEvent.mouseDown(handle1, { clientX: 100, clientY: 0 });
  fireEvent.mouseMove(svg, { clientX: 120, clientY: 10 });
  fireEvent.mouseUp(svg, { clientX: 120, clientY: 10 });

  // updateObject("obj-1", { shape: { outer: [...new vertices], holes: [] } }) が呼ばれる
  expect(updateObject).toHaveBeenCalledWith(
    "obj-1",
    expect.objectContaining({
      shape: expect.objectContaining({
        outer: [[0, 0], [120, 10], [50, 80]],
      }),
    }),
  );
});

it("does NOT update shape until mouseup (preview-only during drag)", () => {
  // Optional: ドラッグ中の中間更新はローカル state のみで、確定は mouseup 時
  // (もし PR で「ドラッグ中も逐次 store 更新」方針を採るなら本テストは省略)
});
```

**観点**: SVG 座標系を画像 px に変換した上で `updateObject(selectedObjectId, { shape: { outer: 新座標列, holes: 既存 } })` が **mouseup 時** に呼ばれる。

**失敗理由**: ドラッグ用のハンドラ (`onMouseDown`/`onMouseMove`/`onMouseUp`) が未実装。`updateObject` の mock 呼び出し回数 0 で fail。

#### Green — 最小実装

- 変更: `src/components/preview-canvas-editable.tsx`
- 方針:
  - state `const [draggingVertex, setDraggingVertex] = useState<number | null>(null);`
  - `<circle onMouseDown={(e) => { setDraggingVertex(i); e.stopPropagation(); }}>`
  - SVG ルートに `onMouseMove`, `onMouseUp` を bind
  - `onMouseMove`: `draggingVertex !== null` のとき、`svg.getScreenCTM().inverse()` で `clientX/Y` を viewBox 座標へ逆変換 → ローカル preview state にだけ反映 (再描画用)
  - `onMouseUp`: `updateObject(selectedObjectId, { shape: { ...shape, outer: 新 outer } })` を呼び、`setDraggingVertex(null)`
- mm ↔ px 変換は `getScreenCTM` で SVG 内座標 = 画像 px に揃えてあるので追加変換不要

#### Refactor

- イベントハンドラ内で繰り返す `getScreenCTM().inverse()` ロジックを `function clientToImagePx(svg, ev): Point2D` ヘルパーへ抽出。コンポーネント先頭またはサブモジュール `preview-canvas/coords.ts` に移す。

---

### Cycle 3: 辺の中点クリックで新頂点が挿入される

#### Red — 失敗するテスト

```tsx
it("renders one edge midpoint handle per outer edge", () => {
  const { container } = render(<PreviewCanvasEditable />);
  // 三角形なので辺は 3 本
  expect(container.querySelectorAll('[data-testid^="edge-midpoint-"]')).toHaveLength(3);
});

it("inserts a new vertex at the edge midpoint when its handle is clicked", () => {
  const updateObject = vi.fn();
  useDesignStore.setState({ updateObject });

  const { container } = render(<PreviewCanvasEditable />);
  // 辺 0: (0,0) → (100,0) の中点 (50, 0) をクリック
  const mid0 = container.querySelector('[data-testid="edge-midpoint-0"]')!;
  fireEvent.click(mid0, { clientX: 50, clientY: 0 });

  expect(updateObject).toHaveBeenCalledWith(
    "obj-1",
    expect.objectContaining({
      shape: expect.objectContaining({
        // 辺 0 (index 0 と 1 の間) に中点 (50, 0) を挿入 → 頂点 4 個
        outer: [[0, 0], [50, 0], [100, 0], [50, 80]],
      }),
    }),
  );
});
```

**観点**: 各辺の中点に半透明の小さい `<circle data-testid="edge-midpoint-{i}">` を表示し、クリックで `outer.splice(i + 1, 0, midpoint)` 相当の新 polygon を生成して `updateObject` を呼ぶ。

**失敗理由**: 辺ハンドルが未描画 + クリックハンドラ未実装。

#### Green — 最小実装

- 変更: `src/components/preview-canvas-editable.tsx`
- 方針:
  - `selectedObject.shape.outer` を 2 個 1 組で走査し、各辺の中点 `[(p[0]+q[0])/2, (p[1]+q[1])/2]` を SVG circle で描画 (頂点ハンドルより小さく、半透明)
  - `onClick`: `const newOuter = [...outer.slice(0, i+1), midpoint, ...outer.slice(i+1)]` → `updateObject(id, { shape: { ...shape, outer: newOuter } })`
  - 頂点ドラッグハンドラと干渉しないよう `event.stopPropagation()` を呼ぶ

#### Refactor

- 不要 (Cycle 5 でまとめてユーティリティ抽出)

---

### Cycle 4: 選択中頂点を Delete キーで削除 / 頂点数 3 未満は拒否

#### Red — 失敗するテスト

```tsx
it("removes the focused vertex when Delete key is pressed", () => {
  const updateObject = vi.fn();
  useDesignStore.setState({ updateObject });

  // 頂点 4 個の正方形をセットアップ
  useDesignStore.setState({
    design: {
      ...useDesignStore.getState().design!,
      objects: [{
        id: "obj-1",
        shape: { outer: [[0, 0], [100, 0], [100, 80], [0, 80]], holes: [] },
        kind: "fill",
      }],
    },
  });

  const { container } = render(<PreviewCanvasEditable />);
  const handle2 = container.querySelector('[data-testid="vertex-handle-2"]')!;

  // クリックで頂点 2 を focus
  fireEvent.mouseDown(handle2, { clientX: 100, clientY: 80 });
  fireEvent.mouseUp(handle2, { clientX: 100, clientY: 80 });

  // Delete キー押下
  fireEvent.keyDown(window, { key: "Delete" });

  expect(updateObject).toHaveBeenCalledWith(
    "obj-1",
    expect.objectContaining({
      shape: expect.objectContaining({
        outer: [[0, 0], [100, 0], [0, 80]], // 頂点 2 が消える
      }),
    }),
  );
});

it("refuses to delete a vertex when the polygon would have fewer than 3 vertices", () => {
  const updateObject = vi.fn();
  useDesignStore.setState({ updateObject });
  // 既にデフォルトの三角形 (3 頂点) で setup 済み

  const { container } = render(<PreviewCanvasEditable />);
  const handle0 = container.querySelector('[data-testid="vertex-handle-0"]')!;
  fireEvent.mouseDown(handle0, { clientX: 0, clientY: 0 });
  fireEvent.mouseUp(handle0, { clientX: 0, clientY: 0 });

  fireEvent.keyDown(window, { key: "Delete" });

  expect(updateObject).not.toHaveBeenCalled();
});

it("ignores Delete key when no vertex is focused", () => {
  const updateObject = vi.fn();
  useDesignStore.setState({ updateObject });

  render(<PreviewCanvasEditable />);
  fireEvent.keyDown(window, { key: "Delete" });

  expect(updateObject).not.toHaveBeenCalled();
});
```

**観点**:
1. 直前にクリック/ドラッグした頂点を「focus 状態」として記録
2. `Delete` キー (`Backspace` も許容するなら後で拡張) で focused vertex を削除
3. 削除後の頂点数が 3 未満なら **更新拒否** (toast でユーザに通知してもよい)
4. focus が無い状態の Delete は無視

**失敗理由**: focus state も keydown listener も未実装。

#### Green — 最小実装

- 変更: `src/components/preview-canvas-editable.tsx`
- 方針:
  - `const [focusedVertex, setFocusedVertex] = useState<number | null>(null);`
  - 頂点ハンドルの `onMouseDown` で `setFocusedVertex(i)` (Cycle 2 のドラッグ開始と兼用)
  - `useEffect` で `window.addEventListener("keydown", ...)` を `editMode === "node"` のとき bind
  - handler 内: `if (key !== "Delete") return; if (focusedVertex == null) return; const next = outer.filter((_, i) => i !== focusedVertex); if (next.length < 3) return; updateObject(id, { shape: { ...shape, outer: next } }); setFocusedVertex(null);`
  - cleanup で `removeEventListener`

#### Refactor

- `editMode !== "node"` のとき keydown handler を bind しない / 別 object 選択時に focus をリセットする副作用を `useEffect` の依存配列で整理。

---

### Cycle 5: hit-test ユーティリティ共通化 + debounce 100ms

#### Red — 失敗するテスト

```ts
// src/components/preview-canvas/__tests__/node-hit-test.test.ts
import { describe, it, expect } from "vitest";
import { pickVertex, pickEdgeMidpoint, insertVertexAt, removeVertexAt } from "../node-hit-test";

describe("pickVertex", () => {
  const tri = [[0, 0], [100, 0], [50, 80]];
  it("returns the index of the closest vertex within hitRadius", () => {
    expect(pickVertex(tri, [2, 1], 5)).toBe(0);
    expect(pickVertex(tri, [98, 2], 5)).toBe(1);
  });
  it("returns null when no vertex is within hitRadius", () => {
    expect(pickVertex(tri, [50, 40], 5)).toBeNull();
  });
});

describe("pickEdgeMidpoint", () => {
  it("returns the edge index whose midpoint is within hitRadius", () => {
    const tri = [[0, 0], [100, 0], [50, 80]];
    // 辺 0 の中点 = (50, 0)
    expect(pickEdgeMidpoint(tri, [51, 1], 5)).toBe(0);
  });
});

describe("insertVertexAt", () => {
  it("inserts midpoint after edgeIndex (immutable)", () => {
    const tri = [[0, 0], [100, 0], [50, 80]];
    const out = insertVertexAt(tri, 0);
    expect(out).toEqual([[0, 0], [50, 0], [100, 0], [50, 80]]);
    expect(out).not.toBe(tri); // 同一参照でないこと
  });
});

describe("removeVertexAt", () => {
  it("returns polygon without the vertex", () => {
    const sq = [[0, 0], [100, 0], [100, 80], [0, 80]];
    expect(removeVertexAt(sq, 1)).toEqual([[0, 0], [100, 80], [0, 80]]);
  });
  it("returns null when result would have fewer than 3 vertices", () => {
    const tri = [[0, 0], [100, 0], [50, 80]];
    expect(removeVertexAt(tri, 0)).toBeNull();
  });
});
```

加えて、編集中 debounce の検証 (integration):

```tsx
it("uses 100ms debounce while editMode === 'node' (instead of 200ms)", () => {
  // 親 (EmbroideryStudio) の useEffect debounce を測る。
  // ここではコンポーネント単位での確認に留め、実 debounce 値は定数 export で検証する。
  expect(NODE_EDIT_DEBOUNCE_MS).toBe(100);
});
```

**観点**: hit-test ロジックを `node-hit-test.ts` に分離し、コンポーネントは「DOM とイベント橋渡し」だけに専念。debounce 値は定数として export し、`editMode === "node"` のとき 100ms を使う。

**失敗理由**: `node-hit-test.ts` が未作成 / `NODE_EDIT_DEBOUNCE_MS` 未 export。

#### Green — 最小実装

- 新規: `src/components/preview-canvas/node-hit-test.ts` に純関数 4 つを実装
- `preview-canvas-editable.tsx` 内のインライン処理をユーティリティ呼び出しに置換 (Cycle 2-4 で書いたロジックを移植)
- `export const NODE_EDIT_DEBOUNCE_MS = 100;` を `preview-canvas-editable.tsx` から export し、親 `EmbroideryStudio` の debounce タイマで `editMode === "node" ? NODE_EDIT_DEBOUNCE_MS : 200` と分岐

#### Refactor

- `coords.ts` (Cycle 2 で抽出) と `node-hit-test.ts` を `preview-canvas/` ディレクトリにまとめ、`index.ts` で barrel export
- コンポーネント本体 (`preview-canvas-editable.tsx`) を 200 行以下に保つ

---

## 8. サイクル依存グラフ

```
Cycle 1 (頂点描画)
   ↓
Cycle 2 (ドラッグ更新) ──┐
   ↓                      ↓
Cycle 3 (辺中点挿入)     Cycle 4 (Delete + 3 頂点ガード)
   ↓                      ↓
   └──────→ Cycle 5 (ユーティリティ抽出 + debounce 100ms)
```

Cycle 1 が最も依存が少ない。Cycle 2 はドラッグ起点の `setFocusedVertex` が Cycle 4 の Delete の前提になる。Cycle 5 は前 4 サイクルのロジックを refactor するため最後。

## 9. 回帰防止

- `editMode === "select"` (デフォルト) では SVG overlay が空 (Cycle 1 の 2nd test で担保)
- 既存 stitch canvas の描画は影響を受けない (overlay は absolute positioning)
- `selectedObjectId === null` のときも overlay は空
- ドラッグ中のローカル preview が `updateObject` を mouseup までは呼ばないため、stitch 再生成が連続発火しない
- 削除拒否 (頂点数 3 未満) で polygon が壊れない保証 (`removeVertexAt` の null 返却で担保)
- Cycle 5 で `node-hit-test.ts` を抽出するが、Cycle 1-4 の component-level テストは引き続き green を保つ
- `npm test` の既存テスト (Phase 1-4 系) は本 PR の変更ファイル外なので影響なし

## 10. 受け入れ条件

- [ ] `editMode === "node"` で選択中 object の外形頂点が丸点として描画される (Cycle 1)
- [ ] 各頂点ハンドルをドラッグして mouseup すると `shape.outer[i]` の座標が更新される (Cycle 2)
- [ ] 辺の中点ハンドルをクリックすると、その辺の中央に新頂点が挿入される (Cycle 3)
- [ ] 直前にクリックした頂点を Delete キーで削除できる (Cycle 4)
- [ ] 頂点数が 3 未満になる削除は拒否され、`updateObject` が呼ばれない (Cycle 4)
- [ ] hit-test ロジックが `node-hit-test.ts` に分離され、純関数ユニットテストが green (Cycle 5)
- [ ] 編集中 (`editMode === "node"`) の debounce が 100ms に縮まる (Cycle 5)
- [ ] `editMode !== "node"` では SVG overlay が描画されず既存プレビューに影響しない (Cycle 1)
- [ ] `npm test` 全体が green
- [ ] `npm run lint` が clean

## 11. コミット粒度

TDD サイクル単位 (= 5 コミット):

1. `test(ui): add node-mode vertex rendering test for PreviewCanvasEditable` → `feat(ui): render vertex handles in node edit mode`
2. `test(ui): add vertex drag test` → `feat(ui): support vertex drag to update shape.outer`
3. `test(ui): add edge midpoint click test` → `feat(ui): insert vertex on edge midpoint click`
4. `test(ui): add Delete-key vertex removal tests` → `feat(ui): delete focused vertex with guard (>=3 vertices)`
5. `test(ui): add node-hit-test util unit tests` → `refactor(ui): extract node-hit-test helpers and shorten node-edit debounce to 100ms`

各サイクル内では `test:` (Red) → `feat:`/`refactor:` (Green/Refactor) の 2 コミットに分けてもよい (Red コミットには `// @ts-expect-error` などで一時的に通す形が望ましい)。

## 12. 想定 PR タイトル

`feat(ui): add node editor for path manipulation (phase 5 pr4)`

## 13. 注意事項

- jsdom には `SVGElement.prototype.getScreenCTM` がデフォルト未実装の場合がある。テストで `clientToImagePx` を直接ユニットテストするか、`PreviewCanvasEditable` 側で `getScreenCTM` 失敗時に identity matrix fallback を入れる
- React 19 + Next 16 では `"use client"` directive が必須。`preview-canvas-editable.tsx` 先頭に明記
- `useDesignStore` の state を `beforeEach` でリセットすること (テスト間汚染防止)
- 頂点が 3 個未満になる削除拒否時に、UX 改善として `sonner` の `toast.warning("最低 3 頂点必要です")` を出してもよい (PR スコープ内で許容)
- `Delete` キーは macOS では Backspace に該当することが多い。ヘルパー関数で `key === "Delete" || key === "Backspace"` を許容してもよいが、ブラウザ戻る挙動と衝突しないよう `editMode === "node"` 時のみハンドルする
- Refactor フェーズで `coords.ts` / `node-hit-test.ts` を切り出す際、既存コンポーネントのインポートパスを `@/components/preview-canvas/...` に統一
