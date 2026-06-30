import { describe, it, expect } from "vitest";
import { emitTieIn, emitTieOff } from "../lockstitch";

describe("emitTieIn", () => {
  it("translated case", () => {
    const s = emitTieIn([10, 5], [1, 0], 3, 0.8);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ x: 9.2, y: 5, kind: "run", colorIndex: 3 });
    expect(s[1]).toMatchObject({ x: 10, y: 5, kind: "run", colorIndex: 3 });
    expect(s[2]).toMatchObject({ x: 9.2, y: 5, kind: "run", colorIndex: 3 });
  });

  it("translated case", () => {
    const s = emitTieIn([0, 0], [0, 1], 0);
    expect(s[0]).toMatchObject({ x: 0, y: -0.8 });
    expect(s[1]).toMatchObject({ x: 0, y: 0 });
    expect(s[2]).toMatchObject({ x: 0, y: -0.8 });
  });

  it("translated case", () => {
    const dir: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
    const s = emitTieIn([0, 0], dir, 0, 1.0);
    expect(s[0].x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(s[0].y).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it("translated case", () => {
    const s = emitTieIn([0, 0], [1, 0], 0);
    expect(s.every((x) => x.kind === "run")).toBe(true);
  });
});

describe("emitTieOff", () => {
  it("translated case", () => {
    const s = emitTieOff([20, 5], [1, 0], 2, 0.5);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ x: 19.5, y: 5, colorIndex: 2 });
    expect(s[1]).toMatchObject({ x: 20, y: 5 });
    expect(s[2]).toMatchObject({ x: 19.5, y: 5 });
  });
});
