import type {
  StitchPattern,
  StitchBlock,
  Stitch,
  StitchKind,
  Shape,
  EmbroideryObject,
  EmbroideryDesign,
  FabricProfile,
} from "./types";
import type { ColorRegion } from "./vectorize";
import { analyzeShape, computeAspectRatio } from "./geometry";
import { buildObjects } from "./build-objects";
import { applyPullCompensation } from "./compensation";
import { emitTieIn, emitTieOff } from "./lockstitch";
import { intersectScanline } from "./scanline";
import { tatamiBrick } from "./fill";
import { medialAxisRun } from "./run";
import { brickSplit, extractRails, renderSatin2Rail } from "./satin";
import { generateUnderlayStitches } from "./underlay";
import type { TrimPolicy } from "./policy";

export type { TrimPolicy } from "./policy";


const SATIN_MIN_ASPECT_RATIO = 4;
const DEFAULT_MAX_STITCH_MM = 7;
const DEFAULT_TRIM_THRESHOLD_MM = 8;
const DEFAULT_RUN_MAX_WIDTH_MM = 0.6;
const DEFAULT_FILL_ANGLE_DEG = 45;
const DEFAULT_SHAPE_STRATEGY_MIN_ASPECT = 1.5;

export type StitchInput = {
  regions: ColorRegion[];
  /** 生地プロファイル。density・underlay・pull comp の派生元として buildObjects / renderDesign に流す。 */
  fabric: FabricProfile;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  stitchDensityMm: number;
  satinMaxWidthMm: number;
  runMaxWidthMm?: number;
  maxStitchMm?: number;
  /** この距離より長い jump の前に trim (糸切り) を挿入する。PES/JEF/EXP/VP3 で渡り糸を切るのに使う。 */
  trimThresholdMm?: number;
  /** 全体の fill 角度 (deg)。0 で水平、90 で垂直。 */
  fillAngleDeg?: number;
  /**
   * 色 (colorIndex) ごとの fill 角度 override (deg)。
   * 指定があれば `fillStrategy` / `fillAngleDeg` より優先される。
   * 文字色・キャラ色など、絵柄パーツごとに縫い方向を変えたいときに使う。
   */
  fillAngleByColorIndex?: Record<number, number>;
  /**
   * shape 形状に基づいた fill 方向の決め方。
   * - `global-angle`: 全 shape を `fillAngleDeg` で塗る (デフォルト)
   * - `shape-long-axis`: 各 shape の PCA 長軸に沿って塗る
   * - `shape-cross-axis`: 長軸に直交して塗る (satin と同じ感覚)
   * 等方形 (aspectRatio < `shapeStrategyMinAspect`) の shape は不安定なので
   * `fillAngleDeg` にフォールバックする。
   */
  fillStrategy?: FillStrategy;
  /**
   * `shape-long-axis` / `shape-cross-axis` で PCA 方向を採用する最小アスペクト比。
   * デフォルト 1.5。これより低い shape は `fillAngleDeg` にフォールバック。
   */
  shapeStrategyMinAspect?: number;
  /** Phase 2 §3 Underlay 生成をスキップ (デバッグ / Phase 1 互換用)。 */
  disableUnderlay?: boolean;
  /** Phase 2 §4 Pull Compensation をスキップ (デバッグ / Phase 1 互換用)。 */
  disableCompensation?: boolean;
  /** Phase 2 §6 Lockstitch (tie-in/off) をスキップ (デバッグ / Phase 1 互換用、UI 非露出)。 */
  disableLockstitch?: boolean;
};

export type FillStrategy =
  | "global-angle"
  | "shape-long-axis"
  | "shape-cross-axis";

/**
 * 既存 `StitchInput` のうち renderer が必要とする「描画パラメータ」だけを残した型。
 * Phase 1 PR4 時点では `StitchInput` とほぼ等価。
 * Phase 1 PR6-8 で `ObjectProps` / `FabricProfile` ベースに置き換える予定。
 *
 * renderer の入力 obj は既に mm 座標 (shape は scaleShape 済み) なので px→mm 換算は不要。
 * よって height 系の px 値は持たない (heightMm は出力 StitchPattern に残すため保持)。
 */
