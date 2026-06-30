# Phase 2 PR4: lockstitch + underlay 統合 — TDD 計画

## 1. 概要

Phase 2 PR1〜PR3 で個別に実装した **compensation / underlay (edge-run, center-run, zigzag, fill)** を、`render.ts` の renderer に組み込み、各オブジェクトの最初と最後に **lockstitch (tie-in / tie-off)** を挿入する。

`render.ts` の renderer (`renderRun` / `renderSatin` / `renderFill`) が現在は **top stitch のみ** を返す pure 関数になっているのを、

```
[trim/jump (renderer 外)] → [tie-in 3] → [underlay] → [top] → [tie-off 3] → [next jump/stop]
```

の合成順で **1 オブジェクトあたり Stitch[]** を返すように拡張する。`underlay.ts` には `obj.props.underlay.kind` に応じて適切な underlay 関数 (`edgeRunUnderlay` 等) を dispatch する統合ヘルパ `generateUnderlayStitches(obj, ctx)` を追加する。

合わせて、レンダリング過程で **underlay や lockstitch を一時的に切れる** デバッグ用フラグ `disableUnderlay` / `disableCompensation` を `ConversionConfig` に追加し、Phase 1 PR4 の `renderDesign equivalence` テストと同等のステッチ件数で「underlay 無効化モードと既存挙動が一致する」ことを保証する。

Phase 2 計画書「7. 実装ステップ」のステップ 5〜7 に対応する。

## 2. 依存関係

- **Phase 1 全体 (PR1〜PR5)**: `EmbroideryObject` / `EmbroideryDesign` / `FabricProfile` / `ObjectProps` / `UnderlayConfig` の型、`render.ts` の `renderRun/Satin/Fill/Design`、`buildObjects`、`ConversionConfig` がすべて存在する前提
- **Phase 2 PR1 (compensation)**: `applyPullCompensation(obj, fabric)` / `applyPushCompensation(obj, neighbors)` が `compensation.ts` に存在する前提
- **Phase 2 PR2 (edge-run / center-run underlay)**: `edgeRunUnderlay(shape, insetMm, stitchLenMm)` / `centerRunUnderlay(shape, props)` が `underlay.ts` に存在する前提
- **Phase 2 PR3 (zigzag / fill underlay)**: `zigzagUnderlay(shape, spacingMm, insetMm)` / `fillUnderlay(shape, angleDeg, spacingMm)` が `underlay.ts` に存在する前提

PR1〜PR3 のいずれかが未マージの状態で本 PR を着手しないこと。`obj.props.underlay` は **PR3 (build-objects) の `deriveDefaultProps` 内で既に注入されている** (Phase 1 PR3 計画書 5.4 参照)。本 PR のステップ 5 はそれをそのまま使う前提で、`build-objects.ts` の追加実装は不要 (確認のみ)。

## 3. 影響ファイル

### 新規
- `src/lib/pipeline/lockstitch.ts` — `emitTieIn` / `emitTieOff` ヘルパと結合ロジック。`render.ts` の合成段が薄くなるよう、3 stitch 往復生成を 1 か所に集約する
- `src/lib/pipeline/__tests__/lockstitch.test.ts` — `emitTieIn` / `emitTieOff` の単体テスト

### 編集
- `src/lib/pipeline/underlay.ts` — 各 kind 別 underlay 関数 (`edgeRunUnderlay` 等) を `obj.props.underlay.kind` で dispatch する統合ヘルパ `generateUnderlayStitches(obj, ctx)` を追加。`kind="none"` は空配列を返す
- `src/lib/pipeline/render.ts` — `renderRun` / `renderSatin` / `renderFill` の合成段で `tie-in → underlay → top → tie-off` の順に Stitch[] を返すよう拡張。`RenderOptions` に `disableUnderlay?: boolean` / `disableCompensation?: boolean` を追加し、`renderDesign` から下に伝播
- `src/lib/pipeline/__tests__/render.test.ts` — 既存 PR4 equivalence テストを「underlay 無効モードで件数一致」に書き換え、新たに「underlay 有効モードで件数増加」「tie-in/off 3 stitch 挿入」を追加
- `src/lib/pipeline/__tests__/underlay.test.ts` — `generateUnderlayStitches` の dispatch テストを追加
- `src/components/embroidery-studio.tsx` — `ConversionConfig` に `disableUnderlay: boolean` / `disableCompensation: boolean` を追加 (既定値 `false`)。UI 露出は本 PR では行わず、フラグ伝播のみ
- `src/lib/pipeline/index.ts` (もしくは `compose.ts`) — `ConversionConfig` の追加フィールドを `RenderOptions` に渡すラインを追加

### 参照のみ
- `src/lib/pipeline/types.ts` — `UnderlayConfig` / `Stitch` / `EmbroideryObject` を使用
- `src/lib/pipeline/compensation.ts` — `applyPullCompensation` を `renderDesign` 段で呼ぶ (本 PR では既存呼び出しの保護のみ、未呼び出しならフラグ無視で OK)

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **実行コマンド**:
  - 単発: `npx vitest run src/lib/pipeline/__tests__/lockstitch.test.ts`
  - 関連: `npx vitest run src/lib/pipeline/__tests__/{render,underlay,lockstitch}.test.ts`
  - 全件: `npx vitest run`
- **テストファイル配置**: `src/lib/pipeline/__tests__/*.test.ts`

## 5. インターフェース設計

### 5.1 `lockstitch.ts`

```ts
// src/lib/pipeline/lockstitch.ts
import type { Stitch } from "./types";

export type Point = [number, number];

/**
 * tie-in: anchor の手前 (firstDir の逆方向に backDistMm) に 1 stitch、anchor に戻す 1 stitch、
 * もう一度 back に動かす 1 stitch の計 3 stitch を返す。糸を布に固定するためのバックタック。
 * Phase 2 計画書 6.1 仕様: 0.5-1.0mm の小往復、3 stitch、kind="run"。
 */
export function emitTieIn(
  anchor: Point,
  firstDir: Point,
  colorIndex: number,
  backDistMm?: number,
): Stitch[];

/**
 * tie-off: anchor (top stitches の最終点) で同様にバックタック 3 stitch を吐く。
 * lastDir は最後から 1 つ前→最後の方向を渡す (= 進行方向)。それを逆向きに使う。
 */
export function emitTieOff(
  anchor: Point,
  lastDir: Point,
  colorIndex: number,
  backDistMm?: number,
): Stitch[];
```

