// English note.
// English note.

import type { EmbroideryFormat } from "./config";

export type TrimPolicy = {
  /** English note. */
  trimThresholdMm: number;
  /** English note. */
  jumpThresholdMm: number;
  /** English note. */
  travelRunUntilMm: number;
};

const COMMON_POLICY: TrimPolicy = {
  trimThresholdMm: 8,
  jumpThresholdMm: 5,
  travelRunUntilMm: 5,
};

export const TRIM_POLICY_BY_FORMAT: Record<EmbroideryFormat, TrimPolicy> = {
  dst: COMMON_POLICY,
  pes: COMMON_POLICY,
  jef: COMMON_POLICY,
  exp: COMMON_POLICY,
  vp3: COMMON_POLICY,
};

export const DEFAULT_TRIM_POLICY: TrimPolicy = TRIM_POLICY_BY_FORMAT.dst;
