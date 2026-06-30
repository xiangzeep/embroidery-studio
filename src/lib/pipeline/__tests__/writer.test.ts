import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeEmbroideryViaWorker: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
}));

vi.mock("../pyodide-worker", () => ({
  writeEmbroideryViaWorker: mocks.writeEmbroideryViaWorker,
}));

import { writeEmbroidery } from "../writer";
import type { StitchPattern } from "../types";

function makePattern(): StitchPattern {
  return {
    widthMm: 20,
    heightMm: 10,
    totalStitches: 3,
    blocks: [
      {
        colorIndex: 0,
        rgb: [255, 0, 0],
        stitches: [
          { x: 0, y: 0, kind: "run", colorIndex: 0 },
          { x: 1, y: 0, kind: "run", colorIndex: 0 },
          { x: 1, y: 1, kind: "jump", colorIndex: 0 },
        ],
      },
    ],
  };
}

describe("writeEmbroidery", () => {
  it("writes DST directly without starting Pyodide", async () => {
    const blob = await writeEmbroidery({ pattern: makePattern(), format: "dst" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = new TextDecoder("ascii").decode(bytes.slice(0, 512));

    expect(mocks.writeEmbroideryViaWorker).not.toHaveBeenCalled();
    expect(blob.type).toBe("application/octet-stream");
    expect(header).toContain("LA:EmbroideryStudio");
    expect(bytes.length).toBeGreaterThan(512);
    expect(Array.from(bytes.slice(-3))).toEqual([0, 0, 243]);
  });


  it("encodes negative DST deltas such as -0.6mm", async () => {
    const pattern: StitchPattern = {
      widthMm: 20,
      heightMm: 10,
      totalStitches: 2,
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "run", colorIndex: 0 },
            { x: -0.6, y: 0, kind: "run", colorIndex: 0 },
          ],
        },
      ],
    };

    const blob = await writeEmbroidery({ pattern, format: "dst" });

    expect(blob.size).toBeGreaterThan(512);
  });


  it("encodes every single-record DST x delta from -121 to 121", async () => {
    for (let delta = -121; delta <= 121; delta++) {
      const pattern: StitchPattern = {
        widthMm: 30,
        heightMm: 10,
        totalStitches: 2,
        blocks: [
          {
            colorIndex: 0,
            rgb: [0, 0, 0],
            stitches: [
              { x: 0, y: 0, kind: "run", colorIndex: 0 },
              { x: delta / 10, y: 0, kind: "run", colorIndex: 0 },
            ],
          },
        ],
      };

      await expect(writeEmbroidery({ pattern, format: "dst" })).resolves.toBeInstanceOf(Blob);
    }
  });


  it("writes standard DST record bytes for simple x and y moves", async () => {
    const pattern: StitchPattern = {
      widthMm: 20,
      heightMm: 10,
      totalStitches: 3,
      blocks: [
        {
          colorIndex: 0,
          rgb: [0, 0, 0],
          stitches: [
            { x: 0, y: 0, kind: "run", colorIndex: 0 },
            { x: 0.1, y: 0, kind: "run", colorIndex: 0 },
            { x: 0.1, y: 0.1, kind: "run", colorIndex: 0 },
          ],
        },
      ],
    };

    const blob = await writeEmbroidery({ pattern, format: "dst" });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(Array.from(bytes.slice(512, 515))).toEqual([0x00, 0x00, 0x03]);
    expect(Array.from(bytes.slice(515, 518))).toEqual([0x01, 0x00, 0x03]);
    expect(Array.from(bytes.slice(518, 521))).toEqual([0x40, 0x00, 0x03]);
  });

  it("keeps Pyodide fallback for non-DST formats", async () => {
    const blob = await writeEmbroidery({ pattern: makePattern(), format: "pes" });

    expect(mocks.writeEmbroideryViaWorker).toHaveBeenCalledOnce();
    expect(blob.size).toBe(3);
  });
});
