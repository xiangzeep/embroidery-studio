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

  it("初期値は design=null / selectedObjectId=null / editMode=select", () => {
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

  it("design を差し替えて以前の selectedObjectId が消えれば null にリセット", () => {
    const { setDesign, setSelectedObjectId } = designStore.getState();
    setDesign(makeDesign(["a", "b"]));
    setSelectedObjectId("a");
    expect(designStore.getState().selectedObjectId).toBe("a");
    setDesign(makeDesign(["c", "d"]));
    expect(designStore.getState().selectedObjectId).toBe(null);
  });

  it("selectedObjectId が新 design にも存在すれば保持", () => {
    const { setDesign, setSelectedObjectId } = designStore.getState();
    setDesign(makeDesign(["a", "b"]));
    setSelectedObjectId("a");
    setDesign(makeDesign(["a", "c"])); // 'a' は引き継がれる
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("design=null に戻すと selectedObjectId も null", () => {
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

  it("存在する id をセットできる", () => {
    designStore.getState().setSelectedObjectId("a");
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("存在しない id は no-op (state 不変)", () => {
    designStore.getState().setSelectedObjectId("a");
    designStore.getState().setSelectedObjectId("zzz");
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("null をセットすると常にクリア", () => {
    designStore.getState().setSelectedObjectId("a");
    designStore.getState().setSelectedObjectId(null);
    expect(designStore.getState().selectedObjectId).toBe(null);
  });

  it("design が null のとき何もしない", () => {
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

  it("対象 object の props を shallow merge する", () => {
    designStore.getState().updateObject("a", {
      props: { densityMm: 0.5, maxStitchMm: 5 },
    });
    const obj = designStore.getState().design!.objects[0];
    expect(obj.id).toBe("a");
    expect(obj.props.densityMm).toBe(0.5);
    expect(obj.props.maxStitchMm).toBe(5);
  });

  it("対象 object 以外は参照を保持 (React の再レンダ最小化)", () => {
    const before = designStore.getState().design!.objects[1];
    designStore.getState().updateObject("a", { order: 99 });
    const after = designStore.getState().design!.objects[1];
    expect(after).toBe(before); // 参照同一
  });

  it("design=null のとき no-op", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().updateObject("a", { order: 1 })).not
      .toThrow();
    expect(designStore.getState().design).toBe(null);
  });

  it("存在しない id は no-op", () => {
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

  it("id 配列の順で並び替え、order を 0..n-1 で再採番", () => {
    designStore.getState().reorderObjects(["c", "a", "b"]);
    const objs = designStore.getState().design!.objects;
    expect(objs.map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(objs.map((o) => o.order)).toEqual([0, 1, 2]);
  });

  it("長さ不一致は throw", () => {
    expect(() => designStore.getState().reorderObjects(["a", "b"])).toThrow();
  });

  it("未知 id を含む配列は throw", () => {
    expect(() => designStore.getState().reorderObjects(["a", "b", "zzz"]))
      .toThrow(/unknown id/);
  });

  it("重複 id を含む配列は throw", () => {
    expect(() => designStore.getState().reorderObjects(["a", "a", "b"]))
      .toThrow(/重複/);
  });

  it("design=null のとき throw", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().reorderObjects(["a"])).toThrow(
      /design is null/,
    );
  });
});

describe("designStore — setEditMode", () => {
  it("各モードに切替できる", () => {
    const { setEditMode } = designStore.getState();
    setEditMode("node");
    expect(designStore.getState().editMode).toBe("node");
    setEditMode("pen");
    expect(designStore.getState().editMode).toBe("pen");
    setEditMode("select");
    expect(designStore.getState().editMode).toBe("select");
  });
});

describe("designStore — removeObject (Phase 5 PR22)", () => {
  beforeEach(() => {
    designStore.setState({
      design: makeDesign(["a", "b", "c"]),
      selectedObjectId: null,
      editMode: "select",
    });
  });

  it("指定 id を削除し、他は順序保持", () => {
    designStore.getState().removeObject("b");
    const ids = designStore.getState().design!.objects.map((o) => o.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("選択中 id を削除すると selectedObjectId が null", () => {
    designStore.getState().setSelectedObjectId("b");
    designStore.getState().removeObject("b");
    expect(designStore.getState().selectedObjectId).toBe(null);
  });

  it("選択中以外を削除しても selectedObjectId は保持", () => {
    designStore.getState().setSelectedObjectId("a");
    designStore.getState().removeObject("c");
    expect(designStore.getState().selectedObjectId).toBe("a");
  });

  it("存在しない id は no-op", () => {
    const before = designStore.getState().design;
    designStore.getState().removeObject("zzz");
    expect(designStore.getState().design).toBe(before);
  });

  it("design=null は no-op (throw しない)", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().removeObject("a")).not.toThrow();
  });
});

describe("designStore — applyOptimizeOrder (Phase 5 PR22)", () => {
  it("design=null は no-op", () => {
    designStore.setState({ design: null });
    expect(() => designStore.getState().applyOptimizeOrder()).not.toThrow();
    expect(designStore.getState().design).toBe(null);
  });

  it("design が設定されていれば optimizeOrder を呼んで差し替える", () => {
    // optimizeOrder の純粋性は pathing.test.ts でカバー済み。
    // 本ケースでは design が新オブジェクトに差し替わることだけ確認。
    designStore.setState({
      design: makeDesign(["a", "b"]),
      selectedObjectId: null,
      editMode: "select",
      history: null,
      visualization: { showTravel: false, showJump: false, showTrim: false },
    });
    const before = designStore.getState().design;
    designStore.getState().applyOptimizeOrder();
    const after = designStore.getState().design;
    // 参照は異なる (optimizeOrder は新 design を返す)
    expect(after).not.toBe(before);
    // 中身の id 集合は同じ
    expect(after!.objects.map((o) => o.id).sort()).toEqual(["a", "b"]);
  });
});

describe("designStore — undo / redo (Phase 5 PR24)", () => {
  beforeEach(() => {
    designStore.setState({
      design: null,
      selectedObjectId: null,
      editMode: "select",
      history: null,
      visualization: { showTravel: false, showJump: false, showTrim: false },
    });
  });

  it("setDesign で history が新規作成される", () => {
    designStore.getState().setDesign(makeDesign(["a"]));
    const h = designStore.getState().history;
    expect(h).not.toBe(null);
    expect(h!.past).toEqual([]);
    expect(h!.future).toEqual([]);
  });

  it("updateObject 後に undo で前状態に戻り、redo で再度新状態に進める", () => {
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

  it("undo 不能な状態 (past 空) は no-op", () => {
    designStore.getState().setDesign(makeDesign(["a"]));
    const before = designStore.getState();
    designStore.getState().undo();
    // design/history どちらも変化なし
    expect(designStore.getState().design).toBe(before.design);
    expect(designStore.getState().history).toBe(before.history);
  });

  it("design=null での undo/redo は no-op (throw しない)", () => {
    designStore.setState({ design: null, history: null });
    expect(() => designStore.getState().undo()).not.toThrow();
    expect(() => designStore.getState().redo()).not.toThrow();
  });

  it("reorderObjects / removeObject / applyOptimizeOrder も history に積まれる", () => {
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

describe("designStore — visualization (Phase 5 PR24)", () => {
  it("setVisualization で flag を patch できる", () => {
    designStore.setState({
      visualization: { showTravel: false, showJump: false, showTrim: false },
    });
    designStore.getState().setVisualization({ showTravel: true });
    expect(designStore.getState().visualization).toEqual({
      showTravel: true,
      showJump: false,
      showTrim: false,
    });
    designStore.getState().setVisualization({ showJump: true, showTrim: true });
    expect(designStore.getState().visualization).toEqual({
      showTravel: true,
      showJump: true,
      showTrim: true,
    });
  });
});
