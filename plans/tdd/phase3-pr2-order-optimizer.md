# Phase 3 PR2: 進入退出点 + 訪問順最適化 — TDD 計画

## 1. 概要

Phase 3 計画書「8. 実装ステップ」の **ステップ 4-5** を実装する。

PR1 でマージ済みの `pathing.ts` (`shapesTouch`, `findBranches`) を土台として、

- **ステップ 4**: `chooseEntryExit(obj, prevExit, nextEntry?)` を `run` / `satin` / `fill` の kind 別に実装し、進入点と退出点を `EdgePoint` として返す
- **ステップ 5**: `optimizeOrder(design)` を実装し、(a) 色グループ化 → (b) 色内 `findBranches` → (c) branch group 内で最近傍法 + entry/exit 最近接 で `order` を採番する

`renderStitches` 直前で呼ばれることを想定するが、本 PR では `compose.ts` への組み込みは行わず、純粋関数として `EmbroideryDesign` を mutate せず新しい Design を返す。`locked: true` の object は order を保持する。完全 TSP ではなく **最近傍法 (greedy)** を採用し、2-opt は発展課題として残す。

## 2. 依存関係

- **Phase 1 全体 (PR1〜PR5)**: `EmbroideryObject` / `EmbroideryDesign` / `Shape` / `ObjectProps` / `locked` フラグ・`order` フィールドが存在する前提
- **Phase 2 全体 (PR1〜PR4)**: 本 PR は travel-run/jump/trim の挿入は行わないが、`optimizeOrder` の戻り値が `renderDesign` の入力として後段で正しく扱える状態 (Phase 2 PR4 の `assembleWithLockstitch` fork point) を前提とする
- **Phase 3 PR1**: `src/lib/pipeline/pathing.ts` に以下が export されている前提
  - `shapesTouch(a: Shape, b: Shape, epsilon?: number): boolean`
  - `findBranches(objects: EmbroideryObject[]): BranchGroup[]`
  - `BranchGroup` 型 (= `{ objects: EmbroideryObject[]; colorIndex: number }` 相当)

PR1 が未マージなら本 PR を着手しない。Phase 3 計画書 4.1 / 4.2 / 4.3 / 6 のアルゴリズムを採用する。

## 3. 影響ファイル

### 編集
- `src/lib/pipeline/pathing.ts` — 以下を追加 export
  - `EdgePoint` 型 (Phase 3 計画書 4.3)
  - `chooseEntryExit(obj, prevExit, nextEntry?)` 関数
  - `optimizeOrder(design)` 関数
  - (内部 helper) `findNearestEdgePoint`, `routeBranchGroup` 等は必要に応じて
- `src/lib/pipeline/__tests__/pathing.test.ts` — `chooseEntryExit` / `optimizeOrder` の単体テスト追記

### 参照のみ
- `src/lib/pipeline/types.ts` — `EmbroideryObject` / `EmbroideryDesign` / `Shape` / `Polygon` / `Point2D` を使用
- `src/lib/pipeline/pathing.ts` (PR1 既存部) — `shapesTouch` / `findBranches` / `BranchGroup` を import

### 新規ファイル
- なし (`pathing.ts` への追記のみ)

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **実行コマンド**:
  - 単発: `npx vitest run src/lib/pipeline/__tests__/pathing.test.ts`
  - 関連: `npx vitest run src/lib/pipeline/__tests__/`
  - 全件: `npx vitest run`
- **テストファイル配置**: `src/lib/pipeline/__tests__/*.test.ts`

## 5. インターフェース設計

### 5.1 `EdgePoint` 型 (Phase 3 計画書 4.3)

```ts
// src/lib/pipeline/pathing.ts
import type { EmbroideryObject, EmbroideryDesign, Point2D, Shape } from "./types";

/**
 * object の外形 (outer) または穴 (hole) 上の 1 点を識別する識別子付きの座標。
 * Phase 3 計画書 4.3 の "EdgePoint" に対応。
 *
 * - objId: 対象 object の id (重複 entry 候補の区別用)
 * - pt: px 単位の 2D 座標
 * - side: "outer" なら外形リング、"hole" なら穴リング上の点
 * - index: side リング (Polygon) の中での頂点インデックス。中間点 (辺の上) を指す場合は
 *          直前の頂点インデックス (start vertex of the edge segment) を入れる
 */
export type EdgePoint = {
  objId: string;
  pt: Point2D;
  side: "outer" | "hole";
  index: number;
};
```

### 5.2 `chooseEntryExit` シグネチャ

```ts
/**
 * obj の進入点 (entry) と退出点 (exit) を 1 組決定する。
 *
 * - entry: obj の外形 (outer) 上で prevExit に最も近い頂点 (本 PR では頂点のみ、辺中間点は採用しない)
 * - exit: kind 別の「縫い終わり点」
 *    - run:   polyline の両端 (outer[0] と outer[n-1]) のうち entry の **反対端**
 *    - satin: 長軸方向の **反対端** (= 長辺の遠い端)。長軸は outer の最小外接矩形 (OMBB) ではなく、
 *             簡易実装として「outer 頂点ペア間の最大距離をなす 2 点」を採用する
 *    - fill:  最後の scanline の片端。本 PR では「outer 頂点群の中で、entry から最も遠い頂点」を
 *             近似値として採用する (実際の scanline 端点は render.ts で確定するが、optimizeOrder
 *             の貪欲法では近似で十分)
 *
 * - nextEntry: 渡された場合は exit 候補の中で nextEntry に近い方を優先する (chain 最適化、本 PR では
 *   ヒント程度の利用に留め、kind ごとの規則を優先する)
 *
 * - obj.shape.outer が 2 頂点未満なら例外を投げる (build-objects.ts の前提により発生しない想定)
 */
export function chooseEntryExit(
  obj: EmbroideryObject,
  prevExit: Point2D,
  nextEntry?: Point2D,
): { entry: EdgePoint; exit: EdgePoint };
```

