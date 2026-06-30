# Phase 1 PR5: 設定 UI 統合 + 生地セレクト — TDD計画

## 1. 概要

Phase 1 Foundation の最終 PR。`ConversionConfig` に `fabric: FabricKind` フィールドを追加し、`conversion-settings.tsx` に生地セレクト UI を導入する。
ユーザーが触っていない数値設定（`stitchDensity` 等）は **fabric override 扱い**とし、生地切替時に fabric の `defaultDensityMm` が自動反映される。
一方、ユーザーがスライダで一度上書きした値（override 状態）は生地切替で消えない。
PR1 (`FabricKind`)、PR2 (`FABRIC_PROFILES`, `pullCompForWidth`) に依存し、ランタイム的には PR3/PR4 後にマージする方が `compose.convertImageToEmbroideryDirect` への `fabric` 引数の受け渡しが整合する。

## 2. 依存関係

- **必須 (型・データ依存)**: PR1 (`FabricKind` 型), PR2 (`FABRIC_PROFILES`, `pullCompForWidth`)
- **推奨マージ順 (ランタイム整合)**: PR3 (`build-objects.ts`), PR4 (`stitch.ts` リファクタ) 完了後にマージする
- PR3/PR4 が未完了でも、本 PR 単体で UI と config モデルは独立に成立する（fabric 値がパイプラインに渡らないだけで型・挙動は正しい）

## 3. テスト環境

- フレームワーク: **Vitest** (`vitest@^4.1.6`)
- 実行コマンド: `npm test` (= `vitest run`)
- テストファイル配置: `src/**/__tests__/*.test.ts` (vitest.config.ts の include パターン)
- DOM 環境: 現在 `environment: "node"`。UI コンポーネントの DOM テストは行わず、**configの派生ロジックを切り出した純関数のテスト**で挙動を検証する
- React Testing Library は未導入。本 PR では導入しない（ロジックの純関数化で十分カバーできる）

## 4. 影響ファイル

### 編集
- `src/components/embroidery-studio.tsx`
  - `ConversionConfig` に `fabric: FabricKind` 追加
  - `ConversionConfig` に `overrides: Partial<Record<FabricOverrideKey, true>>` を追加（どのフィールドがユーザー上書き済みかを記録）
  - `defaultConfig` に `fabric: "denim"` を追加し、`stitchDensity` の初期値を `FABRIC_PROFILES.denim.defaultDensityMm` から派生させる
  - `onConfigChange` で「fabric が変わったらユーザー未上書きの fabric-driven フィールドだけを再派生」させるロジックを追加（純関数 `applyFabricDefaults` に切り出す）

### 編集
- `src/components/conversion-settings.tsx`
  - 一番上に生地セレクト (`Select`) を追加
  - 生地切替時は `onChange` 経由で fabric 由来フィールドの再派生をトリガ
  - `stitchDensity` スライダ等の `onChange` で `overrides[<key>] = true` を立てる
  - 「fabric 既定値に戻す」リンクボタンを各 override 済みフィールドに表示（任意機能、UX 補助）

### 新規
- `src/lib/pipeline/__tests__/config.test.ts`
  - 純関数 `applyFabricDefaults(prev, nextFabric)` の挙動テスト
  - `makeDefaultConfig(fabric)` で `stitchDensity` が `FABRIC_PROFILES[fabric].defaultDensityMm` と一致することのテスト

### 新規
- `src/lib/pipeline/config.ts`
  - `makeDefaultConfig(fabric: FabricKind): ConversionConfig`
  - `applyFabricDefaults(prev: ConversionConfig, nextFabric: FabricKind): ConversionConfig`
  - `FabricOverrideKey` 型 (`"stitchDensity" | "satinMaxWidthMm" | ...` の union)
  - UI とロジックを分離するための薄い層

## 5. インターフェース設計

```typescript
// src/lib/pipeline/config.ts (新規)

import type { FabricKind } from "./types";
import { FABRIC_PROFILES } from "./fabric";
import type { ConversionConfig } from "@/components/embroidery-studio";

/** fabric によって既定値が変わるフィールド名 */
export type FabricOverrideKey = "stitchDensity";
// 将来 satinMaxWidthMm 等も追加可能。Phase 1 では stitchDensity のみ fabric driven。

/** fabric を指定して初期 ConversionConfig を作る */
export function makeDefaultConfig(fabric: FabricKind): ConversionConfig;

/**
 * fabric 切替時に、ユーザーが触っていない fabric-driven フィールドだけを
 * 新しい fabric の既定値に差し替えた config を返す。
 * overrides に key が立っているフィールドは保持される。
 */
export function applyFabricDefaults(
  prev: ConversionConfig,
  nextFabric: FabricKind,
): ConversionConfig;
```

