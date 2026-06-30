# Phase 4 PR3: Auto split (brick) + Satin renderer 切替 — TDD 計画

## 1. 概要

Phase 4 計画書「9. 実装ステップ」のステップ **4.3** と **5** を実装する。

1. `src/lib/pipeline/satin.ts` に `brickSplit(left, right, maxStitchMm, rowIndex): Point2D[]` を追加し、wide satin で 1 つの stitch (`left` → `right`) を `maxStitchMm` で分割する際に **行ごとに 1/3 位相シフト** (`phase = (rowIndex % 3) / 3`) して針穴の縦並びを分散する
2. `src/lib/pipeline/render.ts` の satin object レンダラを、既存 `satinStitches` (PCA 単一長軸) から **PR2 の `extractRails` + `renderSatin2Rail` + 本 PR の `brickSplit`** のチェーンに差し替える
3. 互換性のために `RenderOptions.disableAutoSplit: true` で **旧 `satinStitches` 経路に戻す**フラグを追加し、Phase 1〜3 までの挙動を維持できるようにする

これによって Phase 4 計画書 4 章 (Auto Split) を完成させ、6mm 以上の wide satin で needle perforation line の問題を解消する。

## 2. 依存関係

- **Phase 1 全体 (PR1〜PR5)**: `EmbroideryObject` / `EmbroideryDesign` / `ObjectProps` / `ConversionConfig`, `render.ts` の renderer 群, `compose.ts` 配線が存在する前提
- **Phase 2 PR1〜PR4**: tie-in / underlay / top / tie-off の合成順, `appendStitchesWithJumps` が存在する前提
- **Phase 3 PR1〜PR3**: `pathing.ts` の `optimizeOrder`, `chooseEntryExit`, renderer の `entry/exit` インターフェース, `policy.ts`, `connectObjects` が存在する前提
- **Phase 4 PR2 (必須)**: `src/lib/pipeline/satin.ts` に以下が既に存在すること
  - `type SatinRails = { left: Point2D[]; right: Point2D[] }`
  - `extractRails(shape: Shape): SatinRails`
  - `renderSatin2Rail(rails: SatinRails, densityMm: number, maxStitchMm: number): Point2D[]`
- **Phase 4 PR1 (推奨)**: `fill.ts` の `tatamiBrick` が存在していると `render.ts` 内の switch がきれいに揃うが、無くても本 PR は独立に着地可能

PR2 が未マージの状態で本 PR を着手しないこと。本 PR は **`brickSplit` の追加と satin renderer の差し替え (+ 互換フラグ) のみ** に集中する。

## 3. 影響ファイル

### 編集
- `src/lib/pipeline/satin.ts`
  - 末尾に `brickSplit(left, right, maxStitchMm, rowIndex): Point2D[]` を追加
  - 内部ヘルパ `lerp(a: Point2D, b: Point2D, t: number): Point2D` を `__internal` に出して `renderSatin2Rail` と共有する (Refactor 段で)
- `src/lib/pipeline/__tests__/satin.test.ts`
  - `brickSplit` の単体テスト 4 ケース (短い / 長い / 行 0,1,2 の位相 / 隣接行の中間点の非整列) を追加
  - `disableAutoSplit=true` で `renderSatin` の出力件数が旧 `satinStitches` と一致することの統合テスト
- `src/lib/pipeline/render.ts`
  - `renderSatin(obj, ctx, entry)` の内部実装を `extractRails` + `renderSatin2Rail` + `brickSplit` のチェーンに変更
  - `RenderOptions` に `disableAutoSplit?: boolean` を追加。`true` のときは旧 `satinStitches` (PCA 単一長軸, 既存 `stitch.ts` の関数) を呼ぶ互換経路に切り替える
  - Phase 2 PR4 で導入された tie-in / underlay / top / tie-off の合成順, Phase 3 PR3 の entry/exit 駆動経路はそのまま尊重する
- `src/lib/pipeline/__tests__/render.test.ts`
  - `disableAutoSplit=false` の wide satin で brick split が効いていることの統合テスト
  - `disableAutoSplit=true` で従来挙動と stitch 件数が一致することの回帰テスト

### 参照のみ
- `src/lib/pipeline/types.ts` — `Point2D`, `Shape`, `Stitch`, `StitchKind`
- `src/lib/pipeline/stitch.ts` — 互換経路で `__internal.satinStitches` を import
- `src/lib/pipeline/satin.ts` (既存部分) — `extractRails`, `renderSatin2Rail`, `SatinRails`

