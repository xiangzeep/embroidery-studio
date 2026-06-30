import { describe, it, expect } from "vitest";
import {
  createDefaultObjectProps,
  createEmptyDesign,
  serializeDesign,
  deserializeDesign,
} from "../design";
import { makeDefaultConfig } from "../config";
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
  it("adds outlineFontStrategy to default conversion config", () => {
    const config = makeDefaultConfig("denim");
    expect(config.outlineFontStrategy).toBe("auto");
  });

  it("translated case", () => {
    const p = createDefaultObjectProps("run") satisfies ObjectProps;
    expect(p.angleDeg).toBeUndefined();
    expect(p.densityMm).toBeGreaterThan(0);
    expect(p.maxStitchMm).toBeGreaterThan(0);
  });

  it("translated case", () => {
    const p = createDefaultObjectProps("satin");
    expect(p.angleDeg).toBe(0);
  });

  it("translated case", () => {
    const p = createDefaultObjectProps("fill");
    expect(p.angleDeg).toBe(45);
  });

  it("translated case", () => {
    const a = createDefaultObjectProps("fill");
    const b = createDefaultObjectProps("fill");
    expect(a).not.toBe(b);
    a.densityMm = 999;
    expect(b.densityMm).not.toBe(999);
  });
});

describe("createEmptyDesign", () => {
  it("translated case", () => {
    const d = createEmptyDesign({ widthMm: 100, heightMm: 80, fabric: stubFabric }) satisfies EmbroideryDesign;
    expect(d.widthMm).toBe(100);
    expect(d.heightMm).toBe(80);
    expect(d.objects).toEqual([]);
  });

  it("translated case", () => {
    const d = createEmptyDesign({ widthMm: 50, heightMm: 50, fabric: stubFabric });
    expect(d.fabric).toBe(stubFabric);
  });

  it("translated case", () => {
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

  it("translated case", () => {
    const s = serializeDesign(sample);
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it("translated case", () => {
    const s = serializeDesign(sample);
    expect(s.fabric).toEqual({ kind: "denim" });
  });

  it("translated case", () => {
    const s = serializeDesign(sample);
    const json = JSON.stringify(s);
    const restored = deserializeDesign(JSON.parse(json), fabricResolver);
    expect(restored.objects).toEqual(sample.objects);
    expect(restored.widthMm).toBe(sample.widthMm);
    expect(restored.heightMm).toBe(sample.heightMm);
    expect(restored.fabric).toBe(stubFabric);
  });

  it("preserves strokeRole and strokeOverride in pipeline design serialization", () => {
    const sampleWithStroke: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 80,
      fabric: stubFabric,
      objects: [
        {
          id: "stroke-a",
          kind: "run",
          colorIndex: 0,
          rgb: [10, 20, 30],
          shape: {
            outer: [[0, 0], [10, 0], [10, 1], [0, 1]],
            holes: [],
          },
          props: {
            densityMm: 0.4,
            maxStitchMm: 4,
          },
          strokeRole: "outline",
          strokeOverride: "force-run",
          order: 0,
        },
      ],
    };

    const restored = deserializeDesign(
      JSON.parse(JSON.stringify(serializeDesign(sampleWithStroke))),
      fabricResolver,
    );

    expect(restored.objects[0].strokeRole).toBe("outline");
    expect(restored.objects[0].strokeOverride).toBe("force-run");
  });

  it("translated case", () => {
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

  it("translated case", () => {
    const s = serializeDesign(sample);
    const r = deserializeDesign(JSON.parse(JSON.stringify(s)), fabricResolver);
    expect(r.objects[0].props.pullCompPerSideMm).toEqual({ left: 0.1, right: 0.2 });
  });

  it("translated case", () => {
    const s = serializeDesign(sample);
    const restored = deserializeDesign(s, fabricResolver);
    expect(restored.objects).not.toBe(s.objects);
    expect(restored.objects[0]).not.toBe(s.objects[0]);
    s.objects[0].colorIndex = 999;
    expect(restored.objects[0].colorIndex).toBe(0);
  });
});
