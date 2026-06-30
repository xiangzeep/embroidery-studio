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
  it("translated case", () => {
    const input = [makeObj("c", 2), makeObj("a", 0), makeObj("b", 1)];
    const out = sortByOrder(input);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
    // input is not mutated
    expect(input.map((o) => o.id)).toEqual(["c", "a", "b"]);
  });

  it("translated case", () => {
    expect(sortByOrder([])).toEqual([]);
  });
});

describe("reorderByDrag", () => {
  const objs = [makeObj("a", 0), makeObj("b", 1), makeObj("c", 2)];

  it("translated case", () => {
    expect(reorderByDrag(objs, "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("translated case", () => {
    expect(reorderByDrag(objs, "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("translated case", () => {
    expect(reorderByDrag(objs, "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("隣接 swap", () => {
    expect(reorderByDrag(objs, "b", "a")).toEqual(["b", "a", "c"]);
  });

  it("translated case", () => {
    expect(() => reorderByDrag(objs, "zzz", "a")).toThrow(/unknown activeId/);
  });

  it("translated case", () => {
    expect(() => reorderByDrag(objs, "a", "zzz")).toThrow(/unknown overId/);
  });

  it("translated case", () => {
    const shuffled = [makeObj("c", 2), makeObj("a", 0), makeObj("b", 1)];
    // English note.
    expect(reorderByDrag(shuffled, "a", "c")).toEqual(["b", "c", "a"]);
  });
});