- `backDistMm` 既定値: `0.8` (Phase 2 計画書 6.3 のサンプル実装値)
- `firstDir` / `lastDir` は **正規化済み単位ベクトル**を渡す前提。renderer 側で正規化する
- 戻り値はすべて `kind="run"` (Phase 2 計画書 6.1)

### 5.2 `underlay.ts` の統合ヘルパ

```ts
// src/lib/pipeline/underlay.ts (既存ファイルに追記)
import type { EmbroideryObject, Stitch } from "./types";
import type { RenderContext } from "./render";

/**
 * obj.props.underlay.kind を見て対応する underlay 関数を呼び出し、Stitch[] に変換して返す。
 * kind="none" もしくは props.underlay が未定義なら空配列。
 *
 * 注: 戻り値はすべて kind="run" (underlay 自体は run stitch として吐く)。
 * jump/trim の挿入は呼び出し元 (render.ts) の責務。
 */
export function generateUnderlayStitches(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[];
```

dispatch:

| `obj.props.underlay.kind` | 呼び出す関数 | 引数 |
|---|---|---|
| `"none"` (または `undefined`) | (なし) | 空配列を返す |
| `"edge-run"` | `edgeRunUnderlay(obj.shape, insetMm, stitchLenMm)` | `props.underlay.insetMm`, `.stitchLenMm` |
| `"center-run"` | `centerRunUnderlay(obj.shape, { stitchLenMm })` | `props.underlay.stitchLenMm` |
| `"zigzag"` | `zigzagUnderlay(obj.shape, spacingMm, insetMm)` | `props.underlay.spacingMm`, `.insetMm` |
| `"fill"` | `fillUnderlay(obj.shape, angleDeg, spacingMm)` を flatMap で 1 本に | `props.underlay.angleDeg ?? (topAngle + 90)`, `.spacingMm` |

最後に `Point[]` を `Stitch[]` に変換 (`{ x, y, kind: "run", colorIndex }`)。

### 5.3 `render.ts` の renderer 拡張

```ts
// src/lib/pipeline/render.ts
export type RenderOptions = {
  // ...既存フィールド...
  /** true なら underlay を吐かない (Phase 1 と件数一致を保つデバッグ用) */
  disableUnderlay?: boolean;
  /** true なら pull/push compensation を適用せず、元 shape のまま renderer に流す */
  disableCompensation?: boolean;
  /** true なら lockstitch (tie-in / tie-off) を吐かない */
  disableLockstitch?: boolean;
};

export type RenderContext = {
  opts: RenderOptions;
  mmPerPx: number;
};

/**
 * 1 オブジェクト分の Stitch[] を返す。合成順:
 *   [tie-in 3] → [underlay] → [top] → [tie-off 3]
 *
 * - underlay: 元 shape (補正前) に対して生成
 * - top stitches: 補正後 shape に対して生成
 * - tie-in/off: top の最初/最後の stitch direction から派生
 *
 * NOTE (forking point for Phase 3 travel-run):
 *   color 内で前 object と travel run で繋がっている場合、tie-in/off を入れない設計に
 *   する必要がある。現状は「常に挿入」だが、Phase 3 で `ctx.travelConnected` のような
 *   フラグを追加してこの分岐を差し替える想定。
 */
export function renderRun(obj: EmbroideryObject, ctx: RenderContext): Stitch[];
export function renderSatin(obj: EmbroideryObject, ctx: RenderContext): Stitch[];
export function renderFill(obj: EmbroideryObject, ctx: RenderContext): Stitch[];
```

`renderDesign` 内では `RenderOptions` をそのまま `RenderContext.opts` に格納するので、3 つのフラグはすべての renderer から参照できる。

### 5.4 `ConversionConfig` 追加フィールド

```ts
// src/components/embroidery-studio.tsx
export type ConversionConfig = {
  // ...既存フィールド...
  /** デバッグ用: true で underlay 生成をスキップ (Phase 1 件数互換) */
  disableUnderlay: boolean;
  /** デバッグ用: true で pull/push compensation をスキップ */
  disableCompensation: boolean;
};

export const defaultConfig: ConversionConfig = {
  // ...既存...
  disableUnderlay: false,
  disableCompensation: false,
};
```

- UI ウィジェットの追加は本 PR の対象外 (Phase 2 計画書 7. ステップ 7 は「フラグ追加」のみ)
- `runStitchAndWrite` / `convertImageToEmbroideryDirect` 内で `RenderOptions` に詰めて renderer に流す配線のみ追加

### 5.5 ファイル構成

- `src/lib/pipeline/lockstitch.ts` — 新規
- `src/lib/pipeline/__tests__/lockstitch.test.ts` — 新規
- `src/lib/pipeline/underlay.ts` — `generateUnderlayStitches` を追記
- `src/lib/pipeline/__tests__/underlay.test.ts` — dispatch テストを追記
- `src/lib/pipeline/render.ts` — renderer 拡張 + RenderOptions に 3 フラグ追加
- `src/lib/pipeline/__tests__/render.test.ts` — equivalence テスト書き換え + 新規テスト
- `src/components/embroidery-studio.tsx` — `ConversionConfig` に 2 フラグ追加
- `src/lib/pipeline/compose.ts` (もしくは `index.ts`) — フラグを RenderOptions に渡す

## 6. TDD サイクル

サイクル順序:

```
Cycle 1 (lockstitch.ts 単体)
  → Cycle 2 (generateUnderlayStitches dispatch)
       → Cycle 3 (renderer に合成順を組み込む)
            → Cycle 4 (disableUnderlay/disableLockstitch フラグ)
                 → Cycle 5 (ConversionConfig 配線 + 既存 equivalence テスト更新)
```

---

### Cycle 1: `emitTieIn` / `emitTieOff` の最小実装

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/lockstitch.test.ts` (新規)

```ts
import { describe, it, expect } from "vitest";
import { emitTieIn, emitTieOff } from "../lockstitch";

