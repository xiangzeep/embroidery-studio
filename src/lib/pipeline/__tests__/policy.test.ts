import { describe, it, expect } from "vitest";
import {
  TRIM_POLICY_BY_FORMAT,
  DEFAULT_TRIM_POLICY,
  type TrimPolicy,
} from "../policy";

describe("TRIM_POLICY_BY_FORMAT", () => {
  it("translated case", () => {
    expect(Object.keys(TRIM_POLICY_BY_FORMAT).sort()).toEqual([
      "dst",
      "exp",
      "jef",
      "pes",
      "vp3",
    ]);
  });

  it("translated case", () => {
    const expected: TrimPolicy = {
      trimThresholdMm: 8,
      jumpThresholdMm: 5,
      travelRunUntilMm: 5,
    };
    for (const fmt of ["dst", "pes", "jef", "exp", "vp3"] as const) {
      expect(TRIM_POLICY_BY_FORMAT[fmt]).toEqual(expected);
    }
  });

  it("translated case", () => {
    for (const p of Object.values(TRIM_POLICY_BY_FORMAT)) {
      expect(p.trimThresholdMm).toBeGreaterThan(p.jumpThresholdMm);
    }
  });

  it("translated case", () => {
    for (const p of Object.values(TRIM_POLICY_BY_FORMAT)) {
      expect(p.travelRunUntilMm).toBeLessThanOrEqual(p.jumpThresholdMm);
    }
  });

  it("DEFAULT_TRIM_POLICY === dst", () => {
    expect(DEFAULT_TRIM_POLICY).toEqual(TRIM_POLICY_BY_FORMAT.dst);
  });
});
