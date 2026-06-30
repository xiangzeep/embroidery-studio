# Phase 3 PR3: travel run + trim policy + render 統合 — TDD 計画

## 1. 概要

Phase 3 PR1 (`shapesTouch`, `findBranches`) と Phase 3 PR2 (`chooseEntryExit`, `optimizeOrder`) でビルドアップしてきた pathing 機能を、最終的に **renderer 経路** に組み込む。具体的には:

1. `compose.ts` で `renderDesign` を呼ぶ直前に `optimizeOrder(design)` を実行し、object の縫う順序と entry/exit を確定させる
2. `render.ts` の renderer 群 (`renderRun` / `renderSatin` / `renderFill`) を「`entry` を受け取って entry から縫い始め、`exit` を返す」インターフェースに改修する
3. object 間の接続を **距離に応じて travel run / jump / trim + jump の 3 通り** に切り替える
4. 切り替え閾値を `TRIM_POLICY_BY_FORMAT` (新規 `policy.ts`) に集約し、フォーマット (DST/PES/JEF/EXP/VP3) ごとに調整可能にする

これによって Phase 3 計画書 5 (Travel Run vs Trim+Jump) / 7 (Trim 閾値の動的化) を完成させる。発展課題である「既存縫い下に潜らせる travel run」(計画書 5.1) は **本 PR では実装せず、直線 travel run のみ**。

## 2. 依存関係

- **Phase 1 全体 (PR1〜PR5)**: `EmbroideryObject` / `EmbroideryDesign` / `FabricProfile` / `ObjectProps` / `ConversionConfig`、`render.ts` の `renderRun/Satin/Fill/Design`、`buildObjects`、`compose.ts` 配線がすべて存在する前提
- **Phase 2 PR1〜PR4**: `compensation.ts`, `underlay.ts`, `lockstitch.ts`、`render.ts` が tie-in / underlay / top / tie-off の合成順を持つ前提 (PR4 で完了)
- **Phase 3 PR1**: `shapesTouch(a, b)` / `findBranches(objects)` が `pathing.ts` に存在する前提
- **Phase 3 PR2**: `chooseEntryExit(obj, prevExit, nextEntry?)` / `optimizeOrder(design)` が `pathing.ts` に存在する前提。`optimizeOrder` の戻り値が `design.objects[i].entry`, `design.objects[i].exit`, `design.objects[i].locked` を持つこと

PR1〜PR2 のいずれかが未マージの状態で本 PR を着手しないこと。本 PR は **renderer 経路への配線とフォーマット連動ポリシーの導入のみ** に集中する。

## 3. 影響ファイル

### 新規
- `src/lib/pipeline/policy.ts` — `TrimPolicy` 型と `TRIM_POLICY_BY_FORMAT` 定数を定義
- `src/lib/pipeline/__tests__/policy.test.ts` — `TRIM_POLICY_BY_FORMAT` の値が Phase 3 計画書 7 のテーブルと一致することの検証

### 編集
- `src/lib/pipeline/render.ts` — 以下を改修:
  - `renderRun` / `renderSatin` / `renderFill` のシグネチャに `entry: Point2D` (+ `exit: Point2D`) を加え、entry から縫い始める実装に変更
  - 各 renderer の戻り値に `exit` を含める (`{ stitches, exit }` を返す形 or `entry/exit` を `obj` 経由で受ける形)
  - `renderDesign` 内で object 間の繋ぎを `connectObjects(prevExit, nextEntry, policy)` ヘルパで生成し、結果に応じて `kind="run"` (travel run) / `kind="jump"` / `kind="trim" → kind="jump"` を挿入
  - `RenderOptions` に `policy?: TrimPolicy` と `disablePathing?: boolean` (Phase 3 機能を無効化するデバッグフラグ) を追加
- `src/lib/pipeline/compose.ts` — `renderDesign` 呼び出し前に `optimizeOrder(design)` を呼ぶ。`config.format` から `TRIM_POLICY_BY_FORMAT[format]` を引いて `RenderOptions.policy` に渡す
- `src/lib/pipeline/__tests__/render.test.ts` — object 間距離に応じた繋ぎ方の assert / フォーマット切替テスト / `locked` 保持テスト / renderer の entry 起点テストを追加
- `src/lib/pipeline/__tests__/compose.test.ts` (既存なら) — `optimizeOrder` が呼ばれること、フラグで挙動が変わることのテスト

### 参照のみ
- `src/lib/pipeline/types.ts` — `Stitch` / `StitchKind` / `EmbroideryObject` / `Point2D` を使用
- `src/lib/pipeline/pathing.ts` — `optimizeOrder` / `chooseEntryExit` を import
- `src/components/embroidery-studio.tsx` — `EmbroideryFormat` 型を import (新フィールド追加は本 PR では不要)

## 4. テスト環境

- **フレームワーク**: Vitest (既存)
- **実行コマンド**:
  - 単発: `npx vitest run src/lib/pipeline/__tests__/policy.test.ts`
  - 関連: `npx vitest run src/lib/pipeline/__tests__/{policy,render,compose}.test.ts`
  - 全件: `npx vitest run`
  - 型チェック: `npx tsc --noEmit`
- **テストファイル配置**: `src/lib/pipeline/__tests__/*.test.ts`

## 5. インターフェース設計

### 5.1 `policy.ts`

```ts
// src/lib/pipeline/policy.ts
import type { EmbroideryFormat } from "@/components/embroidery-studio";

/**
 * object 間の接続方法を決める距離閾値 (mm)。
 *
 * 評価順:
 *   1. distance < travelRunUntilMm → travel run (kind="run") で繋ぐ
 *   2. distance < trimThresholdMm  → jump only (kind="jump"、trim なし)
 *   3. otherwise                   → trim + jump (kind="trim" → kind="jump")
 *
 * NOTE: jumpThresholdMm は将来 "travel run と jump の境界とは別の閾値を持ちたい"
 * 場合の余地。本 PR では実質 travelRunUntilMm と等値で使う想定。
 */
export type TrimPolicy = {
  /** これ以上の距離は trim を挿入してから jump する */
  trimThresholdMm: number;
  /** travel run と jump の境界 (将来別運用にする可能性のための予備) */
  jumpThresholdMm: number;
  /** 距離がこの値未満なら travel run で繋ぐ */
  travelRunUntilMm: number;
};

/** Phase 3 計画書 7 のテーブルそのまま (初期値は全フォーマット同一) */
export const TRIM_POLICY_BY_FORMAT: Record<EmbroideryFormat, TrimPolicy> = {
  dst: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  pes: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  jef: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  exp: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  vp3: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
};

export const DEFAULT_TRIM_POLICY: TrimPolicy = TRIM_POLICY_BY_FORMAT.dst;
```

注: 初期値は計画書 7 のテーブル通り **全フォーマット同一**。PR レビューや実機検証で format ごとの差をチューニングする想定。

### 5.2 `render.ts` の renderer シグネチャ変更

