# Phase 4 PR4: Medial-axis run — TDD 計画

## 1. 概要

Phase 4 計画書 6 (Run の Medial-Axis 化) を実装する。現状 `stitch.ts:106` では `shortSide < runMaxWidthMm (0.6mm)` の細い領域に対して **外形 polyline をそのまま resample** しているため、1px 線でも外形を 1 周なぞる「ループ run」になってしまい、線幅の中心線にならない。

本 PR では:

1. `opencv-worker.ts` (および `/public/opencv-kmeans.worker.js`) に **OpenCV.js `cv.ximgproc.thinning` (Zhang-Suen)** を呼ぶ新メッセージ `skeletonize` を追加し、1ch binary mask を **1px 幅 skeleton mask** に変換する
2. 新規 `src/lib/pipeline/run.ts` に **skeleton mask → polyline 列** 変換 (`extractMedialAxis(mask, w, h, mmPerPx)`) を実装。端点 / 分岐点を検出し、8 近傍トラバースで L 字 / T 字 / 円形 (閉ループ) に対応
3. `stitch.ts` (Phase 1 PR3 未マージ環境では `generateStitches` 内、マージ済みなら `build-objects.ts`) で **`shortSide < 1.0mm`** の領域を medial-axis 経路に切り替える。`runMaxWidthMm` のデフォルトを 0.6 → 1.0mm に引き上げる
4. 太い領域 (`shortSide >= 1.0mm`) は従来の satin / fill ルートを保持し、外形ループ run には戻らない (= run はもう外形ループしない)

Phase 4 計画書 6.2 の純 TS 実装 (Telea ZS thinning / Voronoi) は本 PR では採用せず、OpenCV.js 経由 Web Worker に統一する。理由: 既に opencv-worker.ts で WASM が常駐しており、新規依存追加が不要。

## 2. 依存関係

- **Phase 1 全体**: `Shape`, `Polygon`, `ColorRegion`, `generateStitches`, `resamplePolyline` が存在する前提
- **Phase 2 PR1〜PR4**: compensation / underlay / tie-in/tie-off の合成順は維持。本 PR は run の **頂点列の作り方** を変えるだけで kind 自体は `"run"` のまま
- **Phase 3 PR1〜PR3**: pathing / TRIM_POLICY 経路に変化なし。entry/exit は polyline 端点に近い側を採用
- **Phase 4 PR1 (fill tatami brick)**: 本 PR は run の閾値を変えるため、それ以上の領域が必ず fill / satin に流れる。PR1 の `tatamiBrick` が動いていること
- **Phase 4 PR2 (satin 2-rail)**: 2-rail satin が動いていること
- **Phase 4 PR3 (auto split / brick split)**: 本 PR と直接干渉しないが、satin 経路の brick split が壊れていないこと

PR1〜PR3 のいずれかが未マージの状態で本 PR を着手しないこと。本 PR は **run kind の頂点抽出ロジック差し替え** のみに集中する。

## 3. 影響ファイル

### 新規

- `src/lib/pipeline/run.ts` — `extractMedialAxis(skeletonMask, width, height, mmPerPx)` と、上位向け `medialAxisRun(shape, mmPerPx, densityMm)` を実装
- `src/lib/pipeline/__tests__/run.test.ts` — Vitest テスト
- (環境次第) `src/lib/pipeline/__tests__/run.fixtures.ts` — 1px 対角線 / L 字 / 細長矩形 / 円形 などの skeleton mask フィクスチャ

### 編集

- `src/lib/pipeline/opencv-worker.ts` — 新メッセージ `skeletonize` (input: 1ch `Uint8Array` mask + `width/height`、output: 1px skeleton `Uint8Array`) を `skeletonizeViaWorker(mask, w, h)` として公開
- `public/opencv-kmeans.worker.js` — `cv.ximgproc.thinning(src, dst, cv.ximgproc.THINNING_ZHANGSUEN)` を呼ぶハンドラを追加。`cv.ximgproc` が無いビルド (opencv.js の "core only" 配布) を踏んだ場合はエラー応答する
- `src/lib/pipeline/stitch.ts` — `generateStitches` 内の `if (shortSide < runMaxWidthMm)` ブランチを **shape のラスタライズ → skeleton → polyline 列 → 各 polyline を appendStitchesWithJumps** に置き換える。`runMaxWidthMm` のデフォルトを 0.6 → 1.0mm に引き上げる
- (Phase 1 PR3 マージ済みなら) `src/lib/pipeline/build-objects.ts` — object kind を決める分岐で `shortSide < 1.0mm` → `kind: "run"` (medial-axis 経由) を割り当て。マージ前なら本 PR では `stitch.ts` のみ編集

### 参照のみ

- `src/lib/pipeline/types.ts` — `Shape`, `StitchKind`, `Polygon`
- `src/lib/pipeline/vectorize.ts` — `ColorRegion` 型
- `src/lib/pipeline/__tests__/stitch.test.ts` — 既存テストの run kind ケースが新ルートでも維持されること

### opencv.js ビルドの確認 (作業前提)

