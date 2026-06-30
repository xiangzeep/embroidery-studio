# 00. Overview - 全体像とロードマップ

## 1. 目的

業務用刺繍ソフトが長年積み上げてきた「実機で破綻なく縫うための仕組み」を、本リポジトリのパイプラインに取り込み、
**画像から実用品質の刺繍データを生成し、アプリ上で対話編集できる**状態を目指す。

## 2. 最終ユースケース

1. ユーザーがロゴ/線画/アイコン画像をアップロード
2. 生地種を選択 (denim, knit, terry, leather, twill, canvas, …)
3. 自動デジタイズで初期ステッチパターンを生成 (underlay / pull comp / pathing 込み)
4. プレビュー上で:
   - **オブジェクト単位**で stitch type / 角度 / 密度 / 補正を編集
   - **Sewing Order パネル**で縫う順番を並び替え
   - **パスのノード**を追加/移動/削除して形状を補正
5. 実機形式 (DST/PES/JEF/EXP/VP3) で出力

## 3. 現状

### 出来ていること

- 画像 → quantize → vectorize (imagetracerjs) → fill/satin/run 振り分け → pyembroidery で書き出し、までの一気通貫
- 色別 fill 角度の override (`src/lib/pipeline/stitch.ts:67`, `src/components/color-angle-editor.tsx`)
- 穴 (holes) 対応の fill scanline (`src/lib/pipeline/stitch.ts:430`)
- 最大ステッチ長クランプ (7mm) と長距離 jump 前の trim 挿入 (`src/lib/pipeline/stitch.ts:200`)
- 同色領域のブロック化 (`src/lib/pipeline/stitch.ts:75`)
- Pyodide / OpenCV.js の Web Worker 隔離

### 不足機能 (本計画書のスコープ)

| 観点 | 現状 | Wilcom/Brother |
|---|---|---|
| 内部モデル | フラットな Stitch 配列 | Object-based (Run/Satin/Fill 各オブジェクトに属性) |
| 生地プロファイル | 無し | Auto Fabric / Fabric Selector |
| Underlay | 無し | stitch type 別に自動付与 |
| Pull/Push compensation | TODO のみ | per-side 補正 |
| Lockstitch (tie-in/off) | 無し | 自動 |
| Pathing (object 訪問順) | 入力順そのまま | Branching + 最近傍 |
| 進入退出点最適化 | polygon[0] 固定 | 最近接マッチング |
| Satin の曲面対応 | PCA 単一長軸 | 2-rail サンプリング |
| Wide satin の auto split | 線形分割のみ | brick/step パターン |
| Fill のターン点分散 | 直線で並ぶ | brick / random phase |
| Run の中心線抽出 | 外形ループ | medial-axis |
| 編集 UI | 角度のみ | パス/縫い順/オブジェクトプロパティ |

## 4. ロードマップ (5 Phase)

進捗チェック:

- [x] **Phase 1 (Foundation)**: データモデル刷新 + 生地プロファイル
- [ ] **Phase 2 (Quality)**: Underlay / Pull-Push / Lockstitch
- [ ] **Phase 3 (Pathing)**: Branching / 訪問順 / 進入退出点最適化
- [ ] **Phase 4 (Stitch Types)**: Satin 2-rail / Auto Split / Tatami Brick / Medial-axis Run
- [ ] **Phase 5 (Editor)**: パス編集 / 縫い順編集 UI

依存関係:
- Phase 1 の object-based モデルが他全フェーズの前提
- Phase 2/3/4 は内部で互いに参照するがどれから着手しても良い (推奨は 2 → 3 → 4)
- Phase 5 (UI) は Phase 1 の object モデルがあれば 2/3/4 を待たずに先行着手可能

## 5. 用語集

| 用語 | 説明 |
|---|---|
| **Object** | 1 つの意味的塗り単位。外形 + 穴 + stitch type + 属性 (角度・密度・補正…) のまとまり |
| **Run stitch** | 1 本の線に沿った走り縫い |
| **Satin stitch** | 2 本のレール (両端線) の間を細長く埋める縫い |
| **Fill stitch (Tatami)** | 領域内を平行線で塗りつぶす縫い |
| **Underlay** | 表縫い (top stitch) の前に布を固定するための下縫い |
| **Pull compensation** | 縫った後に細る分を見越して、satin/fill を太めに描く補正 |
| **Push compensation** | 端の積み重ねで広がる分を逆に縮める補正 |
| **Pathing** | オブジェクトの訪問順と、各オブジェクト間の繋ぎ方を決めること |
| **Branching** | 接触/重なり合うオブジェクト群の縫う順を自動決定し、travel run で繋ぐ機能 |
| **Travel run** | trim を発生させないために既存縫いの下に潜らせる走り縫い |
| **Lockstitch / Tie-in / Tie-off** | 糸抜け防止の数針バックタック |
| **Entry / Exit point** | 1 オブジェクトの縫い開始点 / 終了点 |
| **Brick pattern** | tatami fill で行ごとに針落ち位置をフェーズシフトさせるパターン |
| **Medial axis** | 形状の骨格 (skeleton)。細い領域の中心線抽出に使う |

## 6. 成功指標 (Phase 5 完了時)

- [ ] 100×100mm のロゴ画像を入力して、**手作業 0 で破綻なく 1 度の試し縫いを通過する**
- [ ] 同じ画像から `Optimize Sewing Order` 相当のボタン一発で trim 数が 30% 以上減る
- [ ] パス編集 UI で 1 つのオブジェクトを選択し、stitch type を切り替えるとリアルタイムにプレビューが更新される
- [ ] DST/PES/JEF/EXP/VP3 のすべてで、実機 (もしくは pyembroidery が再読込で破綻しない) ことを確認

## 7. 技術スタック前提

- Next.js (App Router, ホットリロード対応)
- TypeScript (strict)
- OpenCV.js (Web Worker, `quantize.ts`)
- imagetracerjs (mainthread, `vectorize.ts`)
- Pyodide + pyembroidery (Web Worker, `pyodide-worker.ts`)
- Three.js (`stitch-preview-3d.tsx`)
- vitest (`__tests__/`)

新規依存は最小限に抑える。アルゴリズム実装は原則 pure TS で書き、テスト容易性を優先する。
