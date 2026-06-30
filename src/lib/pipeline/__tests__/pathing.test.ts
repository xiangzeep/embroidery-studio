import { describe, it, expect } from "vitest";
import {
  shapesTouch,
  findBranches,
  chooseEntryExit,
  optimizeOrder,
  type EdgePoint,
} from "../pathing";
import type {
  BranchGroup,
  EmbroideryDesign,
  EmbroideryObject,
  Point2D,
  Shape,
} from "../types";

function makeObj(
  id: string,
  colorIndex: number,
  outer: Point2D[],
  kind: "fill" | "satin" | "run" = "fill",
): EmbroideryObject {
  return {
    id,
    colorIndex,
    rgb: [0, 0, 0],
    order: 0,
    kind,
    shape: { outer, holes: [] },
    props: { densityMm: 0.4, maxStitchMm: 7 },
  };
}

describe("pathing module skeleton", () => {
  it("exports shapesTouch / findBranches / chooseEntryExit", () => {
    expect(typeof shapesTouch).toBe("function");
    expect(typeof findBranches).toBe("function");
    expect(typeof chooseEntryExit).toBe("function");
  });
  it("BranchGroup は構造的に構築可能", () => {
    const g: BranchGroup = { objectIds: ["a"], colorIndex: 0 };
    expect(g.objectIds[0]).toBe("a");
  });
  it("EdgePoint は構造的に構築可能", () => {
    const ep: EdgePoint = { objId: "a", pt: [0, 0], side: "outer", index: 0 };
    expect(ep.side).toBe("outer");
  });
});

describe("shapesTouch — bbox pruning", () => {
  it("bbox が大きく離れていれば false", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [100, 100],
        [110, 100],
        [110, 110],
        [100, 110],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(false);
  });
  it("bbox 完全一致 + 線分も重複 → true", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(true);
  });
});

describe("shapesTouch — segment distance", () => {
  it("C 字のくぼみ内に b: bbox は overlap だが線分間距離は離れる → false", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 2],
        [3, 2],
        [3, 8],
        [10, 8],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [5, 4],
        [8, 4],
        [8, 6],
        [5, 6],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(false);
  });
});

describe("shapesTouch — touching / overlapping / epsilon", () => {
  it("辺を共有する 2 正方形 → true", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [10, 0],
        [20, 0],
        [20, 10],
        [10, 10],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(true);
  });
  it("距離 0.4 (epsilon=0.5 デフォルト) → true", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [10.4, 0],
        [20, 0],
        [20, 10],
        [10.4, 10],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(true);
  });
  it("距離 0.6 (epsilon=0.5 デフォルト) → false", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [10.6, 0],
        [20, 0],
        [20, 10],
        [10.6, 10],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b)).toBe(false);
  });
  it("epsilon=1.0 なら距離 0.6 は true", () => {
    const a: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const b: Shape = {
      outer: [
        [10.6, 0],
        [20, 0],
        [20, 10],
        [10.6, 10],
      ],
      holes: [],
    };
    expect(shapesTouch(a, b, 1.0)).toBe(true);
  });
});

