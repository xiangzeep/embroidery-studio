# Phase 1 PR2: 生地プロファイル (Fabric Profile) — TDD 実装計画

## 1. 概要

Phase 1 計画書「5. 実装ステップ」のステップ 2 を担当する。
`src/lib/pipeline/fabric.ts` を新規作成し、10 種の生地 (denim / twill / canvas / knit-light / knit-heavy / terry / fleece / leather / silk / felt) を `FABRIC_PROFILES` 定数として定義する。
さらに satin 幅依存の pull compensation を返す `pullCompForWidth()` と、生地ごとの `underlayPolicy.satin(widthMm)` / `.fill()` / `.run()` を実装する。
このプロファイルは Phase 2 以降の underlay 自動付与 / compensation 適用の入力となる。

## 2. 依存関係

- **PR1 (型定義: `EmbroideryObject` / `FabricProfile` / `UnderlayConfig`)** に厳密には依存する。
- ただし PR1 と並列で開発するため、本 PR では **Phase 計画書 3.2 の型シグネチャをそのまま採用** する。
  - 型のローカル再定義 (`fabric.ts` 内に同名 type を作る) は **行わない**。
  - 開発中は PR1 ブランチの `types.ts` を参照するか、PR1 を rebase してマージする。
  - 最終的なマージ順序は **PR1 → PR2** とする。
- 既存パイプライン (`stitch.ts` / `vectorize.ts` / `writer.ts`) には影響しない (純粋追加)。

## 3. 影響ファイル

### 新規

- `src/lib/pipeline/fabric.ts`
  - `FABRIC_PROFILES: Readonly<Record<FabricKind, FabricProfile>>`
  - `pullCompForWidth(profile: FabricProfile, widthMm: number): number`
  - `getFabricProfile(kind: FabricKind): FabricProfile`
  - 各 `underlayPolicy` 実装 (生地ごとに satin/fill/run のクロージャ)
- `src/lib/pipeline/__tests__/fabric.test.ts`

### 変更 (PR1 マージ後にのみ発生)

- なし (PR1 で `types.ts` に `FabricProfile` / `UnderlayConfig` / `FabricKind` が追加されている前提)。

## 4. TDD サイクル

サイクルは **テーブル → ルックアップ → 派生関数 → underlay クロージャ** の順で、依存の浅い順に分解する。
全 4 サイクル。

---

### Cycle 1: `FABRIC_PROFILES` テーブルの値域を全 10 生地で網羅検証

#### Red

**テストファイル**: `src/lib/pipeline/__tests__/fabric.test.ts`

**test name (`it.each` で parametrized)**:
- `FABRIC_PROFILES[%s] は defaultDensityMm が Phase 計画書 3.3 の値と一致する`
- `FABRIC_PROFILES[%s] は pullCompPerWidth が Phase 計画書 3.3 の値と一致する`
- `FABRIC_PROFILES[%s] は minPullCompMm が Phase 計画書 3.3 の値と一致する`
- `FABRIC_PROFILES[%s] は defaultPushCompMm が 0 以上 0.3 mm 以下の常識的な値`
- `FABRIC_PROFILES は denim / twill / canvas / knit-light / knit-heavy / terry / fleece / leather / silk / felt の 10 種をキーに持つ`

**テスト観点**:
- 配点表の値そのものを `it.each` で全数チェック (10 件 × 主要 4 フィールド)
- キー漏れ防止のため `Object.keys(FABRIC_PROFILES).sort()` を期待値と比較

**期待値の表 (Phase 計画書 3.3 を JS リテラルに正規化)**:

```ts
const EXPECTED: Record<FabricKind, { density: number; pullPerWidth: number; minPull: number }> = {
  denim:        { density: 0.40, pullPerWidth: 0.025, minPull: 0.10 },
  twill:        { density: 0.40, pullPerWidth: 0.030, minPull: 0.10 },
  canvas:       { density: 0.42, pullPerWidth: 0.020, minPull: 0.10 },
  "knit-light": { density: 0.45, pullPerWidth: 0.060, minPull: 0.20 },
  "knit-heavy": { density: 0.48, pullPerWidth: 0.075, minPull: 0.25 },
  terry:        { density: 0.42, pullPerWidth: 0.080, minPull: 0.30 },
  fleece:       { density: 0.45, pullPerWidth: 0.060, minPull: 0.25 },
  leather:      { density: 0.50, pullPerWidth: 0.015, minPull: 0.05 },
  silk:         { density: 0.40, pullPerWidth: 0.020, minPull: 0.08 },
  felt:         { density: 0.42, pullPerWidth: 0.020, minPull: 0.10 },
};
```

