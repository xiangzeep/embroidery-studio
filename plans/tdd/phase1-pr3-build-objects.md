# Phase 1 PR3: build-objects 分離 — TDD 計画

## 1. 概要

`src/lib/pipeline/stitch.ts` の `generateStitches` 内に埋め込まれている「shape ごとの kind 判定 (run / satin / fill)」のロジックを、新規モジュール `src/lib/pipeline/build-objects.ts` に切り出す。

`ColorRegion[]` を入力として受け取り、各 `shape` を `EmbroideryObject` に変換して配列として返す。kind 判定の閾値 (`runMaxWidthMm = 0.6`, `satinMaxWidthMm`, `aspectRatio > 4`) は既存ロジックをそのまま踏襲する。`props` のデフォルトは `FabricProfile` から派生させ、`order` は入力順 (region.colorIndex 昇順、その中で shape の出現順) で採番する。

実際の stitch 生成 (run/satin/fill renderer) は PR4 のスコープであり、この PR では **kind 判定とオブジェクト構築まで** が対象。`generateStitches` の挙動は変えず、内部で `buildObjects` を経由するように差し替えるか、もしくは判定ロジックを共通ヘルパーとして共有することで既存テスト件数を維持する。

## 2. 依存関係

- **PR1 (型定義)** がマージ済みであること
  - `EmbroideryObject`, `ObjectKind`, `ObjectProps`, `UnderlayConfig`, `EmbroideryDesign` が `src/lib/pipeline/types.ts` に追加されている
- **PR2 (生地プロファイル)** がマージ済みであること
  - `FabricProfile`, `FABRIC_PROFILES`, `pullCompForWidth(profile, widthMm)`, `underlayPolicy` が `src/lib/pipeline/fabric.ts` に存在する

## 3. 影響ファイル

### 新規
- `src/lib/pipeline/build-objects.ts` — `buildObjects` 本体
- `src/lib/pipeline/__tests__/build-objects.test.ts` — 単体テスト

### 編集
- `src/lib/pipeline/stitch.ts` — kind 判定ロジック (現 L105-L156) を `build-objects.ts` に委譲。`analyzeShape` / `computeAspectRatio` の export を整理

### 場合により切り出し
- `src/lib/pipeline/geometry.ts` (新規) — `analyzeShape`, `computeAspectRatio` などの PCA ベースの幾何ユーティリティ共通モジュール。`stitch.ts` と `build-objects.ts` の両方から import する

## 4. テスト環境
- **フレームワーク**: vitest
- **実行コマンド**: `npm test` (または `npx vitest run`)
- **テストファイル配置**: `src/lib/pipeline/__tests__/*.test.ts`
- **既存パターン**: `describe / it / expect` の BDD 形式。`__internal` 経由で private 関数を export してテストする慣習あり

## 5. インターフェース設計

### 5.1 関数シグネチャ

```ts
// src/lib/pipeline/build-objects.ts
import type { ColorRegion } from "./vectorize";
import type {
  EmbroideryObject,
  ObjectKind,
  ObjectProps,
  FabricProfile,
  Shape,
} from "./types";

export type BuildObjectsInput = {
  regions: ColorRegion[];
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  fabric: FabricProfile;
  /** kind 判定の閾値オーバーライド。未指定なら既定値を使う */
  runMaxWidthMm?: number;    // default 0.6
  satinMaxWidthMm?: number;  // 既定値は config 側で渡す想定
  /** satin 判定の aspect ratio 下限 (既定 4) */
  satinMinAspectRatio?: number;
};

export function buildObjects(input: BuildObjectsInput): EmbroideryObject[];
```

### 5.2 EmbroideryObject の組み立てルール

```ts
{
  id: `${region.colorIndex}-${shapeIndexWithinRegion}`,   // 安定 ID
  kind,                                                    // 後述の判定
  colorIndex: region.colorIndex,
  rgb: region.rgb,
  shape: shapeMm,                                          // mm 座標に変換済み
  props: deriveDefaultProps(kind, shapeMm, fabric),
  order: globalIndex,                                      // 0-based, region 昇順 × shape 出現順
}
```

