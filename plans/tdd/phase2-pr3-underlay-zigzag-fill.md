# Phase 2 PR3 — zigzag + fill underlay TDD 計画

## 1. 概要

Phase 2 計画書「3.1 種別」のうち面系 (幅広 satin / fill object 用) underlay 2 種、
`zigzagUnderlay` と `fillUnderlay` を `src/lib/pipeline/underlay.ts` に追加する。

- `fillUnderlay`: fill object 用。表縫い角度 `angleDeg` に対し直交方向 (`angleDeg + 90`) で粗い `spacingMm` (~3mm) の scanline を流す。既存 `fillStitches` と同じ scanline 機構 (`intersectScanline`) を再利用し、`Point[][]` (穴跨ぎ・行ごとにセグメント分割) を返す純関数。
- `zigzagUnderlay`: 幅広 satin (幅 4mm 以上) 用。shape を PCA で長軸/短軸に分解し、両端 rail (短軸方向に `±(shortSide/2 - insetMm)` でオフセットした 2 線) 間を `spacingMm` (~2mm) で往復する単一 polyline (`Point[]`) を返す純関数。

副作用なし。`generateUnderlayStitches` への wiring や `EmbroideryObject` 統合は本 PR では任意 (Cycle 5)。

## 2. 依存関係

- **Phase 1 全体** (`EmbroideryObject`, `UnderlayConfig`, `Shape`, `Point2D`, `geometry.ts` 等)
- **Phase 2 PR1** (`clipper-lib` 導入済み — zigzag の inset 計算で利用可)
- **Phase 2 PR2** (`underlay.ts` ファイル作成済み: `centerRunUnderlay` / `edgeRunUnderlay` / `generateUnderlayStitches` skeleton が既に存在する想定)

依存していないもの: Phase 2 PR4 (lockstitch integration), Phase 4 (2-rail satin)。

## 3. 影響ファイル

| 種別 | パス | 内容 |
|------|------|------|
| 編集 | `src/lib/pipeline/underlay.ts` | `fillUnderlay` / `zigzagUnderlay` をエクスポート追記 |
| 編集 | `src/lib/pipeline/__tests__/underlay.test.ts` | 本 PR 用の `describe("fillUnderlay")` / `describe("zigzagUnderlay")` を追記 |
| 参照のみ | `src/lib/pipeline/stitch.ts` | `intersectScanline` / `analyzeShape` を `__internal` 経由 (もしくは PR2 で `geometry.ts` に切り出し済み) で再利用 |
| 参照のみ | `src/lib/pipeline/types.ts` | `Shape`, `Point2D` を import |

## 4. テスト環境

- フレームワーク: **Vitest** (`describe`/`it`/`expect`)
- 実行コマンド: `npm test` (= `vitest run`) または単体で `npx vitest run src/lib/pipeline/__tests__/underlay.test.ts`
- テスト配置: `src/lib/pipeline/__tests__/*.test.ts` (既存 `stitch.test.ts` / `vectorize.test.ts` と同じ)
- 浮動小数比較は `toBeCloseTo(value, 5)` を使用 (既存テストの慣行に合わせる)

## 5. インターフェース設計

```ts
// src/lib/pipeline/underlay.ts (追記分)
import type { Shape, Point2D } from "./types";

/**
 * fill object 用 underlay。表縫いと直交方向 (`angleDeg + 90`) に、
 * `spacingMm` (~3mm 推奨) の粗い scanline を流す。
 */
export function fillUnderlay(
  shape: Shape,
  angleDeg: number,
  spacingMm: number,
): Point2D[][];

/**
 * 幅広 satin 用 underlay。PCA 長軸に沿って両 rail (短軸方向に
 * `±(shortSide/2 - insetMm)` でオフセットした 2 線) 間を `spacingMm` で往復する
 * 単一 polyline を返す。
 */
export function zigzagUnderlay(
  shape: Shape,
  spacingMm: number,
  insetMm: number,
): Point2D[];
```

## 6. TDD サイクル

### Cycle 1: fillUnderlay — 表縫い水平 (angle 0) に直交した垂直スキャン