### 新規
- なし (本 PR では新規ファイルは作らない)

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **実行コマンド**:
  - 単発: `npx vitest run src/lib/pipeline/__tests__/satin.test.ts`
  - 関連: `npx vitest run src/lib/pipeline/__tests__/{satin,render,stitch}.test.ts`
  - 全件: `npx vitest run`
  - 型チェック: `npx tsc --noEmit`
- **テストファイル配置**: `src/lib/pipeline/__tests__/*.test.ts`
- **ヘルパ**: 既存 `stitch.test.ts` の `__internal` export パターンに倣い、`satin.ts` でも `export const __internal = { brickSplit, lerp }` を公開してテスト容易性を確保する

## 5. インターフェース設計

### 5.1 `brickSplit`

```ts
// src/lib/pipeline/satin.ts

import type { Point2D } from "./types";

/**
 * 1 つの stitch (left → right) を maxStitchMm で分割する。
 * 行ごとに 1/3 位相シフト (phase = (rowIndex % 3) / 3) して針落ち位置を分散する。
 *
 * - 距離 <= maxStitchMm の場合は分割せず [left, right] をそのまま返す
 * - 距離 > maxStitchMm の場合は ceil(distance / maxStitchMm) 等分し、
 *   各分割点の補間係数 t を ((i - 1) + phase) / segs で計算する
 *   (phase = 0 で行 0, phase = 1/3 で行 1, phase = 2/3 で行 2, 行 3 以降は周期 3 で繰り返し)
 * - 先頭は必ず left、末尾は必ず right (t は [0, 1] にクランプ)
 * - 戻り値の長さは `2`            (短い場合)
 *              または `segs + 2`   (長い場合, 中間点 segs 個 + 両端 2 個)
 *
 * 注意: phase > 0 のとき、最初の中間点 t = phase は 0 と left の間ではなく
 * left より「右側」にある (left は別途先頭に push されているので順序は保たれる)。
 *
 * @param left      stitch 開始点 (左 rail サンプル)
 * @param right     stitch 終了点 (右 rail サンプル)
 * @param maxStitchMm 1 stitch あたりの上限長 (mm)。Phase 4 計画書では 7mm 前後を想定
 * @param rowIndex  scanline 行番号 (0 始まり)。位相シフトの周期 3 で利用
 */
export function brickSplit(
  left: Point2D,
  right: Point2D,
  maxStitchMm: number,
  rowIndex: number,
): Point2D[];

/** テスト容易性のため */
export const __internal: {
  brickSplit: typeof brickSplit;
  lerp: (a: Point2D, b: Point2D, t: number) => Point2D;
};
```

擬似実装 (計画書 4.2 そのまま):

```ts
function brickSplit(left, right, maxStitchMm, rowIndex) {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const dist = Math.hypot(dx, dy);
  if (dist <= maxStitchMm) return [left, right];

  const segs = Math.ceil(dist / maxStitchMm);
  const phase = (rowIndex % 3) / 3;
  const out: Point2D[] = [left];
  for (let i = 1; i <= segs; i++) {
    const t = Math.min(1, Math.max(0, ((i - 1) + phase) / segs));
    out.push(lerp(left, right, t));
  }
  out.push(right);
  return out;
}
```

### 5.2 `render.ts` satin renderer 差し替え

