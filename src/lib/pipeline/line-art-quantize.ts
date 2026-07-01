import { BACKGROUND_LABEL, type QuantizeInput, type QuantizedImage } from "./opencv-worker";

type LineArtQuantizeInput = QuantizeInput & {
  removeWhiteBackground?: boolean;
};

const WHITE_THRESHOLD = 244;
const SAME_HUE_MERGE_DEG = 30;
const SAME_COLOR_DISTANCE = 80;

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

  const rawPalette = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, colorCount))
    .map((bucket) => ({
      count: bucket.count,
      rgb: [
        Math.round(bucket.r / bucket.count),
        Math.round(bucket.g / bucket.count),
        Math.round(bucket.b / bucket.count),
      ] as [number, number, number],
    }));

  const palette = mergeLineArtPalette(rawPalette);

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

function mergeLineArtPalette(
  colors: Array<{ count: number; rgb: [number, number, number] }>,
): Array<[number, number, number]> {
  const clusters: Array<{ count: number; r: number; g: number; b: number; rgb: [number, number, number] }> = [];
  for (const color of colors) {
    const match = clusters.find((cluster) => shouldMergeLineArtColors(color.rgb, cluster.rgb));
    if (!match) {
      clusters.push({
        count: color.count,
        r: color.rgb[0] * color.count,
        g: color.rgb[1] * color.count,
        b: color.rgb[2] * color.count,
        rgb: color.rgb,
      });
      continue;
    }
    match.count += color.count;
    match.r += color.rgb[0] * color.count;
    match.g += color.rgb[1] * color.count;
    match.b += color.rgb[2] * color.count;
    match.rgb = [
      Math.round(match.r / match.count),
      Math.round(match.g / match.count),
      Math.round(match.b / match.count),
    ];
  }
  return clusters.map((cluster) => cluster.rgb);
}

function shouldMergeLineArtColors(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  const distance = Math.sqrt(dr * dr + dg * dg + db * db);
  if (distance <= SAME_COLOR_DISTANCE) return true;

  const ah = rgbHue(a);
  const bh = rgbHue(b);
  if (ah === null || bh === null) return false;
  const hueDistance = Math.min(Math.abs(ah - bh), 360 - Math.abs(ah - bh));
  return hueDistance <= SAME_HUE_MERGE_DEG;
}

function rgbHue(rgb: [number, number, number]): number | null {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 0.08) return null;
  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  return (hue * 60 + 360) % 360;
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