export type RenderOptions = {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  stitchDensityMm: number;
  satinMaxWidthMm: number;
  runMaxWidthMm?: number;
  maxStitchMm?: number;
  trimThresholdMm?: number;
  fillAngleDeg?: number;
  fillAngleByColorIndex?: Record<number, number>;
  fillStrategy?: FillStrategy;
  shapeStrategyMinAspect?: number;
  /** Phase 2 §4 Pull Compensation を適用する fabric profile。未指定なら無効。 */
  fabric?: FabricProfile;
  /** Phase 2 §3 Underlay 生成をスキップ (デバッグ / Phase 1 互換用)。 */
  disableUnderlay?: boolean;
  /** Phase 2 §4 Pull Compensation をスキップ (デバッグ / Phase 1 互換用)。 */
  disableCompensation?: boolean;
  /** Phase 2 §6 Lockstitch (tie-in/off) をスキップ (デバッグ / Phase 1 互換用、UI 非露出)。 */
  disableLockstitch?: boolean;
  /** Phase 4 §3-4 2-rail satin + brick auto-split を無効化 (デバッグ / Phase 1-3 互換用)。
   *  true のとき renderSatinTopOnly は旧 satinStitches (PCA 単一長軸) 経路に戻る。 */
  disableAutoSplit?: boolean;
  /** Phase 4 §6 medial-axis run (Zhang-Suen) を無効化 (デバッグ / Phase 1-3 互換用)。
   *  true のとき renderRunTopOnly は shape.outer をそのまま resample する。 */
  disableMedialAxis?: boolean;
  /** Phase 3 §7 distance-based routing (travel-run/jump/trim+jump)。未指定なら Phase 1/2 互換 (常に trim+jump)。 */
  policy?: TrimPolicy;
  /** renderDesign 内で per-object に注入される (renderer 側でのみ参照)。tie-in を抑制する travel-run 連結時用。 */
  suppressTieIn?: boolean;
  /** renderDesign 内で per-object に注入される。tie-off を抑制する travel-run 連結時用。 */
  suppressTieOff?: boolean;
};

/** 1 オブジェクトを描画するための文脈。 */
export type RenderContext = {
  opts: RenderOptions;
};

type Point = [number, number];
type Polygon = Point[];

/**
 * 1 つの kind="run" オブジェクトを描画して Stitch 配列を返す。
 * `RenderOptions.disable*` フラグに応じて compensation / underlay / lockstitch を合成する。
 * Phase 2 §4.5 順序: underlay は元 shape、top は補正後 shape に対して計算する。
 */
export function renderRun(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  const objForTop = applyCompForRender(obj, ctx);
  const top = renderRunTopOnly(objForTop, ctx);
  return assembleWithUnderlayAndLockstitch(obj, top, ctx);
}

/**
 * 1 つの kind="satin" オブジェクトを描画して Stitch 配列を返す。
 * `RenderOptions.disable*` フラグに応じて compensation / underlay / lockstitch を合成する。
 */
export function renderSatin(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  const objForTop = applyCompForRender(obj, ctx);
  const top = renderSatinTopOnly(objForTop, ctx);
  return assembleWithUnderlayAndLockstitch(obj, top, ctx);
}

/**
 * 1 つの kind="fill" オブジェクトを描画して Stitch 配列を返す。
 * `RenderOptions.disable*` フラグに応じて compensation / underlay / lockstitch を合成する。
 */
export function renderFill(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  const objForTop = applyCompForRender(obj, ctx);
  const top = renderFillTopOnly(objForTop, ctx);
  return assembleWithUnderlayAndLockstitch(obj, top, ctx);
}

