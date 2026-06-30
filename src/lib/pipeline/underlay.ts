// Underlay generation helpers.
// Local implementation status:
// English note.
// English note.
// English note.
// English note.
// English note.
// English note.

import type { EmbroideryObject, Point2D, Polygon, Shape, Stitch } from "./types";
import { analyzeShape } from "./geometry";
import { offsetPolygon } from "./polygon-offset";
import { intersectScanline } from "./scanline";
import { pointInPolygon } from "./vectorize";

const PX_PER_MM = 10; // English note.
const MIN_SKELETON_PIXELS = 12; // English note.
const MIN_AREA_MM2 = 0.25; // English note.
const DEFAULT_UNDERLAY_MAX_STITCH_MM = 7;
const DEFAULT_UNDERLAY_TRIM_THRESHOLD_MM = 8;

/**
 * Edge-run underlay for medium-width satin and fill objects.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 * English note.
 */
export function edgeRunUnderlay(
  shape: Shape,
  insetMm: number,
  stitchLenMm: number,
): Point2D[][] {
  if (insetMm <= 0 || stitchLenMm <= 0) return [];
  const outerOff = offsetPolygon(shape.outer, -insetMm);
  if (!outerOff || outerOff.length === 0) return [];
  const outerRing = pickLargest(outerOff);
  if (!outerRing) return [];

  const rings: Point2D[][] = [resampleClosedRing(outerRing, stitchLenMm)];
  for (const hole of shape.holes) {
    const holeOff = offsetPolygon(hole, +insetMm);
    if (!holeOff || holeOff.length === 0) continue;
    const ring = pickLargest(holeOff);
    if (ring) rings.push(resampleClosedRing(ring, stitchLenMm));
  }
  return rings;
}

/**
 * Center-run underlay for narrow satin shapes.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
 *   - `stitchLenMm <= 0`
 * English note.
 * English note.
 */
export function centerRunUnderlay(
  shape: Shape,
  stitchLenMm: number,
): Point2D[] {
  if (stitchLenMm <= 0) return [];
  if (polygonArea(shape.outer) < MIN_AREA_MM2) return [];

  const raster = rasterizeShapeToMask(shape, PX_PER_MM);
  const skel = thinMaskZhangSuen(raster.mask, raster.width, raster.height);
  if (countOn(skel) < MIN_SKELETON_PIXELS) return [];

  const pathPx = traceLongestSkeletonPath(skel, raster.width, raster.height);
  if (pathPx.length < 2) return [];

  const pathMm: Polygon = pathPx.map(([px, py]) => [
    raster.offsetX + (px + 0.5) / PX_PER_MM,
    raster.offsetY + (py + 0.5) / PX_PER_MM,
  ]);
  return resampleOpenLine(pathMm, stitchLenMm);
}

/**
 * Fill underlay for fill objects.
 *
 * English note.
 * English note.
 * English note.
 *
 * English note.
 * English note.
 * English note.
 */
export function fillUnderlay(
  shape: Shape,
  angleDeg: number,
  spacingMm: number,
): Point2D[][] {
  if (shape.outer.length < 3 || spacingMm <= 0) return [];
  // English note.
  const rad = ((angleDeg + 90) * Math.PI) / 180;
  const dir: [number, number] = [Math.cos(rad), Math.sin(rad)];
  const perp: [number, number] = [-dir[1], dir[0]];

  let minS = Infinity,
    maxS = -Infinity;
  for (const [x, y] of shape.outer) {
    const s = x * perp[0] + y * perp[1];
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }

  const rings: Polygon[] = [shape.outer, ...shape.holes];
  const segments: Point2D[][] = [];
  for (let s = minS; s <= maxS + 1e-9; s += spacingMm) {
    const ox = perp[0] * s;
    const oy = perp[1] * s;
    const crossings = intersectScanline(rings, ox, oy, dir);
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    if (crossings.length % 2 !== 0) crossings.pop();
    for (let i = 0; i < crossings.length; i += 2) {
      const a = crossings[i];
      const b = crossings[i + 1];
      segments.push([
        [ox + dir[0] * a, oy + dir[1] * a],
        [ox + dir[0] * b, oy + dir[1] * b],
      ]);
    }
  }
  return segments;
}

/**
 * Zigzag underlay for wide satin objects.
 *
 * English note.
 * English note.
 *
 * English note.
 * English note.
 * English note.
 */
