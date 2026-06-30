import type {
  EmbroideryDesign,
  ObjectLayerKind,
  Stitch,
  StitchPattern,
  StrokeKind,
} from "./types";

export type LayerDebugMetric = {
  layer: ObjectLayerKind;
  objectCount: number;
};

export type CommandDebugMetric = {
  jumpCount: number;
  shortJumpCount: number;
  mediumJumpCount: number;
  longJumpCount: number;
  trimCount: number;
  stopCount: number;
  maxJumpMm: number;
  travelLengthMm: number;
};

export type StrokeKindDebugMetric = {
  strokeKind: Exclude<StrokeKind, "none">;
  objectCount: number;
};

export type StrokeDebugMetric = {
  totalStrokeObjects: number;
  fillRiskCount: number;
  kinds: StrokeKindDebugMetric[];
  averageEstimatedWidthMm: number;
};

export type DebugMetricsSummary = {
  layers: LayerDebugMetric[];
  commands: CommandDebugMetric;
  strokes: StrokeDebugMetric;
};

const LAYER_ORDER: ObjectLayerKind[] = [
  "base-fill",
  "detail",
  "outline",
  "highlight",
  "background",
  "noise",
];

export function summarizeDebugMetrics(input: {
  design: EmbroideryDesign | null;
  pattern: StitchPattern | null;
}): DebugMetricsSummary {
  return {
    layers: summarizeLayers(input.design),
    commands: summarizeCommands(input.pattern),
    strokes: summarizeStrokes(input.design),
  };
}

function summarizeLayers(design: EmbroideryDesign | null): LayerDebugMetric[] {
  if (!design) return [];
  const counts = new Map<ObjectLayerKind, number>();
  for (const object of design.objects) {
    const layer = object.layer ?? "detail";
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  return LAYER_ORDER
    .filter((layer) => counts.has(layer))
    .map((layer) => ({ layer, objectCount: counts.get(layer) ?? 0 }));
}

const STROKE_KIND_ORDER: Exclude<StrokeKind, "none">[] = [
  "thin-run",
  "bean-run",
  "narrow-satin",
  "border-satin",
];

function summarizeStrokes(design: EmbroideryDesign | null): StrokeDebugMetric {
  if (!design) {
    return {
      totalStrokeObjects: 0,
      fillRiskCount: 0,
      kinds: [],
      averageEstimatedWidthMm: 0,
    };
  }

  let totalStrokeObjects = 0;
  let fillRiskCount = 0;
  let widthTotal = 0;
  let widthCount = 0;
  const counts = new Map<Exclude<StrokeKind, "none">, number>();

  for (const object of design.objects) {
    const strokeKind = object.strokeKind;
    if (!strokeKind || strokeKind === "none") continue;
    totalStrokeObjects++;
    counts.set(strokeKind, (counts.get(strokeKind) ?? 0) + 1);
    if (object.kind === "fill") fillRiskCount++;
    const width = object.strokeMetrics?.estimatedWidthMm;
    if (width !== undefined && Number.isFinite(width)) {
      widthTotal += width;
      widthCount++;
    }
  }

  return {
    totalStrokeObjects,
    fillRiskCount,
    kinds: STROKE_KIND_ORDER
      .filter((strokeKind) => counts.has(strokeKind))
      .map((strokeKind) => ({
        strokeKind,
        objectCount: counts.get(strokeKind) ?? 0,
      })),
    averageEstimatedWidthMm:
      widthCount === 0 ? 0 : Math.round((widthTotal / widthCount) * 10) / 10,
  };
}

function summarizeCommands(pattern: StitchPattern | null): CommandDebugMetric {
  if (!pattern) {
    return {
      jumpCount: 0,
      shortJumpCount: 0,
      mediumJumpCount: 0,
      longJumpCount: 0,
      trimCount: 0,
      stopCount: 0,
      maxJumpMm: 0,
      travelLengthMm: 0,
    };
  }
  let jumpCount = 0;
  let shortJumpCount = 0;
  let mediumJumpCount = 0;
  let longJumpCount = 0;
  let trimCount = 0;
  let stopCount = 0;
  let maxJumpMm = 0;
  let travelLengthMm = 0;

  for (const block of pattern.blocks) {
    let previous: Stitch | null = null;
    for (const stitch of block.stitches) {
      if (stitch.kind === "jump") {
        jumpCount++;
        const len = previous ? distance(previous, stitch) : 0;
        if (len <= 2) shortJumpCount++;
        else if (len <= 5) mediumJumpCount++;
        else longJumpCount++;
        maxJumpMm = Math.max(maxJumpMm, len);
        travelLengthMm += len;
      } else if (stitch.kind === "trim") {
        trimCount++;
      } else if (stitch.kind === "stop") {
        stopCount++;
      }
      previous = stitch;
    }
  }

  return {
    jumpCount,
    shortJumpCount,
    mediumJumpCount,
    longJumpCount,
    trimCount,
    stopCount,
    maxJumpMm,
    travelLengthMm,
  };
}

function distance(a: Stitch, b: Stitch): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
