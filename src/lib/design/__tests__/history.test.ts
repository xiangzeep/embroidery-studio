import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
} from "../history";
import { FABRIC_PROFILES } from "@/lib/pipeline/fabric";
import type { EmbroideryDesign } from "@/lib/pipeline/types";

function makeDesign(width: number): EmbroideryDesign {
  return {
    widthMm: width,
    heightMm: 100,
    fabric: FABRIC_PROFILES.denim,
    objects: [],
  };
}

describe("createHistory", () => {
  it("translated case", () => {
    const h = createHistory(makeDesign(10));
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.current.widthMm).toBe(10);
  });
});

describe("pushHistory", () => {
  it("translated case", () => {
    let h = createHistory(makeDesign(10));
    h = pushHistory(h, makeDesign(20));
    expect(h.past.length).toBe(1);
    expect(h.past[0].widthMm).toBe(10);
    expect(h.current.widthMm).toBe(20);
  });

  it("translated case", () => {
    let h = createHistory(makeDesign(10));
    h = pushHistory(h, makeDesign(20));
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, makeDesign(30));
    expect(canRedo(h)).toBe(false);
    expect(h.future).toEqual([]);
  });

  it("translated case", () => {
    let h = createHistory(makeDesign(0));
    for (let i = 1; i <= MAX_HISTORY + 3; i++) {
      h = pushHistory(h, makeDesign(i));
    }
    expect(h.past.length).toBe(MAX_HISTORY);
    // English note.
    expect(h.past[0].widthMm).toBe(3);
    expect(h.current.widthMm).toBe(MAX_HISTORY + 3);
  });

  it("translated case", () => {
    const h0 = createHistory(makeDesign(10));
    const h1 = pushHistory(h0, makeDesign(20));
    expect(h0.past).toEqual([]);
    expect(h0.current.widthMm).toBe(10);
    expect(h1).not.toBe(h0);
  });
});

describe("undo / redo", () => {
  it("translated case", () => {
    let h = createHistory(makeDesign(10));
    h = pushHistory(h, makeDesign(20));
    h = pushHistory(h, makeDesign(30));
    h = undo(h);
    expect(h.current.widthMm).toBe(20);
    expect(h.past.length).toBe(1);
    expect(h.future[0].widthMm).toBe(30);
  });

  it("translated case", () => {
    let h = createHistory(makeDesign(10));
    h = pushHistory(h, makeDesign(20));
    h = undo(h);
    h = redo(h);
    expect(h.current.widthMm).toBe(20);
    expect(h.past.length).toBe(1);
    expect(h.future).toEqual([]);
  });

  it("translated case", () => {
    const h = createHistory(makeDesign(10));
    expect(undo(h)).toBe(h); // same reference
  });

  it("translated case", () => {
    const h = createHistory(makeDesign(10));
    expect(redo(h)).toBe(h);
  });

  it("canUndo / canRedo", () => {
    let h = createHistory(makeDesign(10));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    h = pushHistory(h, makeDesign(20));
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
  });
});
