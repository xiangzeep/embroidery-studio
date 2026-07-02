import type { Stitch } from "./types";

export type ObjectRouteOptions = {
  colorIndex: number;
  jumpThresholdMm?: number;
  trimThresholdMm?: number;
};

const DEFAULT_JUMP_THRESHOLD_MM = 1.5;
const DEFAULT_TRIM_THRESHOLD_MM = 3;

export function routeGraphObjects(
  previous: Stitch,
  next: Stitch,
  opts: ObjectRouteOptions,
): Stitch[] {
  const jumpThreshold = opts.jumpThresholdMm ?? DEFAULT_JUMP_THRESHOLD_MM;
  const trimThreshold = opts.trimThresholdMm ?? DEFAULT_TRIM_THRESHOLD_MM;
  const dist = Math.hypot(next.x - previous.x, next.y - previous.y);
  if (dist <= jumpThreshold) {
    return [{
      x: next.x,
      y: next.y,
      kind: "jump",
      colorIndex: opts.colorIndex,
    }];
  }
  if (dist > trimThreshold) {
    return [
      {
        x: previous.x,
        y: previous.y,
        kind: "trim",
        colorIndex: opts.colorIndex,
      },
      {
        x: next.x,
        y: next.y,
        kind: "jump",
        colorIndex: opts.colorIndex,
      },
    ];
  }
  return [{
    x: next.x,
    y: next.y,
    kind: "jump",
    colorIndex: opts.colorIndex,
  }];
}
