# Phase 4 PR1: Tatami Brick Fill — TDD 実装計画書

## 1. 概要

Phase 4 PR1 では `src/lib/pipeline/fill.ts` を新規作成し、業務ソフト相当の **tatami brick fill パターン** を実装する。
既存 `fillStitches` (`stitch.ts:430-480`) の単純往復スキャンラインは、行ごとの端点 (scanline の `a` / `b` 交点) が一直線に並び、布上に縦の針穴ラインが出る欠点があった。
本 PR では scanline ごとに `(line * shiftMm) mod patternLengthMm` の位相シフトを適用し、行内の針落ち位置を行間でずらすことで needle perforation を分散する。
業界標準値 `shiftMm = 1.5`, `patternLengthMm = 4.0` を既定値とし、`shiftMm = 0` のときは既存 `fillStitches` と等価な出力 (回帰防止) を保証する純関数として実装する。
`stitch.ts:143` の `fillStitches` 呼び出しを `tatamiBrick` に差し替え、orchestration 層への影響を最小化する。

## 2. 依存関係

- **完了済み前提**: Phase 1 (PR1-PR5), Phase 2 (PR1-PR4), Phase 3 (PR1-PR3) すべて完了
- **型依存**: `src/lib/pipeline/types.ts` の `Shape`, `Polygon`, `Point2D`
- **内部依存**: 現状 `intersectScanline` (`stitch.ts:487`) は file-local。`tatamiBrick` から再利用するため、`stitch.ts` の `__internal` 経由 (既に export 済み) を使う。Refactor サイクルで将来の共通化方針を記録する。
- **後続依存**: Phase 4 PR2 (satin 2-rail), PR3 (auto split), PR4 (run medial-axis) は本 PR とは独立して並行実装可能

## 3. 影響ファイル

### 新規
- `src/lib/pipeline/fill.ts` — `tatamiBrick(shape, densityMm, angleDeg, maxStitchMm, shiftMm?, patternLengthMm?): Point[][]` を export。純関数。
- `src/lib/pipeline/__tests__/fill.test.ts` — vitest で Cycle 1-5 のテストを格納

### 編集
- `src/lib/pipeline/stitch.ts` (もしくは Phase 1 PR4 後の `render.ts`)
  - fill のレンダリング呼び出し位置で `fillStitches(...)` を `tatamiBrick(...)` に差し替え
  - `__internal` export に `tatamiBrick` を任意追加 (テスト容易性向上)
  - `fillStitches` の `__internal` export は維持 (Cycle 1 の等価性テストが依存)

### 参照のみ
- `src/lib/pipeline/types.ts`
- `src/lib/pipeline/__tests__/stitch.test.ts` (既存ケース全件パスを維持)

## 4. テスト環境
- フレームワーク: **vitest 4.1.6**
- 実行コマンド: `npm test` (= `vitest run`)
- テストファイル配置: `src/lib/pipeline/__tests__/<module>.test.ts`
- import 規約: `import { describe, it, expect } from "vitest";`
- 既存パターン: `stitch.test.ts` のように `__internal` 経由で private 関数を露出 → テストから直接呼ぶ

## 5. インターフェース設計

```ts
// src/lib/pipeline/fill.ts
import type { Shape } from "./types";
type Point = [number, number];

/**
 * Tatami brick fill: scanline ごとに行 index に応じた位相シフトを適用し、
 * 行内の針落ち位置を `(line * shiftMm) mod patternLengthMm` だけずらす。
 * `shiftMm = 0` のとき既存 `fillStitches` と等価。
 */
export function tatamiBrick(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
  maxStitchMm: number,
  shiftMm?: number,
  patternLengthMm?: number,
): Point[][];
```

