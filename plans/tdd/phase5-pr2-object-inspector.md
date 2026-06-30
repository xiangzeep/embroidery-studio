# Phase 5 PR2: Object Inspector — TDD 実装計画書

## 1. 概要

Phase 5 計画書「10. 実装ステップ」のステップ 3 に該当する PR。
選択中の `EmbroideryObject` のプロパティ (kind / 角度 / 密度 / pull comp / underlay) を
UI 上で編集できる `ObjectInspector` コンポーネントを新規作成する。

- 編集対象: `EmbroideryObject.kind`, `ObjectProps.angleDeg` / `densityMm` / `pullCompMm` / `underlay.kind`
- ストア操作: PR1 で導入した design store の `updateObject(id, patch)` を経由して更新
- 未選択時は「object を選択してください」プレースホルダを表示
- 既存の `color-angle-editor.tsx` のスライダ UI 規約に揃え、shadcn/ui (`Slider`, `Select`, `Tabs`,
  `Card`, `Label`) を流用する

本 PR ではあくまで Object Inspector 単体の実装に集中する。
プレビュー上の選択 (PR が分離: ステップ 2) や Sewing Order (ステップ 4)、レイアウト統合 (ステップ 5)
は対象外で、`embroidery-studio.tsx` には Inspector を「選択中 object なし」の状態でマウントする
最小ハンドリングのみを足す (= スモーク統合)。

## 2. 依存関係

- 上流依存: **Phase 5 PR1 (design store)** — `useDesignStore`, `updateObject(id, patch)`,
  `selectedObjectId`, `getSelectedObject()` (もしくは selector) が export されていること
- 下流依存:
  - Phase 5 PR3 (Sewing Order panel) — Inspector と独立だが、同じ store を共有する
  - Phase 5 PR4 (`EmbroideryStudio` レイアウト再構成) — Inspector を 3 カラム左下に正式配置する

PR1 の API が確定していることを前提とする。シグネチャ未確定の場合は本 PR の Cycle 1 着手前に
合意を取る (本計画書「11. 注意事項」を参照)。

## 3. 影響ファイル

### 新規作成
- `/Users/maguro/nodeApps/embroidery-studio/src/components/object-inspector.tsx`
- `/Users/maguro/nodeApps/embroidery-studio/src/components/__tests__/object-inspector.test.tsx`

### 編集
- `/Users/maguro/nodeApps/embroidery-studio/src/components/embroidery-studio.tsx`
  - `ObjectInspector` を import し、設定パネルの下にマウント
  - 既存の `imageSrc` / `config` / `pattern` 系のステートは触らない
- `/Users/maguro/nodeApps/embroidery-studio/vitest.config.ts`
  - `*.test.tsx` を `environment: "jsdom"` で実行できるよう設定追加 (環境別 include / projects 化)
- `/Users/maguro/nodeApps/embroidery-studio/package.json`
  - devDependencies に `@testing-library/react`, `@testing-library/user-event`,
    `@testing-library/jest-dom`, `jsdom` を追加

### 触らない (回帰確認のみ)
- `src/lib/pipeline/**`
- `src/components/color-angle-editor.tsx`, `conversion-settings.tsx`, `stitch-preview*.tsx`,
  `image-uploader.tsx`, `result-panel.tsx`
- `src/components/ui/**` (shadcn/ui の slider/select/tabs はそのまま使う)
- 既存テスト `src/lib/pipeline/__tests__/*.test.ts`

## 4. テスト環境

- フレームワーク: **vitest** + **@testing-library/react** + **@testing-library/user-event** +
  **@testing-library/jest-dom**
- DOM 環境: **jsdom** (`*.test.tsx` のみに適用、`*.test.ts` は従来どおり node)
- 実行コマンド: `npm test` (= `vitest run`)
- テストファイル配置: `src/components/__tests__/*.test.tsx`
- ts strict 設定下なので JSX/型エラーは vitest の transform 時点で落ちる

### vitest 設定変更案 (Cycle 0 で行う)

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "jsdom",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["src/test/setup.tsx"],
          globals: true,
        },
      },
    ],
  },
});
```

setup ファイル `src/test/setup.tsx` で `@testing-library/jest-dom` を読み込み、
`afterEach(() => cleanup())` を登録する。

### design store のモック方針

`useDesignStore` を Zustand store と仮定し、テストでは:
- `vi.mock("@/components/design-store", () => ({ useDesignStore: ... }))` で書き換えるのではなく
- store が export する `useDesignStore` を **そのまま使い、テストごとに `useDesignStore.setState(...)`
  で初期状態を流し込む** 方針を取る (Zustand の標準パターン)。
- これにより `updateObject(id, patch)` の呼び出し検証は store の中身を `useDesignStore.getState()`
  で覗いて差分確認できる。
- store が React Context ベースの場合は、テスト用の `<DesignStoreProvider initial={...}>` で囲む。
  PR1 の実装方式に合わせて Cycle 1 で決める。

## 5. インターフェース設計

### `ObjectInspector` コンポーネント

```tsx
// src/components/object-inspector.tsx
"use client";

