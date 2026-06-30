# Phase 2 PR2: edge-run + center-run underlay — TDD 実装計画書

## 1. 概要

Phase 2 計画書「3. Underlay」のうち、**ライン系 underlay** (`edge-run` / `center-run`) の pure 関数 2 本を新規ファイル `src/lib/pipeline/underlay.ts` に追加する PR。

- `edgeRunUnderlay(shape, insetMm, stitchLenMm) -> Point[][]`: 外形 (および穴) を内側に `insetMm` オフセットしてから `stitchLenMm` で resample。中幅 satin / fill 用の 1 周下縫い。
- `centerRunUnderlay(shape, stitchLenMm) -> Point[]`: 形状の medial-axis を `stitchLenMm` で resample。細い satin (幅 1.5-2mm) 用の中央 1 本下縫い。

両関数とも **`EmbroideryObject` には触れず、`Shape` と数値だけを受け取る純関数** にする。`generateUnderlayStitches(obj)` (object 統合層) は Phase 2 PR4 の責務であり、本 PR のスコープ外。`zigzagUnderlay` / `fillUnderlay` も別 PR (Phase 2 PR3) の責務。

## 2. 依存関係

- 上流依存:
  - Phase 1 PR1〜PR5 完了 (`EmbroideryObject` / `UnderlayConfig` は **参照しないが**、`Shape` / `Polygon` / `Point2D` の型および `render.ts` の `__internal.resamplePolyline` / `__internal.analyzeShape` を再利用する前提)
  - Phase 2 PR1 (`compensation.ts`): `clipper-lib` (もしくは `@doodle3d/clipper-js`) を `package.json` に追加済みで、polygon offset が呼べる状態
- 下流依存:
  - Phase 2 PR3 (`zigzagUnderlay` / `fillUnderlay`): 本 PR が抽出した共通 offset / resample ヘルパを再利用する
  - Phase 2 PR4 (`generateUnderlayStitches(obj)` + `applyUnderlayDefaults` + `render.ts` への統合): 本 PR の 2 関数を `UnderlayConfig.kind` で dispatch する
  - Phase 2 PR5 (`build-objects.ts` への組み込み)

## 3. 影響ファイル

### 新規作成
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/underlay.ts`
  - `edgeRunUnderlay(shape, insetMm, stitchLenMm): Point[][]`
  - `centerRunUnderlay(shape, stitchLenMm): Point[]`
  - 内部ヘルパ `offsetShapeInward(shape, insetMm): Polygon[]`
  - 内部ヘルパ `rasterizeShapeToMask(shape, pxPerMm)`
  - 内部ヘルパ `thinMaskZhangSuen(mask, w, h)` (純 TS の Zhang-Suen thinning)
  - 内部ヘルパ `traceLongestSkeletonPath(skel, w, h)`
  - `__internal` export (上記ヘルパをテスト用に公開)
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/__tests__/underlay.test.ts`

### 編集 (任意 / 必要に応じて)
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/opencv-worker.ts`
  - Phase 2 PR2 では **第一候補として純 TS の Zhang-Suen thinning を `underlay.ts` 内に直接実装** する。これにより `centerRunUnderlay` を同期 pure 関数として保てる。**第一候補方針では本ファイルを編集しない。** 将来速度問題が出たら `thinMask(mask, w, h): Uint8Array` メッセージ型を opencv-worker に追加する第二候補に切り替える。

### 触らない (回帰確認のみ)
- `src/lib/pipeline/render.ts` (Phase 1 PR4 でリネーム済) / `stitch.ts`
- `src/lib/pipeline/__tests__/stitch.test.ts` / `vectorize.test.ts` / `design.test.ts` / `types.test.ts`
- `src/lib/pipeline/compensation.ts` (Phase 2 PR1 で導入済)
- `src/lib/pipeline/{types,vectorize,quantize,writer,index}.ts`

## 4. テスト環境

- フレームワーク: vitest 4
- 実行コマンド: `npm test` (= `vitest run`)
- テストファイル配置: `src/lib/pipeline/__tests__/*.test.ts`
- 既存テストパターン:
  - 純粋関数を直接 import (例: `__internal.fillStitches`)
  - 値域アサート (`toBeCloseTo`, `toBeGreaterThan`)
  - 座標 mm 単位、`Shape` リテラル直接構築

## 5. インターフェース設計

```ts
// src/lib/pipeline/underlay.ts
import type { Shape, Polygon, Point2D } from "./types";

type Point = Point2D;

/**
 * Edge-run underlay: 外形 (および各穴) を内側に `insetMm` オフセットし、
 * 得られた各リングを `stitchLenMm` で resample した polyline 配列を返す。
 *
 * 戻り値は「複数の閉ループ polyline」を表す配列:
 *   - 戻り値[0]   : 外形を inset したリング (通常 1 本)
 *   - 戻り値[1..] : 各 hole を **外側に** `insetMm` 膨らませたリング (穴の周囲も縫う)
 *
 * `insetMm` が大きすぎて外形が消滅した場合は空配列を返す。
 * 各 polyline は閉ループだが、戻り値配列の要素間に閉じる責務は持たない
 * (= 呼び出し側で次のリングへ jump を吐く想定)。
 *
 * @param shape         入力形状 (mm 単位)
 * @param insetMm       内側オフセット量 (mm)。代表値 0.4mm。
 * @param stitchLenMm   resample 後の隣接点間距離 (mm)。代表値 2.5mm。
 */
