# Phase 3 PR1: 接触判定 + Branch grouping — TDD 実装計画

## 1. 概要

Phase 3 計画書「8. 実装ステップ」のステップ 1〜3 に該当する PR。`src/lib/pipeline/pathing.ts` を新規作成し、後段の `optimizeOrder` / `chooseEntryExit` / `routeBranchGroup` から呼ばれる **接触判定** と **Branch グルーピング** の 2 つの純関数を提供する。

- `shapesTouch(a: Shape, b: Shape, epsilon = 0.5): boolean`: 2 つの `Shape` が距離 `epsilon` 以内で接触 / 重なっているかを返す。バウンディングボックスの重なりで高速に枝刈りした後、`a.outer` と `b.outer` の各線分間の最小距離を計算して `epsilon` 未満なら `true`。Phase 3 計画書 4.1 のコードコメントに従い「bbox overlap かつ線分距離 < epsilon」を意味論とする。`holes` は本 PR では考慮しない (実用上、外形が接触していれば branch group として纏める)。
- `findBranches(objects: EmbroideryObject[]): BranchGroup[]`: object 配列を Union-Find で接触グループ化し、`BranchGroup[]` を返す。**同色** (`colorIndex` が等しい) の object 同士のみが纏まる仕様で、色をまたいだ branching は禁止 (Phase 3 計画書 4.1 Step A〜B の前提に従う)。1 個だけの孤立 object も 1 個の `BranchGroup` として返す。返す配列は決定的な順序 (各 group の最小入力 index 昇順) を持つ。

両関数は **純粋関数** であり、入力 `objects` / `Shape` を mutate しない。後続 PR (`chooseEntryExit` / `optimizeOrder`) は本 PR の `findBranches` 出力を入口にしてルート計算を行う。

## 2. 依存関係

- **Phase 1 全体 (PR1〜PR5) がマージ済み**:
  - PR1: `EmbroideryObject` / `Shape` / `Polygon` / `Point2D` 型
  - PR1: `EmbroideryObject.id` / `colorIndex` / `shape: Shape` フィールド
  - PR3: `buildObjects` が `EmbroideryObject[]` を返す
  - PR4: `render` 系が `EmbroideryObject` を入力に取る
- **Phase 2 全体マージ済み**: 本 PR のロジックは Phase 2 のステッチ生成や補正に直接は依存しないが、`optimizeOrder` が Phase 2 完了後の object モデルに対して走るため、マージ順としては **Phase 2 完了後** とする。
- **本 PR の後続**: Phase 3 PR2 (`chooseEntryExit`)、PR3 (`optimizeOrder` 統合) は本 PR の `findBranches` / `BranchGroup` 型を直接利用する。
- 新規依存パッケージ: **なし**。`shapesTouch` の線分距離計算は本ファイル内に閉じた純粋関数として実装する (12 行程度)。

## 3. 影響ファイル

### 新規
- `src/lib/pipeline/pathing.ts`
  - `shapesTouch(a, b, epsilon?) -> boolean`
  - `findBranches(objects) -> BranchGroup[]`
  - 内部ヘルパ (export しない):
    - `polygonBBox(poly: Polygon) -> { minX; minY; maxX; maxY }`
    - `bboxesOverlap(a, b, epsilon) -> boolean`
    - `segmentDistance(p1, p2, p3, p4) -> number` (2 線分間の最小距離)
    - `pointSegmentDistance(p, a, b) -> number`
    - `UnionFind` クラス (`makeSet` / `find` / `union`)
- `src/lib/pipeline/__tests__/pathing.test.ts`

### 編集
- `src/lib/pipeline/types.ts`
  - `BranchGroup` 型を追加:
    ```ts
    /**
     * 接触 / 重なりで 1 つの travel run チェーンに纏められる object 群。
     * - objectIds: グループに属する EmbroideryObject の id (入力順を保持)
     * - colorIndex: グループ共通の色 index (異色は別 group に分離されるため一意)
     */
    export type BranchGroup = {
      objectIds: string[];
      colorIndex: number;
    };
    ```
  - 既存の `StitchKind` / `Stitch` / `Shape` 等は触らない。

### 触らない (回帰確認のみ)
- `src/lib/pipeline/__tests__/stitch.test.ts`
- `src/lib/pipeline/__tests__/vectorize.test.ts`
- `src/lib/pipeline/{stitch,vectorize,writer,compose,render,compensation,underlay,...}.ts`
- `compose.ts` / `render.ts` への呼び出し追加は **Phase 3 PR3 以降**。本 PR の `pathing.ts` は誰からも import されない (テスト経由のみ) 状態でマージする。

