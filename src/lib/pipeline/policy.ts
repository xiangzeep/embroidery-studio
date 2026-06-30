// Phase 3 §7 Trim Policy: format ごとの trim/jump/travel-run 閾値を定義する。
// connectObjects から参照される。閾値の不変条件: trim > jump >= travelRun。

import type { EmbroideryFormat } from "./config";

export type TrimPolicy = {
  /** これ以上の距離は trim を挿入してから jump */
  trimThresholdMm: number;
  /** travel run と jump の境界 (将来別運用予備) */
  jumpThresholdMm: number;
  /** これ未満なら travel run (kind="run") で繋ぐ */
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
