# Phase 3. Pathing - Branching / 訪問順最適化 / Color Sort 強化

> **Status: ✅ Complete** (2026-05-26 merged PR #13 / #14 / #15)
> - PR13 (#13): pathing.ts 新規 — shapesTouch (bbox+線分距離) / findBranches (Union-Find) / chooseEntryExit (kind 別 NN)
> - PR14 (#14): optimizeOrder — 色グループ化 + branch group 間/内 nearest-neighbor + locked 保持
> - PR15 (#15): policy.ts (TRIM_POLICY_BY_FORMAT) + connectObjects + Phase 3 経路 renderColorBlockWithPolicy + compose.ts 経路組替
>
> 全 PR 共通: 370 テスト pass / tsc clean / build OK / lint warning 0 増。
> `RenderOptions.policy` を渡すと travel-run/jump/trim+jump の距離別ルーティング + tie-in/off 抑制が有効。
> 未指定なら Phase 1/2 互換 (既存テスト破壊なし)。
> 同色 push compensation 統合は Phase 4 forking point として保留。

ステッチ品質の **生産性 (時間とミス)** を決める要素を導入する。

## 1. 目的

- 縫う object の **順序を自動最適化**し、不要な trim と jump を削減
- **進入点 / 退出点** を最近接マッチングで決定
- **Branching** で接触/重なり object 群を travel run で繋ぐ
- **Color Sort** を強化 (現状の単純な colorIndex 昇順から、糸替え数を考慮した順序へ)

## 2. 現状参照

- `src/lib/pipeline/stitch.ts:75` `regions.sort((a, b) => a.colorIndex - b.colorIndex)` のみ
- 各 region 内の shapes 訪問順は `region.shapes` の入力順そのまま (`stitch.ts:87`)
- 進入点は `polygon[0]` 固定 → 1 つの長辺の先端から開始する
- 退出点は最後の `Stitch` 座標。次への接続は trim + jump

## 3. 全体構造

Phase 1 で導入した object モデルを前提に、新規モジュール:

```
src/lib/pipeline/
  pathing.ts            NEW
    optimizeOrder(design: EmbroideryDesign) -> EmbroideryDesign
    findBranches(objects) -> BranchGroup[]
    routeBranchGroup(group, prevAnchor) -> {orderedObjects, anchors}
    chooseEntryExit(obj, prevExit, nextEntry?) -> {entry: Point, exit: Point}
```

`renderStitches` の前段で `design.objects = optimizeOrder(design).objects` を呼ぶ。

## 4. 訪問順最適化

### 4.1 アルゴリズム概要

3 段階で進める:

**Step A: 色グループ化**

- 同色 object をまず纏める (糸替えコスト最大)
- 色グループ間の順序は固定 (ユーザー指定の color order があれば優先)

**Step B: 色グループ内で Branching 検出**

- 色グループ内で、shape 同士が **接触/重なり**しているか判定
- 接触している object 群を branch group としてまとめる

接触判定:

```ts
function shapesTouch(a: Shape, b: Shape, epsilon = 0.5): boolean {
  // a.outer のバウンディングと b.outer のバウンディングが overlap
  // かつ a.outer のいずれかの線分と b.outer のいずれかの線分が距離 < epsilon
}
```

**Step C: branch group 内で最近傍法**

- 1 つの branch group の中で、前 anchor からの最近傍 object を順次選ぶ
- 同時に「その object のどの edge point を入口・出口にするか」を決める
- branch group をまたぐ場合は trim + jump

### 4.2 Branching の実装方針

Wilcom の Branching は「接触/重なる object を 1 つの繋がった経路にする」ことが要点。
具体的にはこうする:

1. branch group の object 一覧から、外形 polyline の **端点候補**を集める
2. 端点同士のグラフ (距離行列) を構築
3. 最近傍法 (nearest neighbor heuristic) で TSP 近似解を出す
4. 各 object 内では、選んだ入口から「shape の縫い方向」に従って exit を計算

完全な TSP は object 数 < 50 なら brute force でも可。一般的には 2-opt で十分。

### 4.3 進入点 / 退出点の選定

```ts
type EdgePoint = { objId: string; pt: Point; side: "outer" | "hole"; index: number };

function chooseEntryExit(
  obj: EmbroideryObject,
  prevExit: Point,
  nextEntry?: Point,
): { entry: EdgePoint; exit: EdgePoint };
```

選び方:

- `entry` は obj の外形上で `prevExit` に最も近い点
- `exit` はその object の縫い終わり点 (kind ごとに性質が違う)
  - **fill**: 進入点を決めると scanline の往復方向が決まり、終点は最後の scanline の片端
  - **satin**: 進入点を決めると長軸方向の方向が決まり、終点は反対端
  - **run**: 進入点と終点を任意の 2 点として指定可能 (polyline の両端)

実装としては:
- まず entry を最近接で決定
- 次に kind ごとの renderer に entry を渡し、renderer が exit 座標を返す
- 次 object へは `findNearest(nextCandidates, exit)` で繋ぐ

## 5. Travel Run vs Trim+Jump

Wilcom Branching の本質は **trim を消す** こと。

```
distance(prev.exit, next.entry) < threshold:
  → travel run (走り縫い) で繋ぐ
else if distance > trimThresholdMm:
  → trim + jump
else:
  → jump only
```

`threshold` は色や object の厚みで変えるが、初期値は 3-5mm。

travel run は **必要なら既存の縫い目の下に潜らせる** のが理想だが、実装難度が高いため Phase 3 では:

- 距離 < 5mm: travel run で繋ぐ (見えても許容)
- 5 ≤ 距離 < 8mm: jump (trim 無し、糸が浮く)
- 距離 ≥ 8mm: trim + jump

`fabric` ごとに `trimThresholdMm` を変えられるよう `FabricProfile` に追加。

### 5.1 既存縫いの下に潜らせる travel run (発展)

Phase 3 のオプションとして:

1. 直前に縫い終わった object の外形に沿って exit から次 entry に近い点へ走り、
2. 既存 stitch の上に重なるよう polyline を取る
3. これにより表面からは travel run が見えなくなる

実装が重いので、Phase 3 v1 では「直線 travel run」のみ。v2 で「object 内エッジトレース travel」。

## 6. Color Sort 強化

### 6.1 既定

- 入力画像の `colorIndex` 順 (今と同じ) を尊重
- ただし object 数の少ない色は **最後** にまとめる傾向にする (Brother Intelligent Color Sort 互換)
- 細かいディテール (object 数 < 3 個の色) は他色の上に重ねたいので最後

### 6.2 ユーザー指定

`EmbroideryDesign.objects` の `order` をユーザーが上書きできる UI を Phase 5 で実装。
`optimizeOrder` は `locked: true` の object を移動させない。

### 6.3 同色内の Branching

色グループ単位で 4.2 の branching を適用。

## 7. Trim 閾値の動的化

Wilcom / Brother は format と機種ごとに最適な trim 閾値を変える。本実装も:

```ts
type TrimPolicy = {
  trimThresholdMm: number;
  jumpThresholdMm: number;
  travelRunUntilMm: number;
};

const TRIM_POLICY_BY_FORMAT: Record<EmbroideryFormat, TrimPolicy> = {
  dst: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  pes: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  jef: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  exp: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
  vp3: { trimThresholdMm: 8, jumpThresholdMm: 5, travelRunUntilMm: 5 },
};
```

DST は色情報を含まない (色替えはマシン側で手動) ため、color 間は必ず STOP コマンド (現在の `kind: "stop"`) を入れる。

## 8. 実装ステップ

- [ ] 1. `pathing.ts` を新規作成し、空のスケルトンを置く (テストファースト推奨)
- [ ] 2. `shapesTouch(a, b)` を実装 (バウンディング先行 + 線分距離)
- [ ] 3. `findBranches(objects)` を実装 (Union-Find で接触グループ化)
- [ ] 4. `chooseEntryExit(obj, prevExit)` を kind 別に実装
- [ ] 5. `optimizeOrder(design)` を実装 (色ソート → branching → 最近傍順)
- [ ] 6. `compose.ts` で render の直前に `optimizeOrder` を呼ぶ
- [ ] 7. `render.ts` を改修:
  - 各 object の `entry` を受け取り、renderer の中で entry から逆向きにスキャンラインを開始
  - 各 object の `exit` を返す
  - object 間の繋ぎを `travel run / jump / trim+jump` のいずれかにする
- [ ] 8. `TRIM_POLICY_BY_FORMAT` を `fabric.ts` または `policy.ts` に追加

## 9. テスト

- `pathing.test.ts`:
  - 3 つの object が一直線に並ぶケース → 訪問順が左→中→右になること
  - 2 つの object が触れているケース → branch group に纏まり travel run で繋がる
  - bbox は重なるが線分が交差しないケース → 接触判定 false
- `entry-exit.test.ts`:
  - fill object に entry を与えると、entry から始まる scanline の片端が exit になる
- `render.test.ts`:
  - object 間距離 3mm → travel run (kind="run")
  - object 間距離 6mm → jump
  - object 間距離 10mm → trim + jump

## 10. 受け入れ条件

- [ ] 同じ画像で Phase 2 と比較して、trim 数が 30% 以上減ること
- [ ] 同色 object 数 5 以上の画像で、travel run が機能していることが目視確認できる
- [ ] `optimizeOrder` を呼んでも呼ばなくても、最終的に縫われる絵柄は同じ (object の中身は不変)
- [ ] `locked: true` の object は元の order を保持する

## 11. 発展課題

- Travel run を既存縫い下に潜らせる経路探索 (visibility graph)
- 2-opt / 3-opt による訪問順改善
- DST/PES の色境界での **stop** コマンド最小化 (Wilcom Branching が同色グループ間で trim 不要にする仕組み)
