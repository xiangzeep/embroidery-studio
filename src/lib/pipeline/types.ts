export type StitchKind = "run" | "satin" | "fill" | "jump" | "trim" | "stop";

/** px 単位の 2D 座標 */
export type Point2D = [number, number];

/** 閉ポリゴン。先頭と末尾は同一点でも非同一でも可。最低 3 点。 */
export type Polygon = Point2D[];

/**
 * 1 個の連結領域 = 外形 + 0 個以上の穴。
 * imagetracerjs における 1 つの <path d="..."> に対応する。
 * - outer: 外形リング（向きは正規化しない。fill/scanline は向き非依存）
 * - holes: 穴リング。外形に完全に内包される前提（fallback で補正）。
 */
export type Shape = {
  outer: Polygon;
  holes: Polygon[];
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

// ---- Object-based model (Phase 1) ----
// EmbroideryObject 配下は純データのみ。関数フィールドを足す場合は
// design.ts の serializeDesign を必ず見直すこと (JSON.parse/stringify deep copy 依存)。

export type ObjectKind = "run" | "satin" | "fill";

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

export type EmbroideryObject = {
  id: string;
  kind: ObjectKind;
  colorIndex: number;
  rgb: [number, number, number];
  shape: Shape;
  props: ObjectProps;
  order: number;
  locked?: boolean;
  /** Phase 5 PR22: UI 上の visibility 切替。undefined は表示 (= true) 扱い。
   *  renderer は visibility を見ないため stitch 生成には影響しない (UI 専用)。 */
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
 * Phase 3 §4 Branching: 同色で互いに接触する EmbroideryObject 群。
 * `objectIds` は同 group 内の入力 index 昇順、`colorIndex` は group 共通色。
 */
export type BranchGroup = {
  objectIds: string[];
  colorIndex: number;
};
