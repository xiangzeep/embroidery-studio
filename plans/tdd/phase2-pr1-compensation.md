# Phase 2 PR1: clipper 導入 + Pull/Push compensation — TDD 実装計画

## 1. 概要

Phase 2 計画書「7. 実装ステップ」のステップ 1〜3 に該当する PR。`clipper-lib` (BSL ライセンス) を `package.json` に追加し、`src/lib/pipeline/compensation.ts` を新規作成して以下の 2 つの純関数を実装する。

- `applyPullCompensation(obj, fabric)`: object の `shape` を「外形=外側オフセット、穴=内側オフセット」した新オブジェクトを返す。Satin / Fill のみ対象、Run は変更せず返す。オフセット量は `props.pullCompMm` を最優先、未指定時は `pullCompForWidth(fabric, widthMm)` (Phase 1 PR2 提供) から導出。`props.pullCompPerSideMm` は Phase 2 PR1 では取り扱いを satin の **両端共通量** に丸める (per-side rail 単位の外側オフセットは Phase 2 PR2 以降に持ち越し)。
- `applyPushCompensation(obj, neighbors)`: 自分の bbox/多角形と重なる **異なる colorIndex** の neighbors が存在する場合のみ、自分の outer を `props.pushCompMm`（未指定なら `0` 扱い、ただし呼び出し側が `fabric.defaultPushCompMm` を代入する想定）だけ **内側** にオフセットして縮め、holes は逆に外側へ広げた新オブジェクトを返す。重なる neighbors が無ければ参照同一の object をそのまま返す。

両関数は **純粋関数**であり、入力 object を破壊しない。同一 `id` / `colorIndex` / `rgb` / `props` / `order` を維持し、**`shape` のみ差し替えた新オブジェクトを返す**。Phase 2 計画書 4.5 の「underlay は元 shape, top stitches は補正後 shape を使う」分離原則を守るため、補正前 object と補正後 object が同時に存在できる設計とする。

## 2. 依存関係

- **Phase 1 全体 (PR1〜PR5) がマージ済みであること** が前提:
  - PR1: `EmbroideryObject` / `ObjectProps` / `Shape` / `Polygon` / `Point2D` の型定義
  - PR1: `ObjectProps.pullCompMm` / `pullCompPerSideMm` / `pushCompMm` フィールド
  - PR2: `FabricProfile.pullCompPerWidth` / `minPullCompMm` / `defaultPushCompMm` フィールド
  - PR2: `pullCompForWidth(profile, widthMm)` 関数 (max(min, w*ratio) の線形クランプ)
  - PR3: `buildObjects` が `EmbroideryObject[]` を返している
  - PR4: `render.ts` の `renderRun` / `renderSatin` / `renderFill` が `EmbroideryObject` を入力に取れる (本 PR の呼び出し点)
- 新規依存パッケージ: **`clipper-lib@^6.4.2`** (BSL, junmer fork。Phase 2 計画書 3.3 で言及された `clipper-lib` を採用)
  - 代替候補: `@doodle3d/clipper-js@^1.0.11` (MIT, より高レベル API)。本 PR では `clipper-lib` を選択するが、Cycle 1 でラッパ層 (`src/lib/pipeline/polygon-offset.ts`) を挟むため将来の差し替えは局所修正で済む。
- 本 PR は **Phase 2 後続 PR (underlay / lockstitch / 順序統合) の前提**。本 PR でラッパ層を切る方針は、Phase 2 PR2 (`underlay.ts` の `edge-run` / `zigzag` の inset 計算) でも再利用できる。

## 3. 影響ファイル

### 編集
- `/Users/maguro/nodeApps/embroidery-studio/package.json`
  - `dependencies` に `"clipper-lib": "^6.4.2"` を追加
  - その他キーは触らない

### 新規
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/polygon-offset.ts`
  - `clipper-lib` の薄いラッパ。`offsetPolygon(polygon, deltaMm, scale?) -> Polygon[]` / `offsetShape(shape, outerDeltaMm, holeDeltaMm) -> Shape` を提供。
  - clipper は固定小数 (整数座標) を要求するため、内部で `mm → 1/scale 整数` への変換 (既定 `scale = 1000`、つまり 1µm 単位) と逆変換を担当する。
  - 失敗時 (空の結果、自己交差で破綻) は **元の polygon をそのまま返す** フォールバックを持つ。
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/compensation.ts`
  - `applyPullCompensation(obj, fabric) -> EmbroideryObject`
  - `applyPushCompensation(obj, neighbors) -> EmbroideryObject`
  - 補助: `computeSatinWidthMm(shape) -> number` (Phase 1 PR3 の `computeSatinWidth` 相当があれば再利用、無ければ簡易版を内部で実装し将来 build-objects へ移管予定とコメント)
  - 補助: `polygonsOverlap(a: Shape, b: Shape) -> boolean` (bbox プリチェック + clipper の `Intersection` 判定)
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/__tests__/polygon-offset.test.ts`
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/__tests__/compensation.test.ts`

### 触らない (回帰確認のみ)
- `src/lib/pipeline/__tests__/stitch.test.ts` (旧)
- `src/lib/pipeline/__tests__/render.test.ts` (PR4 マージ後)
- `src/lib/pipeline/render.ts` / `stitch.ts` 本体
- `src/lib/pipeline/{types,fabric,build-objects,vectorize,writer,index,compose}.ts`

## 4. テスト環境

- フレームワーク: **vitest** (既存と同じ)
- 実行コマンド: `npm test` (= `vitest run`)、単発: `npx vitest run src/lib/pipeline/__tests__/compensation.test.ts`
- テストファイル配置: `src/lib/pipeline/__tests__/*.test.ts`
- 既存パターン踏襲:
  - `intersectScanline` テストのように Polygon を `[number, number][]` の配列リテラルで宣言
  - 座標比較は `toBeCloseTo(値, 桁)` を使う (浮動小数誤差を許容)
  - `Shape` を直接組み立て、`Polygon` の向き (CW / CCW) はテスト側で明示する

## 5. インターフェース設計

### 5.1 polygon-offset.ts (clipper 抽象化層)

```ts
// src/lib/pipeline/polygon-offset.ts
import type { Polygon, Shape } from "./types";

/**
 * 単一 polygon を `deltaMm` だけオフセット。
 * - delta > 0: 外側 (拡大)
 * - delta < 0: 内側 (縮小)
 * - 戻り値が複数 polygon になる場合 (内側オフセットで分裂) は全部返す
 * - 結果が空 (内側オフセットで消失) なら空配列を返す
 * 失敗時 (自己交差等) は呼び出し側に判断を委ねるため `null` を返す。
 */
export function offsetPolygon(
  polygon: Polygon,
  deltaMm: number,
  opts?: { scale?: number; jointType?: "miter" | "round" | "square" },
): Polygon[] | null;

/**
 * Shape (outer + holes) をまとめてオフセット。
 * - outer は `outerDeltaMm` (pull comp は + / push comp は -)
 * - holes は `holeDeltaMm` (pull comp は - で穴を縮める / push comp は + で穴を広げる)
 * - outer が消失したら元 shape をそのまま返す (フォールバック)
 * - 分裂で outer が複数になった場合は最大面積のものを採用し、他はログに留める (Phase 2 PR1 ではシンプル化)
 */
export function offsetShape(
  shape: Shape,
  outerDeltaMm: number,
  holeDeltaMm: number,
  opts?: { scale?: number },
): Shape;
```