export type ObjectInspectorProps = {
  /** 省略時は store から自動取得 */
  className?: string;
};

export function ObjectInspector(props: ObjectInspectorProps): JSX.Element;
```

内部で `useDesignStore` から以下を取り出す:

```ts
const selectedObjectId = useDesignStore((s) => s.selectedObjectId);
const object = useDesignStore((s) =>
  s.selectedObjectId
    ? s.design?.objects.find((o) => o.id === s.selectedObjectId) ?? null
    : null,
);
const updateObject = useDesignStore((s) => s.updateObject);
```

### 表示要素 (object が選択されているとき)

| 行 | UI | 値ソース | 変更時の呼び出し |
|---|---|---|---|
| ID + 色チップ | `<header>` テキスト | `object.id` / `object.rgb` | (read only) |
| kind | `<Tabs>` (run / satin / fill) | `object.kind` | `updateObject(id, { kind })` |
| 角度 (deg) | `<Slider>` 0..179 | `object.props.angleDeg ?? 0` | `updateObject(id, { props: { angleDeg } })` |
| 密度 (mm) | `<Slider>` 0.20..0.80 step 0.05 | `object.props.densityMm` | `updateObject(id, { props: { densityMm } })` |
| pull comp (mm) | `<Slider>` 0.0..1.0 step 0.05 | `object.props.pullCompMm ?? 0` | `updateObject(id, { props: { pullCompMm } })` |
| underlay | `<Select>` (none / edge-run / center-run / zigzag / fill) | `object.props.underlay?.kind ?? "none"` | `updateObject(id, { props: { underlay: { kind: ... 既定値 } } })` |

`updateObject` の patch は **shallow merge ではなく `props` についてだけネスト merge** することを
前提とする (PR1 でそう実装される想定)。ネスト merge ではない場合は、本コンポーネント側で
`{ props: { ...object.props, [key]: value } }` を組み立てて渡す。

### 未選択時表示

```tsx
<Card>
  <CardContent className="py-10 text-center text-sm text-muted-foreground">
    object を選択してください
  </CardContent>
</Card>
```

### ファイル構成

```
src/components/
  object-inspector.tsx              NEW
  __tests__/object-inspector.test.tsx  NEW
src/test/
  setup.tsx                         NEW (vitest jsdom setup)
vitest.config.ts                    EDIT (projects 化)
package.json                        EDIT (devDeps 追加)
```

## 6. TDD サイクル

### Cycle 0: テスト環境整備 (前提セットアップ)

#### 観点
コンポーネントテストを書くための環境を整える。本サイクルにはアサーション的なテストは無いが、
「`*.test.tsx` を 1 個作って `npm test` が落ちないこと」をスモークテストにする。

#### Red — 失敗するテスト
ファイル: `src/components/__tests__/_smoke.test.tsx` (一時)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("RTL smoke", () => {
  it("renders a div", () => {
    render(<div>hello</div>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

失敗理由:
1. `@testing-library/react` 未インストール → import エラー
2. `jsdom` 未インストール → environment 解決失敗
3. `toBeInTheDocument()` matcher 未登録 → 型/実行エラー

#### Green — 最小実装
1. `npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom`
2. `vitest.config.ts` を上記「4. テスト環境」の projects 構成に書き換え
3. `src/test/setup.tsx` を作成:
   ```tsx
   import "@testing-library/jest-dom/vitest";
   import { afterEach } from "vitest";
   import { cleanup } from "@testing-library/react";
   afterEach(() => cleanup());
   ```
4. `npm test` が緑になることを確認

#### Refactor
- `_smoke.test.tsx` は Cycle 1 開始時点で削除する (実際のテストに置き換わる)。
- `tsconfig.json` の `types` に `vitest/globals` を追加する必要があれば足す
  (vitest 設定で `globals: true` にしているため)。

---

### Cycle 1: 未選択時にプレースホルダが表示される

#### 観点
- `selectedObjectId === null` のとき「object を選択してください」が描画される
- スライダや Tabs などのインタラクティブ要素は **描画されない**
- store に object が存在しても `selectedObjectId` が null なら未選択扱い

#### Red — 失敗するテスト

ファイル: `src/components/__tests__/object-inspector.test.tsx` (新規)

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ObjectInspector } from "@/components/object-inspector";
import { useDesignStore } from "@/components/design-store";

// テスト用の最小 design (PR1 の createEmptyDesign 相当)
const makeDesign = () => ({
  widthMm: 100,
  heightMm: 100,
  fabric: { kind: "denim" as const, defaultDensityMm: 0.4, pullCompPerWidth: 0.025,
    minPullCompMm: 0.1, defaultPushCompMm: 0,
    underlayPolicy: { satin: () => ({ kind: "none" as const }),
      fill: () => ({ kind: "none" as const }), run: () => ({ kind: "none" as const }) } },
  objects: [],
});

describe("ObjectInspector: 未選択時", () => {
  beforeEach(() => {
    useDesignStore.setState({
      design: makeDesign(),
      selectedObjectId: null,
    });
  });

  it("placeholder メッセージを表示する", () => {
    render(<ObjectInspector />);
    expect(screen.getByText("object を選択してください")).toBeInTheDocument();
  });

  it("kind 切替 Tabs を表示しない", () => {
    render(<ObjectInspector />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("design.objects に object があっても selectedObjectId が null なら未選択", () => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 4, angleDeg: 45 }, order: 0 }],
      },
      selectedObjectId: null,
    });
    render(<ObjectInspector />);
    expect(screen.getByText("object を選択してください")).toBeInTheDocument();
  });
});
```