**失敗理由**: `fabric.ts` が存在せず、`FABRIC_PROFILES` が import できない。

#### Green

- `src/lib/pipeline/fabric.ts` を新規作成し、`FABRIC_PROFILES` を `Readonly<Record<FabricKind, FabricProfile>>` として **10 エントリ全てフラットに記述** する。
- `underlayPolicy` は一旦 `{ satin: () => ({ kind: "none" }), fill: () => ({ kind: "none" }), run: () => ({ kind: "none" }) }` の stub で埋める (Cycle 4 で実装)。
- 値テーブルは Phase 計画書 3.3 のものをそのまま転記する。

**シグネチャ例**:

```ts
import type { FabricKind, FabricProfile } from "./types";

export const FABRIC_PROFILES: Readonly<Record<FabricKind, FabricProfile>> = {
  denim: {
    kind: "denim",
    defaultDensityMm: 0.40,
    pullCompPerWidth: 0.025,
    minPullCompMm: 0.10,
    defaultPushCompMm: 0.05,
    underlayPolicy: { satin: () => ({ kind: "none" }), fill: () => ({ kind: "none" }), run: () => ({ kind: "none" }) },
  },
  // ... 残り 9 生地
};
```

#### Refactor

- 値テーブル部を別 const (`FABRIC_BASE_VALUES`) に切り出し、`FABRIC_PROFILES` を `Object.fromEntries(...)` で生成して **重複を削減**。
- `underlayPolicy` の stub は次サイクルで差し替えられるよう、各エントリのファクトリ関数に分離。

---

### Cycle 2: `getFabricProfile(kind)` ルックアップ関数

#### Red

**test name**:
- `getFabricProfile("denim") は FABRIC_PROFILES.denim と参照同一`
- `getFabricProfile("knit-heavy") は kind フィールドが "knit-heavy"`
- `getFabricProfile は未知の kind に対して TypeScript の型エラーを出す (compile-time only)` — コメントで記述、ランタイムテスト不要

**テスト観点**:
- 純粋ルックアップなのでテストは最小限。
- ただし「型レベルで `FabricKind` 以外を受け付けない」ことが API 契約なので、`@ts-expect-error` を使って 1 件だけ negative テストを書く。

**失敗理由**: `getFabricProfile` 関数が未実装。

#### Green

```ts
export function getFabricProfile(kind: FabricKind): FabricProfile {
  return FABRIC_PROFILES[kind];
}
```

#### Refactor

- 不要 (1 行関数)。

---

### Cycle 3: `pullCompForWidth(profile, widthMm)` の境界値・線形計算

#### Red

**test name** (`it.each` の組み合わせ):
- `pullCompForWidth(denim, 0) は minPullCompMm (0.10) を返す`
- `pullCompForWidth(denim, 2) は max(0.10, 2 * 0.025) = 0.10 を返す (まだ min 側)`
- `pullCompForWidth(denim, 4) は max(0.10, 4 * 0.025) = 0.10 を返す (境界)`
- `pullCompForWidth(denim, 5) は max(0.10, 5 * 0.025) = 0.125 を返す (per-width 側へ切り替わる)`
- `pullCompForWidth(knit-heavy, 4) は max(0.25, 4 * 0.075) = 0.30 を返す`
- `pullCompForWidth(terry, 1) は max(0.30, 1 * 0.080) = 0.30 を返す (min 側)`
- `pullCompForWidth(leather, 10) は max(0.05, 10 * 0.015) = 0.15 を返す`
- `pullCompForWidth(profile, 負数) は minPullCompMm にクランプ` (異常系)
- `pullCompForWidth(profile, NaN) は NaN ではなく minPullCompMm を返す` (防御)