### アルゴリズム (Phase 4 計画書 §5.2 準拠)
1. `dir = [cos(rad), sin(rad)]`, `perp = [-sin(rad), cos(rad)]` を計算
2. outer の bbox を `perp` 方向に投影して `minS, maxS` を得る
3. `s = minS` から `densityMm` 刻みで scanline を生成 (`line` カウンタを維持)
4. 各 scanline で `intersectScanline(rings, ox, oy, dir)` → `crossings`、even-odd でペア化
5. **位相**: `phase = (((line * shiftMm) % patternLengthMm) + patternLengthMm) % patternLengthMm`、`|phase| < ε` or `|patternLengthMm - phase| < ε` のとき 0 扱い
6. 各ペア `[a, b]` で:
   - `pts = [pointAt(a)]`
   - `phase > 0` のとき: `t = a + phase` から始め、`maxStitchMm` ステップで `t < b - ε` の間 push
   - 末尾 `pointAt(b)` を push
7. `line % 2 !== 0` のとき pts を逆順にする (既存 `fillStitches` と同じ往復)

### `shiftMm = 0` 等価性
`phase = 0` のとき内部点を 1 つも打たない分岐 (Cycle 2 の `if (phase > 0)` ガード) により、segment は端点 2 点のみになり既存 `fillStitches` と bit-equal な座標出力になる。

## 6. TDD サイクル

### Cycle 1: 関数雛形と `shiftMm = 0` 等価性

#### Red
```ts
// src/lib/pipeline/__tests__/fill.test.ts
import { describe, it, expect } from "vitest";
import { tatamiBrick } from "../fill";
import { __internal } from "../stitch";
import type { Shape } from "../types";
const { fillStitches } = __internal;

describe("tatamiBrick — shiftMm=0 equivalence", () => {
  it("10mm 矩形 / shiftMm=0 で fillStitches と一致", () => {
    const shape: Shape = {
      outer: [[0,0],[10,0],[10,10],[0,10]], holes: [],
    };
    const expected = fillStitches(shape, 1, 0);
    const actual = tatamiBrick(shape, 1, 0, 7, 0, 4.0);
    expect(actual.length).toBe(expected.length);
    for (let i=0;i<expected.length;i++) {
      expect(actual[i].length).toBe(expected[i].length);
      for (let j=0;j<expected[i].length;j++) {
        expect(actual[i][j][0]).toBeCloseTo(expected[i][j][0], 6);
        expect(actual[i][j][1]).toBeCloseTo(expected[i][j][1], 6);
      }
    }
  });
});
```
**失敗理由**: `../fill` モジュールおよび `tatamiBrick` 関数が未作成のため import-time エラー。

#### Green
- 変更: `src/lib/pipeline/fill.ts` を新規作成
- 既存 `fillStitches` のロジックをコピーして署名を拡張。本サイクルでは `shiftMm` / `patternLengthMm` / `maxStitchMm` は受け取るだけで使用しない。
- `intersectScanline` は `stitch.ts` の `__internal.intersectScanline` から import。

#### Refactor
不要 (構造改善は Cycle 5 でまとめて行う)。

---

### Cycle 2: 行ごとの位相シフト (brick の核心)

#### Red
```ts
describe("tatamiBrick — row-to-row phase shift", () => {
  it("隣接行で行内中間針落ち x が shiftMm 進む (angleDeg=0)", () => {
    const shape: Shape = {
      outer: [[0,0],[50,0],[50,30],[0,30]], holes: [],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const segByY = new Map<number, [number, number][]>();
    for (const seg of segs) {
      const y = Math.round(seg[0][1] * 100) / 100;
      if (!segByY.has(y)) segByY.set(y, seg);
    }
    const ys = [...segByY.keys()].sort((a,b)=>a-b);
    expect(ys.length).toBeGreaterThanOrEqual(4);
    const row1 = segByY.get(ys[1])!;
    // 行 1 phase=1.5 → row1[1] = (1.5, y1)
    expect(row1[1][0]).toBeCloseTo(1.5, 4);
  });
});
```
**失敗理由**: Cycle 1 実装は内部針落ち点を打たない (端点 2 点のみ) ため、`row1[1]` は `b = 50` になり 1.5 と一致しない。

