import { describe, it, expect } from "vitest";

// English note.
// English note.
// English note.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  (globalThis as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

import {
  parsePathD,
  signedArea,
  pointInPolygon,
  buildShapesByContainment,
  vectorize,
  dilateForegroundMask,
  type Tracer,
} from "../vectorize";

function maskToString(data: Uint8ClampedArray, w: number, h: number): string {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) row += data[(y * w + x) * 4] === 0 ? "#" : ".";
    rows.push(row);
  }
  return rows.join("\n");
}

function makeMaskFromAscii(ascii: string): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const rows = ascii.trim().split("\n").map((r) => r.trim());
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = rows[y][x] === "#" ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i + 0] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("parsePathD", () => {
  it("translated case", () => {
    const out = parsePathD("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeGreaterThanOrEqual(4);
  });

  it("translated case", () => {
    const out = parsePathD(
      "M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 30 70 L 70 70 L 70 30 Z",
    );
    expect(out).toHaveLength(2);
  });
});

describe("signedArea", () => {
  it("translated case", () => {
    expect(
      signedArea([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBeGreaterThan(0);
  });
  it("translated case", () => {
    expect(
      signedArea([
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
      ]),
    ).toBeLessThan(0);
  });
});

describe("pointInPolygon", () => {
  const sq: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it("内側", () => expect(pointInPolygon([5, 5], sq)).toBe(true));
  it("外側", () => expect(pointInPolygon([15, 5], sq)).toBe(false));
});

describe("buildShapesByContainment", () => {
  it("translated case", () => {
    const outer: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const hole: [number, number][] = [
      [30, 30],
      [70, 30],
      [70, 70],
      [30, 70],
    ];
    const shapes = buildShapesByContainment([outer, hole]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
  });

  it("translated case", () => {
    const o1: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const o2: [number, number][] = [
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
    ];
    const shapes = buildShapesByContainment([o1, o2]);
    expect(shapes).toHaveLength(2);
    expect(shapes[0].holes).toHaveLength(0);
    expect(shapes[1].holes).toHaveLength(0);
  });
});

describe("dilateForegroundMask", () => {
  it("translated case", () => {
    const { data, width, height } = makeMaskFromAscii(
      `
      .....
      .....
      ..#..
      .....
      .....
    `,
    );
    dilateForegroundMask(data, width, height, 1);
    expect(maskToString(data, width, height)).toBe(
      [
        ".....",
        "..#..",
        ".###.",
        "..#..",
        ".....",
      ].join("\n"),
    );
  });

  it("translated case", () => {
    const { data, width, height } = makeMaskFromAscii(
      `
      .#.
      ###
      .#.
    `,
    );
    const before = maskToString(data, width, height);
    dilateForegroundMask(data, width, height, 0);
    expect(maskToString(data, width, height)).toBe(before);
  });

  it("translated case", () => {
    const { data, width, height } = makeMaskFromAscii(
      `
      #..
      ...
      ...
    `,
    );
    dilateForegroundMask(data, width, height, 1);
    expect(maskToString(data, width, height)).toBe(
      ["##.", "#..", "..."].join("\n"),
    );
  });

  it("translated case", async () => {
    let received: ImageData | null = null;
    const captureTracer: Tracer = {
      async trace(mask) {
        received = mask;
        return [];
      },
    };
    // English note.
    const labels = new Uint8Array(3 * 3).fill(1);
    labels[4] = 0;
    await vectorize(
      { labels, width: 3, height: 3, palette: [[0, 0, 0]], dilatePx: 1 },
      captureTracer,
    );
    expect(received).not.toBeNull();
    const r = received as unknown as ImageData;
    expect(maskToString(r.data, r.width, r.height)).toBe(
      [".#.", "###", ".#."].join("\n"),
    );
  });
});

describe("vectorize (mock tracer)", () => {
  it("translated case", async () => {
    const mockTracer: Tracer = {
      async trace() {
        return [
          "M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 30 70 L 70 70 L 70 30 Z",
        ];
      },
    };
    const labels = new Uint8Array(100 * 100).fill(0);
    const regions = await vectorize(
      { labels, width: 100, height: 100, palette: [[0, 0, 0]] },
      mockTracer,
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].shapes).toHaveLength(1);
    expect(regions[0].shapes[0].holes).toHaveLength(1);
  });

  it("translated case", async () => {
    // English note.
    // path 1: outer shape (100x100) + glyph hole (40x40)
    // English note.
    const mockTracer: Tracer = {
      async trace() {
        return [
          "M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 30 70 L 70 70 L 70 30 Z",
          "M 45 45 L 55 45 L 55 55 L 45 55 Z",
        ];
      },
    };
    const labels = new Uint8Array(100 * 100).fill(0);
    const regions = await vectorize(
      { labels, width: 100, height: 100, palette: [[0, 0, 0]] },
      mockTracer,
    );
    expect(regions).toHaveLength(1);
    // English note.
    expect(regions[0].shapes).toHaveLength(2);
    // English note.
    const big = regions[0].shapes.find(
      (s) => Math.abs(s.outer[0][0] - 0) < 1 && Math.abs(s.outer[0][1] - 0) < 1,
    );
    expect(big).toBeDefined();
    expect(big!.holes).toHaveLength(1);
    // English note.
    const island = regions[0].shapes.find(
      (s) =>
        Math.abs(s.outer[0][0] - 45) < 1 && Math.abs(s.outer[0][1] - 45) < 1,
    );
    expect(island).toBeDefined();
    expect(island!.holes).toHaveLength(0);
  });
});