describe("findBranches", () => {
  it("空配列 → 空配列", () => {
    expect(findBranches([])).toEqual([]);
  });

  it("同色 3 object が直線接触 → 1 group", () => {
    const a = makeObj("a", 0, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const b = makeObj("b", 0, [
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
    ]);
    const c = makeObj("c", 0, [
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
    ]);
    expect(findBranches([a, b, c])).toEqual([
      { objectIds: ["a", "b", "c"], colorIndex: 0 },
    ]);
  });

  it("色が異なれば接触していても別 group", () => {
    const a = makeObj("a", 0, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const b = makeObj("b", 1, [
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
    ]);
    expect(findBranches([a, b])).toEqual([
      { objectIds: ["a"], colorIndex: 0 },
      { objectIds: ["b"], colorIndex: 1 },
    ]);
  });

  it("孤立 object は 1 要素 group として返される", () => {
    const a = makeObj("a", 0, [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ]);
    const b = makeObj("b", 0, [
      [100, 100],
      [105, 100],
      [105, 105],
      [100, 105],
    ]);
    const r = findBranches([a, b]);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ objectIds: ["a"], colorIndex: 0 });
    expect(r[1]).toEqual({ objectIds: ["b"], colorIndex: 0 });
  });

  it("出力順は最小入力 index 昇順で決定的", () => {
    const a = makeObj("a", 0, [
      [50, 0],
      [60, 0],
      [60, 10],
      [50, 10],
    ]);
    const b = makeObj("b", 0, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const c = makeObj("c", 0, [
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
    ]);
    const r = findBranches([a, b, c]);
    expect(r).toEqual([
      { objectIds: ["a"], colorIndex: 0 },
      { objectIds: ["b", "c"], colorIndex: 0 },
    ]);
  });

  it("入力 objects を mutate しない (純関数)", () => {
    const a = makeObj("a", 0, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const b = makeObj("b", 0, [
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
    ]);
    const snapshot = JSON.parse(JSON.stringify([a, b]));
    findBranches([a, b]);
    expect([a, b]).toEqual(snapshot);
  });
});

describe("chooseEntryExit (run)", () => {
  const runObj = (outer: Point2D[]): EmbroideryObject =>
    makeObj("run-1", 0, outer, "run");

  it("prevExit に近い端点が entry、反対端が exit", () => {
    const obj = runObj([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    const r = chooseEntryExit(obj, [-5, 0]);
    expect(r.entry.pt).toEqual([0, 0]);
    expect(r.entry.objId).toBe("run-1");
    expect(r.entry.side).toBe("outer");
    expect(r.entry.index).toBe(0);
    expect(r.exit.pt).toEqual([20, 0]);
    expect(r.exit.index).toBe(2);
  });

  it("prevExit が反対側なら entry/exit が反転", () => {
    const obj = runObj([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    const r = chooseEntryExit(obj, [25, 0]);
    expect(r.entry.pt).toEqual([20, 0]);
    expect(r.exit.pt).toEqual([0, 0]);
  });

  it("等距離なら index=0 を entry (決定性)", () => {
    const obj = runObj([
      [0, 0],
      [10, 0],
    ]);
    const r = chooseEntryExit(obj, [5, 100]);
    expect(r.entry.pt).toEqual([0, 0]);
    expect(r.exit.pt).toEqual([10, 0]);
  });
});

describe("chooseEntryExit (satin)", () => {
  const satinObj = (outer: Point2D[]): EmbroideryObject =>
    makeObj("sat-1", 0, outer, "satin");

  it("X 方向細長 satin: prevExit=(-5, 0.5) → entry x≒0, exit x≒20", () => {
    const obj = satinObj([
      [0, 0],
      [20, 0],
      [20, 1],
      [0, 1],
    ]);
    const r = chooseEntryExit(obj, [-5, 0.5]);
    expect(r.entry.pt[0]).toBeCloseTo(0);
    expect(r.exit.pt[0]).toBeCloseTo(20);
    expect(Math.abs(r.entry.pt[0] - r.exit.pt[0])).toBeGreaterThan(15);
  });

  it("Y 方向細長 satin: 縦方向に長軸を認識", () => {
    const obj = satinObj([
      [0, 0],
      [1, 0],
      [1, 20],
      [0, 20],
    ]);
    const r = chooseEntryExit(obj, [0.5, -5]);
    expect(r.entry.pt[1]).toBeCloseTo(0);
    expect(r.exit.pt[1]).toBeCloseTo(20);
  });
});

describe("chooseEntryExit (fill)", () => {
  const fillObj = (outer: Point2D[]): EmbroideryObject =>
    makeObj("fill-1", 0, outer, "fill");

  it("正方形 fill: prevExit=(-5,-5) → entry=(0,0), exit=(10,10)", () => {
    const obj = fillObj([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const r = chooseEntryExit(obj, [-5, -5]);
    expect(r.entry.pt).toEqual([0, 0]);
    expect(r.exit.pt).toEqual([10, 10]);
  });

  it("右上 prevExit → entry=(10,10), exit=(0,0)", () => {
    const obj = fillObj([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const r = chooseEntryExit(obj, [15, 15]);
    expect(r.entry.pt).toEqual([10, 10]);
    expect(r.exit.pt).toEqual([0, 0]);
  });
});

const fillBox = (
  id: string,
  x: number,
  y: number,
  size = 4,
  colorIndex = 0,
): EmbroideryObject => ({
  id,
  kind: "fill",
  colorIndex,
  rgb: [0, 0, 0],
  shape: {
    outer: [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    holes: [],
  },
  props: { densityMm: 0.4, maxStitchMm: 7 },
  order: 0,
});

describe("optimizeOrder — 単一色直線配置", () => {
  it("入力 [right, middle, left] でも結果は order [left=0, middle=1, right=2]", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("right", 60, 0), order: 0 },
        { ...fillBox("middle", 30, 0), order: 1 },
        { ...fillBox("left", 0, 0), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    const ids = r.objects
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => o.id);
    expect(ids).toEqual(["left", "middle", "right"]);
  });

  it("出力 objects は order 昇順でソート済み", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("c", 20, 0), order: 0 },
        { ...fillBox("a", 0, 0), order: 1 },
        { ...fillBox("b", 10, 0), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    for (let i = 1; i < r.objects.length; i++) {
      expect(r.objects[i].order).toBeGreaterThan(r.objects[i - 1].order);
    }
  });

  it("入力 design / objects を mutate しない", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("a", 0, 0), order: 0 },
        { ...fillBox("b", 50, 0), order: 1 },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(design));
    optimizeOrder(design);
    expect(design).toEqual(snapshot);
  });

  it("空 objects → 空配列", () => {
    const design: EmbroideryDesign = {
      widthMm: 10,
      heightMm: 10,
      fabric: { kind: "denim" } as never,
      objects: [],
    };
    expect(optimizeOrder(design).objects).toEqual([]);
  });

  it("id 集合は完全保持", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("a", 10, 0), order: 0 },
        { ...fillBox("b", 0, 0), order: 1 },
        { ...fillBox("c", 20, 0), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    expect(r.objects).toHaveLength(3);
    expect(new Set(r.objects.map((o) => o.id))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });
});

describe("optimizeOrder — 色境界保護", () => {
  it("colorIndex 順に block 化 (同色をまたいで別色を挟まない)", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("c0-far", 90, 0, 4, 0), order: 0 },
        { ...fillBox("c1-near", 10, 0, 4, 1), order: 1 },
        { ...fillBox("c0-near", 0, 0, 4, 0), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    const sorted = r.objects.slice().sort((a, b) => a.order - b.order);
    expect(sorted.map((o) => o.colorIndex)).toEqual([0, 0, 1]);
    const c0 = sorted.filter((o) => o.colorIndex === 0).map((o) => o.id);
    expect(c0).toEqual(["c0-near", "c0-far"]);
  });
});

describe("optimizeOrder — locked 保持", () => {
  it("locked=true の object は元の order を保持し、再採番されない", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("locked-mid", 30, 0), order: 5, locked: true },
        { ...fillBox("a", 0, 0), order: 1 },
        { ...fillBox("b", 60, 0), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    const locked = r.objects.find((o) => o.id === "locked-mid")!;
    expect(locked.order).toBe(5);
    expect(locked.locked).toBe(true);

    const a = r.objects.find((o) => o.id === "a")!;
    const b = r.objects.find((o) => o.id === "b")!;
    expect(a.order).not.toBe(5);
    expect(b.order).not.toBe(5);
    expect(a.order).not.toBe(b.order);
  });

  it("全 object が locked なら元の order を保持", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("a", 50, 0), order: 10, locked: true },
        { ...fillBox("b", 0, 0), order: 20, locked: true },
      ],
    };
    const r = optimizeOrder(design);
    expect(r.objects.find((o) => o.id === "a")!.order).toBe(10);
    expect(r.objects.find((o) => o.id === "b")!.order).toBe(20);
  });

  it("locked と非 locked の order が衝突しない", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("L", 50, 0), order: 0, locked: true },
        { ...fillBox("a", 0, 0), order: 1 },
        { ...fillBox("b", 10, 0), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    const orders = r.objects.map((o) => o.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe("optimizeOrder — branch group 連携", () => {
  it("接触する 2 object は同じ branch group 内で連続 order される", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 20,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("a", 0, 0, 10), order: 0 },
        { ...fillBox("b", 10.2, 0, 10), order: 1 },
        { ...fillBox("c", 40, 0, 5), order: 2 },
      ],
    };
    const groups = findBranches(design.objects);
    expect(groups).toHaveLength(2);

    const r = optimizeOrder(design);
    const sorted = r.objects.slice().sort((x, y) => x.order - y.order);
    const ids = sorted.map((o) => o.id);
    const idxA = ids.indexOf("a");
    const idxB = ids.indexOf("b");
    expect(Math.abs(idxA - idxB)).toBe(1);
  });

  it("複数 branch group が同色内で順序付けされる (group 間も NN)", () => {
    const design: EmbroideryDesign = {
      widthMm: 100,
      heightMm: 50,
      fabric: { kind: "denim" } as never,
      objects: [
        { ...fillBox("a", 0, 0, 5), order: 0 },
        { ...fillBox("b", 5.2, 0, 5), order: 1 },
        { ...fillBox("c", 60, 0, 5), order: 2 },
      ],
    };
    const r = optimizeOrder(design);
    const sorted = r.objects
      .slice()
      .sort((x, y) => x.order - y.order)
      .map((o) => o.id);
    expect(sorted).toEqual(["a", "b", "c"]);
  });
});