```ts
// src/lib/pipeline/render.ts

import type { TrimPolicy } from "./policy";
import { DEFAULT_TRIM_POLICY } from "./policy";
import { optimizeOrder } from "./pathing"; // compose.ts で使うが renderer 内では使わない

export type RenderOptions = {
  // ...既存 Phase 2 PR4 までのフィールド...
  /** object 間の繋ぎ方を決めるポリシー。未指定なら DEFAULT_TRIM_POLICY (DST 互換) */
  policy?: TrimPolicy;
  /**
   * Phase 3 機能を無効化するデバッグフラグ。
   * true なら object 間繋ぎは「常に trim + jump」(従来挙動) になり、
   * renderer も entry 無視で各 object の最初の点から縫う。
   */
  disablePathing?: boolean;
};

export type RenderContext = {
  opts: RenderOptions;
  mmPerPx: number;
};

/**
 * renderer は entry を受け取り、entry から縫い始める Stitch[] と exit 座標を返す。
 * entry が未指定 (= disablePathing 経路) の場合は obj.shape の従来の起点を使う。
 *
 * NOTE: 戻り値はこれまで Stitch[] のみだったので互換破壊。compose.ts / 既存テストの
 * 改修が必須。Phase 2 PR4 で導入された tie-in/underlay/top/tie-off の合成順は維持。
 */
export type RenderResult = {
  stitches: Stitch[];
  exit: Point2D;
};

export function renderRun(
  obj: EmbroideryObject,
  ctx: RenderContext,
  entry?: Point2D,
): RenderResult;

export function renderSatin(
  obj: EmbroideryObject,
  ctx: RenderContext,
  entry?: Point2D,
): RenderResult;

export function renderFill(
  obj: EmbroideryObject,
  ctx: RenderContext,
  entry?: Point2D,
): RenderResult;
```

renderer の中での entry 反映方針 (kind 別):
- **run**: entry が polyline の端点に近い側を起点にし、polyline をその端から舐める方向で resample
- **satin**: entry の長軸方向の位置を判定し、scanline の往復を「entry 側を起点」にする
- **fill**: entry に最も近い scanline 端を起点にし、そこから scanline を逆向きに開始する (= entry に近い scanline を最初に縫う)

`exit` は各 kind の最後の top stitch 座標を返す。

### 5.3 `connectObjects(prevExit, nextEntry, policy)` ヘルパ

```ts
// src/lib/pipeline/render.ts (内部ヘルパ)

import type { Stitch, Point2D } from "./types";
import type { TrimPolicy } from "./policy";

/**
 * prev object の exit から next object の entry までの繋ぎ stitch を返す。
 * - 距離 < travelRunUntilMm     → [{ x, y, kind: "run",  colorIndex }] (travel run、1 stitch のみで直線)
 * - travelRunUntilMm <= 距離 < trimThresholdMm → [{ x, y, kind: "jump", colorIndex }]
 * - 距離 >= trimThresholdMm     → [{ x: prev.x, y: prev.y, kind: "trim", colorIndex }, { x, y, kind: "jump", colorIndex }]
 *
 * colorIndex は next object のもの (次の縫いを開始するため)。
 */
export function connectObjects(
  prevExit: Point2D,
  nextEntry: Point2D,
  nextColorIndex: number,
  policy: TrimPolicy,
): Stitch[];
```

注: travel run は本 PR では「直線 1 stitch」のみ。`maxStitchMm` を超える距離でも分割せず 1 stitch で繋ぐ (= renderer の `appendStitchesWithJumps` を介さず直接 push する)。これは Phase 3 計画書 5 の「直線 travel run のみ」方針による。

### 5.4 `renderDesign` 内のフロー

```ts
// src/lib/pipeline/render.ts

export function renderDesign(
  design: EmbroideryDesign,
  opts: RenderOptions,
): StitchPattern {
  const policy = opts.policy ?? DEFAULT_TRIM_POLICY;
  const ctx: RenderContext = { opts, mmPerPx: opts.widthMm / opts.widthPx };

  const blocks: StitchBlock[] = [];
  let totalStitches = 0;

  // colorIndex ごとに block を作る (= 既存と同じ)
  const byColor = groupByColor(design.objects);
  for (const [colorIndex, objs] of byColor) {
    const block: StitchBlock = { colorIndex, rgb: objs[0].rgb, stitches: [] };
    let prevExit: Point2D | null = null;
    for (const obj of objs) {
      const entry = opts.disablePathing ? undefined : obj.entry;
      const renderer =
        obj.kind === "run" ? renderRun :
        obj.kind === "satin" ? renderSatin : renderFill;
      const { stitches: objStitches, exit } = renderer(obj, ctx, entry);

      // 同 block 内の前 object との繋ぎ
      if (prevExit !== null) {
        const connect = opts.disablePathing
          ? buildLegacyTrimJump(prevExit, objStitches[0], colorIndex) // 従来挙動
          : connectObjects(prevExit, entry ?? toPoint(objStitches[0]), colorIndex, policy);
        block.stitches.push(...connect);
      }
      block.stitches.push(...objStitches);
      prevExit = exit;
    }
    if (block.stitches.length > 0) {
      blocks.push(block);
      totalStitches += block.stitches.filter(
        (s) => s.kind === "run" || s.kind === "satin" || s.kind === "fill",
      ).length;
    }
  }

  // block 間 (色替え) に stop を挿入 (既存維持)
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const last = prev.stitches[prev.stitches.length - 1];
    prev.stitches.push({
      x: last?.x ?? 0,
      y: last?.y ?? 0,
      kind: "stop",
      colorIndex: prev.colorIndex,
    });
  }

  return { widthMm: opts.widthMm, heightMm: opts.heightMm, blocks, totalStitches };
}
```

### 5.5 `compose.ts` の改修

```ts
// src/lib/pipeline/compose.ts (もしくは index.ts の runStitchAndWrite)

import { optimizeOrder } from "./pathing";
import { TRIM_POLICY_BY_FORMAT } from "./policy";

export async function runStitchAndWrite(
  pre: PrepipelineResult,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  // ...buildObjects 等で design を作る既存処理...
  const rawDesign = buildDesign(pre, config);

  // Phase 3 PR3: render の直前に optimizeOrder を呼ぶ
  const orderedDesign = optimizeOrder(rawDesign);

  const policy = TRIM_POLICY_BY_FORMAT[config.format];
  const pattern = renderDesign(orderedDesign, {
    ...buildRenderOpts(config),
    policy,
  });

  // ...writeEmbroidery で出力...
}
```

### 5.6 ファイル構成

- `src/lib/pipeline/policy.ts` — 新規
- `src/lib/pipeline/__tests__/policy.test.ts` — 新規
- `src/lib/pipeline/render.ts` — 改修
- `src/lib/pipeline/compose.ts` — 改修 (`optimizeOrder` 呼び出し + `policy` 配線)
- `src/lib/pipeline/__tests__/render.test.ts` — テスト追加
- `src/lib/pipeline/__tests__/compose.test.ts` — テスト追加 (既存なら追記)

## 6. TDD サイクル

サイクル順序:

```
Cycle 1 (policy.ts: TRIM_POLICY_BY_FORMAT 定数)
  ↓
Cycle 2 (connectObjects ヘルパで距離に応じた繋ぎ)
  ↓
Cycle 3 (renderer に entry/exit を導入)
  ↓
Cycle 4 (renderDesign で object 間繋ぎを統合 + フォーマット連動)
  ↓
Cycle 5 (compose.ts で optimizeOrder + policy を配線、disablePathing で従来挙動)
```

---

### Cycle 1: `policy.ts` で `TRIM_POLICY_BY_FORMAT` を定義

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/policy.test.ts` (新規)

```ts
import { describe, it, expect } from "vitest";
import {
  TRIM_POLICY_BY_FORMAT,
  DEFAULT_TRIM_POLICY,
  type TrimPolicy,
} from "../policy";

