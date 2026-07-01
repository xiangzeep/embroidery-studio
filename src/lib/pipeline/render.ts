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
import { routeFillSegmentsSafely, tatamiBrick } from "./fill";
import { medialAxisRunSegments } from "./run";
import { beanStitchPolyline } from "./bean-stitch";
import { renderCurvedStrokeSatin } from "./curved-satin";
import { brickSplit, estimateSatinWidthStats, extractRails, renderSatin2Rail } from "./satin";
import { generateUnderlayStitches } from "./underlay";
import type { TrimPolicy } from "./policy";
import { isSafeTravelBetweenObjects } from "./safe-travel";
import type { DigitizingMode, OutlineFontStrategy } from "./config";
import { photoRandomFill } from "./fill";

export type { TrimPolicy } from "./policy";


const SATIN_MIN_ASPECT_RATIO = 4;
const DEFAULT_MAX_STITCH_MM = 7;
const DEFAULT_TRIM_THRESHOLD_MM = 8;
const DEFAULT_RUN_MAX_WIDTH_MM = 0.6;
const DEFAULT_THIN_RUN_STITCH_MM = 1.4;
const DEFAULT_THIN_RUN_STITCH_MULTIPLIER = 3.5;
const MAX_THIN_RUN_STITCH_MM = 2.2;
const DEFAULT_BEAN_RUN_STITCH_MM = 1.0;
const DEFAULT_BEAN_RUN_STITCH_MULTIPLIER = 2.5;
const MAX_BEAN_RUN_STITCH_MM = 1.6;
const STRICT_RUN_TRAVEL_THRESHOLD_MM = 2;
const STRICT_RUN_TRIM_THRESHOLD_MM = 4;
const DEFAULT_FILL_ANGLE_DEG = 45;
const DEFAULT_SHAPE_STRATEGY_MIN_ASPECT = 1.5;

export type StitchInput = {
  regions: ColorRegion[];
  digitizingMode?: DigitizingMode;
  outlineFontStrategy?: OutlineFontStrategy;
  /** English note. */
  fabric: FabricProfile;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  stitchDensityMm: number;
  satinMaxWidthMm: number;
  runMaxWidthMm?: number;
  maxStitchMm?: number;
  /** English note. */
  trimThresholdMm?: number;
  /** English note. */
  fillAngleDeg?: number;
  /**
   * English note.
   * English note.
   * English note.
   */
  fillAngleByColorIndex?: Record<number, number>;
  /**
   * English note.
   * English note.
   * English note.
   * English note.
   * English note.
   * English note.
   */
  fillStrategy?: FillStrategy;
  /**
   * English note.
   * English note.
   */
  shapeStrategyMinAspect?: number;
  /** English note. */
  disableUnderlay?: boolean;
  /** English note. */
  disableCompensation?: boolean;
  /** English note. */
  disableLockstitch?: boolean;
};

export type FillStrategy =
  | "global-angle"
  | "shape-long-axis"
  | "shape-cross-axis";

/**
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
export type RenderOptions = {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  digitizingMode?: DigitizingMode;
  outlineFontStrategy?: OutlineFontStrategy;
  stitchDensityMm: number;
  satinMaxWidthMm: number;
  runMaxWidthMm?: number;
  maxStitchMm?: number;
  trimThresholdMm?: number;
  fillAngleDeg?: number;
  fillAngleByColorIndex?: Record<number, number>;
  fillStrategy?: FillStrategy;
  shapeStrategyMinAspect?: number;
  /** English note. */
  fabric?: FabricProfile;
  /** English note. */
  disableUnderlay?: boolean;
  /** English note. */
  disableCompensation?: boolean;
  /** English note. */
  disableLockstitch?: boolean;
  /**
    */
  disableAutoSplit?: boolean;
  /**
    */
  disableMedialAxis?: boolean;
  /** English note. */
  policy?: TrimPolicy;
  /** English note. */
  suppressTieIn?: boolean;
  /** English note. */
  suppressTieOff?: boolean;
  preferredEntry?: Point;
};

/** English note. */
export type RenderContext = {
  opts: RenderOptions;
};

type Point = [number, number];
type Polygon = Point[];

