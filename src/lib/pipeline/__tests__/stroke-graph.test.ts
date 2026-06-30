import { describe, expect, test } from "vitest";
import { orderStrokeBranchObjects } from "../stroke-graph";
import { estimateRouteTravelLength, findBranches, optimizeOrder } from "../pathing";
import type {
  EmbroideryDesign,
  EmbroideryObject,
  Point2D,
  Shape,
  StrokeKind,
} from "../types";

function rect(x: number, y: number, w: number, h: number): Shape {
  return {
    outer: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    holes: [],
  };
}

function stroke(
  id: string,
  shape: Shape,
  estimatedLengthMm: number,
  strokeKind: StrokeKind = "bean-run",
): EmbroideryObject {
  return {
    id,
    kind: "run",
    layer: "outline",
    colorIndex: 0,
    rgb: [0, 120, 255],
    shape,
    strokeKind,
    strokeMetrics: {
      areaMm2: 10,
      perimeterMm: 20,
      bboxWidthMm: 10,
      bboxHeightMm: 1,
      estimatedWidthMm: 1,
      estimatedLengthMm,
      slenderness: 10,
      compactness: 0.1,
      holeCount: 0,
      isStrokeLike: true,
    },
    props: {
      densityMm: 1,
      maxStitchMm: 7,
    },
    order: 0,
  };
}

function lineStroke(
  id: string,
  points: Point2D[],
  estimatedLengthMm: number,
): EmbroideryObject {
  return stroke(id, { outer: points, holes: [] }, estimatedLengthMm);
}

const fabric = {
  kind: "twill" as const,
  defaultDensityMm: 1,
  pullCompPerWidth: 0,
  minPullCompMm: 0,
  defaultPushCompMm: 0,
  underlayPolicy: {
    run: () => ({ kind: "none" as const }),
    satin: () => ({ kind: "none" as const }),
    fill: () => ({ kind: "none" as const }),
  },
};

describe("orderStrokeBranchObjects", () => {
  test("starts with the longest stroke as the main branch", () => {
    const shortBranch = stroke("short", rect(20, 0, 6, 1), 6);
    const trunk = stroke("trunk", rect(0, 0, 18, 1), 18);
    const middleBranch = stroke("middle", rect(18, 0, 10, 1), 10);

    const ordered = orderStrokeBranchObjects(
      [shortBranch, trunk, middleBranch],
      [0, 0],
    );

    expect(ordered.map((obj) => obj.id)).toEqual(["trunk", "middle", "short"]);
  });

  test("returns non-stroke groups unchanged", () => {
    const nonStroke = {
      ...stroke("fill", rect(0, 0, 10, 10), 5, "none"),
      kind: "fill" as const,
      strokeMetrics: undefined,
    };

    expect(orderStrokeBranchObjects([nonStroke], [0, 0])).toEqual([nonStroke]);
  });

  test("prefers the near start fragment when it avoids a long branch backtrack", () => {
    const nearStart = stroke("near-start", rect(0, 0, 4, 1), 4);
    const trunk = stroke("trunk", rect(5.2, 0, 20, 1), 20);
    const farTail = stroke("far-tail", rect(26.4, 0, 4, 1), 4);

    const ordered = orderStrokeBranchObjects(
      [farTail, trunk, nearStart],
      [0, 0],
    );

    expect(ordered.map((obj) => obj.id)).toEqual([
      "near-start",
      "trunk",
      "far-tail",
    ]);
    expect(estimateRouteTravelLength(ordered, [0, 0])).toBeLessThan(
      estimateRouteTravelLength([trunk, farTail, nearStart], [0, 0]),
    );
  });

  test("prefers a slightly farther safe hidden-travel connector over a nearer exposed detour", () => {
    const main = lineStroke("main", [[0, 0], [4, 0], [6, 0]], 6);
    const exposedDetour = lineStroke("detour", [[6.05, 0.1], [6.05, 2.2], [6.05, 4.2]], 4.1);
    const safeContinuation = lineStroke("safe", [[6.2, 0], [8, 0], [10, 0]], 3.8);

    const ordered = orderStrokeBranchObjects(
      [main, exposedDetour, safeContinuation],
      [0, 0],
    );

    expect(ordered.map((obj) => obj.id)).toEqual([
      "main",
      "safe",
      "detour",
    ]);
  });

  test("ranks edge continuity over a slightly nearer sharp turn", () => {
    const main = lineStroke("main", [[0, 0], [4, 0], [6, 0]], 6);
    const sharpTurn = lineStroke("sharp-turn", [[6.1, 0.4], [6.1, 2.2], [6.1, 4]], 3.6);
    const smoothContinuation = lineStroke("smooth", [[6.8, 0], [9, 0], [12, 0]], 5.2);

    const ordered = orderStrokeBranchObjects(
      [sharpTurn, smoothContinuation, main],
      [0, 0],
    );

    expect(ordered.map((obj) => obj.id)).toEqual([
      "main",
      "smooth",
      "sharp-turn",
    ]);
  });
});