describe("TRIM_POLICY_BY_FORMAT", () => {
  it("5 つのフォーマット (dst/pes/jef/exp/vp3) すべてに値が定義されている", () => {
    expect(Object.keys(TRIM_POLICY_BY_FORMAT).sort()).toEqual(
      ["dst", "exp", "jef", "pes", "vp3"],
    );
  });

  it("計画書 7 のテーブルに従い、初期値はすべて trim=8 / jump=5 / travelRun=5", () => {
    const expected: TrimPolicy = {
      trimThresholdMm: 8,
      jumpThresholdMm: 5,
      travelRunUntilMm: 5,
    };
    for (const fmt of ["dst", "pes", "jef", "exp", "vp3"] as const) {
      expect(TRIM_POLICY_BY_FORMAT[fmt]).toEqual(expected);
    }
  });

  it("trimThresholdMm > jumpThresholdMm の不変条件 (jump 帯は trim より手前)", () => {
    for (const fmt of Object.keys(TRIM_POLICY_BY_FORMAT) as Array<
      keyof typeof TRIM_POLICY_BY_FORMAT
    >) {
      const p = TRIM_POLICY_BY_FORMAT[fmt];
      expect(p.trimThresholdMm).toBeGreaterThan(p.jumpThresholdMm);
    }
  });

  it("travelRunUntilMm <= jumpThresholdMm の不変条件 (travel run 帯は jump 以下)", () => {
    for (const fmt of Object.keys(TRIM_POLICY_BY_FORMAT) as Array<
      keyof typeof TRIM_POLICY_BY_FORMAT
    >) {
      const p = TRIM_POLICY_BY_FORMAT[fmt];
      expect(p.travelRunUntilMm).toBeLessThanOrEqual(p.jumpThresholdMm);
    }
  });

  it("DEFAULT_TRIM_POLICY は dst と同値 (DST は色情報を持たない最大公約数フォーマット)", () => {
    expect(DEFAULT_TRIM_POLICY).toEqual(TRIM_POLICY_BY_FORMAT.dst);
  });
});
```

**失敗理由**: `src/lib/pipeline/policy.ts` 未作成のため import エラー。

#### Green — 最小実装

```ts
// src/lib/pipeline/policy.ts
import type { EmbroideryFormat } from "@/components/embroidery-studio";

export type TrimPolicy = {
  trimThresholdMm: number;
  jumpThresholdMm: number;
  travelRunUntilMm: number;
};

export const TRIM_POLICY_BY_FORMAT: Record<EmbroideryFormat, TrimPolicy> = {
  dst: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  pes: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  jef: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  exp: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  vp3: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
};

export const DEFAULT_TRIM_POLICY: TrimPolicy = TRIM_POLICY_BY_FORMAT.dst;
```

#### Refactor

- 値が全フォーマット同一なので、共通定数 `const BASE: TrimPolicy = {...}` を 1 つ作って `dst: BASE, pes: BASE, ...` のように展開する書き方も検討。**ただし将来フォーマットごとに差をつける予定があるため、本 PR では明示的に 5 行展開のままにする**。意図を YAGNI コメントで残す。
- 不変条件 (`travelRunUntilMm <= jumpThresholdMm < trimThresholdMm`) を型レベルで保証するブランドや zod スキーマは過剰 → 単体テストで担保

---

### Cycle 2: `connectObjects` ヘルパで距離に応じた繋ぎを返す

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記

```ts
import { describe, it, expect } from "vitest";
import { connectObjects } from "../render";
import { TRIM_POLICY_BY_FORMAT } from "../policy";

describe("connectObjects (距離に応じた繋ぎ)", () => {
  const policy = TRIM_POLICY_BY_FORMAT.dst; // trim=8 / jump=5 / travelRun=5

  it("距離 3mm (travelRunUntilMm=5 未満) なら travel run 1 stitch (kind=run)", () => {
    const result = connectObjects([0, 0], [3, 0], 2, policy);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ x: 3, y: 0, kind: "run", colorIndex: 2 });
  });

  it("距離 ちょうど 5mm (travelRunUntilMm) なら travel run ではなく jump になる (< 厳格)", () => {
    const result = connectObjects([0, 0], [5, 0], 2, policy);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("jump");
  });

  it("距離 6mm (travelRunUntilMm 以上 trimThresholdMm 未満) なら jump only (kind=jump)", () => {
    const result = connectObjects([0, 0], [6, 0], 3, policy);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ x: 6, y: 0, kind: "jump", colorIndex: 3 });
  });

  it("距離 10mm (trimThresholdMm 以上) なら trim + jump の 2 stitch (順序: trim → jump)", () => {
    const result = connectObjects([0, 0], [10, 0], 4, policy);
    expect(result).toHaveLength(2);
    // trim は prev 座標で発火 (針位置は動かさない)
    expect(result[0]).toMatchObject({ x: 0, y: 0, kind: "trim", colorIndex: 4 });
    // jump は next の entry 位置
    expect(result[1]).toMatchObject({ x: 10, y: 0, kind: "jump", colorIndex: 4 });
  });

  it("距離 ちょうど 8mm (trimThresholdMm 境界) なら trim + jump (>= 判定)", () => {
    const result = connectObjects([0, 0], [8, 0], 0, policy);
    expect(result.map((s) => s.kind)).toEqual(["trim", "jump"]);
  });

  it("斜め距離も Euclidean で判定 (3-4-5 直角三角形)", () => {
    const result = connectObjects([0, 0], [3, 4], 1, policy); // 距離 5
    // ちょうど 5mm = jump
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("jump");
  });

  it("travel run の colorIndex は next object のもの (次の色で繋ぐ)", () => {
    const result = connectObjects([0, 0], [2, 0], 7, policy);
    expect(result[0].colorIndex).toBe(7);
  });

  it("カスタム policy を渡すと閾値が変わる (PES 想定で travelRun=3 に絞ったケース)", () => {
    const custom = { trimThresholdMm: 6, jumpThresholdMm: 3, travelRunUntilMm: 3 };
    // 距離 4mm: dst なら travel run、custom では jump
    const result = connectObjects([0, 0], [4, 0], 1, custom);
    expect(result[0].kind).toBe("jump");
  });
});
```

**失敗理由**: `connectObjects` が `render.ts` から export されていない。

#### Green — 最小実装

```ts
// src/lib/pipeline/render.ts (内部 + export)
import type { Stitch, Point2D } from "./types";
import type { TrimPolicy } from "./policy";

