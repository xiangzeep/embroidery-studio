# Phase 4 PR2: Satin 2-rail — TDD 実装計画書

## 1. 概要

Phase 4 PR2 では `src/lib/pipeline/satin.ts` を新規作成し、業務ソフト相当の **2-rail satin レンダラ** を実装する。
既存 `satinStitches` (`stitch.ts:384-422`) は PCA 単一長軸方向にスキャンラインを引くだけで、C/S/円弧型の satin で「角の薄い部分で糸が浮く / 厚い部分で糸が潰れる」欠点があった。
本 PR では shape の外形 polyline から **2 本の長辺 rail (left/right)** を抽出 (`extractRails`)、両 rail を arc-length 同期で等分割して `left(t_i) → right(t_i)` のジグザグを出力 (`renderSatin2Rail`) する純関数を導入する。
出力ピッチは「左 rail と右 rail の **中点曲線**」上で `densityMm` を満たすよう調整し、曲面でも針密度が均一になる。
本 PR の範囲は Phase 4 計画書「9. 実装ステップ」のステップ **4.1 / 4.2 のみ**。`brickSplit` (4.3) と renderer 統合 (ステップ 5) は **Phase 4 PR3 (Auto Split)** の範囲となるため、既存 `satinStitches` の置き換えは行わず orchestration 層への影響をゼロに抑える。

## 2. 依存関係

- **完了済み前提**: Phase 1 (PR1-PR5), Phase 2 (PR1-PR4), Phase 3 (PR1-PR3), **Phase 4 PR1** (tatami brick fill) すべて完了
- **型依存**: `src/lib/pipeline/types.ts` の `Shape`, `Polygon`, `Point2D`
- **本 PR でローカル定義する型**: `SatinRails = { left: Point[]; right: Point[] }` を `satin.ts` で export
- **後続依存**:
  - Phase 4 PR3 (auto split): 本 PR で導入する `renderSatin2Rail` の出力に対して `brickSplit` を適用する。本 PR 完了が前提
  - Phase 4 ステップ 5 (renderer 差し替え): PR3 完了後に別 PR で対応 (本 PR ではスコープ外)
- **既存 `satinStitches` の扱い**: 本 PR では **置き換えない / 削除しない**。renderer は引き続き `satinStitches` を呼び続けるため、既存 satin 関連テストは不変

## 3. 影響ファイル

### 新規
- `src/lib/pipeline/satin.ts` — `SatinRails` 型, `extractRails(shape)`, `renderSatin2Rail(rails, densityMm, maxStitchMm)` を export。純関数。
- `src/lib/pipeline/__tests__/satin.test.ts` — vitest で Cycle 1-5 のテストを格納

### 編集
- なし (本 PR では renderer 差し替えを行わない)

### 参照のみ
- `src/lib/pipeline/types.ts`
- `src/lib/pipeline/stitch.ts` (既存 `satinStitches` の挙動とコントラストを確認する目的のみ)
- `src/lib/pipeline/__tests__/stitch.test.ts` (既存ケース全件パスを維持)

## 4. テスト環境

- フレームワーク: **vitest 4.1.6**
- 実行コマンド: `npm test` (= `vitest run`)
- テストファイル配置: `src/lib/pipeline/__tests__/<module>.test.ts`
- import 規約: `import { describe, it, expect } from "vitest";`
- 既存パターン: `stitch.test.ts` / `fill.test.ts` 同様、public export を直接 import してテスト

## 5. インターフェース設計