### 5.2 compensation.ts (本 PR の主役)

```ts
// src/lib/pipeline/compensation.ts
import type { EmbroideryObject, FabricProfile, Shape } from "./types";
import { pullCompForWidth } from "./fabric";
import { offsetShape, polygonsOverlap } from "./polygon-offset"; // polygonsOverlap は同モジュール内

/**
 * Pull compensation を適用した新 EmbroideryObject を返す。
 * 入力 obj は破壊しない。元の id / colorIndex / rgb / props / order を維持。
 *
 * 適用ルール:
 * - obj.kind === "run": 補正不要、入力をそのまま参照同一で返す
 * - obj.kind === "satin" | "fill":
 *   1. amount を決定:
 *      - obj.props.pullCompMm が定義されていればそれを使う
 *      - 未定義なら pullCompForWidth(fabric, computeSatinWidthMm(obj.shape))
 *   2. offsetShape(shape, +amount, -amount) で outer を外側 / holes を内側にオフセット
 *   3. 新 shape を持った新 object を返す
 *
 * 注意: props.pullCompPerSideMm (per-side 指定) は Phase 2 PR1 では
 *   { left, right } の平均値を均一適用する (rail 単位の分離は PR2 以降)。
 */
export function applyPullCompensation(
  obj: EmbroideryObject,
  fabric: FabricProfile,
): EmbroideryObject;

/**
 * Push compensation を適用した新 EmbroideryObject を返す。
 * 入力 obj は破壊しない。
 *
 * 適用ルール:
 * - neighbors のうち obj.colorIndex !== n.colorIndex のものだけを考慮
 * - 上記候補のいずれかが obj.shape と多角形交差していなければ、入力をそのまま参照同一で返す
 * - 交差があれば amount = obj.props.pushCompMm ?? 0 を取得し、
 *   offsetShape(shape, -amount, +amount) で outer を内側 / holes を外側にオフセット
 * - obj.kind === "run" は重なり判定対象外 (太さがないため push 補正不要)、入力をそのまま返す
 * - amount === 0 のときも入力をそのまま返す
 */
export function applyPushCompensation(
  obj: EmbroideryObject,
  neighbors: readonly EmbroideryObject[],
): EmbroideryObject;
```

### 5.3 ファイル構成 (再掲)

```
src/lib/pipeline/
  polygon-offset.ts         NEW  clipper-lib 抽象化
  compensation.ts           NEW  Pull / Push compensation 純関数
  __tests__/
    polygon-offset.test.ts  NEW
    compensation.test.ts    NEW
```

## 6. TDD サイクル

サイクル分割方針: 「外部依存 (clipper) のラッパを最初に固める → Pull を kind 別に薄く積む → Push の重なり検出 → Push のオフセット適用」の 4 サイクル。各サイクルは前サイクルのテストを破壊しない。

---

### Cycle 1: `polygon-offset.ts` — clipper-lib ラッパの最小実装

#### Red — 失敗するテスト

**ファイル**: `src/lib/pipeline/__tests__/polygon-offset.test.ts` (新規)

**テスト観点**:
- `clipper-lib` を `package.json` に追加し、ESM/CJS どちらでも import 可能なことを確認する
- 5mm × 1mm の矩形 (面積 5mm²) を `+0.2mm` 外側オフセットすると、bbox が `[-0.2, -0.2] - [5.2, 1.2]` 相当に広がる (面積は約 5.4mm × 1.4mm = 7.56mm² 相当)
- 同矩形を `-0.2mm` 内側オフセットすると bbox が `[0.2, 0.2] - [4.8, 0.8]` に縮む
- 5mm 正方形を `-3mm` (短辺の半分以上) 内側オフセットすると **空配列** が返る (消失)
- 自己交差ポリゴンを与えても例外は throw せず `null` または「ベストエフォートな結果」を返す
- `offsetShape({outer, holes:[hole]}, +0.2, -0.2)` で outer の bbox は拡大、hole の bbox は縮小する
- `offsetShape` で outer が消失した場合は **元 shape をそのまま返す** (フォールバック)

**test name (it)**:
- `offsetPolygon は 5mm 矩形を +0.2mm 外側オフセットすると幅が約 5.4mm に広がる`
- `offsetPolygon は 5mm 矩形を -0.2mm 内側オフセットすると幅が約 4.6mm に縮む`
- `offsetPolygon は 5mm 正方形を -3mm 内側オフセットすると空配列を返す`
- `offsetPolygon は 0mm オフセットなら元 polygon の bbox と一致する結果を返す`
- `offsetShape は outer を +0.2mm / hole を -0.2mm でオフセットし、outer は拡大 hole は縮小する`
- `offsetShape は outer が消失した場合に元 shape を返す (フォールバック)`

**サンプルテストコード**:

```ts
// src/lib/pipeline/__tests__/polygon-offset.test.ts
import { describe, it, expect } from "vitest";
import { offsetPolygon, offsetShape } from "../polygon-offset";
import type { Polygon, Shape } from "../types";

function bbox(polys: Polygon[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

describe("offsetPolygon", () => {
  const rect5x1: Polygon = [[0, 0], [5, 0], [5, 1], [0, 1]];

  it("offsetPolygon は 5mm 矩形を +0.2mm 外側オフセットすると幅が約 5.4mm に広がる", () => {
    const out = offsetPolygon(rect5x1, 0.2);
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(0);
    const b = bbox(out!);
    expect(b.maxX - b.minX).toBeCloseTo(5.4, 1);
    expect(b.maxY - b.minY).toBeCloseTo(1.4, 1);
    expect(b.minX).toBeCloseTo(-0.2, 1);
    expect(b.minY).toBeCloseTo(-0.2, 1);
  });

  it("offsetPolygon は 5mm 矩形を -0.2mm 内側オフセットすると幅が約 4.6mm に縮む", () => {
    const out = offsetPolygon(rect5x1, -0.2);
    expect(out).not.toBeNull();
    const b = bbox(out!);
    expect(b.maxX - b.minX).toBeCloseTo(4.6, 1);
    expect(b.maxY - b.minY).toBeCloseTo(0.6, 1);
  });

  it("offsetPolygon は 5mm 正方形を -3mm 内側オフセットすると空配列を返す", () => {
    const sq: Polygon = [[0, 0], [5, 0], [5, 5], [0, 5]];
    const out = offsetPolygon(sq, -3);
    expect(out).toEqual([]);
  });

  it("offsetPolygon は 0mm オフセットなら元 polygon の bbox と一致する結果を返す", () => {
    const out = offsetPolygon(rect5x1, 0);
    expect(out).not.toBeNull();
    const b = bbox(out!);
    expect(b.maxX - b.minX).toBeCloseTo(5, 2);
    expect(b.maxY - b.minY).toBeCloseTo(1, 2);
  });
});

describe("offsetShape", () => {
  it("offsetShape は outer を +0.2mm / hole を -0.2mm でオフセットし、outer は拡大 hole は縮小する", () => {
    const shape: Shape = {
      outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
    };
    const out = offsetShape(shape, 0.2, -0.2);
    const ob = bbox([out.outer]);
    expect(ob.maxX - ob.minX).toBeCloseTo(10.4, 1);
    expect(out.holes.length).toBe(1);
    const hb = bbox([out.holes[0]]);
    expect(hb.maxX - hb.minX).toBeCloseTo(3.6, 1); // 4mm → 3.6mm に縮む
  });

  it("offsetShape は outer が消失した場合に元 shape を返す (フォールバック)", () => {
    const shape: Shape = {
      outer: [[0, 0], [1, 0], [1, 1], [0, 1]],
      holes: [],
    };
    const out = offsetShape(shape, -2, 0); // 1mm 矩形を -2mm → 消失
    expect(out).toEqual(shape);
  });
});
```

**失敗理由**: `clipper-lib` が `package.json` に未追加で `Cannot find module 'clipper-lib'`、かつ `polygon-offset.ts` 自体が存在せず `Cannot find module '../polygon-offset'`。

#### Green — 最小実装

**ステップ A: 依存追加 (別コミット推奨)**

```bash
npm install clipper-lib@^6.4.2
```

`package.json` の `dependencies` に `"clipper-lib": "^6.4.2"` が入る。`package-lock.json` も同時にコミット。

**ステップ B: ラッパ実装**

`src/lib/pipeline/polygon-offset.ts` を新規作成:

```ts
import ClipperLib from "clipper-lib";
import type { Polygon, Shape } from "./types";

const DEFAULT_SCALE = 1000; // 1mm = 1000 整数単位 (1µm 精度)

function toClipperPath(polygon: Polygon, scale: number): { X: number; Y: number }[] {
  return polygon.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }));
}

function fromClipperPath(path: { X: number; Y: number }[], scale: number): Polygon {
  return path.map((p) => [p.X / scale, p.Y / scale] as [number, number]);
}

export function offsetPolygon(
  polygon: Polygon,
  deltaMm: number,
  opts?: { scale?: number; jointType?: "miter" | "round" | "square" },
): Polygon[] | null {
  const scale = opts?.scale ?? DEFAULT_SCALE;
  if (polygon.length < 3) return null;

  try {
    const co = new ClipperLib.ClipperOffset();
    const jt =
      opts?.jointType === "round"  ? ClipperLib.JoinType.jtRound
      : opts?.jointType === "square" ? ClipperLib.JoinType.jtSquare
      : ClipperLib.JoinType.jtMiter;
    co.AddPath(toClipperPath(polygon, scale), jt, ClipperLib.EndType.etClosedPolygon);
    const solution: { X: number; Y: number }[][] = [];
    co.Execute(solution, deltaMm * scale);
    return solution.map((p) => fromClipperPath(p, scale));
  } catch {
    return null;
  }
}

export function offsetShape(
  shape: Shape,
  outerDeltaMm: number,
  holeDeltaMm: number,
  opts?: { scale?: number },
): Shape {
  const outerResult = offsetPolygon(shape.outer, outerDeltaMm, opts);
  if (outerResult === null || outerResult.length === 0) return shape; // フォールバック

  // 最大面積の outer を 1 つ採用 (PR1 ではシンプル化)
  const outer = outerResult.reduce((best, cur) =>
    polygonArea(cur) > polygonArea(best) ? cur : best,
  );

  const holes: Polygon[] = [];
  for (const h of shape.holes) {
    const r = offsetPolygon(h, holeDeltaMm, opts);
    if (r && r.length > 0) {
      // 穴は最大面積のものを 1 つ保持
      holes.push(r.reduce((b, c) => (polygonArea(c) > polygonArea(b) ? c : b)));
    }
    // 消失した穴は捨てる (push comp で holes が広がりすぎたケースを想定)
  }

  return { outer, holes };
}

function polygonArea(p: Polygon): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
```

#### Refactor

- `toClipperPath` / `fromClipperPath` / `polygonArea` は本 PR では `polygon-offset.ts` 内で private に保つ
- `polygonArea` は Phase 2 PR2 (`underlay.ts` の medial-axis 推定でも面積判定に使う想定) で `src/lib/pipeline/geometry.ts` に切り出す可能性があるとコメントで TODO を残す
- `DEFAULT_SCALE = 1000` の根拠 (mm × 1000 = µm 精度。clipper は 53bit 整数まで安全に扱えるので 100mm × 100mm 設計でも余裕) をコメントで残す
- ESLint で `@typescript-eslint/no-explicit-any` に当たる場合は `clipper-lib` 用に最小の `.d.ts` を `src/types/clipper-lib.d.ts` に追加 (Cycle 1 完了時に必要なら作る)

---

### Cycle 2: `applyPullCompensation` — Satin / Fill / Run の分岐 + amount 決定

#### Red — 失敗するテスト

**ファイル**: `src/lib/pipeline/__tests__/compensation.test.ts` (新規)

**テスト観点**:

1. **Satin (props.pullCompMm 指定あり)**: 5mm × 1mm の satin obj に `pullCompMm = 0.2` を指定して `applyPullCompensation` を呼ぶと、結果 `obj.shape.outer` の bbox 幅が `5.4mm` (= 5 + 2*0.2) に広がる
2. **Satin (props.pullCompMm 未指定)**: `pullCompMm` 未指定なら `fabric.pullCompForWidth(widthMm)` の値が適用される
   - denim (pullCompPerWidth=0.025, minPullCompMm=0.1) で幅 7mm satin → `max(0.1, 7*0.025) = 0.175mm` → bbox 幅が `7 + 2*0.175 = 7.35mm` 相当