#### Green
- 変更: `src/lib/pipeline/fill.ts`
- 方針: scanline の各ペア `[a, b]` について以下:
```ts
const phase = (((line * shiftMm) % patternLengthMm) + patternLengthMm) % patternLengthMm;
const pts: Point[] = [[ox+dir[0]*a, oy+dir[1]*a]];
if (phase > 0) {
  let t = a + phase;
  while (t < b - 1e-9) {
    pts.push([ox+dir[0]*t, oy+dir[1]*t]);
    t += maxStitchMm;
  }
}
pts.push([ox+dir[0]*b, oy+dir[1]*b]);
segments.push(pts);
```
- `phase === 0` 分岐は Cycle 1 の equivalence を守るための暫定ガード (コメント明記)。

#### Refactor
- ガード `phase === 0 → 端点だけ` は将来 `maxStitchMm` ベースで全行に内部点を打つ拡張と衝突する。コメントで「Cycle 1 の bit-equivalence を守る暫定実装」と明記。

---

### Cycle 3: `patternLengthMm` で位相が周期する

#### Red
```ts
describe("tatamiBrick — phase wraps at patternLengthMm", () => {
  it("(line * shiftMm) > patternLengthMm で mod ラップ", () => {
    const shape: Shape = {
      outer: [[0,0],[50,0],[50,30],[0,30]], holes: [],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const segByY = new Map<number, [number, number][]>();
    for (const seg of segs) {
      const y = Math.round(seg[0][1] * 100) / 100;
      if (!segByY.has(y)) segByY.set(y, seg);
    }
    const ys = [...segByY.keys()].sort((a,b)=>a-b);
    // 行 3: phase = (3*1.5) mod 4.0 = 4.5 mod 4.0 = 0.5
    const row3 = segByY.get(ys[3])!;
    expect(row3[1][0]).toBeCloseTo(0.5, 4);
  });

  it("patternLengthMm の倍数行で phase が 0 に回帰", () => {
    const shape: Shape = {
      outer: [[0,0],[50,0],[50,30],[0,30]], holes: [],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.0, 4.0);
    const segByY = new Map<number, [number, number][]>();
    for (const seg of segs) {
      const y = Math.round(seg[0][1] * 100) / 100;
      if (!segByY.has(y)) segByY.set(y, seg);
    }
    const ys = [...segByY.keys()].sort((a,b)=>a-b);
    // 行 4: phase = (4*1.0) mod 4.0 = 0 → 端点 2 点のみ
    expect(segByY.get(ys[4])!.length).toBe(2);
  });
});
```
**失敗理由**: Cycle 2 で `% patternLengthMm` を入れた実装ならケース 1 は通るが、ケース 2 は floating point の `(4 * 1.0) % 4.0` が `0` か微小残差かに依存。`PHASE_EPS` ガードを入れないと segment が 3 点 (端点 + 残差ぶんの内部点) になり失敗する。

#### Green
- 変更: `src/lib/pipeline/fill.ts`
```ts
const PHASE_EPS = 1e-9;
let phase = (((line * shiftMm) % patternLengthMm) + patternLengthMm) % patternLengthMm;
if (phase < PHASE_EPS || patternLengthMm - phase < PHASE_EPS) phase = 0;
```

#### Refactor
- `computePhase(line, shiftMm, patternLengthMm)` ヘルパに切り出し、`PHASE_EPS` を module-scope 定数に固定。

---

### Cycle 4: 穴を尊重する