describe("optimizeOrder stroke branch integration", () => {
  test("orders connected stroke branch by main branch before shorter branches", () => {
    const design: EmbroideryDesign = {
      widthMm: 40,
      heightMm: 20,
      fabric,
      objects: [
        stroke("short", rect(28, 0, 5, 1), 5),
        stroke("trunk", rect(0, 0, 20, 1), 20),
        stroke("middle", rect(20, 0, 8, 1), 8),
      ],
    };

    const result = optimizeOrder(design);

    expect(result.objects.map((obj) => obj.id)).toEqual([
      "trunk",
      "middle",
      "short",
    ]);
  });

  test("keeps near stroke fragments in one branch group before distant fragments", () => {
    const design: EmbroideryDesign = {
      widthMm: 80,
      heightMm: 20,
      fabric,
      objects: [
        stroke("far", rect(60, 0, 8, 1), 8),
        stroke("main", rect(0, 0, 20, 1), 20),
        stroke("near-gap", rect(21.2, 0, 8, 1), 8),
      ],
    };

    const result = optimizeOrder(design);

    expect(result.objects.map((obj) => obj.id)).toEqual([
      "main",
      "near-gap",
      "far",
    ]);
  });

  test("uses the start-adjacent branch fragment before the trunk when that lowers travel", () => {
    const design: EmbroideryDesign = {
      widthMm: 80,
      heightMm: 20,
      fabric,
      objects: [
        stroke("far-tail", rect(26.4, 0, 4, 1), 4),
        stroke("trunk", rect(5.2, 0, 20, 1), 20),
        stroke("near-start", rect(0, 0, 4, 1), 4),
      ],
    };

    const result = optimizeOrder(design);

    expect(result.objects.map((obj) => obj.id)).toEqual([
      "near-start",
      "trunk",
      "far-tail",
    ]);
  });
});

describe("findBranches stroke gap tolerance", () => {
  test("groups near same-color stroke fragments without grouping ordinary fill gaps", () => {
    const strokeA = stroke("stroke-a", rect(0, 0, 20, 1), 20);
    const strokeB = stroke("stroke-b", rect(21.2, 0, 8, 1), 8);
    const fillA = {
      ...stroke("fill-a", rect(0, 5, 20, 4), 20, "none"),
      kind: "fill" as const,
      strokeMetrics: undefined,
    };
    const fillB = {
      ...stroke("fill-b", rect(21.2, 5, 8, 4), 8, "none"),
      kind: "fill" as const,
      strokeMetrics: undefined,
    };

    expect(findBranches([strokeA, strokeB])).toEqual([
      { objectIds: ["stroke-a", "stroke-b"], colorIndex: 0 },
    ]);
    expect(findBranches([fillA, fillB])).toEqual([
      { objectIds: ["fill-a"], colorIndex: 0 },
      { objectIds: ["fill-b"], colorIndex: 0 },
    ]);
  });
});