- `cv.ximgproc` は **opencv.js の "contrib" モジュール** に含まれる。`public/opencv.js` が contrib 入りビルドでない場合は **差し替えが必要**
- 確認手順: ブラウザコンソールで `cv.ximgproc?.thinning` を評価し、関数として存在することを確認
- 差し替えが必要な場合は `public/opencv.js` を `opencv.js (with contrib, ~10MB)` に更新する。例: <https://docs.opencv.org/4.x/opencv.js> もしくは ビルド済み配布 (`@techstark/opencv-js` の `dist/opencv.js`) を採用
- 純 TS フォールバックは本 PR では実装しない。`cv.ximgproc?.thinning` 不在時はワーカーから `{ type: "error", message: "thinning unsupported" }` を返し、テストでは `vi.mock("./opencv-worker", ...)` で固定 skeleton mask を流し込む

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **実行コマンド**:
  - 単発: `npx vitest run src/lib/pipeline/__tests__/run.test.ts`
  - 関連: `npx vitest run src/lib/pipeline/__tests__/{run,stitch}.test.ts`
  - 全件: `npx vitest run`
  - 型チェック: `npx tsc --noEmit`
- **テストファイル配置**: `src/lib/pipeline/__tests__/*.test.ts`
- **Worker のモック**: `vi.mock("../opencv-worker", () => ({ skeletonizeViaWorker: vi.fn(...) }))` で `extractMedialAxis` のテストでは worker を経由せず、**事前計算済みの 1px skeleton mask** をハードコードしたフィクスチャから流し込む。Worker の `cv.ximgproc.thinning` 呼び出し自体はブラウザ実機 (manual smoke) で確認する

## 5. インターフェース設計

### 5.1 `opencv-worker.ts` への `skeletonize` 追加

```ts
// src/lib/pipeline/opencv-worker.ts

export type SkeletonizeInput = {
  /** 1ch 2 値 mask (0 or 255)。length は width*height */
  mask: Uint8Array;
  width: number;
  height: number;
};

export type SkeletonizeOutput = {
  /** 1px 幅の skeleton mask (0 or 255)。length は width*height */
  skeleton: Uint8Array;
  width: number;
  height: number;
};

/**
 * OpenCV.js (cv.ximgproc.thinning, Zhang-Suen) を Web Worker 経由で呼んで
 * 1px 幅 skeleton mask を得る。
 *
 * - 入力 mask は前景 255, 背景 0 を期待 (それ以外の値は二値化される)
 * - 出力 skeleton も 255/0
 * - cv.ximgproc が存在しないビルドでは Promise reject
 */
export async function skeletonizeViaWorker(
  input: SkeletonizeInput,
): Promise<SkeletonizeOutput>;
```

Worker 側 `public/opencv-kmeans.worker.js` に追加するハンドラ:

```js
// handle({ type: 'skeletonize', seq, width, height, maskBuffer })
//   → postMessage({ type: 'skeleton-result', seq, width, height, skeletonBuf }, [skeletonBuf])
function handleSkeletonize(msg) {
  const { seq, width, height, maskBuffer } = msg;
  if (!cv.ximgproc || !cv.ximgproc.thinning) {
    self.postMessage({ type: 'error', seq, message: 'thinning unsupported (cv.ximgproc missing)' });
    return;
  }
  const mask = new Uint8Array(maskBuffer);
  let src = null, dst = null;
  try {
    src = cv.matFromArray(height, width, cv.CV_8UC1, mask);
    dst = new cv.Mat();
    cv.ximgproc.thinning(src, dst, cv.ximgproc.THINNING_ZHANGSUEN);
    const skel = new Uint8Array(dst.data.length);
    skel.set(dst.data);
    const buf = skel.buffer;
    self.postMessage({ type: 'skeleton-result', seq, width, height, skeletonBuf: buf }, [buf]);
  } finally {
    if (src) src.delete();
    if (dst) dst.delete();
  }
}
```

`opencv-worker.ts` 側は既存の `quantizeViaWorker` と同様、seq でリクエストを引き当てる。`getWorker` / `WorkerMsg` union に `SkeletonResultMsg` を追加する。

### 5.2 `run.ts` の公開 API

```ts
// src/lib/pipeline/run.ts

import type { Shape } from "./types";
import { skeletonizeViaWorker } from "./opencv-worker";

export type Point = [number, number];
export type Polyline = Point[];

/**
 * 1px 幅 skeleton mask を 8-連結トラバースで polyline 列に変換する。
 *
 * - skeleton[y * width + x] === 255 が骨格点
 * - 端点 (隣接骨格数 = 1) / 分岐点 (隣接骨格数 >= 3) で polyline を切る
 * - 純粋な閉ループ (端点 0, 分岐点 0) は始点を固定して 1 周分の polyline を出力
 * - 出力座標は **mm 単位** (mmPerPx を掛けたあと、ピクセル中心オフセット +0.5 を加算)
 *
 * 純関数。Worker は触らない。
 */
export function extractPolylines(
  skeleton: Uint8Array,
  width: number,
  height: number,
  mmPerPx: number,
): Polyline[];

/**
 * Shape (mm 単位の outer/holes) から medial-axis polyline を抽出する高レベル API。
 *
 * 1. shape を `cellSizeMm` (= mmPerPx) のラスタに塗って 1ch mask を作る
 * 2. skeletonizeViaWorker で 1px 幅 skeleton を得る
 * 3. extractPolylines で polyline 列に変換
 * 4. 各 polyline を densityMm で resample
 */
export async function medialAxisRun(
  shape: Shape,
  mmPerPx: number,
  densityMm: number,
): Promise<Polyline[]>;

/**
 * Shape を 1ch mask にラスタライズする (内部ヘルパだが run.test.ts から触れるよう export)。
 *
 * - 出力は (Math.ceil(boundingBox.widthMm / mmPerPx) + 2) * (h + 2) の Uint8Array
 * - 余白 1px を周囲に確保し、thinning の端処理を安定化
 * - holes は 0 で塗り戻し
 */
export function rasterizeShape(
  shape: Shape,
  mmPerPx: number,
): { mask: Uint8Array; width: number; height: number; offsetMm: Point };
```