### 5.3 kind 判定ロジック (現 `stitch.ts:105-156` の踏襲)

```
{ shortSide, longAxis, center } = analyzeShape(outerMm)
aspectRatio = computeAspectRatio(outerMm, longAxis, center)
hasHoles = shapeMm.holes.length > 0

if (shortSide < runMaxWidthMm)
  → kind = "run"
else if (!hasHoles && shortSide < satinMaxWidthMm && aspectRatio > 4)
  → kind = "satin"
else
  → kind = "fill"
```

### 5.4 props デフォルト派生規則

```ts
function deriveDefaultProps(
  kind: ObjectKind,
  shape: Shape,
  fabric: FabricProfile,
): ObjectProps {
  const base: ObjectProps = {
    densityMm: fabric.defaultDensityMm,
    maxStitchMm: 7,                                    // 共通既定
    underlay: fabric.underlayPolicy[kind](
      kind === "satin" ? estimateSatinWidthMm(shape) : 0,
    ),
    pushCompMm: fabric.defaultPushCompMm,
  };
  if (kind === "satin") {
    base.pullCompMm = pullCompForWidth(fabric, estimateSatinWidthMm(shape));
  }
  if (kind !== "run") {
    base.angleDeg = undefined;  // Phase 1 では未設定、PR4 / Phase 5 で上書き
  }
  return base;
}
```

- `estimateSatinWidthMm(shape)` は内部ヘルパー: `analyzeShape(shape.outer).shortSide` を返す
- `underlayPolicy` の関数シグネチャ (`(widthMm: number) => UnderlayConfig`) に揃える
- `pullCompForWidth` は PR2 で提供される (`max(profile.minPullCompMm, profile.pullCompPerWidth * widthMm)` 想定)

### 5.5 内部 export (テスト用)

```ts
export const __internal = {
  deriveDefaultProps,
  determineKind,
  estimateSatinWidthMm,
};
```

## 6. TDD サイクル

---

### Cycle 1: 関数の最小骨格 (空 region で空配列を返す)

#### Red — 失敗するテスト
```ts
// src/lib/pipeline/__tests__/build-objects.test.ts
import { describe, it, expect } from "vitest";
import { buildObjects } from "../build-objects";
import { FABRIC_PROFILES } from "../fabric";

describe("buildObjects — 基本", () => {
  it("regions が空なら空配列を返す", () => {
    const result = buildObjects({
      regions: [],
      widthMm: 100,
      heightMm: 100,
      widthPx: 1000,
      heightPx: 1000,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toEqual([]);
  });

  it("shape.outer が 3 点未満の region は無視される", () => {
    const result = buildObjects({
      regions: [{
        colorIndex: 0,
        rgb: [0, 0, 0],
        svgPath: "",
        shapes: [{ outer: [[0, 0], [1, 1]], holes: [] }],
        polygons: [],
      }],
      widthMm: 100, heightMm: 100, widthPx: 100, heightPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toEqual([]);
  });
});
```

**失敗理由**: `buildObjects` 関数が未定義 (`ReferenceError`)。

#### Green — 最小実装
- 新規ファイル `src/lib/pipeline/build-objects.ts` を作成
- 入力 `regions` を `colorIndex` 昇順にソートしてループ、shape ごとに `outer.length < 3` をスキップする骨格だけ実装
- とりあえず空配列を返す処理だけ書く

```ts
export function buildObjects(input: BuildObjectsInput): EmbroideryObject[] {
  const result: EmbroideryObject[] = [];
  const sorted = [...input.regions].sort((a, b) => a.colorIndex - b.colorIndex);
  for (const region of sorted) {
    for (const shapePx of region.shapes) {
      if (shapePx.outer.length < 3) continue;
      // TODO: Cycle 2 以降で構築
    }
  }
  return result;
}
```

#### Refactor
- 不要 (骨格のみ)

---

### Cycle 2: 矩形塗り (1 色) → kind=fill のオブジェクト 1 つ