```ts
// src/lib/pipeline/satin.ts
import type { Shape } from "./types";

type Point = [number, number];

/**
 * 2-rail satin の左右レール。
 * - left, right はそれぞれ start → end の順に並んだ polyline (頂点列)
 * - left[0] ≒ right[0] ≒ shape の片方の端 (start)
 * - left[len-1] ≒ right[len-1] ≒ もう片方の端 (end)
 * - 頂点数は left と right で揃わなくてもよい (arc-length で同期するため)
 */
export type SatinRails = {
  left: Point[];
  right: Point[];
};

/**
 * shape の外形から 2 本の長辺 rail を抽出する。
 *
 * アルゴリズム (Phase 4 計画書 §3.2):
 * 1. shape.outer を polyline 化 (閉じた重複点があれば除去)
 * 2. 凸包の長辺方向を主軸とする
 *    - 凸包の全エッジについて長さを測り、最長エッジの単位ベクトルを主軸とする
 *    - (PCA は angle-bisector で歪む C 字に弱いので凸包長辺を採用)
 * 3. outer の各頂点を主軸方向に射影し、最小投影頂点 = start, 最大投影頂点 = end
 * 4. outer を周回向きで巡回し、start → end の経路を 2 通り (右回り / 左回り) に分解
 * 5. 主軸の左手側の経路を `left`, 右手側の経路を `right` として返す
 *
 * 純関数: 同一 shape に対して常に同じ rails を返す。
 */
export function extractRails(shape: Shape): SatinRails;

/**
 * 2-rail を arc-length 同期で等分割し、ジグザグ satin 縫い目を生成する。
 *
 * アルゴリズム (Phase 4 計画書 §3.2):
 * 1. left, right それぞれの累積 arc-length を計算
 * 2. left の総長 L_left, right の総長 L_right から「中点曲線の総長」 L_mid を推定
 *    (簡易版: L_mid ≒ (L_left + L_right) / 2)
 * 3. ステップ数 N = max(2, ceil(L_mid / densityMm))
 * 4. i = 0..N で t_i = i / N
 * 5. 各 t_i で left(t_i), right(t_i) を arc-length parameterization で計算
 * 6. i が偶数なら [left(t_i), right(t_i)], 奇数なら [right(t_i), left(t_i)] を出力 (ジグザグ)
 *
 * 注意: `maxStitchMm` は本 PR では受け取るだけで使用しない。
 * 横幅 (rail 間) が `maxStitchMm` を超えた場合の brick split は Phase 4 PR3 で実装する。
 * シグネチャに含めることで後続 PR の差分を局所化する。
 *
 * 純関数: 同一入力で同一出力。
 */
export function renderSatin2Rail(
  rails: SatinRails,
  densityMm: number,
  maxStitchMm: number,
): Point[];
```

### 5.1 arc-length parameterization ヘルパ

`renderSatin2Rail` の内部で `sampleAt(polyline, t): Point` (`t ∈ [0, 1]` を arc-length 比で対応する点に変換) が必要。Cycle 4 の Refactor で `arcLengthSample` という共通ヘルパに切り出す。

```ts
// 内部関数 (export しない)
function cumulativeLengths(poly: Point[]): { lens: number[]; total: number };
function arcLengthSample(poly: Point[], cum: number[], total: number, t: number): Point;
```

## 6. TDD サイクル

### Cycle 1: モジュール雛形 + 直線 satin の extractRails

#### Red

```ts
// src/lib/pipeline/__tests__/satin.test.ts
import { describe, it, expect } from "vitest";
import { extractRails } from "../satin";
import type { Shape } from "../types";

describe("extractRails — straight satin", () => {
  it("アスペクト比 8 の長矩形で 2 本の平行 rail を返す", () => {
    // 80mm x 10mm の矩形 → 主軸は x 方向
    const shape: Shape = {
      outer: [
        [0, 0],
        [80, 0],
        [80, 10],
        [0, 10],
      ],
      holes: [],
    };
    const rails = extractRails(shape);

    // left/right rail はそれぞれ 2 点以上 (短辺 2 頂点 = start + end)
    expect(rails.left.length).toBeGreaterThanOrEqual(2);
    expect(rails.right.length).toBeGreaterThanOrEqual(2);

    // start (rail[0]) は x ≒ 0 側、end (rail[last]) は x ≒ 80 側
    expect(rails.left[0][0]).toBeCloseTo(0, 4);
    expect(rails.right[0][0]).toBeCloseTo(0, 4);
    expect(rails.left.at(-1)![0]).toBeCloseTo(80, 4);
    expect(rails.right.at(-1)![0]).toBeCloseTo(80, 4);

    // left rail (y=0 or y=10) と right rail (y=10 or y=0) が異なる y にある
    const leftY = rails.left[Math.floor(rails.left.length / 2)][1];
    const rightY = rails.right[Math.floor(rails.right.length / 2)][1];
    expect(Math.abs(leftY - rightY)).toBeCloseTo(10, 4);
  });
});
```

