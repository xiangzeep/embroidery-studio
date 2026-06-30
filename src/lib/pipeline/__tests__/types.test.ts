import { describe, it, expect } from "vitest";
import type {
  ObjectKind,
  ObjectProps,
  UnderlayConfig,
  EmbroideryObject,
  EmbroideryDesign,
  FabricProfile,
} from "../types";

describe("ObjectKind", () => {
  it("ObjectKind は run/satin/fill の 3 値を受理する", () => {
    const kinds = ["run", "satin", "fill"] as const satisfies readonly ObjectKind[];
    expect(kinds).toHaveLength(3);
  });
});

describe("EmbroideryObject", () => {
  it("EmbroideryObject (run) は最小フィールドで構築できる", () => {
    const obj = {
      id: "o1",
      kind: "run",
      colorIndex: 0,
      rgb: [0, 0, 0],
      shape: { outer: [[0, 0], [10, 0]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 4 },
      order: 0,
    } satisfies EmbroideryObject;
    expect(obj.kind).toBe("run");
  });

  it("EmbroideryObject (satin) は angleDeg を含めて構築できる", () => {
    const obj = {
      id: "o2",
      kind: "satin",
      colorIndex: 1,
      rgb: [255, 0, 0],
      shape: { outer: [[0, 0], [10, 0], [10, 2], [0, 2]], holes: [] },
      props: { densityMm: 0.4, maxStitchMm: 7, angleDeg: 0 },
      order: 1,
    } satisfies EmbroideryObject;
    expect(obj.props.angleDeg).toBe(0);
  });

  it("EmbroideryObject (fill) は holes を持つ Shape を保持できる", () => {
    const obj = {
      id: "o3",
      kind: "fill",
      colorIndex: 2,
      rgb: [0, 128, 0],
      shape: {
        outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
        holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      },
      props: { densityMm: 0.4, maxStitchMm: 4, angleDeg: 45 },
      order: 2,
    } satisfies EmbroideryObject;
    expect(obj.shape.holes).toHaveLength(1);
  });
});

describe("UnderlayConfig", () => {
  it("UnderlayConfig は none/edge-run/center-run/zigzag/fill の 5 種別を表現できる", () => {
    const u1 = { kind: "none" } satisfies UnderlayConfig;
    const u2 = { kind: "edge-run", insetMm: 0.5, stitchLenMm: 2 } satisfies UnderlayConfig;
    const u3 = { kind: "center-run", stitchLenMm: 2 } satisfies UnderlayConfig;
    const u4 = { kind: "zigzag", spacingMm: 2, insetMm: 0.5 } satisfies UnderlayConfig;
    const u5 = { kind: "fill", angleDeg: 90, spacingMm: 3 } satisfies UnderlayConfig;
    expect([u1, u2, u3, u4, u5].map((u) => u.kind)).toEqual([
      "none", "edge-run", "center-run", "zigzag", "fill",
    ]);
  });
});

describe("EmbroideryDesign", () => {
  it("EmbroideryDesign は widthMm/heightMm/fabric/objects フィールドを持つ", () => {
    const fabric: FabricProfile = {
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
    const design = {
      widthMm: 100,
      heightMm: 80,
      fabric,
      objects: [],
    } satisfies EmbroideryDesign;
    expect(design.objects).toHaveLength(0);
  });
});