3. **Fill (穴あり)**: 10mm 正方形に 4mm 正方形の穴を持つ fill obj に `pullCompMm = 0.2` を適用すると、outer は外側に広がり (bbox `[-0.2, -0.2] - [10.2, 10.2]`)、hole は内側に縮む (bbox `[3.2, 3.2] - [6.8, 6.8]`)
4. **Run**: kind=run の obj に `applyPullCompensation` を呼ぶと **参照同一**で返る (`result === obj`)
5. **非破壊**: 入力 `obj.shape.outer` が変更されない (元の参照が同じ座標を持ち続ける)
6. **id / colorIndex / rgb / props / order の維持**: 戻り値の `id` / `colorIndex` / `rgb` / `props` / `order` が入力と一致する。ただし `shape` は別オブジェクト
7. **per-side フォールバック**: `pullCompPerSideMm = { left: 0.1, right: 0.3 }` を指定したら平均値 `0.2mm` で均一適用される (Phase 2 PR1 の暫定仕様)
8. **0mm のとき**: amount = 0 ならば shape は変わらないが、新 object として返ってよい (assertion は座標一致のみ)

**test name (it)**:
- `applyPullCompensation: Satin に pullCompMm=0.2 を指定すると outer bbox が +0.4mm 広がる`
- `applyPullCompensation: Satin で pullCompMm 未指定なら pullCompForWidth(fabric, width) が適用される`
- `applyPullCompensation: Fill (穴あり) で outer は外側 / hole は内側にオフセットされる`
- `applyPullCompensation: Run は参照同一で返り shape も不変`
- `applyPullCompensation: 入力 obj.shape は破壊されない (非破壊)`
- `applyPullCompensation: id / colorIndex / rgb / props / order は維持される`
- `applyPullCompensation: pullCompPerSideMm が指定されたら left/right の平均値で均一適用 (Phase 2 PR1 仕様)`
- `applyPullCompensation: amount=0 のとき shape の座標は実質変わらない`

**サンプルテストコード**:

```ts
// src/lib/pipeline/__tests__/compensation.test.ts
import { describe, it, expect } from "vitest";
import { applyPullCompensation } from "../compensation";
import { getFabricProfile } from "../fabric";
import type { EmbroideryObject, Shape } from "../types";

function makeObj(
  kind: "satin" | "fill" | "run",
  shape: Shape,
  overrides: Partial<EmbroideryObject["props"]> = {},
): EmbroideryObject {
  return {
    id: "o1",
    kind,
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape,
    props: { densityMm: 0.4, maxStitchMm: 7, ...overrides },
    order: 0,
  };
}

function bbox(polygon: [number, number][]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

describe("applyPullCompensation", () => {
  const denim = getFabricProfile("denim");

  it("Satin に pullCompMm=0.2 を指定すると outer bbox が +0.4mm 広がる", () => {
    const shape: Shape = { outer: [[0, 0], [5, 0], [5, 1], [0, 1]], holes: [] };
    const obj = makeObj("satin", shape, { pullCompMm: 0.2 });
    const result = applyPullCompensation(obj, denim);
    const b = bbox(result.shape.outer);
    expect(b.w).toBeCloseTo(5.4, 1);
    expect(b.h).toBeCloseTo(1.4, 1);
  });

  it("Satin で pullCompMm 未指定なら pullCompForWidth(fabric, width) が適用される", () => {
    // 幅 7mm × 長さ 30mm の satin。短軸は 7mm
    const shape: Shape = { outer: [[0, 0], [30, 0], [30, 7], [0, 7]], holes: [] };
    const obj = makeObj("satin", shape);
    const result = applyPullCompensation(obj, denim);
    const b = bbox(result.shape.outer);
    // denim: max(0.1, 7*0.025) = 0.175mm → 短辺 7 → 7.35mm に
    expect(b.h).toBeCloseTo(7.35, 1);
  });

  it("Fill (穴あり) で outer は外側 / hole は内側にオフセットされる", () => {
    const shape: Shape = {
      outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
    };
    const obj = makeObj("fill", shape, { pullCompMm: 0.2 });
    const result = applyPullCompensation(obj, denim);
    const ob = bbox(result.shape.outer);
    expect(ob.w).toBeCloseTo(10.4, 1);
    expect(result.shape.holes).toHaveLength(1);
    const hb = bbox(result.shape.holes[0]);
    expect(hb.w).toBeCloseTo(3.6, 1); // 4mm → 3.6mm
  });

  it("Run は参照同一で返り shape も不変", () => {
    const shape: Shape = { outer: [[0, 0], [10, 0]], holes: [] };
    const obj = makeObj("run", shape, { pullCompMm: 0.2 });
    const result = applyPullCompensation(obj, denim);
    expect(result).toBe(obj);
  });

  it("入力 obj.shape は破壊されない (非破壊)", () => {
    const shape: Shape = { outer: [[0, 0], [5, 0], [5, 1], [0, 1]], holes: [] };
    const snapshot = JSON.stringify(shape);
    const obj = makeObj("satin", shape, { pullCompMm: 0.2 });
    applyPullCompensation(obj, denim);
    expect(JSON.stringify(shape)).toBe(snapshot);
  });

  it("id / colorIndex / rgb / props / order は維持される", () => {
    const shape: Shape = { outer: [[0, 0], [5, 0], [5, 1], [0, 1]], holes: [] };
    const obj: EmbroideryObject = {
      id: "abc",
      kind: "satin",
      colorIndex: 3,
      rgb: [10, 20, 30],
      shape,
      props: { densityMm: 0.4, maxStitchMm: 7, pullCompMm: 0.2 },
      order: 5,
      locked: true,
    };
    const result = applyPullCompensation(obj, denim);
    expect(result.id).toBe("abc");
    expect(result.colorIndex).toBe(3);
    expect(result.rgb).toEqual([10, 20, 30]);
    expect(result.props).toEqual(obj.props);
    expect(result.order).toBe(5);
    expect(result.locked).toBe(true);
    expect(result.shape).not.toBe(shape);
  });

  it("pullCompPerSideMm が指定されたら left/right の平均値で均一適用 (Phase 2 PR1 仕様)", () => {
    const shape: Shape = { outer: [[0, 0], [5, 0], [5, 1], [0, 1]], holes: [] };
    const obj = makeObj("satin", shape, {
      pullCompPerSideMm: { left: 0.1, right: 0.3 },
    });
    const result = applyPullCompensation(obj, denim);
    const b = bbox(result.shape.outer);
    // 平均 0.2mm → bbox 幅 5 + 0.4 = 5.4mm
    expect(b.w).toBeCloseTo(5.4, 1);
  });

  it("amount=0 のとき shape の座標は実質変わらない", () => {
    const shape: Shape = { outer: [[0, 0], [5, 0], [5, 1], [0, 1]], holes: [] };
    const obj = makeObj("satin", shape, { pullCompMm: 0 });
    const result = applyPullCompensation(obj, denim);
    const b = bbox(result.shape.outer);
    expect(b.w).toBeCloseTo(5, 2);
    expect(b.h).toBeCloseTo(1, 2);
  });
});
```

**失敗理由**: `compensation.ts` が存在せず `Cannot find module '../compensation'`。

#### Green — 最小実装

`src/lib/pipeline/compensation.ts` を新規作成:

```ts
import type { EmbroideryObject, FabricProfile, Polygon, Shape } from "./types";
import { pullCompForWidth } from "./fabric";
import { offsetShape } from "./polygon-offset";

export function applyPullCompensation(
  obj: EmbroideryObject,
  fabric: FabricProfile,
): EmbroideryObject {
  if (obj.kind === "run") return obj;

  const amount = resolvePullAmount(obj, fabric);
  if (amount <= 0) {
    // amount=0 でも新 object を返すが、shape は元と同等
    return { ...obj, shape: { outer: [...obj.shape.outer], holes: obj.shape.holes.map((h) => [...h]) } };
  }

  const newShape = offsetShape(obj.shape, +amount, -amount);
  return { ...obj, shape: newShape };
}

function resolvePullAmount(obj: EmbroideryObject, fabric: FabricProfile): number {
  if (obj.props.pullCompMm !== undefined) return obj.props.pullCompMm;
  if (obj.props.pullCompPerSideMm) {
    const { left, right } = obj.props.pullCompPerSideMm;
    return (left + right) / 2;
  }
  const widthMm = computeSatinWidthMm(obj.shape);
  return pullCompForWidth(fabric, widthMm);
}

/**
 * shape の短軸方向の幅 (mm) を簡易計算する。
 * PR4 で `analyzeShape` を再利用するのが理想だが、本 PR では循環依存を避けるため
 * モジュール内に最小実装を持つ。bbox の短辺で代用。
 * Phase 2 PR2 以降で `src/lib/pipeline/geometry.ts` に切り出す予定。
 */
function computeSatinWidthMm(shape: Shape): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of shape.outer) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Math.min(maxX - minX, maxY - minY);
}
```

#### Refactor

- `computeSatinWidthMm` は bbox 短辺による近似であり PCA 短軸 (`analyzeShape` 由来) と一致しないため、Phase 2 PR2 開始時に `geometry.ts` への切り出しと PCA 利用への置き換えを行う旨を TODO コメントとして残す
- `resolvePullAmount` の優先順位 (props.pullCompMm > pullCompPerSideMm 平均 > fabric 由来) を JSDoc にまとめる
- `applyPullCompensation` のエクスポートは型的に `(EmbroideryObject, FabricProfile) => EmbroideryObject` の純関数であることを JSDoc で明示し、「underlay は元 shape を使う」設計意図を簡潔に書く

---

### Cycle 3: `applyPushCompensation` — 重なり検出 (`polygonsOverlap`) と「重ならなければ参照同一」

このサイクルでは **重なり検出ロジックだけ**を完成させ、オフセット適用は Cycle 4 で行う。Push comp 全体を 1 サイクルにすると Red→Green が大きすぎてレビューが困難になるため、検出と適用を分離する。

#### Red — 失敗するテスト

**ファイル**: `src/lib/pipeline/__tests__/compensation.test.ts` に追記

**テスト観点**:

1. **重なる neighbor 無し**: neighbors が空配列なら入力 object をそのまま返す (参照同一)
2. **bbox が離れている neighbor**: 完全に分離した neighbor だけがある場合 → 参照同一で返る
3. **同色 neighbor のみ**: 同じ colorIndex の neighbor とのみ重なっている場合 → 参照同一で返る (Phase 2 計画書 5.2: 同色は無視)
4. **異色 neighbor と重なる**: colorIndex が異なり、かつ多角形交差している neighbor がある場合 → **shape が変化した新 object** が返る (具体的なオフセット結果は Cycle 4 で検証、ここでは「参照が違うこと」「outer の bbox が縮んでいること」だけ確認)
5. **kind=run**: run object は重なり判定対象外で常に参照同一で返る
6. **amount=0** (`pushCompMm` 未指定): Cycle 3 段階の Green 実装では `pushCompMm` 未指定 = `0` 扱いで参照同一で返る (Cycle 4 でこの分岐も網羅)

**test name (it)**:
- `applyPushCompensation: neighbors=[] なら参照同一で返る`
- `applyPushCompensation: 完全に離れた異色 neighbor のみなら参照同一で返る`
- `applyPushCompensation: 同色 neighbor とのみ重なっていれば参照同一で返る`
- `applyPushCompensation: 異色 neighbor と重なるとき shape が変化した新 object を返す`
- `applyPushCompensation: kind=run の obj は常に参照同一で返る`
- `applyPushCompensation: pushCompMm 未指定 (=0 扱い) なら参照同一で返る`

**サンプルテストコード (追記分)**:

```ts
import { applyPushCompensation } from "../compensation";

describe("applyPushCompensation (overlap detection)", () => {
  const baseSquare: Shape = {
    outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
    holes: [],
  };

  it("neighbors=[] なら参照同一で返る", () => {
    const obj = makeObj("fill", baseSquare, { pushCompMm: 0.4 });
    expect(applyPushCompensation(obj, [])).toBe(obj);
  });

  it("完全に離れた異色 neighbor のみなら参照同一で返る", () => {
    const obj = makeObj("fill", baseSquare, { pushCompMm: 0.4 });
    const far: EmbroideryObject = {
      ...makeObj("fill", { outer: [[100, 100], [110, 100], [110, 110], [100, 110]], holes: [] }),
      id: "n1", colorIndex: 1,
    };
    expect(applyPushCompensation(obj, [far])).toBe(obj);
  });

  it("同色 neighbor とのみ重なっていれば参照同一で返る", () => {
    const obj = makeObj("fill", baseSquare, { pushCompMm: 0.4 });
    const overlapSameColor: EmbroideryObject = {
      ...makeObj("fill", { outer: [[5, 5], [15, 5], [15, 15], [5, 15]], holes: [] }),
      id: "n2", colorIndex: 0, // obj と同色
    };
    expect(applyPushCompensation(obj, [overlapSameColor])).toBe(obj);
  });

  it("異色 neighbor と重なるとき shape が変化した新 object を返す", () => {
    const obj = makeObj("fill", baseSquare, { pushCompMm: 0.4 });
    const overlapDiffColor: EmbroideryObject = {
      ...makeObj("fill", { outer: [[5, 5], [15, 5], [15, 15], [5, 15]], holes: [] }),
      id: "n3", colorIndex: 1, // 異色
    };
    const result = applyPushCompensation(obj, [overlapDiffColor]);
    expect(result).not.toBe(obj);
    const b = bbox(result.shape.outer);
    // outer は内側オフセットで小さくなる
    expect(b.w).toBeLessThan(10);
    expect(b.h).toBeLessThan(10);
  });

  it("kind=run の obj は常に参照同一で返る", () => {
    const obj = makeObj("run", { outer: [[0, 0], [10, 0]], holes: [] }, { pushCompMm: 0.4 });
    const overlap: EmbroideryObject = {
      ...makeObj("fill", { outer: [[0, -5], [10, -5], [10, 5], [0, 5]], holes: [] }),
      id: "n4", colorIndex: 1,
    };
    expect(applyPushCompensation(obj, [overlap])).toBe(obj);
  });

  it("pushCompMm 未指定 (=0 扱い) なら参照同一で返る", () => {
    const obj = makeObj("fill", baseSquare); // pushCompMm 未指定
    const overlap: EmbroideryObject = {
      ...makeObj("fill", { outer: [[5, 5], [15, 5], [15, 15], [5, 15]], holes: [] }),
      id: "n5", colorIndex: 1,
    };
    expect(applyPushCompensation(obj, [overlap])).toBe(obj);
  });
});
```