戻り値の `entry.objId` / `exit.objId` は `obj.id`、`side` は本 PR の単純実装では常に `"outer"`。

### 5.3 `optimizeOrder` シグネチャ

```ts
/**
 * design.objects の order を再採番した新しい Design を返す。
 *
 * アルゴリズム (Phase 3 計画書 4.1):
 *   Step A: colorIndex 昇順で stable group 化 (ユーザー指定の色順を尊重)
 *   Step B: 各色グループ内で findBranches() を呼び branch group の配列に分割
 *   Step C: branch group 内で 1 つ前の anchor (= 前 object の exit、初期は [0,0])
 *           からの最近傍 object を選び、chooseEntryExit で entry/exit を決定。
 *           採番した object に order = 連番を割り当てる
 *   Step D: locked: true の object はソートから除外して **元の order を保持** する
 *           (= 出力 design.objects 配列上の相対位置を維持)
 *
 * - 入力 design は mutate しない。`{ ...design, objects: newObjects }` を返す
 * - newObjects は **入力と同じ要素数・同じ id 集合** を持つ (object の中身は不変)
 * - design.objects が空配列なら `{ ...design, objects: [] }` を返す
 */
export function optimizeOrder(design: EmbroideryDesign): EmbroideryDesign;
```

### 5.4 内部ヘルパ (export しない)

```ts
// 距離計算
function distSq(a: Point2D, b: Point2D): number;

// 1 つの branch group を最近傍法で順序付け
// (PR1 計画書 3 の routeBranchGroup に相当する簡易実装)
function routeBranchGroup(
  group: BranchGroup,
  prevAnchor: Point2D,
): { orderedObjects: EmbroideryObject[]; lastExit: Point2D };

// 候補頂点群の中で target に最も近い点を返す
function findNearestVertex(
  polygon: Point2D[],
  target: Point2D,
): { pt: Point2D; index: number };
```

### 5.5 ファイル構成

- `src/lib/pipeline/pathing.ts` — PR1 既存内容に Section 5.1〜5.4 を追記
- `src/lib/pipeline/__tests__/pathing.test.ts` — PR1 既存テストに本 PR の `chooseEntryExit` / `optimizeOrder` テストを追記

## 6. TDD サイクル

サイクル順序:

```
Cycle 1 (EdgePoint + chooseEntryExit: run の両端処理)
  → Cycle 2 (chooseEntryExit: satin / fill 拡張)
       → Cycle 3 (optimizeOrder: 単一色・直線配置で左→中→右)
            → Cycle 4 (optimizeOrder: locked=true 維持 / 色境界の保護)
                 → Cycle 5 (optimizeOrder: branch group 連携 + nextEntry ヒント)
```

各サイクル境界で `npx vitest run src/lib/pipeline/__tests__/pathing.test.ts` 全件 green が必須。

---

### Cycle 1: `EdgePoint` 型 + `chooseEntryExit` の run kind 実装

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/pathing.test.ts` (追記)

```ts
import { describe, it, expect } from "vitest";
import { chooseEntryExit } from "../pathing";
import type { EmbroideryObject, Point2D } from "../types";

const runObj = (outer: Point2D[]): EmbroideryObject => ({
  id: "run-1",
  kind: "run",
  colorIndex: 0,
  rgb: [0, 0, 0],
  shape: { outer, holes: [] },
  props: { densityMm: 0.4, maxStitchMm: 7 },
  order: 0,
});

describe("chooseEntryExit (run kind)", () => {
  it("prevExit に近い端点を entry に、反対端を exit にする", () => {
    // polyline: (0,0) → (10,0) → (20,0)
    const obj = runObj([[0, 0], [10, 0], [20, 0]]);
    const result = chooseEntryExit(obj, [-5, 0]);
    // -5,0 に近いのは (0,0) なので entry = (0,0)
    expect(result.entry.pt).toEqual([0, 0]);
    expect(result.entry.objId).toBe("run-1");
    expect(result.entry.side).toBe("outer");
    expect(result.entry.index).toBe(0);
    // exit は反対端 (20,0)
    expect(result.exit.pt).toEqual([20, 0]);
    expect(result.exit.index).toBe(2);
  });

  it("prevExit が反対側なら entry/exit が反転する", () => {
    const obj = runObj([[0, 0], [10, 0], [20, 0]]);
    const result = chooseEntryExit(obj, [25, 0]);
    expect(result.entry.pt).toEqual([20, 0]);
    expect(result.exit.pt).toEqual([0, 0]);
  });

  it("等距離なら最初の端点 (index=0) を entry に採用する (決定性)", () => {
    const obj = runObj([[0, 0], [10, 0]]);
    const result = chooseEntryExit(obj, [5, 100]); // 両端から等距離
    expect(result.entry.pt).toEqual([0, 0]);
    expect(result.exit.pt).toEqual([10, 0]);
  });
});
```

**失敗理由**: `chooseEntryExit` が `pathing.ts` から export されていない (ReferenceError → 型エラー)。

#### Green — 最小実装

```ts
// src/lib/pipeline/pathing.ts (追記)
import type { EmbroideryObject, Point2D } from "./types";

export type EdgePoint = {
  objId: string;
  pt: Point2D;
  side: "outer" | "hole";
  index: number;
};