describe("emitTieIn", () => {
  it("anchor から firstDir の逆方向に backDistMm だけ動いた点を含む 3 stitch を返す", () => {
    const stitches = emitTieIn([10, 5], [1, 0], 3, 0.8);
    expect(stitches).toHaveLength(3);
    // 1: back (anchor - firstDir * 0.8)
    expect(stitches[0]).toMatchObject({ x: 9.2, y: 5, kind: "run", colorIndex: 3 });
    // 2: anchor (戻り)
    expect(stitches[1]).toMatchObject({ x: 10, y: 5, kind: "run", colorIndex: 3 });
    // 3: back (再び)
    expect(stitches[2]).toMatchObject({ x: 9.2, y: 5, kind: "run", colorIndex: 3 });
  });

  it("backDistMm 省略時は 0.8mm を採用する", () => {
    const stitches = emitTieIn([0, 0], [0, 1], 0);
    // firstDir = [0,1], back = (0, -0.8)
    expect(stitches[0]).toMatchObject({ x: 0, y: -0.8 });
    expect(stitches[1]).toMatchObject({ x: 0, y: 0 });
    expect(stitches[2]).toMatchObject({ x: 0, y: -0.8 });
  });

  it("斜め方向 firstDir でも逆方向に正しく算出する", () => {
    const dir: [number, number] = [Math.SQRT1_2, Math.SQRT1_2]; // 45deg 正規化
    const stitches = emitTieIn([0, 0], dir, 0, 1.0);
    expect(stitches[0].x).toBeCloseTo(-Math.SQRT1_2);
    expect(stitches[0].y).toBeCloseTo(-Math.SQRT1_2);
    expect(stitches[1]).toMatchObject({ x: 0, y: 0 });
  });

  it("全 stitch が kind=run である (Phase 2 計画書 6.1)", () => {
    const stitches = emitTieIn([0, 0], [1, 0], 0);
    expect(stitches.every((s) => s.kind === "run")).toBe(true);
  });
});

describe("emitTieOff", () => {
  it("lastDir の逆方向 (= 進行方向の逆) に動く 3 stitch を返す", () => {
    // 進行方向 +x なので back は -x 側
    const stitches = emitTieOff([20, 5], [1, 0], 2, 0.5);
    expect(stitches).toHaveLength(3);
    expect(stitches[0]).toMatchObject({ x: 19.5, y: 5, colorIndex: 2 });
    expect(stitches[1]).toMatchObject({ x: 20, y: 5, colorIndex: 2 });
    expect(stitches[2]).toMatchObject({ x: 19.5, y: 5, colorIndex: 2 });
  });
});
```

**失敗理由**: `lockstitch.ts` 未作成のため import エラー。

#### Green — 最小実装

```ts
// src/lib/pipeline/lockstitch.ts
import type { Stitch } from "./types";

export type Point = [number, number];

const DEFAULT_BACK_DIST_MM = 0.8;

export function emitTieIn(
  anchor: Point,
  firstDir: Point,
  colorIndex: number,
  backDistMm: number = DEFAULT_BACK_DIST_MM,
): Stitch[] {
  const back: Point = [
    anchor[0] - firstDir[0] * backDistMm,
    anchor[1] - firstDir[1] * backDistMm,
  ];
  return [
    { x: back[0], y: back[1], kind: "run", colorIndex },
    { x: anchor[0], y: anchor[1], kind: "run", colorIndex },
    { x: back[0], y: back[1], kind: "run", colorIndex },
  ];
}

export function emitTieOff(
  anchor: Point,
  lastDir: Point,
  colorIndex: number,
  backDistMm: number = DEFAULT_BACK_DIST_MM,
): Stitch[] {
  // emitTieIn と完全同形 (anchor から lastDir の逆向きに back)
  return emitTieIn(anchor, lastDir, colorIndex, backDistMm);
}
```

#### Refactor

- `emitTieOff` が `emitTieIn` に内部委譲する形にしているが、将来 tie-off だけ往復回数を変える可能性を想定して関数名は分けて維持
- `DEFAULT_BACK_DIST_MM` は module-private にして、上書きは引数経由のみとする (settings 化は Phase 3 以降)

---

### Cycle 2: `generateUnderlayStitches(obj, ctx)` dispatch

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/underlay.test.ts` (既存に追記)

```ts
import { describe, it, expect, vi } from "vitest";
import { generateUnderlayStitches } from "../underlay";
import type { EmbroideryObject } from "../types";

const baseObj = (
  underlay: NonNullable<EmbroideryObject["props"]["underlay"]> | undefined,
): EmbroideryObject => ({
  id: "0-0",
  kind: "fill",
  colorIndex: 1,
  rgb: [255, 0, 0],
  shape: {
    outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
    holes: [],
  },
  props: {
    densityMm: 0.4,
    maxStitchMm: 7,
    ...(underlay !== undefined ? { underlay } : {}),
  },
  order: 0,
});

const ctx = {
  opts: {
    widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
    stitchDensityMm: 0.4, satinMaxWidthMm: 6,
  },
  mmPerPx: 0.1,
};

describe("generateUnderlayStitches dispatch", () => {
  it('kind="none" なら空配列を返す', () => {
    const obj = baseObj({ kind: "none" });
    expect(generateUnderlayStitches(obj, ctx)).toEqual([]);
  });

  it("underlay 未設定 (undefined) でも空配列を返す", () => {
    const obj = baseObj(undefined);
    expect(generateUnderlayStitches(obj, ctx)).toEqual([]);
  });

  it('kind="edge-run" なら edgeRunUnderlay 由来の run stitch が返る', () => {
    const obj = baseObj({ kind: "edge-run", insetMm: 0.4, stitchLenMm: 2 });
    const result = generateUnderlayStitches(obj, ctx);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.kind === "run")).toBe(true);
    expect(result.every((s) => s.colorIndex === 1)).toBe(true);
    // edge-run は inset 0.4mm の閉ループの上に並ぶので、座標は (0.4..9.6) の範囲
    for (const s of result) {
      expect(s.x).toBeGreaterThanOrEqual(0.4 - 1e-6);
      expect(s.x).toBeLessThanOrEqual(9.6 + 1e-6);
    }
  });

  it('kind="center-run" なら centerRunUnderlay が呼ばれ run stitch が返る', () => {
    // 細長い 10x1mm の satin 想定 shape
    const obj: EmbroideryObject = {
      ...baseObj({ kind: "center-run", stitchLenMm: 2 }),
      kind: "satin",
      shape: { outer: [[0, 0], [10, 0], [10, 1], [0, 1]], holes: [] },
    };
    const result = generateUnderlayStitches(obj, ctx);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.kind === "run")).toBe(true);
  });

  it('kind="zigzag" なら zigzagUnderlay が呼ばれ run stitch が返る', () => {
    const obj: EmbroideryObject = {
      ...baseObj({ kind: "zigzag", spacingMm: 2, insetMm: 0.5 }),
      kind: "satin",
      shape: { outer: [[0, 0], [20, 0], [20, 5], [0, 5]], holes: [] },
    };
    const result = generateUnderlayStitches(obj, ctx);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.kind === "run")).toBe(true);
  });

  it('kind="fill" なら fillUnderlay の segments が flatten されて返る', () => {
    const obj = baseObj({ kind: "fill", angleDeg: 135, spacingMm: 3 });
    const result = generateUnderlayStitches(obj, ctx);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.kind === "run")).toBe(true);
  });
});
```