### 5.3 `stitch.ts` の分岐差し替え

```ts
// src/lib/pipeline/stitch.ts (該当箇所のみ)

const runMaxWidthMm = input.runMaxWidthMm ?? 1.0; // 0.6 → 1.0 に引き上げ

// ... shape ループ内 ...
if (shortSide < runMaxWidthMm) {
  // medial-axis 経路 (新)
  const polylines = await medialAxisRun(shapeMm, mmPerPx, stitchDensityMm);
  for (const pts of polylines) {
    if (pts.length === 0) continue;
    appendStitchesWithJumps(
      block,
      pts,
      "run",
      region.colorIndex,
      maxStitchMm,
      trimThresholdMm,
      true,
    );
  }
  continue;
}
```

`generateStitches` は **async 化** が必要。呼び出し側 (`compose.ts` / `index.ts`) も `await` を伝播させる。既存テストの同期呼び出しは `await generateStitches(...)` に書き換える。

### 5.4 ファイル構成

- `src/lib/pipeline/run.ts` — 新規
- `src/lib/pipeline/__tests__/run.test.ts` — 新規
- `src/lib/pipeline/opencv-worker.ts` — 編集 (`skeletonizeViaWorker` 追加)
- `public/opencv-kmeans.worker.js` — 編集 (skeletonize ハンドラ追加)
- `src/lib/pipeline/stitch.ts` — 編集 (run ブランチ差し替え + async 化)
- `src/lib/pipeline/__tests__/stitch.test.ts` — 編集 (await + worker モック)

## 6. TDD サイクル

### Cycle 1: 1px 対角線 binary mask → polyline 1 本 (extractPolylines 純関数)

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/run.test.ts
import { describe, it, expect } from "vitest";
import { extractPolylines } from "../run";

describe("extractPolylines", () => {
  it("converts a 1px diagonal skeleton into a single polyline of all skeleton points", () => {
    // 5x5 mask: 左上 (0,0) から右下 (4,4) への対角線、1px 幅
    const W = 5;
    const H = 5;
    const skel = new Uint8Array(W * H);
    for (let i = 0; i < 5; i++) skel[i * W + i] = 255;

    const polylines = extractPolylines(skel, W, H, /* mmPerPx */ 0.1);

    expect(polylines).toHaveLength(1);
    expect(polylines[0]).toHaveLength(5);
    // 端点 (0,0) → (4,4) の順、もしくは逆順のどちらかで揃っていること
    const first = polylines[0][0];
    const last = polylines[0][polylines[0].length - 1];
    const endpoints = new Set([
      `${first[0].toFixed(3)},${first[1].toFixed(3)}`,
      `${last[0].toFixed(3)},${last[1].toFixed(3)}`,
    ]);
    // ピクセル中心オフセット 0.5 + mmPerPx 0.1 → (0.05, 0.05) と (0.45, 0.45)
    expect(endpoints).toEqual(
      new Set(["0.050,0.050", "0.450,0.450"]),
    );
  });
});
```

失敗理由: `src/lib/pipeline/run.ts` が未作成。`extractPolylines` のシンボルが解決できず ModuleNotFound

#### Green — 最小実装

- 変更: `src/lib/pipeline/run.ts` (新規)
- 方針:
  1. 8 近傍を走査するヘルパ `neighbors8(x, y, w, h, skel)` を定義
  2. 全ピクセルを走査し、近傍カウント 1 の点を **端点リスト** に積む
  3. 端点が見つかった場合、そこから 8-連結トラバース (訪問済みは bool 配列で管理) で進める。次の近傍が 1 つだけならそれを採用、2 つ以上なら分岐点として終端。極端単純化として **Cycle 1 では端点 1 つだけのケースを処理** すれば十分 (対角線は端点 2 つだが片端から舐めるとループ自然終了)
  4. 座標は `[(x + 0.5) * mmPerPx, (y + 0.5) * mmPerPx]` で出力
- まだ閉ループ・分岐は実装しない (next Cycle で扱う)

#### Refactor

- まだ 1 テストしかないので不要

---

### Cycle 2: L 字 1px → 分岐点で polyline が 2 本 (T 字分岐の網羅)

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/run.test.ts
it("splits at a T-junction into multiple polylines", () => {
  // 7x7 mask: T 字
  //   row 3: x=1..5 (水平)
  //   col 3: y=3..5 (垂直、下方向)
  // 分岐点: (3, 3)
  const W = 7, H = 7;
  const skel = new Uint8Array(W * H);
  for (let x = 1; x <= 5; x++) skel[3 * W + x] = 255;
  for (let y = 3; y <= 5; y++) skel[y * W + 3] = 255;

  const polylines = extractPolylines(skel, W, H, 0.1);

  // 期待: 3 本 (左腕, 右腕, 下腕)。分岐点 (3,3) は各 polyline の端点として重複出現
  expect(polylines).toHaveLength(3);

  // 全 polyline に分岐点 (3,3) → mm 座標 (0.35, 0.35) がいずれかの端にあること
  const branchPoint = "0.350,0.350";
  for (const pl of polylines) {
    const endpts = [pl[0], pl[pl.length - 1]].map(
      ([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`,
    );
    expect(endpts).toContain(branchPoint);
  }

  // 各 polyline の点数は 3 (左/下/右の各腕、分岐点含む)
  for (const pl of polylines) expect(pl.length).toBe(3);
});

