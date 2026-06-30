import { describe, it, expect } from "vitest";
import {
  __internal,
  applyPullCompensation,
  applyPushCompensation,
} from "../compensation";
import { getFabricProfile } from "../fabric";
import { analyzeShape } from "../geometry";
import type { EmbroideryObject, Shape } from "../types";

const denim = getFabricProfile("denim"); // pullCompPerWidth=0.025, minPullCompMm=0.10

function makeObj(
  kind: "satin" | "fill" | "run",
  shape: Shape,
  propsOverride: Partial<EmbroideryObject["props"]> = {},
): EmbroideryObject {
  return {
    id: "o1",
    kind,
    colorIndex: 0,
    rgb: [0, 0, 0],
    shape,
    order: 0,
    props: { densityMm: 0.4, maxStitchMm: 7, ...propsOverride },
  };
}

function bbox(p: [number, number][]) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY, minX, maxX, minY, maxY };
}

describe("resolvePullAmount", () => {
  const shape: Shape = {
    outer: [
      [0, 0],
      [30, 0],
      [30, 7],
      [0, 7],
    ],
    holes: [],
  };

  it("translated case", () => {
    const obj = makeObj("satin", shape, { pullCompMm: 0.25 });
    expect(__internal.resolvePullAmount(obj, denim)).toBeCloseTo(0.25, 5);
  });

  it("translated case", () => {
    const obj = makeObj("satin", shape, {
      pullCompPerSideMm: { left: 0.1, right: 0.3 },
    });
    expect(__internal.resolvePullAmount(obj, denim)).toBeCloseTo(0.2, 5);
  });

  it("translated case", () => {
    // short axis 7mm, denim -> max(0.10, 7*0.025) = 0.175mm
    const obj = makeObj("satin", shape);
    expect(__internal.resolvePullAmount(obj, denim)).toBeCloseTo(0.175, 3);
  });

  it("translated case", () => {
    const obj = makeObj("satin", shape, {
      pullCompMm: 0.5,
      pullCompPerSideMm: { left: 0.1, right: 0.2 },
    });
    expect(__internal.resolvePullAmount(obj, denim)).toBeCloseTo(0.5, 5);
  });
});

describe("offsetSatinByNormal", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 7],
        [0, 7],
      ],
      holes: [],
    };
    const out = __internal.offsetSatinByNormal(shape, 0.2);
    const b = bbox(out.outer);
    expect(b.h).toBeCloseTo(7.4, 1); // short axis = 7 + 2*0.2
    expect(b.w).toBeCloseTo(30, 1); // English note.
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 7],
        [0, 7],
      ],
      holes: [],
    };
    const out = __internal.offsetSatinByNormal(shape, 0);
    for (let i = 0; i < shape.outer.length; i++) {
      expect(out.outer[i][0]).toBeCloseTo(shape.outer[i][0], 5);
      expect(out.outer[i][1]).toBeCloseTo(shape.outer[i][1], 5);
    }
  });

  it("translated case", () => {
    const rad = Math.PI / 6;
    const cos = Math.cos(rad),
      sin = Math.sin(rad);
    const rot = (x: number, y: number): [number, number] => [
      x * cos - y * sin,
      x * sin + y * cos,
    ];
    const shape: Shape = {
      outer: [rot(0, 0), rot(30, 0), rot(30, 7), rot(0, 7)],
      holes: [],
    };
    const out = __internal.offsetSatinByNormal(shape, 0.2);
    const { shortSide } = analyzeShape(out.outer);
    expect(shortSide).toBeCloseTo(7.4, 1);
  });
});