失敗理由: `object-inspector.tsx` 未作成のため import エラー → テスト読み込み失敗。

#### Green — 最小実装

`src/components/object-inspector.tsx` (新規):

```tsx
"use client";
import { useDesignStore } from "@/components/design-store";
import { Card, CardContent } from "@/components/ui/card";

export function ObjectInspector() {
  const selectedObjectId = useDesignStore((s) => s.selectedObjectId);
  const object = useDesignStore((s) =>
    s.selectedObjectId
      ? s.design?.objects.find((o) => o.id === s.selectedObjectId) ?? null
      : null,
  );

  if (!object) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          object を選択してください
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>{/* TODO Cycle 2+: フィールド群 */}</CardContent>
    </Card>
  );
}
```

#### Refactor
- 不要 (最初のサイクル)。

---

### Cycle 2: kind 切替で `updateObject(id, { kind })` が呼ばれる

#### 観点
- 選択中の object の `kind` が現在値で highlight 表示される
- Tabs (run / satin / fill) のいずれかをクリックすると `updateObject(id, { kind: 新値 })`
  が **1 回だけ** 呼ばれる
- 同じ kind を再クリックしても `updateObject` は呼ばれない (最適化)

#### Red — 失敗するテスト

`object-inspector.test.tsx` に追加:

```tsx
import userEvent from "@testing-library/user-event";

describe("ObjectInspector: kind 切替", () => {
  beforeEach(() => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 4, angleDeg: 45 }, order: 0 }],
      },
      selectedObjectId: "o1",
    });
  });

  it("現在の kind (fill) が selected として表示される", () => {
    render(<ObjectInspector />);
    expect(screen.getByRole("tab", { name: /fill/i, selected: true })).toBeInTheDocument();
  });

  it("satin に切り替えると updateObject(id, { kind: 'satin' }) が呼ばれる", async () => {
    const user = userEvent.setup();
    render(<ObjectInspector />);
    await user.click(screen.getByRole("tab", { name: /satin/i }));

    const obj = useDesignStore.getState().design!.objects.find((o) => o.id === "o1");
    expect(obj?.kind).toBe("satin");
  });

  it("run に切り替えると updateObject(id, { kind: 'run' }) が呼ばれる", async () => {
    const user = userEvent.setup();
    render(<ObjectInspector />);
    await user.click(screen.getByRole("tab", { name: /run/i }));
    expect(useDesignStore.getState().design!.objects[0].kind).toBe("run");
  });
});
```

失敗理由: `ObjectInspector` がまだ `<CardContent>{TODO}</CardContent>` のため `tab` role 要素なし。

#### Green — 最小実装

`object-inspector.tsx` の `object` が存在する分岐に `<Tabs>` (shadcn/ui) を追加:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// object が存在する分岐:
const updateObject = useDesignStore((s) => s.updateObject);
const onKindChange = (next: "run" | "satin" | "fill") => {
  if (next !== object.kind) updateObject(object.id, { kind: next });
};