/**
 * English note.
 * English note.
 * English note.
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
 * English note.
 * English note.
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
 * English note.
 * English note.
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
  // English note.
  // English note.
  const runStitchLenMm = resolveRunStitchLength(obj, ctx);
  let segments: Point[][] = ctx.opts.disableMedialAxis
    ? []
    : medialAxisRunSegments(obj.shape, runStitchLenMm);
  if (segments.length === 0 && (ctx.opts.disableMedialAxis || !strictRunObject(obj))) {
    const fallback = resamplePolyline(
      obj.shape.outer as Polygon,
      runStitchLenMm,
    );
    if (fallback.length > 0) segments = [fallback];
  }
  if (segments.length === 0) return block.stitches;
  const maxStitchMm = ctx.opts.maxStitchMm ?? DEFAULT_MAX_STITCH_MM;
  const trimThresholdMm = strictRunObject(obj)
    ? Math.min(ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM, STRICT_RUN_TRIM_THRESHOLD_MM)
    : ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;
  for (const segment of orientRunSegments(segments, ctx.opts.preferredEntry)) {
    let pts = segment;
    if (obj.strokeKind === "bean-run") {
      pts = beanStitchPolyline(
        pts,
        maxStitchMm,
      );
    }
    appendStitchesWithJumps(
      block,
      pts,
      "run",
      obj.colorIndex,
      maxStitchMm,
      trimThresholdMm,
      true,
    );
  }
  return block.stitches;
}

function resolveRunStitchLength(
  obj: EmbroideryObject,
  ctx: RenderContext,
): number {
  const base = ctx.opts.stitchDensityMm;
  if (obj.strokeKind === "thin-run") {
    return clampRunStitchLength(
      Math.max(base * DEFAULT_THIN_RUN_STITCH_MULTIPLIER, DEFAULT_THIN_RUN_STITCH_MM),
      obj.props.maxStitchMm ?? DEFAULT_MAX_STITCH_MM,
      MAX_THIN_RUN_STITCH_MM,
    );
  }
  if (obj.strokeKind === "bean-run") {
    return clampRunStitchLength(
      Math.max(base * DEFAULT_BEAN_RUN_STITCH_MULTIPLIER, DEFAULT_BEAN_RUN_STITCH_MM),
      obj.props.maxStitchMm ?? DEFAULT_MAX_STITCH_MM,
      MAX_BEAN_RUN_STITCH_MM,
    );
  }
  return base;
}

function clampRunStitchLength(
  stitchLenMm: number,
  maxStitchMm: number,
  modeCapMm: number,
): number {
  return Math.min(Math.max(stitchLenMm, 0.1), Math.min(maxStitchMm, modeCapMm));
}

function orientPolylineToPreferredEntry(
  pts: Point[],
  preferredEntry: Point | undefined,
): Point[] {
  if (!preferredEntry || pts.length < 2) return pts;
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const d = distance(pt[0], pt[1], preferredEntry[0], preferredEntry[1]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  if (bestIndex === 0) return pts;
  return pts.slice(bestIndex).concat(pts.slice(0, bestIndex));
}

function orientRunSegments(
  segments: Point[][],
  preferredEntry: Point | undefined,
): Point[][] {
  const remaining = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.map(([x, y]) => [x, y] as Point));
  const oriented: Point[][] = [];

  if (remaining.length === 0) return oriented;
  const first = remaining.shift() as Point[];
  const firstOriented = orientPolylineToPreferredEntry(first, preferredEntry);
  oriented.push(firstOriented);
  let cursor = firstOriented[firstOriented.length - 1];

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestReverse = false;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const segment = remaining[i];
      const start = segment[0];
      const end = segment[segment.length - 1];
      const startDistance = distance(cursor[0], cursor[1], start[0], start[1]);
      const endDistance = distance(cursor[0], cursor[1], end[0], end[1]);
      if (startDistance < bestDistance) {
        bestDistance = startDistance;
        bestIndex = i;
        bestReverse = false;
      }
      if (endDistance < bestDistance) {
        bestDistance = endDistance;
        bestIndex = i;
        bestReverse = true;
      }
    }
    const [segment] = remaining.splice(bestIndex, 1);
    const next = bestReverse ? segment.slice().reverse() : segment;
    oriented.push(next);
    cursor = next[next.length - 1];
  }

  return oriented;
}

function strictRunObject(obj: EmbroideryObject): boolean {
  if (obj.kind !== "run") return false;
  if (obj.strokeKind === "thin-run" || obj.strokeKind === "bean-run") return true;
  return obj.strokeMetrics?.isStrokeLike === true;
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
    // English note.
    const { longAxis, center } = analyzeShape(outer);
    pts = satinStitches(outer, ctx.opts.stitchDensityMm, longAxis, center);
  } else if (obj.strokeKind === "narrow-satin") {
    pts = renderCurvedStrokeSatin(
      obj.shape,
      ctx.opts.stitchDensityMm,
      maxStitchMm,
      ctx.opts.preferredEntry,
    );
    if (pts.length === 0) {
      return renderRunTopOnly(
        { ...obj, kind: "run", strokeKind: "thin-run" },
        ctx,
      );
    }
  } else {
    // Current satin flow: 2-rail satin plus brick auto-split.
    const rails = extractRails(obj.shape);
    const widthStats = estimateSatinWidthStats(rails);
    if (widthStats.maxWidthMm > ctx.opts.satinMaxWidthMm) {
      return renderFillTopOnly(obj, ctx);
    }
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
 * English note.
 * English note.
 * English note.
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
  const photoSegments = photoRandomFill(
    obj.shape,
    ctx.opts.stitchDensityMm,
    shapeAngleDeg,
    maxStitchMm,
    obj.order + obj.colorIndex * 101 + 17,
  );
  const routedSegments = ctx.opts.digitizingMode === "photo-stitch"
    ? photoSegments
    : segments;
  const trimThresholdMm =
    ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;
  block.stitches.push(...routeFillSegmentsSafely({
    shape: obj.shape,
    segments: routedSegments,
    colorIndex: obj.colorIndex,
    kind: "fill",
    maxStitchMm,
    trimThresholdMm,
  }));
  return block.stitches;
}

/**
 * English note.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
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
  const maxStitchMm = ctx.opts.maxStitchMm ?? DEFAULT_MAX_STITCH_MM;
  const trimThresholdMm = ctx.opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;
  if (ctx.opts.disableLockstitch || obj.props.lockstitch === false) {
    return joinStitchSections([underlay, top], obj.colorIndex, maxStitchMm, trimThresholdMm);
  }
  // English note.
  // English note.
  // English note.
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
  return joinStitchSections([underlay, tieIn, top, tieOff], obj.colorIndex, maxStitchMm, trimThresholdMm);
}

function joinStitchSections(
  sections: Stitch[][],
  colorIndex: number,
  maxStitchMm: number,
  trimThresholdMm: number,
): Stitch[] {
  const out: Stitch[] = [];
  for (const section of sections) {
    if (section.length === 0) continue;
    if (out.length > 0) {
      const prev = out[out.length - 1];
      const first = section[0];
      const dist = distance(prev.x, prev.y, first.x, first.y);
      if (dist > maxStitchMm) {
        if (dist > trimThresholdMm) {
          out.push({ x: prev.x, y: prev.y, kind: "trim", colorIndex });
        }
        out.push({ x: first.x, y: first.y, kind: "jump", colorIndex });
      }
    }
    out.push(...section);
  }
  return out;
}

/**
 * English note.
 * English note.
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
 * English note.
 *
 *   - distance < `policy.travelRunUntilMm` -> one stitch (kind="run", coordinate=nextEntry)
 *   - `travelRunUntilMm` <= distance < `trimThresholdMm` -> one stitch (kind="jump", coordinate=nextEntry)
 *   - 距离 >= `trimThresholdMm`                  → 2 stitch (kind="trim" @prevExit, kind="jump" @nextEntry)
 *
 * English note.
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

export function connectObjectsWithSafety(
  prevObj: EmbroideryObject,
  nextObj: EmbroideryObject,
  prevExit: Point,
  nextEntry: Point,
  nextColorIndex: number,
  policy: TrimPolicy,
): Stitch[] {
  if (strictRunObject(prevObj) || strictRunObject(nextObj)) {
    const closedLoopTravel = closedRunLoopObject(prevObj) || closedRunLoopObject(nextObj);
    return connectObjects(prevExit, nextEntry, nextColorIndex, {
      ...policy,
      travelRunUntilMm: closedLoopTravel ? 0 : Math.min(policy.travelRunUntilMm, STRICT_RUN_TRAVEL_THRESHOLD_MM),
      trimThresholdMm: Math.min(policy.trimThresholdMm, STRICT_RUN_TRIM_THRESHOLD_MM),
    });
  }

  const safe = isSafeTravelBetweenObjects({
    fromObject: prevObj,
    toObject: nextObj,
    from: prevExit,
    to: nextEntry,
  });
  if (safe) {
    return connectObjects(prevExit, nextEntry, nextColorIndex, {
      ...policy,
      travelRunUntilMm: Math.max(policy.travelRunUntilMm, policy.trimThresholdMm),
    });
  }
  return connectObjects(prevExit, nextEntry, nextColorIndex, {
    ...policy,
    travelRunUntilMm: 0,
  });
}

function closedRunLoopObject(obj: EmbroideryObject): boolean {
  if (!strictRunObject(obj)) return false;
  return (obj.strokeMetrics?.loopCount ?? 0) > 0 || obj.shape.holes.length > 0;
}

/**
 * English note.
 * English note.
 * English note.
 * English note.
 */
