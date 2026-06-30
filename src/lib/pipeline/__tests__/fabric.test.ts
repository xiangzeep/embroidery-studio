import { describe, it, expect } from "vitest";
import { FABRIC_PROFILES, getFabricProfile, pullCompForWidth } from "../fabric";
import type { FabricKind } from "../types";

const EXPECTED: Record<FabricKind, { density: number; pullPerWidth: number; minPull: number }> = {
  denim:        { density: 0.40, pullPerWidth: 0.025, minPull: 0.10 },
  twill:        { density: 0.40, pullPerWidth: 0.030, minPull: 0.10 },
  canvas:       { density: 0.42, pullPerWidth: 0.020, minPull: 0.10 },
  "knit-light": { density: 0.45, pullPerWidth: 0.060, minPull: 0.20 },
  "knit-heavy": { density: 0.48, pullPerWidth: 0.075, minPull: 0.25 },
  terry:        { density: 0.42, pullPerWidth: 0.080, minPull: 0.30 },
  fleece:       { density: 0.45, pullPerWidth: 0.060, minPull: 0.25 },
  leather:      { density: 0.50, pullPerWidth: 0.015, minPull: 0.05 },
  silk:         { density: 0.40, pullPerWidth: 0.020, minPull: 0.08 },
  felt:         { density: 0.42, pullPerWidth: 0.020, minPull: 0.10 },
};

const ALL_KINDS: FabricKind[] = [
  "denim", "twill", "canvas",
  "knit-light", "knit-heavy",
  "terry", "fleece", "leather", "silk", "felt",
];

describe("FABRIC_PROFILES table", () => {
  it("FABRIC_PROFILES は denim / twill / canvas / knit-light / knit-heavy / terry / fleece / leather / silk / felt の 10 種をキーに持つ", () => {
    expect(Object.keys(FABRIC_PROFILES).sort()).toEqual([...ALL_KINDS].sort());
  });

  it.each(ALL_KINDS)(
    "FABRIC_PROFILES[%s] は defaultDensityMm が Phase 計画書 3.3 の値と一致する",
    (kind) => {
      expect(FABRIC_PROFILES[kind].defaultDensityMm).toBeCloseTo(EXPECTED[kind].density, 5);
    },
  );

  it.each(ALL_KINDS)(
    "FABRIC_PROFILES[%s] は pullCompPerWidth が Phase 計画書 3.3 の値と一致する",
    (kind) => {
      expect(FABRIC_PROFILES[kind].pullCompPerWidth).toBeCloseTo(EXPECTED[kind].pullPerWidth, 5);
    },
  );

  it.each(ALL_KINDS)(
    "FABRIC_PROFILES[%s] は minPullCompMm が Phase 計画書 3.3 の値と一致する",
    (kind) => {
      expect(FABRIC_PROFILES[kind].minPullCompMm).toBeCloseTo(EXPECTED[kind].minPull, 5);
    },
  );

  it.each(ALL_KINDS)(
    "FABRIC_PROFILES[%s] は defaultPushCompMm が 0 以上 0.3 mm 以下の常識的な値",
    (kind) => {
      const v = FABRIC_PROFILES[kind].defaultPushCompMm;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.3);
    },
  );

  it.each(ALL_KINDS)("FABRIC_PROFILES[%s].kind は自身のキーと一致する", (kind) => {
    expect(FABRIC_PROFILES[kind].kind).toBe(kind);
  });
});

describe("getFabricProfile", () => {
  it("getFabricProfile(\"denim\") は FABRIC_PROFILES.denim と参照同一", () => {
    expect(getFabricProfile("denim")).toBe(FABRIC_PROFILES.denim);
  });

  it("getFabricProfile(\"knit-heavy\") は kind フィールドが \"knit-heavy\"", () => {
    expect(getFabricProfile("knit-heavy").kind).toBe("knit-heavy");
  });

  it("getFabricProfile は型レベルで FabricKind 以外を受け付けない (compile-time check)", () => {
    // @ts-expect-error — 未知の kind は型エラーになるべき (ランタイム挙動はテストしない)
    getFabricProfile("unknown-fabric");
    expect(true).toBe(true);
  });
});

