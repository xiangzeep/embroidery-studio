import { buildObjects, type BuildObjectsInput } from "./build-objects";
import { getFabricProfile } from "./fabric";
import { resolveBuildMinRegionAreaPx } from "./line-art-settings";
import { optimizeOrder } from "./pathing";
import type { ConversionConfig } from "./config";
import type { PrepipelineResult } from "./compose";
import type { EmbroideryDesign, EmbroideryObject, EmbroideryObjectType, Point2D } from "./types";

export type GraphObjectType = EmbroideryObjectType;
export type GraphTransitionCommand = "stitch" | "jump" | "trim";

export type DesignGraphNode = {
  id: string;
  type: GraphObjectType;
  object: EmbroideryObject;
  entry: Point2D;
  exit: Point2D;
};

export type DesignGraphEdge = {
  fromObjectId: string;
  toObjectId: string;
  distanceMm: number;
  command: GraphTransitionCommand;
};

export type DesignGraph = {
  widthMm: number;
  heightMm: number;
  design: EmbroideryDesign;
  nodes: DesignGraphNode[];
  edges: DesignGraphEdge[];
};

const GRAPH_STITCH_THRESHOLD_MM = 1.5;
const GRAPH_TRIM_THRESHOLD_MM = 3;

export function buildDesignGraph(
  input: EmbroideryDesign | PrepipelineResult,
  config?: ConversionConfig,
): DesignGraph {
  const design = isDesign(input) ? input : buildDesignFromPrepipeline(input, config);
  const ordered = optimizeOrder(design);
  const nodes = ordered.objects.map((object) => {
    const entry = object.shape.outer[0] ?? [0, 0];
    const exit = object.shape.outer[object.shape.outer.length - 1] ?? entry;
    return {
      id: object.id,
      type: mapObjectType(object),
      object,
      entry: [entry[0], entry[1]] as Point2D,
      exit: [exit[0], exit[1]] as Point2D,
    };
  });
  return {
    widthMm: ordered.widthMm,
    heightMm: ordered.heightMm,
    design: ordered,
    nodes,
    edges: buildGraphEdges(nodes),
  };
}

export function mapObjectType(object: EmbroideryObject): GraphObjectType {
  if (object.kind === "run") return "RUN";
  if (object.kind === "satin") return "SATIN";
  return "TATAMI";
}

function buildDesignFromPrepipeline(
  pre: PrepipelineResult,
  config: ConversionConfig | undefined,
): EmbroideryDesign {
  if (!config) {
    throw new Error("buildDesignGraph requires conversion config when input is prepipeline output.");
  }
  const fabric = getFabricProfile(config.fabric);
  const buildInput: BuildObjectsInput = {
    regions: pre.regions,
    widthMm: pre.widthMm,
    widthPx: pre.widthPx,
    heightPx: pre.heightPx,
    fabric,
    digitizingMode: config.digitizingMode,
    outlineFontStrategy: config.outlineFontStrategy,
    satinMaxWidthMm: config.satinMaxWidthMm,
    minRegionAreaPx: resolveBuildMinRegionAreaPx(config.digitizingMode, config.minRegionAreaPx),
    removeWhiteBackground: config.removeWhiteBackground,
  };
  return {
    widthMm: pre.widthMm,
    heightMm: pre.heightMm,
    fabric,
    objects: buildObjects(buildInput),
  };
}

function buildGraphEdges(nodes: DesignGraphNode[]): DesignGraphEdge[] {
  const edges: DesignGraphEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const next = nodes[i];
    const distanceMm = distance(prev.exit, next.entry);
    edges.push({
      fromObjectId: prev.id,
      toObjectId: next.id,
      distanceMm,
      command: classifyTransition(distanceMm),
    });
  }
  return edges;
}

function classifyTransition(distanceMm: number): GraphTransitionCommand {
  if (distanceMm <= GRAPH_STITCH_THRESHOLD_MM) return "jump";
  if (distanceMm > GRAPH_TRIM_THRESHOLD_MM) return "trim";
  return "jump";
}

function isDesign(input: EmbroideryDesign | PrepipelineResult): input is EmbroideryDesign {
  return Array.isArray((input as EmbroideryDesign).objects);
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
