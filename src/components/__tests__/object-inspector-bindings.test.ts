import { describe, expect, it } from "vitest";
import {
  applyKindChange,
  applyPropsChange,
  applyUnderlayKindChange,
} from "../object-inspector-bindings";
import type { EmbroideryObject } from "@/lib/pipeline/types";

function makeObj(overrides: Partial<EmbroideryObject> = {}): EmbroideryObject {
  return {
    id: "test-1",
    kind: "fill",
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
    props: { densityMm: 1, maxStitchMm: 7, angleDeg: 45 },
    order: 0,
    ...overrides,
  };
}

describe("applyKindChange", () => {
  it("kind のみ含む patch を返す (props 変更なし)", () => {
    const patch = applyKindChange("satin");
    expect(patch).toEqual({ kind: "satin" });
  });
});

describe("applyPropsChange", () => {
  it("既存 props に shallow merge した props を返す", () => {
    const obj = makeObj({ props: { densityMm: 1, maxStitchMm: 7, angleDeg: 90 } });
    const patch = applyPropsChange(obj, { densityMm: 0.5 });
    expect(patch.props).toEqual({ densityMm: 0.5, maxStitchMm: 7, angleDeg: 90 });
  });

  it("複数フィールドを同時に merge", () => {
    const obj = makeObj();
    const patch = applyPropsChange(obj, { angleDeg: 0, pullCompMm: 0.2 });
    expect(patch.props?.angleDeg).toBe(0);
    expect(patch.props?.pullCompMm).toBe(0.2);
    expect(patch.props?.densityMm).toBe(1); // 既存維持
  });
});

describe("applyUnderlayKindChange", () => {
  it("kind=none で UnderlayConfig=none を作る", () => {
    const obj = makeObj();
    const patch = applyUnderlayKindChange(obj, "none");
    expect(patch.props?.underlay).toEqual({ kind: "none" });
  });

  it("kind=edge-run でデフォルト insetMm/stitchLenMm を補う", () => {
    const obj = makeObj();
    const patch = applyUnderlayKindChange(obj, "edge-run");
    expect(patch.props?.underlay).toEqual({
      kind: "edge-run",
      insetMm: 0.3,
      stitchLenMm: 2.0,
    });
  });

  it("kind=center-run でデフォルト stitchLenMm を補う", () => {
    const obj = makeObj();
    const patch = applyUnderlayKindChange(obj, "center-run");
    expect(patch.props?.underlay).toEqual({ kind: "center-run", stitchLenMm: 2.0 });
  });

  it("kind=zigzag でデフォルト spacingMm/insetMm を補う", () => {
    const obj = makeObj();
    const patch = applyUnderlayKindChange(obj, "zigzag");
    expect(patch.props?.underlay).toEqual({
      kind: "zigzag",
      spacingMm: 1.5,
      insetMm: 0.3,
    });
  });

  it("kind=fill でデフォルト angleDeg/spacingMm を補う", () => {
    const obj = makeObj();
    const patch = applyUnderlayKindChange(obj, "fill");
    expect(patch.props?.underlay).toEqual({
      kind: "fill",
      angleDeg: 0,
      spacingMm: 2.5,
    });
  });

  it("既存 underlay と同じ kind に切替なら既存値を維持", () => {
    const obj = makeObj({
      props: {
        densityMm: 1,
        maxStitchMm: 7,
        underlay: { kind: "edge-run", insetMm: 0.7, stitchLenMm: 3.0 },
      },
    });
    const patch = applyUnderlayKindChange(obj, "edge-run");
    expect(patch.props?.underlay).toEqual({
      kind: "edge-run",
      insetMm: 0.7,
      stitchLenMm: 3.0,
    });
  });

  it("他フィールド (densityMm 等) は既存維持", () => {
    const obj = makeObj({
      props: { densityMm: 0.7, maxStitchMm: 5, angleDeg: 30 },
    });
    const patch = applyUnderlayKindChange(obj, "none");
    expect(patch.props?.densityMm).toBe(0.7);
    expect(patch.props?.maxStitchMm).toBe(5);
    expect(patch.props?.angleDeg).toBe(30);
  });
});