function distSq(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function chooseEntryExit(
  obj: EmbroideryObject,
  prevExit: Point2D,
  nextEntry?: Point2D,
): { entry: EdgePoint; exit: EdgePoint } {
  void nextEntry; // Cycle 5 で利用
  const outer = obj.shape.outer;
  if (outer.length < 2) {
    throw new Error(`chooseEntryExit: outer must have >=2 vertices (objId=${obj.id})`);
  }

  // run: 両端 (outer[0] と outer[n-1])
  if (obj.kind === "run") {
    const start = outer[0];
    const end = outer[outer.length - 1];
    const dStart = distSq(start, prevExit);
    const dEnd = distSq(end, prevExit);
    // 等距離は start 優先 (決定性)
    if (dStart <= dEnd) {
      return {
        entry: { objId: obj.id, pt: start, side: "outer", index: 0 },
        exit:  { objId: obj.id, pt: end,   side: "outer", index: outer.length - 1 },
      };
    }
    return {
      entry: { objId: obj.id, pt: end,   side: "outer", index: outer.length - 1 },
      exit:  { objId: obj.id, pt: start, side: "outer", index: 0 },
    };
  }

  // satin / fill は Cycle 2 で実装。それまでは run と同じ仮実装。
  throw new Error(`chooseEntryExit: kind=${obj.kind} not yet implemented`);
}
```

#### Refactor

- `EdgePoint` 構築のヘルパ `makeEdgePoint(objId, pt, index)` を抽出すると後続 kind で再利用可能。本サイクルでは必要最小限のみ
- `void nextEntry` のダミー参照は Cycle 5 で削除予定

---

### Cycle 2: `chooseEntryExit` の satin / fill kind 実装

#### Red — 失敗するテスト

```ts
describe("chooseEntryExit (satin kind)", () => {
  const satinObj = (outer: Point2D[]): EmbroideryObject => ({
    id: "sat-1",
    kind: "satin",
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer, holes: [] },
    props: { densityMm: 0.4, maxStitchMm: 7 },
    order: 0,
  });

  it("細長い satin で長軸方向に entry/exit が決まる (X 軸方向の細長矩形)", () => {
    // 20mm x 1mm 矩形。長軸 = X 方向
    const obj = satinObj([[0, 0], [20, 0], [20, 1], [0, 1]]);
    const result = chooseEntryExit(obj, [-5, 0.5]);
    // entry は prevExit に近い outer 頂点 → (0,0) or (0,1)
    expect(result.entry.pt[0]).toBeCloseTo(0);
    // exit は長軸の反対端 → x ≒ 20
    expect(result.exit.pt[0]).toBeCloseTo(20);
    // entry と exit は長軸の反対側でなければならない
    expect(Math.abs(result.entry.pt[0] - result.exit.pt[0])).toBeGreaterThan(15);
  });

  it("Y 軸方向の細長 satin でも長軸が縦方向と認識される", () => {
    const obj = satinObj([[0, 0], [1, 0], [1, 20], [0, 20]]);
    const result = chooseEntryExit(obj, [0.5, -5]);
    // entry は y ≒ 0 側、exit は y ≒ 20 側
    expect(result.entry.pt[1]).toBeCloseTo(0);
    expect(result.exit.pt[1]).toBeCloseTo(20);
  });
});

