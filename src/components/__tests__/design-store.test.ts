import { beforeEach, describe, expect, it } from "vitest";
import { designStore } from "../design-store";
import { FABRIC_PROFILES } from "@/lib/pipeline/fabric";
import type {
  EmbroideryDesign,
  EmbroideryObject,
} from "@/lib/pipeline/types";

function makeObj(
  id: string,
  order: number,
  kind: "run" | "satin" | "fill" = "fill",
): EmbroideryObject {
  return {
    id,
    kind,
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
    props: { densityMm: 1, maxStitchMm: 7 },
    order,
  };
}

function makeDesign(ids: string[]): EmbroideryDesign {
  return {
    widthMm: 100,
    heightMm: 100,
    fabric: FABRIC_PROFILES.denim,
    objects: ids.map((id, i) => makeObj(id, i)),
  };
}

describe("designStore — initial state", () => {
  beforeEach(() => {
    designStore.setState({
      design: null,
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("translated case", () => {
    const s = designStore.getState();
    expect(s.design).toBe(null);
    expect(s.selectedObjectId).toBe(null);
    expect(s.editMode).toBe("select");
  });
});

describe("designStore — setDesign", () => {
  beforeEach(() => {
    designStore.setState({
      design: null,
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("translated case", () => {
    const { setDesign, setSelectedObjectId } = designStore.getState();
    setDesign(makeDesign(["a", "b"]));
    setSelectedObjectId("a");
    expect(designStore.getState().selectedObjectId).toBe("a");
    setDesign(makeDesign(["c", "d"]));
    expect(designStore.getState().selectedObjectId).toBe(null);
  });

  it("translated case", () => {
    const { setDesign, setSelectedObjectId } = designStore.getState();
    setDesign(makeDesign(["a", "b"]));
    setSelectedObjectId("a");
    setDesign(makeDesign(["a", "c"])); // English note.
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("translated case", () => {
    const { setDesign, setSelectedObjectId } = designStore.getState();
    setDesign(makeDesign(["a"]));
    setSelectedObjectId("a");
    setDesign(null);
    expect(designStore.getState().design).toBe(null);
    expect(designStore.getState().selectedObjectId).toBe(null);
  });
});

describe("designStore — setSelectedObjectId", () => {
  beforeEach(() => {
    designStore.setState({
      design: makeDesign(["a", "b"]),
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("translated case", () => {
    designStore.getState().setSelectedObjectId("a");
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("translated case", () => {
    designStore.getState().setSelectedObjectId("a");
    designStore.getState().setSelectedObjectId("zzz");
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("translated case", () => {
    designStore.getState().setSelectedObjectId("a");
    designStore.getState().setSelectedObjectId(null);
    expect(designStore.getState().selectedObjectId).toBe(null);
  });

  it("translated case", () => {
    designStore.setState({ design: null });
    designStore.getState().setSelectedObjectId("a");
    expect(designStore.getState().selectedObjectId).toBe(null);
  });
});

describe("designStore — updateObject", () => {
  beforeEach(() => {
    designStore.setState({
      design: makeDesign(["a", "b"]),
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("translated case", () => {
    designStore.getState().updateObject("a", {
      props: { densityMm: 0.5, maxStitchMm: 5 },
    });
    const obj = designStore.getState().design!.objects[0];
    expect(obj.id).toBe("a");
    expect(obj.props.densityMm).toBe(0.5);
    expect(obj.props.maxStitchMm).toBe(5);
  });

  it("translated case", () => {
    const before = designStore.getState().design!.objects[1];
    designStore.getState().updateObject("a", { order: 99 });
    const after = designStore.getState().design!.objects[1];
    expect(after).toBe(before); // same reference
  });

  it("preserves strokeOverride when object props change", () => {
    designStore.getState().updateObject("a", {
      props: { densityMm: 0.8, maxStitchMm: 5 },
      strokeOverride: "use-global",
    });
    const obj = designStore.getState().design!.objects[0];
    expect(obj.strokeOverride).toBe("use-global");
    expect(obj.props.densityMm).toBe(0.8);
  });

  it("translated case", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().updateObject("a", { order: 1 })).not
      .toThrow();
    expect(designStore.getState().design).toBe(null);
  });

  it("translated case", () => {
    const before = designStore.getState().design;
    designStore.getState().updateObject("zzz", { order: 1 });
    expect(designStore.getState().design).toBe(before);
  });
});

describe("designStore — reorderObjects", () => {
  beforeEach(() => {
    designStore.setState({
      design: makeDesign(["a", "b", "c"]),
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("translated case", () => {
    designStore.getState().reorderObjects(["c", "a", "b"]);
    const objs = designStore.getState().design!.objects;
    expect(objs.map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(objs.map((o) => o.order)).toEqual([0, 1, 2]);
  });

  it("translated case", () => {
    expect(() => designStore.getState().reorderObjects(["a", "b"])).toThrow();
  });

  it("translated case", () => {
    expect(() => designStore.getState().reorderObjects(["a", "b", "zzz"]))
      .toThrow(/unknown id/);
  });

  it("translated case", () => {
    expect(() => designStore.getState().reorderObjects(["a", "a", "b"]))
      .toThrow(/duplicate/);
  });

  it("translated case", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().reorderObjects(["a"])).toThrow(
      /design is null/,
    );
  });
});

describe("designStore — setEditMode", () => {
  it("translated case", () => {
    const { setEditMode } = designStore.getState();
    setEditMode("node");
    expect(designStore.getState().editMode).toBe("node");
    setEditMode("pen");
    expect(designStore.getState().editMode).toBe("pen");
    setEditMode("select");
    expect(designStore.getState().editMode).toBe("select");
  });
});

describe("designStore removeObject", () => {
  beforeEach(() => {
    designStore.setState({
      design: makeDesign(["a", "b", "c"]),
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("translated case", () => {
    designStore.getState().removeObject("b");
    const ids = designStore.getState().design!.objects.map((o) => o.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("translated case", () => {
    designStore.getState().setSelectedObjectId("b");
    designStore.getState().removeObject("b");
    expect(designStore.getState().selectedObjectId).toBe(null);
  });

  it("translated case", () => {
    designStore.getState().setSelectedObjectId("a");
    designStore.getState().removeObject("c");
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("translated case", () => {
    const before = designStore.getState().design;
    designStore.getState().removeObject("zzz");
    expect(designStore.getState().design).toBe(before);
  });

  it("translated case", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().removeObject("a")).not.toThrow();
  });
});

describe("designStore applyOptimizeOrder", () => {
  it("translated case", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().applyOptimizeOrder()).not.toThrow();
    expect(designStore.getState().design).toBe(null);
  });

  it("translated case", () => {
    // English note.
    // English note.
    designStore.setState({
      design: makeDesign(["a", "b"]),
      selectedObjectId: null,
      editMode: "select",
      history: null,
      visualization: { showTravel: false, showJump: false, showTrim: false, showStitchTypes: false },
    });
    const before = designStore.getState().design;
    designStore.getState().applyOptimizeOrder();
    const after = designStore.getState().design;
    // English note.
    expect(after).not.toBe(before);
    // English note.
    expect(after!.objects.map((o) => o.id).sort()).toEqual(["a", "b"]);
  });
});

describe("designStore undo / redo", () => {
  beforeEach(() => {
    designStore.setState({
      design: null,
      selectedObjectId: null,
      editMode: "select",
      history: null,
      visualization: { showTravel: false, showJump: false, showTrim: false, showStitchTypes: false },
    });
  });

  it("translated case", () => {
    designStore.getState().setDesign(makeDesign(["a"]));
    const h = designStore.getState().history;
    expect(h).not.toBe(null);
    expect(h!.past).toEqual([]);
    expect(h!.future).toEqual([]);
  });

  it("translated case", () => {
    const { setDesign } = designStore.getState();
    setDesign(makeDesign(["a"]));
    const beforeUpdate = designStore.getState().design;
    designStore.getState().updateObject("a", {
      props: { densityMm: 0.5, maxStitchMm: 7 },
    });
    const afterUpdate = designStore.getState().design;
    expect(afterUpdate!.objects[0].props.densityMm).toBe(0.5);

    designStore.getState().undo();
    expect(designStore.getState().design).toEqual(beforeUpdate);

    designStore.getState().redo();
    expect(designStore.getState().design).toEqual(afterUpdate);
  });

  it("translated case", () => {
    designStore.getState().setDesign(makeDesign(["a"]));
    const before = designStore.getState();
    designStore.getState().undo();
    // English note.
    expect(designStore.getState().design).toBe(before.design);
    expect(designStore.getState().history).toBe(before.history);
  });

  it("translated case", () => {
    designStore.setState({ design: null, history: null });
    expect(() => designStore.getState().undo()).not.toThrow();
    expect(() => designStore.getState().redo()).not.toThrow();
  });

  it("translated case", () => {
    designStore.getState().setDesign(makeDesign(["a", "b", "c"]));
    expect(designStore.getState().history!.past.length).toBe(0);
    designStore.getState().reorderObjects(["c", "a", "b"]);
    expect(designStore.getState().history!.past.length).toBe(1);
    designStore.getState().removeObject("a");
    expect(designStore.getState().history!.past.length).toBe(2);
    designStore.getState().applyOptimizeOrder();
    expect(designStore.getState().history!.past.length).toBe(3);
  });
});

describe("designStore visualization", () => {
  it("translated case", () => {
    designStore.setState({
      visualization: { showTravel: false, showJump: false, showTrim: false, showStitchTypes: false },
    });
    designStore.getState().setVisualization({ showTravel: true });
    expect(designStore.getState().visualization).toEqual({
      showTravel: true,
      showJump: false,
      showTrim: false,
      showStitchTypes: false,
    });
    designStore.getState().setVisualization({ showJump: true, showTrim: true, showStitchTypes: true });
    expect(designStore.getState().visualization).toEqual({
      showTravel: true,
      showJump: true,
      showTrim: true,
      showStitchTypes: true,
    });
  });
});
