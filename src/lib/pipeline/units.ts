export const MM_PER_INCH = 25.4;

/** English note. */
export function tenthsMm(mm: number): number {
  return Math.round(mm * 10);
}

export function pxPerMm(widthPx: number, widthMm: number): number {
  if (widthMm <= 0) throw new Error("widthMm must be positive");
  return widthPx / widthMm;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