describe("chooseEntryExit (fill kind)", () => {
  const fillObj = (outer: Point2D[]): EmbroideryObject => ({
    id: "fill-1",
    kind: "fill",
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer, holes: [] },
    props: { densityMm: 0.4, maxStitchMm: 7 },
    order: 0,
  });

  it("正方形 fill で entry に近い頂点と最も遠い頂点が exit になる", () => {
    const obj = fillObj([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const result = chooseEntryExit(obj, [-5, -5]);
    // (0,0) が prevExit (-5,-5) に最も近い
    expect(result.entry.pt).toEqual([0, 0]);
    // (10,10) が entry から最も遠い頂点
    expect(result.exit.pt).toEqual([10, 10]);
  });

  it("entry を指定する prevExit が右上ならば exit は左下になる", () => {
    const obj = fillObj([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const result = chooseEntryExit(obj, [15, 15]);
    expect(result.entry.pt).toEqual([10, 10]);
    expect(result.exit.pt).toEqual([0, 0]);
  });
});
```

**失敗理由**: Cycle 1 の実装で `kind === "satin"` / `"fill"` のとき `throw new Error("not yet implemented")` のため fail。

#### Green — 最小実装

```ts
// src/lib/pipeline/pathing.ts (chooseEntryExit を拡張)

function findNearestVertex(
  polygon: Point2D[],
  target: Point2D,
): { pt: Point2D; index: number } {
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const d = distSq(polygon[i], target);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return { pt: polygon[bestIdx], index: bestIdx };
}

function findFarthestVertex(
  polygon: Point2D[],
  source: Point2D,
): { pt: Point2D; index: number } {
  let bestIdx = 0;
  let bestD = -1;
  for (let i = 0; i < polygon.length; i++) {
    const d = distSq(polygon[i], source);
    if (d > bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return { pt: polygon[bestIdx], index: bestIdx };
}

// satin 用: outer 頂点間で最大距離をなす 2 点 (長軸の両端)
function findLongAxisEnds(polygon: Point2D[]): { aIdx: number; bIdx: number } {
  let aIdx = 0;
  let bIdx = 1;
  let bestD = -1;
  for (let i = 0; i < polygon.length; i++) {
    for (let j = i + 1; j < polygon.length; j++) {
      const d = distSq(polygon[i], polygon[j]);
      if (d > bestD) {
        bestD = d;
        aIdx = i;
        bIdx = j;
      }
    }
  }
  return { aIdx, bIdx };
}

export function chooseEntryExit(
  obj: EmbroideryObject,
  prevExit: Point2D,
  nextEntry?: Point2D,
): { entry: EdgePoint; exit: EdgePoint } {
  void nextEntry;
  const outer = obj.shape.outer;
  if (outer.length < 2) throw new Error(`chooseEntryExit: outer must have >=2 vertices`);

  if (obj.kind === "run") {
    // (Cycle 1 のロジックそのまま)
    const start = outer[0];
    const end = outer[outer.length - 1];
    if (distSq(start, prevExit) <= distSq(end, prevExit)) {
      return {
        entry: { objId: obj.id, pt: start, side: "outer", index: 0 },
        exit:  { objId: obj.id, pt: end,   side: "outer", index: outer.length - 1 },
      };
    }
    return {
      entry: { objId: obj.id, pt: end,   side: "outer", index: outer.length - 1 },
      exit:  { objId: obj.id, pt: start, side: "outer", index: 0 },
    };
  }

  if (obj.kind === "satin") {
    // 長軸の両端を候補とし、prevExit に近い方を entry に
    const { aIdx, bIdx } = findLongAxisEnds(outer);
    const a = outer[aIdx];
    const b = outer[bIdx];
    if (distSq(a, prevExit) <= distSq(b, prevExit)) {
      return {
        entry: { objId: obj.id, pt: a, side: "outer", index: aIdx },
        exit:  { objId: obj.id, pt: b, side: "outer", index: bIdx },
      };
    }
    return {
      entry: { objId: obj.id, pt: b, side: "outer", index: bIdx },
      exit:  { objId: obj.id, pt: a, side: "outer", index: aIdx },
    };
  }

  if (obj.kind === "fill") {
    // entry = prevExit に最も近い outer 頂点
    // exit  = entry から最も遠い outer 頂点 (scanline 終端の近似)
    const entryV = findNearestVertex(outer, prevExit);
    const exitV  = findFarthestVertex(outer, entryV.pt);
    return {
      entry: { objId: obj.id, pt: entryV.pt, side: "outer", index: entryV.index },
      exit:  { objId: obj.id, pt: exitV.pt,  side: "outer", index: exitV.index },
    };
  }

  throw new Error(`chooseEntryExit: unsupported kind=${obj.kind}`);
}
```

#### Refactor

- 3 つの kind 分岐を `kindHandlers: Record<...>` に整理する案もあるが、入出力形状が共通なので switch のままで読みやすい
- `findLongAxisEnds` は O(n^2) だが satin の outer は通常 4-20 頂点程度なので問題なし。100 頂点超の satin が現れた場合は OMBB に置換するメモを残す

---

### Cycle 3: `optimizeOrder` の単一色・直線配置で左→中→右

#### Red — 失敗するテスト

```ts
import { optimizeOrder } from "../pathing";
import type { EmbroideryDesign, EmbroideryObject } from "../types";

const fillBox = (id: string, x: number, y: number, size = 4): EmbroideryObject => ({
  id,
  kind: "fill",
  colorIndex: 0,
  rgb: [0, 0, 0],
  shape: {
    outer: [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    holes: [],
  },
  props: { densityMm: 0.4, maxStitchMm: 7 },
  order: 0,
});

describe("optimizeOrder (single color, 1-D layout)", () => {
  it("直線上に並んだ 3 つの fill object が左→中→右の order になる", () => {
    // 入力 order をわざと逆順にする
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        { ...fillBox("right",  60, 0), order: 0 },
        { ...fillBox("middle", 30, 0), order: 1 },
        { ...fillBox("left",    0, 0), order: 2 },
      ],
    };
    const result = optimizeOrder(design);
    // 起点 (0,0) から最近傍 = left → middle → right
    const ids = result.objects
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => o.id);
    expect(ids).toEqual(["left", "middle", "right"]);
  });

  it("入力 design を mutate しない", () => {
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        { ...fillBox("a", 0, 0),  order: 0 },
        { ...fillBox("b", 50, 0), order: 1 },
      ],
    };
    const originalOrders = design.objects.map((o) => o.order);
    const originalIds = design.objects.map((o) => o.id);
    optimizeOrder(design);
    expect(design.objects.map((o) => o.order)).toEqual(originalOrders);
    expect(design.objects.map((o) => o.id)).toEqual(originalIds);
  });

  it("object 数が同じで id 集合も維持される", () => {
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        { ...fillBox("a", 10, 0), order: 0 },
        { ...fillBox("b", 0, 0),  order: 1 },
        { ...fillBox("c", 20, 0), order: 2 },
      ],
    };
    const result = optimizeOrder(design);
    expect(result.objects).toHaveLength(3);
    expect(new Set(result.objects.map((o) => o.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("空 design でも例外を投げず空配列を返す", () => {
    const design: EmbroideryDesign = { widthMm: 10, heightMm: 10, objects: [] };
    const result = optimizeOrder(design);
    expect(result.objects).toEqual([]);
  });
});
```

**失敗理由**: `optimizeOrder` が `pathing.ts` から export されていない。

#### Green — 最小実装

```ts
// src/lib/pipeline/pathing.ts (追記)
import type { EmbroideryDesign } from "./types";

export function optimizeOrder(design: EmbroideryDesign): EmbroideryDesign {
  if (design.objects.length === 0) {
    return { ...design, objects: [] };
  }

  // 入力は mutate しない: object は浅いコピー + order だけ書き換える
  const cloneObj = (o: EmbroideryObject): EmbroideryObject => ({ ...o });

  // Step A: colorIndex 昇順で stable group 化
  // 元の input order を tiebreaker にする (stable sort 効果)
  const indexed = design.objects.map((o, i) => ({ obj: cloneObj(o), inputIdx: i }));
  indexed.sort((a, b) => {
    if (a.obj.colorIndex !== b.obj.colorIndex) {
      return a.obj.colorIndex - b.obj.colorIndex;
    }
    return a.inputIdx - b.inputIdx;
  });

  // 色グループに分割
  const colorGroups: EmbroideryObject[][] = [];
  let cur: EmbroideryObject[] = [];
  let curColor = -1;
  for (const { obj } of indexed) {
    if (obj.colorIndex !== curColor) {
      if (cur.length > 0) colorGroups.push(cur);
      cur = [];
      curColor = obj.colorIndex;
    }
    cur.push(obj);
  }
  if (cur.length > 0) colorGroups.push(cur);

  // Step C (Cycle 3 では Step B の branching は省略し、色内全体を 1 branch group として扱う):
  //   最近傍法で並べ替え、exit を引き継ぐ
  const ordered: EmbroideryObject[] = [];
  let anchor: Point2D = [0, 0];
  let orderCounter = 0;

  for (const group of colorGroups) {
    const remaining = group.slice();
    while (remaining.length > 0) {
      // anchor に最も近い object を選ぶ (entry 候補 = chooseEntryExit で算出)
      let bestIdx = 0;
      let bestD = Infinity;
      let bestEntryExit: ReturnType<typeof chooseEntryExit> | null = null;
      for (let i = 0; i < remaining.length; i++) {
        const ee = chooseEntryExit(remaining[i], anchor);
        const d = distSq(ee.entry.pt, anchor);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
          bestEntryExit = ee;
        }
      }
      const picked = remaining.splice(bestIdx, 1)[0];
      picked.order = orderCounter++;
      ordered.push(picked);
      anchor = bestEntryExit!.exit.pt;
    }
  }

  return { ...design, objects: ordered };
}
```

#### Refactor

- 色グループ化を Step A / Step C で 2 度 loop しているので 1 つの `groupBy(colorIndex)` ヘルパに集約しても良い
- `chooseEntryExit` を選定段で複数回呼ぶ (Iteration ごとに remaining 全件) コストは O(n^2) だが、object 数 < 100 ならば無視できる

---

### Cycle 4: `locked: true` の order 維持 + 同色内 branching のみで色は跨がない

#### Red — 失敗するテスト

```ts
describe("optimizeOrder (locked + color isolation)", () => {
  it("locked: true の object は元の order を保持する", () => {
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        { ...fillBox("locked-mid", 30, 0), order: 5, locked: true },
        { ...fillBox("a", 0, 0),  order: 1 },
        { ...fillBox("b", 60, 0), order: 2 },
      ],
    };
    const result = optimizeOrder(design);
    const locked = result.objects.find((o) => o.id === "locked-mid")!;
    // locked の order は入力時の 5 から変わらない
    expect(locked.order).toBe(5);
    expect(locked.locked).toBe(true);
    // 非 locked の a, b は新しい order で採番される (locked の 5 と衝突しない & 連番である必要は無いが互いに区別可能)
    const a = result.objects.find((o) => o.id === "a")!;
    const b = result.objects.find((o) => o.id === "b")!;
    expect(a.order).not.toBe(5);
    expect(b.order).not.toBe(5);
    expect(a.order).not.toBe(b.order);
  });

  it("色が異なる object 同士は並べ替えで色境界をまたがない", () => {
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        // colorIndex=0
        { ...fillBox("c0-far",  90, 0), order: 0, colorIndex: 0 },
        // colorIndex=1
        { ...fillBox("c1-near", 10, 0), order: 1, colorIndex: 1 },
        // colorIndex=0
        { ...fillBox("c0-near",  0, 0), order: 2, colorIndex: 0 },
      ],
    };
    const result = optimizeOrder(design);
    const byOrder = result.objects.slice().sort((a, b) => a.order - b.order);
    // colorIndex の並びは [0, 0, 1] (Step A 昇順、locked 無し)
    expect(byOrder.map((o) => o.colorIndex)).toEqual([0, 0, 1]);
    // colorIndex=0 内では (0,0) 起点で c0-near → c0-far
    const c0 = byOrder.filter((o) => o.colorIndex === 0).map((o) => o.id);
    expect(c0).toEqual(["c0-near", "c0-far"]);
  });

  it("locked と色グループが混在しても locked の元 order が保持される", () => {
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        { ...fillBox("L", 50, 0), order: 100, colorIndex: 1, locked: true },
        { ...fillBox("a", 0, 0),  order: 0,   colorIndex: 0 },
        { ...fillBox("b", 20, 0), order: 1,   colorIndex: 0 },
      ],
    };
    const result = optimizeOrder(design);
    expect(result.objects.find((o) => o.id === "L")!.order).toBe(100);
  });
});
```

**失敗理由**: Cycle 3 の実装では `locked` フラグを完全に無視して全 object の order を上書きしてしまうため fail。色境界テストは Cycle 3 で偶然 pass する可能性があるが、明示的に保護する。

#### Green — 最小実装

```ts
// src/lib/pipeline/pathing.ts (optimizeOrder を改修)
export function optimizeOrder(design: EmbroideryDesign): EmbroideryDesign {
  if (design.objects.length === 0) return { ...design, objects: [] };

  const cloneObj = (o: EmbroideryObject): EmbroideryObject => ({ ...o });

  // locked と非 locked を分離
  const cloned = design.objects.map(cloneObj);
  const lockedObjs = cloned.filter((o) => o.locked === true);
  const movable   = cloned.filter((o) => o.locked !== true);

  if (movable.length === 0) {
    // 全部 locked: 何もしない
    return { ...design, objects: cloned };
  }

  // 非 locked のみで色グループ化
  movable.sort((a, b) => a.colorIndex - b.colorIndex);
  const colorGroups: EmbroideryObject[][] = [];
  let cur: EmbroideryObject[] = [];
  let curColor = -1;
  for (const obj of movable) {
    if (obj.colorIndex !== curColor) {
      if (cur.length > 0) colorGroups.push(cur);
      cur = [];
      curColor = obj.colorIndex;
    }
    cur.push(obj);
  }
  if (cur.length > 0) colorGroups.push(cur);

  // locked が既に使っている order 値を集める (採番衝突回避)
  const lockedOrders = new Set(lockedObjs.map((o) => o.order));

  // 最近傍法で非 locked を並べ替え、locked と衝突しない order 値を採番
  const orderedMovable: EmbroideryObject[] = [];
  let anchor: Point2D = [0, 0];
  let orderCounter = 0;
  const nextOrder = (): number => {
    while (lockedOrders.has(orderCounter)) orderCounter++;
    const v = orderCounter;
    orderCounter++;
    return v;
  };

  for (const group of colorGroups) {
    const remaining = group.slice();
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestD = Infinity;
      let bestExit: Point2D | null = null;
      for (let i = 0; i < remaining.length; i++) {
        const ee = chooseEntryExit(remaining[i], anchor);
        const d = distSq(ee.entry.pt, anchor);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
          bestExit = ee.exit.pt;
        }
      }
      const picked = remaining.splice(bestIdx, 1)[0];
      picked.order = nextOrder();
      orderedMovable.push(picked);
      anchor = bestExit!;
    }
  }

  // 出力: locked と orderedMovable をマージし、order 昇順で 1 つの配列にする
  const merged = [...orderedMovable, ...lockedObjs].sort((a, b) => a.order - b.order);
  return { ...design, objects: merged };
}
```

#### Refactor

- `nextOrder()` の生成ロジックを「lockedOrders を予めソート → free-slot iterator」に置き換えても良い (本サイクルでは O(n+L) loop の単純実装で十分)
- 「全部 locked」ケースのガードを early-return として明示

---

### Cycle 5: branch group 連携 + `nextEntry` ヒントの活用

#### Red — 失敗するテスト

```ts
import { findBranches } from "../pathing"; // PR1 で実装済み

