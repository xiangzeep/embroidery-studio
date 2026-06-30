# Phase 2. Quality - Underlay / Pull-Push Compensation / Lockstitch

> **Status: ✅ Complete** (2026-05-26 merged PR #8 / #9 / #10 / #11 / #12)
> - PR8 (#8): Pull Compensation Satin パス、自前 normal offset (clipper 不要)
> - PR9 (#9): Pull Comp Fill + Push Comp + clipper-lib@^6.4.2 導入、polygon-offset.ts 新規
> - PR10 (#10): edge-run / center-run underlay (Zhang-Suen thinning + BFS 直径)
> - PR11 (#11): zigzag / fill underlay + scanline.ts 抽出 (循環依存予防)
> - PR12 (#12): lockstitch + render 統合 + ConversionConfig debug flags + Phase 2 受け入れテスト
>
> 全 PR 共通: 322 テスト pass / npx tsc --noEmit pass / npm run build pass / lint warning 0 増。
> Phase 2 機能はデフォルト ON。`disableUnderlay` / `disableCompensation` で UI から無効化可能。
> Forking points for Phase 3: travel-run 連結時の tie-in/off 抑制 (assembleWithUnderlayAndLockstitch)、同色 push comp 統合。

実機での仕上がり品質を決定する **3 大要素**を導入する。

## 1. 目的

- **Underlay** で布を固定し、表縫いの沈み込み・パッカリングを防ぐ
- **Pull Compensation** で縫い後の細りを補正し、隣接色との隙間を埋める
- **Push Compensation** で重なる object の端の重なりすぎを補正
- **Lockstitch (tie-in / tie-off)** で糸抜けを防ぐ

## 2. 現状参照

- `src/lib/pipeline/stitch.ts` 全体で underlay / compensation / lockstitch いずれも未実装
- `docs/pipeline.md:38` に「引き締まり補正 (pull compensation)」が TODO で残っている
- `src/lib/pipeline/stitch.ts:167-175` で色替え時に `kind: "stop"` を入れているが、その前後のロックステッチは無し

## 3. Underlay (下縫い)

### 3.1 種別

`UnderlayConfig` (Phase 1 で定義済み) を実装する。

| 種別 | 用途 | 実装方針 |
|---|---|---|
| `none` | 装飾 / 上書き想定 | 何もしない |
| `center-run` | 細い satin (幅 1.5-2mm) | 形状の medial-axis を `stitchLenMm` で resample した run を吐く |
| `edge-run` | 中幅 satin (幅 2.5-3.5mm) と fill | 外形を `insetMm` (~0.4mm) 内側にオフセットしてから `stitchLenMm` で resample |
| `zigzag` | 幅広 satin (幅 4mm 以上) | 2 つの rail (両端線) 間を zigzag で往復。`spacingMm` で間隔指定 |
| `fill` | fill object 用 | 表縫いと直交方向 (`angleDeg + 90`) で粗めの fill (`spacingMm` ~3mm) を生成 |

複合 underlay (zigzag + edge-run の二重) も Wilcom が採用しているが、`UnderlayConfig` を配列にして順次走らせれば対応できる。Phase 2 では単一指定で十分。

### 3.2 ファイル構成

```
src/lib/pipeline/
  underlay.ts            NEW
    centerRunUnderlay(shape, props) -> Point[]
    edgeRunUnderlay(shape, insetMm, stitchLenMm) -> Point[]
    zigzagUnderlay(shape, spacingMm, insetMm) -> Point[]
    fillUnderlay(shape, angleDeg, spacingMm) -> Point[][]
    generateUnderlayStitches(obj: EmbroideryObject) -> Stitch[]
```

### 3.3 ポリゴンオフセット実装

Clipper.js (純 JS, MIT) を導入する。

- パッケージ: `clipper-lib` または `@doodle3d/clipper-js`
- 用途: `edge-run` / `zigzag` の inset 計算 (Minkowski sum / polygon offset)
- 代替案 (依存を増やさない場合): 凸ポリゴン限定で自前で edge ノーマル方向に動かす実装でも可

### 3.4 自動付与ロジック

`build-objects.ts` の延長で `applyUnderlayDefaults(obj, fabric)` を実装:

```ts
function applyUnderlayDefaults(obj: EmbroideryObject, fabric: FabricProfile): EmbroideryObject {
  if (obj.props.underlay) return obj; // ユーザー指定済み
  let underlay: UnderlayConfig;
  if (obj.kind === "satin") {
    const widthMm = computeSatinWidth(obj.shape);
    underlay = fabric.underlayPolicy.satin(widthMm);
  } else if (obj.kind === "fill") {
    underlay = fabric.underlayPolicy.fill();
  } else {
    underlay = fabric.underlayPolicy.run();
  }
  return { ...obj, props: { ...obj.props, underlay } };
}
```

### 3.5 レンダリング順

`renderStitches` の中で、各 object について:

```
1. underlay (もしあれば)
2. top stitches (kind に応じて)
3. tie-off (Phase 2 後段)
```

の順で stitch を吐く。各 underlay segment 終了時から top stitches の開始点までは jump で繋ぐ。

## 4. Pull Compensation

### 4.1 アルゴリズム

`shape.outer` (および satin の rails) を、object の **短軸方向**に外側オフセットする。

- Satin: 両端の rail を外側に `pullCompMm` ずつオフセット
- Fill: 外形を外側に `pullCompMm` オフセット (穴は逆に内側に縮める)
- Run: 補正不要 (幅が無いので)

### 4.2 値の決定

`fabric.pullCompForWidth(widthMm)`:

```ts
function pullCompForWidth(profile: FabricProfile, widthMm: number): number {
  return Math.max(profile.minPullCompMm, widthMm * profile.pullCompPerWidth);
}
```

例: denim, satin 7mm → max(0.10, 7 * 0.025) = 0.175mm
例: terry, satin 7mm → max(0.30, 7 * 0.080) = 0.56mm

業界記事の例 (`embroiderylegacy.com`):
- 2mm 幅 → 0.15mm
- 7mm 幅 → 0.30mm
これは denim 付近に相当。

### 4.3 per-side

`ObjectProps.pullCompPerSideMm = { left: 0.2, right: 0.1 }` のように、片側だけ補正したい
ケースに対応する。Wilcom 互換。実装は satin の rail 単位で外側オフセット量を分岐させる。

### 4.4 ファイル

```
src/lib/pipeline/
  compensation.ts        NEW
    applyPullCompensation(obj, fabric) -> EmbroideryObject  (shape を変えた新オブジェクトを返す)
    applyPushCompensation(obj, neighbors) -> EmbroideryObject
```

純粋関数として `shape` のみ書き換える。

### 4.5 注意: 順序

- Underlay は **元の shape** に対して計算 (補正前の形状の上で布を固定するため)
- Top stitches は **補正後の shape** に対して計算
- これにより underlay と top stitches の境界が一致せず、underlay が見えてしまうのを防ぐ
- 実装上は `applyPullCompensation` の戻り値を top stitches 用にだけ使い、underlay は元 shape を参照する

## 5. Push Compensation

### 5.1 用途

object A の上に object B (例: ロゴの上に縁取り satin) が重なる場合、
A の端が B の下で重なって膨らむ。これを A 側の端を `pushCompMm` 縮めることで吸収する。

業界標準値: 約 0.4mm (~1 stitch) 縮める。

### 5.2 検出

object 間の overlap を bbox + 多角形交差で判定 (`compensation.ts`):

```ts
function findPushTargets(objects: EmbroideryObject[]): Map<id, id[]> {
  // 下に置かれる object id → その上に重なる object id 配列
}
```

`applyPushCompensation` は overlap している側を内側オフセット。Phase 2 では:

- まず **同色 object 同士の重なり**は無視 (Phase 3 で branching と統合)
- **異なる色 object** 同士の重なりにのみ適用 (色境界での見え隙間防止が主用途)

## 6. Lockstitch (Tie-in / Tie-off)

### 6.1 仕様

各 object の最初と最後 (糸の出入りタイミング) に、3 点の小さな往復縫いを挿入。

- 距離: 0.5-1.0mm
- 針数: 3 点 (start - back - forward - back = 3 stitch)
- 配置: object の最初の stitch direction に沿って後退 → 前進 → 後退

### 6.2 配置タイミング

```
[trim or jump] → [tie-in 3 stitch] → [underlay] → [top stitches] → [tie-off 3 stitch] → [next jump/stop]
```

color 内で travel run で繋がっている場合 (Phase 3 で実装) は、tie-in / tie-off を入れない設計にする。

### 6.3 実装

`src/lib/pipeline/stitch.ts` (リネーム後 `render.ts`) の renderer 関数内で、
最初/最後の stitch 出力直前/直後に 3 stitch 分の往復を挿入する。

```ts
function emitTieIn(out: Stitch[], firstDir: Point, anchor: Point, colorIndex: number) {
  const back: Point = [anchor[0] - firstDir[0] * 0.8, anchor[1] - firstDir[1] * 0.8];
  out.push({ ...back, kind: "run", colorIndex });
  out.push({ ...anchor, kind: "run", colorIndex });
  out.push({ ...back, kind: "run", colorIndex });
  out.push({ ...anchor, kind: "run", colorIndex });
}
```

## 7. 実装ステップ

- [ ] 1. `clipper-lib` 等のオフセットライブラリを `package.json` に追加し動作確認
- [ ] 2. `compensation.ts` を新規作成し、`applyPullCompensation` を実装 (まず Satin)
- [ ] 3. `compensation.ts` に `applyPushCompensation` を追加
- [ ] 4. `underlay.ts` を新規作成:
  - [ ] 4.1 `edgeRunUnderlay` (最小限)
  - [ ] 4.2 `centerRunUnderlay`
  - [ ] 4.3 `fillUnderlay`
  - [ ] 4.4 `zigzagUnderlay`
- [ ] 5. `build-objects.ts` で `applyUnderlayDefaults` を呼ぶよう拡張
- [ ] 6. `render.ts` (旧 `stitch.ts`) で:
  - underlay stitches を top の前に出力
  - object の最初/最後に tie-in / tie-off を入れる
- [ ] 7. `ConversionConfig` に `disableUnderlay` / `disableCompensation` のデバッグ用フラグを追加

## 8. テスト

- `compensation.test.ts`
  - 5mm 矩形の satin に pull comp 0.2mm を適用すると、両端が 5.4mm に広がる
  - 穴あり fill に pull comp 0.2mm を適用すると、外形は外側に、穴は内側に動く
- `underlay.test.ts`
  - 矩形 fill に edge-run underlay (inset 0.4mm) を生成すると、内側 0.4mm の閉ループになる
  - 細長い satin に center-run underlay を生成すると、medial axis 上の polyline になる
- `render.test.ts`
  - 1 オブジェクトの結果に `tie-in` 3 stitch + `tie-off` 3 stitch が含まれること
  - underlay → top の順で kind が並んでいること

## 9. 受け入れ条件

- [ ] 100×100mm のロゴで underlay/comp/lockstitch を有効にした結果、ステッチ数が +30〜+60% (underlay 分) 増える
- [ ] `disableUnderlay=true` で Phase 1 のステッチ数と一致する
- [ ] 3 色重ね合わせ画像で、隣接色境界の見え隙間が無くなる (目視確認)
- [ ] DST 書き出しが破綻しない (pyembroidery で読み直して同等)

## 10. 未対応 (Phase 3 以降)

- Underlay の **複合適用** (zigzag + edge-run 重ね) → Phase 4
- Auto Fabric Assistant の **拡縮時再計算** → 本アプリでは不要
- Push compensation の **同色 object 重なり** 対応 → Phase 3 の branching と統合