**失敗理由**: `generateUnderlayStitches` が `underlay.ts` から export されていない。

#### Green — 最小実装

```ts
// src/lib/pipeline/underlay.ts (既存に追記)
import type { EmbroideryObject, Stitch, Point2D } from "./types";
import type { RenderContext } from "./render";
// 既存 import (Phase 2 PR2/PR3 でこのファイル内に定義済み)
import {
  edgeRunUnderlay,
  centerRunUnderlay,
  zigzagUnderlay,
  fillUnderlay,
} from "./underlay";

export function generateUnderlayStitches(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  void ctx;
  const u = obj.props.underlay;
  if (!u || u.kind === "none") return [];

  let points: Point2D[] = [];
  switch (u.kind) {
    case "edge-run":
      points = edgeRunUnderlay(obj.shape, u.insetMm, u.stitchLenMm);
      break;
    case "center-run":
      points = centerRunUnderlay(obj.shape, { stitchLenMm: u.stitchLenMm });
      break;
    case "zigzag":
      points = zigzagUnderlay(obj.shape, u.spacingMm, u.insetMm);
      break;
    case "fill": {
      const segs = fillUnderlay(obj.shape, u.angleDeg, u.spacingMm);
      points = segs.flat();
      break;
    }
    default:
      // exhaustive guard
      return [];
  }
  return points.map(([x, y]) => ({
    x, y, kind: "run", colorIndex: obj.colorIndex,
  }));
}
```

`edgeRunUnderlay` 等が Phase 2 PR2/PR3 で `Point[]` (= `Point2D[]`) を返す pure 関数として実装済みなので、ここでは座標 → Stitch 変換だけ行う。

#### Refactor

- switch 文を `kindHandlers: Record<UnderlayKind, (obj, u) => Point2D[]>` のマップに置き換えても良いが、kind ごとに引数形状が違うので switch のままが読みやすい
- `void ctx` は将来 ctx 内の `stitchDensityMm` などを underlay 関数に渡す可能性を想定したダミー参照 (Phase 3 で削除予定)

---

### Cycle 3: `renderRun` / `renderSatin` / `renderFill` に `tie-in → underlay → top → tie-off` の合成順を組み込む

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記

```ts
import { describe, it, expect } from "vitest";
import { renderRun, renderSatin, renderFill, renderDesign } from "../render";
import { buildObjects } from "../build-objects";
import { FABRIC_PROFILES } from "../fabric";

describe("renderer 合成順序: tie-in → underlay → top → tie-off", () => {
  const baseOpts = {
    widthMm: 20, heightMm: 20, widthPx: 200, heightPx: 200,
    stitchDensityMm: 0.4, satinMaxWidthMm: 6,
  };

  it("renderFill: underlay が空でない object の Stitch 配列は [tie-in 3, ...underlay, ...top, tie-off 3] の順", () => {
    const obj = {
      id: "0-0", kind: "fill" as const, colorIndex: 0, rgb: [0, 0, 0] as [number, number, number],
      shape: { outer: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][], holes: [] },
      props: {
        densityMm: 0.4, maxStitchMm: 7,
        underlay: { kind: "edge-run" as const, insetMm: 0.4, stitchLenMm: 2 },
      },
      order: 0,
    };
    const ctx = { opts: baseOpts, mmPerPx: 0.1 };
    const stitches = renderFill(obj, ctx);

    // 先頭 3 stitch は tie-in (kind=run, 0.8mm 往復)
    expect(stitches.slice(0, 3).every((s) => s.kind === "run")).toBe(true);
    // 末尾 3 stitch は tie-off
    expect(stitches.slice(-3).every((s) => s.kind === "run")).toBe(true);
    // 末尾 3 つは [back, anchor, back] のパターンになっており stitches[-1] と stitches[-3] が同座標
    expect(stitches[stitches.length - 1].x).toBeCloseTo(stitches[stitches.length - 3].x);
    expect(stitches[stitches.length - 1].y).toBeCloseTo(stitches[stitches.length - 3].y);
    // 真ん中に kind="fill" の top stitches が存在
    expect(stitches.some((s) => s.kind === "fill")).toBe(true);
    // tie-in の直後に underlay の最初の stitch が来る (kind=run のうち、tie-in[1]=anchor の次)
    const firstFillIdx = stitches.findIndex((s) => s.kind === "fill");
    // underlay 部 (tie-in 3 と top の間) はすべて kind=run
    for (let i = 3; i < firstFillIdx; i++) {
      expect(stitches[i].kind).toBe("run");
    }
    // underlay 区間が 1 つ以上ある (edge-run なので必ず正)
    expect(firstFillIdx).toBeGreaterThan(3);
  });

  it("renderFill: underlay が none の object でも tie-in/off は挿入される", () => {
    const obj = {
      id: "0-0", kind: "fill" as const, colorIndex: 0, rgb: [0, 0, 0] as [number, number, number],
      shape: { outer: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" as const } },
      order: 0,
    };
    const stitches = renderFill(obj, { opts: baseOpts, mmPerPx: 0.1 });
    expect(stitches.slice(0, 3).every((s) => s.kind === "run")).toBe(true);
    expect(stitches.slice(-3).every((s) => s.kind === "run")).toBe(true);
    // 中央は fill のみ (underlay 区間ゼロ)
    const firstFillIdx = stitches.findIndex((s) => s.kind === "fill");
    expect(firstFillIdx).toBe(3); // tie-in 3 の直後すぐに fill
  });

  it("renderSatin / renderRun でも先頭 3 / 末尾 3 が tie-in/off (kind=run)", () => {
    // satin/run も同じ合成順を取ることを最小限の対称性チェック
    const satinObj = {
      id: "0-0", kind: "satin" as const, colorIndex: 0, rgb: [0, 0, 0] as [number, number, number],
      shape: { outer: [[0, 0], [20, 0], [20, 1], [0, 1]] as [number, number][], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" as const } },
      order: 0,
    };
    const sat = renderSatin(satinObj, { opts: baseOpts, mmPerPx: 0.1 });
    expect(sat.slice(0, 3).every((s) => s.kind === "run")).toBe(true);
    expect(sat.slice(-3).every((s) => s.kind === "run")).toBe(true);
    expect(sat.some((s) => s.kind === "satin")).toBe(true);
  });

  it("tie-in の anchor 座標 (stitches[1]) が top stitches の最初の点と一致する", () => {
    const obj = {
      id: "0-0", kind: "fill" as const, colorIndex: 0, rgb: [0, 0, 0] as [number, number, number],
      shape: { outer: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" as const } },
      order: 0,
    };
    const stitches = renderFill(obj, { opts: baseOpts, mmPerPx: 0.1 });
    const firstFill = stitches.find((s) => s.kind === "fill")!;
    expect(stitches[1].x).toBeCloseTo(firstFill.x);
    expect(stitches[1].y).toBeCloseTo(firstFill.y);
  });
});
```