export function edgeRunUnderlay(
  shape: Shape,
  insetMm: number,
  stitchLenMm: number,
): Point[][];

/**
 * Center-run underlay: 形状の medial-axis (skeleton) を 1 本の polyline として抽出し、
 * `stitchLenMm` で resample して返す。
 *
 * 内部処理:
 *  1. shape を 0.1mm 精度 (10 px/mm) の 2 値マスクにラスタライズ (穴は 0)
 *  2. Zhang-Suen thinning で 1 px 幅の skeleton にする
 *  3. skeleton 上で 2 回 BFS により最長単純パス (= 直径) を 1 本抽出
 *  4. mm 単位に戻して `stitchLenMm` で resample
 *
 * skeleton が空 (面積が極小) または抽出失敗時は空配列を返す。
 *
 * @param shape         入力形状 (mm 単位)。細い satin (幅 1.5-2mm) を想定。
 * @param stitchLenMm   resample 後の隣接点間距離 (mm)。代表値 2.5mm。
 */
export function centerRunUnderlay(
  shape: Shape,
  stitchLenMm: number,
): Point[];

/** テスト用に内部ヘルパを公開 */
export const __internal: {
  offsetShapeInward: (shape: Shape, insetMm: number) => Polygon[];
  rasterizeShapeToMask: (
    shape: Shape,
    pxPerMm: number,
  ) => { mask: Uint8Array; width: number; height: number; offsetX: number; offsetY: number };
  thinMaskZhangSuen: (mask: Uint8Array, width: number, height: number) => Uint8Array;
  traceLongestSkeletonPath: (
    skeleton: Uint8Array,
    width: number,
    height: number,
  ) => Array<[number, number]>;
};
```

ポイント:
- `Point2D` は `types.ts` 既存の `[number, number]`。
- `edgeRunUnderlay` の戻り値が `Point[][]` (リスト オブ リング) なのは、穴ありのときに「外形リング + 穴リング群」を呼び出し側 (Phase 2 PR4 の `generateUnderlayStitches`) が独立リングとして扱えるようにするため。
- `centerRunUnderlay` の戻り値は `Point[]` (1 本の polyline)。細 satin の用途では分岐はほぼ出ない。

## 6. TDD サイクル

### Cycle 1: `edgeRunUnderlay` — 矩形 (穴なし) の 1 周下縫い

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/underlay.test.ts` (新規)

テスト観点:
- 10×10mm の正方形に `insetMm=0.4, stitchLenMm=2.5` を適用 → 内側 0.4mm の閉ループ 1 本
- 戻り値は `Point[][]` で長さ 1
- リング上の各点は外形の 4 辺いずれかから ±0.1mm 以内
- 隣接点間距離が `stitchLenMm` の ±10% 以内

テスト名:
- `edgeRunUnderlay は 10mm 正方形に対して 1 本の閉ループ polyline を返す`
- `edgeRunUnderlay の各点は外形から insetMm だけ内側にある`
- `edgeRunUnderlay の隣接点間距離は stitchLenMm の ±10% 以内`

```ts
// src/lib/pipeline/__tests__/underlay.test.ts
import { describe, it, expect } from "vitest";
import { edgeRunUnderlay } from "../underlay";
import type { Shape } from "../types";

describe("edgeRunUnderlay (rectangle, no hole)", () => {
  const square10: Shape = {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [],
  };

  it("edgeRunUnderlay は 10mm 正方形に対して 1 本の閉ループ polyline を返す", () => {
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    expect(rings).toHaveLength(1);
    const ring = rings[0];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    const first = ring[0];
    const last = ring[ring.length - 1];
    const closeDist = Math.hypot(first[0] - last[0], first[1] - last[1]);
    // 末尾の戻りステップは最大 1 stitch 分のずれを許容
    expect(closeDist).toBeLessThanOrEqual(2.5 + 0.1);
  });

  it("edgeRunUnderlay の各点は外形から insetMm だけ内側にある", () => {
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    for (const [x, y] of rings[0]) {
      expect(x).toBeGreaterThanOrEqual(0.4 - 0.05);
      expect(x).toBeLessThanOrEqual(9.6 + 0.05);
      expect(y).toBeGreaterThanOrEqual(0.4 - 0.05);
      expect(y).toBeLessThanOrEqual(9.6 + 0.05);
      const distToEdge = Math.min(
        Math.abs(x - 0.4),
        Math.abs(x - 9.6),
        Math.abs(y - 0.4),
        Math.abs(y - 9.6),
      );
      expect(distToEdge).toBeLessThanOrEqual(0.1);
    }
  });

  it("edgeRunUnderlay の隣接点間距離は stitchLenMm の ±10% 以内", () => {
    const rings = edgeRunUnderlay(square10, 0.4, 2.5);
    const ring = rings[0];
    for (let i = 1; i < ring.length; i++) {
      const d = Math.hypot(
        ring[i][0] - ring[i - 1][0],
        ring[i][1] - ring[i - 1][1],
      );
      expect(d).toBeGreaterThanOrEqual(2.5 * 0.9);
      expect(d).toBeLessThanOrEqual(2.5 * 1.1);
    }
  });
});
```