**失敗理由**: `../satin` モジュールおよび `extractRails` 関数が未作成のため import-time エラー。

#### Green

- 変更: `src/lib/pipeline/satin.ts` を新規作成
- 方針:
  1. `SatinRails` 型を export
  2. `extractRails` のスケルトン実装:
     - shape.outer から重複末尾点を除いた `pts` を作る
     - 凸包を求める (Andrew's monotone chain で十分; 自前実装または既存ヘルパ流用)
     - 凸包エッジを巡回して最長エッジの単位ベクトル `axis` を取る
     - `pts` を `axis` 方向に射影、最小射影 index = `startIdx`, 最大射影 index = `endIdx`
     - `pts` を `startIdx → endIdx` で右回り / 左回りに 2 分割
     - 主軸の **法線** (`axis` を 90° 反時計回り; `perp = [-axis[1], axis[0]]`) で 2 分割の平均射影符号を見て、`+` 側を `left`, `-` 側を `right`

#### Refactor

不要 (構造改善は Cycle 4 でまとめて行う)。

---

### Cycle 2: C 字 satin で rail が内外に分かれる

#### Red

```ts
describe("extractRails — C-shaped satin", () => {
  it("C 字 satin で内側 rail と外側 rail に分かれる", () => {
    // 上向きに開いた C 字。中心 (40,40)、外半径 40、内半径 30、xy 平面
    // 角度 θ ∈ [-150°, 150°] (= 300°) の弧を 36 等分してサンプリング
    const outerArc: [number, number][] = [];
    const innerArc: [number, number][] = [];
    const cx = 40,
      cy = 40,
      rOuter = 40,
      rInner = 30;
    const N = 36;
    const tStart = (-150 * Math.PI) / 180;
    const tEnd = (150 * Math.PI) / 180;
    for (let i = 0; i <= N; i++) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      outerArc.push([cx + rOuter * Math.cos(t), cy + rOuter * Math.sin(t)]);
    }
    for (let i = N; i >= 0; i--) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      innerArc.push([cx + rInner * Math.cos(t), cy + rInner * Math.sin(t)]);
    }
    const shape: Shape = {
      outer: [...outerArc, ...innerArc],
      holes: [],
    };
    const rails = extractRails(shape);

    // 各 rail の中央付近の点が中心 (40,40) からの距離で外側 / 内側に分かれる
    const leftMid = rails.left[Math.floor(rails.left.length / 2)];
    const rightMid = rails.right[Math.floor(rails.right.length / 2)];
    const distLeft = Math.hypot(leftMid[0] - cx, leftMid[1] - cy);
    const distRight = Math.hypot(rightMid[0] - cx, rightMid[1] - cy);

    // 外側 rail は r ≒ 40、内側 rail は r ≒ 30 (許容誤差 ±2mm)
    const radii = [distLeft, distRight].sort((a, b) => a - b);
    expect(radii[0]).toBeGreaterThan(28); // 内側
    expect(radii[0]).toBeLessThan(32);
    expect(radii[1]).toBeGreaterThan(38); // 外側
    expect(radii[1]).toBeLessThan(42);
  });
});
```

**失敗理由**: Cycle 1 の実装で「`pts` を `startIdx → endIdx` で右回り / 左回りに 2 分割」のロジックが正しく書かれていれば、C 字でも外側 / 内側に分かれるはず。ただし
- 凸包長辺の選び方が不適切 (たとえば C 字の口の弦が凸包長辺になり、start / end が口の両端に来てしまう) と、left/right が外形を半周ずつ分けられず破綻
- 主軸法線で `+`/`-` 側を分ける処理が「rail 全体の平均」でなく「単点」で判定していると、C 字の途中で曲率が逆転する場合に left/right が混在

ため、Cycle 1 の単純実装では失敗する想定。

#### Green

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  1. 凸包長辺の選び方を補強: 「凸包の最長エッジ」ではなく「凸包頂点の全 pair 距離で最大」 (diameter) を採用するか、あるいは「`pts` を主軸射影した結果の最大スパン」を最大化する軸を探す
  2. left/right 判定を **rail 全体の主軸法線投影の平均** に変更。`leftPath` 側の平均 `s = average(perp · (p - center))` が `rightPath` 側より大きければ left/right 確定
  3. C 字でも口の両端が `startIdx`/`endIdx` に正しく取れていることを assert (デバッグ用 console.log は最終的に削除)

#### Refactor

- 凸包計算 (`convexHull`) と最長軸抽出 (`longestAxis`) を internal ヘルパに分離
- left/right 判定ヘルパ `assignSides(pathA, pathB, axis): { left, right }` を切り出す

---

### Cycle 3: renderSatin2Rail のジグザグ出力

#### Red

```ts
import { extractRails, renderSatin2Rail } from "../satin";

describe("renderSatin2Rail — zigzag output", () => {
  it("直線 satin で出力が left→right→left→right のジグザグになる", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [40, 0],
        [40, 5],
        [0, 5],
      ],
      holes: [],
    };
    const rails = extractRails(shape);
    const stitches = renderSatin2Rail(rails, 1.0, 7.0);

    // 中点曲線の総長 ≒ 40mm、density 1mm → ステップ数 ≒ 40、出力点 ≒ 41
    expect(stitches.length).toBeGreaterThanOrEqual(40);
    expect(stitches.length).toBeLessThanOrEqual(42);

    // 隣接ステッチが必ず別 rail 側にいる: y 座標が 0 と 5 を交互
    const ys = stitches.map((p) => Math.round(p[1]));
    for (let i = 0; i < ys.length - 1; i++) {
      expect(Math.abs(ys[i] - ys[i + 1])).toBe(5);
    }

    // 偶数 index と奇数 index がそれぞれ同じ rail に張り付く
    const evenYs = new Set(stitches.filter((_, i) => i % 2 === 0).map((p) => Math.round(p[1])));
    const oddYs = new Set(stitches.filter((_, i) => i % 2 === 1).map((p) => Math.round(p[1])));
    expect(evenYs.size).toBe(1);
    expect(oddYs.size).toBe(1);
  });
});
```

**失敗理由**: `renderSatin2Rail` が未実装 (Cycle 1-2 では `extractRails` のみ実装) のため import-time エラーまたは関数未定義エラー。

#### Green

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  1. `cumulativeLengths(poly)` を実装: 累積 arc-length 配列と総長を返す
  2. `arcLengthSample(poly, cum, total, t)`: `t ∈ [0,1]` を `total * t` の弧長位置に対応する点に変換 (累積配列を二分探索 → 線形補間)
  3. `renderSatin2Rail` 本体:
     ```ts
     const cumL = cumulativeLengths(rails.left);
     const cumR = cumulativeLengths(rails.right);
     const midTotal = (cumL.total + cumR.total) / 2;
     const N = Math.max(2, Math.ceil(midTotal / densityMm));
     const out: Point[] = [];
     for (let i = 0; i <= N; i++) {
       const t = i / N;
       const pl = arcLengthSample(rails.left, cumL.lens, cumL.total, t);
       const pr = arcLengthSample(rails.right, cumR.lens, cumR.total, t);
       if (i % 2 === 0) out.push(pl, pr);
       else out.push(pr, pl);
     }
     return out;
     ```
  4. `maxStitchMm` は引数として受け取るのみで未使用 (本 PR のスコープ外)。JSDoc に明記

#### Refactor

- `cumulativeLengths` / `arcLengthSample` を module 内 internal ヘルパとして整理
- ジグザグ生成ロジックを `zigzagAlongRails` ヘルパに分離

---

### Cycle 4: 中点曲線上のピッチが densityMm 近傍 (±5%)

#### Red

```ts
describe("renderSatin2Rail — midline pitch", () => {
  it("中点曲線上の隣接 stitch ピッチが densityMm の ±5% に収まる (直線)", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [60, 0],
        [60, 6],
        [0, 6],
      ],
      holes: [],
    };
    const rails = extractRails(shape);
    const density = 1.5;
    const stitches = renderSatin2Rail(rails, density, 7.0);

    // 偶数 index は left 側、奇数 index は right 側 (Cycle 3 で確認済み)。
    // それぞれの「同 rail 内の隣接 stitch」の中点 (= 中点曲線上の点) の間隔が
    // densityMm に近いことを確認する。
    const midPoints: [number, number][] = [];
    for (let i = 0; i < stitches.length - 1; i += 2) {
      const a = stitches[i];
      const b = stitches[i + 1];
      midPoints.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    expect(midPoints.length).toBeGreaterThan(10);

    const pitches: number[] = [];
    for (let i = 1; i < midPoints.length; i++) {
      const dx = midPoints[i][0] - midPoints[i - 1][0];
      const dy = midPoints[i][1] - midPoints[i - 1][1];
      pitches.push(Math.hypot(dx, dy));
    }
    const avg = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    expect(avg).toBeGreaterThan(density * 0.95);
    expect(avg).toBeLessThan(density * 1.05);
  });

  it("C 字 satin でも中点曲線ピッチが densityMm の ±10% (曲率の許容範囲拡大)", () => {
    // C 字 (簡易版)
    const cx = 30,
      cy = 30,
      rOuter = 30,
      rInner = 22;
    const outerArc: [number, number][] = [];
    const innerArc: [number, number][] = [];
    const N = 48;
    const tStart = (-120 * Math.PI) / 180;
    const tEnd = (120 * Math.PI) / 180;
    for (let i = 0; i <= N; i++) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      outerArc.push([cx + rOuter * Math.cos(t), cy + rOuter * Math.sin(t)]);
    }
    for (let i = N; i >= 0; i--) {
      const t = tStart + ((tEnd - tStart) * i) / N;
      innerArc.push([cx + rInner * Math.cos(t), cy + rInner * Math.sin(t)]);
    }
    const shape: Shape = {
      outer: [...outerArc, ...innerArc],
      holes: [],
    };
    const rails = extractRails(shape);
    const density = 1.2;
    const stitches = renderSatin2Rail(rails, density, 7.0);

    const midPoints: [number, number][] = [];
    for (let i = 0; i < stitches.length - 1; i += 2) {
      const a = stitches[i];
      const b = stitches[i + 1];
      midPoints.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    const pitches: number[] = [];
    for (let i = 1; i < midPoints.length; i++) {
      const dx = midPoints[i][0] - midPoints[i - 1][0];
      const dy = midPoints[i][1] - midPoints[i - 1][1];
      pitches.push(Math.hypot(dx, dy));
    }
    const avg = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    expect(avg).toBeGreaterThan(density * 0.9);
    expect(avg).toBeLessThan(density * 1.1);
  });
});
```

**失敗理由**:
- Cycle 3 の `midTotal = (L_left + L_right) / 2` だけでステップ数 `N` を決めると、
  - 直線 satin (L_left = L_right) では中点曲線も同じ長さなので問題ないが
  - C 字 (rail 長が大きく異なる、または中点曲線の実際の長さが平均と乖離する) では誤差が出る可能性
- 等分割の `t = i/N` を rail 個別の arc-length に直接適用しているため、left rail と right rail で t に対応する位置の中点が中点曲線上で等間隔にならないケースが発生し得る

直線テスト (Case 1) は通る想定。曲線テスト (Case 2) で `±10%` をクリアできるよう Cycle 4 で精度確認を入れる。

#### Green

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  - 中点曲線の総長を実測する: `t = 0, 1/M, 2/M, ..., 1` の細かいサンプル (M = 200 程度) で `mid(t) = (left(t) + right(t)) / 2` を打ち、隣接距離を合算 → `L_mid_actual`
  - `N = max(2, ceil(L_mid_actual / densityMm))`
  - これにより C 字でも中点曲線上で densityMm 近傍のピッチが実現
  - 細サンプル数 `M` は内部定数 (例: `MIDLINE_SAMPLE_COUNT = 200`) として固定

#### Refactor

- `estimateMidlineLength(rails, samples = 200): number` ヘルパとして抽出
- `arcLengthSample` の二分探索を unit test しやすい形で分離

---

### Cycle 5: 純関数性と SatinRails の構造正規化

#### Red

```ts
import type { SatinRails } from "../satin";

describe("satin — purity & structure", () => {
  it("extractRails は同一 shape に対して同一結果を返す (純関数)", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [50, 0],
        [50, 8],
        [0, 8],
      ],
      holes: [],
    };
    const r1 = extractRails(shape);
    const r2 = extractRails(shape);
    expect(r1.left).toEqual(r2.left);
    expect(r1.right).toEqual(r2.right);
  });

  it("extractRails は入力 shape を変更しない", () => {
    const outer: [number, number][] = [
      [0, 0],
      [50, 0],
      [50, 8],
      [0, 8],
    ];
    const shape: Shape = { outer, holes: [] };
    const before = JSON.stringify(outer);
    extractRails(shape);
    expect(JSON.stringify(outer)).toBe(before);
  });

  it("renderSatin2Rail は入力 rails を変更しない", () => {
    const rails: SatinRails = {
      left: [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      right: [
        [0, 5],
        [10, 5],
        [20, 5],
      ],
    };
    const beforeL = JSON.stringify(rails.left);
    const beforeR = JSON.stringify(rails.right);
    renderSatin2Rail(rails, 1, 7);
    expect(JSON.stringify(rails.left)).toBe(beforeL);
    expect(JSON.stringify(rails.right)).toBe(beforeR);
  });

  it("退化 shape (3 点以下) で extractRails が破綻せず empty rails を返す", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [1, 0],
        [0.5, 0.5],
      ],
      holes: [],
    };
    const rails = extractRails(shape);
    // 3 点だと start/end を取っても rail がほぼ点になる。
    // クラッシュせず、left/right が定義された配列 (length >= 1) を返すこと
    expect(Array.isArray(rails.left)).toBe(true);
    expect(Array.isArray(rails.right)).toBe(true);
  });
});
```

**失敗理由**: Cycle 1-4 までで純関数性は概ね守られている想定だが、
- 凸包計算が `pts.sort()` で in-place sort していると入力 polyline を破壊し、`extractRails` が入力を変更してしまう
- C 字判定で `slice` や `concat` を使わずに `pts.splice()` していると同様の問題
- 退化 shape (3 点 / 全点同一直線上) で凸包長辺 / start-end が決まらず例外を吐く可能性

これらを潰すサイクル。

#### Green

- 変更: `src/lib/pipeline/satin.ts`
- 方針:
  - 入力 polyline は必ず `.slice()` でコピーしてから処理
  - 凸包計算は新しい配列に対して行う
  - 退化 shape (`pts.length < 3` または凸包の最長辺が 0) の場合は `{ left: pts.slice(), right: pts.slice() }` を返すフォールバック

#### Refactor

- `satin.ts` 冒頭の JSDoc に **「純関数。入力 Shape / SatinRails を変更しない」** を明記
- 内部ヘルパ (`convexHull`, `longestAxis`, `assignSides`, `cumulativeLengths`, `arcLengthSample`, `estimateMidlineLength`) を一箇所にまとめて整理
- module export 列を一覧コメントで整理 (将来 PR3 で `brickSplit` を追加する位置を明示)

---

## 7. サイクル依存グラフ

```
Cycle 1 (extractRails 雛形 + 直線 satin)
   ↓
Cycle 2 (extractRails の C 字対応 + left/right 判定強化)
   ↓
Cycle 3 (renderSatin2Rail のジグザグ + arc-length 同期)
   ↓
Cycle 4 (中点曲線実測 → densityMm 精度保証)
   ↓
Cycle 5 (純関数性 + 退化 shape のフォールバック)
```

## 8. 回帰防止

- **既存 vitest スイート全件 green** (`npm test`)
  - 特に `stitch.test.ts` の satin 関連ケース (8 件程度):
    - `離れた 2 本の satin 棒の間に satin 縫い目が現れない`
    - `satinMaxWidthMm` を変えた generateStitches integration ケース群
  - これらは **renderer が引き続き既存 `satinStitches` を呼ぶ** ことで全件パスする。本 PR では `satinStitches` を一切変更しない
- **Phase 4 PR1 (tatami brick fill) のテスト**:
  - `fill.test.ts` 全件パス
- **品質指標**: `npm run lint` も green
- **renderer 経由のテストは不変**: 本 PR では `satin.ts` を public モジュールとして追加するのみ。`render.ts` / `stitch.ts` の satin レンダリング経路はそのまま既存 `satinStitches` を呼び続けるため、`generateStitches` 経由の satin テストは座標も含めて bit-equal で維持される

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/satin.ts` が新規作成され、`SatinRails` 型, `extractRails`, `renderSatin2Rail` が export されている
- [ ] 直線 satin (アスペクト比 8) で `extractRails` が 2 本の平行 rail を返す (Cycle 1)
- [ ] C 字 satin で rail が外側 / 内側に分かれる (Cycle 2; 各 rail 中央点の中心からの距離が外半径 / 内半径に ±2mm で一致)
- [ ] `renderSatin2Rail` の出力が `left → right → left → right` のジグザグになる (Cycle 3; 偶数 index と奇数 index がそれぞれ同 rail に張り付く)
- [ ] 中点曲線上の隣接 stitch ピッチが直線 satin で `densityMm ±5%`、C 字 satin で `densityMm ±10%` の範囲に収まる (Cycle 4)
- [ ] `extractRails` / `renderSatin2Rail` が純関数 (同一入力で同一出力、入力非破壊) であることをテストで確認 (Cycle 5)
- [ ] 退化 shape (3 点) で `extractRails` がクラッシュせず empty 相当の rails を返す (Cycle 5)
- [ ] 既存 `npm test` 全件 green (renderer は既存 `satinStitches` を呼び続けるため satin 関連既存テストは座標含めて不変)
- [ ] `npm run lint` green
- [ ] `satin.ts` 冒頭の JSDoc に「純関数。入力非破壊」と「本 PR のスコープは 4.1/4.2、brickSplit は PR3」が明記されている

## 10. コミット粒度

TDD サイクル単位で 1 コミット (Red+Green+Refactor を 1 コミットにまとめる方針)。計 5 コミット予定。

1. `feat(satin): introduce extractRails for straight satin (phase 4 pr2)` (Cycle 1)
2. `feat(satin): support C-shaped rails via convex-hull long axis` (Cycle 2)
3. `feat(satin): add renderSatin2Rail with arc-length zigzag` (Cycle 3)
4. `fix(satin): measure midline length for density-accurate pitch` (Cycle 4)
5. `refactor(satin): enforce purity and handle degenerate shapes` (Cycle 5)

各コミット時点で `npm test` が green。

## 11. 想定 PR タイトル

`feat(pipeline): add 2-rail satin renderer (phase 4 pr2)`

## 12. 注意事項・将来の整理 (スコープ外)

- **既存 `satinStitches` の置き換えは本 PR では行わない**。renderer 統合は Phase 4 PR3 (auto split = `brickSplit`) 完了後に別 PR で対応する
- **`brickSplit`** (Phase 4 計画書 §4.2、ステップ 4.3) は Phase 4 PR3 で実装。本 PR で `renderSatin2Rail` の引数に `maxStitchMm` を含めているのは PR3 の差分を局所化するための前倒し
- **medial-axis ベース主軸決定** (Phase 4 計画書 §3.3) は本 PR ではスコープ外。凸包長辺で十分追従できない極端な S 字 / 渦巻きは Phase 4 計画書 §3.3 の medial-axis 化 (Phase 4 PR4 と並走) で対応する
- **凸包計算ライブラリ依存**: 自前実装 (Andrew's monotone chain、20 行程度) で済ませる。外部依存は追加しない
- **アスペクト比閾値の引き下げ** (Phase 4 計画書 §3.4 の `aspectRatio > 2.5`) は renderer 統合 PR (PR3 完了後) で別途扱う