#### Red — 失敗するテスト
```ts
describe("buildObjects — kind 判定: fill", () => {
  it("正方形 (10mm 角) の region は kind=fill になる", () => {
    const square: ColorRegion = {
      colorIndex: 0,
      rgb: [255, 0, 0],
      svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],  // px 座標
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [square],
      widthMm: 10, heightMm: 10,     // 1px = 0.1mm
      widthPx: 100, heightPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "fill",
      colorIndex: 0,
      rgb: [255, 0, 0],
      order: 0,
    });
    // mm 座標に変換されている (10mm × 10mm の正方形)
    expect(result[0].shape.outer).toEqual([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ]);
    expect(result[0].shape.holes).toEqual([]);
  });

  it("id が `${colorIndex}-${shapeIndex}` 形式で安定する", () => {
    const region: ColorRegion = {
      colorIndex: 2,
      rgb: [0, 0, 0],
      svgPath: "",
      shapes: [
        { outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] },
        { outer: [[200, 200], [300, 200], [300, 300], [200, 300]], holes: [] },
      ],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 30, heightMm: 30, widthPx: 300, heightPx: 300,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result.map((o) => o.id)).toEqual(["2-0", "2-1"]);
    expect(result.map((o) => o.order)).toEqual([0, 1]);
  });
});
```

**失敗理由**: `buildObjects` は空配列を返すだけなので `toHaveLength(1)` で失敗する。

#### Green — 最小実装
- shape ごとに px → mm 変換 (`mmPerPx = widthMm / widthPx`) して `shapeMm` を作る
- 暫定的にすべて `kind = "fill"` で `EmbroideryObject` を組み立てる
- `id`, `colorIndex`, `rgb`, `shape`, `order`, `props` を埋める (`props` は仮の空 object でも可、Cycle 5 で fabric 派生)

```ts
const mmPerPx = input.widthMm / input.widthPx;
let order = 0;
for (const region of sorted) {
  region.shapes.forEach((shapePx, shapeIndex) => {
    if (shapePx.outer.length < 3) return;
    const shapeMm = scaleShape(shapePx, mmPerPx);
    result.push({
      id: `${region.colorIndex}-${shapeIndex}`,
      kind: "fill",
      colorIndex: region.colorIndex,
      rgb: region.rgb,
      shape: shapeMm,
      props: { densityMm: input.fabric.defaultDensityMm, maxStitchMm: 7 },
      order: order++,
    });
  });
}
```

#### Refactor
- `scaleShape(shapePx, mmPerPx)` ヘルパーを抽出
- mm 変換ロジックを `geometry.ts` に切り出しても良い

---

### Cycle 3: 細長い帯 → kind=satin、1px 線 → kind=run

#### Red — 失敗するテスト
```ts
describe("buildObjects — kind 判定: satin / run", () => {
  it("細長い帯 (幅 0.8mm, 長さ 20mm, aspect > 4) は kind=satin", () => {
    // 100px x 8px = 10mm x 0.8mm (mmPerPx = 0.1)
    const stripe: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 8], [0, 8]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 10, heightMm: 1, widthPx: 100, heightPx: 10,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("satin");
  });

  it("極細線 (幅 0.4mm < runMaxWidthMm 0.6mm) は kind=run", () => {
    // 100px x 4px → 10mm x 0.4mm
    const thin: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 4], [0, 4]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [thin],
      widthMm: 10, heightMm: 1, widthPx: 100, heightPx: 10,
      fabric: FABRIC_PROFILES.denim,
      runMaxWidthMm: 0.6,
      satinMaxWidthMm: 6,
    });
    expect(result[0].kind).toBe("run");
  });

  it("aspect ratio が 4 以下なら satin にならず fill になる", () => {
    // 100px x 50px → 10mm x 5mm, aspect = 2
    const chubby: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 50], [0, 50]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [chubby],
      widthMm: 10, heightMm: 5, widthPx: 100, heightPx: 50,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("fill");
  });
});
```

**失敗理由**: Cycle 2 では暫定的にすべて `fill` を返しているため satin/run のテストが失敗する。