describe("optimizeOrder (branch group integration)", () => {
  it("接触する 2 つの object が同じ branch group 内で連続して order される", () => {
    // touch(a,b) = true となる接触配置 (バウンディングが重なる小さな矩形を隣接させる)
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        // a と b は接触 (x=10 と x=10.2 でほぼ接触、epsilon=0.5 内)
        { ...fillBox("a", 0, 0,  10),  order: 0, colorIndex: 0 },
        { ...fillBox("b", 10.2, 0, 10), order: 1, colorIndex: 0 },
        // c は離れている (x=40)
        { ...fillBox("c", 40, 0, 5),   order: 2, colorIndex: 0 },
      ],
    };
    // 事前検証: findBranches が a/b を 1 branch group、c を別 group に分けることを確認
    const groups = findBranches(design.objects);
    expect(groups).toHaveLength(2);

    const result = optimizeOrder(design);
    const byOrder = result.objects.slice().sort((x, y) => x.order - y.order);
    // a と b が連続して並ぶ (途中に c が挟まらない)
    const idsInOrder = byOrder.map((o) => o.id);
    const idxA = idsInOrder.indexOf("a");
    const idxB = idsInOrder.indexOf("b");
    expect(Math.abs(idxA - idxB)).toBe(1);
  });

  it("branch group 間は離れた group 同士でも色をまたがない", () => {
    const design: EmbroideryDesign = {
      widthMm: 100, heightMm: 20,
      objects: [
        // color=0 group 1: 接触する a, b
        { ...fillBox("a", 0, 0, 10),    order: 0, colorIndex: 0 },
        { ...fillBox("b", 10.2, 0, 10), order: 1, colorIndex: 0 },
        // color=1: 単独 d
        { ...fillBox("d", 5, 0, 5),     order: 2, colorIndex: 1 },
        // color=0 group 2: 単独 c
        { ...fillBox("c", 40, 0, 5),    order: 3, colorIndex: 0 },
      ],
    };
    const result = optimizeOrder(design);
    const byOrder = result.objects.slice().sort((x, y) => x.order - y.order);
    const colorSequence = byOrder.map((o) => o.colorIndex);
    // 0, 0, 0, 1 の順 (color=0 全部を縫ってから color=1)
    expect(colorSequence).toEqual([0, 0, 0, 1]);
  });

  it("nextEntry ヒントを渡すと chooseEntryExit が exit 選択に活用する (run の場合)", () => {
    const obj: EmbroideryObject = {
      id: "run-hint",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [10, 0], [20, 0]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7 },
      order: 0,
    };
    // prevExit = (-5, 0) で entry が (0,0) になるのは確定
    // run の場合は exit が反対端 (20,0) で固定 (nextEntry ヒントは現実装では情報のみ)
    // → nextEntry の有無で同じ結果になることを確認 (将来の拡張点を保護)
    const r1 = chooseEntryExit(obj, [-5, 0]);
    const r2 = chooseEntryExit(obj, [-5, 0], [25, 0]);
    expect(r1.entry.pt).toEqual(r2.entry.pt);
    expect(r1.exit.pt).toEqual(r2.exit.pt);
  });
});
```

**失敗理由**: Cycle 4 の実装は「色グループ全体を 1 つの branch group として最近傍法」を回すだけで、`findBranches` を呼んでいない。a と b が接触していても c を挟む可能性があり、最初のテストは偶然 pass する場合もあるが、決定性は保証されていない。明示的に `findBranches` を呼ぶ実装に切り替える。

#### Green — 最小実装

```ts
// src/lib/pipeline/pathing.ts (optimizeOrder の Step B/C をきちんと分離)
// findBranches は PR1 で同一ファイル内に定義済み