function renderRunTopOnly(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  const block: StitchBlock = {
    colorIndex: obj.colorIndex,
    rgb: obj.rgb,
    stitches: [],
  };
  // Phase 4 PR19: medial-axis を優先。退化 shape (面積過小 / 細すぎる) で
  // 空配列が返ったときは外形 resample にフォールバック (Phase 1-3 互換)。
  let pts: Point[] = ctx.opts.disableMedialAxis
    ? []
    : medialAxisRun(obj.shape, ctx.opts.stitchDensityMm);
  if (pts.length === 0) {
    pts = resamplePolyline(
      obj.shape.outer as Polygon,
      ctx.opts.stitchDensityMm,
    );
  }
  if (pts.length === 0) return block.stitches;
  appendStitchesWithJumps(
    block,
    pts,
    "run",
    obj.colorIndex,
    ctx.opts.maxStitchMm ?? DEFAULT_MAX_STITCH_MM,
    ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM,
    true,
  );
  return block.stitches;
}

function renderSatinTopOnly(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  const block: StitchBlock = {
    colorIndex: obj.colorIndex,
    rgb: obj.rgb,
    stitches: [],
  };
  const outer = obj.shape.outer as Polygon;
  const maxStitchMm = ctx.opts.maxStitchMm ?? DEFAULT_MAX_STITCH_MM;
  const trimThresholdMm = ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;

  let pts: Point[];
  if (ctx.opts.disableAutoSplit) {
    // 互換経路: Phase 1-3 と完全一致の satinStitches (PCA 単一長軸)
    const { longAxis, center } = analyzeShape(outer);
    pts = satinStitches(outer, ctx.opts.stitchDensityMm, longAxis, center);
  } else {
    // 新経路 (Phase 4): 2-rail satin + brick auto-split
    const rails = extractRails(obj.shape);
    const zigzag = renderSatin2Rail(rails, ctx.opts.stitchDensityMm, maxStitchMm);
    pts = applyBrickSplit(zigzag, maxStitchMm);
  }

  if (pts.length === 0) return block.stitches;
  appendStitchesWithJumps(
    block,
    pts,
    "satin",
    obj.colorIndex,
    maxStitchMm,
    trimThresholdMm,
    true,
  );
  return block.stitches;
}

/**
 * renderSatin2Rail のジグザグ出力を 2 点ペアに区切り、ペアごとに brickSplit
 * を適用して中間点を挿入した 1 本の Point[] に flatten する。
 * 隣接ペアで端点が重複する場合は除去する。
 */
function applyBrickSplit(zigzag: Point[], maxStitchMm: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < zigzag.length; i += 2) {
    const a = zigzag[i];
    const b = zigzag[i + 1];
    const rowIndex = i / 2;
    const seg = brickSplit(a, b, maxStitchMm, rowIndex);
    if (out.length > 0 && pointsClose(out[out.length - 1], seg[0])) {
      for (let k = 1; k < seg.length; k++) out.push(seg[k]);
    } else {
      for (const p of seg) out.push(p);
    }
  }
  return out;
}

function pointsClose(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-6;
}

function renderFillTopOnly(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  const block: StitchBlock = {
    colorIndex: obj.colorIndex,
    rgb: obj.rgb,
    stitches: [],
  };
  const outer = obj.shape.outer as Polygon;
  const { longAxis, center } = analyzeShape(outer);
  const aspectRatio = computeAspectRatio(outer, longAxis, center);
  const colorOverride = ctx.opts.fillAngleByColorIndex?.[obj.colorIndex];
  const shapeAngleDeg = resolveShapeFillAngle(
    colorOverride,
    ctx.opts.fillStrategy ?? "global-angle",
    ctx.opts.fillAngleDeg ?? DEFAULT_FILL_ANGLE_DEG,
    longAxis,
    aspectRatio,
    ctx.opts.shapeStrategyMinAspect ?? DEFAULT_SHAPE_STRATEGY_MIN_ASPECT,
  );
  const maxStitchMm = ctx.opts.maxStitchMm ?? DEFAULT_MAX_STITCH_MM;
  const segments = tatamiBrick(
    obj.shape,
    ctx.opts.stitchDensityMm,
    shapeAngleDeg,
    maxStitchMm,
  );
  const trimThresholdMm =
    ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;
  for (const seg of segments) {
    if (seg.length === 0) continue;
    appendStitchesWithJumps(
      block,
      seg,
      "fill",
      obj.colorIndex,
      maxStitchMm,
      trimThresholdMm,
      true,
    );
  }
  return block.stitches;
}

