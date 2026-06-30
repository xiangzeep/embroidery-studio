import { describe, expect, test } from "vitest";
import {
  buildThreadSegments,
  getOrthographicView,
  PREVIEW_3D_FABRIC_HEX,
  PREVIEW_3D_SCENE_BACKGROUND_HEX,
  rgbToHex,
} from "../stitch-preview-3d-helpers";
import type { StitchPattern } from "@/lib/pipeline/types";

describe("stitch preview 3d helpers", () => {
  test("buildThreadSegments does not connect across function commands", () => {
    const pattern: StitchPattern = {
      widthMm: 20,
      heightMm: 10,
      totalStitches: 6,
      blocks: [
        {
          colorIndex: 0,
          rgb: [10, 20, 30],
          stitches: [
            { x: 1, y: 1, kind: "fill", colorIndex: 0 },
            { x: 2, y: 1, kind: "fill", colorIndex: 0 },
            { x: 9, y: 5, kind: "jump", colorIndex: 0 },
            { x: 10, y: 5, kind: "fill", colorIndex: 0 },
            { x: 12, y: 7, kind: "trim", colorIndex: 0 },
            { x: 13, y: 7, kind: "fill", colorIndex: 0 },
          ],
        },
      ],
    };

    const segments = buildThreadSegments(pattern);

    expect(segments).toEqual([
      {
        from: { x: -9, y: 4 },
        to: { x: -8, y: 4 },
        rgb: [10, 20, 30],
      },
    ]);
  });

  test("getOrthographicView fits the full pattern with padding", () => {
    expect(getOrthographicView(100, 50, 1)).toEqual({
      width: 120,
      height: 120,
    });
    expect(getOrthographicView(100, 50, 2)).toEqual({
      width: 120,
      height: 60,
    });
  });

  test("rgbToHex preserves the exact thread color for 3d preview", () => {
    expect(rgbToHex([27, 136, 255])).toBe(0x1b88ff);
    expect(rgbToHex([255, 255, 255])).toBe(0xffffff);
  });

  test("3d preview uses a neutral fabric palette", () => {
    expect(PREVIEW_3D_SCENE_BACKGROUND_HEX).toBe(0xf5f3ef);
    expect(PREVIEW_3D_FABRIC_HEX).toBe(PREVIEW_3D_SCENE_BACKGROUND_HEX);
  });
});