**失敗理由**: `applyPushCompensation` および `polygonsOverlap` 未実装で import エラー。

#### Green — 最小実装

`compensation.ts` に追記:

```ts
export function applyPushCompensation(
  obj: EmbroideryObject,
  neighbors: readonly EmbroideryObject[],
): EmbroideryObject {
  if (obj.kind === "run") return obj;
  const amount = obj.props.pushCompMm ?? 0;
  if (amount <= 0) return obj;

  const diffColorNeighbors = neighbors.filter((n) => n.colorIndex !== obj.colorIndex);
  if (diffColorNeighbors.length === 0) return obj;

  const hasOverlap = diffColorNeighbors.some((n) => polygonsOverlap(obj.shape, n.shape));
  if (!hasOverlap) return obj;

  const newShape = offsetShape(obj.shape, -amount, +amount);
  return { ...obj, shape: newShape };
}

/**
 * bbox プリチェック + clipper の Intersection 判定で 2 つの shape が重なるかを返す。
 * Phase 2 PR1 では outer のみで判定し、holes 内に neighbor が完全に含まれる
 * 「ドーナツ穴の中の独立 object」は重なりなしと見なされる (実用上問題ない)。
 */
export function polygonsOverlap(a: Shape, b: Shape): boolean {
  if (!bboxIntersects(a.outer, b.outer)) return false;
  // bbox 接触があれば clipper で交差判定
  try {
    const ClipperLib = require("clipper-lib"); // 動的 require で test 環境での tree-shaking 影響を避ける
    const scale = 1000;
    const subj = [a.outer.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }))];
    const clip = [b.outer.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }))];
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    const solution: { X: number; Y: number }[][] = [];
    clipper.Execute(
      ClipperLib.ClipType.ctIntersection,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );
    return solution.some((p) => p.length >= 3);
  } catch {
    // フォールバック: bbox 接触 → 重なりと判定 (保守的)
    return true;
  }
}

function bboxIntersects(a: Polygon, b: Polygon): boolean {
  let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
  for (const [x, y] of a) {
    if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
    if (y < aMinY) aMinY = y; if (y > aMaxY) aMaxY = y;
  }
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const [x, y] of b) {
    if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
    if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
  }
  return !(aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY);
}
```

#### Refactor

- `polygonsOverlap` 内の clipper 呼び出しは Cycle 1 の `polygon-offset.ts` 内ヘルパー (`toClipperPath` / `fromClipperPath`) と重複する。`polygon-offset.ts` から `polygonsIntersect(a, b)` を export する形にリファクタし、`compensation.ts` の `polygonsOverlap` は bbox プリチェック + そのヘルパー呼び出しの 2 行関数に縮める
- `bboxIntersects` は `polygon-offset.ts` または将来の `geometry.ts` に移管する候補。Cycle 4 完了後に Cycle 2 のヘルパーと一緒に整理する
- `require("clipper-lib")` の動的 require は ESM プロジェクトでは避けるべきなので、Refactor 段階でファイル先頭の `import ClipperLib from "clipper-lib"` 経由に統一する (Cycle 1 と同じ参照を使う)

---

### Cycle 4: `applyPushCompensation` — オフセット適用の数値検証 + edge case

Cycle 3 で「重ならなければ参照同一」「重なれば shape 変化」を担保したので、本サイクルでは **具体的なオフセット量と holes の挙動** を厳密にテストする。

#### Red — 失敗するテスト

**ファイル**: `src/lib/pipeline/__tests__/compensation.test.ts` に追記

**テスト観点**:

1. **outer の縮み量**: 10mm 正方形 fill (colorIndex=0) に異色 neighbor (重なり) があるとき、`pushCompMm=0.4` で outer の bbox 幅が `10 - 2*0.4 = 9.2mm` に縮む
2. **hole の広がり量**: 穴あり fill (outer 10mm 正方形, hole 4mm 正方形) に異色重なりがある場合、outer は内側に / hole は外側にオフセット → hole の bbox 幅が `4 + 2*0.4 = 4.8mm` に広がる
3. **非破壊**: 入力 obj.shape は変更されない
4. **id / colorIndex / props / order の維持**: Cycle 2 の Pull と同じ観点
5. **複数 neighbor**: 異色重なりが 2 個以上あっても、shape は **1 回だけ縮む** (重なり個数で重ねがけしない)
6. **outer 消失フォールバック**: `pushCompMm` が大きすぎて outer が消失する場合 → 元 shape をそのまま使った object を返す (offsetShape のフォールバック経由)。`result.shape === obj.shape` または座標完全一致

**test name (it)**:
- `applyPushCompensation: 10mm 正方形に pushCompMm=0.4 で outer bbox は 9.2mm に縮む`
- `applyPushCompensation: 穴あり fill で outer は内側 / hole は外側にオフセットされる`
- `applyPushCompensation: 入力 obj.shape は破壊されない`
- `applyPushCompensation: id / colorIndex / rgb / props / order は維持される`
- `applyPushCompensation: 異色 neighbor が複数あっても shape の縮み量は 1 回ぶんのみ`
- `applyPushCompensation: pushCompMm が大きすぎて outer が消失する場合は元 shape を保つ`

**サンプルテストコード (追記分)**:

```ts
describe("applyPushCompensation (offset values)", () => {
  const tenSquare: Shape = {
    outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
    holes: [],
  };

  function diffColorNeighbor(): EmbroideryObject {
    return {
      ...makeObj("fill", { outer: [[5, 5], [15, 5], [15, 15], [5, 15]], holes: [] }),
      id: "n", colorIndex: 99,
    };
  }

  it("10mm 正方形に pushCompMm=0.4 で outer bbox は 9.2mm に縮む", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const r = applyPushCompensation(obj, [diffColorNeighbor()]);
    const b = bbox(r.shape.outer);
    expect(b.w).toBeCloseTo(9.2, 1);
    expect(b.h).toBeCloseTo(9.2, 1);
  });

  it("穴あり fill で outer は内側 / hole は外側にオフセットされる", () => {
    const shape: Shape = {
      outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
    };
    const obj = makeObj("fill", shape, { pushCompMm: 0.4 });
    const r = applyPushCompensation(obj, [diffColorNeighbor()]);
    const ob = bbox(r.shape.outer);
    expect(ob.w).toBeCloseTo(9.2, 1);
    expect(r.shape.holes).toHaveLength(1);
    const hb = bbox(r.shape.holes[0]);
    expect(hb.w).toBeCloseTo(4.8, 1); // 4mm → 4.8mm に広がる
  });

  it("入力 obj.shape は破壊されない", () => {
    const shape: Shape = { ...tenSquare };
    const snap = JSON.stringify(shape);
    const obj = makeObj("fill", shape, { pushCompMm: 0.4 });
    applyPushCompensation(obj, [diffColorNeighbor()]);
    expect(JSON.stringify(shape)).toBe(snap);
  });

  it("id / colorIndex / rgb / props / order は維持される", () => {
    const obj: EmbroideryObject = {
      id: "keep-me",
      kind: "fill",
      colorIndex: 7,
      rgb: [1, 2, 3],
      shape: tenSquare,
      props: { densityMm: 0.4, maxStitchMm: 7, pushCompMm: 0.4 },
      order: 9,
    };
    const r = applyPushCompensation(obj, [diffColorNeighbor()]);
    expect(r.id).toBe("keep-me");
    expect(r.colorIndex).toBe(7);
    expect(r.rgb).toEqual([1, 2, 3]);
    expect(r.props.pushCompMm).toBe(0.4);
    expect(r.order).toBe(9);
  });

  it("異色 neighbor が複数あっても shape の縮み量は 1 回ぶんのみ", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const n1 = diffColorNeighbor();
    const n2: EmbroideryObject = {
      ...makeObj("fill", { outer: [[8, 8], [12, 8], [12, 12], [8, 12]], holes: [] }),
      id: "n2", colorIndex: 100,
    };
    const r = applyPushCompensation(obj, [n1, n2]);
    const b = bbox(r.shape.outer);
    expect(b.w).toBeCloseTo(9.2, 1); // 0.8mm の縮みのみ (二重適用ではない)
  });

  it("pushCompMm が大きすぎて outer が消失する場合は元 shape を保つ", () => {
    const small: Shape = { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] };
    const obj = makeObj("fill", small, { pushCompMm: 2 }); // 1mm square を 2mm 縮める → 消失
    const overlap: EmbroideryObject = {
      ...makeObj("fill", { outer: [[-1, -1], [2, -1], [2, 2], [-1, 2]], holes: [] }),
      id: "ov", colorIndex: 1,
    };
    const r = applyPushCompensation(obj, [overlap]);
    // offsetShape のフォールバックにより outer の座標は元と等価
    const b = bbox(r.shape.outer);
    expect(b.w).toBeCloseTo(1, 2);
    expect(b.h).toBeCloseTo(1, 2);
  });
});
```

**失敗理由**: Cycle 3 段階の Green 実装はあるが、`offsetShape` 連携の数値精度や holes 方向 / 多重 neighbor / 消失フォールバックの挙動が未保証で、いずれかが通らない。

#### Green — 最小実装

- 大半は Cycle 3 の Green で既に通る想定。失敗するテストがあれば原因は以下のどれか:
  1. `offsetShape` の holes 方向が逆 → Cycle 1 の `offsetShape(shape, outerDelta, holeDelta)` 呼び出しを `applyPushCompensation` で `(shape, -amount, +amount)` に固定する
  2. 多重 neighbor で複数回呼ばれている → Cycle 3 の Green コード (1 回しか offsetShape を呼ばない) を維持
  3. outer 消失時のフォールバック → `offsetShape` 自身が元 shape を返す (Cycle 1 で実装済み)。`applyPushCompensation` は `offsetShape` の結果をそのまま `shape` に入れる
- 必要に応じて `offsetShape` 内の `polygonArea > best` 選択が `0` で比較されている場合の単独 polygon フォールバックを修正

#### Refactor

- `compensation.ts` 内で「pull / push どちらも `offsetShape(shape, signedOuter, signedHole)` の薄いラッパ」になっていることを確認し、共通の `applyShapeOffset(shape, outerDelta, holeDelta): Shape` ヘルパに 1 段抽象化する案を JSDoc にコメント留め (本 PR では抽象化しない: テストが少ない段階での過剰抽象化は避ける)
- `polygonsOverlap` の clipper 動的 require を Cycle 3 Refactor で静的 import に揃え終わっていない場合はここで完了
- ドキュメント: `compensation.ts` の冒頭に「Phase 2 計画書 4.5 の order: underlay は元 shape、top stitches は補正後 shape を使う」設計意図を 5 行程度のヘッダコメントとして明記
- `package.json` への `clipper-lib` 追加コミットを単独で残す (依存追加コミットを分けることでレビュー容易性が上がる)

---

## 7. 回帰防止

各サイクルの Green / Refactor 完了後に以下を必ず実行:

1. `npm test` (= `vitest run`) を全件実行し、以下がすべてグリーン:
   - 既存 `src/lib/pipeline/__tests__/stitch.test.ts` (Phase 1 PR4 完了時点で `render.test.ts` にリネームされている想定。どちらでも全件パスすること)
   - 既存 `src/lib/pipeline/__tests__/vectorize.test.ts`
   - 既存 `src/lib/pipeline/__tests__/types.test.ts` / `design.test.ts` / `fabric.test.ts` / `build-objects.test.ts` (Phase 1 で導入された全テスト)
   - 新規 `polygon-offset.test.ts` / `compensation.test.ts`
2. `npm run build` (= `next build`) が型エラーなく通る。`clipper-lib` の型定義が無いため、必要なら `src/types/clipper-lib.d.ts` (最小 ambient 宣言) を追加して TypeScript エラーを解消
3. `compensation.ts` を import している箇所が **本 PR 時点では 0 件** であること (= 既存パイプラインに副作用が出ないこと)。`render.ts` / `compose.ts` への組み込みは Phase 2 PR5 以降で行う

特に `render.test.ts` の以下のテストが本 PR でも維持されること:
- `離れた 2 つの fill 矩形の間に fill 縫い目が現れない`
- `穴あき矩形を fill しても、穴の中を fill 縫い目が横断しない`

これらは scanline / jump 挙動に依存しており、本 PR では一切触らないので失敗しないはず。失敗した場合は polygon-offset.ts が誤って既存ファイルへ副作用を与えた疑いがあるため即座に切り戻す。

## 8. 受け入れ条件

