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
  it("translated case", () => {
    expect(Object.keys(FABRIC_PROFILES).sort()).toEqual([...ALL_KINDS].sort());
  });

  it.each(ALL_KINDS)(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].defaultDensityMm).toBeCloseTo(EXPECTED[kind].density, 5);
    },
  );

  it.each(ALL_KINDS)(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].pullCompPerWidth).toBeCloseTo(EXPECTED[kind].pullPerWidth, 5);
    },
  );

  it.each(ALL_KINDS)(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].minPullCompMm).toBeCloseTo(EXPECTED[kind].minPull, 5);
    },
  );

  it.each(ALL_KINDS)(
    "Translated text",
    (kind) => {
      const v = FABRIC_PROFILES[kind].defaultPushCompMm;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.3);
    },
  );

  it.each(ALL_KINDS)("translated case", (kind) => {
    expect(FABRIC_PROFILES[kind].kind).toBe(kind);
  });
});

describe("getFabricProfile", () => {
  it("translated case", () => {
    expect(getFabricProfile("denim")).toBe(FABRIC_PROFILES.denim);
  });

  it("translated case", () => {
    expect(getFabricProfile("knit-heavy").kind).toBe("knit-heavy");
  });

  it("translated case", () => {
    // English note.
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
    ["Translated text", 0, 0.10],
    ["Translated text", 2, 0.10],
    ["Translated text", 4, 0.10],
    ["Translated text", 5, 0.125],
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

  it("translated case", () => {
    expect(pullCompForWidth(denim, -5)).toBeCloseTo(denim.minPullCompMm, 5);
  });

  it("translated case", () => {
    const result = pullCompForWidth(denim, Number.NaN);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeCloseTo(denim.minPullCompMm, 5);
  });
});

describe("underlayPolicy.satin (Width依存分岐)", () => {
  // denim family (denim / twill / canvas / felt): center-run → edge-run → zigzag
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(1.5).kind).toBe("center-run");
    },
  );
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "Translated text",
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
    "Translated text",
    (kind) => {
      const u = FABRIC_PROFILES[kind].underlayPolicy.satin(5.0);
      expect(u.kind).toBe("zigzag");
    },
  );

  // English note.
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(1.5).kind).toBe("center-run");
    },
  );
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(3.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind, number]>([
    ["knit-light", 1.0],
    ["knit-heavy", 1.0],
  ])("Translated text", (kind, expectedSpacing) => {
    const u = FABRIC_PROFILES[kind].underlayPolicy.satin(5.0);
    expect(u.kind).toBe("zigzag");
    if (u.kind === "zigzag") {
      expect(u.spacingMm).toBeCloseTo(expectedSpacing, 5);
      // English note.
      const denimZig = FABRIC_PROFILES.denim.underlayPolicy.satin(5.0);
      if (denimZig.kind === "zigzag") {
        expect(u.spacingMm).toBeLessThan(denimZig.spacingMm);
      }
    }
  });

  // English note.
  it.each<[FabricKind]>([["terry"], ["fleece"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(1.5).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["terry"], ["fleece"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(3.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["terry"], ["fleece"]])("%s.satin(5.0) returns zigzag", (kind) => {
    expect(FABRIC_PROFILES[kind].underlayPolicy.satin(5.0).kind).toBe("zigzag");
  });

  // leather: zigzag 禁止
  it("translated case", () => {
    expect(FABRIC_PROFILES.leather.underlayPolicy.satin(1.5).kind).toBe("center-run");
  });
  it("translated case", () => {
    expect(FABRIC_PROFILES.leather.underlayPolicy.satin(3.0).kind).toBe("edge-run");
  });
  it("translated case", () => {
    const u = FABRIC_PROFILES.leather.underlayPolicy.satin(5.0);
    expect(u.kind).toBe("edge-run");
    expect(u.kind).not.toBe("zigzag");
  });

  // English note.
  // English note.
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(2.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["denim"], ["twill"], ["canvas"], ["felt"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(4.0).kind).toBe("edge-run");
    },
  );
  // English note.
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(2.0).kind).toBe("edge-run");
    },
  );
  it.each<[FabricKind]>([["knit-light"], ["knit-heavy"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(4.0).kind).toBe("edge-run");
    },
  );

  // English note.
  it("translated case", () => {
    expect(FABRIC_PROFILES.silk.underlayPolicy.satin(1.5).kind).toBe("none");
  });
  it("translated case", () => {
    expect(FABRIC_PROFILES.silk.underlayPolicy.satin(3.0).kind).toBe("center-run");
  });
  it("translated case", () => {
    const u = FABRIC_PROFILES.silk.underlayPolicy.satin(5.0);
    expect(u.kind).toBe("edge-run");
    expect(u.kind).not.toBe("zigzag");
  });

  // English note.
  it.each<[FabricKind]>([["denim"], ["knit-light"], ["leather"], ["silk"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(Number.NaN).kind).not.toBe("zigzag");
    },
  );
  it.each<[FabricKind]>([["denim"], ["knit-light"], ["leather"], ["silk"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.satin(-1).kind).not.toBe("zigzag");
    },
  );
  it("translated case", () => {
    expect(FABRIC_PROFILES.denim.underlayPolicy.satin(Number.POSITIVE_INFINITY).kind).not.toBe(
      "zigzag",
    );
  });
});

describe("translated case", () => {
  it("translated case", () => {
    expect(Object.isFrozen(FABRIC_PROFILES.denim)).toBe(true);
  });
  it("translated case", () => {
    expect(Object.isFrozen(FABRIC_PROFILES.denim.underlayPolicy)).toBe(true);
  });
  it("translated case", () => {
    // English note.
    expect(() => {
      (FABRIC_PROFILES.denim as { defaultDensityMm: number }).defaultDensityMm = 99;
    }).toThrow();
  });
});

describe("underlayPolicy.fill (Fabric別)", () => {
  it("translated case", () => {
    const u = FABRIC_PROFILES.denim.underlayPolicy.fill();
    expect(u.kind).toBe("fill");
    if (u.kind === "fill") expect(u.spacingMm).toBeCloseTo(3.0, 5);
  });

  it("translated case", () => {
    const u = FABRIC_PROFILES["knit-light"].underlayPolicy.fill();
    expect(u.kind).toBe("fill");
    if (u.kind === "fill") expect(u.spacingMm).toBeCloseTo(2.5, 5);
  });

  it("translated case", () => {
    const u = FABRIC_PROFILES["knit-heavy"].underlayPolicy.fill();
    expect(u.kind).toBe("fill");
    if (u.kind === "fill") expect(u.spacingMm).toBeCloseTo(2.2, 5);
  });

  it.each<[FabricKind]>([["terry"], ["fleece"]])(
    "Translated text",
    (kind) => {
      const u = FABRIC_PROFILES[kind].underlayPolicy.fill();
      expect(u.kind).toBe("fill");
      if (u.kind === "fill") {
        // English note.
        expect(u.spacingMm).toBeLessThan(3.0);
      }
    },
  );

  it("translated case", () => {
    expect(FABRIC_PROFILES.leather.underlayPolicy.fill().kind).toBe("edge-run");
  });

  it.each<[FabricKind]>([["silk"], ["felt"], ["canvas"], ["twill"]])(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.fill().kind).toBe("fill");
    },
  );
});

describe("underlayPolicy.run (Fabric別)", () => {
  it.each<[FabricKind]>(ALL_KINDS.map((k) => [k] as [FabricKind]))(
    "Translated text",
    (kind) => {
      expect(FABRIC_PROFILES[kind].underlayPolicy.run().kind).toBe("none");
    },
  );
});