**テスト観点**:
- 公式: `result = max(profile.minPullCompMm, widthMm * profile.pullCompPerWidth)`
- 境界: `widthMm = 0`、`minPullCompMm` を跨ぐ点、極端な値 (10mm 等)、負数、NaN
- 全生地で 1 つずつテストするのではなく、**代表 3〜4 生地 × 境界値 3 種類** を `it.each` で組み合わせる

**失敗理由**: `pullCompForWidth` 関数が未実装。

#### Green

```ts
export function pullCompForWidth(profile: FabricProfile, widthMm: number): number {
  const w = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 0;
  return Math.max(profile.minPullCompMm, w * profile.pullCompPerWidth);
}
```

#### Refactor

- 不要 (1 行関数だが NaN ガードのため if が残る)。
- もし他に「幅依存の補正」が増える場合、`linearWithFloor(min, slope, x)` のヘルパに抽出する余地あり (Phase 2 で再検討)。

---

### Cycle 4: `underlayPolicy.satin(widthMm) / fill() / run()` の幅依存分岐

#### Red

**test name** (生地 × 幅 の組み合わせを `it.each`):

**satin の幅依存 (denim / twill / canvas 系)**:
- `denim.underlayPolicy.satin(1.5) は { kind: "center-run", ... }` (幅 < 2mm)
- `denim.underlayPolicy.satin(3.0) は { kind: "edge-run", insetMm > 0, stitchLenMm > 0 }` (2-4mm)
- `denim.underlayPolicy.satin(5.0) は { kind: "zigzag", ... }` ※実装では `zigzag + edge` を表す合成 underlay が必要だが、Phase 1 では暫定的に `{ kind: "zigzag", spacingMm, insetMm }` を返し、Phase 2 で合成型に拡張する旨をコメントに残す
- `twill / canvas も同じ閾値で同じ kind を返す`

**satin の幅依存 (knit 系)**:
- `knit-light.underlayPolicy.satin(1.5)` は `center-run`
- `knit-light.underlayPolicy.satin(3.0)` は `edge-run`
- `knit-light.underlayPolicy.satin(5.0)` は `zigzag` (強め: spacingMm が denim より小さい)
- `knit-heavy` も同様

**satin の幅依存 (terry / fleece)**:
- `terry.underlayPolicy.satin(1.5)` は `edge-run` (毛足が長いので細幅でも center 不使用)
- `terry.underlayPolicy.satin(3.0)` は `edge-run`
- `terry.underlayPolicy.satin(5.0)` は `zigzag`

**leather (特殊: zigzag 禁止)**:
- `leather.underlayPolicy.satin(1.5)` は `center-run`
- `leather.underlayPolicy.satin(3.0)` は `edge-run`
- `leather.underlayPolicy.satin(5.0)` は `edge-run` (zigzag に切り替えない — 針穴跡を最小化)

**silk / felt (中庸)**:
- `silk.underlayPolicy.satin(0.8)` は `none` または `center-run` (軽め — `none` を採用)
- `silk.underlayPolicy.satin(3.0)` は `center-run` (軽め)
- `silk.underlayPolicy.satin(5.0)` は `edge-run` (zigzag は使わない)
- `felt.underlayPolicy.satin(*)` は `denim` と同じ閾値だが値が中庸 (insetMm を denim より小さく)

**fill の生地別差**:
- `denim.underlayPolicy.fill()` は `{ kind: "fill", spacingMm: 3.0, angleDeg }` (粗め)
- `knit-light.underlayPolicy.fill()` は `{ kind: "fill", spacingMm: 2.5 }` (強め)
- `knit-heavy.underlayPolicy.fill()` は `{ kind: "fill", spacingMm: 2.2 }` (さらに強め)
- `terry.underlayPolicy.fill()` / `fleece.underlayPolicy.fill()` は `{ kind: "fill" }` で tatami 相当 (Phase 1 では `kind: "fill"` のみ、tatami は Phase 2 で型拡張)
- `leather.underlayPolicy.fill()` は `{ kind: "edge-run", ... }` (fill underlay は禁止)
- `silk.underlayPolicy.fill()` / `felt.underlayPolicy.fill()` は中庸

**run の生地別差**:
- 全生地: `*.underlayPolicy.run()` は `{ kind: "none" }` (Phase 1 では run 用 underlay は付けない方針)