**失敗理由**: 現状の renderer は top stitch のみ返すため、先頭 3 つが `kind="run"` の tie-in にならない / 末尾 3 つが tie-off にならない / underlay が混ざらない。

#### Green — 最小実装

`render.ts` 内に共通の合成ヘルパを追加:

```ts
// src/lib/pipeline/render.ts (renderRun/Satin/Fill 共通の後処理)
import { emitTieIn, emitTieOff } from "./lockstitch";
import { generateUnderlayStitches } from "./underlay";

function assembleWithLockstitch(
  topStitches: Stitch[],
  underlayStitches: Stitch[],
  colorIndex: number,
): Stitch[] {
  if (topStitches.length === 0) return [];

  // anchor = top stitches の最初の点
  const first = topStitches[0];
  const anchor: [number, number] = [first.x, first.y];

  // firstDir = top stitches の (0→1) 方向、長さ正規化
  const second = topStitches[1] ?? first;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const len = Math.hypot(dx, dy) || 1;
  const firstDir: [number, number] = [dx / len, dy / len];

  // lastDir = top stitches の (n-2 → n-1) 方向、長さ正規化
  const last = topStitches[topStitches.length - 1];
  const prev = topStitches[topStitches.length - 2] ?? last;
  const ldx = last.x - prev.x;
  const ldy = last.y - prev.y;
  const llen = Math.hypot(ldx, ldy) || 1;
  const lastDir: [number, number] = [ldx / llen, ldy / llen];

  // NOTE (forking point for Phase 3 travel-run):
  //   color 内で travel run で繋がっている場合、tie-in/off を入れない設計に
  //   将来差し替えるため、ここで travelConnected フラグを見て分岐する。
  //   現状は常に挿入する。
  const tieIn = emitTieIn(anchor, firstDir, colorIndex);
  const tieOff = emitTieOff([last.x, last.y], lastDir, colorIndex);

  return [...tieIn, ...underlayStitches, ...topStitches, ...tieOff];
}
```

各 renderer の責務をそれぞれ書き換え:

```ts
export function renderFill(obj: EmbroideryObject, ctx: RenderContext): Stitch[] {
  const topStitches = renderFillTopOnly(obj, ctx);   // 既存ロジックを top のみ返す関数に分離
  const underlayStitches = ctx.opts.disableUnderlay
    ? []
    : generateUnderlayStitches(obj, ctx);
  if (ctx.opts.disableLockstitch) {
    return [...underlayStitches, ...topStitches];
  }
  return assembleWithLockstitch(topStitches, underlayStitches, obj.colorIndex);
}
// renderRun / renderSatin も同形
```

`disableUnderlay` / `disableLockstitch` フラグの未指定時挙動は **挿入する** (= `false` 相当)。

#### Refactor

- `assembleWithLockstitch` の方向算出を `lockstitch.ts` に移動して `directionsFromStitches(stitches)` ヘルパとして export しても良い (テスト容易性向上)
- 3 つの renderer に共通する「top-only 計算 → underlay → assemble」フローを `renderObject(obj, ctx, topRenderer)` 高階関数に抽出すると重複が減る。本サイクルでは 3 関数に同じパターンを直書きするだけで OK。

---

### Cycle 4: `disableUnderlay` / `disableLockstitch` / `disableCompensation` フラグの動作

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記