/**
 * top-only renderer の戻り値に underlay と tie-in/off を合成する。
 *
 * `RenderOptions.disableUnderlay` / `disableLockstitch` が true なら該当部分をスキップ。
 * - underlay 計算は **元 shape** (補正前) で行う (§4.5)
 * - tie-in/off は color 内 travel run で繋がっている場合は将来抑制可能 (Phase 3 fork point)
 *
 * 戻り値順序: `[tie-in, ...underlay, ...top, tie-off]` (各 disableXxx で個別除外)。
 */
function assembleWithUnderlayAndLockstitch(
  obj: EmbroideryObject,
  top: Stitch[],
  ctx: RenderContext,
): Stitch[] {
  if (top.length === 0) return [];
  const underlay = ctx.opts.disableUnderlay
    ? []
    : generateUnderlayStitches(obj);
  if (ctx.opts.disableLockstitch) {
    return [...underlay, ...top];
  }
  // Phase 3 §5 travel-run 連結時の抑制: color 内で前 object と travel run で連結している
  // 場合は tie-in を、次が travel run で連結する場合は tie-off を、それぞれスキップする。
  // renderDesign が opts.suppressTieIn / suppressTieOff を per-object に注入する。
  const first = top[0];
  const second = top[1] ?? first;
  const last = top[top.length - 1];
  const prev = top[top.length - 2] ?? last;
  const norm = (dx: number, dy: number): [number, number] => {
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  const firstDir = norm(second.x - first.x, second.y - first.y);
  const lastDir = norm(last.x - prev.x, last.y - prev.y);
  const tieIn = ctx.opts.suppressTieIn
    ? []
    : emitTieIn([first.x, first.y], firstDir, obj.colorIndex);
  const tieOff = ctx.opts.suppressTieOff
    ? []
    : emitTieOff([last.x, last.y], lastDir, obj.colorIndex);
  return [...tieIn, ...underlay, ...top, ...tieOff];
}

/**
 * `RenderOptions.disableCompensation` と `fabric` の有無に応じて Pull Compensation を
 * 適用した EmbroideryObject を返す (top 計算用)。compensation 無効時は入力 obj をそのまま返す。
 */
function applyCompForRender(
  obj: EmbroideryObject,
  ctx: RenderContext,
): EmbroideryObject {
  if (ctx.opts.disableCompensation) return obj;
  if (!ctx.opts.fabric) return obj;
  return applyPullCompensation(obj, ctx.opts.fabric);
}

/**
 * Phase 3 §5 オブジェクト間繋ぎ。`prevExit` → `nextEntry` を距離に応じて以下のいずれかで繋ぐ:
 *
 *   - 距離 < `policy.travelRunUntilMm`           → 1 stitch (kind="run"、座標=nextEntry)
 *   - `travelRunUntilMm` <= 距離 < `trimThresholdMm` → 1 stitch (kind="jump"、座標=nextEntry)
 *   - 距離 >= `trimThresholdMm`                  → 2 stitch (kind="trim" @prevExit, kind="jump" @nextEntry)
 *
 * 戻り値の colorIndex は **次 object** のものを使う (糸切り替え後の糸として扱う)。
 */
export function connectObjects(
  prevExit: Point,
  nextEntry: Point,
  nextColorIndex: number,
  policy: TrimPolicy,
): Stitch[] {
  const dist = Math.hypot(
    nextEntry[0] - prevExit[0],
    nextEntry[1] - prevExit[1],
  );
  if (dist < policy.travelRunUntilMm) {
    return [
      { x: nextEntry[0], y: nextEntry[1], kind: "run", colorIndex: nextColorIndex },
    ];
  }
  if (dist < policy.trimThresholdMm) {
    return [
      { x: nextEntry[0], y: nextEntry[1], kind: "jump", colorIndex: nextColorIndex },
    ];
  }
  return [
    { x: prevExit[0], y: prevExit[1], kind: "trim", colorIndex: nextColorIndex },
    { x: nextEntry[0], y: nextEntry[1], kind: "jump", colorIndex: nextColorIndex },
  ];
}

/**
 * `EmbroideryDesign` を pure に `StitchPattern` に変換する。
 * - colorIndex で objects をグルーピングし、同色は 1 block にまとめる
 * - block 内では order 昇順で renderRun/Satin/Fill にディスパッチ
 * - block 間には kind="stop" を末尾に挿入
 */
export function renderDesign(
  design: EmbroideryDesign,
  opts: RenderOptions,
): StitchPattern {
  const ctx: RenderContext = { opts };
  const trimThresholdMm =
    opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;

  // order の昇順で並べてから colorIndex でグルーピングする。
  // colorIndex 内の順序が order と一致するので、block 内の描画順も order に従う。
  const byColor = new Map<number, EmbroideryObject[]>();
  for (const obj of [...design.objects].sort((a, b) => a.order - b.order)) {
    const arr = byColor.get(obj.colorIndex) ?? [];
    arr.push(obj);
    byColor.set(obj.colorIndex, arr);
  }

  const blocks: StitchBlock[] = [];
  let totalStitches = 0;
  const colors = [...byColor.keys()].sort((a, b) => a - b);

  for (const c of colors) {
    const objs = byColor.get(c)!;
    const block: StitchBlock = {
      colorIndex: c,
      rgb: objs[0].rgb,
      stitches: [],
    };
    if (opts.policy) {
      renderColorBlockWithPolicy(block, objs, ctx, opts.policy);
    } else {
      // Phase 1/2 互換経路: 各 object を独立に renderXxx → trim+jump 挿入
      for (const obj of objs) {
        const stitches = renderObjectByKind(obj, ctx);
        appendObjectStitches(block, stitches, c, trimThresholdMm);
      }
    }
    if (block.stitches.length > 0) {
      blocks.push(block);
      totalStitches += block.stitches.filter(
        (s) => s.kind === "run" || s.kind === "satin" || s.kind === "fill",
      ).length;
    }
  }

  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    prev.stitches.push({
      x: prev.stitches[prev.stitches.length - 1]?.x ?? 0,
      y: prev.stitches[prev.stitches.length - 1]?.y ?? 0,
      kind: "stop",
      colorIndex: prev.colorIndex,
    });
  }

  return {
    widthMm: design.widthMm,
    heightMm: design.heightMm,
    blocks,
    totalStitches,
  };
}