```typescript
// src/components/embroidery-studio.tsx (拡張部のみ)

export type ConversionConfig = {
  format: EmbroideryFormat;
  fabric: FabricKind;                          // NEW
  widthMm: number;
  colorCount: number;
  stitchDensity: number;
  satinMaxWidthMm: number;
  smoothing: number;
  boundaryDilatePx: number;
  fillAngleDeg: number;
  fillAngleByColor: Record<number, number>;
  fillStrategy: FillStrategy;
  /** ユーザーが明示的に上書きした fabric-driven フィールドの集合 */
  overrides: Partial<Record<FabricOverrideKey, true>>; // NEW
};

export const defaultConfig: ConversionConfig = makeDefaultConfig("denim");
```

## 6. ファイル構成

- `src/lib/pipeline/config.ts` — 新規
- `src/lib/pipeline/__tests__/config.test.ts` — 新規
- `src/components/embroidery-studio.tsx` — 編集（型に `fabric`, `overrides` 追加 / `defaultConfig` 派生化 / `onConfigChange` 拡張）
- `src/components/conversion-settings.tsx` — 編集（生地セレクト追加 / override マーキング）

## 7. TDD サイクル

### Cycle 1: ConversionConfig のデフォルトに fabric: "denim" が入り、stitchDensity が denim の defaultDensityMm と一致する

#### Red — 失敗するテスト

```typescript
// src/lib/pipeline/__tests__/config.test.ts
import { describe, it, expect } from "vitest";
import { makeDefaultConfig } from "../config";
import { FABRIC_PROFILES } from "../fabric";

describe("makeDefaultConfig", () => {
  it("denim を渡すと fabric='denim' で stitchDensity=0.4 になる", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.fabric).toBe("denim");
    expect(cfg.stitchDensity).toBe(FABRIC_PROFILES.denim.defaultDensityMm);
    expect(cfg.stitchDensity).toBeCloseTo(0.4);
    expect(cfg.overrides).toEqual({});
  });

  it("terry を渡すと stitchDensity=0.42 になる", () => {
    const cfg = makeDefaultConfig("terry");
    expect(cfg.fabric).toBe("terry");
    expect(cfg.stitchDensity).toBeCloseTo(0.42);
  });

  it("既存フィールド (widthMm, colorCount, format 等) は従来のデフォルトを保つ", () => {
    const cfg = makeDefaultConfig("denim");
    expect(cfg.format).toBe("dst");
    expect(cfg.widthMm).toBe(100);
    expect(cfg.colorCount).toBe(6);
    expect(cfg.satinMaxWidthMm).toBe(5);
    expect(cfg.smoothing).toBe(2);
    expect(cfg.boundaryDilatePx).toBe(1);
    expect(cfg.fillAngleDeg).toBe(45);
    expect(cfg.fillAngleByColor).toEqual({});
    expect(cfg.fillStrategy).toBe("global-angle");
  });
});
```

失敗理由:
- `src/lib/pipeline/config.ts` が未作成のため import エラー
- `ConversionConfig` に `fabric` / `overrides` フィールドが存在しないため型エラー

#### Green — 最小実装

- **変更**: `src/components/embroidery-studio.tsx`
  - `ConversionConfig` に `fabric: FabricKind` と `overrides: Partial<Record<FabricOverrideKey, true>>` を追加（型のみ）
  - `import type { FabricKind } from "@/lib/pipeline/types"` を追加
  - `import { makeDefaultConfig } from "@/lib/pipeline/config"` を追加
  - `defaultConfig` を `makeDefaultConfig("denim")` に置換
- **新規**: `src/lib/pipeline/config.ts`
  - `FabricOverrideKey = "stitchDensity"` を export
  - `makeDefaultConfig(fabric)` を実装。`FABRIC_PROFILES[fabric].defaultDensityMm` で `stitchDensity` を埋め、他フィールドは現行 `defaultConfig` の値をベタに返す

#### Refactor

- 不要（最初のサイクル。新規モジュールの基本骨格を作っただけ）

---

### Cycle 2: fabric 切替で stitchDensity が新しい defaultDensityMm に追従する（未 override の場合）

#### Red — 失敗するテスト

