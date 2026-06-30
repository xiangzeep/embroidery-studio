// Lockstitch helpers for tie-in and tie-off stitches.
// English note.
// English note.
// English note.

import type { Stitch } from "./types";

export type Point = [number, number];

const DEFAULT_BACK_DIST_MM = 0.8;

/**
 * English note.
 * English note.
 */
export function emitTieIn(
  anchor: Point,
  firstDir: Point,
  colorIndex: number,
  backDistMm: number = DEFAULT_BACK_DIST_MM,
): Stitch[] {
  const back: Point = [
    anchor[0] - firstDir[0] * backDistMm,
    anchor[1] - firstDir[1] * backDistMm,
  ];
  return [
    { x: back[0], y: back[1], kind: "run", colorIndex },
    { x: anchor[0], y: anchor[1], kind: "run", colorIndex },
    { x: back[0], y: back[1], kind: "run", colorIndex },
  ];
}

/**
 * English note.
 * English note.
 */
export function emitTieOff(
  anchor: Point,
  lastDir: Point,
  colorIndex: number,
  backDistMm: number = DEFAULT_BACK_DIST_MM,
): Stitch[] {
  return emitTieIn(anchor, lastDir, colorIndex, backDistMm);
}