## 4. テスト環境

- フレームワーク: **vitest** (`vitest@^4.1.6`、`package.json` 確認済み)
- 実行コマンド:
  - 全体: `npm test` (= `vitest run`)
  - 単体: `npx vitest run src/lib/pipeline/__tests__/pathing.test.ts`
- テストファイル配置: `src/lib/pipeline/__tests__/*.test.ts` (既存規約)
- テストランタイム: `vitest.config.ts` で `environment: "node"`、`include: ["src/**/*.test.ts", "src/**/*.test.tsx"]`
- モック: 本 PR の関数は外部依存ゼロのため、`vi.mock` は使わない。

## 5. インターフェース設計

### 5.1 公開 API (`pathing.ts` の `export`)

```ts
import type { Shape, EmbroideryObject, BranchGroup } from "./types";

/**
 * 2 つの Shape が epsilon (px) 以内で接触 / 重なっているか。
 * 1. a/b の外形 bbox が epsilon を含めて overlap しなければ即 false
 * 2. a.outer のいずれかの線分と b.outer のいずれかの線分の最小距離 < epsilon なら true
 *
 * holes は Phase 3 PR1 では無視する。純関数。a/b を mutate しない。
 */
export function shapesTouch(a: Shape, b: Shape, epsilon?: number): boolean;

/**
 * EmbroideryObject 配列を「接触している同色 object」ごとに Union-Find でグルーピングする。
 *
 * - 同じ colorIndex かつ shapesTouch(a.shape, b.shape) === true の pair を union
 * - 異色 object 間では絶対に union しない
 * - 孤立 object も 1 要素の BranchGroup として返す
 * - 返す BranchGroup[] の順序は「各 group の最小入力 index 昇順」で安定
 * - 各 BranchGroup.objectIds 内も入力 objects の出現順を保持
 *
 * 純関数。objects を mutate しない。
 */
export function findBranches(objects: EmbroideryObject[]): BranchGroup[];
```

### 5.2 BranchGroup 型 (`types.ts`)

```ts
export type BranchGroup = {
  /** グループに属する EmbroideryObject の id。入力順を保持する。 */
  objectIds: string[];
  /** グループ共通の色 index。異色は必ず別 group になるので一意。 */
  colorIndex: number;
};
```

### 5.3 内部実装方針

- **`polygonBBox(poly)`**: 単一 pass で min/max を求める O(n)。
- **`bboxesOverlap(a, b, eps)`**: `!(a.maxX + eps < b.minX || b.maxX + eps < a.minX || a.maxY + eps < b.minY || b.maxY + eps < a.minY)`。
- **`pointSegmentDistance(p, a, b)`**: 線分 ab 上で p に最も近い点までの距離 (パラメータ t を [0,1] にクランプ)。
- **`segmentDistance(p1, p2, p3, p4)`**: 2 線分が交差すれば 0、それ以外は 4 つの端点-線分距離の最小値。交差判定は外積符号で行う標準実装。
- **`shapesTouch` 本体**:
  ```ts
  const bbA = polygonBBox(a.outer);
  const bbB = polygonBBox(b.outer);
  if (!bboxesOverlap(bbA, bbB, epsilon)) return false;
  for (let i = 0; i < a.outer.length; i++) {
    const pA = a.outer[i];
    const qA = a.outer[(i + 1) % a.outer.length];
    for (let j = 0; j < b.outer.length; j++) {
      const pB = b.outer[j];
      const qB = b.outer[(j + 1) % b.outer.length];
      if (segmentDistance(pA, qA, pB, qB) < epsilon) return true;
    }
  }
  return false;
  ```
- **`UnionFind`**: path compression + union by rank で `find` / `union` を提供する標準実装。
- **`findBranches` 本体**:
  1. `UnionFind(objects.length)` を作る
  2. 全 pair (i, j) (i < j) を走査: `colorIndex` が異なればスキップ、`shapesTouch` が `true` なら `uf.union(i, j)`
  3. 各 object を root ごとに集約 → `Map<rootIndex, number[]>`
  4. 各 group を `BranchGroup` に変換し、`objectIds` には入力 index 昇順で `objects[k].id` を詰める
  5. group 全体を「最小入力 index の昇順」でソートして返す

## 6. TDD サイクル

### Cycle 1: `pathing.ts` の空スケルトン + `BranchGroup` 型追加

