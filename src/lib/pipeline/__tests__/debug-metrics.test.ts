import { describe, expect, it } from "vitest";
import { summarizeDebugMetrics } from "../debug-metrics";

describe("summarizeDebugMetrics", () => {
  it("counts objects by layer and travel commands", () => {
    const summary = summarizeDebugMetrics({
      design: {
        widthMm: 20,
        heightMm: 20,
        fabric: { kind: "denim" } as never,
        objects: [
          {
            id: "fill-1",
            kind: "fill",
            layer: "base-fill",
            colorIndex: 0,
            rgb: [0, 0, 0],
            shape: { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
            props: { densityMm: 0.4, maxStitchMm: 7 },
            order: 0,
          },
          {
            id: "outline-1",
            kind: "fill",
            layer: "outline",
            colorIndex: 0,
            rgb: [0, 0, 0],
            shape: { outer: [[12, 0], [18, 0], [18, 2], [12, 2]], holes: [] },
            strokeKind: "narrow-satin",
            strokeMetrics: {
              areaMm2: 12,
              perimeterMm: 16,
              bboxWidthMm: 6,
              bboxHeightMm: 2,
              estimatedWidthMm: 1.5,
              estimatedLengthMm: 8,
              slenderness: 3,
              compactness: 0.2,
              holeCount: 0,
              isStrokeLike: true,
            },
            props: { densityMm: 0.4, maxStitchMm: 7 },
            order: 1,
          },
          {
            id: "vein-1",
            kind: "run",
            layer: "outline",
            colorIndex: 0,
            rgb: [0, 0, 0],
            shape: { outer: [[0, 12], [8, 12], [8, 13], [0, 13]], holes: [] },
            strokeKind: "bean-run",
            strokeMetrics: {
              areaMm2: 8,
              perimeterMm: 18,
              bboxWidthMm: 8,
              bboxHeightMm: 1,
              estimatedWidthMm: 0.9,
              estimatedLengthMm: 9,
              slenderness: 8,
              compactness: 0.1,
              holeCount: 0,
              isStrokeLike: true,
            },
            props: { densityMm: 0.4, maxStitchMm: 7 },
            order: 2,
          },
        ],
      },
      pattern: {
        widthMm: 20,
        heightMm: 20,
        totalStitches: 2,
        blocks: [
          {
            colorIndex: 0,
            rgb: [0, 0, 0],
            stitches: [
              { x: 0, y: 0, kind: "fill", colorIndex: 0 },
              { x: 1, y: 0, kind: "jump", colorIndex: 0 },
              { x: 1, y: 0, kind: "fill", colorIndex: 0 },
              { x: 4, y: 4, kind: "jump", colorIndex: 0 },
              { x: 4, y: 4, kind: "fill", colorIndex: 0 },
              { x: 13, y: 4, kind: "jump", colorIndex: 0 },
              { x: 13, y: 4, kind: "trim", colorIndex: 0 },
              { x: 14, y: 4, kind: "satin", colorIndex: 0 },
            ],
          },
        ],
      },
    });

    expect(summary.layers).toEqual([
      { layer: "base-fill", objectCount: 1 },
      { layer: "outline", objectCount: 2 },
    ]);
    expect(summary.strokes).toEqual({
      totalStrokeObjects: 2,
      fillRiskCount: 1,
      kinds: [
        { strokeKind: "bean-run", objectCount: 1 },
        { strokeKind: "narrow-satin", objectCount: 1 },
      ],
      averageEstimatedWidthMm: 1.2,
    });
    expect(summary.commands.jumpCount).toBe(3);
    expect(summary.commands.shortJumpCount).toBe(1);
    expect(summary.commands.mediumJumpCount).toBe(1);
    expect(summary.commands.longJumpCount).toBe(1);
    expect(summary.commands.trimCount).toBe(1);
    expect(summary.commands.maxJumpMm).toBeCloseTo(9);
    expect(summary.commands.travelLengthMm).toBeCloseTo(15);
  });
});