describe("pullCompForWidth", () => {
  const denim = FABRIC_PROFILES.denim;
  const knitHeavy = FABRIC_PROFILES["knit-heavy"];
  const terry = FABRIC_PROFILES.terry;
  const leather = FABRIC_PROFILES.leather;

  it.each<[string, number, number]>([
    ["denim, 0mm → minPull(0.10) で床打ち", 0, 0.10],
    ["denim, 2mm → 2*0.025=0.05 < 0.10 で min 側", 2, 0.10],
    ["denim, 4mm → 4*0.025=0.10 で境界", 4, 0.10],
    ["denim, 5mm → 5*0.025=0.125 で per-width 側", 5, 0.125],
  ])("pullCompForWidth(%s)", (_label, w, expected) => {
    expect(pullCompForWidth(denim, w)).toBeCloseTo(expected, 5);
  });

  it("pullCompForWidth(knit-heavy, 4) = max(0.25, 4*0.075=0.30) = 0.30", () => {
    expect(pullCompForWidth(knitHeavy, 4)).toBeCloseTo(0.30, 5);
  });

  it("pullCompForWidth(terry, 1) = max(0.30, 1*0.080=0.08) = 0.30 (min 側)", () => {
    expect(pullCompForWidth(terry, 1)).toBeCloseTo(0.30, 5);
  });

  it("pullCompForWidth(leather, 10) = max(0.05, 10*0.015=0.15) = 0.15", () => {
    expect(pullCompForWidth(leather, 10)).toBeCloseTo(0.15, 5);
  });

  it("pullCompForWidth(denim, 負数) は minPullCompMm にクランプ", () => {
    expect(pullCompForWidth(denim, -5)).toBeCloseTo(denim.minPullCompMm, 5);
  });

  it("pullCompForWidth(denim, NaN) は NaN ではなく minPullCompMm を返す", () => {
    const result = pullCompForWidth(denim, Number.NaN);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeCloseTo(denim.minPullCompMm, 5);
  });
});

describe("underlayPolicy.satin (幅依存分岐)", () => {
  // denim family (denim / twill / canvas / felt): center-run → edge-run → zigzag
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "%s.satin(1.5) は center-run",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(1.5).kind).toBe("center-run");
    },
  );
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "%s.satin(3.0) は edge-run",
    (kind) => {
      const u = FABRIC_PROFILES[kind].underlayPolicy.satin(3.0);
      expect(u.kind).toBe("edge-run");
      if (u.kind === "edge-run") {
        expect(u.insetMm).toBeGreaterThan(0);
        expect(u.stitchLenMm).toBeGreaterThan(0);
      }
    },
  );
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "%s.satin(5.0) は zigzag",
    (kind) => {
      const u = FABRIC_PROFILES[kind].underlayPolicy.satin(5.0);
      expect(u.kind).toBe("zigzag");
    },
  );

  // knit family (knit-light / knit-heavy): center-run → edge-run → zigzag (強め)
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "%s.satin(1.5) は center-run",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(1.5).kind).toBe("center-run");
    },
  );
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "%s.satin(3.0) は edge-run",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(3.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind, number]>([
    ["knit-light", 1.0],
    ["knit-heavy", 1.0],
  ])("%s.satin(5.0) は zigzag で spacingMm = %f (denim より強め)", (kind, expectedSpacing) => {
    const u = FABRIC_PROFILES[kind].underlayPolicy.satin(5.0);
    expect(u.kind).toBe("zigzag");
    if (u.kind === "zigzag") {
      expect(u.spacingMm).toBeCloseTo(expectedSpacing, 5);
      // denim の spacing (1.5) より小さい = 強い下打ち
      const denimZig = FABRIC_PROFILES.denim.underlayPolicy.satin(5.0);
      if (denimZig.kind === "zigzag") {
        expect(u.spacingMm).toBeLessThan(denimZig.spacingMm);
      }
    }
  });

  // terry family (terry / fleece): 細幅から edge-run, 5mm で zigzag
  it.each<[FabricKind]>([["terry"], ["fleece"]])(
    "%s.satin(1.5) は edge-run (毛足が長いので細幅でも center を使わない)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(1.5).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["terry"], ["fleece"]])(
    "%s.satin(3.0) は edge-run",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(3.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["terry"], ["fleece"]])("%s.satin(5.0) は zigzag", (kind) => {
    expect(FABRIC_PROFILES[kind].underlayPolicy.satin(5.0).kind).toBe("zigzag");
  });

  // leather: zigzag 禁止
  it("leather.satin(1.5) は center-run", () => {
    expect(FABRIC_PROFILES.leather.underlayPolicy.satin(1.5).kind).toBe("center-run");
  });
  it("leather.satin(3.0) は edge-run", () => {
    expect(FABRIC_PROFILES.leather.underlayPolicy.satin(3.0).kind).toBe("edge-run");
  });
  it("leather.satin(5.0) は edge-run (zigzag に切り替えない — 針穴跡を最小化)", () => {
    const u = FABRIC_PROFILES.leather.underlayPolicy.satin(5.0);
    expect(u.kind).toBe("edge-run");
    expect(u.kind).not.toBe("zigzag");
  });

  // tier1/tier2 境界 (widthMm == tier1Max): `< tier1Max` のため tier2 に落ちる
  // twill family は tier1Max=2 / tier2Max=4 — 2.0 と 4.0 は両方とも edge-run のはず
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "%s.satin(2.0) は edge-run (tier1/tier2 境界 — `<` ではなく `<=` の側に落ちる)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(2.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "%s.satin(4.0) は edge-run (tier2/tier3 境界 — 4.0 はまだ zigzag ではない)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(4.0).kind).toBe("edge-run");
    },
  );
  // knit family も同じ境界
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "%s.satin(2.0) は edge-run (境界)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(2.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "%s.satin(4.0) は edge-run (境界)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(4.0).kind).toBe("edge-run");
    },
  );

  // silk: 軽め (細幅では none)
  it("silk.satin(1.5) は none (軽め)", () => {
    expect(FABRIC_PROFILES.silk.underlayPolicy.satin(1.5).kind).toBe("none");
  });
  it("silk.satin(3.0) は center-run", () => {
    expect(FABRIC_PROFILES.silk.underlayPolicy.satin(3.0).kind).toBe("center-run");
  });
  it("silk.satin(5.0) は edge-run (zigzag は使わない)", () => {
    const u = FABRIC_PROFILES.silk.underlayPolicy.satin(5.0);
    expect(u.kind).toBe("edge-run");
    expect(u.kind).not.toBe("zigzag");
  });

  // 防御挙動: 非有限値・負数は最も軽い tier に落ちる (zigzag 等にフォールバックしない)
  it.each<[FabricKind]>([["denim"], ["knit-light"], ["leather"], ["silk"]])(
    "%s.satin(NaN) は重い underlay (zigzag) を返さない",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(Number.NaN).kind).not.toBe("zigzag");
    },
  );
  it.each<[FabricKind]>([["denim"], ["knit-light"], ["leather"], ["silk"]])(
    "%s.satin(-1) は重い underlay (zigzag) を返さない",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(-1).kind).not.toBe("zigzag");
    },
  );
  it("denim.satin(Infinity) は重い underlay (zigzag) を返さない (非有限値防御)", () => {
    expect(FABRIC_PROFILES.denim.underlayPolicy.satin(Number.POSITIVE_INFINITY).kind).not.toBe(
      "zigzag",
    );
  });
});

