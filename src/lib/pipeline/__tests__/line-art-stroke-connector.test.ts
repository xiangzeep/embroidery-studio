import { describe, expect, it } from "vitest";
import { buildDesignGraph } from "../design-graph";
import { connectLineArtRunObjects } from "../line-art-stroke-connector";
import { FABRIC_PROFILES } from "../fabric";
import type { EmbroideryDesign, EmbroideryObject, Point2D } from "../types";

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

describe("connectLineArtRunObjects", () => {
  it("merges nearby aligned run objects into one logical path", () => {
    const graph = buildDesignGraph(makeDesign([
      makeRun("a", [[0, 0], [4, 0]], 0),
      makeRun("b", [[4.7, 0], [8, 0]], 1),
    ]));

    const connected = connectLineArtRunObjects(graph);
    const runObjects = connected.design.objects.filter((object) => object.kind === "run");

    expect(runObjects).toHaveLength(1);
    expect(runObjects[0].shape.outer.some(([x]) => x > 4.2 && x < 4.6)).toBe(true);
    expect(connected.nodes).toHaveLength(1);
  });

  it("removes isolated short noisy run fragments without touching fill objects", () => {
    const fill: EmbroideryObject = {
      id: "fill",
      kind: "fill",
      baseKind: "fill",
      colorIndex: 1,
      rgb: [0, 128, 255],
      shape: { outer: [[0, 2], [8, 2], [8, 6], [0, 6]], holes: [] },
      props: { densityMm: 1, maxStitchMm: 4 },
      strokeKind: "none",
      strokeRole: "area",
      order: 2,
    };
    const graph = buildDesignGraph(makeDesign([
      makeRun("noise", [[1, 2.5], [1.8, 2.5]], 0),
      makeRun("main", [[3, 0], [8, 0]], 1),
      fill,
    ]));

    const connected = connectLineArtRunObjects(graph);

    expect(connected.design.objects.some((object) => object.id.includes("noise"))).toBe(false);
    expect(connected.design.objects.some((object) => object.id === "fill")).toBe(true);
    expect(connected.design.objects.filter((object) => object.kind === "run")).toHaveLength(1);
  });

  it("preserves unmerged polygonal run geometry instead of replacing it with bbox centerlines", () => {
    const contour: Point2D[] = [
      [0, 0],
      [2, 0.5],
      [3, 2],
      [2, 3.5],
      [0, 4],
      [-1, 2],
    ];
    const graph = buildDesignGraph(makeDesign([
      makeRun("petal", contour, 0),
    ]));

    const connected = connectLineArtRunObjects(graph);
    const run = connected.design.objects.find((object) => object.id === "petal");

    expect(run).toBeDefined();
    expect(run?.shape.outer).toEqual(contour);
  });

  it("does not merge polygonal run contours by arbitrary contour endpoints", () => {
    const firstContour: Point2D[] = [
      [0, 0],
      [0, 1],
      [4, 1],
      [4, 0],
    ];
    const secondContour: Point2D[] = [
      [4, -0.8],
      [4, -2],
      [5, -2],
      [5, -0.8],
    ];
    const graph = buildDesignGraph(makeDesign([
      makeRun("first", firstContour, 0),
      makeRun("second", secondContour, 1),
    ]));

    const connected = connectLineArtRunObjects(graph);
    const runObjects = connected.design.objects.filter((object) => object.kind === "run");

    expect(runObjects).toHaveLength(2);
    expect(runObjects.map((object) => object.id)).toEqual(["first", "second"]);
    expect(runObjects[0].shape.outer).toEqual(firstContour);
    expect(runObjects[1].shape.outer).toEqual(secondContour);
  });

  it("merges nearby collinear elongated polygon stroke fragments by their centerlines", () => {
    const graph = buildDesignGraph(makeDesign([
      makeRun("left-fragment", [[0, 0], [4, 0], [4, 0.25], [0, 0.25]], 0),
      makeRun("right-fragment", [[4.6, 0], [8, 0], [8, 0.25], [4.6, 0.25]], 1),
    ]));

    const connected = connectLineArtRunObjects(graph);
    const runObjects = connected.design.objects.filter((object) => object.kind === "run");

    expect(runObjects).toHaveLength(1);
    expect(runObjects[0].id).toBe("left-fragment+right-fragment");
    expect(runObjects[0].shape.outer[0]).toEqual([0, 0.125]);
    expect(runObjects[0].shape.outer.at(-1)).toEqual([8, 0.125]);
  });
});

function makeDesign(objects: EmbroideryObject[]): EmbroideryDesign {
  return {
    widthMm: 12,
    heightMm: 8,
    fabric: FABRIC_PROFILES.denim,
    objects,
  };
}
