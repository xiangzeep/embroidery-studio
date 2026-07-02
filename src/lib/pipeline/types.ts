export type StitchKind = "run" | "satin" | "fill" | "jump" | "trim" | "stop";

/** English note. */
export type Point2D = [number, number];

/** English note. */
export type Polygon = Point2D[];

/**
 * English note.
 * English note.
 * English note.
 * English note.
 */
export type Shape = {
  outer: Polygon;
  holes: Polygon[];
};

export type BinaryMask = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type Stitch = {
  x: number;
  y: number;
  kind: StitchKind;
  colorIndex: number;
};

export type StitchBlock = {
  colorIndex: number;
  rgb: [number, number, number];
  stitches: Stitch[];
};

export type StitchPattern = {
  widthMm: number;
  heightMm: number;
  blocks: StitchBlock[];
  totalStitches: number;
};

// ---- Object-based local design model ----
// English note.
// English note.

export type ObjectKind = "run" | "satin" | "fill";

export type EmbroideryObjectType = "RUN" | "SATIN" | "TATAMI";

export type StrokeKind =
  | "none"
  | "thin-run"
  | "bean-run"
  | "narrow-satin"
  | "border-satin";

export type StrokeRole =
  | "none"
  | "outline"
  | "font"
  | "decorative-band"
  | "area";

export type StrokeOverride =
  | "use-global"
  | "force-run"
  | "force-satin"
  | "force-fill";

export type ObjectLayerKind =
  | "background"
  | "base-fill"
  | "detail"
  | "outline"
  | "highlight"
  | "noise";

export type UnderlayConfig =
  | { kind: "none" }
  | { kind: "edge-run"; insetMm: number; stitchLenMm: number }
  | { kind: "center-run"; stitchLenMm: number }
  | { kind: "zigzag"; spacingMm: number; insetMm: number }
  | { kind: "fill"; angleDeg: number; spacingMm: number };

export type ObjectProps = {
  densityMm: number;
  maxStitchMm: number;
  angleDeg?: number;
  pullCompMm?: number;
  pullCompPerSideMm?: { left: number; right: number };
  pushCompMm?: number;
  underlay?: UnderlayConfig;
  lockstitch?: boolean;
};

export type ShapeMetrics = {
  areaMm2: number;
  perimeterMm: number;
  bboxWidthMm: number;
  bboxHeightMm: number;
  compactness: number;
  aspectRatio: number;
  holeCount: number;
};

export type StrokeMetrics = {
  areaMm2: number;
  perimeterMm: number;
  bboxWidthMm: number;
  bboxHeightMm: number;
  estimatedWidthMm: number;
  estimatedLengthMm: number;
  slenderness: number;
  compactness: number;
  holeCount: number;
  widthMinMm?: number;
  widthAvgMm?: number;
  widthMaxMm?: number;
  hasStableSkeleton?: boolean;
  branchCount?: number;
  junctionCount?: number;
  loopCount?: number;
  isStrokeLike: boolean;
};

export type EmbroideryObject = {
  id: string;
  kind: ObjectKind;
  baseKind?: ObjectKind;
  layer?: ObjectLayerKind;
  colorIndex: number;
  rgb: [number, number, number];
  shape: Shape;
  props: ObjectProps;
  metrics?: ShapeMetrics;
  strokeKind?: StrokeKind;
  strokeRole?: StrokeRole;
  strokeMetrics?: StrokeMetrics;
  strokeOverride?: StrokeOverride;
  order: number;
  locked?: boolean;
  /**
    */
  visible?: boolean;
};

export type FabricKind =
  | "denim" | "twill" | "canvas"
  | "knit-light" | "knit-heavy"
  | "terry" | "fleece" | "leather" | "silk" | "felt";

export type UnderlayPolicy = {
  satin: (widthMm: number) => UnderlayConfig;
  fill: () => UnderlayConfig;
  run: () => UnderlayConfig;
};

export type FabricProfile = {
  kind: FabricKind;
  defaultDensityMm: number;
  pullCompPerWidth: number;
  minPullCompMm: number;
  underlayPolicy: UnderlayPolicy;
  defaultPushCompMm: number;
};

export type EmbroideryDesign = {
  widthMm: number;
  heightMm: number;
  fabric: FabricProfile;
  objects: EmbroideryObject[];
};

/**
 * English note.
 * English note.
 */
export type BranchGroup = {
  objectIds: string[];
  colorIndex: number;
};

export type SkeletonNode = {
  id: string;
  x: number;
  y: number;
  degree: number;
};

export type SkeletonBranch = {
  id: string;
  points: Point2D[];
  isLoop: boolean;
  startNodeId: string | null;
  endNodeId: string | null;
};

export type SkeletonGraph = {
  width: number;
  height: number;
  nodes: SkeletonNode[];
  branches: SkeletonBranch[];
};

export type WidthSample = {
  x: number;
  y: number;
  radiusMm: number;
  widthMm: number;
};
