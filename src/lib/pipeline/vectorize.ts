import type { Point2D, Polygon, Shape } from "./types";

// imagetracerjs は型定義なしの CommonJS パッケージ
// @ts-expect-error -- no @types provided
import ImageTracer from "imagetracerjs";

type ImageTracerLike = {
  imagedataToSVG: (
    imgd: ImageData,
    options: Record<string, unknown>,
  ) => string;
};

const tracer = ImageTracer as unknown as ImageTracerLike;

export type VectorizeInput = {
  labels: Uint8Array;
  width: number;
  height: number;
  palette: Array<[number, number, number]>;
  turdsize?: number;
  alphamax?: number;
  opttolerance?: number;
  /**
   * 各色レイヤーの 2 値マスクをトレース前に何 px 膨張させるか。
   * 隣接色のレイヤー境界が pull gap で開かないように、互いに重ねるための補正。
   * 0 で無効、1〜2 が現実的な値。
   */
  dilatePx?: number;
};

export type ColorRegion = {
  colorIndex: number;
  rgb: [number, number, number];
  svgPath: string;
  /** imagetracerjs の <path> 単位で構造化された領域群 (外形 + 穴) */
  shapes: Shape[];
  /**
   * @deprecated 後方互換のために残す。Phase 2 で消す予定。
   *   外形・穴をフラットに並べた配列。
   */
  polygons: Polygon[];
};

export interface Tracer {
  /** マスク画像から path の d 属性文字列を 1 つ以上返す */
  trace(mask: ImageData, opts: TracerOptions): Promise<string[]>;
}

export type TracerOptions = {
  turdsize: number;
  alphamax: number;
  opttolerance: number;
};

/**
 * imagetracerjs (MIT, pure JS) で 2 値マスクをトレースする。
 * esm-potrace-wasm は WASM heap 固定で大きい画像でメモリ範囲外エラーになるため不採用。
 *
 * imagedataToSVG の出力は:
 *   <path desc="..." fill="rgb(R,G,B)" stroke="..." ... d="M ... Z" />
 * fill 色が黒寄りのパスだけマスク領域として採用する。
 */
const defaultTracer: Tracer = {
  async trace(mask, opts) {
    const svg = tracer.imagedataToSVG(mask, {
      numberofcolors: 2,
      colorsampling: 0,
      pathomit: opts.turdsize,
      ltres: 1,
      qtres: 1,
      strokewidth: 0,
      linefilter: false,
      roundcoords: 1,
      scale: 1,
    });
    const dList: string[] = [];
    const re =
      /<path[^>]*\bfill="rgb\((\d+),(\d+),(\d+)\)"[^>]*\bd="([^"]+)"/g;
    for (const m of svg.matchAll(re)) {
      const r = +m[1];
      const g = +m[2];
      const b = +m[3];
      if (r + g + b < 384) dList.push(m[4]);
    }
    return dList;
  },
};

export async function vectorize(
  input: VectorizeInput,
  tracer: Tracer = defaultTracer,
): Promise<ColorRegion[]> {
  const {
    labels,
    width,
    height,
    palette,
    turdsize = 8,
    alphamax = 1,
    opttolerance = 0.2,
    dilatePx = 0,
  } = input;
  const regions: ColorRegion[] = [];

  for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
    const mask = buildMask(labels, width, height, colorIndex, dilatePx);
    if (mask === null) continue;

    const dList = await tracer.trace(mask, { turdsize, alphamax, opttolerance });

    // imagetracerjs は「外形 + 直接の穴」を 1 つの <path> にまとめ、
    // 穴の中の島はさらに別の <path> として独立出力する仕様。
    // そのため per-color レイヤー全体のサブパスを集めて深さで再分類する必要がある:
    //   深さ 0/2/... = 塗る領域 (outer)、深さ 1/3/... = 穴 (hole)。
    const allSubs: Polygon[] = [];
    for (const d of dList) {
      const subs = parsePathD(d);
      allSubs.push(...subs);
    }
    if (allSubs.length === 0) continue;

    const shapes = buildShapesByContainment(allSubs);
    if (shapes.length === 0) continue;

    const flatPolys: Polygon[] = [];
    for (const s of shapes) flatPolys.push(s.outer, ...s.holes);

    regions.push({
      colorIndex,
      rgb: palette[colorIndex],
      svgPath: dList.join(" "),
      shapes,
      polygons: flatPolys,
    });
  }

  return regions;
}