**テスト観点**:
- **幅 1.5 / 3.0 / 5.0 の 3 点** × **10 生地** を `it.each` で並べ、kind の遷移を一覧でアサート。
- 数値 (`insetMm` / `spacingMm` / `stitchLenMm`) は具体的な値域 (例: `> 0 && < 5`) で緩めにアサートしつつ、特に重要な値 (knit の spacingMm=2.5, knit-heavy=2.2, denim fill=3.0) は厳密に一致を要求。
- leather の zigzag 禁止と terry の細幅 edge-run は **negative テスト** として明示的に書く。

**失敗理由**: Cycle 1 で入れた underlay stub が `{ kind: "none" }` のみを返すため、ほぼ全件失敗。

#### Green

- 各生地ごとに以下の形で実装:

```ts
function satinFor_denimFamily(widthMm: number): UnderlayConfig {
  if (widthMm < 2) return { kind: "center-run", stitchLenMm: 2.0 };
  if (widthMm <= 4) return { kind: "edge-run", insetMm: 0.3, stitchLenMm: 2.0 };
  return { kind: "zigzag", spacingMm: 1.5, insetMm: 0.3 };
}

function satinFor_knitFamily(widthMm: number): UnderlayConfig {
  if (widthMm < 2) return { kind: "center-run", stitchLenMm: 1.8 };
  if (widthMm <= 4) return { kind: "edge-run", insetMm: 0.35, stitchLenMm: 1.8 };
  return { kind: "zigzag", spacingMm: 1.0, insetMm: 0.35 }; // 強め
}

function satinFor_terryFamily(widthMm: number): UnderlayConfig {
  if (widthMm <= 4) return { kind: "edge-run", insetMm: 0.4, stitchLenMm: 1.8 };
  return { kind: "zigzag", spacingMm: 1.2, insetMm: 0.4 };
}

function satinFor_leather(widthMm: number): UnderlayConfig {
  if (widthMm < 2) return { kind: "center-run", stitchLenMm: 2.5 };
  return { kind: "edge-run", insetMm: 0.2, stitchLenMm: 2.5 }; // zigzag 不使用
}

function satinFor_silk(widthMm: number): UnderlayConfig {
  if (widthMm < 2) return { kind: "none" };
  if (widthMm <= 4) return { kind: "center-run", stitchLenMm: 2.2 };
  return { kind: "edge-run", insetMm: 0.25, stitchLenMm: 2.2 };
}
```

- それぞれの `FABRIC_PROFILES[kind].underlayPolicy` を上記の family 関数で構築。
- `fill()` / `run()` も同様に family 単位で集約。

#### Refactor

- **テーブル駆動化**: family ごとの分岐閾値・値を `SATIN_TABLE: Record<Family, { centerMaxMm, edgeMaxMm, params: {...} }>` に集約し、`satinFor(family, widthMm)` 1 本に統合する。
- 生地 → family のマッピング (`denim/twill/canvas/felt → "twillFamily"`, `knit-light/knit-heavy → "knitFamily"`, `terry/fleece → "terryFamily"`, `leather → "leather"`, `silk → "silk"`) を定数化。
- これにより `FABRIC_PROFILES` 定義が「kind + 数値テーブル + family 名」だけのフラットな表になり、テスト追加時の改修コストが下がる。

---

## 5. 回帰防止

- 既存テスト全件パスを `npm test` で確認:
  - `src/lib/pipeline/__tests__/stitch.test.ts` — fabric.ts は import されないので影響なし
  - `src/lib/pipeline/__tests__/vectorize.test.ts` — 同上
- 本 PR は `index.ts` の公開 API を **変更しない** (Phase 1 計画書 受け入れ条件)。`fabric.ts` は import されるだけの追加モジュール。
- TypeScript の `strict` モードで `tsc --noEmit` (= `next build` 相当) が通ること。

## 6. 受け入れ条件