```typescript
// src/lib/pipeline/__tests__/config.test.ts (追記)
import { applyFabricDefaults } from "../config";

describe("applyFabricDefaults", () => {
  it("未 override の状態で denim → terry に切り替えると stitchDensity が 0.42 に追従する", () => {
    const prev = makeDefaultConfig("denim");
    expect(prev.stitchDensity).toBeCloseTo(0.4);

    const next = applyFabricDefaults(prev, "terry");
    expect(next.fabric).toBe("terry");
    expect(next.stitchDensity).toBeCloseTo(0.42);
    expect(next.overrides).toEqual({});
  });

  it("fabric 以外のフィールドはそのまま維持される", () => {
    const prev = { ...makeDefaultConfig("denim"), widthMm: 200, colorCount: 8, fillAngleDeg: 30 };
    const next = applyFabricDefaults(prev, "knit-heavy");
    expect(next.widthMm).toBe(200);
    expect(next.colorCount).toBe(8);
    expect(next.fillAngleDeg).toBe(30);
  });

  it("同じ fabric を再指定しても idempotent (副作用なし)", () => {
    const prev = makeDefaultConfig("twill");
    const next = applyFabricDefaults(prev, "twill");
    expect(next).toEqual(prev);
  });
});
```

失敗理由: `applyFabricDefaults` が未実装のため import エラー

#### Green — 最小実装

- **変更**: `src/lib/pipeline/config.ts`
  - `applyFabricDefaults(prev, nextFabric)` を実装
  - `prev.overrides.stitchDensity` が立っていなければ `stitchDensity = FABRIC_PROFILES[nextFabric].defaultDensityMm` で差し替え
  - `fabric` フィールドを `nextFabric` に更新
  - その他フィールドは spread で維持

#### Refactor

- 不要（純関数 1 つ追加だけ。重複なし）

---

### Cycle 3: ユーザーが上書きした stitchDensity は fabric 切替で消えない（override 保持）

#### Red — 失敗するテスト

```typescript
// src/lib/pipeline/__tests__/config.test.ts (追記)

describe("applyFabricDefaults — override 保持", () => {
  it("overrides.stitchDensity=true が立っていれば fabric 切替で stitchDensity が消えない", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.55, // ユーザーが上書きした値
      overrides: { stitchDensity: true },
    };

    const next = applyFabricDefaults(prev, "terry");
    expect(next.fabric).toBe("terry");
    expect(next.stitchDensity).toBeCloseTo(0.55); // 0.42 にならない
    expect(next.overrides.stitchDensity).toBe(true);
  });

  it("override が空 ({}) なら fabric 切替で stitchDensity が追従する (Cycle 2 と整合)", () => {
    const prev: ConversionConfig = {
      ...makeDefaultConfig("denim"),
      stitchDensity: 0.4,
      overrides: {},
    };
    const next = applyFabricDefaults(prev, "terry");
    expect(next.stitchDensity).toBeCloseTo(0.42);
  });
});
```

失敗理由: Cycle 2 で実装した `applyFabricDefaults` は overrides を見ていないため、override 値も 0.42 で上書きされてしまう

#### Green — 最小実装

- **変更**: `src/lib/pipeline/config.ts`
  - `applyFabricDefaults` 内で `if (!prev.overrides.stitchDensity) { ... }` の分岐を追加
  - override 済みなら `prev.stitchDensity` をそのまま使う

#### Refactor

- `applyFabricDefaults` 内で fabric-driven フィールドのループ処理に整理する余地あり：
  - `FABRIC_DRIVEN_FIELDS: { key: FabricOverrideKey; derive: (p: FabricProfile) => number }[]` のテーブルを定義し、
    各フィールドを宣言的に再派生する形にリファクタ
  - Phase 1 では fabric-driven が `stitchDensity` のみなのでテーブル化のメリットは小さいが、Phase 2 以降で `satinMaxWidthMm` 等を追加する際の拡張点として明示しておく
  - テーブル化後も全テストパスすることを確認

---

### Cycle 4: UI 統合 — 生地セレクト追加 + override マーキング（手動確認 + 統合的 unit test）

#### Red — 失敗するテスト

