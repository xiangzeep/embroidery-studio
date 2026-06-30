import { describe, expect, it } from "vitest";
import { analyzeDstBytes } from "../dst-analyzer";
import { writeDst } from "../dst-writer";
import type { StitchPattern } from "../types";

function makePattern(): StitchPattern {
  return {
    widthMm: 30,
    heightMm: 20,
    totalStitches: 4,
    blocks: [
      {
        colorIndex: 0,
        rgb: [0, 0, 0],
        stitches: [
          { x: 0, y: 0, kind: "run", colorIndex: 0 },
          { x: 1, y: 0, kind: "run", colorIndex: 0 },
          { x: 5, y: 0, kind: "jump", colorIndex: 0 },
          { x: 9, y: 0, kind: "jump", colorIndex: 0 },
          { x: 9, y: 0, kind: "stop", colorIndex: 0 },
        ],
      },
    ],
  };
}

describe("analyzeDstBytes", () => {
  it("counts DST command records and jump metrics", async () => {
    const blob = writeDst(makePattern());
    const analysis = analyzeDstBytes(new Uint8Array(await blob.arrayBuffer()));

    expect(analysis.byteLength).toBe(blob.size);
    expect(analysis.header.LA).toBe("EmbroideryStudio");
    expect(analysis.header.ST).toBe("4");
    expect(analysis.header.CO).toBe("1");
    expect(analysis.recordCount).toBe(6);
    expect(analysis.stitchCount).toBe(2);
    expect(analysis.jumpCount).toBe(2);
    expect(analysis.trimCount).toBe(0);
    expect(analysis.stopCount).toBe(1);
    expect(analysis.endCount).toBe(1);
    expect(analysis.otherCount).toBe(0);
    expect(analysis.jumpRatio).toBeCloseTo(2 / 5);
    expect(analysis.longestJumpMm).toBeCloseTo(4);
    expect(analysis.consecutiveJumpRunCount).toBe(1);
    expect(analysis.maxConsecutiveJumpRun).toBe(2);
    expect(analysis.colorBlockCount).toBe(2);
  });

  it("rejects files shorter than the DST header", () => {
    expect(() => analyzeDstBytes(new Uint8Array(10))).toThrow(/DST header/i);
  });
});