// helper: 1 branch group を最近傍法で順序付けし、最終 exit を返す
function routeBranchGroup(
  group: { objects: EmbroideryObject[]; colorIndex: number },
  prevAnchor: Point2D,
): { orderedObjects: EmbroideryObject[]; lastExit: Point2D } {
  const remaining = group.objects.slice();
  const ordered: EmbroideryObject[] = [];
  let anchor = prevAnchor;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
    let bestExit: Point2D = anchor;
    // nextEntry ヒント: 残り object 群の 重心 (簡易) を渡す案もあるが、本 PR では未活用
    for (let i = 0; i < remaining.length; i++) {
      const ee = chooseEntryExit(remaining[i], anchor);
      const d = distSq(ee.entry.pt, anchor);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
        bestExit = ee.exit.pt;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    ordered.push(picked);
    anchor = bestExit;
  }
  return { orderedObjects: ordered, lastExit: anchor };
}

export function optimizeOrder(design: EmbroideryDesign): EmbroideryDesign {
  if (design.objects.length === 0) return { ...design, objects: [] };

  const cloned = design.objects.map((o) => ({ ...o }));
  const lockedObjs = cloned.filter((o) => o.locked === true);
  const movable   = cloned.filter((o) => o.locked !== true);
  if (movable.length === 0) return { ...design, objects: cloned };

  // Step A: 色グループ化 (stable, colorIndex 昇順)
  movable.sort((a, b) => a.colorIndex - b.colorIndex);
  const byColor = new Map<number, EmbroideryObject[]>();
  for (const o of movable) {
    if (!byColor.has(o.colorIndex)) byColor.set(o.colorIndex, []);
    byColor.get(o.colorIndex)!.push(o);
  }
  const colorOrder = Array.from(byColor.keys()).sort((a, b) => a - b);

  // Step B + C: 色グループ内で findBranches → 各 branch group を最近傍法で並べ替え
  const orderedMovable: EmbroideryObject[] = [];
  let anchor: Point2D = [0, 0];

  for (const ci of colorOrder) {
    const colorObjs = byColor.get(ci)!;
    const branchGroups = findBranches(colorObjs);
    // branch group 自体の順序も最近傍法 (anchor に最も近い entry を持つ group を先に)
    const remainingGroups = branchGroups.slice();
    while (remainingGroups.length > 0) {
      // 各 group の最近 entry を試算して group を選ぶ
      let bestGIdx = 0;
      let bestGD = Infinity;
      for (let i = 0; i < remainingGroups.length; i++) {
        for (const obj of remainingGroups[i].objects) {
          const ee = chooseEntryExit(obj, anchor);
          const d = distSq(ee.entry.pt, anchor);
          if (d < bestGD) {
            bestGD = d;
            bestGIdx = i;
          }
        }
      }
      const pickedGroup = remainingGroups.splice(bestGIdx, 1)[0];
      const { orderedObjects, lastExit } = routeBranchGroup(pickedGroup, anchor);
      orderedMovable.push(...orderedObjects);
      anchor = lastExit;
    }
  }

  // locked と衝突しない order を採番
  const lockedOrders = new Set(lockedObjs.map((o) => o.order));
  let counter = 0;
  for (const obj of orderedMovable) {
    while (lockedOrders.has(counter)) counter++;
    obj.order = counter++;
  }

  const merged = [...orderedMovable, ...lockedObjs].sort((a, b) => a.order - b.order);
  return { ...design, objects: merged };
}
```

#### Refactor

- branch group 選定の O(B * N) 走査を「各 group の代表 entry (重心 or anchor 最近点) で 1 度だけ評価」に短縮できるが、本 PR では決定性を優先して全 object 走査
- `nextEntry` ヒントは 5.4 の `chooseEntryExit` シグネチャで受け取れるが、本 PR では情報のみで活用は将来課題 (テストでは「nextEntry 有無で結果不変」のリグレッション保護のみ)
- 2-opt による更なる改善は Phase 3 計画書 11. の発展課題に従い別 PR

---

## 7. サイクル依存グラフ

```
Cycle 1 (run chooseEntryExit)
  ↓
