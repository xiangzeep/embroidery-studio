import type {
  ObjectKind,
  ObjectProps,
  EmbroideryDesign,
  EmbroideryObject,
  FabricKind,
  FabricProfile,
} from "./types";

// English note.
const DEFAULT_DENSITY_MM = 0.4;
const DEFAULT_MAX_STITCH_MM = 4;
const SATIN_MAX_STITCH_MM = 7;
const SATIN_ANGLE_DEG = 0;
const FILL_ANGLE_DEG = 45;

/** English note. */
export function createDefaultObjectProps(kind: ObjectKind): ObjectProps {
  const base: ObjectProps = {
    densityMm: DEFAULT_DENSITY_MM,
    maxStitchMm: DEFAULT_MAX_STITCH_MM,
  };
  if (kind === "satin") {
    return { ...base, maxStitchMm: SATIN_MAX_STITCH_MM, angleDeg: SATIN_ANGLE_DEG };
  }
  if (kind === "fill") return { ...base, angleDeg: FILL_ANGLE_DEG };
  return base; // run
}

/** English note. */
export function createEmptyDesign(args: {
  widthMm: number;
  heightMm: number;
  fabric: FabricProfile;
}): EmbroideryDesign {
  return {
    widthMm: args.widthMm,
    heightMm: args.heightMm,
    fabric: args.fabric,
    objects: [],
  };
}

/**
 * English note.
 * English note.
 * English note.
 */
export type SerializedDesign = {
  widthMm: number;
  heightMm: number;
  fabric: { kind: FabricKind };
  objects: EmbroideryObject[]; // English note.
};

/** English note. */
export function serializeDesign(d: EmbroideryDesign): SerializedDesign {
  return {
    widthMm: d.widthMm,
    heightMm: d.heightMm,
    fabric: { kind: d.fabric.kind },
    // English note.
    objects: JSON.parse(JSON.stringify(d.objects)) as EmbroideryObject[],
  };
}

/** English note. */
export function deserializeDesign(
  s: SerializedDesign,
  fabricResolver: (kind: FabricKind) => FabricProfile,
): EmbroideryDesign {
  return {
    widthMm: s.widthMm,
    heightMm: s.heightMm,
    fabric: fabricResolver(s.fabric.kind),
    // English note.
    objects: JSON.parse(JSON.stringify(s.objects)) as EmbroideryObject[],
  };
}