export function zigzagUnderlay(
  shape: Shape,
  spacingMm: number,
  insetMm: number,
): Point2D[] {
  if (shape.outer.length < 3 || spacingMm <= 0) return [];
  const { shortSide, longAxis, center } = analyzeShape(shape.outer);
  const halfWidth = shortSide / 2 - insetMm;
  if (halfWidth <= 0) return [];
  const shortAxis: [number, number] = [-longAxis[1], longAxis[0]];

  let minL = Infinity,
    maxL = -Infinity;
  for (const [x, y] of shape.outer) {
    const l = (x - center[0]) * longAxis[0] + (y - center[1]) * longAxis[1];
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }
  const span = maxL - minL;
  const steps = Math.max(1, Math.round(span / spacingMm));
  const out: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const l = minL + (span * i) / steps;
    const side = i % 2 === 0 ? -halfWidth : +halfWidth;
    out.push([
      center[0] + longAxis[0] * l + shortAxis[0] * side,
      center[1] + longAxis[1] * l + shortAxis[1] * side,
    ]);
  }
  return out;
}

/**
 * English note.
 * English note.
 *
 * - `kind === "none"` or `obj.props.underlay` 未定義: 空配列
 * - `kind === "edge-run"`: `edgeRunUnderlay(obj.shape, insetMm, stitchLenMm).flat()`
 * - `kind === "center-run"`: `centerRunUnderlay(obj.shape, stitchLenMm)`
 * - `kind === "zigzag"`: `zigzagUnderlay(obj.shape, spacingMm, insetMm)`
 * - `kind === "fill"`: `fillUnderlay(obj.shape, angleDeg, spacingMm).flat()`
 *
 * English note.
 */
export function generateUnderlayStitches(obj: EmbroideryObject): Stitch[] {
  const u = obj.props.underlay;
  if (!u || u.kind === "none") return [];
  let points: Point2D[] = [];
  switch (u.kind) {
    case "edge-run":
      points = edgeRunUnderlay(obj.shape, u.insetMm, u.stitchLenMm).flat();
      break;
    case "center-run":
      points = centerRunUnderlay(obj.shape, u.stitchLenMm);
      break;
    case "zigzag":
      points = zigzagUnderlay(obj.shape, u.spacingMm, u.insetMm);
      break;
    case "fill":
      return routeUnderlaySegments(
        fillUnderlay(obj.shape, u.angleDeg, u.spacingMm),
        obj.colorIndex,
        obj.props.maxStitchMm ?? DEFAULT_UNDERLAY_MAX_STITCH_MM,
        DEFAULT_UNDERLAY_TRIM_THRESHOLD_MM,
      );
  }
  return points.map(([x, y]) => ({
    x,
    y,
    kind: "run" as const,
    colorIndex: obj.colorIndex,
  }));
}

function routeUnderlaySegments(
  segments: Point2D[][],
  colorIndex: number,
  maxStitchMm: number,
  trimThresholdMm: number,
): Stitch[] {
  const stitches: Stitch[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    const first = segment[0];
    const previous = stitches[stitches.length - 1];
    if (previous) {
      const dist = Math.hypot(first[0] - previous.x, first[1] - previous.y);
      if (dist > maxStitchMm) {
        if (dist > trimThresholdMm) {
          stitches.push({ x: previous.x, y: previous.y, kind: "trim", colorIndex });
        }
        stitches.push({ x: first[0], y: first[1], kind: "jump", colorIndex });
      }
    }
    appendRunPoints(stitches, segment, colorIndex, maxStitchMm);
  }
  return stitches;
}

function appendRunPoints(
  stitches: Stitch[],
  points: Point2D[],
  colorIndex: number,
  maxStitchMm: number,
): void {
  for (const point of points) {
    const previous = stitches[stitches.length - 1];
    if (!previous || previous.kind === "jump" || previous.kind === "trim" || previous.kind === "stop") {
      stitches.push({ x: point[0], y: point[1], kind: "run", colorIndex });
      continue;
    }
    const dist = Math.hypot(point[0] - previous.x, point[1] - previous.y);
    if (dist > maxStitchMm) {
      const steps = Math.ceil(dist / maxStitchMm);
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        stitches.push({
          x: previous.x + (point[0] - previous.x) * t,
          y: previous.y + (point[1] - previous.y) * t,
          kind: "run",
          colorIndex,
        });
      }
    } else {
      stitches.push({ x: point[0], y: point[1], kind: "run", colorIndex });
    }
  }
}

// --- private helpers ---

function pickLargest(polys: Polygon[]): Polygon | null {
  if (polys.length === 0) return null;
  let best = polys[0];
  let bestArea = polygonArea(best);
  for (let i = 1; i < polys.length; i++) {
    const a = polygonArea(polys[i]);
    if (a > bestArea) {
      best = polys[i];
      bestArea = a;
    }
  }
  return bestArea > 0 ? best : null;
}