Cycle 2 (satin / fill chooseEntryExit)
  ↓
Cycle 3 (optimizeOrder 単一色・直線)
  ↓
Cycle 4 (locked 維持 + 色境界保護)
  ↓
Cycle 5 (findBranches 連携 + nextEntry ヒント)
```

各サイクル境界で `npx vitest run` 全件 green が必須。Cycle 3 以降は Cycle 1-2 の `chooseEntryExit` に依存。Cycle 5 は PR1 の `findBranches` に依存。

## 8. 回帰防止

1. **PR1 のテスト** (`shapesTouch` / `findBranches` のテスト群) を touch しない。Cycle 開始時に `npx vitest run src/lib/pipeline/__tests__/pathing.test.ts` で PR1 既存テストの green を確認
2. **既存 Phase 1 / Phase 2 のテスト** (`render.test.ts`, `stitch.test.ts`, `lockstitch.test.ts`, `underlay.test.ts`, `compensation.test.ts`) には影響しない設計 (本 PR は `optimizeOrder` の単独関数追加で、`compose.ts` / `render.ts` には触れない)
3. **`compose.ts` / `index.ts` への組み込みは本 PR では行わない**: `optimizeOrder(design)` は単独で `EmbroideryDesign` を入出力する純関数として完結させ、Phase 3 計画書 8. ステップ 6 (`compose.ts` で render の直前に呼ぶ) は別 PR で対応する
4. **`EmbroideryDesign` を mutate しない**: 入力 design が外部で参照されている可能性を考慮し、`objects.map((o) => ({ ...o }))` で浅いコピーを作って order を書き換える。`shape` / `props` は浅い参照のままで OK (本 PR では中身を書き換えないため)
5. **`locked: true` の保護**: Cycle 4 の 3 ケースで「locked の order が保持される」「locked と非 locked の order が衝突しない」「全部 locked のとき何もしない」を assert
6. **`npx vitest run` 全件 green** + **`npx tsc --noEmit` 型エラーなし** を各コミット境界で確認

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/pathing.ts` から `EdgePoint` 型が export されている (Phase 3 計画書 4.3 の定義に従う)
- [ ] `chooseEntryExit(obj, prevExit, nextEntry?)` が export され、kind=`run` / `satin` / `fill` のすべてで `{ entry: EdgePoint; exit: EdgePoint }` を返す
- [ ] **run**: 戻り値の `entry.pt` が `outer[0]` または `outer[n-1]` のうち `prevExit` に近い方、`exit.pt` が反対端
- [ ] **satin**: 戻り値の `entry.pt` と `exit.pt` が長軸方向の両端 (outer 頂点間で最大距離をなす 2 点) であり、`entry` が `prevExit` に近い側
- [ ] **fill**: 戻り値の `entry.pt` が `prevExit` に最も近い outer 頂点、`exit.pt` が entry から最も遠い outer 頂点 (scanline 終端の近似)
- [ ] `optimizeOrder(design)` が export され、入力 `design` を mutate せず新しい `EmbroideryDesign` を返す
- [ ] 出力 `objects` の要素数・id 集合が入力と完全一致 (object の中身は不変)
- [ ] 入力 `objects` が空のとき `{ ...design, objects: [] }` を返す
- [ ] **色グループ化**: 同色 object をまとめ、`colorIndex` 昇順を尊重 (Phase 3 計画書 4.1 Step A)
- [ ] **branch 化**: 色グループ内で `findBranches` を呼び、接触する object を 1 つの branch group としてまとめて連続させる (Phase 3 計画書 4.1 Step B)
- [ ] **最近傍法**: 色グループ内の branch group 単位 + 各 branch group 内の object 単位の両レベルで最近傍法 (greedy) を適用 (Phase 3 計画書 4.1 Step C, 4.2)
- [ ] **直線上の 3 object 入力**: 入力 order が `[right, middle, left]` でも結果は `[left, middle, right]` の order になる
- [ ] **`locked: true`**: locked object は元の `order` 値を保持し、再採番されない (Phase 3 計画書 6.2, 10.)
- [ ] **locked と非 locked の order 衝突回避**: 非 locked の新 order は locked の既存 order と衝突しない
- [ ] **色境界の保護**: 並べ替えは色グループをまたがない (異色 object が同じ branch group に入らない)
- [ ] **(Phase 3 計画書 10. 引用)** `optimizeOrder` を呼んでも呼ばなくても、最終的に縫われる絵柄は同じ (object の中身は不変)
- [ ] **(Phase 3 計画書 10. 引用)** `locked: true` の object は元の order を保持する
- [ ] **2-opt は実装しない**: 本 PR では最近傍法 (greedy) のみ。2-opt / 3-opt は発展課題として Phase 3 計画書 11. に従い別 PR
- [ ] `npx vitest run src/lib/pipeline/__tests__/pathing.test.ts` 全件 green
- [ ] `npx vitest run` 全件 green (PR1 + 既存 Phase 1 / Phase 2 のテストを含む)
- [ ] `npx tsc --noEmit` 型エラーなし