```ts
describe("RenderOptions debug flags", () => {
  const baseObj = {
    id: "0-0", kind: "fill" as const, colorIndex: 0, rgb: [0, 0, 0] as [number, number, number],
    shape: { outer: [[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][], holes: [] },
    props: {
      densityMm: 0.4, maxStitchMm: 7,
      underlay: { kind: "edge-run" as const, insetMm: 0.4, stitchLenMm: 2 },
    },
    order: 0,
  };
  const baseOpts = {
    widthMm: 20, heightMm: 20, widthPx: 200, heightPx: 200,
    stitchDensityMm: 0.4, satinMaxWidthMm: 6,
  };

  it("disableUnderlay=true なら underlay 区間が消える (中央に kind=run の連続が無い)", () => {
    const stitches = renderFill(baseObj, {
      opts: { ...baseOpts, disableUnderlay: true },
      mmPerPx: 0.1,
    });
    // tie-in (3) + fill (>0) + tie-off (3) のみ
    const firstFillIdx = stitches.findIndex((s) => s.kind === "fill");
    expect(firstFillIdx).toBe(3); // tie-in 3 の直後すぐに fill
  });

  it("disableLockstitch=true なら tie-in/off が消える (先頭が kind=run の back ではなく underlay or top)", () => {
    const stitches = renderFill(baseObj, {
      opts: { ...baseOpts, disableLockstitch: true },
      mmPerPx: 0.1,
    });
    // 先頭は underlay の最初の点 (= edge-run の最初の resampled 点) であり、tie-in パターンではない
    // 検証: 先頭 stitch と stitches[2] が同座標になっていない (tie-in だと back-anchor-back で stitches[0] == stitches[2])
    const sameAsZeroTwo =
      Math.abs(stitches[0].x - stitches[2].x) < 1e-9 &&
      Math.abs(stitches[0].y - stitches[2].y) < 1e-9;
    expect(sameAsZeroTwo).toBe(false);
  });

  it("disableUnderlay=true かつ disableLockstitch=true なら top stitches のみ", () => {
    const stitches = renderFill(baseObj, {
      opts: { ...baseOpts, disableUnderlay: true, disableLockstitch: true },
      mmPerPx: 0.1,
    });
    expect(stitches.every((s) => s.kind === "fill")).toBe(true);
  });

  it("disableCompensation=true なら shape が補正されず renderer に渡る (Phase 2 PR1 の applyPullCompensation を回避)", () => {
    // renderDesign レベルでチェック: compensation を呼ぶ前の shape をテスト
    // ここでは compensation 適用後と未適用で stitch 数が異なる前提でガード
    const denim = FABRIC_PROFILES.denim;
    const design = {
      widthMm: 20, heightMm: 20,
      objects: [{
        ...baseObj,
        kind: "satin" as const,
        shape: { outer: [[0, 0], [20, 0], [20, 1.5], [0, 1.5]] as [number, number][], holes: [] },
        props: {
          densityMm: 0.4, maxStitchMm: 7,
          underlay: { kind: "none" as const },
          pullCompMm: 0.3, // 補正対象
        },
      }],
    };
    const withComp = renderDesign(design, { ...baseOpts, disableCompensation: false });
    const noComp = renderDesign(design, { ...baseOpts, disableCompensation: true });
    // 補正によって shape が広がる ⇒ satin stitch の長さが変わるが、stitch 「個数」は同じになりがちなので、
    // 代わりに最後の top stitch の y 座標差で検証する
    const lastWith = withComp.blocks[0].stitches.filter((s) => s.kind === "satin").slice(-1)[0];
    const lastNo = noComp.blocks[0].stitches.filter((s) => s.kind === "satin").slice(-1)[0];
    // disableCompensation=true は補正なしなので y が 1.5mm 寄り、false は補正されて広がるので y > 1.5
    expect(Math.abs(lastWith.y - lastNo.y)).toBeGreaterThan(1e-6);
  });
});
```

**失敗理由**: フラグが `RenderOptions` に未追加。`disableUnderlay` を渡しても無視される / `disableCompensation` を渡しても `applyPullCompensation` が常に走る。

#### Green — 最小実装

1. `RenderOptions` に 3 フラグを追加 (型のみ)
2. Cycle 3 の `assembleWithLockstitch` 呼び出し箇所で `ctx.opts.disableUnderlay` / `disableLockstitch` を見て分岐 (Cycle 3 の Green ですでに分岐は入れているが、フラグ未定義だったので型エラーになっていたケースを正規化)
3. `renderDesign` 内で `applyPullCompensation` を呼ぶ既存ラインを `if (!opts.disableCompensation)` で囲う

```ts
// src/lib/pipeline/render.ts
export type RenderOptions = {
  // ...既存...
  disableUnderlay?: boolean;
  disableCompensation?: boolean;
  disableLockstitch?: boolean;
};

export function renderDesign(design, opts): StitchPattern {
  // ...
  for (const obj of objs) {
    const objForTop = opts.disableCompensation
      ? obj
      : applyPullCompensation(obj, /* fabric は ctx 経由で渡すか opts に追加 */);
    // renderer 呼び出し: obj.shape は underlay 用に元のまま、objForTop.shape は top 用
    // 実装上は renderer 内で「underlay は元 shape、top は補正後 shape」の分離が必要 (Phase 2 計画書 4.5)
    // 簡易実装としては renderer に { obj, objCompensated } を渡す or renderer 外で生成して合成
  }
}
```

注: `applyPullCompensation` の呼び出しに `fabric` が必要だが、`RenderOptions` には fabric が未含有。本 PR では `opts` に `fabric?: FabricProfile` を追加するか、Phase 2 PR1 完了時点で既に追加されている前提で動かす。**fabric の取り回しは Phase 2 PR1 計画書を参照**。

#### Refactor

- `applyPullCompensation` 呼び出し箇所を `applyCompensationIfEnabled(obj, opts, fabric)` ヘルパに抽出
- 3 フラグの分岐を `RenderingPhase = "underlay" | "top" | "lockstitch"` の skip-list 形式にすると拡張しやすいが、本 PR ではフラグ 3 個直書きで十分

---

