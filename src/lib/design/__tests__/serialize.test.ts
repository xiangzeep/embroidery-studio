import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  SerializeError,
  deserializeDesign,
  serializeDesign,
} from "../serialize";
import { FABRIC_PROFILES } from "@/lib/pipeline/fabric";
import type {
  EmbroideryDesign,
  EmbroideryObject,
} from "@/lib/pipeline/types";

function makeObj(id: string): EmbroideryObject {
  return {
    id,
    kind: "fill",
    colorIndex: 0,
    rgb: [10, 20, 30],
    shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
    props: { densityMm: 1.2, maxStitchMm: 7, angleDeg: 45 },
    strokeRole: "area",
    strokeOverride: "use-global",
    order: 0,
  };
}

function makeDesign(): EmbroideryDesign {
  return {
    widthMm: 100,
    heightMm: 80,
    fabric: FABRIC_PROFILES.denim,
    objects: [makeObj("a"), { ...makeObj("b"), order: 1 }],
  };
}

describe("serializeDesign / deserializeDesign — round trip", () => {
  it("translated case", () => {
    const original = makeDesign();
    const json = serializeDesign(original);
    const restored = deserializeDesign(json);
    expect(restored.widthMm).toBe(original.widthMm);
    expect(restored.heightMm).toBe(original.heightMm);
    expect(restored.fabric.kind).toBe(original.fabric.kind);
    expect(restored.fabric.defaultDensityMm).toBe(original.fabric.defaultDensityMm);
    expect(typeof restored.fabric.underlayPolicy.satin).toBe("function"); // 関数復元
    expect(restored.objects).toEqual(original.objects);
  });

  it("translated case", () => {
    const json = serializeDesign(makeDesign());
    const obj = JSON.parse(json);
    expect(obj.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("translated case", () => {
    const json = serializeDesign(makeDesign());
    const obj = JSON.parse(json);
    expect(obj.fabricOverrides).toBeUndefined();
  });

  it("translated case", () => {
    const baseline = FABRIC_PROFILES.denim;
    const design: EmbroideryDesign = {
      ...makeDesign(),
      fabric: { ...baseline, defaultDensityMm: 0.3 },
    };
    const json = serializeDesign(design);
    const obj = JSON.parse(json);
    expect(obj.fabricOverrides?.defaultDensityMm).toBe(0.3);
    const restored = deserializeDesign(json);
    expect(restored.fabric.defaultDensityMm).toBe(0.3);
    // English note.
    expect(typeof restored.fabric.underlayPolicy.fill).toBe("function");
  });

  it("preserves strokeRole and strokeOverride in app design serialization", () => {
    const design: EmbroideryDesign = {
      ...makeDesign(),
      objects: [
        {
          ...makeObj("outline-1"),
          kind: "run",
          strokeRole: "outline",
          strokeOverride: "force-run",
        },
      ],
    };

    const json = serializeDesign(design);
    const restored = deserializeDesign(json);

    expect(restored.objects[0].strokeRole).toBe("outline");
    expect(restored.objects[0].strokeOverride).toBe("force-run");
  });
});

describe("deserializeDesign — error handling", () => {
  it("translated case", () => {
    expect(() => deserializeDesign("{not-json")).toThrowError(SerializeError);
    try {
      deserializeDesign("{not-json");
    } catch (e) {
      expect((e as SerializeError).reason).toBe("invalid-json");
    }
  });

  it("translated case", () => {
    const json = JSON.stringify({
      schemaVersion: 999,
      widthMm: 100,
      heightMm: 80,
      fabricKind: "denim",
      objects: [],
    });
    expect(() => deserializeDesign(json)).toThrowError(SerializeError);
    try {
      deserializeDesign(json);
    } catch (e) {
      expect((e as SerializeError).reason).toBe("unsupported-version");
    }
  });

  it("translated case", () => {
    const json = JSON.stringify({ schemaVersion: 1, widthMm: 100 });
    try {
      deserializeDesign(json);
      expect.fail("should throw");
    } catch (e) {
      expect((e as SerializeError).reason).toBe("missing-field");
    }
  });

  it("translated case", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      widthMm: 100,
      heightMm: 80,
      fabricKind: "alien-fabric",
      objects: [],
    });
    try {
      deserializeDesign(json);
      expect.fail("should throw");
    } catch (e) {
      expect((e as SerializeError).reason).toBe("unknown-fabric");
    }
  });
});
