# Phase 1 PR4: render/compose リファクタ — TDD 計画

## 1. 概要

Phase 1 で導入される `EmbroideryObject` / `EmbroideryDesign` / `FabricProfile` を前提に、モノリシックな `stitch.ts:generateStitches` を **kind ごとの純粋 renderer** (`renderRun` / `renderSatin` / `renderFill`) に分割し、新規 `src/lib/pipeline/render.ts` へ移植する。
合わせて `src/lib/pipeline/index.ts` の `convertImageToEmbroideryDirect` 実装を `src/lib/pipeline/compose.ts` に移し、`index.ts` は re-export のみにする。
パイプライン段が `image → quantize → vectorize → buildObjects → render → write` の連鎖として 1 ファイル 1 段で読めるようにすることが本 PR の目的。
**動作は一切変えない**。既存テストの assert 値 (stitch 数・座標・kind の並び) はリファクタ後も完全一致でなければならない。

## 2. 依存関係

- **PR1**: `EmbroideryObject` / `EmbroideryDesign` / `ObjectProps` / `Shape` の型が `types.ts` にある前提
- **PR2**: `FabricProfile` 型と `FABRIC_PROFILES` 定数が `fabric.ts` にある前提
- **PR3**: `ColorRegion[] → EmbroideryObject[]` を作る `buildObjects` がある前提 (本 PR の入力源)
- 本 PR は PR1〜3 すべてマージ後に着手する

## 3. 影響ファイル

| 種別 | パス | 内容 |
|---|---|---|
| 新規 | `src/lib/pipeline/render.ts` | kind 別 renderer + `renderDesign` |
| 新規 | `src/lib/pipeline/compose.ts` | `convertImageToEmbroideryDirect` 実装の移転先 |
| 新規 | `src/lib/pipeline/__tests__/render.test.ts` | `stitch.test.ts` を移植 + 追加観点 |
| 編集 | `src/lib/pipeline/stitch.ts` | renderer に分解。最終的には `render.ts` から re-export のみの薄いシム、もしくは削除 |
| 編集 | `src/lib/pipeline/index.ts` | `compose.ts` / `render.ts` からの re-export のみ |
| 移動 | `src/lib/pipeline/__tests__/stitch.test.ts` | `render.test.ts` にリネーム + 移植 |
| 参照のみ | `src/lib/pipeline/types.ts` | PR1 で定義済みの型を使用 |
| 参照のみ | `src/lib/pipeline/fabric.ts` | PR2 で定義済みの `FabricProfile` を使用 |
| 参照のみ | `src/lib/pipeline/build-objects.ts` | PR3 で定義済みの `buildObjects` を使用 |

## 4. テスト環境

- フレームワーク: **Vitest** (既存テストと同じ)
- 実行コマンド: `npx vitest run src/lib/pipeline/__tests__/render.test.ts` (単発) / `npx vitest run` (全件)
- テストファイル配置: `src/lib/pipeline/__tests__/*.test.ts`
- 既存テストの import 形: `import { __internal, generateStitches } from "../stitch"` → 新パスへの移行が必要

## 5. インターフェース設計

```ts
// src/lib/pipeline/render.ts

import type {
  StitchPattern,
  StitchBlock,
  Stitch,
  Shape,
  EmbroideryObject,
  EmbroideryDesign,
  FabricProfile,
} from "./types";
import type { FillStrategy } from "./stitch"; // PR4 完了時点で render.ts に移管

/** 既存 StitchInput のうち renderer が必要とする「描画パラメータ」だけを残した型 */
export type RenderOptions = {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  // 以下はすべて FabricProfile or ObjectProps から導出可能だが、
  // PR4 では「動作を変えない」ため、互換のため既存 StitchInput と同じフィールドを残す。
  // Phase 1 後半 (PR6-8) で props ベースに置き換える。
  stitchDensityMm: number;
  satinMaxWidthMm: number;
  runMaxWidthMm?: number;
  maxStitchMm?: number;
  trimThresholdMm?: number;
  fillAngleDeg?: number;
  fillAngleByColorIndex?: Record<number, number>;
  fillStrategy?: FillStrategy;
  shapeStrategyMinAspect?: number;
};

/** 1 オブジェクトを描画するための文脈 */
export type RenderContext = {
  opts: RenderOptions;
  /** mm / pixel 換算係数 (= widthMm / widthPx)。既存実装互換のため事前に渡す */
  mmPerPx: number;
};

/** kind 別 renderer。Stitch 配列だけ返す pure 関数 */
export function renderRun(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[];
export function renderSatin(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[];
export function renderFill(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[];

/**
 * EmbroideryDesign 全体を描画。
 * - kind ごとに renderRun/Satin/Fill にディスパッチ
 * - 同じ colorIndex のオブジェクトを同一 StitchBlock にまとめる
 * - block 間の color change には kind=stop を末尾に追加 (既存と同じ)
 */
export function renderDesign(
  design: EmbroideryDesign,
  opts: RenderOptions,
): StitchPattern;

/**
 * 既存互換 API。内部で buildObjects 風に EmbroideryObject[] を組み立てて
 * renderDesign に委譲する。PR4 完了時点ではここが index.ts からの主入口。
 * 後続 PR で削除可能になる。
 */
export function generateStitches(input: StitchInput): StitchPattern;
```