### Cycle 5: `ConversionConfig` 配線 + 既存 `renderDesign equivalence` テストの更新

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/render.test.ts` の既存 `renderDesign equivalence` テストを書き換える + 新規ケース追加:

```ts
describe("renderDesign equivalence (Phase 2 PR4 更新)", () => {
  it("disableUnderlay=true & disableLockstitch=true & disableCompensation=true なら Phase 1 の stitch 件数と一致", () => {
    const fixture = /* Phase 1 PR4 と同じ regions fixture */;
    const opts = { /* 既存テストと同じ opts */ };
    const objects = buildObjects({ ...opts, regions: fixture, fabric: FABRIC_PROFILES.denim });
    const design = { widthMm: opts.widthMm, heightMm: opts.heightMm, objects };

    const v1 = generateStitches({ ...opts, regions: fixture });
    const v2 = renderDesign(design, {
      ...opts,
      disableUnderlay: true,
      disableLockstitch: true,
      disableCompensation: true,
    });
    expect(v2.totalStitches).toBe(v1.totalStitches);
    // 座標も完全一致 (Phase 1 PR4 と同じ assert)
    for (let bi = 0; bi < v1.blocks.length; bi++) {
      for (let si = 0; si < v1.blocks[bi].stitches.length; si++) {
        expect(v2.blocks[bi].stitches[si]).toMatchObject(v1.blocks[bi].stitches[si]);
      }
    }
  });

  it("デフォルト (フラグ未指定 = 全て有効) では Phase 1 より stitch 件数が増える", () => {
    const fixture = /* 同上 */;
    const opts = { /* 同上 */ };
    const objects = buildObjects({ ...opts, regions: fixture, fabric: FABRIC_PROFILES.denim });
    const design = { widthMm: opts.widthMm, heightMm: opts.heightMm, objects };

    const v1 = generateStitches({ ...opts, regions: fixture });
    const v2 = renderDesign(design, opts); // フラグなし

    // tie-in 3 + tie-off 3 = +6/object, underlay は object ごとに edge-run なら +数十
    expect(v2.totalStitches).toBeGreaterThan(v1.totalStitches);
  });
});

describe("ConversionConfig → RenderOptions 配線", () => {
  it("ConversionConfig に disableUnderlay / disableCompensation フィールドがある", () => {
    // type-level: defaultConfig が新フィールドを持つ
    const { defaultConfig } = require("@/components/embroidery-studio");
    expect(defaultConfig.disableUnderlay).toBe(false);
    expect(defaultConfig.disableCompensation).toBe(false);
  });
});
```

**失敗理由**: 
- 旧 equivalence テストは「フラグなしで Phase 1 と一致」を assert しているため、underlay/tie が混ざって件数増加で fail する
- `defaultConfig` に新フィールドが無く `undefined` になる

#### Green — 最小実装

1. `src/components/embroidery-studio.tsx`:
   ```ts
   export type ConversionConfig = {
     // ...既存...
     disableUnderlay: boolean;
     disableCompensation: boolean;
   };
   export const defaultConfig: ConversionConfig = {
     // ...既存...
     disableUnderlay: false,
     disableCompensation: false,
   };
   ```
2. `src/lib/pipeline/compose.ts` (もしくは `index.ts`) の `runStitchAndWrite` / `convertImageToEmbroideryDirect` 内で `RenderOptions` を組み立てるラインに以下を追加:
   ```ts
   const renderOpts: RenderOptions = {
     // ...既存...
     disableUnderlay: config.disableUnderlay,
     disableCompensation: config.disableCompensation,
     // disableLockstitch は ConversionConfig には今回露出しない (デバッグ専用、コード内のみ)
   };
   ```
3. 既存 equivalence テストを「3 フラグ全 true で件数一致」に書き換え

#### Refactor

- `ConversionConfig` の UI 露出 (チェックボックス追加) は本 PR ではやらず、別 PR (Phase 2 PR5 想定) に分離
- `disableLockstitch` を `ConversionConfig` には出さない理由をコードコメントで残す (「production では常に必要」)

---

## 7. サイクル依存グラフ

```
Cycle 1 (lockstitch.ts 単体)
  ↓
Cycle 2 (generateUnderlayStitches dispatch)
  ↓
Cycle 3 (renderer 合成順 組み込み)
  ↓
Cycle 4 (debug フラグ実装)
  ↓
Cycle 5 (ConversionConfig 配線 + equivalence テスト更新)
```

各サイクルの境界で `npx vitest run` 全件 green が必須。Cycle 3 を入れる時点で既存の `renderDesign equivalence` (Phase 1 PR4 由来) は一時的に fail するので、**Cycle 3 開始前に該当テストを `it.skip` で保護**し、Cycle 5 で正式に書き換える運用にする。

## 8. 回帰防止

1. **Cycle 1 / Cycle 2 は新規ファイル/関数追加のみ** で既存テストに影響しない → Cycle 開始時に `npx vitest run` で全件 green を確認
2. **Cycle 3 で既存 equivalence テストが fail することは想定内** だが、それ以外のテスト (`stitch.test.ts` の `appendStitchesWithJumps`, `intersectScanline`, `fillStitches` 等) は touch しないので green を維持
3. **Cycle 5 で書き換えた equivalence テスト** が新旧パイプラインの「**全フラグ off モードでの 1:1 一致**」を直接保証する。Phase 1 PR4 から座標精度を引き継ぐ
4. **Phase 2 PR1〜PR3 のテスト** (`compensation.test.ts`, `underlay.test.ts` の Cycle 2 追記以外) には触れない
5. **`disableLockstitch`** をテストで露出させることで、production 経路 (`runStitchAndWrite`) で常に true になっていないことを assert

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/lockstitch.ts` が新規作成され、`emitTieIn` / `emitTieOff` を export している
- [ ] `src/lib/pipeline/__tests__/lockstitch.test.ts` で 0.8mm 既定値・斜め方向・kind=run 全件 のテストが green
- [ ] `src/lib/pipeline/underlay.ts` に `generateUnderlayStitches(obj, ctx)` が export され、5 種 kind (none/edge-run/center-run/zigzag/fill) を dispatch する
- [ ] `kind="none"` または `underlay` 未定義のとき空配列を返す
- [ ] `renderRun` / `renderSatin` / `renderFill` の戻り値が **`[tie-in 3, ...underlay, ...top, tie-off 3]`** の順 (フラグ未指定時)
- [ ] tie-in の anchor (stitches[1]) が top stitches の最初の点と一致する
- [ ] tie-in / tie-off ともに 3 stitch 各々 `kind="run"` (Phase 2 計画書 6.1)
- [ ] `RenderOptions` に `disableUnderlay?: boolean` / `disableCompensation?: boolean` / `disableLockstitch?: boolean` の 3 フラグが追加されている
- [ ] `disableUnderlay=true` なら underlay 部が省略され、tie-in 直後に top stitches が始まる
- [ ] `disableLockstitch=true` なら tie-in/off の合計 6 stitch が省略される
- [ ] `disableCompensation=true` なら `applyPullCompensation` がスキップされ、shape が補正されずに renderer に渡る
- [ ] **(Phase 2 計画書 9. 引用)** 100×100mm のロゴで underlay/comp/lockstitch を有効にした結果、ステッチ数が Phase 1 比で **+30〜+60%** 増える
- [ ] **(Phase 2 計画書 9. 引用)** `disableUnderlay=true`, `disableCompensation=true`, `disableLockstitch=true` で Phase 1 のステッチ数と完全一致 (renderDesign equivalence テスト)
- [ ] **(Phase 2 計画書 9. 引用)** 3 色重ね合わせ画像で、隣接色境界の見え隙間が無くなる (目視確認 — 自動テストではなく PR レビュー時の確認項目)
- [ ] **(Phase 2 計画書 9. 引用)** DST 書き出しが破綻しない (pyembroidery で読み直して同等)
- [ ] `ConversionConfig` に `disableUnderlay: boolean` / `disableCompensation: boolean` が追加され、`defaultConfig` で `false` が入っている
- [ ] `runStitchAndWrite` / `convertImageToEmbroideryDirect` 内で 2 フラグが `RenderOptions` に伝播する
- [ ] `assembleWithLockstitch` 内に **Phase 3 travel-run 用の fork point コメント** が記載されている (color 内で travel run で繋がっている場合 tie-in/off を入れない設計に差し替えるための目印)
- [ ] `npx vitest run` 全件 green
- [ ] `npx tsc --noEmit` で型エラーなし