export function connectObjects(
  prevExit: Point2D,
  nextEntry: Point2D,
  nextColorIndex: number,
  policy: TrimPolicy,
): Stitch[] {
  const [px, py] = prevExit;
  const [nx, ny] = nextEntry;
  const dist = Math.hypot(nx - px, ny - py);

  // 厳密 < で travel run、それ以外は jump or trim+jump
  if (dist < policy.travelRunUntilMm) {
    return [{ x: nx, y: ny, kind: "run", colorIndex: nextColorIndex }];
  }
  if (dist < policy.trimThresholdMm) {
    return [{ x: nx, y: ny, kind: "jump", colorIndex: nextColorIndex }];
  }
  return [
    { x: px, y: py, kind: "trim", colorIndex: nextColorIndex },
    { x: nx, y: ny, kind: "jump", colorIndex: nextColorIndex },
  ];
}
```

判定の境界は **`< travelRunUntilMm` → run、`< trimThresholdMm` → jump、それ以外 → trim+jump** で固定。テストの「ちょうど 5mm = jump」「ちょうど 8mm = trim+jump」がこの境界を直接保証する。

#### Refactor

- 不要 (3 分岐の最小実装、共通化対象なし)
- 将来 travel run を「複数 stitch 化」「曲線化」する場合は本関数の戻り値に追加 stitch を入れるだけで済むよう、戻り値型を `Stitch[]` のままにしておく

---

### Cycle 3: renderer に `entry` を導入し `exit` を返す

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記

```ts
import { describe, it, expect } from "vitest";
import { renderRun, renderSatin, renderFill } from "../render";
import type { EmbroideryObject } from "../types";

describe("renderer は entry を起点に縫い始め、exit を返す", () => {
  const baseOpts = {
    widthMm: 20, heightMm: 20, widthPx: 200, heightPx: 200,
    stitchDensityMm: 0.4, satinMaxWidthMm: 6,
    // Phase 3 機能を有効化するため disablePathing は未指定 (=false 相当)
  };
  const ctx = { opts: baseOpts, mmPerPx: 0.1 };

  it("renderFill: entry に近い側から scanline を開始する", () => {
    const obj: EmbroideryObject = {
      id: "0-0",
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [20, 0], [20, 20], [0, 20]], holes: [] },
      props: {
        densityMm: 0.4,
        maxStitchMm: 7,
        underlay: { kind: "none" },
      },
      order: 0,
    };

    // entry を左上 (0,0) 付近に指定
    const topLeft = renderFill(obj, ctx, [0, 0]);
    // entry を右下 (20,20) 付近に指定
    const bottomRight = renderFill(obj, ctx, [20, 20]);

    // どちらも RenderResult { stitches, exit } を返す
    expect(topLeft.stitches.length).toBeGreaterThan(0);
    expect(bottomRight.stitches.length).toBeGreaterThan(0);

    // top stitches の最初の fill 点 (= tie-in 直後) が entry 側
    const topLeftFirstFill = topLeft.stitches.find((s) => s.kind === "fill")!;
    const bottomRightFirstFill = bottomRight.stitches.find((s) => s.kind === "fill")!;

    // 左上 entry なら最初の fill 点は左上寄り (y < 10)、右下 entry なら下寄り (y > 10)
    expect(topLeftFirstFill.y).toBeLessThan(10);
    expect(bottomRightFirstFill.y).toBeGreaterThan(10);

    // exit は最後の top stitch (=最後の fill) の座標
    const topLeftLastFill = [...topLeft.stitches].reverse().find((s) => s.kind === "fill")!;
    expect(topLeft.exit[0]).toBeCloseTo(topLeftLastFill.x);
    expect(topLeft.exit[1]).toBeCloseTo(topLeftLastFill.y);
  });

  it("renderRun: entry が polyline の片方の端点に近い側から resample する", () => {
    const obj: EmbroideryObject = {
      id: "0-1",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      // 細長い 0.3mm 幅の 10mm ストローク (shortSide < runMaxWidthMm を想定)
      shape: { outer: [[0, 0], [10, 0], [10, 0.3], [0, 0.3]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 0,
    };

    const fromLeft = renderRun(obj, ctx, [0, 0]);
    const fromRight = renderRun(obj, ctx, [10, 0]);

    const firstFromLeft = fromLeft.stitches.find((s) => s.kind === "run" && (s.x > 0 || s.y > 0))!;
    const firstFromRight = fromRight.stitches.find((s) => s.kind === "run" && (s.x < 10 || s.y < 10))!;

    // 起点が左 → 最初の意味のある run は右へ進む傾向 (x が増える)
    // 起点が右 → 最初の意味のある run は左へ進む傾向 (x が減る)
    // exit は逆側の端点付近
    expect(fromLeft.exit[0]).toBeGreaterThan(fromRight.exit[0]);
  });

  it("renderSatin: entry を渡すと長軸方向で entry 側から往復が始まる", () => {
    const obj: EmbroideryObject = {
      id: "0-2",
      kind: "satin",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [20, 0], [20, 1.5], [0, 1.5]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 0,
    };

    const fromLeft = renderSatin(obj, ctx, [0, 0.75]);
    const fromRight = renderSatin(obj, ctx, [20, 0.75]);

    const leftFirstSatin = fromLeft.stitches.find((s) => s.kind === "satin")!;
    const rightFirstSatin = fromRight.stitches.find((s) => s.kind === "satin")!;
    expect(leftFirstSatin.x).toBeLessThan(rightFirstSatin.x);

    // exit は反対側
    expect(fromLeft.exit[0]).toBeGreaterThan(10);
    expect(fromRight.exit[0]).toBeLessThan(10);
  });

  it("entry 未指定なら従来の起点 (polygon[0]) から縫う (後方互換)", () => {
    const obj: EmbroideryObject = {
      id: "0-3",
      kind: "fill",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[5, 5], [15, 5], [15, 15], [5, 15]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 0,
    };
    const result = renderFill(obj, ctx); // entry 省略
    expect(result.stitches.length).toBeGreaterThan(0);
    // exit が定義されている
    expect(typeof result.exit[0]).toBe("number");
    expect(typeof result.exit[1]).toBe("number");
  });
});
```

**失敗理由**:
1. 現状の renderer は `Stitch[]` を返すだけで `{ stitches, exit }` 形式ではないので型エラー
2. `entry` 引数を渡しても無視されるため、entry の左右で `firstFill` の位置が変わらない

#### Green — 最小実装

`render.ts` で 3 renderer のシグネチャと内部実装を変更:

```ts
// src/lib/pipeline/render.ts

export type RenderResult = {
  stitches: Stitch[];
  exit: Point2D;
};

export function renderFill(
  obj: EmbroideryObject,
  ctx: RenderContext,
  entry?: Point2D,
): RenderResult {
  // 既存の Phase 2 PR4 ロジック (tie-in/underlay/top/tie-off の合成順) は維持
  // 違いは: top stitches を生成する `fillStitches` の scanline 順を entry に応じて反転する
  const topStitches = renderFillTopOnly(obj, ctx, entry); // entry 対応の内部関数
  const underlayStitches = ctx.opts.disableUnderlay
    ? []
    : generateUnderlayStitches(obj, ctx);
  const assembled = ctx.opts.disableLockstitch
    ? [...underlayStitches, ...topStitches]
    : assembleWithLockstitch(topStitches, underlayStitches, obj.colorIndex);

  // exit = 最後の top stitch の座標
  const lastTop = topStitches[topStitches.length - 1];
  const exit: Point2D = lastTop ? [lastTop.x, lastTop.y] : (entry ?? [0, 0]);
  return { stitches: assembled, exit };
}
```

`renderFillTopOnly(obj, ctx, entry)` の中身:
1. 既存 `fillStitches(shape, density, angle)` を呼んで segments を得る
2. `entry` が指定されていれば、各 segment の端点との距離で最も近い segment を見つけ、その segment を先頭に並べ替える
3. 並べ替えた segment 列の最初の点が entry 側になるよう、必要なら配列を `reverse()` する

`renderRun` / `renderSatin` も同様:
- run: polyline の両端 (`shape.outer[0]` と `shape.outer[末尾]`) のうち entry に近い側を起点に resample
- satin: 長軸方向の 2 端を計算し、entry に近い端から `satinStitches` を生成 (現状の片端固定を反転対応に拡張)

`exit` は **最後の top stitch の座標** (= tie-off 直前の縫い目位置)。tie-off は `exit` の上で往復するので、`exit` は tie-off 末尾の back 点ではなく **anchor 点** を採用する。これにより次 object との距離は「最後の縫い終わり位置 → 次の縫い始め」で正しく計算できる。

#### Refactor

- `renderFillTopOnly` 等の「entry に応じて並び替える」処理を `orderSegmentsByEntry(segments, entry)` ユーティリティに抽出
- 3 renderer の共通フロー `(topOnly → underlay → assemble → exit)` を `renderObject(obj, ctx, entry, topOnlyFn)` 高階関数に集約する余地はあるが、本 PR では 3 関数に直書きで十分

---

### Cycle 4: `renderDesign` で object 間繋ぎを統合 + フォーマット連動

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/render.test.ts` に追記

