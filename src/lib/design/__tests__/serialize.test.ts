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
  it("元の design と等価な構造に復元される", () => {
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

  it("schemaVersion を含む", () => {
    const json = serializeDesign(makeDesign());
    const obj = JSON.parse(json);
    expect(obj.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("fabric override がない場合は fabricOverrides を含まない", () => {
    const json = serializeDesign(makeDesign());
    const obj = JSON.parse(json);
    expect(obj.fabricOverrides).toBeUndefined();
  });

  it("fabric override がある場合は fabricOverrides で保存・復元される", () => {
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
    // 他フィールド (関数含む) は baseline 由来
    expect(typeof restored.fabric.underlayPolicy.fill).toBe("function");
  });
});

describe("deserializeDesign — error handling", () => {
  it("不正 JSON は SerializeError(invalid-json)", () => {
    expect(() => deserializeDesign("{not-json")).toThrowError(SerializeError);
    try {
      deserializeDesign("{not-json");
    } catch (e) {
      expect((e as SerializeError).reason).toBe("invalid-json");
    }
  });

  it("schemaVersion 不一致は unsupported-version", () => {
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

  it("必須フィールド欠如は missing-field", () => {
    const json = JSON.stringify({ schemaVersion: 1, widthMm: 100 });
    try {
      deserializeDesign(json);
      expect.fail("should throw");
    } catch (e) {
      expect((e as SerializeError).reason).toBe("missing-field");
    }
  });

  it("未知 fabricKind は unknown-fabric", () => {
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