#### Red
```ts
// src/lib/pipeline/__tests__/pathing.test.ts
import { describe, it, expect } from "vitest";
import { shapesTouch, findBranches } from "../pathing";
import type { BranchGroup } from "../types";

describe("pathing module skeleton", () => {
  it("exports shapesTouch function", () => {
    expect(typeof shapesTouch).toBe("function");
  });
  it("exports findBranches function", () => {
    expect(typeof findBranches).toBe("function");
  });
  it("BranchGroup type is structurally usable", () => {
    const g: BranchGroup = { objectIds: [], colorIndex: 0 };
    expect(g.objectIds).toEqual([]);
    expect(g.colorIndex).toBe(0);
  });
});
```
**失敗理由**: `../pathing` ファイル自体が存在しないため import エラー。`BranchGroup` 型も `types.ts` に存在しない。

#### Green
- `src/lib/pipeline/types.ts` 末尾に `BranchGroup` 型を追加。
- `src/lib/pipeline/pathing.ts` を新規作成:
  ```ts
  import type { Shape, EmbroideryObject, BranchGroup } from "./types";
  export function shapesTouch(_a: Shape, _b: Shape, _epsilon: number = 0.5): boolean {
    return false;
  }
  export function findBranches(_objects: EmbroideryObject[]): BranchGroup[] {
    return [];
  }
  ```

#### Refactor
- 不要 (スケルトンのみ)。

---

### Cycle 2: `shapesTouch` — bbox 非接触で `false`、bbox 一致で `true`

#### Red
```ts
describe("shapesTouch — bbox pruning", () => {
  it("bbox が大きく離れている 2 shape は false", () => {
    const a: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    const b: Shape = { outer: [[100, 100], [110, 100], [110, 110], [100, 110]], holes: [] };
    expect(shapesTouch(a, b)).toBe(false);
  });
  it("bbox が一致 + 線分も完全重複なら true", () => {
    const a: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    const b: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    expect(shapesTouch(a, b)).toBe(true);
  });
});
```
**失敗理由**: Cycle 1 の `shapesTouch` は常に `false` を返す。

#### Green
- `polygonBBox` / `bboxesOverlap` を追加し、`shapesTouch` を「bbox overlap → 即 true」の暫定実装に。

#### Refactor
- 不要。

---

### Cycle 3: `shapesTouch` — bbox 接触するが線分が交差しない → `false`

#### Red
```ts
describe("shapesTouch — segment distance", () => {
  it("C 字 a のくぼみ内に b があり最短距離 2px なので false", () => {
    const a: Shape = {
      outer: [[0, 0], [10, 0], [10, 2], [3, 2], [3, 8], [10, 8], [10, 10], [0, 10]],
      holes: [],
    };
    const b: Shape = {
      outer: [[5, 4], [8, 4], [8, 6], [5, 6]],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(false);
  });
});
```
**失敗理由**: Cycle 2 では bbox overlap で即 true を返してしまう。

#### Green
- `pointSegmentDistance` / `segmentDistance` を追加。
- `shapesTouch` を全線分 pair の距離計算に更新。

#### Refactor
- JSDoc 追加、ループ変数命名統一。

---

### Cycle 4: `shapesTouch` — 線分接触/重なり/epsilon 境界

#### Red
```ts
describe("shapesTouch — touching and overlapping", () => {
  it("辺を共有する 2 正方形 → true", () => {
    const a: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    const b: Shape = { outer: [[10, 0], [20, 0], [20, 10], [10, 10]], holes: [] };
    expect(shapesTouch(a, b)).toBe(true);
  });
  it("距離 0.4px (epsilon=0.5 以内) → true", () => {
    const a: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    const b: Shape = { outer: [[10.4, 0], [20, 0], [20, 10], [10.4, 10]], holes: [] };
    expect(shapesTouch(a, b)).toBe(true);
  });
  it("距離 0.6px (epsilon=0.5 を超える) → false", () => {
    const a: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    const b: Shape = { outer: [[10.6, 0], [20, 0], [20, 10], [10.6, 10]], holes: [] };
    expect(shapesTouch(a, b)).toBe(false);
  });
  it("epsilon を 1.0 に広げると距離 0.6px は true", () => {
    const a: Shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
    const b: Shape = { outer: [[10.6, 0], [20, 0], [20, 10], [10.6, 10]], holes: [] };
    expect(shapesTouch(a, b, 1.0)).toBe(true);
  });
});
```
**失敗理由**: bbox overlap での epsilon 考慮や、`<` 比較の境界処理に問題があれば失敗する。

#### Green
- `bboxesOverlap(a, b, eps)` の判定式が「bbox を epsilon だけ膨張させて overlap」になるよう統一。
- `segmentDistance` での比較を厳密 `<` に統一。