it("splits an L-shape with a single bend into a single polyline (no junction)", () => {
  // 5x5 mask: L 字 (折れ曲がり、分岐なし)
  //   row 2: x=0..2 + col 2: y=2..4
  const W = 5, H = 5;
  const skel = new Uint8Array(W * H);
  for (let x = 0; x <= 2; x++) skel[2 * W + x] = 255;
  for (let y = 2; y <= 4; y++) skel[y * W + 2] = 255;

  const polylines = extractPolylines(skel, W, H, 0.1);

  // 折れ曲がりは分岐点ではない (近傍 = 2) → 1 本でつながる
  expect(polylines).toHaveLength(1);
  // 端点は (0,2) と (2,4) → mm (0.05, 0.25), (0.25, 0.45)
  expect(polylines[0]).toHaveLength(5);
});
```

失敗理由: Cycle 1 の実装は分岐点での停止と「分岐点を 3 本の端点として重複出力」を扱っていない

#### Green — 最小実装

- 変更: `src/lib/pipeline/run.ts`
- 方針:
  1. 全骨格点について **近傍数を事前計算 (`degree[idx]`)** し、`degree === 1` → 端点、`degree >= 3` → 分岐点とラベル
  2. 訪問済みフラグは「骨格点 → エッジ」単位ではなく **骨格点 → エッジ集合** で持つ (`visitedEdge: Set<string>` で `"a-b"` キー)
  3. 端点 / 分岐点を起点に「次の近傍が分岐点に達するか端点に達するまで進む」ループで polyline を抽出
  4. 各分岐から **出ているエッジの数** だけ polyline を生やす。L 字 (近傍 = 2 で折れる点) は分岐点ではないので 1 本のままになる

#### Refactor

- 8-近傍 offset 配列 `DX8`, `DY8` をモジュール定数化
- `traverseFrom(start, skel, w, h, degree, visitedEdge)` を private helper として抽出

---

### Cycle 3: 円形 1px → 閉じた polyline (端点も分岐点もないケース)

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/run.test.ts
it("returns a closed polyline for a 1px ring (no endpoints, no junctions)", () => {
  // 9x9 mask: 1px 幅の正方形リング (4 辺)
  const W = 9, H = 9;
  const skel = new Uint8Array(W * H);
  for (let x = 2; x <= 6; x++) {
    skel[2 * W + x] = 255;   // top
    skel[6 * W + x] = 255;   // bottom
  }
  for (let y = 2; y <= 6; y++) {
    skel[y * W + 2] = 255;   // left
    skel[y * W + 6] = 255;   // right
  }

  const polylines = extractPolylines(skel, W, H, 0.1);

  expect(polylines).toHaveLength(1);
  const ring = polylines[0];
  // 16 ピクセル (周長) + 始点を末尾に重複させて閉じる規約 → 17 点
  expect(ring).toHaveLength(17);
  expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 5);
  expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 5);
});
```

失敗理由: Cycle 2 の実装は「端点 / 分岐点が 1 つも無い場合」を処理しておらず、空配列を返す

#### Green — 最小実装

- 変更: `src/lib/pipeline/run.ts`
- 方針: 端点 / 分岐点リストが空かつ未訪問骨格点が残っていれば、その点を仮の始点として 1 周トラバース。元の始点に戻ったら **終点として始点を末尾に push し閉じる**

#### Refactor

- `extractPolylines` を以下に分割:
  - `classifyDegrees(skel, w, h)` → `Uint8Array degree`
  - `walkFromEndpoint(start, ...)` (Cycle 2)
  - `walkFromBranch(start, ...)` (Cycle 2)
  - `walkClosedLoop(start, ...)` (Cycle 3)
- Cycle 1 で書いた直線処理は walkFromEndpoint の特例として吸収

---

### Cycle 4: rasterizeShape — Shape を 1ch mask に塗る

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/run.test.ts
import { rasterizeShape } from "../run";