describe("applyPullCompensation", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 5],
        [0, 5],
      ],
      holes: [],
    };
    const obj = makeObj("satin", shape, { pullCompMm: 0.2 });
    const r = applyPullCompensation(obj, denim);
    const b = bbox(r.shape.outer);
    expect(b.h).toBeCloseTo(5.4, 1);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 7],
        [0, 7],
      ],
      holes: [],
    };
    const obj = makeObj("satin", shape);
    const r = applyPullCompensation(obj, denim);
    const b = bbox(r.shape.outer);
    // amount = max(0.10, 7*0.025) = 0.175 -> short axis 7 + 0.35 = 7.35
    expect(b.h).toBeCloseTo(7.35, 1);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
      ],
      holes: [],
    };
    const obj = makeObj("run", shape, { pullCompMm: 0.2 });
    expect(applyPullCompensation(obj, denim)).toBe(obj);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const obj = makeObj("fill", shape, { pullCompMm: 0.2 });
    expect(applyPullCompensation(obj, denim)).not.toBe(obj);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 7],
        [0, 7],
      ],
      holes: [],
    };
    const snapshot = JSON.stringify(shape);
    const obj = makeObj("satin", shape, { pullCompMm: 0.2 });
    applyPullCompensation(obj, denim);
    expect(JSON.stringify(shape)).toBe(snapshot);
  });

  it("translated case", () => {
    const holes: [number, number][][] = [
      [
        [10, 2],
        [12, 2],
        [12, 4],
        [10, 4],
      ],
    ];
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 7],
        [0, 7],
      ],
      holes,
    };
    const obj = makeObj("satin", shape, { pullCompMm: 0.2 });
    const r = applyPullCompensation(obj, denim);
    expect(r.shape.holes).not.toBe(shape.holes);
    expect(r.shape.holes[0]).not.toBe(shape.holes[0]);
    expect(r.shape.holes).toEqual(shape.holes);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 5],
        [0, 5],
      ],
      holes: [],
    };
    const obj: EmbroideryObject = {
      id: "abc",
      kind: "satin",
      colorIndex: 3,
      rgb: [10, 20, 30],
      shape,
      order: 5,
      locked: true,
      props: { densityMm: 0.4, maxStitchMm: 7, pullCompMm: 0.2 },
    };
    const r = applyPullCompensation(obj, denim);
    expect(r.id).toBe("abc");
    expect(r.colorIndex).toBe(3);
    expect(r.rgb).toEqual([10, 20, 30]);
    expect(r.props).toEqual(obj.props);
    expect(r.order).toBe(5);
    expect(r.locked).toBe(true);
    expect(r.shape).not.toBe(shape);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 5],
        [0, 5],
      ],
      holes: [],
    };
    const obj = makeObj("satin", shape, {
      pullCompPerSideMm: { left: 0.1, right: 0.3 },
    });
    const r = applyPullCompensation(obj, denim);
    const b = bbox(r.shape.outer);
    expect(b.h).toBeCloseTo(5.4, 1); // 平均 0.2 → 5 + 0.4
  });
});

describe("applyPullCompensation for fill objects", () => {
  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      ],
    };
    const obj = makeObj("fill", shape, { pullCompMm: 0.2 });
    const r = applyPullCompensation(obj, denim);
    expect(r).not.toBe(obj);
    const ob = bbox(r.shape.outer);
    expect(ob.w).toBeCloseTo(10.4, 1);
    expect(r.shape.holes).toHaveLength(1);
    const hb = bbox(r.shape.holes[0]);
    expect(hb.w).toBeCloseTo(3.6, 1);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const obj = makeObj("fill", shape, { pullCompMm: 0.3 });
    const r = applyPullCompensation(obj, denim);
    expect(bbox(r.shape.outer).w).toBeCloseTo(10.6, 1);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [],
    };
    const obj = makeObj("fill", shape);
    const r = applyPullCompensation(obj, denim);
    // shortSide=10mm → max(0.10, 10*0.025)=0.25mm → w=10.5
    expect(bbox(r.shape.outer).w).toBeCloseTo(10.5, 1);
  });
});