return (
  <Card>
    <CardContent className="space-y-4">
      <Tabs value={object.kind} onValueChange={(v) => onKindChange(v as ObjectKind)}>
        <TabsList>
          <TabsTrigger value="run">run</TabsTrigger>
          <TabsTrigger value="satin">satin</TabsTrigger>
          <TabsTrigger value="fill">fill</TabsTrigger>
        </TabsList>
      </Tabs>
    </CardContent>
  </Card>
);
```

shadcn/ui の Tabs が `role="tab"` および `aria-selected` を発行することに依存する
(`@base-ui/react/tabs` の標準動作)。`tabs.tsx` を確認し、必要なら本 PR で `tabs.tsx` の方を
shadcn add し直す。

#### Refactor
- `onKindChange` 内のキャストを避けるため、`as const tuple` で `KIND_OPTIONS: readonly ObjectKind[]`
  を定義する。
- 同値クリック時に早期 return することで store の不要な書き込みを防ぐ。

---

### Cycle 3: 角度スライダ操作で `updateObject(id, { props: { angleDeg } })` が呼ばれる

#### 観点
- スライダの初期値が `object.props.angleDeg` を反映 (`undefined` のときは 0)
- スライダ操作 (`onValueChange`) で `updateObject(id, { props: { angleDeg: 新値 } })` が
  呼ばれる
- `props` 内の他フィールド (`densityMm` 等) は保持される
- `kind === "run"` のときは angleDeg スライダを disabled にする (run は角度不要)

#### Red — 失敗するテスト

```tsx
describe("ObjectInspector: 角度スライダ", () => {
  beforeEach(() => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "satin", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0],[10,2],[0,2]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 7, angleDeg: 30, pullCompMm: 0.2 },
          order: 0 }],
      },
      selectedObjectId: "o1",
    });
  });

  it("現在の angleDeg がスライダに反映される", () => {
    render(<ObjectInspector />);
    const slider = screen.getByLabelText(/角度/);
    // Base UI Slider は内部に role="slider" の thumb を持つ
    expect(slider).toBeInTheDocument();
    // aria-valuenow か data 属性で 30 を確認 (実装は base-ui のレンダリングに依存)
    const thumb = slider.querySelector("[role='slider']") as HTMLElement;
    expect(thumb.getAttribute("aria-valuenow")).toBe("30");
  });

  it("スライダ操作で updateObject が呼ばれ angleDeg が更新される", () => {
    render(<ObjectInspector />);
    // userEvent でのドラッグは jsdom 上で不安定なので、コンポーネントが受け取る onValueChange を
    // テスト用のヘルパー (テスト ID 経由) で直接呼ぶ。実装側でテスト用 hook を露出しない代わりに、
    // 「数値入力欄」を別途配置してそこにキー入力でテストする方針もある (下記 Refactor 参照)。
    // ここでは onValueChange を発火させるアクセシブルな手段として、キーボードで値を進める:
    const thumb = screen.getByLabelText(/角度/).querySelector("[role='slider']") as HTMLElement;
    thumb.focus();
    // ArrowRight 1 回で +1°
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    const obj = useDesignStore.getState().design!.objects[0];
    expect(obj.props.angleDeg).toBe(31);
    // 他のプロパティが消えていないこと
    expect(obj.props.densityMm).toBe(0.4);
    expect(obj.props.pullCompMm).toBe(0.2);
  });

  it("kind が run のときは角度スライダが disabled", () => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "run", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 4 }, order: 0 }],
      },
      selectedObjectId: "o1",
    });
    render(<ObjectInspector />);
    const thumb = screen.getByLabelText(/角度/).querySelector("[role='slider']") as HTMLElement;
    expect(thumb).toHaveAttribute("aria-disabled", "true");
  });
});
```

失敗理由: `<Slider>` がまだ未追加。`screen.getByLabelText(/角度/)` が見つからずエラー。

#### Green — 最小実装

`object-inspector.tsx` に Slider 行を追加:

```tsx
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

const angleDeg = object.props.angleDeg ?? 0;
const onAngleChange = (next: number) => {
  updateObject(object.id, { props: { ...object.props, angleDeg: next } });
};

<div className="space-y-2">
  <div className="flex items-center justify-between">
    <Label htmlFor="obj-angle">角度</Label>
    <span className="text-xs tabular-nums text-muted-foreground">{angleDeg}°</span>
  </div>
  <Slider
    id="obj-angle"
    aria-label="角度"
    value={[angleDeg]}
    min={0}
    max={179}
    step={1}
    disabled={object.kind === "run"}
    onValueChange={(v) => {
      const n = typeof v === "number" ? v : v[0];
      if (typeof n === "number") onAngleChange(n);
    }}
  />
