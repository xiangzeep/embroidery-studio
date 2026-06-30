# Phase 1. Foundation - データモデル刷新 + 生地プロファイル

他全 Phase の前提となる。Phase 1 を完了するまで Phase 2 以降は本格着手できない。

## 1. 目的

1. 内部モデルを **「Stitch 配列」から「Object 配列 → Stitch 配列」の 2 段階**にする
2. **生地プロファイル**を入力に追加し、密度・補正値・underlay の派生規則を一元化する
3. 既存の `ConversionConfig` ベースの設定 UI と互換性を保ちつつ拡張する

## 2. 現状参照

- `src/lib/pipeline/types.ts` の `Stitch / StitchBlock / StitchPattern` がフラット表現
- `src/lib/pipeline/stitch.ts:79` で `region.shapes` から直接 `Stitch` を吐いている (オブジェクト中間表現が無い)
- `src/components/embroidery-studio.tsx:25` の `ConversionConfig` は生地非依存
- `src/components/conversion-settings.tsx` で生地選択 UI 無し

## 3. データモデル設計

### 3.1 新規型: `EmbroideryObject`

`src/lib/pipeline/types.ts` に追加。

```ts
export type ObjectKind = "run" | "satin" | "fill";

export type ObjectProps = {
  /** stitch density (mm) — 隣接走り間距離 */
  densityMm: number;
  /** 最大ステッチ長 (mm) */
  maxStitchMm: number;
  /** fill / satin の縫い角度 (deg)。run では未使用 */
  angleDeg?: number;
  /** pull compensation (mm)。両端で同値の場合の簡易指定 */
  pullCompMm?: number;
  /** per-side pull compensation。値があればこちらを優先 */
  pullCompPerSideMm?: { left: number; right: number };
  /** push compensation (mm)。両端を縮める量 (重なる object 用) */
  pushCompMm?: number;
  /** underlay 種別 (Phase 2 で詳細化) */
  underlay?: UnderlayConfig;
  /** lock-in / lock-off を入れるか (Phase 2) */
  lockstitch?: boolean;
};

export type UnderlayConfig =
  | { kind: "none" }
  | { kind: "edge-run"; insetMm: number; stitchLenMm: number }
  | { kind: "center-run"; stitchLenMm: number }
  | { kind: "zigzag"; spacingMm: number; insetMm: number }
  | { kind: "fill"; angleDeg: number; spacingMm: number };

export type EmbroideryObject = {
  id: string;
  kind: ObjectKind;
  colorIndex: number;
  rgb: [number, number, number];
  /** mm 座標系のジオメトリ。outer + holes。run の場合 outer は中心線 polyline */
  shape: Shape;
  props: ObjectProps;
  /** 縫い順 (小さいほど先)。Phase 3 で自動採番 */
  order: number;
  /** ユーザーがロックして自動再配置から外したいか */
  locked?: boolean;
};

export type EmbroideryDesign = {
  widthMm: number;
  heightMm: number;
  fabric: FabricProfile;
  objects: EmbroideryObject[];
};
```

`StitchPattern` は最終出力直前の表現として残す (`generateStitches` の戻り値)。
パイプラインは `image → objects → stitches → file` の三段になる。

### 3.2 新規型: `FabricProfile`

```ts
export type FabricKind =
  | "denim"
  | "twill"
  | "canvas"
  | "knit-light"
  | "knit-heavy"
  | "terry"
  | "fleece"
  | "leather"
  | "silk"
  | "felt";

export type FabricProfile = {
  kind: FabricKind;
  /** 表縫い密度 (mm)。fill / satin 共通の既定 */
  defaultDensityMm: number;
  /** satin 幅 1mm あたりの pull compensation (mm/mm) */
  pullCompPerWidth: number;
  /** pull compensation の最小値 (mm) */
  minPullCompMm: number;
  /** 既定 underlay の選び方 (kind に対するルックアップ) */
  underlayPolicy: UnderlayPolicy;
  /** push compensation の既定値 (mm) */
  defaultPushCompMm: number;
};

export type UnderlayPolicy = {
  satin: (widthMm: number) => UnderlayConfig;
  fill: () => UnderlayConfig;
  run: () => UnderlayConfig;
};
```

### 3.3 既定値テーブル

`src/lib/pipeline/fabric.ts` (新規) に定義。

| 生地 | density | pull/width | minPull | satin underlay (幅依存) | fill underlay |
|---|---|---|---|---|---|
| denim | 0.40 | 0.025 | 0.10 | <2: center / 2-4: edge / 4+: zigzag+edge | fill (3.0mm) |
| twill | 0.40 | 0.030 | 0.10 | 同上 | 同上 |
| canvas | 0.42 | 0.020 | 0.10 | 同上 | 同上 |
| knit-light | 0.45 | 0.060 | 0.20 | center → edge → zigzag+edge | fill (2.5mm, 強め) |
| knit-heavy | 0.48 | 0.075 | 0.25 | 同上 | fill (2.2mm) |
| terry | 0.42 | 0.080 | 0.30 | edge → edge → zigzag+edge | tatami underlay |
| fleece | 0.45 | 0.060 | 0.25 | 同上 | tatami underlay |
| leather | 0.50 | 0.015 | 0.05 | center → edge / zigzag禁止 | edge run のみ |
| silk | 0.40 | 0.020 | 0.08 | 軽め | 軽め |
| felt | 0.42 | 0.020 | 0.10 | 中庸 | 中庸 |

これらは Wilcom Auto Fabric / Brother Fabric Selector の挙動を参考に、業界記事の値域を採用した叩き台。
試し縫いで微調整できるよう、UI から各値を上書きできるようにする (Phase 5)。