function renderObjectByKind(
  obj: EmbroideryObject,
  ctx: RenderContext,
): Stitch[] {
  if (obj.kind === "run") return renderRun(obj, ctx);
  if (obj.kind === "satin") return renderSatin(obj, ctx);
  return renderFill(obj, ctx);
}

/**
 * Phase 3 §5 policy 経路: 同色 block 内で連続 object 間を `connectObjects` で繋ぎ、
 * travel-run 連結時は前 object の tie-off と次 object の tie-in を抑制する。
 *
 * 抑制方式: 各 object の renderer に opts.suppressTieIn/suppressTieOff を per-object に
 * 注入する 2-pass 構造 (pass 1: 連結モード計算、pass 2: 抑制フラグ付きで render)。
 */
function renderColorBlockWithPolicy(
  block: StitchBlock,
  objs: EmbroideryObject[],
  ctx: RenderContext,
  policy: TrimPolicy,
): void {
  if (objs.length === 0) return;

  // Pass 1 (dry run): tie-in/off 抑制なしで一旦 render し、各 object の実際の
  //   first/last stitch 座標を取得する。outer 頂点近似は精度不足のため、
  //   実 renderer の出力位置で隣接 pair 距離を判定する必要がある。
  const dryRuns = objs.map((obj) =>
    renderObjectByKind(obj, {
      opts: { ...ctx.opts, suppressTieIn: false, suppressTieOff: false },
    }),
  );

  // Pass 2: 隣接 pair の距離をもとに travel-run / jump / trim+jump を決定。
  const isTravelRunToNext: boolean[] = new Array(objs.length).fill(false);
  for (let i = 0; i < objs.length - 1; i++) {
    const prevStitches = dryRuns[i];
    const nextStitches = dryRuns[i + 1];
    if (prevStitches.length === 0 || nextStitches.length === 0) continue;
    const prev = prevStitches[prevStitches.length - 1];
    const next = nextStitches[0];
    const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
    isTravelRunToNext[i] = dist < policy.travelRunUntilMm;
  }

  // Pass 3: 抑制フラグが必要な object だけ再 render、他は dry-run 結果を再利用。
  //   suppressTieIn/Off の有無で stitch 列が変わるため、フラグが立つ object は
  //   個別に renderObjectByKind を再呼びする (コスト ~2× だが PR15 では許容)。
  for (let i = 0; i < objs.length; i++) {
    const obj = objs[i];
    const suppressTieIn = i > 0 && isTravelRunToNext[i - 1];
    const suppressTieOff = i < objs.length - 1 && isTravelRunToNext[i];
    let stitches: Stitch[];
    if (suppressTieIn || suppressTieOff) {
      stitches = renderObjectByKind(obj, {
        opts: { ...ctx.opts, suppressTieIn, suppressTieOff },
      });
    } else {
      stitches = dryRuns[i];
    }
    if (stitches.length === 0) continue;
    if (block.stitches.length > 0) {
      const prev = block.stitches[block.stitches.length - 1];
      const first = stitches[0];
      const connect = connectObjects(
        [prev.x, prev.y],
        [first.x, first.y],
        obj.colorIndex,
        policy,
      );
      for (const s of connect) block.stitches.push(s);
    }
    for (const s of stitches) block.stitches.push(s);
  }
}