```ts
// src/lib/pipeline/render.ts (差分のみ抜粋)

import { extractRails, renderSatin2Rail, brickSplit } from "./satin";
import { __internal as stitchInternal } from "./stitch";

export type RenderOptions = {
  // ... Phase 3 PR3 までのフィールド ...
  /**
   * 本 PR (Phase 4 PR3) の auto-split + 2-rail satin 経路を無効化するデバッグフラグ。
   * true の場合は Phase 1 の `satinStitches` (PCA 単一長軸) を呼び、
   * brickSplit を実行しない。Phase 1〜3 の挙動互換が必要なときに使う。
   */
  disableAutoSplit?: boolean;
};

export function renderSatin(
  obj: EmbroideryObject,
  ctx: RenderContext,
  entry?: Point2D,
): RenderResult {
  const { densityMm, maxStitchMm } = effectiveSatinParams(obj, ctx);

  if (ctx.opts.disableAutoSplit) {
    // 互換経路: 旧 satinStitches を呼ぶ。Phase 1 と stitch 件数・位置が一致する
    const pts = stitchInternal.satinStitches(
      obj.shape.outer,
      densityMm,
      obj.longAxis,
      obj.center,
    );
    return assembleSatinResult(obj, ctx, entry, pts);
  }

  // 新経路: 2-rail + brick split
  const rails = extractRails(obj.shape);
  const railedStitches = renderSatin2Rail(rails, densityMm, maxStitchMm);
  // railedStitches は [left0, right0, right1, left1, left2, right2, ...] の
  // ジグザグ列。これを (left, right) ペアに区切り、ペアごとに brickSplit して
  // 中間点を挿入する (rowIndex はペア順)。
  const split = applyBrickSplit(railedStitches, maxStitchMm);
  return assembleSatinResult(obj, ctx, entry, split);
}

/** ペアごとに brickSplit を当てて 1 本の Point2D[] に flatten する */
function applyBrickSplit(
  zigzag: Point2D[],
  maxStitchMm: number,
): Point2D[] {
  const out: Point2D[] = [];
  for (let i = 0; i + 1 < zigzag.length; i += 2) {
    const a = zigzag[i];
    const b = zigzag[i + 1];
    const rowIndex = i / 2;
    const seg = brickSplit(a, b, maxStitchMm, rowIndex);
    // 直前 stitch との重複を避けて push
    if (out.length > 0 && pointsEqual(out[out.length - 1], seg[0])) {
      out.push(...seg.slice(1));
    } else {
      out.push(...seg);
    }
  }
  return out;
}
```

注:
- `assembleSatinResult` は Phase 2 PR4 / Phase 3 PR3 で導入済みの「entry 起点で並べ替え、tie-in/underlay/top/tie-off を合成し、`exit` を返す」既存ヘルパ。本 PR では中身は変更しない
- `effectiveSatinParams` は `obj.props.densityMm`, `obj.props.maxStitchMm`, fabric default を合成する既存ヘルパ
- `pointsEqual` は `Math.abs(dx) + Math.abs(dy) < 1e-6` 程度の許容差で判定

## 6. ファイル構成

- `src/lib/pipeline/satin.ts` — 既存 (Phase 4 PR2)
- `src/lib/pipeline/__tests__/satin.test.ts` — 既存 (Phase 4 PR2)
- `src/lib/pipeline/render.ts` — 既存 (Phase 3 PR3)
- `src/lib/pipeline/__tests__/render.test.ts` — 既存 (Phase 3 PR3)

新規ファイルなし。本 PR は **既存ファイルへの追加と差し替えのみ**。

## 7. TDD サイクル

### Cycle 1: 短い stitch は分割されず [left, right] を返す

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/satin.test.ts に追加

import { describe, it, expect } from "vitest";
import { brickSplit } from "../satin";

describe("brickSplit", () => {
  it("距離が maxStitchMm 以下のときは分割せず [left, right] を返す", () => {
    const left: [number, number] = [0, 0];
    const right: [number, number] = [5, 0]; // 距離 5mm
    const result = brickSplit(left, right, 7, 0);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0, 0]);
    expect(result[1]).toEqual([5, 0]);
  });

  it("距離 = maxStitchMm の境界でも分割しない", () => {
    const result = brickSplit([0, 0], [7, 0], 7, 0);
    expect(result).toHaveLength(2);
  });
});
```

**失敗理由**: `brickSplit` が `satin.ts` から export されていないため import エラー (`SyntaxError: The requested module '../satin' does not provide an export named 'brickSplit'`)。

#### Green — 最小実装

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  - `brickSplit(left, right, maxStitchMm, rowIndex): Point2D[]` を新規 export
  - 短いケースだけ実装: `const dist = Math.hypot(right[0] - left[0], right[1] - left[1]); if (dist <= maxStitchMm) return [left, right];`
  - 長いケースの実装はまだ書かない (次サイクルで TDD)。仮に `else throw new Error("not implemented")` でも可だが、最小実装としては `return [left, right]` でも今のテストは通る (= まだ書かない)
- テスト通過: Cycle 1 の 2 ケースが PASS

#### Refactor

- 不要 (関数 1 個追加のみで構造改善の余地が無い)

---

### Cycle 2: 長い stitch では maxStitchMm に応じて中間点を挿入する (行 0)

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/satin.test.ts に追加

describe("brickSplit (長い stitch、行 0)", () => {
  it("8mm の stitch を maxStitchMm=3 で分割するとき、中間点 2-3 個を挿入する", () => {
    // dist = 8, segs = ceil(8 / 3) = 3, phase = 0
    // 中間点 t = 0/3, 1/3, 2/3 → 0, 0.333, 0.667
    // ただし t = 0 は left と同じ点なので、計画書のループは t = (i-1+phase)/segs を出力する
    // i=1: t=0,     i=2: t=1/3,    i=3: t=2/3
    // out = [left, lerp(0), lerp(1/3), lerp(2/3), right]
    //     = [(0,0), (0,0), (8/3, 0), (16/3, 0), (8,0)]
    // 長さは segs + 2 = 5
    const result = brickSplit([0, 0], [8, 0], 3, 0);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([8, 0]);

    // 行 0 では phase = 0 なので、中間点 i=2 は t = 1/3 の位置
    expect(result[2][0]).toBeCloseTo(8 / 3, 5);
    expect(result[2][1]).toBeCloseTo(0, 5);
    // i=3 は t = 2/3
    expect(result[3][0]).toBeCloseTo(16 / 3, 5);
    expect(result[3][1]).toBeCloseTo(0, 5);
  });

  it("斜め stitch でも y 成分が正しく補間される", () => {
    const result = brickSplit([0, 0], [6, 8], 4, 0);
    // dist = 10, segs = ceil(10/4) = 3, phase = 0
    expect(result).toHaveLength(5);
    // 末尾は必ず right
    expect(result[result.length - 1][0]).toBeCloseTo(6, 5);
    expect(result[result.length - 1][1]).toBeCloseTo(8, 5);
    // 中間 i=3, t=2/3 → (4, 16/3)
    expect(result[3][0]).toBeCloseTo(4, 5);
    expect(result[3][1]).toBeCloseTo(16 / 3, 5);
  });
});
```

