import type { Stitch, StitchKind, StitchPattern } from "./types";

export type StitchValidationCode =
  | "stitch-too-short"
  | "stitch-too-long"
  | "duplicate-stitch";

export type StitchValidationIssue = {
  code: StitchValidationCode;
  blockIndex: number;
  stitchIndex: number;
  distanceMm?: number;
};

export type StitchValidationReport = {
  errors: StitchValidationIssue[];
  warnings: StitchValidationIssue[];
};

export type StitchValidatorOptions = Partial<{
  minStitchMm: number;
  maxStitchMm: number;
}>;

const DEFAULT_MIN_STITCH_MM = 0.3;
const DEFAULT_MAX_STITCH_MM = 12;

const REAL_STITCH_KINDS = new Set<StitchKind>(["run", "satin", "fill"]);

export function validateStitches(
  pattern: StitchPattern,
  opts: StitchValidatorOptions = {},
): StitchValidationReport {
  const minStitchMm = opts.minStitchMm ?? DEFAULT_MIN_STITCH_MM;
  const maxStitchMm = opts.maxStitchMm ?? DEFAULT_MAX_STITCH_MM;
  const errors: StitchValidationIssue[] = [];
  const warnings: StitchValidationIssue[] = [];

  pattern.blocks.forEach((block, blockIndex) => {
    let previousReal: Stitch | null = null;
    block.stitches.forEach((stitch, stitchIndex) => {
      if (!REAL_STITCH_KINDS.has(stitch.kind)) {
        previousReal = null;
        return;
      }
      if (!previousReal) {
        previousReal = stitch;
        return;
      }
      const distanceMm = distance(previousReal, stitch);
      if (distanceMm <= 1e-6) {
        warnings.push({ code: "duplicate-stitch", blockIndex, stitchIndex, distanceMm });
      } else if (distanceMm < minStitchMm) {
        warnings.push({ code: "stitch-too-short", blockIndex, stitchIndex, distanceMm });
      } else if (distanceMm > maxStitchMm) {
        errors.push({ code: "stitch-too-long", blockIndex, stitchIndex, distanceMm });
      }
      previousReal = stitch;
    });
  });

  return { errors, warnings };
}

export function assertValidStitches(
  pattern: StitchPattern,
  opts: StitchValidatorOptions = {},
): StitchPattern {
  const report = validateStitches(pattern, opts);
  if (report.errors.length === 0) return pattern;
  const summary = report.errors
    .slice(0, 5)
    .map((issue) => `${issue.code}@${issue.blockIndex}:${issue.stitchIndex}`)
    .join(", ");
  throw new Error(`Invalid stitch output: ${summary}`);
}

function distance(a: Stitch, b: Stitch): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
