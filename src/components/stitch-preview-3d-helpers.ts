import type { StitchPattern } from "@/lib/pipeline/types";

export type ThreadSegment = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  rgb: [number, number, number];
};

export type OrthographicView = {
  width: number;
  height: number;
};

export const PREVIEW_3D_SCENE_BACKGROUND_HEX = 0xf5f3ef;
export const PREVIEW_3D_FABRIC_HEX = 0xf5f3ef;

export function buildThreadSegments(pattern: StitchPattern): ThreadSegment[] {
  const segments: ThreadSegment[] = [];
  const halfWidth = pattern.widthMm / 2;
  const halfHeight = pattern.heightMm / 2;

  for (const block of pattern.blocks) {
    let prev: { x: number; y: number } | null = null;
    for (const stitch of block.stitches) {
      if (stitch.kind === "jump" || stitch.kind === "trim" || stitch.kind === "stop") {
        prev = null;
        continue;
      }

      const current = {
        x: stitch.x - halfWidth,
        y: -(stitch.y - halfHeight),
      };

      if (prev) {
        segments.push({
          from: prev,
          to: current,
          rgb: block.rgb,
        });
      }

      prev = current;
    }
  }

  return segments;
}

export function rgbToHex([r, g, b]: [number, number, number]): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function getOrthographicView(
  patternWidthMm: number,
  patternHeightMm: number,
  viewportAspect: number,
  padding = 1.2,
): OrthographicView {
  const safeAspect = Number.isFinite(viewportAspect) && viewportAspect > 0 ? viewportAspect : 1;
  const targetWidth = Math.max(patternWidthMm, 1) * padding;
  const targetHeight = Math.max(patternHeightMm, 1) * padding;
  const patternAspect = targetWidth / targetHeight;

  if (patternAspect > safeAspect) {
    return {
      width: targetWidth,
      height: targetWidth / safeAspect,
    };
  }

  return {
    width: targetHeight * safeAspect,
    height: targetHeight,
  };
}