describe("FABRIC_PROFILES は深く freeze されている", () => {
  it("FABRIC_PROFILES.denim 自体が frozen", () => {
    expect(Object.isFrozen(FABRIC_PROFILES.denim)).toBe(true);
  });
  it("FABRIC_PROFILES.denim.underlayPolicy が frozen", () => {
    expect(Object.isFrozen(FABRIC_PROFILES.denim.underlayPolicy)).toBe(true);
  });
  it("frozen プロファイルへの書込みは strict mode で例外、非 strict では silent fail", () => {
    // テストは vitest の strict mode で動くため、frozen への書込みは TypeError
    expect(() => {
      (FABRIC_PROFILES.denim as { defaultDensityMm: number }).defaultDensityMm = 99;
    }).toThrow();
  });
});

describe("underlayPolicy.fill (生地別)", () => {
  it("denim.fill() は kind=fill, spacingMm=3.0 (粗め)", () => {
    const u = FABRIC_PROFILES.denim.underlayPolicy.fill();
    expect(u.kind).toBe("fill");
    if (u.kind === "fill") expect(u.spacingMm).toBeCloseTo(3.0, 5);
  });

  it("knit-light.fill() は kind=fill, spacingMm=2.5 (強め)", () => {
    const u = FABRIC_PROFILES["knit-light"].underlayPolicy.fill();
    expect(u.kind).toBe("fill");
    if (u.kind === "fill") expect(u.spacingMm).toBeCloseTo(2.5, 5);
  });

  it("knit-heavy.fill() は kind=fill, spacingMm=2.2 (さらに強め)", () => {
    const u = FABRIC_PROFILES["knit-heavy"].underlayPolicy.fill();
    expect(u.kind).toBe("fill");
    if (u.kind === "fill") expect(u.spacingMm).toBeCloseTo(2.2, 5);
  });

  it.each<[FabricKind]>([["terry"], ["fleece"]])(
    "%s.fill() は kind=fill (tatami 相当: spacing を密に)",
    (kind) => {
      const u = FABRIC_PROFILES[kind].underlayPolicy.fill();
      expect(u.kind).toBe("fill");
      if (u.kind === "fill") {
        // tatami 代用として denim より密にしてあること
        expect(u.spacingMm).toBeLessThan(3.0);
      }
    },
  );

  it("leather.fill() は kind=edge-run (fill underlay は禁止)", () => {
    expect(FABRIC_PROFILES.leather.underlayPolicy.fill().kind).toBe("edge-run");
  });

  it.each<[FabricKind]>([["silk"], ["felt"], ["canvas"], ["twill"]])(
    "%s.fill() は kind=fill (中庸)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.fill().kind).toBe("fill");
    },
  );
});

describe("underlayPolicy.run (生地別)", () => {
  it.each<[FabricKind]>(ALL_KINDS.map((k) => [k] as [FabricKind]))(
    "%s.run() は kind=none (Phase 1 では run 用 underlay は付けない)",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.run().kind).toBe("none");
    },
  );
});