- [ ] `src/lib/pipeline/fabric.ts` が存在し、`FABRIC_PROFILES` が 10 生地全て (`denim` / `twill` / `canvas` / `knit-light` / `knit-heavy` / `terry` / `fleece` / `leather` / `silk` / `felt`) を含む
- [ ] `FABRIC_PROFILES[kind].defaultDensityMm` / `.pullCompPerWidth` / `.minPullCompMm` の値が Phase 計画書 3.3 と完全一致
- [ ] `getFabricProfile(kind)` が `FABRIC_PROFILES[kind]` を返す
- [ ] `pullCompForWidth(profile, widthMm)` が `max(minPullCompMm, widthMm * pullCompPerWidth)` を返し、負数 / NaN は `minPullCompMm` にクランプ
- [ ] 各生地の `underlayPolicy.satin(widthMm)` が幅 (1.5 / 3.0 / 5.0 mm) に応じた kind を返す:
  - denim / twill / canvas / felt: `center-run → edge-run → zigzag`
  - knit-light / knit-heavy: `center-run → edge-run → zigzag` (knit は spacing を強める)
  - terry / fleece: `edge-run → edge-run → zigzag`
  - leather: `center-run → edge-run → edge-run` (zigzag 不使用)
  - silk: `none → center-run → edge-run`
- [ ] 各生地の `underlayPolicy.fill()` / `.run()` が Phase 計画書 3.3 の指針に沿った値を返す
- [ ] `fabric.ts` 内で `FabricProfile` / `UnderlayConfig` / `FabricKind` をローカル定義していない (`types.ts` から import)
- [ ] `npm test` の全件パス、`tsc --noEmit` 通過
- [ ] `fabric.test.ts` のテスト件数は最低 **30 ケース以上** (parametrized `it.each` 込み)

## 7. コミット粒度

TDD サイクル単位で 1 コミット。Refactor が小さい場合は Red+Green+Refactor を 1 コミットにまとめる。

1. `test(pipeline): add FABRIC_PROFILES table tests for all 10 fabrics` (Cycle 1 Red)
2. `feat(pipeline): define FABRIC_PROFILES constant with phase 1 defaults` (Cycle 1 Green + Refactor)
3. `feat(pipeline): add getFabricProfile lookup` (Cycle 2 全部)
4. `test(pipeline): add pullCompForWidth boundary tests` (Cycle 3 Red)
5. `feat(pipeline): implement pullCompForWidth with min floor` (Cycle 3 Green + Refactor)
6. `test(pipeline): add underlayPolicy width-dependent branch tests for 10 fabrics` (Cycle 4 Red)
7. `feat(pipeline): implement per-fabric underlay policies with width branching` (Cycle 4 Green)
8. `refactor(pipeline): consolidate underlay policies into family-based table` (Cycle 4 Refactor)

合計 6〜8 コミット。

## 8. 想定 PR タイトル

`feat(pipeline): add fabric profile lookup with underlay/pull comp defaults (phase 1 pr2)`

## 9. 注意事項

- PR1 がマージされる前に本 PR の作業を始める場合、PR1 ブランチを base にして派生ブランチを切る。`types.ts` で `FabricProfile` / `UnderlayConfig` / `FabricKind` の型が未定義のままだと TypeScript エラーになるため、PR1 の最新を必ず取り込む。
- `UnderlayConfig` の `kind: "zigzag"` で「zigzag + edge」の合成を表す方式は Phase 1 では暫定。Phase 2 で `UnderlayConfig` をユニオン拡張 (例: `{ kind: "composite", parts: UnderlayConfig[] }`) して合成可能にする。本 PR ではコメントで TODO を残す。
- terry / fleece の fill underlay (tatami) は Phase 1 では `kind: "fill"` で代用し、`spacingMm` を密にすることで tatami 相当の効果を擬似的に表現。`kind: "tatami"` の追加は Phase 2 へ持ち越し。
- `pullCompForWidth` は satin 専用。fill / run には別の補正値関数が必要になる可能性があるが、Phase 2 で `applyCompensation` 段を作る際に判断する。

## 10. サイクル依存グラフ

```
Cycle 1 (FABRIC_PROFILES テーブル)
   └→ Cycle 2 (getFabricProfile ルックアップ)
   └→ Cycle 3 (pullCompForWidth 派生関数)
   └→ Cycle 4 (underlayPolicy 幅依存分岐) ※ Cycle 1 の stub を実装で置き換え
```

Cycle 2 / 3 / 4 は Cycle 1 完了後に並列実装可能。ただしレビュー容易性のため、計画書通り順番にコミットすることを推奨。