```typescript
// src/lib/pipeline/__tests__/config.test.ts (追記)

describe("UI 統合シナリオ (純関数で再現)", () => {
  it("シナリオ: denim 起動 → stitchDensity スライダで 0.5 に → fleece に切替 → stitchDensity=0.5 のまま", () => {
    // 1) 起動時
    let cfg = makeDefaultConfig("denim");
    expect(cfg.stitchDensity).toBeCloseTo(0.4);

    // 2) ユーザーがスライダで 0.5 に変更 (UI 側の onChange で overrides を立てる)
    cfg = { ...cfg, stitchDensity: 0.5, overrides: { ...cfg.overrides, stitchDensity: true } };

    // 3) 生地セレクトで fleece に切替
    cfg = applyFabricDefaults(cfg, "fleece");

    expect(cfg.fabric).toBe("fleece");
    expect(cfg.stitchDensity).toBeCloseTo(0.5); // 維持
  });

  it("シナリオ: denim → terry → leather と切替し、いずれも未 override なら defaultDensityMm に追従", () => {
    let cfg = makeDefaultConfig("denim");
    cfg = applyFabricDefaults(cfg, "terry");
    expect(cfg.stitchDensity).toBeCloseTo(0.42);
    cfg = applyFabricDefaults(cfg, "leather");
    expect(cfg.stitchDensity).toBeCloseTo(0.50);
  });
});
```

失敗理由: Cycle 1-3 までで通る想定だが、シナリオを並べることで純関数の使い方が破綻していないか確認する回帰テスト。新しい関数追加は不要。実装側 (UI) を統合するときに使う仕様書として機能する

#### Green — 最小実装

- **変更**: `src/components/conversion-settings.tsx`
  - 一番上に「生地」セクションを追加：

    ```tsx
    const FABRICS: { value: FabricKind; label: string }[] = [
      { value: "denim", label: "デニム" },
      { value: "twill", label: "ツイル" },
      { value: "canvas", label: "キャンバス" },
      { value: "knit-light", label: "ニット (薄手)" },
      { value: "knit-heavy", label: "ニット (厚手)" },
      { value: "terry", label: "パイル (タオル地)" },
      { value: "fleece", label: "フリース" },
      { value: "leather", label: "レザー" },
      { value: "silk", label: "シルク" },
      { value: "felt", label: "フェルト" },
    ];

    <div className="space-y-2">
      <Label>生地</Label>
      <Select
        value={value.fabric}
        onValueChange={(v) => onChange(applyFabricDefaults(value, v as FabricKind))}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {FABRICS.map((f) => (
            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    ```

  - `stitchDensity` の `SliderField.onChange` を `(v) => onChange({ ...value, stitchDensity: v, overrides: { ...value.overrides, stitchDensity: true } })` に変更
  - 他フィールド（`widthMm`, `colorCount` 等）は fabric-driven ではないため override マーキング不要

- **変更**: `src/components/embroidery-studio.tsx`
  - 既存 `onConfigChange` は触らない（fabric 切替時の差し替えは `conversion-settings.tsx` 側で `applyFabricDefaults` を呼ぶことで完結する）
  - キャッシュ無効化判定 (`invalidates`) に `fabric` の変化を含めるか検討:
    - 本 PR では fabric はパイプライン下流に渡らない（PR3/PR4 で渡るようになる）ため、いったん `invalidates` には追加しない
    - PR3/PR4 マージ時に追記する旨をコメントで残す

#### Refactor

- UI コンポーネント側に `applyFabricDefaults` をベタ呼びしているのを、`onChange` を `(next: ConversionConfig) => void` から `(updater: (prev) => next) => void` に変える案もあるが、既存シグネチャ互換を優先して **本 PR では現状維持**
- `conversion-settings.tsx` の `update` ヘルパに override マーキング機能を持つ `updateWithOverride<K extends FabricOverrideKey>` を追加し、UI 側で `update("stitchDensity", v)` の代わりに `updateWithOverride("stitchDensity", v)` を呼ぶ形に整理（関心の分離：UI 状態と設定モデルの結合点を 1 箇所に集める）

## 8. サイクル依存グラフ

```
Cycle 1 (defaultConfig 派生化)
   ↓
Cycle 2 (applyFabricDefaults 基本動作)
   ↓
Cycle 3 (override 保持ロジック)
   ↓
Cycle 4 (UI 統合 + 統合シナリオテスト)
```

各サイクルは前のサイクルの公開関数を前提とするため、上から順に実装する。

## 9. 回帰防止

- 既存テスト `src/lib/pipeline/__tests__/stitch.test.ts` および `vectorize.test.ts` が **全件パス**することを確認
- 既存の `defaultConfig` を import している箇所（`embroidery-studio.tsx` のみ）の挙動が変わらない
  - `defaultConfig.stitchDensity === 0.4` は維持される（`FABRIC_PROFILES.denim.defaultDensityMm` が 0.4 のため）
  - 他フィールドの初期値は完全に一致