/**
 * 旧 API。内部で `buildObjects` → `renderDesign` に委譲する。
 * fabric は呼び出し側 (`compose.ts`) で `config.fabric` から導出して渡す。
 * 現状の renderDesign は RenderOptions の数値パラメータで描画するため fabric の
 * 中身は `buildObjects` 経由の `EmbroideryObject.props` (underlay 等) にのみ影響するが、
 * Phase 2 で underlay rendering が入った時点で fabric が rendering 側にも届くよう
 * StitchInput.fabric を経由させておく。
 */
export function generateStitches(input: StitchInput): StitchPattern {
  const {
    regions,
    fabric,
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    stitchDensityMm,
    satinMaxWidthMm,
    runMaxWidthMm = DEFAULT_RUN_MAX_WIDTH_MM,
    maxStitchMm = DEFAULT_MAX_STITCH_MM,
    trimThresholdMm = DEFAULT_TRIM_THRESHOLD_MM,
    fillAngleDeg = DEFAULT_FILL_ANGLE_DEG,
    fillAngleByColorIndex,
    fillStrategy = "global-angle",
    shapeStrategyMinAspect = DEFAULT_SHAPE_STRATEGY_MIN_ASPECT,
    disableUnderlay,
    disableCompensation,
    disableLockstitch,
  } = input;

  const objects = buildObjects({
    regions,
    widthMm,
    widthPx,
    fabric,
    runMaxWidthMm,
    satinMaxWidthMm,
    satinMinAspectRatio: SATIN_MIN_ASPECT_RATIO,
  });
  const design: EmbroideryDesign = {
    widthMm,
    heightMm,
    fabric,
    objects,
  };
  const opts: RenderOptions = {
    widthMm,
    heightMm,
    widthPx,
    stitchDensityMm,
    satinMaxWidthMm,
    runMaxWidthMm,
    maxStitchMm,
    trimThresholdMm,
    fillAngleDeg,
    fillAngleByColorIndex,
    fillStrategy,
    shapeStrategyMinAspect,
    fabric,
    disableUnderlay,
    disableCompensation,
    disableLockstitch,
  };
  return renderDesign(design, opts);
}

/**
 * renderer から返ってきた 1 オブジェクト分の Stitch[] を block 末尾に追加する。
 * block に既存 stitches があれば、前 object の last 点と新 object の先頭点との間に
 * 必ず jump (必要なら trim も) を挿入する。これは original generateStitches で
 * 「次 shape の first appendStitchesWithJumps が forceJumpAtStart=true で
 *  動いていた挙動」を bridge レベルで再現するもの。
 */