```ts
// src/lib/pipeline/compose.ts

export type PipelineStage = /* index.ts から移動 */;
export type PipelineProgress = /* 同上 */;
export type PipelineResult = /* 同上 */;
export type PrepipelineResult = /* 同上 */;

export async function convertImageToEmbroideryDirect(
  imageBitmap: ImageBitmap,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult & PrepipelineResult>;

export async function runPrepipeline(/* 同上 */);
export async function runStitchAndWrite(/* 同上 */);
```

```ts
// src/lib/pipeline/index.ts (リファクタ後)

export {
  convertImageToEmbroideryDirect,
  runPrepipeline,
  runStitchAndWrite,
  type PipelineStage,
  type PipelineProgress,
  type PipelineResult,
  type PrepipelineResult,
} from "./compose";
export {
  generateStitches,
  renderDesign,
  renderRun,
  renderSatin,
  renderFill,
  type RenderOptions,
} from "./render";
```

## 6. TDD サイクル

サイクル順序は「**既存テストを壊さない → 内部分解 → 上位差し替え**」のボトムアップ。

### Cycle 1: 既存 `stitch.test.ts` を `render.test.ts` に**そのまま** 移植 (Red→Green セットアップ)

#### Red — 失敗するテスト
- ファイル: `src/lib/pipeline/__tests__/render.test.ts` (新規)
- テスト名 (移植):
  - `intersectScanline (multi-ring) > 外形のみのとき従来通り 2 交点`
  - `intersectScanline (multi-ring) > 穴があると 4 交点`
  - `fillStitches with hole > 穴を持つ正方形では、穴の中をまたぐ縫い目が生成されない`
  - `fillStitches with hole > 穴ありで複数 segment に分割される`
  - `fillStitches with hole > 穴なしのときは各 scanline が 1 segment`
  - `analyzeShape は outer のみで計算 > 穴を渡さなくても短辺長が正しい`
  - `appendStitchesWithJumps - basic` 配下 8 ケース全件
  - `resolveShapeFillAngle` 配下 5 ケース全件
  - `generateStitches with fillStrategy` 配下 3 ケース全件
  - `generateStitches integration - jump-after-init bug` 配下 5 ケース全件
- 観点: **import 元を `../stitch` → `../render` に書き換えるのみ**。テスト本体・assert 値は一字一句変えない。
- 失敗理由: `render.ts` 未作成のため import エラー。

#### Green — 最小実装
- `src/lib/pipeline/render.ts` を新規作成し、`stitch.ts` の中身を **完全コピー** してそのまま export する (`generateStitches`, `__internal`, `resamplePolyline`, `makeStitch`, `FillStrategy` 型)。
- この時点では `stitch.ts` と `render.ts` の中身は等価。`stitch.ts` を残したままにすることで既存 import 元 (compose 移動前の `index.ts`) を壊さない。
- 旧 `stitch.test.ts` は **物理削除はせず**、`render.test.ts` と並存させて両方 green を確認。

#### Refactor
- 不要。コピーのみ。

#### 検証
- `npx vitest run src/lib/pipeline/__tests__/render.test.ts` → 全件 green
- `npx vitest run` → 既存テスト含め全件 green

---

### Cycle 2: 旧 `stitch.test.ts` を削除し、`render.test.ts` を正本にする

