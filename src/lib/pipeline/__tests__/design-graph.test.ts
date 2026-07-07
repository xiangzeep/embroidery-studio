import { describe, expect, it } from "vitest";
import { FABRIC_PROFILES } from "../fabric";
import { buildDesignGraph, mapObjectType } from "../design-graph";
import { cleanPath } from "../path-cleaner";
import { routeGraphObjects } from "../object-router";
import { renderDesignGraph } from "../render";
import type { EmbroideryDesign, EmbroideryObject, Point2D, Stitch } from "../types";

const makeRun = (id: string, outer: Point2D[], order: number): EmbroideryObject => ({
  id,
  kind: "run",
  baseKind: "run",
  colorIndex: 0,
  rgb: [0, 128, 255],
  shape: { outer, holes: [] },
  props: { densityMm: 0.4, maxStitchMm: 4 },
  strokeKind: "thin-run",
  strokeRole: "outline",
  order,
});

describe("design graph object architecture", () => {
  it("maps legacy fill objects to TATAMI graph objects", () => {
    expect(mapObjectType({ kind: "run" } as EmbroideryObject)).toBe("RUN");
    expect(mapObjectType({ kind: "satin" } as EmbroideryObject)).toBe("SATIN");
    expect(mapObjectType({ kind: "fill" } as EmbroideryObject)).toBe("TATAMI");
  });

  it("builds graph nodes from prepipeline objects without merging object identity", () => {
    const design: EmbroideryDesign = {
      widthMm: 20,
      heightMm: 10,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun("run-a", [[0, 0], [10, 0]], 0),
        makeRun("run-b", [[12, 0], [18, 0]], 1),
      ],
    };

    const graph = buildDesignGraph(design);

    expect(graph.nodes.map((node) => node.object.id)).toEqual(["run-a", "run-b"]);
    expect(graph.nodes.every((node) => node.type === "RUN")).toBe(true);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      fromObjectId: "run-a",
      toObjectId: "run-b",
      command: "jump",
    });
  });
});

describe("cleanPath", () => {
  it("filters near-duplicate points and resamples RUN paths near 2mm spacing", () => {
    const cleaned = cleanPath(
      [[0, 0], [0.02, 0.01], [5, 0], [10, 0]],
      { targetSpacingMm: 2, closed: false },
    );

    expect(cleaned[0]).toEqual([0, 0]);
    expect(cleaned[cleaned.length - 1]).toEqual([10, 0]);
    expect(cleaned.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < cleaned.length - 1; i++) {
      const prev = cleaned[i - 1];
      const pt = cleaned[i];
      expect(Math.hypot(pt[0] - prev[0], pt[1] - prev[1])).toBeLessThanOrEqual(2.25);
    }
  });
});

describe("objectRouter", () => {
  it("uses jump/trim commands between graph objects instead of cross-object stitches", () => {
    const previous: Stitch = { x: 0, y: 0, kind: "run", colorIndex: 0 };
    const next: Stitch = { x: 5, y: 0, kind: "run", colorIndex: 0 };

    const routed = routeGraphObjects(previous, next, {
      colorIndex: 0,
      jumpThresholdMm: 1.5,
      trimThresholdMm: 3,
    });

    expect(routed.map((stitch) => stitch.kind)).toEqual(["trim", "jump"]);
    expect(routed.some((stitch) => stitch.kind === "run")).toBe(false);
  });
});

