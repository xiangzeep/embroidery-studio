import { describe, expect, it } from "vitest";
import { FABRIC_PROFILES } from "../fabric";
import { buildDesignGraph, mapObjectType } from "../design-graph";
import { cleanPath } from "../path-cleaner";
import { routeGraphObjects } from "../object-router";
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