</div>
```

`{ props: { ...object.props, angleDeg: next } }` の形で patch を作ることで、PR1 の
`updateObject` が shallow merge であっても `densityMm` 等が消えないことを保証する。

#### Refactor
- 「Label + 値表示 + Slider」を `<SliderField>` 内部コンポーネントに切り出し、Cycle 4 / 5 で
  再利用できるようにする (= 本計画書「9. Refactor 共通化」)。

---

### Cycle 4: 密度スライダで `densityMm` が更新される

#### 観点
- 初期値が `object.props.densityMm` を反映
- スライダ操作で `updateObject(id, { props: { densityMm: 新値, ...保持 } })` が呼ばれる
- `min=0.2 / max=0.8 / step=0.05`
- `angleDeg` など他フィールドが消えない

#### Red — 失敗するテスト

```tsx
describe("ObjectInspector: 密度スライダ", () => {
  beforeEach(() => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 4, angleDeg: 45 }, order: 0 }],
      },
      selectedObjectId: "o1",
    });
  });

  it("現在の densityMm が反映される", () => {
    render(<ObjectInspector />);
    const thumb = screen.getByLabelText(/密度/).querySelector("[role='slider']") as HTMLElement;
    expect(thumb.getAttribute("aria-valuenow")).toBe("0.4");
  });

  it("スライダ操作で densityMm が更新される (他フィールドは保持)", () => {
    render(<ObjectInspector />);
    const thumb = screen.getByLabelText(/密度/).querySelector("[role='slider']") as HTMLElement;
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" }); // +0.05

    const obj = useDesignStore.getState().design!.objects[0];
    expect(obj.props.densityMm).toBeCloseTo(0.45, 5);
    expect(obj.props.angleDeg).toBe(45);
  });
});
```

失敗理由: 密度スライダ未実装。`getByLabelText(/密度/)` が null。

#### Green — 最小実装

Cycle 3 で作った `<SliderField>` を使って密度行を追加:

```tsx
<SliderField label="密度" unit="mm" value={object.props.densityMm}
  min={0.2} max={0.8} step={0.05}
  onChange={(n) => updateObject(object.id, { props: { ...object.props, densityMm: n } })} />
```

#### Refactor
- 共通 `SliderField` をさらに最適化 (`useCallback` で patch builder を memoize)。
- `step` が小数の場合の表示桁数 (2 桁) を内部で固定。

---

### Cycle 5: pull comp スライダで `pullCompMm` が更新される

#### 観点
- 初期値: `object.props.pullCompMm ?? 0`
- `min=0 / max=1.0 / step=0.05`
- スライダ操作で `updateObject(id, { props: { ...保持, pullCompMm } })`
- `pullCompMm` が未定義の object に対しても値設定できる

#### Red — 失敗するテスト

```tsx
describe("ObjectInspector: pull comp スライダ", () => {
  beforeEach(() => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "satin", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0],[10,2],[0,2]], holes: [] },
          // pullCompMm 未設定
          props: { densityMm: 0.4, maxStitchMm: 7, angleDeg: 0 }, order: 0 }],
      },
      selectedObjectId: "o1",
    });
  });

  it("pullCompMm 未設定の場合スライダ初期値は 0", () => {
    render(<ObjectInspector />);
    const thumb = screen.getByLabelText(/pull/i).querySelector("[role='slider']") as HTMLElement;
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
  });

  it("スライダ操作で pullCompMm が設定される", () => {
    render(<ObjectInspector />);
    const thumb = screen.getByLabelText(/pull/i).querySelector("[role='slider']") as HTMLElement;
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" }); // +0.05
    const obj = useDesignStore.getState().design!.objects[0];
    expect(obj.props.pullCompMm).toBeCloseTo(0.05, 5);
    expect(obj.props.angleDeg).toBe(0);
  });
});
```

失敗理由: pull comp 行未実装。

#### Green — 最小実装

```tsx
<SliderField label="pull comp" unit="mm" value={object.props.pullCompMm ?? 0}
  min={0} max={1.0} step={0.05}
  onChange={(n) => updateObject(object.id, { props: { ...object.props, pullCompMm: n } })} />