function polygonArea(polygon: Polygon): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * English note.
 * English note.
 * English note.
 */
function resampleClosedRing(ring: Polygon, stitchLenMm: number): Point2D[] {
  if (ring.length < 2 || stitchLenMm <= 0) return ring.length > 0 ? [[ring[0][0], ring[0][1]]] : [];
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  if (perimeter < stitchLenMm) return [[ring[0][0], ring[0][1]]];
  const count = Math.max(2, Math.round(perimeter / stitchLenMm));
  const step = perimeter / count;
  const out: Point2D[] = [];
  let cursor = 0; // English note.
  let nextEmit = 0; // English note.
  let edgeIdx = 0;
  let edgeStart = ring[0];
  let edgeEnd = ring[1 % ring.length];
  let edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
  while (out.length < count) {
    const target = nextEmit;
    while (cursor + edgeLen < target) {
      cursor += edgeLen;
      edgeIdx = (edgeIdx + 1) % ring.length;
      edgeStart = ring[edgeIdx];
      edgeEnd = ring[(edgeIdx + 1) % ring.length];
      edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
    }
    const t = edgeLen === 0 ? 0 : (target - cursor) / edgeLen;
    out.push([
      edgeStart[0] + (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] + (edgeEnd[1] - edgeStart[1]) * t,
    ]);
    nextEmit += step;
  }
  return out;
}

/**
 * English note.
 * English note.
 */
function resampleOpenLine(line: Polygon, stitchLenMm: number): Point2D[] {
  if (line.length < 2 || stitchLenMm <= 0) return line.length > 0 ? [[line[0][0], line[0][1]]] : [];
  let totalLen = 0;
  for (let i = 1; i < line.length; i++) {
    totalLen += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  if (totalLen < stitchLenMm) {
    return [
      [line[0][0], line[0][1]],
      [line[line.length - 1][0], line[line.length - 1][1]],
    ];
  }
  const count = Math.max(2, Math.round(totalLen / stitchLenMm) + 1);
  const step = totalLen / (count - 1);
  const out: Point2D[] = [];
  let cursor = 0;
  let edgeIdx = 0;
  let edgeStart = line[0];
  let edgeEnd = line[1];
  let edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
  for (let k = 0; k < count; k++) {
    const target = step * k;
    while (cursor + edgeLen < target && edgeIdx < line.length - 2) {
      cursor += edgeLen;
      edgeIdx += 1;
      edgeStart = line[edgeIdx];
      edgeEnd = line[edgeIdx + 1];
      edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
    }
    const t = edgeLen === 0 ? 0 : Math.min(1, (target - cursor) / edgeLen);
    out.push([
      edgeStart[0] + (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] + (edgeEnd[1] - edgeStart[1]) * t,
    ]);
  }
  return out;
}

/**
 * English note.
 * English note.
 * English note.
 */
function rasterizeShapeToMask(
  shape: Shape,
  pxPerMm: number,
): {
  mask: Uint8Array;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of shape.outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = Math.max(1, Math.ceil((maxX - minX) * pxPerMm) + 2);
  const height = Math.max(1, Math.ceil((maxY - minY) * pxPerMm) + 2);
  const offsetX = minX - 1 / pxPerMm;
  const offsetY = minY - 1 / pxPerMm;
  const mask = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
      const wy = offsetY + (py + 0.5) / pxPerMm;
    for (let px = 0; px < width; px++) {
      const wx = offsetX + (px + 0.5) / pxPerMm;
      if (!pointInPolygon([wx, wy], shape.outer)) continue;
      let inHole = false;
      for (const h of shape.holes) {
        if (pointInPolygon([wx, wy], h)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) mask[py * width + px] = 1;
    }
  }
  return { mask, width, height, offsetX, offsetY };
}

/**
 * English note.
 * English note.
 */
function thinMaskZhangSuen(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(mask);
  // P2..P9: N, NE, E, SE, S, SW, W, NW
  const idx = (x: number, y: number) => y * width + x;
  const neighbors = (x: number, y: number): number[] => [
    out[idx(x, y - 1)], // P2 N
    out[idx(x + 1, y - 1)], // P3 NE
    out[idx(x + 1, y)], // P4 E
    out[idx(x + 1, y + 1)], // P5 SE
    out[idx(x, y + 1)], // P6 S
    out[idx(x - 1, y + 1)], // P7 SW
    out[idx(x - 1, y)], // P8 W
    out[idx(x - 1, y - 1)], // P9 NW
  ];
  const countTransitions = (nb: number[]): number => {
    let cnt = 0;
    for (let i = 0; i < 8; i++) {
      if (nb[i] === 0 && nb[(i + 1) % 8] === 1) cnt++;
    }
    return cnt;
  };
  let changed = true;
  while (changed) {
    changed = false;
    // sub-iter 1
    const toRemove1: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (out[idx(x, y)] !== 1) continue;
        const nb = neighbors(x, y);
        const B = nb.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        if (countTransitions(nb) !== 1) continue;
        const [P2, , P4, , P6, , P8] = nb;
        if (P2 * P4 * P6 !== 0) continue;
        if (P4 * P6 * P8 !== 0) continue;
        toRemove1.push(idx(x, y));
      }
    }
    if (toRemove1.length > 0) {
      for (const i of toRemove1) out[i] = 0;
      changed = true;
    }
    // sub-iter 2
    const toRemove2: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (out[idx(x, y)] !== 1) continue;
        const nb = neighbors(x, y);
        const B = nb.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        if (countTransitions(nb) !== 1) continue;
        const [P2, , P4, , P6, , P8] = nb;
        if (P2 * P4 * P8 !== 0) continue;
        if (P2 * P6 * P8 !== 0) continue;
        toRemove2.push(idx(x, y));
      }
    }
    if (toRemove2.length > 0) {
      for (const i of toRemove2) out[i] = 0;
      changed = true;
    }
  }
  return out;
}