describe("rasterizeShape", () => {
  it("rasterizes a thin rectangle (0.4mm x 4mm) into a 1px wide mask", () => {
    // 縦長矩形: x ∈ [0, 0.4], y ∈ [0, 4.0]
    const shape: Shape = {
      outer: [[0, 0], [0.4, 0], [0.4, 4.0], [0, 4.0]],
      holes: [],
    };
    const { mask, width, height } = rasterizeShape(shape, /* mmPerPx */ 0.1);

    // 0.4mm / 0.1mm = 4px 幅 + 余白 2px = 6
    // 4.0mm / 0.1mm = 40px 高 + 余白 2px = 42
    expect(width).toBe(6);
    expect(height).toBe(42);

    // 内部の任意点 (x=2, y=20) は 255
    expect(mask[20 * width + 2]).toBe(255);
    // 余白 (x=0, y=0) は 0
    expect(mask[0 * width + 0]).toBe(0);
  });

  it("zeroes pixels inside holes", () => {
    const shape: Shape = {
      outer: [[0, 0], [4, 0], [4, 4], [0, 4]],          // 4x4 mm
      holes: [[[1.5, 1.5], [2.5, 1.5], [2.5, 2.5], [1.5, 2.5]]], // 1x1 mm hole
    };
    const { mask, width } = rasterizeShape(shape, 0.1);
    // hole 中央 (2.0, 2.0) mm = (20+1, 20+1) (offset 1) → 0 のはず
    expect(mask[(20 + 1) * width + (20 + 1)]).toBe(0);
    // 外側 (3.5, 0.5) → 255
    expect(mask[(5 + 1) * width + (35 + 1)]).toBe(255);
  });
});
```

失敗理由: `rasterizeShape` 未実装

#### Green — 最小実装

- 変更: `src/lib/pipeline/run.ts`
- 方針:
  1. `outer` polygon の bounding box (mm) を求め、`width = ceil(bbWidthMm / mmPerPx) + 2`, `height = ceil(bbHeightMm / mmPerPx) + 2`, `offsetMm = [bbMinX - mmPerPx, bbMinY - mmPerPx]` で余白 1px を確保
  2. ピクセル中心 (x+0.5, y+0.5) を mm 座標に逆変換して、point-in-polygon (ray casting) で outer 内かつ holes 外なら 255
  3. 純関数。OpenCV や Canvas 依存はしない (テストが Node.js で完結する)

#### Refactor

- `pointInPolygon(point, polygon)` を private helper として抽出 (テスト容易性)
- bounding box 計算を `boundingBox(polygon)` で抽出

---

### Cycle 5: medialAxisRun — Worker 経由で polyline 列を返す (mock 統合)

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/run.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../opencv-worker", () => ({
  skeletonizeViaWorker: vi.fn(),
}));

import { skeletonizeViaWorker } from "../opencv-worker";
import { medialAxisRun, rasterizeShape } from "../run";

describe("medialAxisRun", () => {
  beforeEach(() => {
    vi.mocked(skeletonizeViaWorker).mockReset();
  });

  it("passes the rasterized mask to the worker and returns mm-space polylines", async () => {
    // 細長矩形: 0.4mm x 10mm → skeleton は中心線 1 本 (y 軸方向)
    const shape: Shape = {
      outer: [[0, 0], [0.4, 0], [0.4, 10], [0, 10]],
      holes: [],
    };
    const mmPerPx = 0.1;

    // worker のレスポンスは「中心線が立った skeleton」を擬似生成
    vi.mocked(skeletonizeViaWorker).mockImplementation(async ({ mask, width, height }) => {
      const skel = new Uint8Array(width * height);
      // mask 内の中央 x で y 方向に骨格を立てる
      const cx = Math.floor(width / 2);
      for (let y = 0; y < height; y++) {
        if (mask[y * width + cx] === 255) skel[y * width + cx] = 255;
      }
      return { skeleton: skel, width, height };
    });

    const polylines = await medialAxisRun(shape, mmPerPx, /* densityMm */ 0.3);

    expect(skeletonizeViaWorker).toHaveBeenCalledOnce();
    expect(polylines).toHaveLength(1);
    // 中心線は x ≈ 0.2 (矩形中央)、y は 0 〜 10 を 0.3mm 刻みでサンプル
    const xs = polylines[0].map(([x]) => x);
    expect(xs.every((x) => Math.abs(x - 0.2) < 0.15)).toBe(true);
    // resample で密度通り
    const ys = polylines[0].map(([_, y]) => y);
    for (let i = 1; i < ys.length; i++) {
      const d = Math.abs(ys[i] - ys[i - 1]);
      expect(d).toBeLessThanOrEqual(0.3 + 1e-6);
    }
  });

  it("returns empty array if the worker returns an all-zero skeleton", async () => {
    vi.mocked(skeletonizeViaWorker).mockResolvedValue({
      skeleton: new Uint8Array(100),
      width: 10,
      height: 10,
    });
    const out = await medialAxisRun(
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      0.1,
      0.3,
    );
    expect(out).toEqual([]);
  });
});
```

失敗理由: `medialAxisRun` 未実装

#### Green — 最小実装

- 変更: `src/lib/pipeline/run.ts`
- 方針:
  1. `rasterizeShape(shape, mmPerPx)` で mask 生成
  2. `skeletonizeViaWorker({ mask, width, height })` を await
  3. `extractPolylines(skeleton, w, h, mmPerPx)` で polyline 列を取得
  4. 各 polyline に `offsetMm` を加算 (rasterize で生じた余白 1px 分を mm に戻す)
  5. 各 polyline を `resamplePolyline(pl, densityMm)` で再サンプル (`stitch.ts` から export 済み)

#### Refactor