#### Red
```ts
describe("tatamiBrick — respects holes", () => {
  it("穴の中に針落ち点が来ない", () => {
    const shape: Shape = {
      outer: [[0,0],[20,0],[20,20],[0,20]],
      holes: [[[8,8],[12,8],[12,12],[8,12]]],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const allPts = segs.flat();
    const inHole = allPts.filter(
      ([x,y]) => x > 8.5 && x < 11.5 && y > 8.5 && y < 11.5,
    );
    expect(inHole.length).toBe(0);
  });
  it("穴跨ぎ scanline は 2 segment 以上に分割", () => {
    const shape: Shape = {
      outer: [[0,0],[20,0],[20,20],[0,20]],
      holes: [[[8,8],[12,8],[12,12],[8,12]]],
    };
    const segs = tatamiBrick(shape, 1, 0, 3, 1.5, 4.0);
    const onHoleLine = segs.filter(seg => Math.abs(seg[0][1] - 10) < 0.5);
    expect(onHoleLine.length).toBeGreaterThanOrEqual(2);
  });
});
```
**失敗理由**: Cycle 2-3 で穴を考慮した crossings ペア化 (`for i+=2`) を正しく実装していれば既に通るはずだが、ペア化を誤ると穴の中を跨ぐ segment が生成され、内部針落ち点が穴の中に入る。本サイクルで明示的に守る。

#### Green
- 変更: `src/lib/pipeline/fill.ts`
- 方針: 既存 `fillStitches` のペア化ロジックを踏襲 (`rings = [shape.outer, ...shape.holes]` を `intersectScanline` に渡し、crossings を sort → `for (i=0; i<crossings.length; i+=2)`)。内部針落ち点も `while (t < b - eps)` で `[a, b]` の範囲内に閉じる。

#### Refactor
- `crossings.length % 2 !== 0` のとき `pop()` する fallback (既存と同条件) にコメントを追加。

---

### Cycle 5: renderer 統合 + 構造整理

#### Red
```ts
import { generateStitches } from "../stitch";
import type { ColorRegion } from "../vectorize";

describe("generateStitches — uses tatamiBrick for fill", () => {
  it("50x50 矩形 fill で内部針落ち x が brick 分散している", () => {
    const regions: ColorRegion[] = [{
      colorIndex: 0, rgb: [0,0,0], svgPath: "", polygons: [],
      shapes: [{ outer: [[0,0],[50,0],[50,50],[0,50]], holes: [] }],
    }];
    const pattern = generateStitches({
      regions,
      widthMm: 50, heightMm: 50, widthPx: 50, heightPx: 50,
      stitchDensityMm: 1, satinMaxWidthMm: 2, maxStitchMm: 3,
      fillAngleDeg: 0,
    });
    const fills = pattern.blocks[0].stitches.filter(s => s.kind === "fill");
    const internalXs = new Set(
      fills.map(s => Math.round(s.x * 10) / 10)
           .filter(x => x > 0.05 && x < 49.95),
    );
    expect(internalXs.size).toBeGreaterThan(5);
  });
});
```
**失敗理由**: renderer がまだ `fillStitches(...)` を呼んでいるため、行内中間針落ち点は `appendStitchesWithJumps` 側の線形補間で行間とも揃ったままで、`internalXs.size` は scanline 行数より小さくなる (おそらく 3 以下)。

#### Green
- 変更: renderer ファイル (`stitch.ts` もしくは `render.ts`)
  - import 追加: `import { tatamiBrick } from "./fill";`
  - fill のレンダリング呼び出しを `fillStitches(...)` → `tatamiBrick(...)` に置換 (`shiftMm`, `patternLengthMm` はデフォルト値 1.5 / 4.0)
  - `__internal` export に `tatamiBrick` を追加 (任意; テスト容易性向上)

#### Refactor
- 既存 `fillStitches` との共通化を将来検討する旨を `fill.ts` 冒頭の JSDoc に残す
- `fillStitches` (旧) は当面残し、Phase 4 完了時点で `__internal` から外す or 削除する PR を別途切る

---