#### Red — 失敗するテスト
- 同じ `render.test.ts` で「**重複定義の混乱がない**」を assert するのではなく、git 上で `stitch.test.ts` を削除して `vitest` 全実行 → ファイル数が減って正常終了する状態を確認する。
- 観点: テストケース総数が **`render.test.ts` の件数と一致** (移植抜けがない)。

#### Green — 最小実装
- `git rm src/lib/pipeline/__tests__/stitch.test.ts`
- 移植抜けがあれば Cycle 1 に戻して追加。

#### Refactor
- 不要。

#### 検証
- `npx vitest run` で **テスト総件数が Cycle 1 前と同じ** (旧ファイル削除分だけ減ったのではなく `render.test.ts` で吸収済み)。
- 数値で守るための一行 assertion を `render.test.ts` 末尾に追加:
  ```ts
  // REGRESSION GUARD: 旧 stitch.test.ts からの移植件数を固定する。
  // 仕様変更でケース数を増減させるときは、ここの数値も同時に更新すること。
  it("test coverage guard: 移植したケース数が想定通り", () => {
    // 旧ファイルから移植したトップレベル describe は 6 個 (intersectScanline,
    // fillStitches, analyzeShape, appendStitchesWithJumps, resolveShapeFillAngle,
    // generateStitches with fillStrategy, generateStitches integration)
    // = 計 25 個前後の it。実数値は Cycle 1 移植直後の値で固定する。
    expect(true).toBe(true); // 実数 fixed-value は Cycle 1 完了時の値で置換
  });
  ```
  (運用上 Vitest の `--reporter=json` で件数取り出しが可能なら CI でガードする方が筋が良いが、本 PR では最低限 README 的なコメントで足りる)

---

### Cycle 3: `renderRun` / `renderSatin` / `renderFill` を kind 単位で切り出す

#### Red — 失敗するテスト
- ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記
- テスト名 (新規):
  - `renderRun > 細い帯 (shortSide < runMaxWidth) のオブジェクトから run 種別の Stitch だけが返る`
  - `renderRun > 先頭の Stitch は (outer の最初の点 ≒ 起点) で kind="run"`
  - `renderSatin > 細長 satin オブジェクトから satin 種別だけが返る`
  - `renderSatin > Stitch 数が "既存 generateStitches を同入力で呼んだときの最初の block の satin 数" と一致`
  - `renderFill > 普通の塗りオブジェクトから fill 種別だけが返る (穴あり対応含む)`
  - `renderFill > 各 renderer は jump/trim/stop を含まない (kind=stop/jump/trim は block の合成段の責務)`
- 観点:
  - 各 renderer は **1 オブジェクト分の Stitch[] だけ** を返す pure 関数。色変更 (stop) や block 切替は責務外。
  - jump/trim の挿入は **renderer 内部**で行ってよい (`appendStitchesWithJumps` 経由)。ただし block の先頭で勝手に jump を挿入しないこと (= 既存 `prev=undefined` の挙動を維持)。
- 失敗理由: `renderRun` / `renderSatin` / `renderFill` 関数が未 export。

#### Green — 最小実装
- `render.ts` 内で、現 `generateStitches` の `for (const region of sorted)` 〜 `for (const shapePx of region.shapes)` の二重ループのうち、**内側の shape 分岐** (現 `stitch.ts:105-156`) を 3 つの関数に抽出。
- 各 renderer の責務:
  ```ts
  function renderRun(obj: EmbroideryObject, ctx: RenderContext): Stitch[] {
    const block: StitchBlock = { colorIndex: obj.colorIndex, rgb: obj.rgb, stitches: [] };
    for (const shapeMm of iterShapes(obj)) {
      const pts = resamplePolyline(shapeMm.outer, ctx.opts.stitchDensityMm);
      if (pts.length === 0) continue;
      appendStitchesWithJumps(block, pts, "run", obj.colorIndex, maxStitchMm, trimThresholdMm, true);
    }
    return block.stitches;
  }
  ```
- `renderSatin`, `renderFill` も同形で抽出。
- **既存 `generateStitches` はこの 3 関数を呼ぶように書き換える** が、外部から見た挙動 (戻り値の StitchPattern) は完全に等価でなければならない。
- 既存テスト (Cycle 1 で移植したケース) が全件 green であることを必ず先に確認。

#### Refactor
- 3 つの renderer に共通する「pixel → mm 変換」「shape 1 件分のループ」「block への append」を `renderObjectShapes` のような小さなヘルパに抽出してもよい。
- ただし**抽出はテストが全件 green の状態でのみ**。1 ステップずつ実行→テスト。

