import { BACKGROUND_LABEL, type QuantizeInput, type QuantizedImage } from "./opencv-worker";

type LineArtQuantizeInput = QuantizeInput & {
  removeWhiteBackground?: boolean;
};

const WHITE_THRESHOLD = 244;

export function quantizeLineArt(input: LineArtQuantizeInput): QuantizedImage {
  const {
    imageData,
    opaqueMask,
    colorCount,
    removeWhiteBackground = true,
  } = input;
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const foreground = new Uint8Array(pixelCount);
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < pixelCount; i++) {
    if (opaqueMask && opaqueMask[i] !== 1) continue;
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (removeWhiteBackground && isNearWhite(r, g, b)) continue;
    foreground[i] = 1;
    const key = bucketKey(r, g, b);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const palette = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, colorCount))
    .map((bucket) => [
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ] as [number, number, number]);

  if (palette.length === 0) palette.push([0, 0, 0]);

  const labels = new Uint8Array(pixelCount).fill(BACKGROUND_LABEL);
  const out = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    if (!foreground[i]) {
      out[i * 4 + 0] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
      out[i * 4 + 3] = 255;
      continue;
    }
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const k = nearestPaletteIndex(r, g, b, palette);
    labels[i] = k;
    out[i * 4 + 0] = palette[k][0];
    out[i * 4 + 1] = palette[k][1];
    out[i * 4 + 2] = palette[k][2];
    out[i * 4 + 3] = 255;
  }

  return {
    imageData: new ImageData(out, width, height),
    palette,
    labels,
  };
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD;
}

function bucketKey(r: number, g: number, b: number): number {
  return (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
}

function nearestPaletteIndex(
  r: number,
  g: number,
  b: number,
  palette: Array<[number, number, number]>,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