失敗理由: `src/lib/pipeline/underlay.ts` 自体が存在しないため `Cannot find module '../underlay'` で vitest が落ちる。

#### Green — 最小実装

変更: `src/lib/pipeline/underlay.ts` (新規)

方針:
1. `offsetShapeInward(shape, insetMm)` を実装:
   - `clipper-lib` の `ClipperOffset` を使う (Phase 2 PR1 で依存追加済み前提)
   - 入力 polygon を 1000 倍してから `Clipper` の整数座標に渡す (mm → 1/1000 mm)
   - `MiterLimit = 2`, `JoinType = jtMiter`, `EndType = etClosedPolygon`
   - 戻り値は内側に縮んだ閉ポリゴン群 (0 個以上)
2. `edgeRunUnderlay`:
   - `insetMm <= 0 || stitchLenMm <= 0` で早期 `[]` 返し
   - `offsetShapeInward(shape, insetMm)` で外形を縮める → 1 本以上のリング
   - 各リングに対し `resampleUnderlayPath(ring, stitchLenMm, { closed: true })` を呼ぶ
   - 結果を `Point[][]` で返す
3. `resampleUnderlayPath` は閉ループ前提でローカルに実装 (`render.ts` の `resamplePolyline` とは別実装にして循環依存を回避)。

```ts
import type { Shape, Polygon, Point2D } from "./types";
// @ts-expect-error -- no @types provided
import ClipperLib from "clipper-lib";

type Point = Point2D;
const CLIPPER_SCALE = 1000;

export function edgeRunUnderlay(
  shape: Shape,
  insetMm: number,
  stitchLenMm: number,
): Point[][] {
  if (insetMm <= 0 || stitchLenMm <= 0) return [];
  const rings = offsetShapeInward(shape, insetMm);
  if (rings.length === 0) return [];
  return rings
    .map((r) => resampleUnderlayPath(r, stitchLenMm, true))
    .filter((r) => r.length > 0);
}

function offsetShapeInward(shape: Shape, insetMm: number): Polygon[] {
  // Cycle 1 では外形だけ縮める実装。Cycle 2 で穴対応を追加する。
  const co = new ClipperLib.ClipperOffset(2, 0.25);
  co.AddPath(
    toClipperPath(shape.outer),
    ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: Array<Array<{ X: number; Y: number }>> = [];
  co.Execute(solution, -insetMm * CLIPPER_SCALE);
  return solution.map(fromClipperPath);
}

function toClipperPath(poly: Polygon): Array<{ X: number; Y: number }> {
  return poly.map(([x, y]) => ({
    X: Math.round(x * CLIPPER_SCALE),
    Y: Math.round(y * CLIPPER_SCALE),
  }));
}

function fromClipperPath(path: Array<{ X: number; Y: number }>): Polygon {
  return path.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE] as Point);
}

function resampleUnderlayPath(
  line: Polygon,
  stitchLenMm: number,
  closed: boolean,
): Point[] {
  if (line.length === 0) return [];
  const seq = closed ? line.concat([line[0]]) : line;
  const out: Point[] = [seq[0]];
  let acc = 0;
  let cx = seq[0][0];
  let cy = seq[0][1];
  for (let i = 1; i < seq.length; i++) {
    const [x1, y1] = seq[i];
    let segLen = Math.hypot(x1 - cx, y1 - cy);
    while (acc + segLen >= stitchLenMm) {
      const t = (stitchLenMm - acc) / segLen;
      cx = cx + (x1 - cx) * t;
      cy = cy + (y1 - cy) * t;
      out.push([cx, cy]);
      segLen = Math.hypot(x1 - cx, y1 - cy);
      acc = 0;
    }
    acc += segLen;
    cx = x1;
    cy = y1;
  }
  return out;
}
```

#### Refactor
- `toClipperPath` / `fromClipperPath` を内部ヘルパとして抽出済 (Green 内で同時実施)。
- `resampleUnderlayPath` の `closed` 分岐は Cycle 3 (`centerRunUnderlay`) で再利用するため、本サイクルでも署名に残す。
- 数値リテラル `CLIPPER_SCALE = 1000` をモジュール定数として先頭に集約。
- これ以上の抽象化は Cycle 4 (共通化) で行う。

---