- `ConversionConfig` の既存フィールドは破壊変更なし（追加のみ）
- `npm test` および `npm run lint` が成功すること

## 10. 受け入れ条件

### ロジック (unit test)
- [ ] `npm test` が全件パス（新規 `config.test.ts` 含む）
- [ ] `makeDefaultConfig("denim").stitchDensity === 0.4`
- [ ] `makeDefaultConfig("terry").stitchDensity === 0.42`
- [ ] `applyFabricDefaults` が idempotent
- [ ] override 済みフィールドは fabric 切替で保持される

### 型
- [ ] `ConversionConfig.fabric: FabricKind` が必須フィールドとして追加されている
- [ ] `ConversionConfig.overrides: Partial<Record<FabricOverrideKey, true>>` が追加されている
- [ ] 既存フィールドが破壊されていない
- [ ] `npm run lint` が成功

### UI (手動ブラウザ確認)
- [ ] `npm run dev` でアプリ起動後、左側「2. パラメータを調整」カード内の最上段に「生地」セレクトが表示される
- [ ] セレクト初期値が「デニム」(denim) になっている
- [ ] 「ステッチ密度」スライダ初期値が 0.4mm になっている
- [ ] 生地を「パイル (タオル地)」(terry) に切り替えると、ステッチ密度スライダが 0.42mm に自動更新される
- [ ] 生地を「レザー」(leather) に切り替えると、ステッチ密度スライダが 0.50mm に自動更新される
- [ ] ステッチ密度スライダを 0.55mm に手動変更してから生地を「フリース」(fleece) に切り替えても、ステッチ密度スライダは 0.55mm のまま維持される
- [ ] その後 0.55 の状態でブラウザリロードすると初期値 (0.4mm, denim) に戻る（状態がメモリのみなのは想定通り）
- [ ] 画像をアップロードして「刺繍データを生成」を押すと、従来通り変換が完了する（fabric 値はまだパイプライン下流に流れていないが UI フリーズや例外なし）

## 11. コミット粒度

- **commit 1**: `feat(pipeline): add makeDefaultConfig and fabric field to ConversionConfig`
  - Cycle 1 (Red + Green)
- **commit 2**: `feat(pipeline): add applyFabricDefaults for fabric-driven config derivation`
  - Cycle 2 (Red + Green)
- **commit 3**: `feat(pipeline): preserve user overrides when switching fabric`
  - Cycle 3 (Red + Green + Refactor)
- **commit 4**: `feat(ui): add fabric selector and override marking in conversion settings`
  - Cycle 4 (Red + Green + Refactor)

各コミット時点で `npm test` および `npm run lint` が通る状態を維持する。

## 12. 想定 PR タイトル

```
feat(ui): add fabric selector and fabric-driven config defaults (phase 1 pr5)
```

## 13. 注意事項・実装メモ

- **fabric を pipeline 下流に渡すのは別 PR**: 本 PR は UI と config モデルのみ。`runPrepipeline` / `runStitchAndWrite` のシグネチャは触らない。PR3/PR4 で `compose.convertImageToEmbroideryDirect` に `fabric` を渡すようになった後、本 PR の後続でフォローアップする
- **キャッシュ無効化への影響**: `embroidery-studio.tsx` の `onConfigChange` 内 `invalidates` 判定に `fabric` を含めるかは、fabric がパイプラインに渡るようになってから検討。本 PR では未対応 + TODO コメント
- **DOM テスト未導入の理由**: React Testing Library を導入すると vitest.config.ts の `environment` を `jsdom` に変更する必要があり、本 PR のスコープから外れる。Phase 1 では純関数化したロジックを unit test で抑え、UI は手動受け入れ確認で十分
- **override の永続化なし**: 現状の `useState` ベースのため、ブラウザリロードで override 情報も消える。Phase 5 で永続化検討
- **`overrides` フィールドを `Partial<Record<...>>` にした理由**: `Record<FabricOverrideKey, boolean>` だと「触っていない」を `false` で明示する必要があり、未上書きを「キー無し」で表現する方がシリアライズが軽い
- **`FabricOverrideKey` を Phase 1 では `"stitchDensity"` のみとする理由**: PR2 の `FabricProfile.defaultDensityMm` だけが既定値を変える対象。`satinMaxWidthMm` 等は Phase 1 計画書 3.3 の表で fabric 依存値が定義されておらず、Phase 5 (UI 上書き拡張) で対象を広げる