## 7. サイクル依存グラフ
```
Cycle 1 (fill.ts 雛形 + shiftMm=0 等価性)
   ↓
Cycle 2 (行ごとの位相シフト)
   ↓
Cycle 3 (patternLengthMm 周期 + PHASE_EPS)
   ↓
Cycle 4 (holes 尊重)
   ↓
Cycle 5 (renderer 統合 + 構造整理)
```

## 8. 回帰防止
- **既存 vitest スイート全件 green** (`npm test`)
  - 特に `stitch.test.ts`:
    - `fillStitches with hole` 3 ケース (穴あり/穴なし)
    - `generateStitches integration` 4 ケース (jump-after-init bug, fillAngleByColorIndex, 穴あき矩形, fillStrategy)
    - `generateStitches with fillStrategy` 3 ケース (long-axis / cross-axis / 等方形 fallback)
- **Phase 1 PR4 計画書の renderDesign equivalence 観点**: `render.ts` 自体は未作成だが、equivalence の核心 = 「同じ regions を渡したときの (x, y, kind, colorIndex) が legacy と一致」は `shiftMm = 0` モード下で `tatamiBrick` が `fillStitches` と bit-equal な座標を返すことで維持される (Cycle 1 が保証)。本 PR は default を `shiftMm = 1.5` にするため、equivalence は「`shiftMm = 0` を渡したとき」の条件下で成り立つことを明記する。
- **品質指標**: `npm run lint` も green

## 9. 受け入れ条件
- [ ] `src/lib/pipeline/fill.ts` が新規作成され、`tatamiBrick` が export されている
- [ ] `tatamiBrick(shape, density, angle, maxStitch, 0, patternLength)` の出力が `fillStitches(shape, density, angle)` と座標 6 桁精度で一致する (Cycle 1)
- [ ] `shiftMm = 1.5`, `patternLengthMm = 4.0` のとき、行 1 の最初の内部針落ち点 x が `1.5mm` になる (Cycle 2)
- [ ] `patternLengthMm` の倍数行で phase が 0 に回帰し segment が端点 2 点だけになる (Cycle 3)
- [ ] 穴を持つ shape で穴の中に針落ち点が生成されない (Cycle 4)
- [ ] renderer の fill 経路が `tatamiBrick` を呼び出している
- [ ] `generateStitches` 経由でも brick 効果が観測される (50x50 矩形で内部針落ち x が 5 種以上に分散; Cycle 5)
- [ ] 既存 `npm test` 全件 green
- [ ] `npm run lint` green
- [ ] `tatamiBrick` が純関数 (副作用なし、同一入力で同一出力) であることをコメントで明示

## 10. コミット粒度
TDD サイクル単位で 1 コミット (Red+Green+Refactor を 1 コミットにまとめる方針)。計 5 コミット予定。

1. `feat(fill): introduce tatamiBrick with shiftMm=0 equivalence` (Cycle 1)
2. `feat(fill): apply per-row phase shift for brick pattern` (Cycle 2)
3. `feat(fill): wrap phase at patternLengthMm with eps guard` (Cycle 3)
4. `test(fill): respect holes in tatamiBrick` (Cycle 4)
5. `feat(pipeline): switch fill renderer to tatamiBrick (phase 4 pr1)` (Cycle 5)

各コミット時点で `npm test` が green。

## 11. 想定 PR タイトル
`feat(pipeline): add tatami brick fill pattern (phase 4 pr1)`

## 12. 注意事項・将来の整理 (スコープ外)
- `intersectScanline` の `__internal` 経由共有は暫定。将来 `geometry.ts` のような共通モジュールへ切り出すのが望ましい (本 PR の Refactor では未着手)。
- ランダム化オプション (`FillPattern.kind = "random-phase"`, `jitter`, `seed`) は Phase 4 計画書 §5.3 にあるが本 PR のスコープ外。
- `shiftMm = 1.5`, `patternLengthMm = 4.0` は renderer の呼び出しに直接埋め込み (UI 露出は将来 PR)。