function appendObjectStitches(
  block: StitchBlock,
  stitches: Stitch[],
  colorIndex: number,
  trimThresholdMm: number,
): void {
  if (stitches.length === 0) return;
  if (block.stitches.length > 0) {
    const prev = block.stitches[block.stitches.length - 1];
    const first = stitches[0];
    const dist = distance(prev.x, prev.y, first.x, first.y);
    if (dist > trimThresholdMm) {
      block.stitches.push({
        x: prev.x,
        y: prev.y,
        kind: "trim",
        colorIndex,
      });
    }
    block.stitches.push({
      x: first.x,
      y: first.y,
      kind: "jump",
      colorIndex,
    });
  }
  block.stitches.push(...stitches);
}

function appendStitchesWithJumps(
  block: StitchBlock,
  pts: Point[],
  kind: StitchKind,
  colorIndex: number,
  maxStitchMm: number,
  trimThresholdMm: number,
  forceJumpAtStart = false,
) {
  if (pts.length === 0) return;
  const prev = block.stitches[block.stitches.length - 1];
  const dist = prev
    ? distance(prev.x, prev.y, pts[0][0], pts[0][1])
    : 0;
  const needJump =
    prev !== undefined && (forceJumpAtStart || dist > maxStitchMm);

  let lastX: number;
  let lastY: number;

  if (needJump && prev) {
    // 渡り糸が長い場合は jump 前に trim を挿入して、糸切り対応機種で確実に切る。
    // trim 自体は座標を進めず、現在位置 (prev) で「糸を切る」コマンドとして扱われる。
    if (dist > trimThresholdMm) {
      block.stitches.push({
        x: prev.x,
        y: prev.y,
        kind: "trim",
        colorIndex,
      });
    }
    // jump は pts[0] への移動そのもの。針位置を pts[0] に進める。
    block.stitches.push({
      x: pts[0][0],
      y: pts[0][1],
      kind: "jump",
      colorIndex,
    });
    // lastX/Y を pts[0] に揃えることで、ループ最初の pts[0] 処理は d=0 となり、
    // prev → pts[0] のギャップに kind 縫い目が細分化されて挿入されない。
    // 一方で pts[0] 自体は STITCH として 1 点 push されるため、JUMP 後の
    // セグメント開始点 (scanline の pa など) がアンカーとして刺繍ファイルに記録される。
    lastX = pts[0][0];
    lastY = pts[0][1];
  } else {
    lastX = prev?.x ?? pts[0][0];
    lastY = prev?.y ?? pts[0][1];
  }

  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const d = distance(lastX, lastY, x, y);
    if (d > maxStitchMm) {
      const segs = Math.ceil(d / maxStitchMm);
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const ix = lastX + (x - lastX) * t;
        const iy = lastY + (y - lastY) * t;
        block.stitches.push({ x: ix, y: iy, kind, colorIndex });
      }
    } else {
      block.stitches.push({ x, y, kind, colorIndex });
    }
    lastX = x;
    lastY = y;
  }
}