```

#### Refactor
- 「値が `undefined` の場合の fallback 表示」を `SliderField` 側 prop `fallback` で統一。

---

### Cycle 6: underlay セレクトで `underlay.kind` が更新される

#### 観点
- `<Select>` の現在値が `object.props.underlay?.kind ?? "none"`
- 選択肢: `none`, `edge-run`, `center-run`, `zigzag`, `fill`
- 値を変えると `updateObject(id, { props: { ...保持, underlay: { kind: 新値, ...defaults } } })`
- 各 `UnderlayConfig.kind` の必須フィールド (例: `edge-run` の `insetMm` / `stitchLenMm`) は
  既定値で埋めて `UnderlayConfig` 型エラーにしない (本 PR では編集 UI なし、固定既定値)。

#### 既定値テーブル (本 PR 内)

| kind | 既定 patch |
|---|---|
| `none` | `{ kind: "none" }` |
| `edge-run` | `{ kind: "edge-run", insetMm: 0.5, stitchLenMm: 2 }` |
| `center-run` | `{ kind: "center-run", stitchLenMm: 2 }` |
| `zigzag` | `{ kind: "zigzag", spacingMm: 2, insetMm: 0.5 }` |
| `fill` | `{ kind: "fill", angleDeg: 90, spacingMm: 3 }` |

#### Red — 失敗するテスト

```tsx
describe("ObjectInspector: underlay セレクト", () => {
  beforeEach(() => {
    useDesignStore.setState({
      design: {
        ...makeDesign(),
        objects: [{ id: "o1", kind: "fill", colorIndex: 0, rgb: [0, 0, 0],
          shape: { outer: [[0,0],[10,0],[10,10],[0,10]], holes: [] },
          props: { densityMm: 0.4, maxStitchMm: 4, angleDeg: 45 }, order: 0 }],
      },
      selectedObjectId: "o1",
    });
  });

  it("初期表示は 'none'", () => {
    render(<ObjectInspector />);
    expect(screen.getByLabelText(/underlay/i)).toHaveTextContent(/none/i);
  });

  it("'zigzag' を選ぶと underlay が既定 patch で更新される", async () => {
    const user = userEvent.setup();
    render(<ObjectInspector />);
    await user.click(screen.getByLabelText(/underlay/i));
    await user.click(screen.getByRole("option", { name: /zigzag/i }));

    const obj = useDesignStore.getState().design!.objects[0];
    expect(obj.props.underlay).toEqual({ kind: "zigzag", spacingMm: 2, insetMm: 0.5 });
    expect(obj.props.angleDeg).toBe(45);
  });
});
```

失敗理由: underlay セレクト未実装。

#### Green — 最小実装

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const UNDERLAY_DEFAULTS: Record<UnderlayConfig["kind"], UnderlayConfig> = {
  "none": { kind: "none" },
  "edge-run": { kind: "edge-run", insetMm: 0.5, stitchLenMm: 2 },
  "center-run": { kind: "center-run", stitchLenMm: 2 },
  "zigzag": { kind: "zigzag", spacingMm: 2, insetMm: 0.5 },
  "fill": { kind: "fill", angleDeg: 90, spacingMm: 3 },
};

<div className="space-y-2">
  <Label htmlFor="obj-underlay">underlay</Label>
  <Select
    value={object.props.underlay?.kind ?? "none"}
    onValueChange={(v) => updateObject(object.id, {
      props: { ...object.props, underlay: UNDERLAY_DEFAULTS[v as UnderlayConfig["kind"]] },
    })}
  >
    <SelectTrigger id="obj-underlay" aria-label="underlay">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">none</SelectItem>
      <SelectItem value="edge-run">edge-run</SelectItem>
      <SelectItem value="center-run">center-run</SelectItem>
      <SelectItem value="zigzag">zigzag</SelectItem>
      <SelectItem value="fill">fill</SelectItem>
    </SelectContent>
  </Select>
</div>
```

#### Refactor
- `UNDERLAY_DEFAULTS` をモジュール先頭の定数として export することで、PR3 (Sewing Order)
  や PR4 のレイアウト統合でも再利用可能にする。
- `SliderField` と並べて `SelectField` の wrapper を切り出すかは「行数が増えない」前提で見送り。
  本 PR では select の利用は 1 箇所のみのため過剰抽象化を避ける。

---

### Cycle 7: `EmbroideryStudio` への配置 (スモーク統合)

#### 観点
- 既存の `EmbroideryStudio` ページに `ObjectInspector` をマウントしても、
  既存機能 (画像アップロード, ConversionSettings, ColorAngleEditor, StitchPreview) の
  既存スナップショット / 既存テストが壊れない
- 初期状態 (画像未選択) では Inspector も placeholder を表示

#### Red — 失敗するテスト

