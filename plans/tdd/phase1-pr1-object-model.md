# Phase 1 PR1: データモデル定義 — TDD 実装計画書

## 1. 概要

Phase 1 計画書「5. 実装ステップ」のステップ 1 に該当する PR。`src/lib/pipeline/types.ts` に「Object ベースのデータモデル」を表す型 (`EmbroideryObject` / `EmbroideryDesign` / `FabricProfile` / `UnderlayConfig` / `UnderlayPolicy` / `ObjectKind` / `ObjectProps` / `FabricKind`) を追加する。既存型 (`Stitch`, `StitchBlock`, `StitchPattern`, `Shape`, `Polygon`, `Point2D`, `StitchKind`) には一切手を入れず、新規追加のみで完結させる。

「型のみ」は TDD サイクルが薄くなるため、本 PR では併せて以下のランタイム成果物を作る:

- 型を実際に値として満たせることを `satisfies` で検証するスモークテスト
- `EmbroideryDesign` を JSON シリアライズ・デシリアライズしても等価になることを保証するヘルパー (`serializeDesign` / `deserializeDesign`)
- 既定値生成関数 `createDefaultObjectProps` / `createEmptyDesign`

これら付随ユーティリティは Phase 1 計画書「8. 受け入れ条件」の「JSON シリアライズ → デシリアライズしても結果が一致する」を実現する前提部品となる。

## 2. 依存関係

- 上流依存: なし (本 PR は Phase 1 系列の最上流)
- 下流依存: Phase 1 PR2 (`fabric.ts`) / PR3 (`build-objects.ts`) / PR4 (`stitch.ts` リファクタ) / PR5 (`compose.ts` 分割) は本 PR の型に依存する。よってフィールド名・型名は Phase 1 計画書「3. データモデル設計」の表記をそのまま採用し変更しない。

## 3. 影響ファイル