**失敗理由**: 現在の `brickSplit` は短いケースしか実装していないため、長い距離でも `[left, right]` を返してしまい `toHaveLength(5)` に失敗する。

#### Green — 最小実装

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  - `dist > maxStitchMm` の分岐を追加
  - `const segs = Math.ceil(dist / maxStitchMm);`
  - `const phase = (rowIndex % 3) / 3;` (今は rowIndex=0 のみテストしているので phase=0)
  - ループ `for (let i = 1; i <= segs; i++)` で `t = ((i - 1) + phase) / segs` をクランプして `lerp(left, right, t)` を push
  - `lerp` は同ファイル内のローカル関数で `[a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]`
- テスト通過: Cycle 1 + Cycle 2 が PASS

#### Refactor

- 不要 (まだ 1 経路のみ、共通化の対象が無い)

---

### Cycle 3: 行ごとに 1/3 位相シフトする (行 0, 1, 2 の比較)

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/satin.test.ts に追加

describe("brickSplit の位相シフト", () => {
  it("行 0 の中間点 i=1 は t=0、行 1 は t=1/3、行 2 は t=2/3 の位置にある", () => {
    // 同じ stitch を行 0, 1, 2 で分割
    const r0 = brickSplit([0, 0], [9, 0], 3, 0); // phase 0
    const r1 = brickSplit([0, 0], [9, 0], 3, 1); // phase 1/3
    const r2 = brickSplit([0, 0], [9, 0], 3, 2); // phase 2/3

    // dist=9, segs=3
    // 行 0 (phase=0): i=1 → t=0,     i=2 → t=1/3, i=3 → t=2/3
    //   → out = [(0,0), (0,0),   (3,0), (6,0), (9,0)]
    // 行 1 (phase=1/3): i=1 → t=1/9, i=2 → t=4/9, i=3 → t=7/9
    //   → out = [(0,0), (1,0),   (4,0), (7,0), (9,0)]
    // 行 2 (phase=2/3): i=1 → t=2/9, i=2 → t=5/9, i=3 → t=8/9
    //   → out = [(0,0), (2,0),   (5,0), (8,0), (9,0)]

    expect(r0).toHaveLength(5);
    expect(r1).toHaveLength(5);
    expect(r2).toHaveLength(5);

    // index 1 (= 最初の中間点) の x 座標で位相を確認
    expect(r0[1][0]).toBeCloseTo(0, 5);
    expect(r1[1][0]).toBeCloseTo(1, 5); // 9 * 1/9 = 1
    expect(r2[1][0]).toBeCloseTo(2, 5); // 9 * 2/9 = 2

    // index 2 (= 2 つ目の中間点) でも 1/3 単位でずれる
    expect(r0[2][0]).toBeCloseTo(3, 5);
    expect(r1[2][0]).toBeCloseTo(4, 5);
    expect(r2[2][0]).toBeCloseTo(5, 5);
  });

  it("行 3 は行 0 と同位相 (周期 3)", () => {
    const r0 = brickSplit([0, 0], [9, 0], 3, 0);
    const r3 = brickSplit([0, 0], [9, 0], 3, 3);
    expect(r3[1][0]).toBeCloseTo(r0[1][0], 5);
    expect(r3[2][0]).toBeCloseTo(r0[2][0], 5);
    expect(r3[3][0]).toBeCloseTo(r0[3][0], 5);
  });

  it("隣接 3 行の最初の中間点が一直線にならない (= x 座標が全て異なる)", () => {
    const r0 = brickSplit([0, 0], [9, 0], 3, 0);
    const r1 = brickSplit([0, 0], [9, 0], 3, 1);
    const r2 = brickSplit([0, 0], [9, 0], 3, 2);

    // 行 0 の最初の中間点 (index 1) と
    // 行 1 の最初の中間点 (index 1) と
    // 行 2 の最初の中間点 (index 1) の x 座標は
    // それぞれ 0, 1, 2 で「一直線 (= 同じ x)」にはならない
    const xs = [r0[1][0], r1[1][0], r2[1][0]];
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    expect(max - min).toBeGreaterThan(0.5); // 全行で 0.5mm 以上ばらつく
  });
});
```

**失敗理由**: 現状の `brickSplit` は `phase` を `rowIndex % 3` でなく定数 0 として扱う実装 (Cycle 2 で row=0 のみ) のままなので、行 1 / 行 2 の `result[1][0]` が 0 のままで `toBeCloseTo(1)` / `toBeCloseTo(2)` に失敗する。

#### Green — 最小実装

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  - `const phase = (rowIndex % 3) / 3;` の式を **そのまま** 残す (Cycle 2 では rowIndex=0 だったので結果として 0 だった)
  - もし Cycle 2 で `phase` を `0` ハードコードしていたなら、ここで `(rowIndex % 3) / 3` に修正
  - `t` のクランプ `Math.min(1, Math.max(0, ((i - 1) + phase) / segs))` を入れる
- テスト通過: Cycle 1 + Cycle 2 + Cycle 3 が PASS

#### Refactor

- `lerp` 関数を `satin.ts` のトップレベル関数に切り出し、`renderSatin2Rail` 内でも同じ実装を使っているなら統一する
- `__internal` export に `lerp` と `brickSplit` を載せ、テストから直接呼べるようにする
- ループ内で `Math.min(1, Math.max(0, x))` が冗長なら `clamp01(x)` ヘルパに切り出す
- 既存テスト全件が引き続き PASS することを確認

---

### Cycle 4: `renderSatin` が `extractRails` + `renderSatin2Rail` + `brickSplit` のチェーンを通る

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/satin.test.ts (または render.test.ts) に追加

import { describe, it, expect } from "vitest";
import { renderSatin } from "../render";
import type { EmbroideryObject } from "../types"; // 既存

describe("renderSatin (Phase 4 PR3 経路, disableAutoSplit=false)", () => {
  it("8mm 幅 wide satin で brickSplit が中間点を挿入し、stitch 数が旧 satinStitches より多い", () => {
    // 横長矩形 (長さ 20mm, 幅 8mm) を satin として用意
    const obj: EmbroideryObject = makeRectSatinObject({
      lengthMm: 20,
      widthMm: 8,
      densityMm: 0.4,
      maxStitchMm: 3.0, // 8mm > 3mm なので brick split が走る
    });
    const ctx = makeCtx({ disableAutoSplit: false });

    const { stitches } = renderSatin(obj, ctx);
    const topStitches = stitches.filter((s) => s.kind === "satin");

    // 旧経路 (PCA 単一長軸 satinStitches) なら 1 scanline = 2 stitches、
    // density 0.4 で行数 ≈ 50 → top stitches ≈ 100
    // 新経路 (brick split, dist=8/maxStitchMm=3 → segs=3) なら
    // 1 scanline = 2 + 中間点 3 個 = 5 stitches → top stitches ≈ 250
    expect(topStitches.length).toBeGreaterThan(150);
  });

  it("隣接 3 行の最初の中間点が x 方向で揃わない (needle perforation line の解消)", () => {
    const obj = makeRectSatinObject({
      lengthMm: 20,
      widthMm: 8,
      densityMm: 0.4,
      maxStitchMm: 3.0,
    });
    const ctx = makeCtx({ disableAutoSplit: false });
    const { stitches } = renderSatin(obj, ctx);

    // 各 scanline の「最初の中間点」を row 0, 1, 2 で抽出
    const firstMidpointsByRow = extractFirstMidpointPerRow(stitches, 3);

    // 3 行とも同じ位置に並ばないこと
    const xs = firstMidpointsByRow.map((p) => p[0]);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    expect(max - min).toBeGreaterThan(0.3); // 0.3mm 以上ばらつけば perforation line は解消
  });
});
```