describe("applyPushCompensation (overlap detection)", () => {
  const tenSquare: Shape = {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [],
  };

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    expect(applyPushCompensation(obj, [])).toBe(obj);
  });

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const far: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [100, 100],
          [110, 100],
          [110, 110],
          [100, 110],
        ],
        holes: [],
      }),
      id: "f",
      colorIndex: 1,
    };
    expect(applyPushCompensation(obj, [far])).toBe(obj);
  });

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const same: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ],
        holes: [],
      }),
      id: "s",
      colorIndex: 0,
    };
    expect(applyPushCompensation(obj, [same])).toBe(obj);
  });

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const diff: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ],
        holes: [],
      }),
      id: "d",
      colorIndex: 1,
    };
    const r = applyPushCompensation(obj, [diff]);
    expect(r).not.toBe(obj);
    expect(bbox(r.shape.outer).w).toBeLessThan(10);
  });

  it("translated case", () => {
    const obj = makeObj(
      "run",
      {
        outer: [
          [0, 0],
          [10, 0],
        ],
        holes: [],
      },
      { pushCompMm: 0.4 },
    );
    const overlap: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [0, -5],
          [10, -5],
          [10, 5],
          [0, 5],
        ],
        holes: [],
      }),
      id: "n",
      colorIndex: 1,
    };
    expect(applyPushCompensation(obj, [overlap])).toBe(obj);
  });

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare);
    const overlap: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ],
        holes: [],
      }),
      id: "x",
      colorIndex: 1,
    };
    expect(applyPushCompensation(obj, [overlap])).toBe(obj);
  });
});

describe("applyPushCompensation (offset values)", () => {
  const tenSquare: Shape = {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [],
  };
  function diffColorNeighbor(): EmbroideryObject {
    return {
      ...makeObj("fill", {
        outer: [
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ],
        holes: [],
      }),
      id: "dn",
      colorIndex: 99,
    };
  }

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const r = applyPushCompensation(obj, [diffColorNeighbor()]);
    const b = bbox(r.shape.outer);
    expect(b.w).toBeCloseTo(9.2, 1);
    expect(b.h).toBeCloseTo(9.2, 1);
  });

  it("translated case", () => {
    const shape: Shape = {
      outer: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holes: [
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      ],
    };
    const obj = makeObj("fill", shape, { pushCompMm: 0.4 });
    const r = applyPushCompensation(obj, [diffColorNeighbor()]);
    expect(bbox(r.shape.outer).w).toBeCloseTo(9.2, 1);
    expect(r.shape.holes).toHaveLength(1);
    expect(bbox(r.shape.holes[0]).w).toBeCloseTo(4.8, 1); // 4 + 0.8
  });

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const n1 = diffColorNeighbor();
    const n2: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [8, 8],
          [12, 8],
          [12, 12],
          [8, 12],
        ],
        holes: [],
      }),
      id: "n2",
      colorIndex: 100,
    };
    const r = applyPushCompensation(obj, [n1, n2]);
    expect(bbox(r.shape.outer).w).toBeCloseTo(9.2, 1);
  });

  it("translated case", () => {
    const small: Shape = {
      outer: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      holes: [],
    };
    const obj = makeObj("fill", small, { pushCompMm: 2 });
    const overlap: EmbroideryObject = {
      ...makeObj("fill", {
        outer: [
          [-1, -1],
          [2, -1],
          [2, 2],
          [-1, 2],
        ],
        holes: [],
      }),
      id: "ov",
      colorIndex: 1,
    };
    const r = applyPushCompensation(obj, [overlap]);
    expect(bbox(r.shape.outer).w).toBeCloseTo(1, 2);
    expect(bbox(r.shape.outer).h).toBeCloseTo(1, 2);
  });

  it("translated case", () => {
    const obj = makeObj("fill", tenSquare, { pushCompMm: 0.4 });
    const snap = JSON.stringify(tenSquare);
    applyPushCompensation(obj, [diffColorNeighbor()]);
    expect(JSON.stringify(tenSquare)).toBe(snap);
  });
});