describe("graph RUN fidelity", () => {
  it("preserves branched thin strokes instead of collapsing them into rail-average zigzags", () => {
    const design: EmbroideryDesign = {
      widthMm: 20,
      heightMm: 12,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun(
          "branched-run",
          [
            [0, 0],
            [6, 0],
            [6, 1],
            [3.5, 1],
            [3.5, 6],
            [2.5, 6],
            [2.5, 1],
            [0, 1],
          ],
          0,
        ),
      ],
    };
    const graph = buildDesignGraph(design);
    const pattern = renderDesignGraph(graph, {
      widthMm: 20,
      heightMm: 12,
      widthPx: 200,
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });
    const runStitches = pattern.blocks.flatMap((block) =>
      block.stitches.filter((stitch) => stitch.kind === "run"),
    );
    const xs = runStitches.map((stitch) => stitch.x);
    const ys = runStitches.map((stitch) => stitch.y);

    expect(Math.min(...xs)).toBeLessThan(0.8);
    expect(Math.max(...xs)).toBeGreaterThan(5.2);
    expect(Math.max(...ys)).toBeGreaterThan(5.2);
  });

  it("renders line-art run nodes before satin and fill nodes for stable object order", () => {
    const design: EmbroideryDesign = {
      widthMm: 32,
      heightMm: 12,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        {
          id: "fill-late",
          kind: "fill",
          baseKind: "fill",
          colorIndex: 0,
          rgb: [0, 128, 255],
          shape: { outer: [[0, 0], [4, 0], [4, 4], [0, 4]], holes: [] },
          props: { densityMm: 1, maxStitchMm: 4, underlay: { kind: "none" } },
          strokeKind: "none",
          strokeRole: "area",
          order: 0,
        },
        makeRun("run-first", [[24, 0], [32, 0], [32, 1], [24, 1]], 1),
      ],
    };
    const pattern = renderDesignGraph(buildDesignGraph(design), {
      widthMm: 32,
      heightMm: 12,
      widthPx: 320,
      digitizingMode: "line-art",
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    const firstDrawn = pattern.blocks[0].stitches.find((stitch) =>
      stitch.kind === "run" || stitch.kind === "satin" || stitch.kind === "fill"
    );

    expect(firstDrawn?.x).toBeGreaterThan(20);
  });

  it("bridges tiny same-color line-art run gaps without a jump", () => {
    const design: EmbroideryDesign = {
      widthMm: 10,
      heightMm: 4,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun("run-a", [[0, 0], [4, 0], [4, 0.8], [0, 0.8]], 0),
        makeRun("run-b", [[4.25, 0], [8, 0], [8, 0.8], [4.25, 0.8]], 1),
      ],
    };

    const pattern = renderDesignGraph(buildDesignGraph(design), {
      widthMm: 10,
      heightMm: 4,
      widthPx: 100,
      digitizingMode: "line-art",
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    const stitches = pattern.blocks[0].stitches;
    expect(stitches.some((stitch) => stitch.kind === "jump" || stitch.kind === "trim")).toBe(false);
    expect(stitches.some((stitch) => stitch.kind === "run" && stitch.x > 4.1 && stitch.x < 4.5)).toBe(true);
  });

  it("bridges aligned line-art run gaps while preserving angled intersections as jumps", () => {
    const alignedDesign: EmbroideryDesign = {
      widthMm: 12,
      heightMm: 4,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun("run-a", [[0, 0], [4, 0], [4, 0.8], [0, 0.8]], 0),
        makeRun("run-b", [[5.05, 0], [9, 0], [9, 0.8], [5.05, 0.8]], 1),
      ],
    };
    const angledDesign: EmbroideryDesign = {
      widthMm: 12,
      heightMm: 6,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun("run-a", [[0, 0], [4, 0], [4, 0.8], [0, 0.8]], 0),
        makeRun("run-b", [[4, 1.6], [4.8, 1.6], [4.8, 5], [4, 5]], 1),
      ],
    };
    const opts = {
      widthPx: 120,
      digitizingMode: "line-art" as const,
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
      disableMedialAxis: true,
    };

    const aligned = renderDesignGraph(buildDesignGraph(alignedDesign), {
      ...opts,
      widthMm: 12,
      heightMm: 4,
    }).blocks[0].stitches;
    const angled = renderDesignGraph(buildDesignGraph(angledDesign), {
      ...opts,
      widthMm: 12,
      heightMm: 6,
    }).blocks[0].stitches;

    expect(aligned.some((stitch) => stitch.kind === "jump" || stitch.kind === "trim")).toBe(false);
    expect(aligned.some((stitch) => stitch.kind === "run" && stitch.x > 4.4 && stitch.x < 5.2)).toBe(true);
    expect(angled.some((stitch) => stitch.kind === "jump")).toBe(true);
  });

  it("keeps larger line-art run gaps as jumps", () => {
    const design: EmbroideryDesign = {
      widthMm: 14,
      heightMm: 4,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun("run-a", [[0, 0], [4, 0], [4, 0.8], [0, 0.8]], 0),
        makeRun("run-b", [[5.6, 0], [10, 0], [10, 0.8], [5.6, 0.8]], 1),
      ],
    };

    const pattern = renderDesignGraph(buildDesignGraph(design), {
      widthMm: 14,
      heightMm: 4,
      widthPx: 140,
      digitizingMode: "line-art",
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    const stitches = pattern.blocks[0].stitches;
    expect(stitches.some((stitch) => stitch.kind === "jump")).toBe(true);
    expect(stitches.some((stitch) => stitch.kind === "trim")).toBe(false);
  });

  it("orders nearby line-art run fragments before distant fragments without forcing stitches", () => {
    const design: EmbroideryDesign = {
      widthMm: 12,
      heightMm: 4,
      fabric: FABRIC_PROFILES.denim,
      objects: [
        makeRun("run-a", [[0, 0], [4, 0], [4, 0.8], [0, 0.8]], 0),
        makeRun("run-far", [[7.6, 0], [11, 0], [11, 0.8], [7.6, 0.8]], 1),
        makeRun("run-near", [[5.6, 0], [6.2, 0], [6.2, 0.8], [5.6, 0.8]], 2),
      ],
    };

    const pattern = renderDesignGraph(buildDesignGraph(design), {
      widthMm: 12,
      heightMm: 4,
      widthPx: 120,
      digitizingMode: "line-art",
      stitchDensityMm: 0.5,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
    });

    const stitches = pattern.blocks[0].stitches;
    const jumps = stitches.filter((stitch) => stitch.kind === "jump");
    expect(jumps).toHaveLength(2);
    expect(jumps[0].x).toBeGreaterThan(5.2);
    expect(jumps[0].x).toBeLessThan(6.5);
    expect(jumps[1].x).toBeGreaterThan(7);
  });

  it("stops graph rendering as soon as object-level stitch budget is exceeded", () => {
    const design: EmbroideryDesign = {
      widthMm: 80,
      heightMm: 12,
      fabric: FABRIC_PROFILES.denim,
      objects: Array.from({ length: 8 }, (_, index) =>
        makeRun(
          `run-${index}`,
          [[index * 8, 0], [index * 8 + 7, 0], [index * 8 + 7, 1], [index * 8, 1]],
          index,
        ),
      ),
    };

    expect(() => renderDesignGraph(buildDesignGraph(design), {
      widthMm: 80,
      heightMm: 12,
      widthPx: 800,
      digitizingMode: "line-art",
      stitchDensityMm: 0.2,
      satinMaxWidthMm: 2,
      disableUnderlay: true,
      disableCompensation: true,
      disableLockstitch: true,
      maxRenderStitches: 12,
    })).toThrow("stitch budget");
  });
});