**失敗理由**: `render.ts` の `renderSatin` がまだ旧 `satinStitches` を呼んでいるため、stitch 数が ~100 個に留まり `toBeGreaterThan(150)` に失敗。中間点も無いため `firstMidpointsByRow` が空配列になり後段の `Math.min/max` も意味を成さない。

#### Green — 最小実装

- 変更: `src/lib/pipeline/render.ts`
- 方針:
  - `renderSatin` の本体を以下のフローに差し替え (5.2 の擬似実装)
    1. `effectiveSatinParams(obj, ctx)` で `densityMm`, `maxStitchMm` を取得
    2. `const rails = extractRails(obj.shape);`
    3. `const zigzag = renderSatin2Rail(rails, densityMm, maxStitchMm);`
    4. `const split = applyBrickSplit(zigzag, maxStitchMm);` (ペア単位で `brickSplit`)
    5. `return assembleSatinResult(obj, ctx, entry, split);` (既存ヘルパ)
  - 既存の `satinStitches` 呼び出しは Cycle 5 で互換経路に格納するので、ここでは消して問題なし (Cycle 5 で `disableAutoSplit` 経路から呼び戻す)
- テスト通過: Cycle 4 の 2 ケースが PASS

#### Refactor

- `applyBrickSplit` ヘルパを `render.ts` のファイル内 private に切り出し (= renderer 群と置き場所を揃える)
- Phase 4 PR2 で `renderSatin2Rail` の戻り値が `[left0, right0, right1, left1, ...]` のジグザグだった場合、ペア境界の判定で `rowIndex` が 1 行分の zigzag 1 ペアに対応するかを再確認 (ずれていれば修正)
- 既存テスト全件 PASS を確認

