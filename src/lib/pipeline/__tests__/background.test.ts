import { describe, expect, it } from "vitest";
import {
  classifyBackgroundShape,
  shouldKeepNearWhiteShape,
} from "../background";
import type { Shape } from "../types";

function rect(x: number, y: number, width: number, height: number): Shape {
  return { outer: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], holes: [] };
}

describe("background classification", () => {
  it("removes large near-white shapes connected to the canvas edge", () => {
    const result = classifyBackgroundShape({
      shape: rect(0, 0, 256, 256),
      rgb: [250, 250, 250],
      widthPx: 256,
      heightPx: 256,
    });

    expect(result.kind).toBe("background");
    expect(result.keep).toBe(false);
  });

  it("preserves interior near-white highlight details", () => {
    const result = classifyBackgroundShape({
      shape: rect(128, 128, 10, 10),
      rgb: [250, 250, 250],
      widthPx: 256,
      heightPx: 256,
      minKeepAreaPx: 120,
    });

    expect(result.kind).toBe("interior-white");
    expect(result.keep).toBe(true);
    expect(shouldKeepNearWhiteShape(result)).toBe(true);
  });

  it("removes tiny near-white edge noise", () => {
    const result = classifyBackgroundShape({
      shape: rect(0, 80, 2, 12),
      rgb: [248, 248, 248],
      widthPx: 256,
      heightPx: 256,
    });

    expect(result.kind).toBe("edge-white-noise");
    expect(result.keep).toBe(false);
  });

  it("leaves non-white shapes to normal region filtering", () => {
    const result = classifyBackgroundShape({
      shape: rect(0, 0, 256, 256),
      rgb: [20, 20, 80],
      widthPx: 256,
      heightPx: 256,
    });

    expect(result.kind).toBe("not-white");
    expect(result.keep).toBe(true);
  });
});