**Red**
```ts
import { describe, it, expect } from "vitest";
import { fillUnderlay, zigzagUnderlay } from "../underlay";
import type { Shape } from "../types";

describe("fillUnderlay", () => {
  it("表縫い水平 (angle 0) に直交した垂直スキャンを spacingMm 間隔で生成する", () => {
    const shape: Shape = {
      outer: [[0,0],[10,0],[10,10],[0,10]],
      holes: [],
    };
    const segments = fillUnderlay(shape, 0, 3);
    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments.length).toBeLessThanOrEqual(4);
    for (const seg of segments) {
      expect(seg.length).toBe(2);
      const [p0, p1] = seg;
      expect(p0[0]).toBeCloseTo(p1[0], 5);
      const ys = [p0[1], p1[1]].sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(0, 5);
      expect(ys[1]).toBeCloseTo(10, 5);
    }
  });
});
```
失敗理由: `fillUnderlay` 未エクスポートで import エラー。

**Green**
- `stitch.ts.__internal.intersectScanline` (または PR2 切り出し済みなら `geometry.ts`) を import。
- `fillUnderlay(shape, angleDeg, spacingMm)`: `rad = ((angleDeg + 90) * π) / 180`, `dir = [cos,sin]`, `perp = [-dir[1], dir[0]]`、`outer` で bbox 取得し `s = minS..maxS` を `spacingMm` 刻みで走査、`intersectScanline([outer, ...holes], ox, oy, dir)` の交点をソート→偶奇ペア化、各ペアを 2 点セグメントとして push。boustrophedon は不要。

**Refactor**: 単一サイクル目につき不要。

---

### Cycle 2: fillUnderlay — spacingMm 反比例 + 穴処理

**Red**
```ts
it("spacingMm を半分にすると scanline 本数がおおむね倍になる", () => {
  const shape: Shape = { outer: [[0,0],[20,0],[20,20],[0,20]], holes: [] };
  const coarse = fillUnderlay(shape, 0, 4);
  const fine = fillUnderlay(shape, 0, 2);
  expect(coarse.length).toBeGreaterThanOrEqual(5);
  expect(coarse.length).toBeLessThanOrEqual(6);
  expect(fine.length).toBeGreaterThanOrEqual(10);
  expect(fine.length).toBeLessThanOrEqual(11);
  expect(fine.length).toBeGreaterThan(coarse.length * 1.6);
});

it("穴 (中抜き) を持つ shape では穴内部に scanline が走らない", () => {
  const shape: Shape = {
    outer: [[0,0],[20,0],[20,20],[0,20]],
    holes: [[[8,8],[12,8],[12,12],[8,12]]],
  };
  const segments = fillUnderlay(shape, 0, 1);
  const pts = segments.flat();
  const insideHole = pts.filter(([x, y]) => x > 8.5 && x < 11.5 && y > 9 && y < 11);
  expect(insideHole.length).toBe(0);
});
```
失敗理由: Cycle 1 で大半通る想定。bbox 端点処理で 1 本ずれる可能性あり、穴処理は `intersectScanline` に holes を渡しているかで切り替わる。

**Green**
- `intersectScanline([outer, ...holes], ...)` で even-odd 偶奇ペア化。
- 走査ループは `for (let s = minS; s <= maxS + 1e-9; s += spacingMm)` で末端を含めて安定化。

**Refactor**: `fillStitches` と 90% 同一になれば `scanFillSegments(shape, densityMm, angleDeg)` を `underlay.ts` ローカルヘルパに切り出す。

---

### Cycle 3: zigzagUnderlay — 細長 satin の両 rail 間往復

**Red**
```ts
describe("zigzagUnderlay", () => {
  it("細長矩形 (幅 5mm × 長さ 30mm) で両 rail 間を spacingMm 間隔で往復する", () => {
    const shape: Shape = { outer: [[0,0],[30,0],[30,5],[0,5]], holes: [] };
    const pts = zigzagUnderlay(shape, 2, 0.5);
    expect(pts.length).toBeGreaterThanOrEqual(28);
    expect(pts.length).toBeLessThanOrEqual(34);
    const ys = pts.map(([, y]) => y);
    const railLow = ys.filter((y) => Math.abs(y - 0.5) < 0.1).length;
    const railHigh = ys.filter((y) => Math.abs(y - 4.5) < 0.1).length;
    expect(railLow + railHigh).toBe(pts.length);
    expect(Math.abs(railLow - railHigh)).toBeLessThanOrEqual(1);
    for (let i = 1; i < pts.length; i++) {
      const prevHigh = pts[i - 1][1] > 2.5;
      const currHigh = pts[i][1] > 2.5;
      expect(currHigh).not.toBe(prevHigh);
    }
  });
});
```
失敗理由: `zigzagUnderlay` 未エクスポートで import エラー。