function resolveShapeFillAngle(
  colorOverride: number | undefined,
  strategy: FillStrategy,
  globalAngleDeg: number,
  longAxis: Point,
  aspectRatio: number,
  minAspect: number,
): number {
  if (colorOverride !== undefined) return colorOverride;
  if (strategy === "global-angle") return globalAngleDeg;
  if (aspectRatio < minAspect) return globalAngleDeg;
  const longRad = Math.atan2(longAxis[1], longAxis[0]);
  const longDeg = (longRad * 180) / Math.PI;
  return strategy === "shape-long-axis" ? longDeg : longDeg + 90;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

// analyzeShape / computeAspectRatio は ./geometry に移動済み。
// __internal 経由でテストから参照されているため、re-export を維持する。

export function resamplePolyline(polyline: Polygon, densityMm: number): Point[] {
  if (polyline.length === 0) return [];
  const closed = polyline.concat([polyline[0]]);
  const out: Point[] = [closed[0]];
  let acc = 0;
  for (let i = 1; i < closed.length; i++) {
    const [x0, y0] = closed[i - 1];
    const [x1, y1] = closed[i];
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    if (segLen === 0) continue;
    let remaining = segLen;
    let cx = x0;
    let cy = y0;
    while (acc + remaining >= densityMm) {
      const t = (densityMm - acc) / remaining;
      cx = cx + (x1 - cx) * t;
      cy = cy + (y1 - cy) * t;
      out.push([cx, cy]);
      remaining = Math.hypot(x1 - cx, y1 - cy);
      acc = 0;
    }
    acc += remaining;
  }
  return out;
}

function satinStitches(
  polygon: Polygon,
  densityMm: number,
  longAxis: Point,
  center: Point,
): Point[] {
  const shortAxis: Point = [-longAxis[1], longAxis[0]];
  let minL = Infinity;
  let maxL = -Infinity;
  for (const [x, y] of polygon) {
    const l = (x - center[0]) * longAxis[0] + (y - center[1]) * longAxis[1];
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }

  const out: Point[] = [];
  const steps = Math.max(2, Math.ceil((maxL - minL) / densityMm));
  let side = 0;
  for (let i = 0; i <= steps; i++) {
    const l = minL + ((maxL - minL) * i) / steps;
    const ox = center[0] + longAxis[0] * l;
    const oy = center[1] + longAxis[1] * l;
    const crossings = intersectScanline([polygon], ox, oy, shortAxis);
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    const a = crossings[0];
    const b = crossings[crossings.length - 1];
    const pa: Point = [ox + shortAxis[0] * a, oy + shortAxis[1] * a];
    const pb: Point = [ox + shortAxis[0] * b, oy + shortAxis[1] * b];
    if (side === 0) {
      out.push(pa, pb);
      side = 1;
    } else {
      out.push(pb, pa);
      side = 0;
    }
  }
  return out;
}

/**
 * 穴を抜いた fill ステッチを「セグメント配列」として返す。
 * 各セグメントは穴を跨がない 1 区間の塗り (= 2 点で表現)。
 * セグメント境界には呼び出し側で必ず jump を挿入する想定なので、
 * 穴跨ぎ部分も scanline 行間遷移もまとめて jump 扱いになる。
 */
function fillStitches(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
): Point[][] {
  const rad = (angleDeg * Math.PI) / 180;
  const dir: Point = [Math.cos(rad), Math.sin(rad)];
  const perp: Point = [-dir[1], dir[0]];

  // バウンディングは外形だけで十分
  let minS = Infinity;
  let maxS = -Infinity;
  for (const [x, y] of shape.outer) {
    const s = x * perp[0] + y * perp[1];
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }

  const rings: Polygon[] = [shape.outer, ...shape.holes];
  const segments: Point[][] = [];
  let line = 0;
  for (let s = minS; s <= maxS; s += densityMm) {
    const ox = perp[0] * s;
    const oy = perp[1] * s;
    const crossings = intersectScanline(rings, ox, oy, dir);
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    if (crossings.length % 2 !== 0) crossings.pop();
    if (line % 2 === 0) {
      for (let i = 0; i < crossings.length; i += 2) {
        const a = crossings[i];
        const b = crossings[i + 1];
        segments.push([
          [ox + dir[0] * a, oy + dir[1] * a],
          [ox + dir[0] * b, oy + dir[1] * b],
        ]);
      }
    } else {
      for (let i = crossings.length - 2; i >= 0; i -= 2) {
        const a = crossings[i + 1];
        const b = crossings[i];
        segments.push([
          [ox + dir[0] * a, oy + dir[1] * a],
          [ox + dir[0] * b, oy + dir[1] * b],
        ]);
      }
    }
    line++;
  }
  return segments;
}

// intersectScanline は ./scanline.ts に切り出して両方から import するよう変更
// (PR12 で render → underlay の依存が入っても循環を避けるための配置)。

/** Stitch を作るユーティリティ (テスト用) */
export function makeStitch(
  x: number,
  y: number,
  kind: StitchKind,
  colorIndex: number,
): Stitch {
  return { x, y, kind, colorIndex };
}

/** PCA 結果を test 用に export */
export const __internal = {
  analyzeShape,
  computeAspectRatio,
  fillStitches,
  tatamiBrick,
  satinStitches,
  intersectScanline,
  appendStitchesWithJumps,
  resolveShapeFillAngle,
};