- `extractPolylines` が返す座標系を「raster ローカル」のままにし、`medialAxisRun` 側で `offsetMm` を加算するように責務分離
- `resamplePolyline` は閉ループ前提 (`polyline.concat([polyline[0]])`) なので、開始端と終端が異なる polyline をそのまま渡せる版 `resampleOpenPolyline` を `run.ts` に private 実装 (もしくは stitch.ts に追加)

---

### Cycle 6: stitch.ts 統合 — 細い領域 (shortSide < 1mm) は medial-axis、太い領域は従来ルート維持

#### Red — 失敗するテスト

```ts
// src/lib/pipeline/__tests__/stitch.test.ts (既存ファイルに追加)
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../opencv-worker", async () => {
  const actual = await vi.importActual<any>("../opencv-worker");
  return {
    ...actual,
    skeletonizeViaWorker: vi.fn(),
  };
});

import { skeletonizeViaWorker } from "../opencv-worker";
import { generateStitches } from "../stitch";

describe("generateStitches medial-axis routing", () => {
  beforeEach(() => vi.mocked(skeletonizeViaWorker).mockReset());

  it("routes a thin shape (shortSide 0.4mm) through medial-axis, not the outline loop", async () => {
    // 0.4mm x 8mm の細い矩形 → shortSide 0.4 < 1.0mm
    vi.mocked(skeletonizeViaWorker).mockImplementation(async ({ mask, width, height }) => {
      // 中心 x で y 方向に骨格を立てる
      const skel = new Uint8Array(width * height);
      const cx = Math.floor(width / 2);
      for (let y = 0; y < height; y++) {
        if (mask[y * width + cx] === 255) skel[y * width + cx] = 255;
      }
      return { skeleton: skel, width, height };
    });

    const regions = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0] as [number, number, number],
        shapes: [{
          outer: [[0, 0], [4, 0], [4, 80], [0, 80]],   // px 単位 (mmPerPx=0.1)
          holes: [],
        }],
      },
    ];
    const pattern = await generateStitches({
      regions,
      widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
      stitchDensityMm: 0.3, satinMaxWidthMm: 2.0,
    });

    expect(skeletonizeViaWorker).toHaveBeenCalledOnce();
    const stitches = pattern.blocks[0].stitches.filter((s) => s.kind === "run");
    // 中心線 (x ≈ 0.2) のみ並ぶこと: x が 0.2 から外れる点が無い
    const xs = stitches.map((s) => s.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.15);
    // 外形ループだった場合は (0, 0.4) の両端で x が 0 と 0.4 にもなる → そうなっていないこと
    expect(stitches.some((s) => s.x < 0.05)).toBe(false);
    expect(stitches.some((s) => s.x > 0.35)).toBe(false);
  });

  it("does NOT call skeletonize for a wide shape (shortSide 3mm) and keeps satin/fill route", async () => {
    const regions = [
      {
        colorIndex: 0,
        rgb: [0, 0, 0] as [number, number, number],
        shapes: [{
          outer: [[0, 0], [30, 0], [30, 80], [0, 80]],  // 3mm x 8mm = aspect 2.67、shortSide 3
          holes: [],
        }],
      },
    ];
    const pattern = await generateStitches({
      regions,
      widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
      stitchDensityMm: 0.3, satinMaxWidthMm: 2.0,
    });
    expect(skeletonizeViaWorker).not.toHaveBeenCalled();
    // run kind は無く、fill or satin
    const kinds = new Set(pattern.blocks[0].stitches.map((s) => s.kind));
    expect(kinds.has("run")).toBe(false);
  });
});
```

失敗理由:
1. `generateStitches` がまだ同期関数で、`await generateStitches(...)` の型エラー
2. `shortSide < runMaxWidthMm` ブランチがまだ外形 polyline `resamplePolyline(outerMm, ...)` を使っている → x が 0 と 0.4 の両端に出る

#### Green — 最小実装

- 変更: `src/lib/pipeline/stitch.ts`
- 方針:
  1. `generateStitches` を `async function ... Promise<StitchPattern>` 化
  2. shape ループ内の `if (shortSide < runMaxWidthMm)` ブランチを `medialAxisRun(shapeMm, mmPerPx, stitchDensityMm)` 呼び出しに置き換え、`appendStitchesWithJumps` を polyline ごとに呼ぶ
  3. `runMaxWidthMm` のデフォルトを `0.6` から `1.0` に変更
  4. 既存テスト (`stitch.test.ts`) のうち `generateStitches` を呼んでいるものすべてに `await` を付与
  5. `compose.ts` / `index.ts` から呼んでいる箇所も同様に async/await を伝播

#### Refactor

- shape ごとに kind を判定するブランチを `chooseShapeKind(shape, runMaxWidthMm, satinMaxWidthMm)` で関数化し、`generateStitches` 本体の見通しを良くする (テスト追加の必要なし、純粋抽出)
- `mmPerPx` の伝搬を `StitchInput` の派生で 1 度だけ計算

---

### Cycle 7: opencv-worker 統合 — skeletonizeViaWorker の seq 管理

#### Red — 失敗するテスト

`opencv-worker.ts` の Worker 統合は **ブラウザ環境前提** で Vitest (jsdom) では Worker URL が解決できないため、ユニットテストではなく型レベル + smoke test を採用する。

