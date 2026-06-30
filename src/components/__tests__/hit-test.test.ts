import { describe, expect, it } from "vitest";
import { hitTestObject } from "../hit-test";
import { FABRIC_PROFILES } from "@/lib/pipeline/fabric";
import type {
  EmbroideryDesign,
  EmbroideryObject,
} from "@/lib/pipeline/types";

function makeObj(
  id: string,
  order: number,
  outer: [number, number][],
): EmbroideryObject {
  return {
    id,
    kind: "fill",
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape: { outer, holes: [] },
    props: { densityMm: 1, maxStitchMm: 7 },
    order,
  };
}

function design(objs: EmbroideryObject[]): EmbroideryDesign {
  return {
    widthMm: 100,
    heightMm: 100,
    fabric: FABRIC_PROFILES.denim,
    objects: objs,
  };
}

describe("hitTestObject", () => {
  it("design=null は常に null", () => {
    expect(hitTestObject(null, [5, 5])).toBe(null);
  });

  it("どの object にも含まれない点は null", () => {
    const d = design([makeObj("a", 0, [[0, 0], [10, 0], [10, 10], [0, 10]])]);
    expect(hitTestObject(d, [50, 50])).toBe(null);
  });

  it("単一 object 内の点はその id を返す", () => {
    const d = design([makeObj("a", 0, [[0, 0], [10, 0], [10, 10], [0, 10]])]);
    expect(hitTestObject(d, [5, 5])).toBe("a");
  });

  it("複数 object が重なる点は order が大きい (= 後に縫う = 上) 方を返す", () => {
    const d = design([
      makeObj("under", 0, [[0, 0], [20, 0], [20, 20], [0, 20]]),
      makeObj("over", 5, [[5, 5], [15, 5], [15, 15], [5, 15]]),
    ]);
    expect(hitTestObject(d, [10, 10])).toBe("over");
  });

  it("重なる領域外の点は下の object を返す", () => {
    const d = design([
      makeObj("under", 0, [[0, 0], [20, 0], [20, 20], [0, 20]]),
      makeObj("over", 5, [[15, 15], [25, 15], [25, 25], [15, 25]]),
    ]);
    expect(hitTestObject(d, [5, 5])).toBe("under");
  });
});