```ts
import { describe, it, expect } from "vitest";
import { renderDesign } from "../render";
import { TRIM_POLICY_BY_FORMAT } from "../policy";
import type { EmbroideryDesign, EmbroideryObject } from "../types";

describe("renderDesign: object 間距離で繋ぎ方を切り替える", () => {
  const baseOpts = {
    widthMm: 50, heightMm: 50, widthPx: 500, heightPx: 500,
    stitchDensityMm: 0.4, satinMaxWidthMm: 6,
    disableUnderlay: true, // ノイズを減らすため underlay は無効化
    disableLockstitch: true,
    disableCompensation: true,
  };

  // 同色 2 object を距離 d で並べる helper
  const twoObjects = (gapMm: number): EmbroideryDesign => {
    const a: EmbroideryObject = {
      id: "0-0", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [5, 0], [5, 5], [0, 5]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 0,
      // Phase 3 PR2 で注入される想定の entry/exit (右下/左上)
      entry: [0, 0],
      exit: [5, 5],
    };
    const b: EmbroideryObject = {
      id: "0-1", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
      shape: {
        outer: [
          [5 + gapMm, 5], [10 + gapMm, 5], [10 + gapMm, 10], [5 + gapMm, 10],
        ],
        holes: [],
      },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 1,
      entry: [5 + gapMm, 5], // a.exit=[5,5] から距離 gapMm
      exit: [10 + gapMm, 10],
    };
    return { widthMm: 50, heightMm: 50, objects: [a, b] };
  };

  it("距離 3mm → travel run (kind=run) で繋がる、trim/jump は無い", () => {
    const design = twoObjects(3);
    const pattern = renderDesign(design, { ...baseOpts, policy: TRIM_POLICY_BY_FORMAT.dst });
    const block = pattern.blocks[0];

    // a と b の間に挿入される「繋ぎ」 stitch を探す:
    // 直前の fill が終わってから次の fill が始まるまでの間
    const fillIdxs = block.stitches.flatMap((s, i) => (s.kind === "fill" ? [i] : []));
    expect(fillIdxs.length).toBeGreaterThan(2);
    const gapStitches = block.stitches.slice(
      fillIdxs[Math.floor(fillIdxs.length / 2) - 1] + 1,
      fillIdxs[Math.floor(fillIdxs.length / 2)],
    );
    // gap には trim/jump がなく、travel run (kind=run) のみ
    expect(gapStitches.some((s) => s.kind === "trim")).toBe(false);
    expect(gapStitches.some((s) => s.kind === "jump")).toBe(false);
    expect(gapStitches.some((s) => s.kind === "run")).toBe(true);
  });

  it("距離 6mm → jump only (kind=jump)、trim 無し", () => {
    const design = twoObjects(6);
    const pattern = renderDesign(design, { ...baseOpts, policy: TRIM_POLICY_BY_FORMAT.dst });
    const stitches = pattern.blocks[0].stitches;
    const trims = stitches.filter((s) => s.kind === "trim");
    const jumps = stitches.filter((s) => s.kind === "jump");
    expect(trims).toHaveLength(0);
    expect(jumps.length).toBeGreaterThanOrEqual(1);
  });

  it("距離 10mm → trim + jump (kind=trim → kind=jump)", () => {
    const design = twoObjects(10);
    const pattern = renderDesign(design, { ...baseOpts, policy: TRIM_POLICY_BY_FORMAT.dst });
    const stitches = pattern.blocks[0].stitches;
    const trims = stitches.filter((s) => s.kind === "trim");
    const jumps = stitches.filter((s) => s.kind === "jump");
    expect(trims.length).toBeGreaterThanOrEqual(1);
    expect(jumps.length).toBeGreaterThanOrEqual(1);
    // trim の直後に jump が来る
    const trimIdx = stitches.findIndex((s) => s.kind === "trim");
    expect(stitches[trimIdx + 1].kind).toBe("jump");
  });

  it("フォーマット切替 (custom policy で travelRunUntilMm=2 に絞る) で 3mm gap の trim 数が変わる", () => {
    const design = twoObjects(3);
    const tight = { trimThresholdMm: 2.5, jumpThresholdMm: 2, travelRunUntilMm: 2 };
    const loose = TRIM_POLICY_BY_FORMAT.dst; // 5/5/8

    const tightPattern = renderDesign(design, { ...baseOpts, policy: tight });
    const loosePattern = renderDesign(design, { ...baseOpts, policy: loose });

    const tightTrims = tightPattern.blocks[0].stitches.filter((s) => s.kind === "trim").length;
    const looseTrims = loosePattern.blocks[0].stitches.filter((s) => s.kind === "trim").length;
    // tight policy では 3mm > trimThreshold(2.5) → trim 1 つ発生
    // loose policy では 3mm < travelRunUntilMm(5) → trim 0
    expect(tightTrims).toBeGreaterThan(looseTrims);
    expect(looseTrims).toBe(0);
  });

  it("locked=true の同色 object はそのまま縫う順を保つ (renderDesign は order を尊重する)", () => {
    // entry/exit は optimizeOrder が決める想定だが、ここでは locked を尊重するか
    // のみを assert する。renderDesign は design.objects の配列順そのまま縫う。
    const a: EmbroideryObject = {
      id: "0-0", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [5, 0], [5, 5], [0, 5]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 0, locked: true, entry: [0, 0], exit: [5, 5],
    };
    const b: EmbroideryObject = {
      id: "0-1", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
      shape: { outer: [[10, 10], [15, 10], [15, 15], [10, 15]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, underlay: { kind: "none" } },
      order: 1, locked: true, entry: [10, 10], exit: [15, 15],
    };
    const pattern = renderDesign(
      { widthMm: 50, heightMm: 50, objects: [a, b] },
      { ...baseOpts, policy: TRIM_POLICY_BY_FORMAT.dst },
    );
    const stitches = pattern.blocks[0].stitches;
    // 最初の fill stitch は a 由来 (左上付近)、最後の fill stitch は b 由来 (右下付近)
    const firstFill = stitches.find((s) => s.kind === "fill")!;
    const lastFill = [...stitches].reverse().find((s) => s.kind === "fill")!;
    expect(firstFill.x).toBeLessThan(7);
    expect(lastFill.x).toBeGreaterThan(8);
  });

  it("disablePathing=true なら従来挙動 (常に trim+jump、entry 無視)", () => {
    const design = twoObjects(3); // 3mm = 本来 travel run になる距離
    const pattern = renderDesign(design, {
      ...baseOpts,
      policy: TRIM_POLICY_BY_FORMAT.dst,
      disablePathing: true,
    });
    const stitches = pattern.blocks[0].stitches;
    // disablePathing 時は travel run を発火しない (kind=run の連続 fill 間 stitch が無い、
    // もしくは Phase 1 同等の trim+jump 挙動)
    // → 距離 3mm が短いので trim は出ないかもしれないが、travel run としての kind=run は混入しない
    const fillIdxs = stitches.flatMap((s, i) => (s.kind === "fill" ? [i] : []));
    const gap = stitches.slice(
      fillIdxs[fillIdxs.length / 2 - 1] + 1,
      fillIdxs[fillIdxs.length / 2],
    );
    // disablePathing 時、繋ぎは Phase 1/2 と同じく jump のみ (3mm でも jump 挿入)
    expect(gap.some((s) => s.kind === "run")).toBe(false);
  });
});
```