---

### Cycle 5: `disableAutoSplit=true` で旧 `satinStitches` 経路に戻り、既存挙動と一致

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/render.test.ts に追加

import { __internal as stitchInternal } from "../stitch";

describe("renderSatin (disableAutoSplit=true で互換経路)", () => {
  it("disableAutoSplit=true のとき stitch 数が旧 satinStitches と完全一致する", () => {
    const obj = makeRectSatinObject({
      lengthMm: 20,
      widthMm: 8,
      densityMm: 0.4,
      maxStitchMm: 3.0,
    });

    const ctxNew = makeCtx({ disableAutoSplit: false });
    const ctxLegacy = makeCtx({ disableAutoSplit: true });

    const { stitches: newStitches } = renderSatin(obj, ctxNew);
    const { stitches: legacyStitches } = renderSatin(obj, ctxLegacy);

    // 新経路は brick split で stitch 数が増える
    expect(newStitches.length).toBeGreaterThan(legacyStitches.length);

    // 互換経路は旧 satinStitches 直呼びと top stitch 数が一致
    const legacyTop = legacyStitches.filter((s) => s.kind === "satin");
    const rawSatin = stitchInternal.satinStitches(
      obj.shape.outer,
      0.4,
      obj.longAxis,
      obj.center,
    );
    expect(legacyTop.length).toBe(rawSatin.length);
  });

  it("disableAutoSplit=true のとき、Phase 3 PR3 までの既存テスト用フィクスチャと bit-exact (top stitch x,y)", () => {
    // 既存の satin スナップショット相当のフィクスチャ
    const obj = makeRectSatinObject({
      lengthMm: 12,
      widthMm: 3,
      densityMm: 0.5,
      maxStitchMm: 7.0,
    });
    const ctxLegacy = makeCtx({ disableAutoSplit: true });
    const { stitches } = renderSatin(obj, ctxLegacy);
    const top = stitches.filter((s) => s.kind === "satin");

    const raw = stitchInternal.satinStitches(
      obj.shape.outer,
      0.5,
      obj.longAxis,
      obj.center,
    );

    expect(top.length).toBe(raw.length);
    for (let i = 0; i < raw.length; i++) {
      expect(top[i].x).toBeCloseTo(raw[i][0], 6);
      expect(top[i].y).toBeCloseTo(raw[i][1], 6);
    }
  });
});
```

**失敗理由**: Cycle 4 で `renderSatin` を 2-rail + brick split に差し替えた結果、`disableAutoSplit=true` でも新経路が走り、`toBe(rawSatin.length)` と `bit-exact` 比較に失敗する。

#### Green — 最小実装

- 変更: `src/lib/pipeline/render.ts`
- 方針:
  - `RenderOptions` に `disableAutoSplit?: boolean` を追加
  - `renderSatin` の冒頭に互換分岐を入れる:
    ```ts
    if (ctx.opts.disableAutoSplit) {
      const pts = stitchInternal.satinStitches(
        obj.shape.outer, densityMm, obj.longAxis, obj.center,
      );
      return assembleSatinResult(obj, ctx, entry, pts);
    }
    ```
  - 互換経路は brick split を **通さない** ので Phase 1 と完全一致する
- テスト通過: Cycle 1〜5 すべて PASS

#### Refactor

- `disableAutoSplit` 分岐ロジックを `renderSatinLegacy(obj, ctx, entry, densityMm)` private 関数に切り出す
- `RenderOptions` の JSDoc を更新 (`disablePathing`, `disableAutoSplit` がデバッグ目的のフラグだと明記)
- `index.ts` で `RenderOptions` を re-export しているなら新フィールドが伝播していることを確認
- 既存テスト全件 PASS, `npx tsc --noEmit` がエラー無しを確認

---

## 8. サイクル依存グラフ

```
Cycle 1 (短い stitch)
   ↓
