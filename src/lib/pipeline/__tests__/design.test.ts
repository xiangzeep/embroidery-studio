import { describe, it, expect } from "vitest";
import {
  createDefaultObjectProps,
  createEmptyDesign,
  serializeDesign,
  deserializeDesign,
} from "../design";
import type {
  ObjectProps,
  FabricKind,
  FabricProfile,
  EmbroideryDesign,
  UnderlayConfig,
} from "../types";

const stubFabric: FabricProfile = {
  kind: "denim",
  defaultDensityMm: 0.4,
  pullCompPerWidth: 0.025,
  minPullCompMm: 0.1,
  defaultPushCompMm: 0,
  underlayPolicy: {
    satin: () => ({ kind: "none" }),
    fill: () => ({ kind: "none" }),
    run: () => ({ kind: "none" }),
  },
};

describe("createDefaultObjectProps", () => {
  it("createDefaultObjectProps(\"run\") は angleDeg を含まない", () => {
    const p = createDefaultObjectProps("run") satisfies ObjectProps;
    expect(p.angleDeg).toBeUndefined();
    expect(p.densityMm).toBeGreaterThan(0);
    expect(p.maxStitchMm).toBeGreaterThan(0);
  });

  it("createDefaultObjectProps(\"satin\") は angleDeg=0 を含む", () => {
    const p = createDefaultObjectProps("satin");
    expect(p.angleDeg).toBe(0);
  });

  it("createDefaultObjectProps(\"fill\") は angleDeg=45 を含む", () => {
    const p = createDefaultObjectProps("fill");
    expect(p.angleDeg).toBe(45);
  });

  it("createDefaultObjectProps の戻り値は呼び出しごとに別オブジェクト", () => {
    const a = createDefaultObjectProps("fill");
    const b = createDefaultObjectProps("fill");
    expect(a).not.toBe(b);
    a.densityMm = 999;
    expect(b.densityMm).not.toBe(999);
  });
});

describe("createEmptyDesign", () => {
  it("createEmptyDesign は objects=[] の Design を返す", () => {
    const d = createEmptyDesign({ widthMm: 100, heightMm: 80, fabric: stubFabric }) satisfies EmbroideryDesign;
    expect(d.widthMm).toBe(100);
    expect(d.heightMm).toBe(80);
    expect(d.objects).toEqual([]);
  });

  it("createEmptyDesign は渡した fabric をそのまま保持する", () => {
    const d = createEmptyDesign({ widthMm: 50, heightMm: 50, fabric: stubFabric });
    expect(d.fabric).toBe(stubFabric);
  });

  it("createEmptyDesign の戻り値の objects は呼び出しごとに独立", () => {
    const d1 = createEmptyDesign({ widthMm: 1, heightMm: 1, fabric: stubFabric });
    const d2 = createEmptyDesign({ widthMm: 1, heightMm: 1, fabric: stubFabric });
    expect(d1.objects).not.toBe(d2.objects);
  });
});

const fabricResolver = (_kind: FabricKind): FabricProfile => stubFabric;

describe("serializeDesign / deserializeDesign", () => {
  const sample: EmbroideryDesign = {
    widthMm: 100,
    heightMm: 80,
    fabric: stubFabric,
    objects: [
      {
        id: "a",
        kind: "fill",
        colorIndex: 0,
        rgb: [10, 20, 30],
        shape: {
          outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
          holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
        },
        props: {
          densityMm: 0.4,
          maxStitchMm: 4,
          angleDeg: 45,
          pullCompPerSideMm: { left: 0.1, right: 0.2 },
          underlay: { kind: "zigzag", spacingMm: 2, insetMm: 0.5 },
        },
        order: 0,
        locked: true,
      },
    ],
  };

  it("serializeDesign の結果は JSON.stringify 可能", () => {
    const s = serializeDesign(sample);
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it("serializeDesign は fabric.kind のみ残し underlayPolicy を含まない", () => {
    const s = serializeDesign(sample);
    expect(s.fabric).toEqual({ kind: "denim" });
  });

  it("serializeDesign → JSON.parse → deserializeDesign で objects が完全一致", () => {
    const s = serializeDesign(sample);
    const json = JSON.stringify(s);
    const restored = deserializeDesign(JSON.parse(json), fabricResolver);
    expect(restored.objects).toEqual(sample.objects);
    expect(restored.widthMm).toBe(sample.widthMm);
    expect(restored.heightMm).toBe(sample.heightMm);
    expect(restored.fabric).toBe(stubFabric);
  });

  it("ラウンドトリップで UnderlayConfig の 5 種別が保持される", () => {
    const variants: UnderlayConfig[] = [
      { kind: "none" },
      { kind: "edge-run", insetMm: 0.5, stitchLenMm: 2 },
      { kind: "center-run", stitchLenMm: 2 },
      { kind: "zigzag", spacingMm: 2, insetMm: 0.5 },
      { kind: "fill", angleDeg: 90, spacingMm: 3 },
    ];
    for (const u of variants) {
      const d: EmbroideryDesign = {
        ...sample,
        objects: [{ ...sample.objects[0], props: { ...sample.objects[0].props, underlay: u } }],
      };
      const r = deserializeDesign(JSON.parse(JSON.stringify(serializeDesign(d))), fabricResolver);
      expect(r.objects[0].props.underlay).toEqual(u);
    }
  });

  it("ラウンドトリップで pullCompPerSideMm が保持される", () => {
    const s = serializeDesign(sample);
    const r = deserializeDesign(JSON.parse(JSON.stringify(s)), fabricResolver);
    expect(r.objects[0].props.pullCompPerSideMm).toEqual({ left: 0.1, right: 0.2 });
  });

  it("deserializeDesign は s.objects を deep copy する（呼び出し元 mutation が漏れない）", () => {
    const s = serializeDesign(sample);
    const restored = deserializeDesign(s, fabricResolver);
    expect(restored.objects).not.toBe(s.objects);
    expect(restored.objects[0]).not.toBe(s.objects[0]);
    s.objects[0].colorIndex = 999;
    expect(restored.objects[0].colorIndex).toBe(0);
  });
});