**失敗理由**:
- 現状の `renderDesign` は object 間繋ぎを「ステッチ生成内 (`appendStitchesWithJumps`) の force jump」に依存しており、距離に応じた `kind=run` (travel run) は生成しない
- `policy` パラメータが `RenderOptions` に未追加
- `disablePathing` フラグも未追加

#### Green — 最小実装

```ts
// src/lib/pipeline/render.ts

import { DEFAULT_TRIM_POLICY } from "./policy";
import type { TrimPolicy } from "./policy";

export type RenderOptions = {
  // ...既存...
  policy?: TrimPolicy;
  disablePathing?: boolean;
};

export function renderDesign(
  design: EmbroideryDesign,
  opts: RenderOptions,
): StitchPattern {
  const policy = opts.policy ?? DEFAULT_TRIM_POLICY;
  const ctx: RenderContext = { opts, mmPerPx: opts.widthMm / opts.widthPx };

  // 色ごとに block を構築
  const byColor = new Map<number, EmbroideryObject[]>();
  for (const obj of design.objects) {
    const arr = byColor.get(obj.colorIndex) ?? [];
    arr.push(obj);
    byColor.set(obj.colorIndex, arr);
  }
  // colorIndex 昇順 (locked / order 尊重のため、optimizeOrder 済みの配列順を維持)
  // ※ 並べ替えは optimizeOrder の責務。renderDesign は受け取った順を信頼する。

  const blocks: StitchBlock[] = [];
  let totalStitches = 0;

  for (const [colorIndex, objs] of byColor) {
    const block: StitchBlock = { colorIndex, rgb: objs[0].rgb, stitches: [] };
    let prevExit: Point2D | null = null;

    for (const obj of objs) {
      const entry: Point2D | undefined = opts.disablePathing ? undefined : obj.entry;
      const renderer =
        obj.kind === "run" ? renderRun :
        obj.kind === "satin" ? renderSatin :
        renderFill;
      const { stitches: objStitches, exit } = renderer(obj, ctx, entry);

      if (prevExit !== null) {
        const nextEntryEff: Point2D = entry ?? [objStitches[0].x, objStitches[0].y];
        const connect = opts.disablePathing
          ? buildLegacyJump(prevExit, nextEntryEff, colorIndex) // Phase 1/2 同等の jump-only
          : connectObjects(prevExit, nextEntryEff, colorIndex, policy);
        block.stitches.push(...connect);
      }
      block.stitches.push(...objStitches);
      prevExit = exit;
    }

    if (block.stitches.length > 0) {
      blocks.push(block);
      totalStitches += block.stitches.filter(
        (s) => s.kind === "run" || s.kind === "satin" || s.kind === "fill",
      ).length;
    }
  }

  // block 間 stop (Phase 1 PR4 由来)
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const last = prev.stitches[prev.stitches.length - 1];
    prev.stitches.push({
      x: last?.x ?? 0,
      y: last?.y ?? 0,
      kind: "stop",
      colorIndex: prev.colorIndex,
    });
  }

  return { widthMm: opts.widthMm, heightMm: opts.heightMm, blocks, totalStitches };
}

function buildLegacyJump(
  prev: Point2D,
  next: Point2D,
  colorIndex: number,
): Stitch[] {
  // Phase 1/2 互換: 距離に関わらず jump 1 stitch のみ (trim は appendStitchesWithJumps が判定する想定)
  // disablePathing=true は「Phase 3 機能を OFF」なので、travel run は出さない。
  // trim 判定は legacy 経路では行わず単純 jump とする (本 PR では従来挙動を「ゆるく」再現)。
  return [{ x: next[0], y: next[1], kind: "jump", colorIndex }];
}
```

#### Refactor

- `byColor` の構築は `groupByColor(objects)` ユーティリティに抽出
- `buildLegacyJump` を `connectObjectsLegacy(prev, next, colorIndex)` にリネームし、対称的に並べる
- block 間 stop 挿入を `emitColorStops(blocks)` に抽出

---

### Cycle 5: `compose.ts` で `optimizeOrder` + `policy` を配線

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/compose.test.ts` (既存なら追記、新規ならファイル作成)

```ts
import { describe, it, expect, vi } from "vitest";
import * as pathingModule from "../pathing";
import { runStitchAndWrite } from "../compose"; // もしくは "../index"
import { TRIM_POLICY_BY_FORMAT } from "../policy";
import type { ConversionConfig } from "@/components/embroidery-studio";

const baseConfig: ConversionConfig = {
  format: "dst",
  widthMm: 50,
  colorCount: 4,
  stitchDensity: 0.4,
  satinMaxWidthMm: 5,
  smoothing: 0,
  boundaryDilatePx: 0,
  fillAngleDeg: 0,
  fillAngleByColor: {},
  fillStrategy: "global-angle",
};