Cycle 2 (長い stitch, 行 0)
   ↓
Cycle 3 (位相シフト, 行 0/1/2)
   ↓
Cycle 4 (renderSatin 差し替え, 統合)
   ↓
Cycle 5 (disableAutoSplit 互換経路)
```

直列依存。各サイクルは前のサイクルの実装に対してテストを追加する形で進む。Cycle 3 の Refactor で `lerp` を共通化することで、Cycle 4 の `applyBrickSplit` も同じ `lerp` を使える。

## 9. 回帰防止

- **既存テスト全件パス**: 各サイクル完了時に `npx vitest run` を実行し、`stitch.test.ts`, `render.test.ts`, `compose.test.ts`, `pathing.test.ts`, `policy.test.ts`, Phase 4 PR2 の `satin.test.ts` 既存ケースが緑であることを確認
- **`disableAutoSplit=true` で Phase 1〜3 挙動と一致**: Cycle 5 のテストで bit-exact (toBeCloseTo precision 6) 一致を保証
- **型チェック**: `npx tsc --noEmit` でエラーが出ないこと
- **ベンチマーク的観点**: wide satin (8mm × 20mm, density 0.4mm, maxStitchMm 3mm) で stitch 数が旧経路の 2〜3 倍程度に収まる (Cycle 4 の `toBeGreaterThan(150)` 程度)。極端に増える場合は `applyBrickSplit` の境界処理 (重複点除去) を見直す
- **Phase 2 PR4 の合成順維持**: `assembleSatinResult` を経由するので tie-in / underlay / top / tie-off の順序は変わらないこと。`render.test.ts` 既存スナップショットで自動的に検証される
- **Phase 3 PR3 の entry/exit 駆動経路維持**: `assembleSatinResult` が `entry` 起点で並べ替えるので、本 PR で `entry` 引数を欠落させない (Cycle 4 / 5 の Green 段で必ず `assembleSatinResult(obj, ctx, entry, ...)` を呼ぶ)

## 10. 受け入れ条件

- [ ] `src/lib/pipeline/satin.ts` に `brickSplit(left, right, maxStitchMm, rowIndex): Point2D[]` が export されている
- [ ] `brickSplit` の位相シフトが `phase = (rowIndex % 3) / 3` で実装されており、行 0/1/2 で 0, 1/3, 2/3 を取る
- [ ] 距離 ≤ `maxStitchMm` のとき `brickSplit` は `[left, right]` をそのまま返す
- [ ] 距離 > `maxStitchMm` のとき `brickSplit` は `segs + 2` 個の点を返し、先頭が `left`, 末尾が `right`
- [ ] 隣接 3 行の最初の中間点が x 方向で 0.5mm 以上ばらつく (needle perforation line の解消が単体テストで保証される)
- [ ] `RenderOptions.disableAutoSplit` フラグが追加されている (`boolean | undefined`)
- [ ] `disableAutoSplit=false` (デフォルト) で `renderSatin` は `extractRails` → `renderSatin2Rail` → `brickSplit` のチェーンを通る
- [ ] `disableAutoSplit=true` で `renderSatin` は旧 `satinStitches` を呼び、top stitch の (x, y) が Phase 1 と bit-exact 一致 (precision 6)
- [ ] Phase 2 PR4 の tie-in / underlay / top / tie-off 合成順は変更されない (既存スナップショット保持)
- [ ] Phase 3 PR3 の entry/exit 駆動経路は変更されない (entry 引数が `assembleSatinResult` に伝わる)
- [ ] `npx vitest run` 全件 PASS
- [ ] `npx tsc --noEmit` エラー無し
- [ ] `src/lib/pipeline/__tests__/satin.test.ts` に `brickSplit` 単体テストが 4 ケース以上追加されている
- [ ] `src/lib/pipeline/__tests__/render.test.ts` (または satin.test.ts) に `disableAutoSplit` 互換テストが 2 ケース以上追加されている

## 11. コミット粒度

TDD サイクル単位で 5 コミット。1 サイクル = 1 commit (Red のテスト追加 + Green の実装 + Refactor を同じコミットに含める)。

1. `test(satin): add brickSplit guard for short stitches` (Cycle 1 = Red + Green)
2. `feat(satin): implement brickSplit for long stitches (row 0)` (Cycle 2 = Red + Green)
3. `feat(satin): apply 1/3 phase shift per row in brickSplit` (Cycle 3 = Red + Green + Refactor: lerp 共通化)
4. `feat(render): switch satin renderer to 2-rail + brick split chain` (Cycle 4 = Red + Green + Refactor: applyBrickSplit 抽出)
5. `feat(render): add disableAutoSplit flag for legacy satin path` (Cycle 5 = Red + Green + Refactor: renderSatinLegacy 抽出)

サイクル 1 と 2 はテスト数が少なければ 1 コミットにまとめても良い。

## 12. 想定 PR タイトル

`feat(pipeline): add brick auto-split for wide satin (phase 4 pr3)`

代替案 (CI / changelog の慣習に合わせて):
- `feat(satin): brick auto-split + 2-rail renderer integration (phase 4 pr3)`
- `feat(pipeline): wide satin auto-split with 1/3 phase shift (phase 4 pr3)`

## 13. 注意事項

- **`extractRails` / `renderSatin2Rail` の戻り値順序を Phase 4 PR2 のコードで再確認すること**。`renderSatin2Rail` が `[left0, right0, left1, right1, ...]` を返すのか `[left0, right0, right1, left1, left2, right2, ...]` のジグザグを返すのかで `applyBrickSplit` のペア区切りが変わる。本計画ではジグザグ形式 (= 隣接 2 点が 1 stitch) を仮定したが、PR2 の実装が単純なペア列なら `applyBrickSplit` の `rowIndex = i / 2` を `rowIndex = i` 等に調整する必要がある
- **`maxStitchMm` の取得元**: `obj.props.maxStitchMm` を最優先, 無ければ `obj.fabric.maxStitchMm`, 無ければ `ctx.opts.defaultMaxStitchMm`。既存 `effectiveSatinParams` の流儀に合わせること
- **`brickSplit` の `t` クランプ**: `phase > 0` のとき最後の `i = segs` で `t = (segs - 1 + phase) / segs > 1` になり得るが (実際 phase=2/3, segs=3 で t = (2 + 2/3) / 3 = 8/9 < 1 なので OK)、念のため `Math.min(1, Math.max(0, t))` でクランプしておく
- **重複点の除去**: `brickSplit` が `phase=0` のとき `i=1, t=0` で `left` と完全に一致する点を出力する。`applyBrickSplit` でペア跨ぎ時に `pointsEqual` で重複を除去する処理を入れること
- **既存 `satinStitches` の export**: `stitch.ts` で `__internal.satinStitches` として既に export されているはず (Phase 3 PR3 計画書を参照)。されていなければ `__internal` に追加する小修正が本 PR に含まれる
- **`disableAutoSplit` のデフォルト**: `undefined` (= `false` 扱い) で新経路。テスト / デバッグ用途以外で `true` に切る運用は想定しない
- **Phase 4 PR2 が `extractRails` で空 rail を返すケース**: 退化形状で `left.length === 0` のとき `renderSatin2Rail` がどう振る舞うかは PR2 の責務。本 PR では `renderSatin2Rail` の戻り値が空配列なら `applyBrickSplit` も空配列を返し、最終的に `assembleSatinResult` が underlay のみで構成された結果を返す形になる (= regression なし)