#### 検証
- 既存 27 ケースが全件 green
- 新規 6 ケースが green

---

### Cycle 4: `renderDesign(design, opts)` を導入 — `EmbroideryDesign` から `StitchPattern` への純粋変換

#### Red — 失敗するテスト
- ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記
- テスト名 (新規):
  - `renderDesign > 単一オブジェクト (kind=fill) を含む design から block 1 個の pattern を返す`
  - `renderDesign > 異なる colorIndex のオブジェクト 2 個から block 2 個を返し、間に kind=stop が挟まる`
  - `renderDesign > 同じ colorIndex の fill + run が混在しても 1 block にマージされる`
  - `renderDesign > order の昇順で描画される (大きい order が後)`
  - `renderDesign equivalence > 既存 generateStitches に同じ regions を渡したときと、renderDesign に buildObjects 後の design を渡したときで、pattern.blocks[i].stitches の (x, y, kind, colorIndex) が完全一致`
- 観点:
  - 同等性テスト (最後の it) は本 PR の最重要観点。**既存 generateStitches の出力を比較対象** にして座標・kind の並びを 1:1 で守る。
  - 比較は `JSON.stringify(pattern1) === JSON.stringify(pattern2)` または各 stitch を `toMatchObject` でループ比較。
- 失敗理由: `renderDesign` 関数が未 export。

#### Green — 最小実装
```ts
export function renderDesign(
  design: EmbroideryDesign,
  opts: RenderOptions,
): StitchPattern {
  const mmPerPx = opts.widthMm / opts.widthPx;
  const ctx: RenderContext = { opts, mmPerPx };

  // colorIndex でグルーピング + order でソート
  const byColor = new Map<number, EmbroideryObject[]>();
  for (const obj of [...design.objects].sort((a, b) => a.order - b.order)) {
    const arr = byColor.get(obj.colorIndex) ?? [];
    arr.push(obj);
    byColor.set(obj.colorIndex, arr);
  }

  const blocks: StitchBlock[] = [];
  let totalStitches = 0;
  // 既存挙動互換: colorIndex の昇順で block を出す
  const colors = [...byColor.keys()].sort((a, b) => a - b);
  for (const c of colors) {
    const objs = byColor.get(c)!;
    const block: StitchBlock = { colorIndex: c, rgb: objs[0].rgb, stitches: [] };
    for (const obj of objs) {
      const stitches =
        obj.kind === "run"   ? renderRun(obj, ctx)
      : obj.kind === "satin" ? renderSatin(obj, ctx)
      : /* fill */              renderFill(obj, ctx);
      block.stitches.push(...stitches);
    }
    if (block.stitches.length > 0) {
      blocks.push(block);
      totalStitches += block.stitches.filter(
        s => s.kind === "run" || s.kind === "satin" || s.kind === "fill"
      ).length;
    }
  }
  // block 末尾 stop の挿入は既存と同じ
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const last = prev.stitches[prev.stitches.length - 1];
    prev.stitches.push({
      x: last?.x ?? 0, y: last?.y ?? 0,
      kind: "stop", colorIndex: prev.colorIndex,
    });
  }
  return {
    widthMm: design.widthMm,
    heightMm: design.heightMm,
    blocks,
    totalStitches,
  };
}
```
- `generateStitches` (既存 API) は **内部で** `regions → EmbroideryObject[]` を組み立てて `renderDesign` に委譲する形に書き換える。**この組み立ては build-objects.ts の `buildObjects` を直接呼ぶ** (PR3 で導入済み)。

#### Refactor
- `renderDesign` 内のグルーピングロジックは Phase 3 (`optimizeOrder`) で再利用される可能性があるので、独立した `groupByColor(objs)` ヘルパへ抽出してもよい。本 PR の段階では `renderDesign` 内に閉じ込めて構わない。
- `generateStitches` を `renderDesign` ベースに置き換えたら、`renderDesign` 経由でも既存テスト 27 ケース + Cycle 3 の 6 ケース + Cycle 4 の 5 ケースが全件 green であることを再確認。

#### 検証
- 全テスト green
- `pattern.totalStitches` の値が既存実装と一致 (同等性テスト内で assert)

---