### Cycle 2: `edgeRunUnderlay` — 穴ありの場合は外形 + 各穴周囲の 2 系統リングを返す

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/underlay.test.ts` に追記

テスト観点:
- 20×20mm 外形 + 中央 8mm×8mm 穴の shape に `insetMm=0.4, stitchLenMm=2.5` を適用 → 戻り値は 2 本のリング
- ring[0] (外形リング) は概ね x,y ∈ [0.4, 19.6]
- ring[1] (穴リング) は穴を **外側に** 0.4mm 膨らませたリング → 概ね x,y ∈ [5.6, 14.4]
- 穴リングの重心 ≒ (10, 10)

テスト名:
- `edgeRunUnderlay は穴あり shape に対して外形リング + 穴リングの 2 本を返す`
- `edgeRunUnderlay の穴リングは穴を insetMm だけ外側に膨らませたリング`

```ts
describe("edgeRunUnderlay (rectangle with hole)", () => {
  const ringShape: Shape = {
    outer: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
    holes: [
      [
        [6, 6],
        [14, 6],
        [14, 14],
        [6, 14],
      ],
    ],
  };

  it("edgeRunUnderlay は穴あり shape に対して外形リング + 穴リングの 2 本を返す", () => {
    const rings = edgeRunUnderlay(ringShape, 0.4, 2.5);
    expect(rings).toHaveLength(2);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
    expect(rings[1].length).toBeGreaterThanOrEqual(4);
  });

  it("edgeRunUnderlay の穴リングは穴を insetMm だけ外側に膨らませたリング", () => {
    const rings = edgeRunUnderlay(ringShape, 0.4, 2.5);
    const annotated = rings.map((r) => {
      const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
      const cy = r.reduce((s, p) => s + p[1], 0) / r.length;
      return { ring: r, cx, cy };
    });
    const holeRing = annotated.find(
      (r) => Math.hypot(r.cx - 10, r.cy - 10) < 1,
    );
    expect(holeRing).toBeDefined();
    for (const [x, y] of holeRing!.ring) {
      expect(x).toBeGreaterThanOrEqual(5.6 - 0.1);
      expect(x).toBeLessThanOrEqual(14.4 + 0.1);
      expect(y).toBeGreaterThanOrEqual(5.6 - 0.1);
      expect(y).toBeLessThanOrEqual(14.4 + 0.1);
    }
  });
});
```

失敗理由: Cycle 1 の `offsetShapeInward` は外形しか縮めていないため `rings.length === 1` で 1 本目テスト失敗。

#### Green — 最小実装

変更: `src/lib/pipeline/underlay.ts` の `offsetShapeInward` を拡張。

```ts
function offsetShapeInward(shape: Shape, insetMm: number): Polygon[] {
  const result: Polygon[] = [];

  // (1) 外形を内側に縮める
  {
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPath(
      toClipperPath(shape.outer),
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon,
    );
    const solution: Array<Array<{ X: number; Y: number }>> = [];
    co.Execute(solution, -insetMm * CLIPPER_SCALE);
    for (const path of solution) result.push(fromClipperPath(path));
  }

  // (2) 各穴を外側に膨らませる (= 穴の周囲を縫う下縫いリング)
  for (const hole of shape.holes) {
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPath(
      toClipperPath(hole),
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon,
    );
    const solution: Array<Array<{ X: number; Y: number }>> = [];
    co.Execute(solution, +insetMm * CLIPPER_SCALE);
    for (const path of solution) result.push(fromClipperPath(path));
  }

  return result;
}
```

#### Refactor
- 外形と穴のオフセット呼び出しが対称なので、`runOffset(poly, deltaMm)` を内部関数として抽出:

```ts
function runOffset(poly: Polygon, deltaMm: number): Polygon[] {
  const co = new ClipperLib.ClipperOffset(2, 0.25);
  co.AddPath(
    toClipperPath(poly),
    ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: Array<Array<{ X: number; Y: number }>> = [];
  co.Execute(solution, deltaMm * CLIPPER_SCALE);
  return solution.map(fromClipperPath);
}

function offsetShapeInward(shape: Shape, insetMm: number): Polygon[] {
  return [
    ...runOffset(shape.outer, -insetMm),
    ...shape.holes.flatMap((h) => runOffset(h, +insetMm)),
  ];
}
```

- これにより Phase 2 PR3 (`zigzagUnderlay`) で `runOffset` を直接再利用できる。

---

### Cycle 3: `centerRunUnderlay` — 細長 satin の medial-axis polyline

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/underlay.test.ts` に追記

テスト観点:
- 20mm × 2mm の細長矩形に `stitchLenMm=2.5` を適用 → 1 本の polyline (= 中央線)
- 戻り値の各点は y ≒ 1.0 (中央) で `±0.3mm` 程度の許容 (ラスタライズ精度依存)
- 戻り値の x は 0 → 20 (または逆順) に長手方向に分布 (`xMax - xMin >= 15`)
- 隣接点間距離が `stitchLenMm` の ±20% 以内 (medial-axis のラスタジッタを考慮し緩め)
- 点数は約 `20 / 2.5 + 1 ≒ 9` 点 (±3 許容)
- 面積が極小 (≦ 0.25mm²) の入力では空配列

テスト名:
- `centerRunUnderlay は細長矩形の中央線を返す`
- `centerRunUnderlay の隣接点間距離は stitchLenMm の ±20% 以内`
- `centerRunUnderlay は極小面積の shape に対して空配列を返す`

```ts
import { centerRunUnderlay } from "../underlay";

describe("centerRunUnderlay (thin rectangle)", () => {
  const thinBar: Shape = {
    outer: [
      [0, 0],
      [20, 0],
      [20, 2],
      [0, 2],
    ],
    holes: [],
  };

  it("centerRunUnderlay は細長矩形の中央線を返す", () => {
    const line = centerRunUnderlay(thinBar, 2.5);
    expect(line.length).toBeGreaterThanOrEqual(6);
    expect(line.length).toBeLessThanOrEqual(12);
    for (const [, y] of line) {
      expect(y).toBeGreaterThanOrEqual(1.0 - 0.3);
      expect(y).toBeLessThanOrEqual(1.0 + 0.3);
    }
    const xs = line.map(([x]) => x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    expect(xMax - xMin).toBeGreaterThanOrEqual(15);
  });

  it("centerRunUnderlay の隣接点間距離は stitchLenMm の ±20% 以内", () => {
    const line = centerRunUnderlay(thinBar, 2.5);
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot(
        line[i][0] - line[i - 1][0],
        line[i][1] - line[i - 1][1],
      );
      expect(d).toBeGreaterThanOrEqual(2.5 * 0.8);
      expect(d).toBeLessThanOrEqual(2.5 * 1.2);
    }
  });

  it("centerRunUnderlay は極小面積の shape に対して空配列を返す", () => {
    const dot: Shape = {
      outer: [
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ],
      holes: [],
    };
    expect(centerRunUnderlay(dot, 2.5)).toEqual([]);
  });
});
```

失敗理由: `centerRunUnderlay` が未実装 → `centerRunUnderlay is not a function`。

#### Green — 最小実装

`underlay.ts` に追加:

```ts
const PX_PER_MM = 10;        // 0.1mm 精度
const MIN_SKELETON_PIXELS = 12;

export function centerRunUnderlay(shape: Shape, stitchLenMm: number): Point[] {
  if (stitchLenMm <= 0) return [];
  const raster = rasterizeShapeToMask(shape, PX_PER_MM);
  let count = 0;
  for (const v of raster.mask) if (v) count++;
  if (count < MIN_SKELETON_PIXELS) return [];
  const skeleton = thinMaskZhangSuen(raster.mask, raster.width, raster.height);
  const pxPath = traceLongestSkeletonPath(skeleton, raster.width, raster.height);
  if (pxPath.length < 2) return [];
  const mmPath: Polygon = pxPath.map(([px, py]) => [
    (px + 0.5) / PX_PER_MM + raster.offsetX,
    (py + 0.5) / PX_PER_MM + raster.offsetY,
  ]);
  return resampleUnderlayPath(mmPath, stitchLenMm, false);
}

function rasterizeShapeToMask(
  shape: Shape,
  pxPerMm: number,
): { mask: Uint8Array; width: number; height: number; offsetX: number; offsetY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of shape.outer) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = 2; // 端の thinning が消えるのを防ぐ
  const width = Math.ceil((maxX - minX) * pxPerMm) + pad * 2;
  const height = Math.ceil((maxY - minY) * pxPerMm) + pad * 2;
  const mask = new Uint8Array(width * height);
  const offsetX = minX - pad / pxPerMm;
  const offsetY = minY - pad / pxPerMm;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = (px + 0.5) / pxPerMm + offsetX;
      const y = (py + 0.5) / pxPerMm + offsetY;
      if (!pointInPoly(shape.outer, x, y)) continue;
      let inHole = false;
      for (const h of shape.holes) {
        if (pointInPoly(h, x, y)) { inHole = true; break; }
      }
      if (!inHole) mask[py * width + px] = 1;
    }
  }
  return { mask, width, height, offsetX, offsetY };
}

function pointInPoly(poly: Polygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Zhang-Suen thinning (純 TS) */
function thinMaskZhangSuen(src: Uint8Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(src);
  const idx = (x: number, y: number) => y * w + x;
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1] as const) {
      const toRemove: number[] = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!mask[idx(x, y)]) continue;
          const p2 = mask[idx(x, y - 1)];
          const p3 = mask[idx(x + 1, y - 1)];
          const p4 = mask[idx(x + 1, y)];
          const p5 = mask[idx(x + 1, y + 1)];
          const p6 = mask[idx(x, y + 1)];
          const p7 = mask[idx(x - 1, y + 1)];
          const p8 = mask[idx(x - 1, y)];
          const p9 = mask[idx(x - 1, y - 1)];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toRemove.push(idx(x, y));
        }
      }
      if (toRemove.length > 0) {
        changed = true;
        for (const i of toRemove) mask[i] = 0;
      }
    }
  }
  return mask;
}

/** skeleton の端点から 2 回 BFS で直径パスを 1 本返す (px 座標) */
function traceLongestSkeletonPath(
  skel: Uint8Array,
  w: number,
  h: number,
): Array<[number, number]> {
  const idx = (x: number, y: number) => y * w + x;
  const neighbors = (x: number, y: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (skel[idx(nx, ny)]) out.push([nx, ny]);
      }
    }
    return out;
  };
  // 端点 (近傍 1 個) 探索
  const endpoints: Array<[number, number]> = [];
  let anyPoint: [number, number] | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!skel[idx(x, y)]) continue;
      if (!anyPoint) anyPoint = [x, y];
      if (neighbors(x, y).length === 1) endpoints.push([x, y]);
    }
  }
  if (!anyPoint) return [];
  const start: [number, number] = endpoints[0] ?? anyPoint;
  const bfs = (s: [number, number]) => {
    const parent = new Int32Array(w * h).fill(-1);
    const depth = new Int32Array(w * h);
    const visited = new Uint8Array(w * h);
    const q: Array<[number, number]> = [s];
    visited[idx(s[0], s[1])] = 1;
    let farthest = s;
    let maxDepth = 0;
    while (q.length) {
      const [cx, cy] = q.shift()!;
      const d = depth[idx(cx, cy)];
      if (d > maxDepth) { maxDepth = d; farthest = [cx, cy]; }
      for (const [nx, ny] of neighbors(cx, cy)) {
        const ni = idx(nx, ny);
        if (visited[ni]) continue;
        visited[ni] = 1;
        parent[ni] = idx(cx, cy);
        depth[ni] = d + 1;
        q.push([nx, ny]);
      }
    }
    return { farthest, parent };
  };
  const first = bfs(start);
  const second = bfs(first.farthest);
  const path: Array<[number, number]> = [];
  let cur = idx(second.farthest[0], second.farthest[1]);
  while (cur !== -1) {
    const y = Math.floor(cur / w);
    const x = cur - y * w;
    path.push([x, y]);
    cur = second.parent[cur];
  }
  return path;
}
```

#### Refactor
- `pointInPoly` は `vectorize.ts` 既存 `pointInPolygon` と機能重複。Cycle 4 で「重複は許容しつつ TODO コメントで `geometry.ts` への統合候補として記録」する方針 (循環依存を避けるため re-import はしない)。
- `traceLongestSkeletonPath` の BFS は `Array.shift()` を使うため `O(N^2)`。マスクサイズが数千 px (= 数 cm) 程度なら問題ないが、TODO コメントで「大きい shape では deque 化」と残す。

---

### Cycle 4: 共通化リファクタ — `__internal` 公開と重複ヘルパ整理

#### Red — 失敗するテスト

Cycle 1〜3 の全テストが既にパスしている。Cycle 4 は純粋なリファクタなので、**新規テストは追加せず、既存テストが落ちないことで担保する**。ただし将来 (Phase 2 PR3) で再利用されるヘルパの直接テストを 2 件だけ追加して挙動を固定する:

ファイル: `src/lib/pipeline/__tests__/underlay.test.ts` に追記

テスト観点:
- `__internal.offsetShapeInward` が直接呼べる (Phase 2 PR3 の `zigzagUnderlay` でも再利用する想定)
- `__internal.thinMaskZhangSuen` が 12×5 の horizontal bar マスク (3 行) に対して中央行のみに残す挙動

テスト名:
- `__internal.offsetShapeInward は外形を -delta で縮め穴を +delta で膨らませる`
- `__internal.thinMaskZhangSuen は 10x3 horizontal bar を 1 ピクセル幅にする`

```ts
import { __internal } from "../underlay";

describe("__internal helpers", () => {
  it("__internal.offsetShapeInward は外形を -delta で縮め穴を +delta で膨らませる", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
        ],
      ],
    };
    const rings = __internal.offsetShapeInward(shape, 0.5);
    expect(rings).toHaveLength(2);
  });

  it("__internal.thinMaskZhangSuen は 10x3 horizontal bar を 1 ピクセル幅にする", () => {
    const w = 12, h = 5;
    const mask = new Uint8Array(w * h);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 10; x++) mask[y * w + x] = 1;
    }
    const skel = __internal.thinMaskZhangSuen(mask, w, h);
    let cellsAtY2 = 0;
    let cellsAtOther = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!skel[y * w + x]) continue;
        if (y === 2) cellsAtY2++;
        else cellsAtOther++;
      }
    }
    expect(cellsAtY2).toBeGreaterThanOrEqual(8);
    expect(cellsAtOther).toBeLessThanOrEqual(2); // 端点処理でわずかに残ってもよい
  });
});
```

失敗理由: `__internal` export 自体が Cycle 1-3 で未公開のため `Cannot read property 'offsetShapeInward' of undefined`。

#### Green — 最小実装

`underlay.ts` 末尾に追加:

```ts
export const __internal = {
  offsetShapeInward,
  rasterizeShapeToMask,
  thinMaskZhangSuen,
  traceLongestSkeletonPath,
};
```

#### Refactor
- Cycle 1 で `resampleUnderlayPath(line, stitchLenMm, closed)` 形式で導入済のため、`edgeRunUnderlay` (closed=true) と `centerRunUnderlay` (closed=false) の両方が同関数を呼んでいることを確認 (重複ブロックがあれば統合)。
- `runOffset` (Cycle 2 で抽出) が `__internal` から見えない場合、Phase 2 PR3 で困るため `__internal` に追加するかは PR3 着手時に判断 (本 PR では公開しない)。

---

### Cycle 5 (任意 / バッファ): エッジケース固め — 退化形・薄すぎ shape・三角形

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/underlay.test.ts` に追記

テスト観点:
- `edgeRunUnderlay`: 1mm × 1mm の正方形に `insetMm=0.6` を渡すと外形が消滅 → 空配列
- `edgeRunUnderlay`: `insetMm <= 0` または `stitchLenMm <= 0` で空配列 (防御的)
- `centerRunUnderlay`: 三角形 (5mm × 5mm × 4mm) でも 2 点以上の polyline を返す

テスト名:
- `edgeRunUnderlay は inset が形状を上回るとき空配列を返す`
- `edgeRunUnderlay は不正引数 (insetMm <= 0 / stitchLenMm <= 0) で空配列を返す`
- `centerRunUnderlay は小さな三角形でも 2 点以上の polyline を返す`

```ts
describe("edge cases", () => {
  it("edgeRunUnderlay は inset が形状を上回るとき空配列を返す", () => {
    const tiny: Shape = {
      outer: [[0, 0], [1, 0], [1, 1], [0, 1]],
      holes: [],
    };
    expect(edgeRunUnderlay(tiny, 0.6, 2.5)).toEqual([]);
  });

  it("edgeRunUnderlay は不正引数 (insetMm <= 0 / stitchLenMm <= 0) で空配列を返す", () => {
    const sq: Shape = {
      outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [],
    };
    expect(edgeRunUnderlay(sq, 0, 2.5)).toEqual([]);
    expect(edgeRunUnderlay(sq, -0.1, 2.5)).toEqual([]);
    expect(edgeRunUnderlay(sq, 0.4, 0)).toEqual([]);
  });

  it("centerRunUnderlay は小さな三角形でも 2 点以上の polyline を返す", () => {
    const tri: Shape = {
      outer: [[0, 0], [5, 0], [2.5, 4]],
      holes: [],
    };
    const line = centerRunUnderlay(tri, 1.0);
    expect(line.length).toBeGreaterThanOrEqual(2);
  });
});
```

失敗理由:
- Cycle 1 で `insetMm <= 0 || stitchLenMm <= 0` 防御は入っているはずなので大半パス。
- `edgeRunUnderlay(tiny, 0.6, 2.5)` は Cycle 1 実装で `offsetShapeInward` の戻り値が空 → `rings.length === 0` 早期 return で OK のはず (要確認)。
- `centerRunUnderlay` の三角形ケースは pixel count が下限 (12) を割らないかが焦点。5mm × 4mm × 0.5 ≒ 10mm² → 1000 px なので十分通る想定だが、`MIN_SKELETON_PIXELS` の閾値次第で落ちる可能性あり。

#### Green — 最小実装

- 上記のうち落ちたケースだけ修正:
  - `MIN_SKELETON_PIXELS` 値を 12 (もしくは 25 → 12 に下げる) で調整
  - `edgeRunUnderlay` の早期 return パスを再確認

#### Refactor
- 閾値マジックナンバーをモジュール先頭の `const MIN_SKELETON_PIXELS = 12` に集約 (済)。
- Cycle 1-4 で残ったコメント TODO を整理し、本 PR で対応しないものは `// Phase 2 PR3 で再検討` のように対象 PR を明示。

---

## 7. サイクル依存グラフ

```
Cycle 1 (edgeRunUnderlay: 矩形のみ)
   ↓
Cycle 2 (edgeRunUnderlay: 穴対応)
   ↓
Cycle 4 (__internal export + 共通化リファクタ)
   ↑
Cycle 3 (centerRunUnderlay: medial-axis)  ← Cycle 1/2 と独立に進められる
   ↓
Cycle 5 (エッジケース; 任意バッファ)
```

並列化:
- Cycle 1 → 2 と Cycle 3 は独立。Sonnet 単独実装なら 1 → 2 → 3 → 4 → 5 の順次で OK。
- Cycle 4 は 1/2/3 が全て揃ってから着手 (`__internal` に全部公開するため)。
- Cycle 5 は 4 完了後に追加するバッファ。

## 8. 回帰防止

各 Cycle の Green 完了後に `npm test` を実行し、以下を確認する:

1. 既存 `src/lib/pipeline/__tests__/stitch.test.ts` (もしくは Phase 1 PR4 後の `render.test.ts`) の全テストがパス
2. 既存 `vectorize.test.ts` がパス
3. Phase 1 で追加された `types.test.ts` / `design.test.ts` / `fabric.test.ts` / `build-objects.test.ts` がパス
4. Phase 2 PR1 で追加された `compensation.test.ts` がパス
5. 新規 `underlay.test.ts` がパス
6. TypeScript 型エラー 0 件 (`vitest` の TS transform 経由で検出)

最終 Cycle 後にもう 1 度 `npm test` を全件実行し、緑であることを確認。

`clipper-lib` を本 PR で初めて Node テスト経路から呼ぶため、Cycle 1 Green 直後に `npm test -- underlay` で `import ClipperLib from "clipper-lib"` が解決することを手動確認する。動かなければ `@doodle3d/clipper-js` への切替を Phase 2 PR1 と歩調を合わせて検討する。

## 9. 受け入れ条件

- [ ] `npm test` が全件パス (既存 + 新規)
- [ ] `src/lib/pipeline/underlay.ts` から `edgeRunUnderlay`, `centerRunUnderlay`, `__internal` が export されている
- [ ] `edgeRunUnderlay` は穴なし shape に対して 1 本のリング、穴あり shape に対して外形リング + 各穴リングの計 `1 + holes.length` 本を返す
- [ ] `edgeRunUnderlay` の各点が外形 (または穴) から ±0.1mm 以内で `insetMm` だけ離れている
- [ ] `edgeRunUnderlay` のリング上の隣接点間距離が `stitchLenMm` の ±10% 以内
- [ ] `centerRunUnderlay` が細長 satin (20mm × 2mm) に対して中央 (y ≒ 1.0, ±0.3mm) の polyline を返す
- [ ] `centerRunUnderlay` の隣接点間距離が `stitchLenMm` の ±20% 以内
- [ ] `centerRunUnderlay` が極小面積の shape (≦ 0.25mm²) に対して空配列を返す
- [ ] `edgeRunUnderlay` が `insetMm <= 0` / `stitchLenMm <= 0` / inset 過大で空配列を返す
- [ ] `edgeRunUnderlay` / `centerRunUnderlay` は `EmbroideryObject` / `UnderlayConfig` を引数に取らない (純 Shape + 数値の pure 関数である)
- [ ] `render.ts` (もしくは `stitch.ts`) には変更が入っていない
- [ ] `compensation.ts` には変更が入っていない
- [ ] `opencv-worker.ts` には (第一候補方針通り) 変更が入っていない

## 10. コミット粒度

1 TDD サイクル = 1 コミット。Conventional Commits 形式。

- Cycle 1: `feat(pipeline): add edgeRunUnderlay for rectangle shapes (phase 2 pr2)`
- Cycle 2: `feat(pipeline): support holes in edgeRunUnderlay via outward hole offset`
- Cycle 3: `feat(pipeline): add centerRunUnderlay via Zhang-Suen thinning`
- Cycle 4: `refactor(pipeline): expose __internal helpers and unify resampler in underlay.ts`
- Cycle 5: `test(pipeline): cover degenerate-shape edge cases for underlay`

各コミットはテストファイルと実装ファイルを同時に含み、`npm test` が緑であることを前提とする。

## 11. 想定 PR タイトル

`feat(pipeline): add edge-run and center-run underlay (phase 2 pr2)`

PR 本文には以下を 5-8 行で記載する:

- Phase 2 計画書 (`plans/20-phase2-quality.md`) の「7. 実装ステップ 4.1 / 4.2」に対応する旨
- `Shape` + 数値だけを受け取る pure 関数で、`EmbroideryObject` / `UnderlayConfig` への統合 (`generateUnderlayStitches`) は次 PR (Phase 2 PR4) の責務である旨
- `zigzagUnderlay` / `fillUnderlay` は Phase 2 PR3 で追加予定である旨
- medial-axis は OpenCV.js worker 経由ではなく純 TS の Zhang-Suen thinning で実装した旨 (理由: 同期 pure 関数として実装するため、および worker 起動コストを避けるため)
- `clipper-lib` を本 PR で初めて実コード経路から呼ぶ旨 (Phase 2 PR1 で依存追加済み)

## 12. 注意事項

- **EmbroideryObject 非依存**: `edgeRunUnderlay` / `centerRunUnderlay` は `EmbroideryObject` / `UnderlayConfig` / `ObjectProps` のいずれも import しない。`Shape` と `number` のみ受け取る。これは Phase 2 計画書冒頭の pure 関数要求と、Phase 2 PR4 (`generateUnderlayStitches(obj)`) で `UnderlayConfig.kind` をディスパッチする際の責務分離のため。
- **値域**: `insetMm` は Phase 2 計画書 3.1 表の「中幅 satin / fill 用 ~0.4mm」を採用。`stitchLenMm` は同表の文脈から ~2.5mm を採用。テスト引数も同値域。
- **medial-axis 抽出方法**: OpenCV.js `cv.ximgproc.thinning` は Web Worker 経由 (非同期) でしか安全に呼べないため、本 PR では純 TS の Zhang-Suen thinning を採用する。これにより `centerRunUnderlay` を同期 pure 関数として保てる。将来速度問題が出たら `opencv-worker.ts` に `thinMask` メッセージ型を追加する第二候補に切り替える (本計画書 §3「編集 (任意)」参照)。
- **clipper-lib の API**: `clipper-lib` (Angus Johnson 版, MIT, 純 JS) の `ClipperOffset` を使う。`@doodle3d/clipper-js` は API が異なる (Promise ラップ + クラス API) ため、Phase 2 PR1 でどちらを採用したかにより微調整が必要。本計画書のコード例は `clipper-lib` を前提に書いている。
- **resamplePolyline の重複**: `render.ts` (旧 `stitch.ts`) に既に `resamplePolyline` がある (閉ループ前提)。`underlay.ts` 側では `resampleUnderlayPath(line, stitchLenMm, closed: boolean)` をローカルに置き、`closed=false` (`centerRunUnderlay`) も同関数で扱う。共通モジュール `geometry.ts` への統合は本 PR では行わない (Phase 1 PR4 のスコープ判断に従う)。
- **pointInPoly の重複**: `vectorize.ts` の `pointInPolygon` と同等。Cycle 3 では import せず複製 (循環依存防止)。`geometry.ts` 統合は別 PR。
- **Phase 2 PR4 への申し送り**: `generateUnderlayStitches(obj)` 側で、本 PR の戻り値 `Point[][]` を「リング単位で jump を挟みつつ `Stitch[]` に変換」する責務を持つ。`edgeRunUnderlay` の戻り値配列の各要素は閉ループ polyline であり、戻り値配列全体は **連結されていない** ことに注意 (= 呼び出し側で各リングの末尾→次リングの先頭に jump 必須)。
- **Phase 2 PR3 (`zigzagUnderlay` / `fillUnderlay`) との関係**: 本 PR で公開する `__internal.offsetShapeInward` (および内部の `runOffset`) は PR3 でも inset 計算に再利用する。署名を変えないよう注意。
- **glob ordering**: `edgeRunUnderlay` の戻り値配列の順序は `[outer ring, hole ring(s)...]` で固定する (テストでもこの順序を仮定)。複数 hole 時は `shape.holes` の入力順を保持する。