### 編集
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/types.ts`
  - 既存の export は一切変更しない。末尾に新規型を追記する形のみ。

### 新規作成
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/design.ts`
  - `createDefaultObjectProps()`, `createEmptyDesign()`, `serializeDesign()`, `deserializeDesign()` を実装。
  - 型のみだと TDD が薄くなる問題を解消するため、`UnderlayPolicy` (関数フィールドを持つ) を除いた `EmbroideryDesign` の純データ部のラウンドトリップを保証する。
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/__tests__/types.test.ts`
  - 型のスモークテスト (`satisfies` 検証 + 構造アサート)
- `/Users/maguro/nodeApps/embroidery-studio/src/lib/pipeline/__tests__/design.test.ts`
  - factory / JSON シリアライズ往復テスト

### 触らない (回帰確認のみ)
- `src/lib/pipeline/__tests__/stitch.test.ts`
- `src/lib/pipeline/__tests__/vectorize.test.ts`
- `src/lib/pipeline/{quantize,vectorize,stitch,writer,index}.ts`

## 4. テスト環境

- フレームワーク: vitest
- 実行コマンド: `npm test` (= `vitest run`)
- テストファイル配置: `src/lib/pipeline/__tests__/*.test.ts`
- TS strict 設定 (`tsconfig.json`) のため、`satisfies` / 型エラーは `npm test` の途中で `tsc` 経由ではなく vitest の transform 失敗として検出される。`satisfies` の検査はテストファイル自体がトランスパイルされる時点で行われる。

## 5. TDD サイクル

### Cycle 1: 新規型を値として満たせることを保証する (型スモーク + ObjectKind)

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/types.test.ts` (新規)

テスト観点:
- `ObjectKind` が `"run" | "satin" | "fill"` の 3 値のみ受理することを `satisfies` で検証
- `EmbroideryObject` の最小構成 (run / satin / fill 各 1 個) が型エラーなく作れること
- 作った値の `kind` / `id` / `shape.outer.length` などをランタイムでアサート
- `UnderlayConfig` の 5 種別 (`none`, `edge-run`, `center-run`, `zigzag`, `fill`) すべてを `satisfies UnderlayConfig` で確認する

テスト名 (it):
- `ObjectKind は run/satin/fill の 3 値を受理する`
- `EmbroideryObject (run) は最小フィールドで構築できる`
- `EmbroideryObject (satin) は angleDeg を含めて構築できる`
- `EmbroideryObject (fill) は holes を持つ Shape を保持できる`
- `UnderlayConfig は none / edge-run / center-run / zigzag / fill の 5 種別を表現できる`
- `EmbroideryDesign は widthMm/heightMm/fabric/objects フィールドを持つ`

```ts
// src/lib/pipeline/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import type {
  ObjectKind,
  ObjectProps,
  UnderlayConfig,
  EmbroideryObject,
  EmbroideryDesign,
  FabricProfile,
} from "../types";

describe("ObjectKind", () => {
  it("ObjectKind は run/satin/fill の 3 値を受理する", () => {
    const kinds = ["run", "satin", "fill"] as const satisfies readonly ObjectKind[];
    expect(kinds).toHaveLength(3);
  });
});

describe("EmbroideryObject", () => {
  it("EmbroideryObject (run) は最小フィールドで構築できる", () => {
    const obj = {
      id: "o1",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [10, 0]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 4 },
      order: 0,
    } satisfies EmbroideryObject;
    expect(obj.kind).toBe("run");
  });

  it("EmbroideryObject (satin) は angleDeg を含めて構築できる", () => {
    const obj = {
      id: "o2",
      kind: "satin",
      colorIndex: 1,
      rgb: [255, 0, 0],
      shape: { outer: [[0, 0], [10, 0], [10, 2], [0, 2]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, angleDeg: 0 },
      order: 1,
    } satisfies EmbroideryObject;
    expect(obj.props.angleDeg).toBe(0);
  });

  it("EmbroideryObject (fill) は holes を持つ Shape を保持できる", () => {
    const obj = {
      id: "o3",
      kind: "fill",
      colorIndex: 2,
      rgb: [0, 128, 0],
      shape: {
        outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
        holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      },
      props: { densityMm: 0.4, maxStitchMm: 4, angleDeg: 45 },
      order: 2,
    } satisfies EmbroideryObject;
    expect(obj.shape.holes).toHaveLength(1);
  });
});

describe("UnderlayConfig", () => {
  it("UnderlayConfig は none/edge-run/center-run/zigzag/fill の 5 種別を表現できる", () => {
    const u1 = { kind: "none" } satisfies UnderlayConfig;
    const u2 = { kind: "edge-run", insetMm: 0.5, stitchLenMm: 2 } satisfies UnderlayConfig;
    const u3 = { kind: "center-run", stitchLenMm: 2 } satisfies UnderlayConfig;
    const u4 = { kind: "zigzag", spacingMm: 2, insetMm: 0.5 } satisfies UnderlayConfig;
    const u5 = { kind: "fill", angleDeg: 90, spacingMm: 3 } satisfies UnderlayConfig;
    expect([u1, u2, u3, u4, u5].map((u) => u.kind)).toEqual([
      "none", "edge-run", "center-run", "zigzag", "fill",
    ]);
  });
});

describe("EmbroideryDesign", () => {
  it("EmbroideryDesign は widthMm/heightMm/fabric/objects フィールドを持つ", () => {
    const fabric: FabricProfile = {
      kind: "denim",
      defaultDensityMm: 0.4,
      pullCompPerWidth: 0.025,
      minPullCompMm: 0.1,
      defaultPushCompMm: 0,
      underlayPolicy: {
        satin: () => ({ kind: "none" }),
        fill: () => ({ kind: "none" }),
        run: () => ({ kind: "none" }),
      },
    };
    const design = {
      widthMm: 100,
      heightMm: 80,
      fabric,
      objects: [],
    } satisfies EmbroideryDesign;
    expect(design.objects).toHaveLength(0);
  });
});
```

失敗理由: `ObjectKind` / `ObjectProps` / `UnderlayConfig` / `EmbroideryObject` / `EmbroideryDesign` / `FabricProfile` / `FabricKind` / `UnderlayPolicy` がいずれも `types.ts` に未定義のため、vitest の TS transform 時点で型エラー → テスト読み込み失敗。

#### Green — 最小実装

変更: `src/lib/pipeline/types.ts`

方針 (Phase 1 計画書 3.1 / 3.2 のシグネチャをそのまま採用):

```ts
// 既存定義の末尾に追記する。既存 export は一切変更しない。

export type ObjectKind = "run" | "satin" | "fill";

export type UnderlayConfig =
  | { kind: "none" }
  | { kind: "edge-run"; insetMm: number; stitchLenMm: number }
  | { kind: "center-run"; stitchLenMm: number }
  | { kind: "zigzag"; spacingMm: number; insetMm: number }
  | { kind: "fill"; angleDeg: number; spacingMm: number };

export type ObjectProps = {
  densityMm: number;
  maxStitchMm: number;
  angleDeg?: number;
  pullCompMm?: number;
  pullCompPerSideMm?: { left: number; right: number };
  pushCompMm?: number;
  underlay?: UnderlayConfig;
  lockstitch?: boolean;
};

export type EmbroideryObject = {
  id: string;
  kind: ObjectKind;
  colorIndex: number;
  rgb: [number, number, number];
  shape: Shape;
  props: ObjectProps;
  order: number;
  locked?: boolean;
};

export type FabricKind =
  | "denim" | "twill" | "canvas"
  | "knit-light" | "knit-heavy"
  | "terry" | "fleece" | "leather" | "silk" | "felt";

export type UnderlayPolicy = {
  satin: (widthMm: number) => UnderlayConfig;
  fill: () => UnderlayConfig;
  run: () => UnderlayConfig;
};

export type FabricProfile = {
  kind: FabricKind;
  defaultDensityMm: number;
  pullCompPerWidth: number;
  minPullCompMm: number;
  underlayPolicy: UnderlayPolicy;
  defaultPushCompMm: number;
};

export type EmbroideryDesign = {
  widthMm: number;
  heightMm: number;
  fabric: FabricProfile;
  objects: EmbroideryObject[];
};
```

#### Refactor
- 不要。最初のサイクルなので、既存型との並びを意識して「既存 (Stitch 系) ブロック」と「新規 (Object 系) ブロック」の間に区切りコメント (`// ---- Object-based model (Phase 1) ----` 等) を 1 行入れる程度に留める。

---

### Cycle 2: `ObjectProps` 既定値 factory (`createDefaultObjectProps`)

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/design.test.ts` (新規)

テスト観点:
- `createDefaultObjectProps(kind)` が `kind` に応じた密度・最大ステッチ長を返すこと
- `fill` / `satin` では `angleDeg` がデフォルトで設定される (`fill = 45`, `satin = 0`)
- `run` では `angleDeg` が `undefined` であること
- 戻り値が `ObjectProps` 型を満たすこと (`satisfies`)
- 戻り値は呼び出しごとに独立 (参照共有が起きていない)

テスト名:
- `createDefaultObjectProps("run") は angleDeg を含まない`
- `createDefaultObjectProps("satin") は angleDeg=0 を含む`
- `createDefaultObjectProps("fill") は angleDeg=45 を含む`
- `createDefaultObjectProps の戻り値は呼び出しごとに別オブジェクト`

```ts
// src/lib/pipeline/__tests__/design.test.ts
import { describe, it, expect } from "vitest";
import { createDefaultObjectProps } from "../design";
import type { ObjectProps } from "../types";

describe("createDefaultObjectProps", () => {
  it("createDefaultObjectProps(\"run\") は angleDeg を含まない", () => {
    const p = createDefaultObjectProps("run") satisfies ObjectProps;
    expect(p.angleDeg).toBeUndefined();
    expect(p.densityMm).toBeGreaterThan(0);
    expect(p.maxStitchMm).toBeGreaterThan(0);
  });

  it("createDefaultObjectProps(\"satin\") は angleDeg=0 を含む", () => {
    const p = createDefaultObjectProps("satin");
    expect(p.angleDeg).toBe(0);
  });

  it("createDefaultObjectProps(\"fill\") は angleDeg=45 を含む", () => {
    const p = createDefaultObjectProps("fill");
    expect(p.angleDeg).toBe(45);
  });

  it("createDefaultObjectProps の戻り値は呼び出しごとに別オブジェクト", () => {
    const a = createDefaultObjectProps("fill");
    const b = createDefaultObjectProps("fill");
    expect(a).not.toBe(b);
    a.densityMm = 999;
    expect(b.densityMm).not.toBe(999);
  });
});
```

失敗理由: `src/lib/pipeline/design.ts` 自体が存在せず `Cannot find module '../design'`。

#### Green — 最小実装

変更: `src/lib/pipeline/design.ts` (新規)

```ts
import type { ObjectKind, ObjectProps } from "./types";

export function createDefaultObjectProps(kind: ObjectKind): ObjectProps {
  const base: ObjectProps = { densityMm: 0.4, maxStitchMm: 4 };
  if (kind === "satin") return { ...base, maxStitchMm: 7, angleDeg: 0 };
  if (kind === "fill") return { ...base, angleDeg: 45 };
  return base; // run
}
```

#### Refactor
- 数値リテラル `0.4` / `4` / `7` / `0` / `45` をモジュール先頭の `const DEFAULT_DENSITY_MM = 0.4` 等の名前付き定数に切り出し、後続 PR (`fabric.ts`) で生地依存に差し替えやすくしておく。

---

### Cycle 3: 空 `EmbroideryDesign` factory (`createEmptyDesign`)

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/design.test.ts` に追記

テスト観点:
- `createEmptyDesign({ widthMm, heightMm, fabric })` が `objects: []` の `EmbroideryDesign` を返す
- 渡した `fabric` が参照ではなくそのまま保持されること
- 戻り値の `objects` 配列は変更しても他の呼び出しに影響しないこと (独立配列)

テスト名:
- `createEmptyDesign は objects=[] の Design を返す`
- `createEmptyDesign は渡した fabric をそのまま保持する`
- `createEmptyDesign の戻り値の objects は呼び出しごとに独立`

```ts
import { createEmptyDesign } from "../design";
import type { FabricProfile, EmbroideryDesign } from "../types";

const stubFabric: FabricProfile = {
  kind: "denim",
  defaultDensityMm: 0.4,
  pullCompPerWidth: 0.025,
  minPullCompMm: 0.1,
  defaultPushCompMm: 0,
  underlayPolicy: {
    satin: () => ({ kind: "none" }),
    fill: () => ({ kind: "none" }),
    run: () => ({ kind: "none" }),
  },
};

describe("createEmptyDesign", () => {
  it("createEmptyDesign は objects=[] の Design を返す", () => {
    const d = createEmptyDesign({ widthMm: 100, heightMm: 80, fabric: stubFabric }) satisfies EmbroideryDesign;
    expect(d.widthMm).toBe(100);
    expect(d.heightMm).toBe(80);
    expect(d.objects).toEqual([]);
  });

  it("createEmptyDesign は渡した fabric をそのまま保持する", () => {
    const d = createEmptyDesign({ widthMm: 50, heightMm: 50, fabric: stubFabric });
    expect(d.fabric).toBe(stubFabric);
  });

  it("createEmptyDesign の戻り値の objects は呼び出しごとに独立", () => {
    const d1 = createEmptyDesign({ widthMm: 1, heightMm: 1, fabric: stubFabric });
    const d2 = createEmptyDesign({ widthMm: 1, heightMm: 1, fabric: stubFabric });
    expect(d1.objects).not.toBe(d2.objects);
  });
});
```

失敗理由: `createEmptyDesign` が `design.ts` に未エクスポートのため `TypeError: createEmptyDesign is not a function`。

#### Green — 最小実装

`src/lib/pipeline/design.ts` に追記:

```ts
import type { EmbroideryDesign, FabricProfile } from "./types";

export function createEmptyDesign(args: {
  widthMm: number;
  heightMm: number;
  fabric: FabricProfile;
}): EmbroideryDesign {
  return {
    widthMm: args.widthMm,
    heightMm: args.heightMm,
    fabric: args.fabric,
    objects: [],
  };
}
```

#### Refactor
- `createDefaultObjectProps` と `createEmptyDesign` の両方が、引数オブジェクトとプリミティブの混在をしている点を確認。本 PR ではこれ以上の抽象化はせず、JSDoc を 1-2 行ずつ追加するに留める (使う側の Phase 1 PR2-5 でパターンが明確になってから抽象化判断)。

---

### Cycle 4: JSON シリアライズ往復 (`serializeDesign` / `deserializeDesign`)

Phase 1 計画書「8. 受け入れ条件」の `EmbroideryDesign を JSON シリアライズ → デシリアライズしても結果が一致する` を直接担保する。`FabricProfile.underlayPolicy` は関数フィールドのため `JSON.stringify` で消える。これは仕様上の制約なので、シリアライズでは `fabric.kind` のみ残し、デシリアライズ時に呼び出し側が `FabricProfile` を再構築できるよう「純データ表現 (`SerializedDesign`) ↔ `EmbroideryDesign`」の分離を導入する。`FabricProfile` 全体の復元は次 PR (`fabric.ts` の `loadFabricProfile(kind)`) の責務となるため、本 PR の `deserializeDesign` は **`FabricProfile` を解決するための resolver 関数を引数で受け取る** 形にして、テスト内ではスタブ resolver を渡す。

#### Red — 失敗するテスト

ファイル: `src/lib/pipeline/__tests__/design.test.ts` に追記

テスト観点:
- `serializeDesign(design)` の戻り値は `JSON.stringify` 可能 (= 関数フィールドを含まない)
- シリアライズ結果に `fabric.kind` は残り、`underlayPolicy` は含まれない
- `deserializeDesign(serialized, fabricResolver)` で元の `EmbroideryDesign` に復元できる
- ラウンドトリップで `objects` 配列の中身 (id, kind, shape, props, order, locked, rgb) がすべて一致する
- `props.underlay` (`UnderlayConfig` の 5 種別) も保持される
- `props.pullCompPerSideMm` のようなネストオブジェクトも保持される

テスト名:
- `serializeDesign の結果は JSON.stringify 可能`
- `serializeDesign は fabric.kind のみ残し underlayPolicy を含まない`
- `serializeDesign → JSON.parse → deserializeDesign で objects が完全一致`
- `ラウンドトリップで UnderlayConfig の 5 種別が保持される`
- `ラウンドトリップで pullCompPerSideMm が保持される`

```ts
import { serializeDesign, deserializeDesign } from "../design";
import type { EmbroideryDesign, FabricKind, FabricProfile, UnderlayConfig } from "../types";

const fabricResolver = (kind: FabricKind): FabricProfile => stubFabric;

describe("serializeDesign / deserializeDesign", () => {
  const sample: EmbroideryDesign = {
    widthMm: 100,
    heightMm: 80,
    fabric: stubFabric,
    objects: [
      {
        id: "a",
        kind: "fill",
        colorIndex: 0,
        rgb: [10, 20, 30],
        shape: {
          outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
          holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
        },
        props: {
          densityMm: 0.4,
          maxStitchMm: 4,
          angleDeg: 45,
          pullCompPerSideMm: { left: 0.1, right: 0.2 },
          underlay: { kind: "zigzag", spacingMm: 2, insetMm: 0.5 },
        },
        order: 0,
        locked: true,
      },
    ],
  };

  it("serializeDesign の結果は JSON.stringify 可能", () => {
    const s = serializeDesign(sample);
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it("serializeDesign は fabric.kind のみ残し underlayPolicy を含まない", () => {
    const s = serializeDesign(sample);
    expect(s.fabric).toEqual({ kind: "denim" });
  });

  it("serializeDesign → JSON.parse → deserializeDesign で objects が完全一致", () => {
    const s = serializeDesign(sample);
    const json = JSON.stringify(s);
    const restored = deserializeDesign(JSON.parse(json), fabricResolver);
    expect(restored.objects).toEqual(sample.objects);
    expect(restored.widthMm).toBe(sample.widthMm);
    expect(restored.heightMm).toBe(sample.heightMm);
    expect(restored.fabric).toBe(stubFabric);
  });

  it("ラウンドトリップで UnderlayConfig の 5 種別が保持される", () => {
    const variants: UnderlayConfig[] = [
      { kind: "none" },
      { kind: "edge-run", insetMm: 0.5, stitchLenMm: 2 },
      { kind: "center-run", stitchLenMm: 2 },
      { kind: "zigzag", spacingMm: 2, insetMm: 0.5 },
      { kind: "fill", angleDeg: 90, spacingMm: 3 },
    ];
    for (const u of variants) {
      const d: EmbroideryDesign = {
        ...sample,
        objects: [{ ...sample.objects[0], props: { ...sample.objects[0].props, underlay: u } }],
      };
      const r = deserializeDesign(JSON.parse(JSON.stringify(serializeDesign(d))), fabricResolver);
      expect(r.objects[0].props.underlay).toEqual(u);
    }
  });

  it("ラウンドトリップで pullCompPerSideMm が保持される", () => {
    const s = serializeDesign(sample);
    const r = deserializeDesign(JSON.parse(JSON.stringify(s)), fabricResolver);
    expect(r.objects[0].props.pullCompPerSideMm).toEqual({ left: 0.1, right: 0.2 });
  });
});
```

失敗理由: `serializeDesign` / `deserializeDesign` および型 `SerializedDesign` が未実装で `import` エラー。

#### Green — 最小実装

`src/lib/pipeline/design.ts` に追記:

```ts
import type {
  EmbroideryDesign, EmbroideryObject, FabricKind, FabricProfile,
} from "./types";

export type SerializedDesign = {
  widthMm: number;
  heightMm: number;
  fabric: { kind: FabricKind };
  objects: EmbroideryObject[]; // ObjectProps の関数フィールドなし、純データ
};

export function serializeDesign(d: EmbroideryDesign): SerializedDesign {
  return {
    widthMm: d.widthMm,
    heightMm: d.heightMm,
    fabric: { kind: d.fabric.kind },
    // EmbroideryObject 内に関数値は無いため deep copy で十分
    objects: JSON.parse(JSON.stringify(d.objects)) as EmbroideryObject[],
  };
}

export function deserializeDesign(
  s: SerializedDesign,
  fabricResolver: (kind: FabricKind) => FabricProfile,
): EmbroideryDesign {
  return {
    widthMm: s.widthMm,
    heightMm: s.heightMm,
    fabric: fabricResolver(s.fabric.kind),
    objects: s.objects,
  };
}
```

ポイント:
- 関数フィールドを持つ `UnderlayPolicy` は `serializeDesign` で落とし、復元は外部 resolver に委譲する。
- これにより Phase 1 計画書「8. 受け入れ条件」の JSON ラウンドトリップ要件を満たしつつ、`fabric.ts` (PR2) の責務 (`underlayPolicy` の構築) を侵食しない。

#### Refactor
- `JSON.parse(JSON.stringify(...))` による deep copy は `EmbroideryObject` 配列に関数フィールドが無いことに依存する。`types.ts` 内のコメント (Cycle 1 で入れた区切りコメントの直下) に「`EmbroideryObject` 配下は純データのみ。関数フィールドを足す場合は `serializeDesign` を必ず見直す」と注意書きを追加。
- `SerializedDesign` は `design.ts` から re-export し、将来 `index.ts` に出すかは Phase 1 PR5 (compose 分割) で決める旨をコメントに残す。

---

## 6. 回帰防止

各 Cycle の Green 完了後に `npm test` を実行し、以下を確認する:

1. 既存 `src/lib/pipeline/__tests__/stitch.test.ts` の全テストが従来どおりパス
2. 既存 `src/lib/pipeline/__tests__/vectorize.test.ts` の全テストがパス
3. 新規 `types.test.ts` / `design.test.ts` がパス
4. TypeScript 型エラーが 0 件 (`npm run build` まで通す必要は無いが、`vitest run` は TS transform を行うので型エラーがあれば落ちる)

最終 Cycle 後にもう 1 度 `npm test` を実行し、全件グリーンを確認する。

## 7. 受け入れ条件

- [ ] `npm test` が全件パス (既存 + 新規)
- [ ] `src/lib/pipeline/types.ts` から既存 export (`StitchKind`, `Point2D`, `Polygon`, `Shape`, `Stitch`, `StitchBlock`, `StitchPattern`) が破壊なく export され続けている
- [ ] `src/lib/pipeline/types.ts` から新規型 `ObjectKind`, `ObjectProps`, `UnderlayConfig`, `EmbroideryObject`, `EmbroideryDesign`, `FabricProfile`, `FabricKind`, `UnderlayPolicy` が export されている
- [ ] `src/lib/pipeline/design.ts` から `createDefaultObjectProps`, `createEmptyDesign`, `serializeDesign`, `deserializeDesign`, 型 `SerializedDesign` が export されている
- [ ] 新規型のフィールド名は Phase 1 計画書 3.1 / 3.2 と完全一致 (PR2-5 との整合)
- [ ] `EmbroideryDesign` を `serializeDesign → JSON.stringify → JSON.parse → deserializeDesign` でラウンドトリップしても `objects` 配列が `toEqual` で一致する
- [ ] 既存のパイプライン関連ファイル (`quantize.ts`, `vectorize.ts`, `stitch.ts`, `writer.ts`, `index.ts`) には変更が入っていない

## 8. コミット粒度

1 TDD サイクル = 1 コミット。Conventional Commits 形式。

- Cycle 1: `feat(pipeline): add object-model types (EmbroideryObject, EmbroideryDesign, FabricProfile)`
- Cycle 2: `feat(pipeline): add createDefaultObjectProps factory for new object model`
- Cycle 3: `feat(pipeline): add createEmptyDesign factory`
- Cycle 4: `feat(pipeline): add serializeDesign/deserializeDesign for JSON round-trip`

各コミットはテストファイルと実装ファイルを同時に含み、`npm test` が緑であることを前提とする。

## 9. 想定 PR タイトル

`feat(pipeline): introduce object-based data model types (phase 1 pr1)`

PR 本文には:
- Phase 1 計画書 (`plans/10-phase1-foundation.md`) の「5. 実装ステップ 1」に対応する旨
- 既存型・既存テストへの非破壊性
- 後続 PR (PR2: `fabric.ts`, PR3: `build-objects.ts`, PR4: `stitch.ts` リファクタ, PR5: `compose.ts` 分割) の前提となる旨
を 3-5 行で記載する。

## 10. サイクル依存グラフ

```
Cycle 1 (types.ts に新規型追加)
   ↓
Cycle 2 (createDefaultObjectProps) ── 並列可能 ─→ Cycle 3 (createEmptyDesign)
                                                       ↓
                                                  Cycle 4 (serialize/deserialize)
```

Cycle 1 は他すべての前提。Cycle 2 と Cycle 3 は独立。Cycle 4 は `EmbroideryDesign` を構築する必要があるので Cycle 3 の完了後が望ましい (Cycle 2 には依存しない)。

## 11. 注意事項

- `FabricProfile.underlayPolicy` は関数フィールドのため、`JSON.stringify` で消える。`serializeDesign` ではこれを意図的に落とし、`deserializeDesign` は resolver で復元する。テストでは stub resolver を使う。
- `FABRIC_PROFILES` 定数の実体は本 PR では作らない (PR2 の責務)。よって `FabricKind` 列挙のみ追加し、各 `kind` に対する具体的な数値テーブルは持ち込まない。
- `Shape` / `Polygon` / `Point2D` は既存型なので再エクスポートも再宣言もしない。`EmbroideryObject.shape: Shape` は既存定義をそのまま参照する。
- `vitest` の TS transform が型エラーを検出するため、`satisfies` を使った型スモークテストは実質的な型チェックとして機能する。`tsc --noEmit` を別途走らせる必要はない。
- 計画書の節 3.1 に書かれた `ObjectProps` のオプショナルフィールド (`pullCompMm`, `pullCompPerSideMm`, `pushCompMm`, `underlay`, `lockstitch`) は本 PR では値を計算する関数を作らない。型定義のみ追加し、`createDefaultObjectProps` でも設定しない (= Phase 2 で `applyCompensation` / `addUnderlay` が埋める前提)。