- [ ] `package.json` の `dependencies` に `clipper-lib@^6.4.2` が追加され、`package-lock.json` も同時にコミットされている
- [ ] `src/lib/pipeline/polygon-offset.ts` が新規作成され、`offsetPolygon` / `offsetShape` が export されている
- [ ] `src/lib/pipeline/compensation.ts` が新規作成され、`applyPullCompensation` / `applyPushCompensation` / `polygonsOverlap` が export されている
- [ ] `applyPullCompensation(obj, fabric)` は純関数で、入力 obj を破壊しない (`obj.shape` のディープ等価が保たれる)
- [ ] `applyPullCompensation` は Satin / Fill では `shape.outer` を `pullCompMm` (または `pullCompForWidth` 由来値) ぶん外側にオフセットし、`shape.holes` は同量内側にオフセットする
- [ ] `applyPullCompensation` は Run には参照同一でそのまま返す
- [ ] `applyPushCompensation(obj, neighbors)` は **異色** neighbor との多角形交差がある場合のみ `shape.outer` を `pushCompMm` ぶん内側に / `shape.holes` は同量外側にオフセットする
- [ ] `applyPushCompensation` は重なり無し / Run / amount=0 / 同色 only のとき参照同一で返す
- [ ] `applyPushCompensation` は異色 neighbor が複数あっても shape を 1 回だけしか縮めない
- [ ] outer 消失時 (内側オフセット過大) は `offsetShape` のフォールバックにより元 shape の座標を保った object を返す
- [ ] `compensation.ts` / `polygon-offset.ts` は既存パイプライン (`render.ts` / `compose.ts` / `index.ts`) からは **まだ呼ばれていない** (Phase 2 PR5 以降の組み込みを待つ)
- [ ] `npm test` の全件パス、`npm run build` の型チェック通過
- [ ] 新規テストファイル合計 **15 ケース以上** (`polygon-offset.test.ts` 6 件 + `compensation.test.ts` 14 件 = 20 件規模を想定)

## 9. コミット粒度

TDD サイクル単位 + 依存追加コミットを別建て。Conventional Commits 形式。

1. `chore(deps): add clipper-lib for polygon offset operations` (依存追加コミット。`package.json` + `package-lock.json` のみ)
2. `test(pipeline): add offsetPolygon / offsetShape boundary tests` (Cycle 1 Red)
3. `feat(pipeline): wrap clipper-lib as offsetPolygon / offsetShape` (Cycle 1 Green + Refactor)
4. `test(pipeline): add applyPullCompensation tests for satin/fill/run` (Cycle 2 Red)
5. `feat(pipeline): implement applyPullCompensation with pull amount resolution` (Cycle 2 Green + Refactor)
6. `test(pipeline): add applyPushCompensation overlap-detection tests` (Cycle 3 Red)
7. `feat(pipeline): implement applyPushCompensation with diff-color overlap detection` (Cycle 3 Green + Refactor)
8. `test(pipeline): add applyPushCompensation offset-value and edge-case tests` (Cycle 4 Red)
9. `feat(pipeline): finalize applyPushCompensation offset application (holes + multi-neighbor + fallback)` (Cycle 4 Green + Refactor)

合計 **9 コミット** 程度。コミット 1 を最初に独立させることで「依存追加だけ先に通すレビュー」と「実装レビュー」を分離できる。

## 10. 想定 PR タイトル

`feat(pipeline): add pull/push compensation with clipper-lib (phase 2 pr1)`

PR 本文には以下を含める (3-7 行):
- Phase 2 計画書 (`plans/20-phase2-quality.md`) の「7. 実装ステップ 1〜3」に対応
- `clipper-lib` (BSL, polygon offset 用) を新規依存に追加した旨
- `applyPullCompensation` / `applyPushCompensation` は **純関数** で `EmbroideryObject` を破壊せず新インスタンスを返す
- 「underlay は元 shape, top stitches は補正後 shape を使う」設計のため、本 PR では既存パイプラインへの組み込みは行わず、Phase 2 PR5 (`render.ts` 統合) で接続する
- 既存テスト (`render.test.ts` / `vectorize.test.ts` / `fabric.test.ts` 等) は全件パス

## 11. サイクル依存グラフ

```
Cycle 1 (polygon-offset.ts: clipper ラッパ)
   ↓
Cycle 2 (applyPullCompensation) ── 並列実装可能 ─→ Cycle 3 (applyPushCompensation overlap 検出)
                                                            ↓
                                                       Cycle 4 (applyPushCompensation offset 適用 + edge case)
```

- Cycle 1 は他すべての前提 (clipper 抽象化)
- Cycle 2 と Cycle 3 は独立で並列実装可能だが、コミット順は Cycle 1 → 2 → 3 → 4 を推奨 (レビュー容易性)
- Cycle 4 は Cycle 3 の Green コードをほぼ流用 + 数値精度・holes 方向・多重 neighbor のテスト追加に特化

## 12. 注意事項

- **clipper-lib の API クセ**:
  - `ClipperLib.ClipperOffset.Execute(solution, delta)` の `delta` は **scale 適用後の整数単位**。本 PR では `delta = deltaMm * scale` (scale 既定 1000) として渡す
  - `JoinType` は `jtMiter` を既定とする (角を保つ。`jtRound` だと角が丸まり Satin / Fill の端が変質する)
  - `EndType` は閉ポリゴン用に `etClosedPolygon` を必ず使う
  - 自己交差ポリゴン (imagetracerjs が稀に吐く) では空結果になることがある。`offsetShape` のフォールバックで吸収する
- **Polygon の向き (CW / CCW)**: clipper は向きに敏感だが、`ClipperOffset` 内部で正規化されるため呼び出し側は気にしなくてよい。既存パイプライン (`vectorize.ts` の出力) は向きを正規化していないが本 PR の機能には影響しない
- **scale の根拠**: clipper は内部で 64bit (JS では 53bit safe integer) 整数を使う。`100mm × 1000 = 100,000` なので 53bit (≒9×10¹⁵) 安全圏。`200mm × 200mm` の刺繍枠でも `200,000 × 200,000` で問題なし。スケールアップが必要なら `scale = 10000` (0.1µm) まで上げてよい
- **`pullCompPerSideMm` の本格対応**: 本 PR では `(left+right)/2` で均一化。Wilcom 互換の **rail 単位** per-side オフセットは Phase 2 PR2 以降で `applyPullCompensation` の satin 専用ブランチを切って実装する。Phase 2 計画書 4.3 と整合
- **`pushCompMm` の自動付与**: 本 PR は `obj.props.pushCompMm` を入力としてのみ使う。`fabric.defaultPushCompMm` から自動付与するのは `build-objects.ts` / Phase 2 PR5 の責務とする
- **同色 object の重なり**: Phase 2 計画書 5.2 の通り本 PR では除外。同色重なりは Phase 3 で branching と統合
- **`polygonsOverlap` の精度**: 本 PR では outer のみで判定。Donut neighbor の hole 内に obj が完全に含まれているケースは「重なりなし」と判定される (実用上問題ないが、Phase 4 で hole 内包判定を追加する余地あり)
- **既存テストへの非侵入**: 本 PR で追加するファイルは既存パイプラインから呼ばれないため、`render.test.ts` の挙動は変わらない。万一既存テストが落ちたら `polygon-offset.ts` の import 副作用 (例: clipper の global 汚染) を疑う