/** 符号付き面積（>0: CCW, <0: CW, 0: 退化）。 */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** 点 p がポリゴン内にあるか（even-odd / ray casting）。 */
export function pointInPolygon(p: Point2D, poly: Polygon): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** A が B に完全に内包されるか（代表点で判定）。 */
function isInside(inner: Polygon, outer: Polygon): boolean {
  if (inner.length === 0) return false;
  return pointInPolygon(inner[0], outer);
}

/** Shape の全ての穴が外形に内包されているか。 */
export function holesAreInsideOuter(shape: Shape): boolean {
  return shape.holes.every((h) => isInside(h, shape.outer));
}

/**
 * 包含グラフを構築し、深さ偶数を outer・奇数を直近 outer の hole として再構成。
 * 想定: 1 つの <path> 内に複数の連結成分があるケース、または出力規約が崩れた異常系。
 */
export function buildShapesByContainment(subs: Polygon[]): Shape[] {
  const n = subs.length;
  const depth = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  const absArea = subs.map((s) => Math.abs(signedArea(s)));

  for (let i = 0; i < n; i++) {
    let bestParent = -1;
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (isInside(subs[i], subs[j])) {
        depth[i]++;
        if (absArea[j] < bestArea) {
          bestArea = absArea[j];
          bestParent = j;
        }
      }
    }
    parent[i] = bestParent;
  }

  const shapes: Shape[] = [];
  const outerIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      shapes.push({ outer: subs[i], holes: [] });
      outerIdx.push(i);
    }
  }
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 1) {
      const p = parent[i];
      const shapeIdx = outerIdx.indexOf(p);
      if (shapeIdx >= 0) shapes[shapeIdx].holes.push(subs[i]);
      // shapeIdx < 0 はあり得ない構造（孤立 hole）。捨てる。
    }
  }
  return shapes;
}

function buildMask(
  labels: Uint8Array,
  width: number,
  height: number,
  colorIndex: number,
  dilatePx: number,
): ImageData | null {
  const data = new Uint8ClampedArray(width * height * 4);
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    const match = labels[i] === colorIndex;
    if (match) count++;
    const v = match ? 0 : 255;
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  if (count === 0) return null;
  if (dilatePx > 0) dilateForegroundMask(data, width, height, dilatePx);
  return new ImageData(data, width, height);
}

/**
 * RGBA マスクの前景 (R=0) を 4-neighbor で `iterations` 回膨張させる。
 * imagetracerjs に渡す直前の補正なので、隣接色レイヤーが pull gap で開くのを防ぐ。
 */
export function dilateForegroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  iterations: number,
): void {
  const n = width * height;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = data[i * 4] === 0 ? 1 : 0;
  for (let k = 0; k < iterations; k++) {
    const next = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
      const yw = y * width;
      for (let x = 0; x < width; x++) {
        const i = yw + x;
        if (mask[i]) {
          next[i] = 1;
          continue;
        }
        if (
          (x > 0 && mask[i - 1]) ||
          (x + 1 < width && mask[i + 1]) ||
          (y > 0 && mask[i - width]) ||
          (y + 1 < height && mask[i + width])
        ) {
          next[i] = 1;
        }
      }
    }
    mask = next;
  }
  for (let i = 0; i < n; i++) {
    const v = mask[i] ? 0 : 255;
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
}

const BEZIER_SAMPLES = 8;