**Green**
- `analyzeShape(shape.outer)` で `{ shortSide, longAxis, center }` 取得 → `shortAxis = [-longAxis[1], longAxis[0]]`。
- 長軸 bbox `[minL, maxL]` を `shape.outer` から算出。
- `halfWidth = shortSide / 2 - insetMm`、`steps = max(1, round((maxL - minL) / spacingMm))`。
- ループ:
  ```ts
  for (let i = 0; i <= steps; i++) {
    const l = minL + ((maxL - minL) * i) / steps;
    const ox = center[0] + longAxis[0] * l;
    const oy = center[1] + longAxis[1] * l;
    const side = i % 2 === 0 ? -halfWidth : +halfWidth;
    out.push([ox + shortAxis[0] * side, oy + shortAxis[1] * side]);
  }
  ```
- `holes` は無視 (satin underlay の前提)。

**Refactor**: `analyzeShape` の import 経路を `__internal` か `geometry.ts` のどちらに統一するか決定。`halfWidth <= 0` ガードへコメント追加。

---

### Cycle 4: zigzagUnderlay — spacingMm/insetMm の反映 + 退化ケース

**Red**
```ts
it("spacingMm が小さいほどステップ数が増える", () => {
  const shape: Shape = { outer: [[0,0],[40,0],[40,6],[0,6]], holes: [] };
  const sparse = zigzagUnderlay(shape, 4, 0.5);
  const dense  = zigzagUnderlay(shape, 1, 0.5);
  expect(sparse.length).toBeGreaterThanOrEqual(10);
  expect(sparse.length).toBeLessThanOrEqual(12);
  expect(dense.length).toBeGreaterThanOrEqual(40);
  expect(dense.length).toBeLessThanOrEqual(42);
});

it("insetMm を 1.0 に増やすと rail 位置が内側に寄る", () => {
  const shape: Shape = { outer: [[0,0],[20,0],[20,5],[0,5]], holes: [] };
  const small = zigzagUnderlay(shape, 2, 0.5);
  const large = zigzagUnderlay(shape, 2, 1.0);
  const ySmall = new Set(small.map(([, y]) => Math.round(y * 10) / 10));
  const yLarge = new Set(large.map(([, y]) => Math.round(y * 10) / 10));
  expect(ySmall.has(0.5)).toBe(true);
  expect(ySmall.has(4.5)).toBe(true);
  expect(yLarge.has(1.0)).toBe(true);
  expect(yLarge.has(4.0)).toBe(true);
});

it("insetMm が shortSide/2 を超えると空配列を返す (退化ケース)", () => {
  const shape: Shape = { outer: [[0,0],[20,0],[20,2],[0,2]], holes: [] };
  const pts = zigzagUnderlay(shape, 2, 2.0);
  expect(pts).toEqual([]);
});
```
失敗理由: Cycle 3 でほぼ通るが、退化ガード未実装と端点処理で fail し得る。

**Green**
- `if (halfWidth <= 0) return [];` 退化ガード追加。
- `steps = Math.max(1, Math.round((maxL - minL) / spacingMm))`。
- `i <= steps` で端点を含めて点数を `spacingMm` に反比例させる。

**Refactor**: `side` 判定を `isHigh` 明示変数に。import 経路を Cycle 1/3 と統一。

---

### Cycle 5 (任意): generateUnderlayStitches dispatch 配線

**Red**
```ts
import { generateUnderlayStitches } from "../underlay";
import type { EmbroideryObject } from "../types";

it("UnderlayConfig.kind = 'fill' のとき fillUnderlay 経由で stitch が出る", () => {
  const obj: EmbroideryObject = {
    id: "o1", kind: "fill", colorIndex: 0, rgb: [0,0,0],
    shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] },
    props: { underlay: { kind: "fill", spacingMm: 3, angleDeg: 0 }, stitchLenMm: 3 },
  };
  const stitches = generateUnderlayStitches(obj);
  expect(stitches.length).toBeGreaterThan(0);
  for (const s of stitches) expect(["run","jump"]).toContain(s.kind);
});

it("UnderlayConfig.kind = 'zigzag' のとき zigzagUnderlay 経由で stitch が出る", () => {
  const obj: EmbroideryObject = {
    id: "o2", kind: "satin", colorIndex: 0, rgb: [0,0,0],
    shape: { outer: [[0,0],[30,0],[30,5],[0,5]], holes: [] },
    props: { underlay: { kind: "zigzag", spacingMm: 2, insetMm: 0.5 }, stitchLenMm: 3 },
  };
  const stitches = generateUnderlayStitches(obj);
  expect(stitches.length).toBeGreaterThan(10);
});
```
失敗理由: switch に `case "fill"` / `case "zigzag"` が無いと空配列 → fail。