#### Refactor
- 交差判定の符号関数 `sign` を inline helper として切り出す。

---

### Cycle 5: `findBranches` — Union-Find 統合

#### Red
```ts
describe("findBranches", () => {
  function makeObj(id: string, colorIndex: number, outer: [number, number][]): EmbroideryObject {
    return {
      id, colorIndex, rgb: [0, 0, 0], order: 0, kind: "fill",
      shape: { outer, holes: [] }, props: { densityMm: 0.4, maxStitchMm: 4 },
    } as EmbroideryObject;
  }

  it("空配列 → 空配列", () => {
    expect(findBranches([])).toEqual([]);
  });

  it("3 つの同色 object が直線状に接触 → 1 group", () => {
    const a = makeObj("a", 0, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = makeObj("b", 0, [[10, 0], [20, 0], [20, 10], [10, 10]]);
    const c = makeObj("c", 0, [[20, 0], [30, 0], [30, 10], [20, 10]]);
    expect(findBranches([a, b, c])).toEqual([
      { objectIds: ["a", "b", "c"], colorIndex: 0 },
    ]);
  });

  it("色が異なる接触 object は別 group になる", () => {
    const a = makeObj("a", 0, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = makeObj("b", 1, [[10, 0], [20, 0], [20, 10], [10, 10]]);
    expect(findBranches([a, b])).toEqual([
      { objectIds: ["a"], colorIndex: 0 },
      { objectIds: ["b"], colorIndex: 1 },
    ]);
  });

  it("入力 objects を mutate しない (純関数)", () => {
    const a = makeObj("a", 0, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = makeObj("b", 0, [[10, 0], [20, 0], [20, 10], [10, 10]]);
    const snapshot = JSON.parse(JSON.stringify([a, b]));
    findBranches([a, b]);
    expect([a, b]).toEqual(snapshot);
  });
});
```
**失敗理由**: Cycle 1 で `findBranches` は常に `[]` を返す。

#### Green
- `UnionFind` クラスを追加。
- `findBranches` を 5.3 節の通り実装。

#### Refactor
- 全 pair 走査 (O(N²)) は許容範囲。bbox インデックス置換は JSDoc コメントで言及するに留める。

---

## 7. サイクル依存グラフ

```
Cycle 1 → Cycle 2 → Cycle 3 → Cycle 4 → Cycle 5
```

## 8. 回帰防止

- `npm test` で `stitch.test.ts` / `vectorize.test.ts` を含む既存スイートが全件 pass
- `BranchGroup` 型追加は破壊変更なし
- `pathing.ts` は本 PR 内では誰からも import されない (テスト経由のみ)
- `npx tsc --noEmit` で型エラーゼロ
- 入力 `objects` / `Shape` の mutation 検証 (Cycle 5)

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/pathing.ts` が新規作成され、`shapesTouch` と `findBranches` が export されている
- [ ] `src/lib/pipeline/types.ts` に `BranchGroup` 型が追加
- [ ] `shapesTouch` が bbox 先行 + 線分距離 < epsilon の意味論で実装
- [ ] `findBranches` が Union-Find で同色接触 object をグループ化
- [ ] 異色の接触 object は別の `BranchGroup` に分離
- [ ] 孤立 object は 1 要素の `BranchGroup` として返される
- [ ] 出力 `BranchGroup[]` の順序が「最小入力 index 昇順」で決定的
- [ ] 入力を mutate しない (純関数)
- [ ] `npm test` 全件 pass
- [ ] `npx tsc --noEmit` エラーゼロ
- [ ] `npm run lint` clean

## 10. コミット粒度

1. `test(pathing): add skeleton tests and BranchGroup type`
2. `feat(pathing): add bbox-based shapesTouch pruning`
3. `feat(pathing): add segment-distance check to shapesTouch`
4. `feat(pathing): handle touching/overlapping shapes with epsilon boundary`
5. `feat(pathing): group touching same-color objects with union-find`

## 11. 想定 PR タイトル

```
feat(pipeline): add shape touch detection and branch grouping (phase 3 pr1)
```

## 12. 注意事項

- `EmbroideryObject` のフィールド参照は `id` / `colorIndex` / `shape` の 3 つのみに限定 (将来の Phase 1 リファクタへの追従性確保)
- `holes` は本 PR の `shapesTouch` で扱わない (外形のみで十分)
- `epsilon` の単位は px。mm 換算は呼び出し側 (Phase 3 PR2/PR3) の責務
- パフォーマンス: object 数 < 50 を想定するため O(N²) を許容