export function renderDesign(
  design: EmbroideryDesign,
  opts: RenderOptions,
): StitchPattern {
  const ctx: RenderContext = { opts };
  const trimThresholdMm =
    opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;

  // English note.
  // English note.
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
      // English note.
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
 * English note.
 * English note.
 *
 * English note.
 * English note.
 */
function renderColorBlockWithPolicy(
  block: StitchBlock,
  objs: EmbroideryObject[],
  ctx: RenderContext,
  policy: TrimPolicy,
): void {
  if (objs.length === 0) return;

  // English note.
  // English note.
  // English note.
  const dryRuns = objs.map((obj) =>
    renderObjectByKind(obj, {
      opts: { ...ctx.opts, suppressTieIn: false, suppressTieOff: false },
    }),
  );

  // English note.
  const isTravelRunToNext: boolean[] = new Array(objs.length).fill(false);
  for (let i = 0; i < objs.length - 1; i++) {
    const prevStitches = dryRuns[i];
    const nextStitches = dryRuns[i + 1];
    if (prevStitches.length === 0 || nextStitches.length === 0) continue;
    const prev = prevStitches[prevStitches.length - 1];
    const next = nextStitches[0];
    const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
    isTravelRunToNext[i] =
      dist < policy.travelRunUntilMm &&
      isSafeTravelBetweenObjects({
        fromObject: objs[i],
        toObject: objs[i + 1],
        from: [prev.x, prev.y],
        to: [next.x, next.y],
      });
  }

  // English note.
  // English note.
  // English note.
  let previousRenderedObject: EmbroideryObject | null = null;
  for (let i = 0; i < objs.length; i++) {
    const obj = objs[i];
    const suppressTieIn = i > 0 && isTravelRunToNext[i - 1];
    const suppressTieOff = i < objs.length - 1 && isTravelRunToNext[i];
    const previous = block.stitches[block.stitches.length - 1];
    const preferredEntry: Point | undefined = previous
      ? [previous.x, previous.y]
      : undefined;
    let stitches: Stitch[];
    if (suppressTieIn || suppressTieOff || preferredEntry) {
      stitches = renderObjectByKind(obj, {
        opts: { ...ctx.opts, suppressTieIn, suppressTieOff, preferredEntry },
      });
    } else {
      stitches = dryRuns[i];
    }
    if (stitches.length === 0) continue;
    if (block.stitches.length > 0) {
      const prev = block.stitches[block.stitches.length - 1];
      const first = stitches[0];
      const connect = previousRenderedObject
        ? connectObjectsWithSafety(
          previousRenderedObject,
          obj,
          [prev.x, prev.y],
          [first.x, first.y],
          obj.colorIndex,
          policy,
        )
        : connectObjects(
        [prev.x, prev.y],
        [first.x, first.y],
        obj.colorIndex,
        policy,
        );
      for (const s of connect) block.stitches.push(s);
    }
    for (const s of stitches) block.stitches.push(s);
    previousRenderedObject = obj;
  }
}

/**
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
 */
export function generateStitches(input: StitchInput): StitchPattern {
  const {
    regions,
    fabric,
    digitizingMode = "line-art",
    outlineFontStrategy = "auto",
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
    heightPx,
    fabric,
    digitizingMode,
    outlineFontStrategy,
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
    digitizingMode,
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
 * English note.
 * English note.
 * English note.
 * English note.
 * English note.
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
    // English note.
    // English note.
    if (dist > trimThresholdMm) {
      block.stitches.push({
        x: prev.x,
        y: prev.y,
        kind: "trim",
        colorIndex,
      });
    }
    // English note.
    block.stitches.push({
      x: pts[0][0],
      y: pts[0][1],
      kind: "jump",
      colorIndex,
    });
    // English note.
    // English note.
    // English note.
    // English note.
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

// English note.
// English note.

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
 * English note.
 * English note.
 * English note.
 * English note.
 */
function fillStitches(
  shape: Shape,
  densityMm: number,
  angleDeg: number,
): Point[][] {
  const rad = (angleDeg * Math.PI) / 180;
  const dir: Point = [Math.cos(rad), Math.sin(rad)];
  const perp: Point = [-dir[1], dir[0]];

  // English note.
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

// English note.
// English note.

/** English note. */
export function makeStitch(
  x: number,
  y: number,
  kind: StitchKind,
  colorIndex: number,
): Stitch {
  return { x, y, kind, colorIndex };
}

/** English note. */
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