**Green**
```ts
case "fill": {
  const segs = fillUnderlay(obj.shape, u.angleDeg ?? 0, u.spacingMm);
  return segs.flatMap((seg) =>
    seg.map((p) => ({ x: p[0], y: p[1], kind: "run" as const, colorIndex: obj.colorIndex }))
  );
}
case "zigzag": {
  const pts = zigzagUnderlay(obj.shape, u.spacingMm, u.insetMm ?? 0.4);
  return pts.map((p) => ({ x: p[0], y: p[1], kind: "run" as const, colorIndex: obj.colorIndex }));
}
```
jump 挿入や stitchLen 細分化は本 PR 範囲外 (PR4 render 統合)。

**Refactor**: `segmentsToRunStitches(segs, colorIndex)` ヘルパに集約して `fill`/`zigzag`/既存 `edge-run`/`center-run` で共有。

---

## 7. 回帰防止

- 既存 `src/lib/pipeline/__tests__/stitch.test.ts` 全件 green を維持。`intersectScanline` / `fillStitches` の挙動は不変。
- Phase 2 PR2 の `underlay.test.ts` (`centerRunUnderlay`, `edgeRunUnderlay`) も green を維持。
- `npm test` 全体 green。
- `generateStitches` の出力 stitch 数は本 PR で変化しない (render 配線は行わない)。

## 8. 受け入れ条件

- [ ] `src/lib/pipeline/underlay.ts` に `fillUnderlay`, `zigzagUnderlay` が export されている
- [ ] `fillUnderlay(10x10mm, 0, 3)` で 3〜4 本の垂直 polyline (各 2 点) が返る
- [ ] `fillUnderlay` の出力本数が `spacingMm` に概ね反比例する
- [ ] `fillUnderlay` は穴を尊重し、穴内部に scanline 端点が落ちない
- [ ] `fillUnderlay` は内部で `angleDeg + 90` を採用 (表縫いと直交)
- [ ] `zigzagUnderlay(5x30mm, 2, 0.5)` が両 rail (y=0.5, y=4.5) 間を 15 回程度往復する単一 polyline を返す
- [ ] `zigzagUnderlay` の出力点数が `spacingMm` に概ね反比例する
- [ ] `zigzagUnderlay` の rail 位置が `insetMm` で内側にシフトする
- [ ] `zigzagUnderlay` は `halfWidth <= 0` の退化ケースで `[]` を返す
- [ ] `fillUnderlay` / `zigzagUnderlay` は純関数 (mutate しない・外部状態を持たない)
- [ ] (任意) `generateUnderlayStitches` が `kind: "fill"` / `kind: "zigzag"` を dispatch できる
- [ ] `npm test` 全件 green
- [ ] `npm run lint` clean

## 9. コミット粒度

TDD サイクル単位:

1. `test(underlay): add failing test for fillUnderlay (orthogonal scanline)`
2. `feat(underlay): implement fillUnderlay reusing scanline (phase 2 pr3)`
3. `test(underlay): cover fillUnderlay spacing scaling and hole handling`
4. `test(underlay): add failing test for zigzagUnderlay (rail oscillation)`
5. `feat(underlay): implement zigzagUnderlay via PCA long-axis traversal`
6. `test(underlay): cover zigzagUnderlay spacing/inset scaling and degeneracy`
7. (任意) `feat(underlay): wire fill/zigzag cases in generateUnderlayStitches`

## 10. 想定 PR タイトル

```
feat(pipeline): add zigzag and fill underlay (phase 2 pr3)
```

## 11. 注意事項

- `intersectScanline` / `analyzeShape` の import 元: PR2 で `geometry.ts` に切り出し済みならそちらから直接、未だなら `stitch.ts.__internal` 経由。本 PR では `geometry.ts` を新規作成しない。
- Phase 2 計画書 3.1 のデフォルト値域 (`fillUnderlay: spacingMm ~3mm`, `zigzagUnderlay: spacingMm ~2mm, insetMm ~0.5mm`) はテストの fixture 値として採用するが、関数自体はハードコードしない (呼び出し側 = `applyUnderlayDefaults` が決定する設計を維持)。
- `zigzagUnderlay` は Phase 4 で 2-rail satin が入るまで PCA 長軸ベースの簡易実装でよい。シグネチャ (`shape, spacingMm, insetMm`) は将来も互換となるよう保つ。
- 副作用なし、`shape` を mutate しない、`Math.random` / `Date.now` を使わない純関数として実装する。