#### Green — 最小実装
- `determineKind(shapeMm, runMaxWidthMm, satinMaxWidthMm, satinMinAspectRatio)` を実装
- 内部で `analyzeShape(shapeMm.outer)` と `computeAspectRatio(...)` を呼んで現 `stitch.ts:105-117` のロジックを移植
- `stitch.ts` の `analyzeShape` / `computeAspectRatio` を export するか、`geometry.ts` に切り出して両方から import

```ts
function determineKind(
  shape: Shape,
  runMaxWidthMm: number,
  satinMaxWidthMm: number,
  satinMinAspectRatio: number,
): { kind: ObjectKind; shortSide: number; aspectRatio: number } {
  const { shortSide, longAxis, center } = analyzeShape(shape.outer);
  const aspectRatio = computeAspectRatio(shape.outer, longAxis, center);
  const hasHoles = shape.holes.length > 0;
  if (shortSide < runMaxWidthMm) return { kind: "run", shortSide, aspectRatio };
  if (!hasHoles && shortSide < satinMaxWidthMm && aspectRatio > satinMinAspectRatio) {
    return { kind: "satin", shortSide, aspectRatio };
  }
  return { kind: "fill", shortSide, aspectRatio };
}
```

#### Refactor
- `analyzeShape` / `computeAspectRatio` を `src/lib/pipeline/geometry.ts` に切り出し、`stitch.ts` の `__internal` export はそのまま残す (既存テスト互換)
- `stitch.ts` 内では `geometry.ts` から import するように差し替える

---

### Cycle 4: 穴あり塗りで `holes` が保持される

#### Red — 失敗するテスト
```ts
describe("buildObjects — 穴の保持", () => {
  it("外形に穴があると shape.holes が mm 座標で保持される", () => {
    const donut: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [200, 0], [200, 200], [0, 200]],   // 20mm 角
        holes: [[[80, 80], [120, 80], [120, 120], [80, 120]]],  // 中央 4mm 角の穴
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [donut],
      widthMm: 20, heightMm: 20, widthPx: 200, heightPx: 200,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("fill");           // holes ありなので satin にはならない
    expect(result[0].shape.holes).toEqual([
      [[8, 8], [12, 8], [12, 12], [8, 12]],
    ]);
  });

  it("3 点未満の holes はスキップされる", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
        holes: [[[10, 10], [20, 10]]],  // 2 点のみ
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result[0].shape.holes).toEqual([]);
  });
});
```

**失敗理由**: Cycle 2 で実装した `scaleShape` がまだ holes を処理していない (または holes フィルタが未実装)。

#### Green — 最小実装
- `scaleShape` 内で `shape.holes.filter((h) => h.length >= 3)` してから px → mm 変換
- 現 `stitch.ts:94-97` のロジックを移植

```ts
function scaleShape(shapePx: Shape, mmPerPx: number): Shape {
  return {
    outer: shapePx.outer.map(([x, y]) => [x * mmPerPx, y * mmPerPx]),
    holes: shapePx.holes
      .filter((h) => h.length >= 3)
      .map((h) => h.map(([x, y]) => [x * mmPerPx, y * mmPerPx])),
  };
}
```

#### Refactor
- `scaleShape` を `geometry.ts` に移動して再利用可能にする (任意)

---

### Cycle 5: props のデフォルトが fabric から派生する