```tsx
// src/components/__tests__/embroidery-studio.test.tsx (新規)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmbroideryStudio } from "@/components/embroidery-studio";

describe("EmbroideryStudio: Object Inspector 統合", () => {
  it("初期表示で Inspector の placeholder が見える", () => {
    render(<EmbroideryStudio />);
    expect(screen.getByText("object を選択してください")).toBeInTheDocument();
  });
});
```

失敗理由: `EmbroideryStudio` に `ObjectInspector` がまだ import されていない。

#### Green — 最小実装

`src/components/embroidery-studio.tsx`:

```tsx
import { ObjectInspector } from "@/components/object-inspector";

// JSX 内、ConversionSettings の下あたりに 1 行追加:
<ObjectInspector />
```

レイアウト調整 (3 カラム化) は本 PR ではしない (PR4 の責務)。
既存の単一カラムの末尾にぶら下げるだけで OK。

#### Refactor
- Inspector の周辺に section ラベル (`<h2>オブジェクトプロパティ</h2>` 等) を 1 行入れて
  視認性を上げる (機能影響なし)。

---

## 7. サイクル依存グラフ

```
Cycle 0 (test env)
   ↓
Cycle 1 (placeholder)
   ↓
Cycle 2 (kind tabs)
   ↓
Cycle 3 (angle slider) ── SliderField 抽出 ──┐
   ↓                                        │
Cycle 4 (density slider) ────────────────── ┤ (SliderField 再利用)
   ↓                                        │
Cycle 5 (pull comp slider) ──────────────── ┘
   ↓
Cycle 6 (underlay select)
   ↓
Cycle 7 (EmbroideryStudio 統合)
```

Cycle 4-5 は SliderField 抽出のおかげで内容がほぼ同じ。順番は入れ替え可。
Cycle 7 は前 Cycle に依存しないため、緊急時は先行マージも可能 (placeholder のみ表示)。

## 8. 回帰防止

各 Cycle の Green 完了後に以下を確認:

1. `npm test` 全件パス
   - 既存 `src/lib/pipeline/__tests__/{stitch,vectorize}.test.ts` がそのまま緑
   - 新規 `object-inspector.test.tsx` の追加分のみ増える
   - Phase 5 PR1 で追加された `design-store.test.ts` (もし `.ts` ならそのまま node で走る) も緑
2. `npm run build` で Next.js のビルドが通る (型エラー 0)
3. `npm run lint` でエラー 0
4. ブラウザでの目視確認 (`npm run dev`):
   - 画像未選択 → Inspector に「object を選択してください」が見える
   - design store を devtools で書き換えて selectedObjectId をセット → スライダ群が反応する
5. 既存の `ColorAngleEditor` の挙動が変わらない (色別角度の global 編集は Inspector とは別)

## 9. Refactor 共通化

### `SliderField` (Cycle 3 末で抽出)

`object-inspector.tsx` の中に **module-private** で定義する。共有が必要になったら別ファイルへ。