## 4. パイプライン構造の変更

### 4.1 既存

```
image → quantize → vectorize (ColorRegion) → generateStitches (Stitch) → writeEmbroidery (Blob)
```

### 4.2 新規

```
image → quantize → vectorize (ColorRegion)
                 → buildObjects (EmbroideryObject)   ← NEW
                 → applyFabricProfile               ← NEW
                 → optimizeOrder (Phase 3)
                 → addUnderlay (Phase 2)
                 → applyCompensation (Phase 2)
                 → renderStitches (Stitch)
                 → writeEmbroidery (Blob)
```

各段が pure な変換 (副作用なし) になるよう作る。

### 4.3 ファイル分割

```
src/lib/pipeline/
  fabric.ts          NEW  生地プロファイル定義と派生規則
  build-objects.ts   NEW  ColorRegion → EmbroideryObject[] 変換
  compose.ts         NEW  paipeline 全体の合成 (現 index.ts の役割)
  stitch.ts          REPURPOSE  EmbroideryObject → Stitch のレンダラに改名 (render.ts) も検討
  index.ts           CHANGE  公開 API のみ。実装は compose.ts へ
```

## 5. 実装ステップ

- [x] 1. `types.ts` に `EmbroideryObject` / `EmbroideryDesign` / `FabricProfile` / `UnderlayConfig` を追加 (既存型は破壊しない) — PR #1
- [x] 2. `fabric.ts` を新規作成し、上表の `FABRIC_PROFILES` 定数とルックアップ関数を実装 — PR #2
- [x] 3. `build-objects.ts` を新規作成: — PR #3
  - `ColorRegion[]` を受け取り、各 `shape` ごとに kind を判定 (現 `stitch.ts:105-156` のロジックを移植)
  - 判定結果から `EmbroideryObject` を生成
  - `order` は入力順を仮置きで採番 (Phase 3 で並び替え)
- [x] 4. `stitch.ts` の `generateStitches` をリファクタ: — PR #3 + PR #4
  - 入力を `EmbroideryObject[] + FabricProfile` に変更
  - 既存のロジックを `kind` ごとの renderer 関数に分離 (`renderRun`, `renderSatin`, `renderFill`)
- [x] 5. `index.ts` を分割し、`compose.ts` に `convertImageToEmbroideryDirect` を移動 — PR #4
- [x] 6. `ConversionConfig` に `fabric: FabricKind` を追加 (既定 `denim`) — PR #5
- [x] 7. `conversion-settings.tsx` に生地セレクト UI を追加 — PR #5
- [x] 8. `stitchDensity` 等の数値設定は **fabric override** として扱い、未設定なら fabric 既定値を使う形に変更 — PR #5
- [x] 9. `config.fabric` を `runStitchAndWrite` 経由で `generateStitches` まで配線 — PR #6 (受け入れ条件 3 を満たすため追加)

## 6. テスト

`src/lib/pipeline/__tests__/` に追加:

- `fabric.test.ts` - 各生地で `pullCompForWidth(profile, widthMm)` が想定値域に入ること
- `build-objects.test.ts`:
  - 1 色の塗り画像 → kind=`fill` のオブジェクト 1 つ
  - 細長い帯 (幅 < satinMaxWidth, aspect > 4) → kind=`satin`
  - 1px 線 → kind=`run`
  - 穴ありの塗り → `holes` が保持される
- 既存 `stitch.test.ts` は Phase 1 のリファクタ後も同じテスト件数でパスすること

## 7. UI 変更 (最小限)

`conversion-settings.tsx`:

- 生地セレクト (`Select` コンポーネント) を一番上に追加
- 生地を選ぶと `defaultDensityMm` をスライダ初期値に反映
- 「fabric override」のトグルで、ユーザーが密度・補正値を上書きできる UI に拡張可能 (Phase 5 で本格化)

## 8. 受け入れ条件

- [x] 既存テストが全件パス (240 tests, PR #6 時点)
- [ ] `denim` で同じ画像を変換した結果のステッチ数が、Phase 0 の結果と ±5% 以内 (回帰防止) — **実画像での手動確認項目として残置**
- [x] `terry` を選ぶと density が自動で 0.42 になり、結果のステッチ数が denim と異なること
      ※ 原文「denim より多い」は誤り。`densityMm` は「隣接走り間距離」のため値が大きいほど stitch 数は少ない。
        実装は denim (0.40) > terry (0.42) のステッチ数になり、render.test.ts 内で固定済 (PR #6)。
- [x] `EmbroideryDesign` を JSON シリアライズ → デシリアライズしても結果が一致する (将来の保存/読込のため) — PR #1
- [x] `compose.ts` から `convertImageToEmbroideryDirect` が呼べ、`index.ts` の公開 API は変わらない — PR #4

## 9. リスク

- 既存のフラット Stitch 表現に依存している箇所 (3D プレビュー, ResultPanel) が壊れる
  - 対策: `EmbroideryDesign` を保持しつつ、`StitchPattern` も従来通り出す互換 API を維持
- pyembroidery への JSON 受け渡し (`pyodide-worker.ts`) はステッチ列を渡すだけなので変更不要のはず
  - 確認ポイント: `writeEmbroidery` の入力に `StitchPattern` 以外を渡していないこと

## 10. 次フェーズへの引き継ぎ

- `EmbroideryObject.props.underlay` のフィールドは Phase 1 では未使用 (Phase 2 で使う)
- `EmbroideryObject.order` は Phase 1 では入力順 (Phase 3 で並び替え)
- 生地プロファイルの **拡縮時再計算** (Wilcom が売りにしている機能) は、本アプリでは「都度画像から再生成」のため不要