#### Red — 失敗するテスト
```ts
describe("buildObjects — props のデフォルト派生", () => {
  it("densityMm が fabric.defaultDensityMm を採用する", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
        holes: [],
      }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
      fabric: FABRIC_PROFILES.denim,         // defaultDensityMm = 0.40
      satinMaxWidthMm: 6,
    });
    expect(result[0].props.densityMm).toBeCloseTo(0.40);
    expect(result[0].props.pushCompMm).toBe(FABRIC_PROFILES.denim.defaultPushCompMm);
    expect(result[0].props.maxStitchMm).toBe(7);
  });

  it("terry は denim より高い densityMm を持つ", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
      polygons: [],
    };
    const opts = {
      regions: [region],
      widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
      satinMaxWidthMm: 6,
    };
    const denim = buildObjects({ ...opts, fabric: FABRIC_PROFILES.denim });
    const terry = buildObjects({ ...opts, fabric: FABRIC_PROFILES.terry });
    expect(terry[0].props.densityMm).toBeGreaterThan(denim[0].props.densityMm);
  });

  it("satin オブジェクトには pullCompMm が幅 (shortSide) から派生する", () => {
    // 100px x 8px → 10mm x 0.8mm 帯
    const stripe: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 8], [0, 8]], holes: [] }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [stripe],
      widthMm: 10, heightMm: 1, widthPx: 100, heightPx: 10,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
      satinMinAspectRatio: 4,
    });
    expect(result[0].kind).toBe("satin");
    // pullCompForWidth(denim, 0.8) = max(0.10, 0.025 * 0.8) = max(0.10, 0.02) = 0.10
    expect(result[0].props.pullCompMm).toBeCloseTo(0.10);
  });

  it("underlay が fabric.underlayPolicy[kind](width) で派生する", () => {
    const region: ColorRegion = {
      colorIndex: 0, rgb: [0, 0, 0], svgPath: "",
      shapes: [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
      polygons: [],
    };
    const result = buildObjects({
      regions: [region],
      widthMm: 10, heightMm: 10, widthPx: 100, heightPx: 100,
      fabric: FABRIC_PROFILES.denim,
      satinMaxWidthMm: 6,
    });
    expect(result[0].props.underlay).toEqual(
      FABRIC_PROFILES.denim.underlayPolicy.fill(),
    );
  });
});
```

**失敗理由**: Cycle 2 では props は `{ densityMm, maxStitchMm }` 程度しか入っていない。`pushCompMm`, `underlay`, satin の `pullCompMm` がまだ未実装。

#### Green — 最小実装
- `deriveDefaultProps(kind, shapeMm, fabric)` を実装
- run / fill では `underlayPolicy[kind]()` を呼ぶ (引数なし or 0)
- satin では `analyzeShape(shape.outer).shortSide` を計算して `pullCompForWidth` と `underlayPolicy.satin(width)` に渡す
- shortSide は Cycle 3 で `determineKind` が返す値を再利用する形にすると効率的

```ts
function deriveDefaultProps(
  kind: ObjectKind,
  shape: Shape,
  shortSideMm: number,
  fabric: FabricProfile,
): ObjectProps {
  const props: ObjectProps = {
    densityMm: fabric.defaultDensityMm,
    maxStitchMm: 7,
    pushCompMm: fabric.defaultPushCompMm,
    underlay:
      kind === "satin"
        ? fabric.underlayPolicy.satin(shortSideMm)
        : kind === "fill"
        ? fabric.underlayPolicy.fill()
        : fabric.underlayPolicy.run(),
  };
  if (kind === "satin") {
    props.pullCompMm = pullCompForWidth(fabric, shortSideMm);
  }
  return props;
}
```

`buildObjects` 本体では `determineKind` の返り値の `shortSide` を `deriveDefaultProps` に渡す。

#### Refactor
- `EmbroideryObject` 構築部を `buildObjectForShape(region, shapeIndex, shapePx, mmPerPx, opts, order)` ヘルパーに分離 (per-shape の責務を明確化)
- 共通幾何関数を `geometry.ts` に集約 (`analyzeShape`, `computeAspectRatio`, `scaleShape`)

---

### Cycle 6: stitch.ts を build-objects 経由に切り替える (回帰防止)

#### Red — 失敗するテスト
- `src/lib/pipeline/__tests__/stitch.test.ts` の全テストが現状そのままパスすることを確認 (Cycle 5 完了時点で `stitch.ts` は未変更)
- 新規テストとして、build-objects から生成した結果と既存 `generateStitches` の結果が同じ kind 構造を持つことを assert する:

```ts
// build-objects.test.ts に追記
describe("buildObjects — generateStitches との整合性", () => {
  it("同じ region 入力から buildObjects が返す kind 構成が、generateStitches の block.stitches[].kind 構成と一致する", () => {
    const regions: ColorRegion[] = [/* fixture (satin + fill + run のミックス) */];
    const opts = {
      widthMm: 50, heightMm: 50, widthPx: 500, heightPx: 500,
      satinMaxWidthMm: 6,
    };
    const objects = buildObjects({
      ...opts,
      regions,
      fabric: FABRIC_PROFILES.denim,
    });
    const pattern = generateStitches({
      ...opts,
      regions,
      stitchDensityMm: 0.4,
    });
    // 各 block の最初の非 jump/trim/stop な stitch.kind が、対応する object.kind と一致
    const kinds = pattern.blocks.flatMap((b) =>
      Array.from(new Set(
        b.stitches.filter((s) => ["run", "satin", "fill"].includes(s.kind))
                  .map((s) => s.kind),
      )),
    );
    const objectKinds = objects.map((o) => o.kind);
    // 完全一致は順序の都合で難しいので「multiset として一致 or 含む」を確認
    for (const k of objectKinds) {
      expect(kinds).toContain(k);
    }
  });
});
```

**失敗理由**: テスト fixture を組み立てれば現時点でもパスする可能性が高いが、もし `stitch.ts` の判定と微妙にずれていれば失敗する → そのずれが回帰の指標。

#### Green — 最小実装
- `stitch.ts` の `generateStitches` の冒頭で `buildObjects` を呼び、その結果を `kind` 判定として使う
- 既存の renderer 呼び出し部 (`appendStitchesWithJumps` 等) は `object.kind` の switch に置き換える
- ただし PR3 のスコープでは **renderer の入れ替えは PR4 に委ねる** ため、ここでは判定だけ共通化する方法でも良い:
  - Option A (推奨): `generateStitches` 内で `kind` 判定だけ `determineKind` (build-objects 由来) に置換し、それ以外の renderer ロジックはそのまま温存
  - Option B: `generateStitches(regions, ...)` の前段で `buildObjects(...)` を呼んで `EmbroideryObject[]` を作り、それをループする形に書き換え (PR4 と被るので避ける)

#### Refactor
- `analyzeShape` / `computeAspectRatio` を `geometry.ts` に物理的に移動し、`stitch.ts` 側の定義を削除 → `__internal` export は `geometry.ts` からの re-export に変更 (既存テスト破壊しない)
- 重複コードを `build-objects.ts` と `stitch.ts` の両方から排除

---

## 7. サイクル依存グラフ

```
Cycle 1 (骨格)
  → Cycle 2 (fill 1 個)
       → Cycle 3 (satin/run 判定)
       → Cycle 4 (holes 保持)
       → Cycle 5 (props 派生)
            → Cycle 6 (stitch.ts と接続 / 回帰防止)
```

Cycle 3, 4, 5 は Cycle 2 完了後に並列で着手可能だが、推奨は順序通り (kind 判定 → 幾何 → props の段階を踏むほうが理解しやすい)。

## 8. 回帰防止

- 既存 `src/lib/pipeline/__tests__/stitch.test.ts` を一切編集せず、全件パスすること
- 特に `analyzeShape`, `computeAspectRatio`, `fillStitches`, `intersectScanline`, `appendStitchesWithJumps`, `resolveShapeFillAngle` の `__internal` export 経由のテストが破壊されないこと
  - `geometry.ts` に移動した場合は `stitch.ts` で `import { analyzeShape, computeAspectRatio } from "./geometry"` し、`__internal` で再 export
- Cycle 6 の整合性テストにより、`buildObjects` の kind 判定が `generateStitches` の判定と完全一致することを保証
- `npm test` 全件パスを必須

## 9. 受け入れ条件