describe("compose.ts: optimizeOrder を render 直前に呼ぶ", () => {
  it("runStitchAndWrite を実行すると optimizeOrder が 1 回呼ばれる", async () => {
    const spy = vi.spyOn(pathingModule, "optimizeOrder");
    const pre = {
      regions: [/* 最小限の region 1 個 */],
      widthMm: 50, heightMm: 50, widthPx: 500, heightPx: 500,
    };
    await runStitchAndWrite(pre, baseConfig);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("format=pes で呼ぶと renderDesign に TRIM_POLICY_BY_FORMAT.pes が渡る", async () => {
    // renderDesign を spy して opts.policy をキャプチャ
    const renderModule = await import("../render");
    const spy = vi.spyOn(renderModule, "renderDesign");
    const pre = {
      regions: [/* ... */], widthMm: 50, heightMm: 50, widthPx: 500, heightPx: 500,
    };
    await runStitchAndWrite(pre, { ...baseConfig, format: "pes" });
    const calledOpts = spy.mock.calls[0][1];
    expect(calledOpts.policy).toEqual(TRIM_POLICY_BY_FORMAT.pes);
    spy.mockRestore();
  });

  it("format=dst と format=pes で trim 数が同値 (初期テーブルが同じなので)", async () => {
    // 初期値テーブルでは dst/pes 同値だが、将来差をつけたときにこのテストが
    // 自然に "違っていればパスしない" 形でフォーマット連動を検出する
    const pre = {
      regions: [/* 同じ ... */], widthMm: 50, heightMm: 50, widthPx: 500, heightPx: 500,
    };
    const dstResult = await runStitchAndWrite(pre, { ...baseConfig, format: "dst" });
    const pesResult = await runStitchAndWrite(pre, { ...baseConfig, format: "pes" });
    const dstTrims = dstResult.pattern.blocks.flatMap((b) =>
      b.stitches.filter((s) => s.kind === "trim"),
    ).length;
    const pesTrims = pesResult.pattern.blocks.flatMap((b) =>
      b.stitches.filter((s) => s.kind === "trim"),
    ).length;
    expect(dstTrims).toBe(pesTrims);
  });
});
```

**失敗理由**:
- `compose.ts` (もしくは `runStitchAndWrite` 経路) が `optimizeOrder` を呼んでいない
- `policy` が `RenderOptions` に渡されていない (Cycle 4 で型は追加済みだが配線がない)

#### Green — 最小実装

```ts
// src/lib/pipeline/compose.ts (もしくは index.ts)

import { optimizeOrder } from "./pathing";
import { TRIM_POLICY_BY_FORMAT } from "./policy";
import { renderDesign } from "./render";

export async function runStitchAndWrite(
  pre: PrepipelineResult,
  config: ConversionConfig,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  onProgress?.({ stage: "stitch", percent: 75 });

  // Phase 1 PR3 由来: pre.regions → EmbroideryDesign に変換
  const rawDesign = buildDesignFromRegions(pre, config);

  // Phase 3 PR3: render の直前で optimizeOrder を呼ぶ
  const orderedDesign = optimizeOrder(rawDesign);

  // フォーマット連動 policy
  const policy = TRIM_POLICY_BY_FORMAT[config.format];

  const pattern = renderDesign(orderedDesign, {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    widthPx: pre.widthPx,
    heightPx: pre.heightPx,
    stitchDensityMm: config.stitchDensity,
    satinMaxWidthMm: config.satinMaxWidthMm,
    // Phase 2 PR4 由来のフラグ
    disableUnderlay: config.disableUnderlay ?? false,
    disableCompensation: config.disableCompensation ?? false,
    // Phase 3 PR3 新規
    policy,
    // disablePathing は ConversionConfig に出さず、デバッグ専用 (内部 API)
  });

  onProgress?.({ stage: "write", percent: 90 });
  const fileBlob = await writeEmbroidery({ pattern, format: config.format });

  return { pattern, fileBlob };
}
```

#### Refactor

- `TRIM_POLICY_BY_FORMAT[config.format]` の lookup を `resolvePolicy(config)` に抽出 (将来 user override や fabric 連動を入れる際の差し込み口)
- `buildDesignFromRegions` は Phase 1 PR3 の `buildObjects` を内包する既存ヘルパで、本 PR では touch しない

---

## 7. サイクル依存グラフ

```
Cycle 1 (policy.ts)
  ↓
Cycle 2 (connectObjects ヘルパ)
  ↓
Cycle 3 (renderer に entry/exit)
  ↓
Cycle 4 (renderDesign 統合 + フォーマット連動)
  ↓
Cycle 5 (compose.ts 配線 + optimizeOrder 呼び出し)
```

各サイクル境界で `npx vitest run` の全件 green が必須。**Cycle 3 で renderer の戻り値型が `Stitch[]` → `RenderResult` に互換破壊するため、その時点で `renderDesign` (Cycle 4 で改修予定) のコンパイルエラーが発生する**。対策として:

- Cycle 3 の Green 時点では `renderDesign` 内の renderer 呼び出しを一時的に `.stitches` で unwrap するだけのパッチを当てる (Cycle 4 で正式に exit も使う形に置き換え)
- もしくは Cycle 3 と Cycle 4 を 1 つの作業セッションで連続して行い、コミット粒度のみ分ける

## 8. 回帰防止

1. **Cycle 1 (policy.ts) は新規ファイル追加のみ** → 既存テストに影響しない。Cycle 開始時に `npx vitest run` 全件 green を確認
2. **Cycle 2 (connectObjects) は内部ヘルパの追加のみ** → 既存呼び出しなし、回帰なし
3. **Cycle 3 (renderer シグネチャ変更) で互換破壊**:
   - Phase 1 PR4 の `renderDesign equivalence` テスト (= Phase 1 generateStitches と件数一致を assert するもの) は **本 PR で完全に壊れる** (travel run が追加されるため)。これは Phase 3 の意図通り
   - 同テストを「**`disablePathing=true && disableUnderlay=true && disableLockstitch=true && disableCompensation=true` で Phase 1 と一致**」に書き換える (= Phase 2 PR4 で導入した disable* フラグ群に `disablePathing` を 1 つ追加する形)
   - Phase 2 PR4 の equivalence テストも同様に `disablePathing: true` を追加して件数一致を再確認
4. **Phase 3 PR1, PR2 のテスト** (`pathing.test.ts`, `entry-exit.test.ts`) は touch しない。renderer 経路に組み込むだけなので、pathing 単体テストは引き続き green
5. **既存 stitch.test.ts** (`appendStitchesWithJumps`, `intersectScanline`, `fillStitches` 等) は touch しない。本 PR で `stitch.ts` を改修しないため
6. **「Phase 3 機能を無効化するフラグ」**: 本 PR で導入する `disablePathing: true` を立てた状態で `renderDesign` を呼ぶと、object 間繋ぎは「常に jump only」(= Phase 1/2 同等) になることを assert (Cycle 4 の最後のテスト)

**Cycle 3 のコミット前に Phase 1 PR4 の equivalence テストを `it.skip` でマーク**し、Cycle 4 でフラグ条件を追加した状態で skip 解除する運用を取る。これで `git bisect` 時にも各コミットが local green になる。

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/policy.ts` が新規作成され、`TrimPolicy` 型と `TRIM_POLICY_BY_FORMAT` 定数を export している
- [ ] `TRIM_POLICY_BY_FORMAT` が 5 フォーマット (`dst`/`pes`/`jef`/`exp`/`vp3`) すべてに対し計画書 7 のテーブル値 `{trim:8, jump:5, travelRun:5}` を持つ
- [ ] `DEFAULT_TRIM_POLICY` が `TRIM_POLICY_BY_FORMAT.dst` と等しい
- [ ] `connectObjects(prev, next, colorIndex, policy)` が距離に応じて以下を返す:
  - 距離 < `travelRunUntilMm` → `[{ kind: "run", x: next.x, y: next.y, colorIndex }]`
  - `travelRunUntilMm` <= 距離 < `trimThresholdMm` → `[{ kind: "jump", ... }]`
  - 距離 >= `trimThresholdMm` → `[{ kind: "trim", x: prev.x, y: prev.y, ... }, { kind: "jump", x: next.x, y: next.y, ... }]`
- [ ] `renderRun` / `renderSatin` / `renderFill` のシグネチャが `(obj, ctx, entry?: Point2D) => RenderResult` (`{ stitches: Stitch[]; exit: Point2D }`) になっている
- [ ] entry を指定すると renderer は **entry に最も近い位置から縫い始める** (fill は scanline 順を反転、run は polyline の起点を逆転、satin は長軸方向で起点を切替)
- [ ] entry 未指定でも renderer はクラッシュせず、従来の起点 (`polygon[0]`) から縫う (後方互換)
- [ ] `renderDesign` が同色 object 間に `connectObjects` の結果を挿入する
- [ ] **同色** object 間距離 3mm で travel run (kind=run) のみ挿入される (trim/jump 無し) — Phase 3 計画書 9 のサンプル
- [ ] **同色** object 間距離 6mm で jump のみ挿入される (trim 無し) — Phase 3 計画書 9 のサンプル
- [ ] **同色** object 間距離 10mm で trim → jump の順で 2 stitch 挿入される — Phase 3 計画書 9 のサンプル
- [ ] `RenderOptions` に `policy?: TrimPolicy` と `disablePathing?: boolean` が追加されている
- [ ] フォーマット切替: `config.format` を `"dst"` から `"pes"` に変えると `renderDesign` 呼び出し時の `opts.policy` が `TRIM_POLICY_BY_FORMAT.pes` になる
- [ ] **locked=true の同色 object** はそのまま縫う順を保つ (`renderDesign` は受け取った配列順を信頼し、並べ替えは `optimizeOrder` 側の責務)
- [ ] **renderer が `entry` を受け取って正しい点から縫い始める** (Cycle 3 のテストで assert 済み)
- [ ] `runStitchAndWrite` (もしくは `compose.ts`) 内で `optimizeOrder(design)` が `renderDesign` 呼び出しの直前に 1 回呼ばれる
- [ ] **Phase 3 機能を無効化するフラグ (`disablePathing=true`) で従来挙動 (Phase 1/2 と同等の jump-only 接続) を再現できる**
- [ ] Phase 1 PR4 の `renderDesign equivalence` テストが、`disablePathing: true` を含む全 disable フラグ条件下で **Phase 1 `generateStitches` と stitch 座標完全一致** することを assert
- [ ] `npx vitest run` 全件 green
- [ ] `npx tsc --noEmit` で型エラーなし
- [ ] Phase 3 計画書 10 の受け入れ条件「trim 数が Phase 2 と比べて 30% 以上減ること」は本 PR の自動テスト範囲外 (実画像ベースの目視・統計検証は別途 PR で実施)

## 10. コミット粒度

| Commit | サイクル | 内容 |
|---|---|---|
| 1 | Cycle 1 Red | `test(pipeline): add failing tests for TRIM_POLICY_BY_FORMAT (phase 3 pr3)` |
| 2 | Cycle 1 Green | `feat(pipeline): add policy.ts with TRIM_POLICY_BY_FORMAT (phase 3 pr3)` |
| 3 | Cycle 2 Red | `test(pipeline): add failing tests for connectObjects (phase 3 pr3)` |
| 4 | Cycle 2 Green | `feat(pipeline): add connectObjects with travel-run/jump/trim+jump branching` |
| 5 | Cycle 3 Red | `test(pipeline): add failing tests for renderer entry/exit API` |
| 6 | Cycle 3 Green | `feat(pipeline): make renderers accept entry and return exit (RenderResult)` |
| 7 | Cycle 3 Refactor | `refactor(pipeline): extract orderSegmentsByEntry helper` |
| 8 | Cycle 4 Red | `test(pipeline): add failing tests for renderDesign object-gap routing` |
| 9 | Cycle 4 Green | `feat(pipeline): route same-color object gaps via policy in renderDesign` |
| 10 | Cycle 4 Refactor | `refactor(pipeline): unify legacy/policy gap building under connectObjects(Legacy)` |
| 11 | Cycle 5 Red | `test(pipeline): add failing tests for compose calling optimizeOrder + policy wiring` |
| 12 | Cycle 5 Green | `feat(pipeline): call optimizeOrder before renderDesign and pass per-format policy` |

各コミット境界で `npx vitest run` が green であることが必須条件。**Cycle 3 の Red と Green の間は equivalence テストが skip 状態**になるため、Cycle 4 Green で skip 解除して全件 green に戻す。

## 11. 想定 PR タイトル

`feat(pipeline): add travel-run / trim policy and order-aware renderer (phase 3 pr3)`

## 12. 注意事項

- **Phase 3 計画書 5 (Travel Run vs Trim+Jump) を厳守**: 本 PR では「直線 travel run のみ」。既存縫い下に潜らせる経路 (計画書 5.1) は **発展課題** として実装しない。`assembleWithLockstitch` / `connectObjects` 周辺に「Phase 3 v2 で edge-trace travel に差し替える fork point」のコメントを残す
- **travel run は 1 stitch 直線**: `connectObjects` から返る travel run は `kind="run"` の 1 stitch のみ。`maxStitchMm` を超える距離でも分割しない (Phase 3 計画書 5)。`travelRunUntilMm` (= 既定 5mm) <= `maxStitchMm` (= 7mm) の前提が崩れる場合は将来検討
- **trim の座標は prev 側で発火**: trim は針位置を動かさず「現在位置で糸を切る」コマンドなので、座標は `prev.x, prev.y` で記録する (既存 `appendStitchesWithJumps` と同じ規約)
- **block 間 (色替え) の繋ぎは本 PR の対象外**: Phase 3 計画書 7 末尾「DST は STOP コマンド」の通り、block 境界には引き続き `kind="stop"` を挿入。block 内 (同色) のみが本 PR の travel/jump/trim 対象
- **Phase 2 PR4 の tie-in/underlay/top/tie-off 合成順を維持**: travel run / jump / trim は **`tie-off` の後** に挿入される。連鎖は `[obj.A: tie-in, underlay, top, tie-off] → [travel run | jump | trim+jump] → [obj.B: tie-in, ...]`。Phase 2 PR4 計画書の fork point コメント「travel-connected なら tie-in/off を省略」は **本 PR では実装しない** (発展課題、Phase 3 v2)
- **`disablePathing` を `ConversionConfig` には露出しない**: production では常に Phase 3 機能が有効。フラグは `RenderOptions` レベル (内部 API) のみで露出し、テストとデバッグ用途
- **`obj.entry` / `obj.exit` / `obj.locked`** は Phase 3 PR2 で `optimizeOrder` が注入する前提。本 PR で `EmbroideryObject` 型に新フィールドを追加する場合は `types.ts` を編集するが、**型追加は PR2 の責務であって本 PR では参照のみ**。型が無ければ PR2 の差し戻し対象
- **renderer の entry 未指定時の挙動**: 後方互換のため、entry 未指定なら従来の `polygon[0]` 起点で縫う。テストでも明示的に検証する
- **「Phase 3 機能を無効化するフラグ」**: `disablePathing: true` は (a) `entry` を無視して renderer を従来挙動に戻し、(b) `connectObjects` を呼ばず `buildLegacyJump` (= jump only) で繋ぐ。**Phase 1 PR4 の equivalence テストはこのフラグを含む全 disable 条件下で Phase 1 と完全一致**することを assert する
- **既存テストの保護**: `stitch.test.ts` の `appendStitchesWithJumps`, `intersectScanline`, `fillStitches`, `resolveShapeFillAngle` は touch しない。Cycle 3 で fail するのは `renderDesign equivalence` (Phase 1 PR4 由来) 1 件のみが想定。それ以外が fail したら即停止して原因究明
- **`maxStitchMm` の取り扱い**: travel run は本 PR では `maxStitchMm` で分割しない。将来 travel run の距離 > `maxStitchMm` を扱う必要が出たら別 PR で `appendStitchesWithJumps` に相当する travel-run-resampler を導入する