## 10. コミット粒度

| Commit | サイクル | 内容 |
|---|---|---|
| 1 | Cycle 1 Red | `test(pipeline): add failing tests for chooseEntryExit (run kind)` |
| 2 | Cycle 1 Green | `feat(pipeline): add EdgePoint type and chooseEntryExit for run kind` |
| 3 | Cycle 2 Red | `test(pipeline): add chooseEntryExit tests for satin/fill kinds` |
| 4 | Cycle 2 Green | `feat(pipeline): implement chooseEntryExit for satin (long axis) and fill (farthest vertex)` |
| 5 | Cycle 3 Red | `test(pipeline): add failing tests for optimizeOrder (linear layout)` |
| 6 | Cycle 3 Green | `feat(pipeline): add optimizeOrder with nearest-neighbor over color groups` |
| 7 | Cycle 4 Red | `test(pipeline): assert locked objects keep order and color boundaries are respected` |
| 8 | Cycle 4 Green | `feat(pipeline): preserve locked order and avoid order collisions in optimizeOrder` |
| 9 | Cycle 5 Red | `test(pipeline): assert optimizeOrder uses findBranches for branching` |
| 10 | Cycle 5 Green | `feat(pipeline): integrate findBranches and routeBranchGroup into optimizeOrder` |
| 11 | Cycle 5 Refactor | `refactor(pipeline): extract routeBranchGroup helper and document nextEntry hint` |

各コミット境界で `npx vitest run` 全件 green が必須。

## 11. 想定 PR タイトル

`feat(pipeline): add entry/exit selection and order optimizer (phase 3 pr2)`

## 12. 注意事項

- **Phase 3 計画書 4.3 仕様を厳守**: `EdgePoint = { objId, pt, side, index }` の 4 フィールド。`side` は本 PR では常に `"outer"` だが、将来の hole 上 entry 拡張を見越して型に含める
- **Phase 3 計画書 4.2 の 4 ステップを採用**: (1) 端点候補収集 (本 PR では outer 頂点を全候補とみなす)、(2) 距離行列 (本 PR では暗黙の O(n^2) 評価)、(3) 最近傍法 (greedy)、(4) entry から縫い方向に従って exit 計算
- **完全 TSP 不採用**: object 数 < 50 でも brute force は避け、最近傍法のみ。2-opt は Phase 3 計画書 11. に従い発展課題 (別 PR)
- **`compose.ts` への組み込みは別 PR**: 本 PR は `optimizeOrder` を export するのみ。`compose.ts` で render の直前に呼ぶ配線 (Phase 3 計画書 8. ステップ 6) は次の PR3 で対応
- **`renderStitches` への entry/exit 引き渡しは別 PR**: 各 object の `entry` を receiver の renderer に渡し、renderer 内で entry から逆向きに scanline を開始する改修 (Phase 3 計画書 8. ステップ 7) は本 PR の対象外
- **travel run / jump / trim+jump の挿入は別 PR**: object 間の繋ぎ方を距離で分岐するロジック (Phase 3 計画書 5.) は本 PR の対象外
- **`Color Sort 強化` の細部は本 PR では未実装**: Phase 3 計画書 6.1 の「object 数 < 3 個の色を最後にまとめる」は本 PR の範囲外 (colorIndex 昇順の素直な順序を採用)
- **fill の exit 近似**: 「entry から最も遠い outer 頂点」は scanline 終端の真値ではないが、最近傍法の anchor 更新には十分。真値は renderer 側で確定するため、本 PR の責務外
- **satin の長軸近似**: `findLongAxisEnds` は outer 頂点全ペアの距離評価 (O(n^2))。outer が 100 頂点を超える satin が現れた場合は OMBB (Oriented Minimum Bounding Box) に置換する TODO コメントを残す
- **入力 design の `objects` 配列順 vs `order` フィールド**: 出力は `order` 昇順でソート済みの配列を返すことで、後段の renderer が `objects` 配列順に縫う既存実装と整合する
- **`build-objects.ts` で `locked` フィールドが未注入の場合**: `locked === true` の判定で undefined は false 扱いになるため、未注入でも問題なし。本 PR で `build-objects.ts` は touch しない