- [ ] `src/lib/pipeline/build-objects.ts` が新規作成され、`buildObjects(input: BuildObjectsInput): EmbroideryObject[]` を export
- [ ] kind 判定閾値 (`runMaxWidthMm = 0.6`, `satinMaxWidthMm`, `aspectRatio > 4`) が現 `stitch.ts:105-156` のロジックと一致
- [ ] 1 色塗り画像 (1 region) → kind=`fill` のオブジェクト 1 つを返す
- [ ] 細長い帯 (幅 < satinMaxWidth, aspect > 4, 穴なし) → kind=`satin`
- [ ] 1px 線 (shortSide < runMaxWidthMm) → kind=`run`
- [ ] 穴ありの shape → `shape.holes` が mm 座標で保持され、kind=`fill` になる (satin にならない)
- [ ] `props.densityMm` が `fabric.defaultDensityMm` から派生
- [ ] `props.pushCompMm` が `fabric.defaultPushCompMm` から派生
- [ ] satin の `props.pullCompMm` が `pullCompForWidth(fabric, shortSideMm)` で計算される
- [ ] `props.underlay` が `fabric.underlayPolicy[kind](widthMm)` で派生
- [ ] `order` は region.colorIndex 昇順 × region 内 shape 出現順で 0-based 連番
- [ ] `id` は `${colorIndex}-${shapeIndex}` 形式
- [ ] 既存 `stitch.test.ts` が全件パス
- [ ] `analyzeShape` / `computeAspectRatio` が `build-objects.ts` と `stitch.ts` の両方から参照可能 (共通化されている)
- [ ] `npm test` 全件成功

## 10. コミット粒度

1. `test(pipeline): add failing tests for buildObjects skeleton (cycle 1)`
2. `feat(pipeline): introduce buildObjects skeleton returning empty array (cycle 1 green)`
3. `test(pipeline): add tests for fill region and id/order conventions (cycle 2)`
4. `feat(pipeline): build fill EmbroideryObjects from regions (cycle 2 green)`
5. `test(pipeline): add tests for satin and run kind detection (cycle 3)`
6. `feat(pipeline): detect run/satin/fill kinds in buildObjects (cycle 3 green)`
7. `refactor(pipeline): extract geometry helpers to geometry.ts (cycle 3 refactor)`
8. `test(pipeline): add tests for hole preservation (cycle 4)`
9. `feat(pipeline): preserve scaled holes in EmbroideryObject.shape (cycle 4 green)`
10. `test(pipeline): add tests for fabric-derived default props (cycle 5)`
11. `feat(pipeline): derive default ObjectProps from FabricProfile (cycle 5 green)`
12. `refactor(pipeline): isolate buildObjectForShape helper (cycle 5 refactor)`
13. `test(pipeline): add cross-check between buildObjects and generateStitches (cycle 6)`
14. `refactor(pipeline): route generateStitches kind detection through buildObjects (cycle 6 green)`
15. `refactor(pipeline): remove duplicated geometry helpers from stitch.ts (cycle 6 refactor)`

リファクタコミットは独立してレビュー可能になるよう Green コミットと分離する。

## 11. 想定 PR タイトル

`refactor(pipeline): extract object building from stitch generation (phase 1 pr3)`

## 12. 注意事項

- **renderer は触らない**: 本 PR では `appendStitchesWithJumps`, `fillStitches`, `satinStitches`, `resamplePolyline` などのレンダリングロジックは変更しない (PR4 のスコープ)
- **後方互換 API**: `generateStitches(input: StitchInput)` のシグネチャは Phase 1 内では変更しない (`compose.ts` 移行は PR5)
- **PR2 のシグネチャ依存**: `underlayPolicy.fill()` / `underlayPolicy.run()` が引数なし、`underlayPolicy.satin(widthMm: number)` が幅引数を取る前提。PR2 でこのシグネチャが確定していなければ調整する
- **`@deprecated polygons` フィールド**: `ColorRegion.polygons` は使わず `shapes` のみを参照する (vectorize.ts:42 の deprecation コメント参照)
- **mmPerPx の精度**: `widthMm / widthPx` で px → mm 変換し、`heightMm / heightPx` との不一致は今回考慮しない (既存 `stitch.ts:73` も同じ前提)
- **`id` の安定性**: 同じ入力に対して常に同じ id が返ることをテストで保証する (Phase 3 の順序最適化で order を変更しても id は不変)
- **Phase 1 では使わない props**: `angleDeg`, `lockstitch`, `pullCompPerSideMm` は Phase 1 では設定しない (undefined のまま) → Phase 2 / Phase 5 で扱う