/**
 * English note.
 * English note.
 */
function traceLongestSkeletonPath(
  skel: Uint8Array,
  width: number,
  height: number,
): Array<[number, number]> {
  const seeds: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skel[y * width + x] === 1) seeds.push([x, y]);
    }
  }
  if (seeds.length === 0) return [];
  const farFromSeed = bfsFarthest(skel, width, height, seeds[0]);
  if (!farFromSeed) return [];
  const result = bfsFarthestWithPath(skel, width, height, farFromSeed);
  return result?.path ?? [];
}

function bfsFarthest(
  skel: Uint8Array,
  width: number,
  height: number,
  start: [number, number],
): [number, number] | null {
  const dist = new Int32Array(width * height).fill(-1);
  dist[start[1] * width + start[0]] = 0;
  let head = 0;
  const queue: Array<[number, number]> = [start];
  let farthest = start;
  let farthestDist = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const d = dist[y * width + x];
    if (d > farthestDist) {
      farthestDist = d;
      farthest = [x, y];
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (skel[ny * width + nx] !== 1) continue;
        if (dist[ny * width + nx] !== -1) continue;
        dist[ny * width + nx] = d + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return farthest;
}

function bfsFarthestWithPath(
  skel: Uint8Array,
  width: number,
  height: number,
  start: [number, number],
): { path: Array<[number, number]> } | null {
  const dist = new Int32Array(width * height).fill(-1);
  const parent = new Int32Array(width * height).fill(-1);
  dist[start[1] * width + start[0]] = 0;
  let head = 0;
  const queue: Array<[number, number]> = [start];
  let farthest = start;
  let farthestDist = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const d = dist[y * width + x];
    if (d > farthestDist) {
      farthestDist = d;
      farthest = [x, y];
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (skel[ny * width + nx] !== 1) continue;
        if (dist[ny * width + nx] !== -1) continue;
        dist[ny * width + nx] = d + 1;
        parent[ny * width + nx] = y * width + x;
        queue.push([nx, ny]);
      }
    }
  }
  // reconstruct path
  const path: Array<[number, number]> = [];
  let cur: number = farthest[1] * width + farthest[0];
  while (cur !== -1) {
    path.push([cur % width, Math.floor(cur / width)]);
    cur = parent[cur];
  }
  path.reverse();
  return { path };
}

function countOn(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++;
  return n;
}

function offsetShapeInward(shape: Shape, insetMm: number): Polygon[] {
  const rings: Polygon[] = [];
  const outerOff = offsetPolygon(shape.outer, -insetMm);
  if (outerOff) rings.push(...outerOff);
  for (const h of shape.holes) {
    const holeOff = offsetPolygon(h, +insetMm);
    if (holeOff) rings.push(...holeOff);
  }
  return rings;
}

/** English note. */
export const __internal = {
  offsetShapeInward,
  rasterizeShapeToMask,
  thinMaskZhangSuen,
  traceLongestSkeletonPath,
  resampleClosedRing,
};