```ts
// src/lib/pipeline/__tests__/opencv-worker.skeletonize.test.ts
// jsdom 上では new Worker("/opencv-kmeans.worker.js") は throw する。
// そこで、本テストは Worker をモックして「メッセージプロトコルが seq 単位で一致するか」だけ検証する。
import { vi, describe, it, expect, beforeEach } from "vitest";

class MockWorker {
  public listeners: Record<string, ((e: any) => void)[]> = {};
  public lastPostedMessage: any = null;
  public lastTransferables: ArrayBuffer[] | undefined;
  addEventListener(name: string, fn: (e: any) => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: (e: any) => void) {
    this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn);
  }
  postMessage(msg: any, transfer?: ArrayBuffer[]) {
    this.lastPostedMessage = msg;
    this.lastTransferables = transfer;
    // 即座に ready を返す
    if (this.listeners.message?.length) {
      // 本テストでは ready は手動で発火
    }
  }
  terminate() {}
}

vi.stubGlobal("Worker", MockWorker);

describe("skeletonizeViaWorker (protocol)", () => {
  it("posts a 'skeletonize' message with mask/width/height and resolves on matching seq", async () => {
    // (実装は postMessage を spy して、対応する seq で skeleton-result を return することを検証)
    // 実装側で getWorker を export 可能にして DI するか、もしくは
    // 本テストは optional とし、Cycle 6 の generateStitches テスト (worker mock 済み) で十分とする
  });
});
```

失敗理由: `skeletonizeViaWorker` のメッセージプロトコルが未実装

#### Green — 最小実装

- 変更: `src/lib/pipeline/opencv-worker.ts`
- 方針:
  1. `WorkerMsg` union に `{ type: "skeleton-result"; seq; width; height; skeletonBuf: ArrayBuffer }` を追加
  2. `seqCounter` を共用し、`skeletonizeViaWorker` 内で `++seqCounter` で seq を取得
  3. `postMessage({ type: "skeletonize", seq, width, height, maskBuffer }, [maskBuffer])` を transferable で送る
  4. `onMessage` 内で `data.type === "skeleton-result" && data.seq === seq` のときに `resolve({ skeleton: new Uint8Array(data.skeletonBuf), width, height })`
  5. timeout, error 経路は `quantizeViaWorker` のコードをそのまま流用 (DRY のために `requestViaWorker(seq, payload, parseResult)` ヘルパへ抽出してもよいが本 PR では小さなコピーで足りる)
- 同時に `public/opencv-kmeans.worker.js` に `handleSkeletonize` を追加し、`self.onmessage` のディスパッチで `msg.type === "skeletonize"` を分岐
- `cv.ximgproc?.thinning` が undefined なら `{ type: "error", seq, message: "thinning unsupported" }` を返す

#### Refactor

- `opencv-worker.ts` 内の重複 (timeout / message listener / transfer の組み立て) を `request<TIn, TOut>(type, payload, parseResult, timeoutMs)` ヘルパに抽出。`quantizeViaWorker` と `skeletonizeViaWorker` の両方を ~10 行で書けるようにする
- 抽出後、`quantizeViaWorker` の既存テストが通ることを再確認

---

## 7. サイクル依存グラフ

```
Cycle 1 (直線) ─┐
                ├─→ Cycle 3 (閉ループ)
Cycle 2 (T 字) ─┘
                ↓
            Cycle 4 (rasterize、独立だが先行可)
                ↓
            Cycle 5 (medialAxisRun 統合、worker mock)
                ↓
            Cycle 6 (stitch.ts 経路差し替え + async 化)
                ↓
            Cycle 7 (opencv-worker.ts に skeletonize 追加 + worker.js)
```

Cycle 1〜3 は `extractPolylines` の段階的拡張。Cycle 4 は独立。Cycle 5 は 1〜4 すべてに依存。Cycle 6 は 5 に依存。Cycle 7 は実機統合で、Vitest 上は mock 統合だが Cycle 6 のテストを Worker 実体で動かすときに必要。

## 8. 回帰防止

- **既存テスト全件パス** (`npx vitest run`) — 特に:
  - `stitch.test.ts` の satin / fill ケース: shortSide が 1mm 以上なら新ルートを通らないこと
  - `stitch.test.ts` の既存 run ケース (もしあれば 0.4mm 線など): **新ルート (medial-axis) でも `kind === "run"` のままで、stitch 数が単調増加しないこと** を必ず assert
  - `vectorize.test.ts`: vectorize 結果は本 PR で変えていないので影響なし
- **async 化伝播** (`generateStitches` を呼ぶ全ファイル):
  - `compose.ts`, `index.ts`, `src/components/embroidery-studio.tsx` などで `await` 漏れがないか `npx tsc --noEmit` で確認
- **既存 fill / satin ルートの不変**: `shortSide >= 1.0mm` の入力で `skeletonizeViaWorker` が **1 度も呼ばれない** ことを Cycle 6 で assert (`expect(skeletonizeViaWorker).not.toHaveBeenCalled()`)
- **runMaxWidthMm の閾値変更影響**:
  - `runMaxWidthMm` のデフォルトを 0.6 → 1.0 に上げるため、**0.6 〜 1.0mm の細線が新たに run 扱いになる**。これは意図した拡大 (Phase 4 計画書 6.3)。既存テストでこの範囲を fill / satin で assert していないか確認。引っかかれば assert を更新