```tsx
function SliderField({ label, unit, value, min, max, step, disabled, onChange }: {
  label: string;
  unit?: string;
  value: number;
  min: number; max: number; step: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const id = `obj-${label}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}{unit ? ` ${unit}` : ""}
        </span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        value={[value]}
        min={min} max={max} step={step}
        disabled={disabled}
        onValueChange={(v) => {
          const n = typeof v === "number" ? v : v[0];
          if (typeof n === "number") onChange(n);
        }}
      />
    </div>
  );
}
```

これにより Cycle 3-5 の Slider 行が 1 行のコンポーネント呼び出しに収まる。

## 10. 受け入れ条件

- [ ] `npm test` が全件パス (新規 jsdom project / 既存 node project の両方が緑)
- [ ] `src/components/object-inspector.tsx` から `ObjectInspector` が default ではなく named export
      されている
- [ ] `selectedObjectId === null` のとき「object を選択してください」が描画される
- [ ] kind タブ (run / satin / fill) が `object.kind` を反映し、別の kind をクリックすると
      store の object の `kind` が更新される
- [ ] 角度スライダの値が `object.props.angleDeg` を反映し、操作で更新される。`kind === "run"`
      では disabled
- [ ] 密度スライダの範囲は `0.2..0.8 step 0.05`、操作で `object.props.densityMm` が更新される
- [ ] pull comp スライダの範囲は `0..1.0 step 0.05`、操作で `object.props.pullCompMm` が更新される
- [ ] underlay セレクトの 5 種別を選ぶと、それぞれ `UnderlayConfig` の必須フィールドを満たした
      既定 patch で更新される
- [ ] スライダ / select 操作後も `props` 内の他フィールド (densityMm, angleDeg, pullCompMm 等) が
      消失しない
- [ ] `EmbroideryStudio` に Inspector がマウントされ、画像未選択でも placeholder が表示される
- [ ] 既存テスト (`src/lib/pipeline/__tests__/*.test.ts`) が破壊されていない

## 11. コミット粒度

1 TDD サイクル = 1 コミット。Conventional Commits 形式。

- Cycle 0: `chore(test): add jsdom + react-testing-library for component tests`
- Cycle 1: `feat(ui): add ObjectInspector placeholder when no object is selected`
- Cycle 2: `feat(ui): add kind tabs (run/satin/fill) to ObjectInspector`
- Cycle 3: `feat(ui): add angle slider to ObjectInspector`
- Cycle 4: `feat(ui): add density slider to ObjectInspector`
- Cycle 5: `feat(ui): add pull comp slider to ObjectInspector`
- Cycle 6: `feat(ui): add underlay select to ObjectInspector`
- Cycle 7: `feat(ui): mount ObjectInspector in EmbroideryStudio`

各コミットはテストと実装を同時に含み、`npm test` が緑であることを前提とする。
Cycle 3 末の `SliderField` 抽出は Cycle 3 のコミットに含める (= Refactor も同コミット)。

## 12. 想定 PR タイトル

`feat(ui): add object inspector for property editing (phase 5 pr2)`

PR 本文には:
- Phase 5 計画書「10. 実装ステップ 3」に対応する旨
- jsdom + @testing-library を初導入した旨 (Cycle 0)
- PR1 (design store) が前提である旨
- 編集対象は kind / 角度 / 密度 / pull comp / underlay の 5 項目で、entry point ピンや
  ノード編集は別 PR (PR4 以降) で扱う旨
を 4-6 行で記載する。

## 13. 注意事項

- **design store の API 形状**: 本計画書は PR1 で `useDesignStore` (Zustand) が以下の状態を持つと
  仮定している。
  ```ts
  type DesignStore = {
    design: EmbroideryDesign | null;
    selectedObjectId: string | null;
    updateObject: (id: string, patch: Partial<EmbroideryObject>) => void;
    // ...
  };
  ```
  PR1 のレビュー時点で形状が異なる場合 (例: React Context + useReducer、patch が DeepPartial 等)、
  Cycle 1 開始前にこの計画書の該当箇所を更新してから着手する。
- **patch のマージ方針**: `updateObject` が `props` を shallow merge するなら、各 Cycle の
  onChange で `{ props: { ...object.props, [key]: value } }` の形にして渡せば良い (本計画では
  この方式で統一)。`updateObject` が deep merge する場合は `{ props: { [key]: value } }` のみで
  十分だが、本 PR ではテストの一貫性のため明示的にスプレッドする。
- **Base UI Slider のキーボード操作**: `@base-ui/react/slider` は thumb 要素 (`role="slider"`)
  に対する ArrowLeft / ArrowRight で値が `step` ぶん動く想定。jsdom 下でも `fireEvent.keyDown`
  で動作することを Cycle 3 で確認する。動かない場合は `onValueChange` を直接呼ぶテストヘルパー
  (例: テスト ID 経由で hidden な input を露出) を用意する。
- **Base UI Select のクリックテスト**: Select は Portal 経由でレンダされるため、`getByRole("option")`
  でアクセス可能。Portal が jsdom 下でも `document.body` にマウントされることを Cycle 6 で確認。
- **`color-angle-editor.tsx` との関係**: 既存の `ColorAngleEditor` は「色 (colorIndex) 単位の
  fill 角度」を編集する global UI。本 PR の Inspector は **object 単位** で角度を編集する。
  両者は併存し、Phase 5 完了時点でどちらを残すかは PR4 (レイアウト統合) で判断する。
- **Tabs コンポーネントの未存在**: `src/components/ui/tabs.tsx` は既に shadcn/ui で追加済み。
  もし `TabsList` / `TabsTrigger` の export が無い場合は Cycle 2 で `shadcn add tabs` を実行する。
- **テストで使う型**: `EmbroideryObject` / `UnderlayConfig` / `ObjectKind` 等は PR1 で
  `@/lib/pipeline/types` から import 可能になっている前提。
- **画像ファイル/Pyodide 系のテスト副作用**: `EmbroideryStudio` をレンダする Cycle 7 では、
  `warmupOpenCV` / `warmupPyodide` の副作用が jsdom で失敗する可能性がある。失敗する場合は
  `vi.mock("@/lib/pipeline/pyodide-loader")` および `vi.mock("@/lib/pipeline/quantize")` で
  no-op に差し替える。
