# Phase 5. Editor - パス編集 / 縫い順編集 / オブジェクトプロパティ UI

> **Status: ✅ Complete (基盤 + 純ロジック層)** (2026-05-26 merged PR #20 / #21 / #22 / #23 / #24)
> - PR20 (#20): design store (Zustand vanilla) + hit-test + PreviewCanvasEditable (クリック選択)
> - PR21 (#21): ObjectInspector (kind / 角度 / 密度 / pullComp / underlay 編集) + 純ロジック patch ビルダ
> - PR22 (#22): SewingOrderPanel (@dnd-kit/sortable DnD 並び替え + lock/visible/delete + 自動最適化) + store の removeObject/applyOptimizeOrder
> - PR23 (#23): ノード編集モード (SVG オーバーレイで頂点 add/move/delete) + node-hit-test 純ロジック
> - PR24 (#24): JSON serialize/deserialize + Undo/Redo (immer history stack) + VisualizationToggle + UndoRedoButtons
>
> 全 PR 共通: テスト 399 → 487 (累計 +88: store 26 / hit-test 5 / inspector 10 / sewing 16 / node 15 / serialize 8 / history 11 / 他) / npx tsc --noEmit pass / npm run build pass / lint warning 0 増。
>
> **新規依存** (ユーザー事前承認済み): zustand@^5 (PR20) / @dnd-kit/core@^6 + sortable@^10 + utilities@^3 (PR22) / immer@^10 (PR24)。
>
> **Phase 5 完成時の follow-up (本セッション外、要 visual 検証)**:
> - `embroidery-studio.tsx` の 3 カラムレイアウト再構成 (ObjectInspector / SewingOrderPanel / VisualizationToggle / UndoRedoButtons / PreviewCanvasEditable の正式配置)
> - `PreviewCanvasEditable` への visualization フラグ (showTravel / showJump / showTrim) 購読配線とキャンバス上の travel/jump/trim 描画 (グレー線 / 破線 / 赤丸)
> - design 編集の debounce 200ms → `renderStitches` → `writeEmbroidery` の自動再生成パス
> - `EmbroideryStudio` の旧 useState から `useDesignStore` への完全移行
>
> 上記 follow-up は Claude Code 環境ではブラウザ visual 検証不可のため、ユーザー側で manual 統合する想定で基盤はすべて準備済み (各 panel / hook を import するだけで動く)。
>
> Phase 5 発展課題 (本 Phase 範囲外): ペンモード (新規 object 描画) / Bezier 編集 / グループ化 / TrueView プレビュー / マルチ選択 / クラウド同期。

ここまでで「自動デジタイズの品質」を上げてきた。Phase 5 は **ユーザーが手で調整できる**
編集 UI を整え、Brother PE-Design の Sewing Order や Wilcom のオブジェクトプロパティ Docker
に相当するワークフローを提供する。

## 1. 目的

- **オブジェクト選択**: プレビュー上でクリックして 1 つの object を選択
- **オブジェクトプロパティ編集**: 選択中の object の kind / 角度 / 密度 / 補正 / underlay を編集
- **パス編集**: 外形と穴のノードを追加/移動/削除
- **縫い順編集**: Sewing Order パネル (リスト) でドラッグ並び替え
- **リアルタイム再生成**: 編集即プレビュー反映 (再 stitch 計算)

## 2. 現状参照

- `src/components/embroidery-studio.tsx` がメイン画面
- `src/components/stitch-preview.tsx` は 2D プレビュー
- `src/components/stitch-preview-3d.tsx` は 3D プレビュー (Three.js)
- `src/components/color-angle-editor.tsx` は色別角度のみ編集 (これを置き換え/拡張)
- `src/components/conversion-settings.tsx` は global 設定 UI

object 単位の編集 UI は今は存在しない。

## 3. UI 構造

```
+--------------------------------------------------------------+
| Header (タイトル / アクション)                                 |
+------------------+-------------------+-----------------------+
| 設定パネル        | プレビュー           | Sewing Order          |
| - Fabric         | (2D / 3D 切替)      | (object リスト, DnD)   |
| - global density |                    |                       |
| - 出力フォーマット  | クリックで object 選択 | 各行に                 |
|                  | ノード編集モード切替   |  ・色 / kind          |
| Object Inspector |                    |  ・order              |
| (選択中 object   |                    |  ・lock 切替          |
|  のプロパティ)    |                    |  ・visibility 切替    |
|                  |                    |                       |
+------------------+-------------------+-----------------------+
```

`Object Inspector` の中身:
- kind 切替 (run / satin / fill)
- 角度スライダ
- 密度スライダ
- pull comp スライダ
- underlay セレクト
- entry point ピン (プレビュー上でクリック指定)

## 4. ステート設計

`EmbroideryStudio` の `useState` を拡張:

```ts
const [design, setDesign] = useState<EmbroideryDesign | null>(null);
const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
const [editMode, setEditMode] = useState<"select" | "node" | "pen">("select");
```

編集 → 再 stitch 計算は debounce で 200ms 程度。

```ts
useEffect(() => {
  if (!design) return;
  const t = setTimeout(async () => {
    const pattern = await renderStitches(design);
    const blob = await writeEmbroidery({ pattern, format: design.format });
    setStitchResult({ ... });
  }, 200);
  return () => clearTimeout(t);
}, [design]);
```

`buildObjects` / `applyFabricProfile` までは画像が変わらない限り再実行不要。`renderStitches` 以降だけ走らせる。

## 5. プレビュー上の選択 / ノード編集

### 5.1 選択モード

- 2D プレビューで object 表示時に、各 object に hit-test 用の polygon を持たせる
- クリック時に最近接 object を選択 (point-in-polygon)
- 選択中の object は外形をハイライト表示

### 5.2 ノード編集モード

- 選択中の object の外形 polygon の頂点を丸点で表示
- ドラッグで頂点移動
- 辺の中点クリックで頂点追加
- 頂点を Delete キーで削除
- 編集中は debounce を 100ms に縮める

### 5.3 ペンモード (発展)

- 新規 object を描く: クリックで頂点を打ち、Enter で確定
- kind は初期値 fill、props はデフォルト
- Phase 5 v1 では実装しない (発展課題)

### 5.4 ライブラリ選定

純 React + canvas 2D で十分。SVG でも可。
複雑になるなら `react-konva` 等を検討。

## 6. Sewing Order パネル

### 6.1 機能

- object を縫う順に縦リスト表示
- 行に色チップ / kind アイコン / 短いラベル (例 "fill #3 / red")
- ドラッグで並び替え (`@dnd-kit/core` 推奨, MIT)
- 行の右に「lock」「show/hide」「delete」アイコン
- 並び替えると `EmbroideryObject.order` を更新 → debounce 再生成

### 6.2 自動最適化ボタン

Brother の `Optimize Sewing Order` 相当:

- 「自動最適化」ボタンで Phase 3 の `optimizeOrder` を再実行
- `locked: true` の object は移動させない

### 6.3 トラベル可視化

トグルで「travel run / jump / trim を表示」を ON/OFF。
プレビュー上で travel は薄いグレー、jump は破線、trim は赤丸で表示。

## 7. Fabric / Global 設定の整理

`conversion-settings.tsx` を 2 段構成に:

- **生地** セクション (fabric selector + override スライダ群)
- **出力** セクション (format / widthMm / colorCount)

global density / pull comp は fabric の defaultDensityMm / pullCompPerWidth を override する形にする。

## 8. データ永続化 (推奨)

`EmbroideryDesign` を `localStorage` または IndexedDB に保存。

- 画像 (Blob)
- design (JSON)
- 直近の編集履歴 (undo/redo, 20 操作分)

Phase 5 v1 では JSON のみ。画像は別途。

### 8.1 Undo / Redo

Zustand or immer + simple history stack。

```ts
type HistoryState = { past: EmbroideryDesign[]; current: EmbroideryDesign; future: EmbroideryDesign[] };
```

## 9. ファイル構成

```
src/components/
  object-inspector.tsx       NEW
  sewing-order-panel.tsx     NEW
  preview-canvas-editable.tsx  NEW   (既存 stitch-preview.tsx を拡張)
  pen-tool.tsx               NEW   (発展)
  design-store.ts            NEW   (Zustand store or React Context)
src/lib/design/
  history.ts                 NEW   (undo/redo)
  serialize.ts               NEW   (JSON 保存/読込)
```

## 10. 実装ステップ

- [ ] 1. `design-store.ts` に Zustand store を作り、`design` / `selectedObjectId` / `editMode` を管理
- [ ] 2. `preview-canvas-editable.tsx` で object クリック選択を実装
- [ ] 3. `object-inspector.tsx` を実装 (まず kind / 角度 / 密度のみ)
- [ ] 4. `sewing-order-panel.tsx` を実装 (リスト + dnd-kit)
- [ ] 5. `EmbroideryStudio` でレイアウト再構成 (3 カラム)
- [ ] 6. リアルタイム再生成 (debounce 200ms)
- [ ] 7. ノード編集モード追加
- [ ] 8. travel/jump 可視化トグル
- [ ] 9. JSON 保存/読込
- [ ] 10. Undo / Redo

## 11. テスト

UI のため大半は手動テスト + Storybook 推奨。自動テストは:

- `design-store.test.ts`:
  - `setObjectProps` で対象 object のみ更新される
  - `reorderObjects` で order が更新される
  - `applyOptimizeOrder` で locked object は動かない
- `serialize.test.ts`:
  - design を JSON 化して戻すと等価

## 12. 受け入れ条件

- [ ] 100×100mm の画像をアップロードして、1 つの object を選択し、kind を fill→satin に変更するとプレビューが 1 秒以内に更新される
- [ ] Sewing Order パネルで先頭の object を末尾にドラッグできる
- [ ] ノード編集モードで外形の 1 頂点を 5mm 動かすと、その object の stitch が追従する
- [ ] 「自動最適化」ボタンで Phase 3 の最適化がトリガされる
- [ ] design を JSON 化して別タブで読み込んでも同じプレビューが出る

## 13. 発展課題

- ペンモードで object 追加
- パスの Bezier 編集 (現状はポリゴンのみ)
- グループ化 / レイヤー管理
- アルファ・テクスチャプレビュー (Wilcom の TrueView 相当)
- マルチ選択 + 一括プロパティ変更
- 編集履歴のクラウド同期
