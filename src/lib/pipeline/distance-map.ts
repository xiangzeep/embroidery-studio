import type { BinaryMask, SkeletonGraph, WidthSample } from "./types";

export function computeDistanceMap(mask: BinaryMask): Float32Array {
  const out = new Float32Array(mask.width * mask.height);
  const inf = 1e9;
  const sqrt2 = Math.SQRT2;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const index = y * mask.width + x;
      out[index] = mask.data[index] === 0 ? 0 : inf;
    }
  }

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const index = y * mask.width + x;
      let best = out[index];
      if (best === 0) continue;
      if (x > 0) best = Math.min(best, out[index - 1] + 1);
      if (y > 0) best = Math.min(best, out[index - mask.width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, out[index - mask.width - 1] + sqrt2);
      if (x + 1 < mask.width && y > 0) best = Math.min(best, out[index - mask.width + 1] + sqrt2);
      out[index] = best;
    }
  }

  for (let y = mask.height - 1; y >= 0; y--) {
    for (let x = mask.width - 1; x >= 0; x--) {
      const index = y * mask.width + x;
      let best = out[index];
      if (best === 0) continue;
      if (x + 1 < mask.width) best = Math.min(best, out[index + 1] + 1);
      if (y + 1 < mask.height) best = Math.min(best, out[index + mask.width] + 1);
      if (x + 1 < mask.width && y + 1 < mask.height) best = Math.min(best, out[index + mask.width + 1] + sqrt2);
      if (x > 0 && y + 1 < mask.height) best = Math.min(best, out[index + mask.width - 1] + sqrt2);
      out[index] = best;
    }
  }

  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i]) || out[i] >= inf / 2) {
      out[i] = 0;
    }
  }

  return out;
}

export function measureSkeletonWidths(
  graph: SkeletonGraph,
  distanceMap: Float32Array,
  mmPerPx: number,
): WidthSample[] {
  const samples: WidthSample[] = [];
  const seen = new Set<string>();

  for (const branch of graph.branches) {
    for (const [x, y] of branch.points) {
      const sampleKey = `${x},${y}`;
      if (seen.has(sampleKey)) continue;
      seen.add(sampleKey);
      const radiusPx = distanceMap[y * graph.width + x] ?? 0;
      const radiusMm = radiusPx * mmPerPx;
      samples.push({
        x,
        y,
        radiusMm,
        widthMm: radiusMm * 2,
      });
    }
  }

  return samples;
}
