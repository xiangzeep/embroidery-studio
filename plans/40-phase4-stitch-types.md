# Phase 4. Stitch Types - Satin (rail pair / auto split) / Fill (tatami brick) / Run (medial-axis)

> **Status: ✅ Complete** (2026-05-26 merged PR #16 / #17 / #18 / #19)
> - PR16 (#16): Tatami brick fill (`fill.ts` 新規) — scanline ごとの 1/3 位相シフトで needle perforation 分散、`shiftMm=0` で旧 `fillStitches` と座標一致
> - PR17 (#17): 2-rail satin renderer (`satin.ts` 新規) — convex-hull 長辺 axis + cap-group 識別で矩形/C 字を統一抽出、arc-length 同期の zigzag (中点曲線 ±5-10% 密度精度)
> - PR18 (#18): Brick auto-split + renderer 統合 — `brickSplit` (rowIndex % 3) / 3 位相、`renderSatinTopOnly` を 2-rail+brick チェーンに切替、`disableAutoSplit` 互換フラグ
> - PR19 (#19): Medial-axis run (`run.ts` 新規) — Phase 2 PR10 の Zhang-Suen thinning を再利用、外形ループ run から中心線 polyline へ、`disableMedialAxis` 互換フラグ
>
> 全 PR 共通: テスト 370 → 399 (累計 +29) / npx tsc --noEmit pass / npm run build pass / lint warning 0 増。
> Phase 4 機能はデフォルト ON。`disableAutoSplit` / `disableMedialAxis` で UI から旧経路に戻せる。
> Forking points for Phase 5: 細線が medial-axis 1 本になる効果のブラウザ visual 確認 (Claude Code では visual 検証不可)、satin の S 字 / 渦巻きで rail 抽出が破綻するケースの medial-axis 軸採用 (§3.3)、tatami fill のランダム化 (§5.3)。

ステッチの**見た目品質**を業務ソフト同等のレベルに引き上げる。

## 1. 目的

- **Satin**: 単純な PCA 単一長軸 → **2-rail サンプリング**で曲面に追従
- **Wide satin**: 線形分割の `maxStitchMm` → **brick / step パターン**で needle perforation を分散
- **Fill**: 単純スキャンライン → **tatami brick** (行ごとフェーズシフト)、針穴並びを乱す
- **Run**: 外形ループ → **medial-axis 中心線抽出**

## 2. 現状参照

- `src/lib/pipeline/stitch.ts:384` `satinStitches` は PCA 長軸方向にスキャンラインを引くだけ
- `stitch.ts:430` `fillStitches` は単純な往復スキャンライン
- `stitch.ts:106-115` run は外形 polyline を resample しただけ (中心線抽出無し)
- `stitch.ts:229-245` `maxStitchMm` 超過分は線形補間で分割するだけ (brick 無し)

## 3. Satin の 2-rail 化

### 3.1 課題

PCA 単一長軸では、C / S / 円弧型の satin で:
- 角の薄い部分で糸が浮く
- 厚い部分で糸が潰れる
- 端の方向が領域形状とずれる

### 3.2 アプローチ

shape の外形から **2 つの長辺 (rails)** を取り出し、両 rail 間を等パラメータで結ぶ。

```ts
type SatinRails = { left: Point[]; right: Point[] };

function extractRails(shape: Shape): SatinRails {
  // 1. 外形を polyline 化
  // 2. 凸包の長辺方向を仮の主軸とする
  // 3. polyline を主軸方向の累積距離で並べ、両端 (start, end) を決定
  // 4. start から右回りと左回りで end までの 2 経路を取る
  // 5. これが left / right rail
}

function renderSatin2Rail(rails: SatinRails, densityMm: number, maxStitchMm: number): Point[] {
  // 1. 両 rail を arc-length 同期で等分割
  // 2. 各サンプル ti で left(ti) → right(ti) を出力 (ジグザグ)
  // 3. 出力ピッチは「左 rail と右 rail の中点曲線」上で densityMm
}
```

### 3.3 主軸方向決定の補強

- PCA で初期値を出し、その軸を**形状の medial-axis に置き換える**ことで C 字でも追従
- 簡易版: 形状を thin-skeleton (距離変換のリッジ) で抽出し、その骨格上の頂点列を中心線とする

### 3.4 短いケース

`shortSide < satinMaxWidthMm` で `aspectRatio > 4` のときに satin 化する判定はそのまま。
ただし 2-rail 化により、`aspectRatio > 2.5` 程度まで閾値を下げても破綻しなくなる見込み。

## 4. Auto Split (wide satin の brick 化)

### 4.1 課題

Wilcom Auto Split は **6mm 以上の wide satin** で:

1. 長すぎる stitch (>7mm) は布上で浮く
2. 同じ x 位置に針穴が一直線に並ぶと布が裂ける (needle perforation line)

を防ぐ。

### 4.2 アルゴリズム

`renderSatin2Rail` の出力に対して、`stitch` 長 > `maxStitchMm` の場合に **行ごとに 1/3 位相シフト**しながら分割する。

```ts
function brickSplit(left: Point, right: Point, maxStitchMm: number, rowIndex: number): Point[] {
  const dist = distance(left, right);
  if (dist <= maxStitchMm) return [left, right];
  const segs = Math.ceil(dist / maxStitchMm);
  const phase = (rowIndex % 3) / 3;  // 0, 1/3, 2/3 のいずれか
  const out: Point[] = [left];
  for (let i = 1; i <= segs; i++) {
    const t = ((i - 1) + phase) / segs;  // 位相シフト
    const tClamp = Math.min(1, Math.max(0, t));
    out.push(lerp(left, right, tClamp));
  }
  out.push(right);
  return out;
}
```

`phase` は行ごとに変えることで、隣接行の split 位置がずれ、針穴の縦並びを分散する。

## 5. Fill の Tatami Brick パターン

### 5.1 課題

`fillStitches` の現状は scanline ごとに `a → b → a → b ...` と往復するだけで、
**端の針落ち点が一直線に並ぶ** → ターン位置で布に穴が開く。

### 5.2 アルゴリズム

行 (scanline) ごとに `maxStitchMm` で分割した針落ち位置を、行 i に対して `(i * shiftMm) mod patternLengthMm` だけずらす。

```ts
function tatamiBrick(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
  maxStitchMm: number,
  shiftMm = 1.5,
  patternLengthMm = 4.0,
): Point[][] {
  // 既存の fillStitches とほぼ同じだが、scanline の中の針落ち点列を
  // (line * shiftMm) mod patternLengthMm でオフセットして打つ。
  // a, a+pattern, a+2*pattern, ..., b を等間隔針落ちにし、
  // line ごとに開始位相をずらす。
}
```

業界では `shiftMm = 1.5 (≈ scanline 行 1 つ分)`, `patternLengthMm = 4.0` が標準的。

### 5.3 ランダム化オプション

針穴の規則性を更に崩したい場合:

```ts
type FillPattern = {
  kind: "brick" | "diamond" | "random-phase";
  shiftMm?: number;
  jitterMm?: number;
};
```

`random-phase` では行ごとにランダムオフセットを加える。再現性のため `seed` を `EmbroideryDesign` に保持。

## 6. Run の Medial-Axis 化

### 6.1 課題

`stitch.ts:106` で `shortSide < runMaxWidthMm (0.6mm)` の場合に外形 polyline をそのまま resample して run にしているが、これは **1px 線の外形を 1 周なぞる** ことになり、線幅の中心線になっていない。

### 6.2 アプローチ

`opencv-worker.ts` に **distance transform → ridge 抽出** の関数を追加し、`Vectorize` 段で
細い領域を専用に処理する。

```python
# pyodide worker または opencv-worker
import cv2, numpy as np
def extract_medial_axis(mask: np.ndarray) -> list[list[tuple[float, float]]]:
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    # ridge: 局所最大点を skeletonize
    sk = cv2.ximgproc.thinning(mask)
    # sk から polyline 抽出
    ...
```

純 TS 実装も可: A. Telea らの ZS thinning か Voronoi medial axis を実装。
ただし依存追加 (`skeleton-tracing` 等の小型ライブラリ) で済むなら推奨。

### 6.3 適用範囲

- `shortSide < 1.0mm` (現状の `runMaxWidthMm = 0.6mm` から拡大): medial-axis run
- `1.0 ≤ shortSide < satinMaxWidthMm` かつ `aspectRatio > 4`: satin (2-rail)
- それ以外: fill (tatami brick)

## 7. 小領域フィルタ

### 7.1 現状

`vectorize.ts` の `turdsize` で 1 段階のサイズフィルタが効くが、object として残ったあと「実際に縫う価値があるか」の判定が無い。

### 7.2 ルール

- object の面積 < `minStitchAreaMm2` (例 1.0mm²) → 削除
- object の area / perimeter ratio が極端に小さい (細長すぎる) → run に強制

`build-objects.ts` でフィルタリングする。

## 8. ファイル分割

```
src/lib/pipeline/
  satin.ts             NEW   2-rail satin
  fill.ts              NEW   tatami brick fill
  run.ts               NEW   medial-axis run
  render.ts            CHANGE  上記を呼び分けるだけのオーケストレータに
```

## 9. 実装ステップ

- [ ] 1. `fill.ts` に `tatamiBrick` を実装 (既存 `fillStitches` をベース)
- [ ] 2. `render.ts` で fill object のレンダリングを `tatamiBrick` に差し替え
- [ ] 3. テスト: 同じ shape で `tatamiBrick` の針落ち位置が brick になっていること
- [ ] 4. `satin.ts` に 2-rail 化を実装
  - [ ] 4.1 `extractRails(shape)` (まず単純な凸包ベースで)
  - [ ] 4.2 `renderSatin2Rail`
  - [ ] 4.3 `brickSplit`
- [ ] 5. `render.ts` で satin object のレンダリングを差し替え
- [ ] 6. `run.ts` で medial-axis 抽出を実装
  - [ ] 6.1 OpenCV.js の skeletonize を呼ぶ
  - [ ] 6.2 polyline 列に変換
- [ ] 7. `vectorize.ts` または `build-objects.ts` で skeleton 結果を反映

## 10. テスト

- `fill.test.ts`:
  - 10mm 矩形 fill の行 0 と行 1 の針落ち x 位置が、scanline 1 つ分の `shiftMm` ぶんずれている
  - `shiftMm = 0` のときは既存 `fillStitches` と等価
- `satin.test.ts`:
  - 直線 satin (アスペクト比 8) で出力が 2-rail と一致
  - C 字 satin で rail が外側・内側に分かれて取れる
  - wide satin (8mm) で brick split が機能 (隣接行の中間点が一直線にならない)
- `run.test.ts`:
  - 1px 幅の対角線 → polyline 1 本
  - L 字 1px → 分岐点で polyline が 2 本

## 11. 受け入れ条件

- [ ] 既存テストが全件パス (regression 無し)
- [ ] 円形 satin (C 字) の縫い目が外側に膨らまず形状に追従
- [ ] 50×50mm の塗り fill で、針穴が一直線に並ぶ areas が visual 確認できなくなる
- [ ] 細線テキスト (例 "A" の縦棒) が、外形ループでなく中心線 1 本になる
- [ ] DST 書き出しで実機シミュレータ (Inkscape Ink/Stitch のシミュレーション等) が破綻しない

## 12. 発展課題

- **User-defined splits** (Wilcom): satin の上にユーザーが split line を引いて needle penetration を意図的に並べる
- **Auto branching for satin**: 隣接する satin object を 1 本の連続経路にする
- **Fill pattern variations**: diamond, hexagon, motif fill
- **PhotoStitch 相当**: 写真用の色ハーフトーン fill