/** SVG path d 属性をパースして閉ポリゴン群を返す。Bezier は8分割で線形近似。 */
export function parsePathD(d: string): Polygon[] {
  const polygons: Polygon[] = [];
  let current: Polygon = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  const tokens = tokenize(d);
  let i = 0;
  let lastCmd = "";

  const pushPoint = (x: number, y: number) => {
    const last = current[current.length - 1];
    if (!last || last[0] !== x || last[1] !== y) current.push([x, y]);
    cx = x;
    cy = y;
  };

  const closeSub = () => {
    if (current.length >= 3) polygons.push(current);
    current = [];
  };

  while (i < tokens.length) {
    const t = tokens[i];
    let cmd: string;
    if (typeof t === "string") {
      cmd = t;
      i++;
    } else {
      cmd = lastCmd || "L";
    }
    lastCmd = cmd;
    const rel = cmd === cmd.toLowerCase();
    const u = cmd.toUpperCase();

    if (u === "M") {
      closeSub();
      const x = num(tokens, i++);
      const y = num(tokens, i++);
      const nx = rel ? cx + x : x;
      const ny = rel ? cy + y : y;
      startX = nx;
      startY = ny;
      pushPoint(nx, ny);
      lastCmd = rel ? "l" : "L";
    } else if (u === "L") {
      const x = num(tokens, i++);
      const y = num(tokens, i++);
      pushPoint(rel ? cx + x : x, rel ? cy + y : y);
    } else if (u === "H") {
      const x = num(tokens, i++);
      pushPoint(rel ? cx + x : x, cy);
    } else if (u === "V") {
      const y = num(tokens, i++);
      pushPoint(cx, rel ? cy + y : y);
    } else if (u === "C") {
      const x1 = num(tokens, i++);
      const y1 = num(tokens, i++);
      const x2 = num(tokens, i++);
      const y2 = num(tokens, i++);
      const x = num(tokens, i++);
      const y = num(tokens, i++);
      const p1x = rel ? cx + x1 : x1;
      const p1y = rel ? cy + y1 : y1;
      const p2x = rel ? cx + x2 : x2;
      const p2y = rel ? cy + y2 : y2;
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      sampleCubic(cx, cy, p1x, p1y, p2x, p2y, ex, ey, pushPoint);
    } else if (u === "Q") {
      const x1 = num(tokens, i++);
      const y1 = num(tokens, i++);
      const x = num(tokens, i++);
      const y = num(tokens, i++);
      const p1x = rel ? cx + x1 : x1;
      const p1y = rel ? cy + y1 : y1;
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      sampleQuadratic(cx, cy, p1x, p1y, ex, ey, pushPoint);
    } else if (u === "Z") {
      pushPoint(startX, startY);
      closeSub();
    } else {
      i++;
    }
  }
  closeSub();
  return polygons;
}

function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  for (const m of d.matchAll(re)) {
    if (m[1]) out.push(m[1]);
    else out.push(parseFloat(m[2]));
  }
  return out;
}

function num(tokens: Array<string | number>, i: number): number {
  const v = tokens[i];
  if (typeof v !== "number") throw new Error(`SVG path: expected number at ${i}`);
  return v;
}

function sampleCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  push: (x: number, y: number) => void,
) {
  for (let s = 1; s <= BEZIER_SAMPLES; s++) {
    const t = s / BEZIER_SAMPLES;
    const it = 1 - t;
    const x =
      it * it * it * x0 +
      3 * it * it * t * x1 +
      3 * it * t * t * x2 +
      t * t * t * x3;
    const y =
      it * it * it * y0 +
      3 * it * it * t * y1 +
      3 * it * t * t * y2 +
      t * t * t * y3;
    push(x, y);
  }
}

function sampleQuadratic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  push: (x: number, y: number) => void,
) {
  for (let s = 1; s <= BEZIER_SAMPLES; s++) {
    const t = s / BEZIER_SAMPLES;
    const it = 1 - t;
    const x = it * it * x0 + 2 * it * t * x1 + t * t * x2;
    const y = it * it * y0 + 2 * it * t * y1 + t * t * y2;
    push(x, y);
  }
}