## 10. コミット粒度

| Commit | サイクル | 内容 |
|---|---|---|
| 1 | Cycle 1 Red | `test(pipeline): add failing tests for emitTieIn/emitTieOff` |
| 2 | Cycle 1 Green | `feat(pipeline): add lockstitch helpers (emitTieIn/emitTieOff)` |
| 3 | Cycle 2 Red | `test(pipeline): add dispatch tests for generateUnderlayStitches` |
| 4 | Cycle 2 Green | `feat(pipeline): add generateUnderlayStitches dispatch by underlay kind` |
| 5 | Cycle 3 Red | `test(pipeline): assert renderer assembles tie-in/underlay/top/tie-off` (既存 equivalence は skip) |
| 6 | Cycle 3 Green | `feat(pipeline): assemble tie-in/underlay/top/tie-off in renderers` |
| 7 | Cycle 3 Refactor | `refactor(pipeline): extract assembleWithLockstitch helper` |
| 8 | Cycle 4 Red | `test(pipeline): add RenderOptions debug flag tests` |
| 9 | Cycle 4 Green | `feat(pipeline): honor disableUnderlay/Compensation/Lockstitch flags` |
| 10 | Cycle 5 Red | `test(pipeline): replace renderDesign equivalence to use disable* flags` |
| 11 | Cycle 5 Green | `feat(pipeline): wire disableUnderlay/Compensation through ConversionConfig` |

各コミット境界で `npx vitest run` が green であることが必須条件。Cycle 3-5 の中間は equivalence テストが skip 状態なので、Cycle 5 Green で skip 解除して全件 green にする。

## 11. 想定 PR タイトル

`feat(pipeline): integrate underlay and lockstitch into renderer (phase 2 pr4)`

## 12. 注意事項

- **Phase 2 計画書 6.1 仕様を厳守**: tie-in / tie-off は 3 stitch・0.5-1.0mm・`kind="run"`。本 PR では既定値 0.8mm を採用
- **レンダリング順**: `[trim/jump] → [tie-in 3] → [underlay] → [top] → [tie-off 3] → [next jump/stop]` の順を厳守。trim/jump の挿入は `appendStitchesWithJumps` (既存) の責務であり renderer 内 → block 合成段の両方で発生する。renderer 内の合成順は **tie-in → underlay → top → tie-off** で固定
- **Phase 3 travel-run fork point**: color 内で travel run で繋がっている場合 tie-in/off を入れない設計に将来差し替えるため、`assembleWithLockstitch` 内に明示的にコメントを残す
  ```ts
  // NOTE (forking point for Phase 3 travel-run):
  //   color 内で前 object と travel run で繋がっている場合、tie-in/off を入れない
  //   設計に将来差し替える。現状は常に挿入。
  //   差し替え時は `ctx.travelConnected` のようなフラグを追加して分岐する。
  ```
- **元 shape vs 補正後 shape の使い分け** (Phase 2 計画書 4.5): underlay は **元 shape** (補正前) を参照、top stitches は **補正後 shape** を参照。本 PR の `renderRun/Satin/Fill` 内で 2 つの shape を扱う実装が必要。`renderDesign` 段で `objCompensated` を別変数で持ち、renderer に渡し方を分ける
- **`underlay.ts` の既存関数シグネチャ** (`edgeRunUnderlay(shape, insetMm, stitchLenMm)` 等) は Phase 2 PR2/PR3 で確定済みの前提。シグネチャがずれている場合は本 PR で修正せず、PR2/PR3 のリビジョンとして別タスクで対応
- **`UnderlayConfig` の 5 種別** (`none`, `edge-run`, `center-run`, `zigzag`, `fill`) はすべて `obj.props.underlay.kind` の判定対象。新種別を追加する場合は `generateUnderlayStitches` の switch 文に追加 + `UnderlayConfig` 型を types.ts で拡張する
- **`disableLockstitch` を `ConversionConfig` には露出しない**: production では常に lockstitch が必要なので UI から無効化できないように、フラグは `RenderOptions` レベル (内部 API) のみで露出する
- **build-objects.ts の追加実装は不要**: `obj.props.underlay` は Phase 1 PR3 (`deriveDefaultProps`) で既に注入されているため、本 PR では `build-objects.ts` には触らない。万一 PR3 で未実装の場合のみ別タスクで対応
- **既存テストの保護**: `stitch.test.ts` (Phase 1 PR4 で `render.test.ts` に移植済み想定) の `intersectScanline`, `fillStitches`, `appendStitchesWithJumps`, `resolveShapeFillAngle` 等は touch しない。Cycle 3 で fail するのは `renderDesign equivalence` 1 件のみが想定。それ以外が fail したら即停止して原因究明
