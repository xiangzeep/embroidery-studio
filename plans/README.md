# 刺繍データ生成エンジン 実装計画 (plans)

業務用刺繍ソフト (Wilcom EmbroideryStudio / Brother PE-Design) の主要機能を、
本リポジトリの「画像 → 刺繍ファイル」パイプラインに段階的に取り込むための実装計画一式。

最終ゴール:

- 画像入力 → 自動デジタイズ → **アプリ上でパス/縫い順/角度を対話編集** → 実機で破綻なく縫える刺繍データ (DST/PES/JEF/EXP/VP3) を出力する

## ドキュメント構成

### Phase 計画書 (マイルストーン)

| # | ファイル | 内容 |
|---|---|---|
| 00 | [00-overview.md](./00-overview.md) | 全体像・現状ギャップ・用語集・ロードマップ・成功指標 |
| 10 | [10-phase1-foundation.md](./10-phase1-foundation.md) | Phase 1: データモデル刷新 (object-based) と生地プロファイル |
| 20 | [20-phase2-quality.md](./20-phase2-quality.md) | Phase 2: Underlay / Pull・Push Compensation / Lockstitch |
| 30 | [30-phase3-pathing.md](./30-phase3-pathing.md) | Phase 3: Branching / 進入退出点最適化 / Color Sort 強化 |
| 40 | [40-phase4-stitch-types.md](./40-phase4-stitch-types.md) | Phase 4: Satin (rail pair / auto split) / Fill (tatami brick) / Run (medial axis) |
| 50 | [50-phase5-editor.md](./50-phase5-editor.md) | Phase 5: パス編集・縫い順編集・角度編集 UI |
| 90 | [90-references.md](./90-references.md) | 参考文献 (Wilcom 公式 / Brother 公式 / 業界記事) |

### PR 計画書 (実装単位、`tdd/`)

各 PR 計画書は `/tdd-design` 出力。Red-Green-Refactor サイクル + テストコード + 受け入れ条件付き。1 PR = 1 計画書 = 1 ブランチ = 1 PR の対応。

**Phase 1: Foundation (5 PR)** — マージ順 PR1 → PR2 → PR3 → PR4 → PR5
- [phase1-pr1-object-model.md](./tdd/phase1-pr1-object-model.md) — データモデル定義 (types.ts)
- [phase1-pr2-fabric-profile.md](./tdd/phase1-pr2-fabric-profile.md) — 生地プロファイル (fabric.ts)
- [phase1-pr3-build-objects.md](./tdd/phase1-pr3-build-objects.md) — kind 判定の分離 (build-objects.ts)
- [phase1-pr4-render-refactor.md](./tdd/phase1-pr4-render-refactor.md) — renderer / composer 分離 (render.ts, compose.ts)
- [phase1-pr5-config-ui.md](./tdd/phase1-pr5-config-ui.md) — 設定 UI + 生地セレクト

**Phase 2: Quality (4 PR)** — Phase 1 完了後
- [phase2-pr1-compensation.md](./tdd/phase2-pr1-compensation.md) — clipper-lib + Pull/Push compensation
- [phase2-pr2-underlay-run.md](./tdd/phase2-pr2-underlay-run.md) — edge-run + center-run underlay
- [phase2-pr3-underlay-zigzag-fill.md](./tdd/phase2-pr3-underlay-zigzag-fill.md) — zigzag + fill underlay
- [phase2-pr4-lockstitch-integration.md](./tdd/phase2-pr4-lockstitch-integration.md) — lockstitch + render 統合

**Phase 3: Pathing (3 PR)** — Phase 2 完了後
- [phase3-pr1-branching.md](./tdd/phase3-pr1-branching.md) — 接触判定 + Branch grouping
- [phase3-pr2-order-optimizer.md](./tdd/phase3-pr2-order-optimizer.md) — 進入退出点 + 訪問順最適化
- [phase3-pr3-travel-trim.md](./tdd/phase3-pr3-travel-trim.md) — travel run / trim policy / render 統合

**Phase 4: Stitch Types (4 PR)** — Phase 3 完了後、PR1/PR2/PR4 並列可、PR3 は PR2 後
- [phase4-pr1-tatami-brick.md](./tdd/phase4-pr1-tatami-brick.md) — Tatami brick fill
- [phase4-pr2-satin-2rail.md](./tdd/phase4-pr2-satin-2rail.md) — Satin 2-rail (extractRails + renderSatin2Rail)
- [phase4-pr3-auto-split.md](./tdd/phase4-pr3-auto-split.md) — Auto split (brick) + satin renderer 切替
- [phase4-pr4-medial-axis-run.md](./tdd/phase4-pr4-medial-axis-run.md) — Medial-axis run

**Phase 5: Editor (5 PR)** — Phase 4 完了後、PR1 → PR2/PR3 並列 → PR4 → PR5
- [phase5-pr1-design-store.md](./tdd/phase5-pr1-design-store.md) — Zustand design store + 選択基盤
- [phase5-pr2-object-inspector.md](./tdd/phase5-pr2-object-inspector.md) — Object Inspector
- [phase5-pr3-sewing-order.md](./tdd/phase5-pr3-sewing-order.md) — Sewing Order Panel (dnd-kit)
- [phase5-pr4-node-editor.md](./tdd/phase5-pr4-node-editor.md) — Node Editor (パス編集)
- [phase5-pr5-tools.md](./tdd/phase5-pr5-tools.md) — Layout / Debounce / Visualization / JSON / Undo-Redo

## 読む順序

1. **00-overview.md** を最初に読む (全体像と用語の定義)
2. 各 Phase は **依存順** に並んでいる。Phase 1 のデータモデル刷新が前提となるため、原則として番号順に着手する
3. 各 Phase の md は単体で実装に着手できるよう、目的・現状コード参照・データモデル変更・アルゴリズム・実装ステップ・テスト・受け入れ条件を含む

## 実装の進め方

- 各 Phase は **計画書 → `/tdd-design` → `/implement`** のサイクルで進める想定
- Phase 内のタスクは TaskCreate で粒度を分けて管理する
- フェーズをまたぐ変更 (データモデル拡張) は破壊的になりやすいので、その Phase の冒頭で一括して入れる
