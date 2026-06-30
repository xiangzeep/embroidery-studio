import { describe, expect, it } from "vitest";
import { reorderByDrag, sortByOrder } from "../sewing-order-helpers";
import type { EmbroideryObject } from "@/lib/pipeline/types";

function makeObj(id: string, order: number): EmbroideryObject {
  return {
    id,
    kind: "fill",
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
    props: { densityMm: 1, maxStitchMm: 7 },
    order,
  };
}

describe("sortByOrder", () => {
  it("order 昇順にソートしたコピーを返す (入力非破壊)", () => {
    const input = [makeObj("c", 2), makeObj("a", 0), makeObj("b", 1)];
    const out = sortByOrder(input);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
    // 入力非破壊
    expect(input.map((o) => o.id)).toEqual(["c", "a", "b"]);
  });

  it("空配列はそのまま空", () => {
    expect(sortByOrder([])).toEqual([]);
  });
});

describe("reorderByDrag", () => {
  const objs = [makeObj("a", 0), makeObj("b", 1), makeObj("c", 2)];

  it("activeId === overId なら現状維持", () => {
    expect(reorderByDrag(objs, "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("先頭→末尾の移動", () => {
    expect(reorderByDrag(objs, "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("末尾→先頭の移動", () => {
    expect(reorderByDrag(objs, "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("隣接 swap", () => {
    expect(reorderByDrag(objs, "b", "a")).toEqual(["b", "a", "c"]);
  });

  it("不正 activeId は throw", () => {
    expect(() => reorderByDrag(objs, "zzz", "a")).toThrow(/unknown activeId/);
  });

  it("不正 overId は throw", () => {
    expect(() => reorderByDrag(objs, "a", "zzz")).toThrow(/unknown overId/);
  });

  it("order がソート前と一致しなくても order 昇順で扱う", () => {
    const shuffled = [makeObj("c", 2), makeObj("a", 0), makeObj("b", 1)];
    // ソート結果 [a, b, c] に対する操作
    expect(reorderByDrag(shuffled, "a", "c")).toEqual(["b", "c", "a"]);
  });
});