## 9. 受け入れ条件

- [ ] `npx vitest run` 全件パス
- [ ] `npx tsc --noEmit` パス (`generateStitches` の async 化が全呼び出しに伝搬)
- [ ] `npx vitest run src/lib/pipeline/__tests__/run.test.ts` で Cycle 1〜5 の全テストが green
- [ ] `npx vitest run src/lib/pipeline/__tests__/stitch.test.ts` で Cycle 6 の 2 テスト (細線 → medial-axis、太線 → 従来) が green
- [ ] Phase 4 計画書 11. の項目を本 PR の範囲で前進:
  - [ ] 既存テストが全件パス (regression 無し)
  - [ ] 細線テキスト (例 "A" の縦棒) が、外形ループでなく中心線 1 本になる ← **本 PR の中心ゴール**。手動 smoke test として、`embroidery-studio` 上で細い縦棒 PNG をロードし、SVG プレビューで中心線 1 本になっていることを目視確認 (スクリーンショットを PR 説明に貼る)
  - [ ] DST 書き出しで実機シミュレータが破綻しない (Ink/Stitch シミュレータ等で smoke。本 PR では smoke のみ、CI assert は別 PR)
- [ ] `public/opencv.js` が `cv.ximgproc.thinning` を含むビルドであることを README または PR 説明で明記。差し替えが必要な場合はその差分も同 PR に含める
- [ ] worker からのエラー (`thinning unsupported`) が `medialAxisRun` から rejection で表面化し、`generateStitches` で **try/catch して外形ループ run にフォールバック** (regression 無し保証)。本フォールバックを Cycle 8 (オプション) として追加するか、本 PR で並走で実装

## 10. コミット粒度

TDD サイクル単位で **1 cycle = 1 commit** を原則とする:

1. `feat(run): add extractPolylines for straight 1px skeleton`
2. `feat(run): handle T-junctions and L-bends in extractPolylines`
3. `feat(run): handle closed rings in extractPolylines`
4. `feat(run): add rasterizeShape for medial-axis input`
5. `feat(run): add medialAxisRun integrating rasterize + worker + extract + resample`
6. `feat(stitch): route thin shapes (<1.0mm) through medial-axis run`
7. `feat(worker): add skeletonize message to opencv-worker (Zhang-Suen via cv.ximgproc.thinning)`
8. (refactor / fallback コミットを必要に応じて追加)

各コミットの直後に `npx vitest run src/lib/pipeline/__tests__/run.test.ts` (および Cycle 6 以降は stitch も含む) が green であることを確認してから次へ進む。

## 11. 想定 PR タイトル

`feat(pipeline): add medial-axis based run extraction (phase 4 pr4)`

サブタイトル / PR 説明冒頭:

> Phase 4 計画書 6 (Run の Medial-Axis 化) を実装。`shortSide < 1.0mm` の細い shape に対して、外形 polyline をなぞる従来 run の代わりに、OpenCV.js `cv.ximgproc.thinning` (Zhang-Suen) を Web Worker 経由で呼び、得られた 1px skeleton から 8-連結トラバースで polyline 列を抽出する。L 字 / T 字 / 円形に対応。`runMaxWidthMm` のデフォルトを 0.6 → 1.0mm に拡大。

## 12. 注意事項

- **opencv.js のビルド**: `cv.ximgproc.thinning` は contrib モジュール。`public/opencv.js` が core only ビルドの場合は差し替えが必要。本 PR の最初のコミット前に **必ずブラウザで `cv.ximgproc?.thinning` の存在を確認**。無ければ `@techstark/opencv-js` 等の contrib 入り配布に差し替える
- **Worker メッセージプロトコルの後方互換**: 既存 `quantize` メッセージは触らない。新規 `skeletonize` を追加するだけ。worker 側 `self.onmessage` で `msg.type` を見て分岐
- **transferable の扱い**: mask `ArrayBuffer` は worker に転送するため、呼び出し側で **コピー (slice) して渡す**。`quantizeViaWorker` と同じパターン (元の `Uint8Array` を destroy しない)
- **async 伝播の漏れ**: `generateStitches` を `async` 化することで TS 型から呼び出し漏れが必ず可視化される。`tsc --noEmit` を必ず流す
- **resamplePolyline の閉ループ前提**: 既存 `stitch.ts:358` の `resamplePolyline` は最後に `polyline[0]` を append して閉じる実装になっている。medial-axis の polyline は **開いた折れ線が大半** なので、`run.ts` 内で `resampleOpenPolyline` を別実装するか、`resamplePolyline` に `closed: boolean` フラグを足す。本 PR では「`run.ts` に `resampleOpen` ヘルパを内側で持つ」案を採用 (既存 API を変えない)
- **フィクスチャ重複**: skeleton mask フィクスチャ (Cycle 1〜3) は `run.fixtures.ts` に切り出すと再利用しやすい。Cycle 2 終了時のリファクタで実施
- **将来課題**: `cv.ximgproc.thinning` が無い環境のための純 TS フォールバック (Zhang-Suen の手実装) は Phase 4 計画書外。本 PR では worker error を `try/catch` して外形ループ run に戻すソフトフォールバックのみ実装