### Cycle 5: `compose.ts` に `convertImageToEmbroideryDirect` を移動し、`index.ts` を re-export のみにする

#### Red — 失敗するテスト
- ファイル: `src/lib/pipeline/__tests__/compose.test.ts` (新規 — 軽量で OK)
- テスト名:
  - `compose > convertImageToEmbroideryDirect が compose.ts から import できる`
  - `compose > 旧 index.ts 経由でも同名でアクセスできる (re-export が機能している)`
  - `compose > runPrepipeline / runStitchAndWrite が export されている`
- 観点: 移動先 (`compose.ts`) と互換シム (`index.ts` re-export) の両方から **同じ関数参照** が取れること。`typeof` が `function` であることを確認する程度で OK。
- 失敗理由: `compose.ts` がまだ存在しない / `index.ts` から `compose.ts` への delegate が無い。

#### Green — 最小実装
- `src/lib/pipeline/index.ts` の `convertImageToEmbroideryDirect` / `runPrepipeline` / `runStitchAndWrite` および関連型 (`PipelineStage` 等) を **そのまま** `src/lib/pipeline/compose.ts` に move (関数本体・コメント保持)。
- `compose.ts` 側の import を `./stitch` → `./render` (Cycle 4 で renderDesign 経由になっているが、互換 API として `generateStitches` は引き続き render から export されている) に書き換える。
- `bitmapToImageData` は compose 専用なので一緒に移動する。
- `index.ts` を以下に置き換える:
  ```ts
  export {
    convertImageToEmbroideryDirect,
    runPrepipeline,
    runStitchAndWrite,
    type PipelineStage,
    type PipelineProgress,
    type PipelineResult,
    type PrepipelineResult,
  } from "./compose";
  export {
    generateStitches,
    renderDesign,
    renderRun,
    renderSatin,
    renderFill,
    resamplePolyline,
    makeStitch,
    __internal,
    type RenderOptions,
    type StitchInput, // 互換維持
    type FillStrategy,
  } from "./render";
  ```
- 既存の他コンポーネントが `from "@/lib/pipeline"` で同じシンボルを import できる状態を維持。

#### Refactor
- `stitch.ts` を完全削除するか、`export * from "./render"` のみの 1 行シムに縮退させる。Cycle 1 の安全策として残しておくなら 1 行シム推奨。**この PR で完全削除を選んだ場合は git で確認しやすいよう別コミットに分ける**。

#### 検証
- `npx vitest run` で全件 green
- ビルド: `npx tsc --noEmit` で型エラーなし
- `grep -r "from.*pipeline/stitch" src/` で他ファイルからの直接 import が無いことを確認 (あれば `from "@/lib/pipeline"` への切り替えを別タスクに切り出す)

---

## 7. サイクル依存グラフ

```
Cycle 1 (テスト移植・コピー)
  ↓
Cycle 2 (旧テスト削除)
  ↓
Cycle 3 (renderRun/Satin/Fill 抽出)
  ↓
Cycle 4 (renderDesign 導入)
  ↓
Cycle 5 (compose 分離 + index.ts re-export 化)
```

各サイクルの境界で **全テスト green** を維持する。途中で失敗が連鎖したら、その直前のサイクルの末尾までロールバックする。

## 8. 回帰防止戦略

