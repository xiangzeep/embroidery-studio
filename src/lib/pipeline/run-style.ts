import { beanStitchPolyline } from "./bean-stitch";
import type { Point2D } from "./types";

export type RunStitchStyle = "single" | "double" | "triple" | "bean";

export type RunStyleOptions = {
  closed?: boolean;
  strokeKind?: string;
  maxStitchMm: number;
};

const CLOSED_LOOP_STYLE_MAX_MM = 18;
const SHORT_DECORATIVE_MAX_MM = 7;
const BACKBONE_MIN_MM = 18;
const CLOSED_GAP_MM = 0.9;

export function styleRunSegment(points: Point2D[], opts: RunStyleOptions): Point2D[] {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);

  const closed = opts.closed ?? isClosedRunSegment(points);
  const length = polylineLength(points, closed);
  const style = classifyRunSegmentStyle(length, closed, opts.strokeKind);

  if (style === "bean") return beanStitchPolyline(points, opts.maxStitchMm);
  if (style === "triple") return tripleRunPolyline(points);
  if (style === "double") return doubleRunPolyline(points);
  return points.map(([x, y]) => [x, y]);
}

export function classifyRunSegmentStyle(
  lengthMm: number,
  closed: boolean,
  strokeKind?: string,
): RunStitchStyle {
  if (closed) return lengthMm <= CLOSED_LOOP_STYLE_MAX_MM ? "bean" : "triple";
  if (lengthMm >= BACKBONE_MIN_MM) return "triple";
  if (lengthMm <= SHORT_DECORATIVE_MAX_MM) return "double";
  if (strokeKind === "bean-run") return "bean";
  return "single";
}

export function doubleRunPolyline(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);
  return points
    .map(([x, y]) => [x, y] as Point2D)
    .concat(points.slice(0, -1).reverse().map(([x, y]) => [x, y] as Point2D));
}

export function tripleRunPolyline(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);
  const forward = points.map(([x, y]) => [x, y] as Point2D);
  const reverse = points.slice(0, -1).reverse().map(([x, y]) => [x, y] as Point2D);
  const secondForward = points.slice(1).map(([x, y]) => [x, y] as Point2D);
  return forward.concat(reverse, secondForward);
}

export function isClosedRunSegment(points: Point2D[]): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= CLOSED_GAP_MM;
}

export function polylineLength(points: Point2D[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const closeGap = Math.hypot(first[0] - last[0], first[1] - last[1]);
    if (closeGap > CLOSED_GAP_MM) total += closeGap;
  }
  return total;
}
