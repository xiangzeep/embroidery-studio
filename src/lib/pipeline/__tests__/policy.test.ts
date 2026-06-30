import { describe, it, expect } from "vitest";
import {
  TRIM_POLICY_BY_FORMAT,
  DEFAULT_TRIM_POLICY,
  type TrimPolicy,
} from "../policy";

describe("TRIM_POLICY_BY_FORMAT", () => {
  it("5 フォーマット (dst/pes/jef/exp/vp3) すべてに値が定義されている", () => {
    expect(Object.keys(TRIM_POLICY_BY_FORMAT).sort()).toEqual([
      "dst",
      "exp",
      "jef",
      "pes",
      "vp3",
    ]);
  });

  it("計画書 7 のテーブル初期値: trim=8 / jump=5 / travelRun=5", () => {
    const expected: TrimPolicy = {
      trimThresholdMm: 8,
      jumpThresholdMm: 5,
      travelRunUntilMm: 5,
    };
    for (const fmt of ["dst", "pes", "jef", "exp", "vp3"] as const) {
      expect(TRIM_POLICY_BY_FORMAT[fmt]).toEqual(expected);
    }
  });

  it("trim > jump の不変条件", () => {
    for (const p of Object.values(TRIM_POLICY_BY_FORMAT)) {
      expect(p.trimThresholdMm).toBeGreaterThan(p.jumpThresholdMm);
    }
  });

  it("travelRun <= jump の不変条件", () => {
    for (const p of Object.values(TRIM_POLICY_BY_FORMAT)) {
      expect(p.travelRunUntilMm).toBeLessThanOrEqual(p.jumpThresholdMm);
    }
  });

  it("DEFAULT_TRIM_POLICY === dst", () => {
    expect(DEFAULT_TRIM_POLICY).toEqual(TRIM_POLICY_BY_FORMAT.dst);
  });
});