1. **Cycle 1 で旧テストを 1 文字も変えずに移植**することが最大の安全装置。`stitch.test.ts` の assert 値 (stitch 数・座標) はそのまま `render.test.ts` に持ち込まれ、ずっと守られる。
2. **Cycle 4 の同等性テスト** (`renderDesign equivalence`) が新旧パイプラインの「**1:1 一致**」を直接保証する。座標の浮動小数誤差すら無いはず (純粋なコード移動だから)。万一誤差が出たら浮動小数の演算順序が変わっている兆候なので、その時点で停止して原因究明。
3. **`__internal` の維持**: 既存テストは `__internal.fillStitches` 等を直接呼ぶ。`render.ts` でも同名同シグネチャの `__internal` を export し続けることで移植コストをゼロにする。
4. **failure recovery**: 各サイクル末で git commit を打つので、想定外の失敗時は **直前のコミットに戻して** やり直せる。最悪 Cycle 1 のコミットに戻れば、純粋なファイル追加 (render.ts コピー版) の状態に戻り、旧 `stitch.ts` 経路は完全に保たれている。

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/render.ts` が新規作成され、`renderRun` / `renderSatin` / `renderFill` / `renderDesign` を export している
- [ ] `src/lib/pipeline/compose.ts` が新規作成され、`convertImageToEmbroideryDirect` / `runPrepipeline` / `runStitchAndWrite` を export している
- [ ] `src/lib/pipeline/index.ts` は実装を含まず、`./compose` と `./render` からの re-export のみ
- [ ] `src/lib/pipeline/__tests__/render.test.ts` が `stitch.test.ts` の全 it (移植元 25〜27 件想定) を完全に含み、追加で `renderRun/Satin/Fill` + `renderDesign` のテスト 11 件以上を含む
- [ ] `src/lib/pipeline/__tests__/stitch.test.ts` は削除されている
- [ ] `npx vitest run` が全件 green
- [ ] `npx tsc --noEmit` でビルドエラーなし
- [ ] `renderDesign(design, opts)` と 既存 `generateStitches({ regions, ... })` を同入力で実行したとき、`pattern.blocks[i].stitches[j]` のすべてのフィールド (x, y, kind, colorIndex) が一致 (`renderDesign equivalence` テストで保証)
- [ ] 旧 `stitch.ts` が削除されている、または `export * from "./render"` のみの 1 行シム
- [ ] 他ソースから `from "@/lib/pipeline/stitch"` の直接 import が残っていない (公開 API は `@/lib/pipeline` 経由のみ)
- [ ] `pattern.totalStitches` の値が PR4 前と完全一致 (回帰なし)

## 10. コミット粒度

| Commit | サイクル | 内容 |
|---|---|---|
| 1 | Cycle 1 | `render.ts` を `stitch.ts` のコピーで作成 + `render.test.ts` 新設 (旧 stitch.test.ts と並存) |
| 2 | Cycle 2 | 旧 `stitch.test.ts` 削除 |
| 3 | Cycle 3 | `renderRun` / `renderSatin` / `renderFill` を `render.ts` 内で抽出 + 新規テスト |
| 4 | Cycle 4 | `renderDesign` 導入 + 同等性テスト追加 |
| 5 | Cycle 5 | `compose.ts` に `convertImageToEmbroideryDirect` を移動 + `index.ts` を re-export 化 + 軽量な `compose.test.ts` 追加 |
| 6 (任意) | Cycle 5 後処理 | `stitch.ts` を `export * from "./render"` の 1 行シム化、または削除 |

各コミット境界で `npx vitest run` が green であることが必須条件。

## 11. 想定 PR タイトル

`refactor(pipeline): split renderer and composer from monolithic stitch generator (phase 1 pr4)`

## 12. 注意事項

- **絶対に既存 assert 値を変えない**。Cycle 1 では import パスのみの変更 (`../stitch` → `../render`) で全件パスするはず。1 ケースでも fail したら、それは Cycle 1 の Green ステップが**コピーになっていない** ことを意味するので、原因特定まで停止。
- **fail recovery 路線**: Cycle 3 以降で問題が起きたら、`stitch.ts` を残したまま `render.ts` のみを巻き戻すことで、旧経路で稼働継続できる。`index.ts` の最後の差し替えは Cycle 5 まで温存しているのはそのため。
- **`__internal` export の維持**: テスト用に `analyzeShape` / `intersectScanline` / `fillStitches` / `satinStitches` / `appendStitchesWithJumps` / `resolveShapeFillAngle` / `computeAspectRatio` を `__internal` 経由で公開している。`render.ts` でも全く同じ shape の `__internal` を re-export すること。
- **PR3 (buildObjects) との整合性**: 本 PR の `renderDesign` は `EmbroideryDesign` を入力に取るが、既存 `generateStitches({ regions, ... })` API も同時に維持する。後者の内部実装が `buildObjects(regions, ...) → renderDesign(design, ...)` という委譲になることで PR3 と接続される。**PR3 がマージされていない状態でこの PR を着手しないこと**。
- 既存 `stitch.ts` 内の `bitmapToImageData` は compose 専用なので、Cycle 5 で `compose.ts` に移動する。`stitch.ts` → `render.ts` の段階では触らない (Cycle 3-4 では index.ts に残っている)。
- PR4 完了時点では `RenderOptions` は `StitchInput` と等価。**fabric / props ベースへの置き換えは PR6-8** で行う設計なので、本 PR では型のリネームに留めて中身は変えない。
