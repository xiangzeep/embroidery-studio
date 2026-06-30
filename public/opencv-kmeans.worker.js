// English note.
// English note.
//   { type: 'quantize', seq, width, height, buffer, colorCount, iterations, epsilon, smoothing }
// English note.
//   { type: 'result', seq, paletteBuf, labelsBuf, outBuf, width, height }
// English note.
//
// English note.
// English note.
//
// English note.

/* global cv */

self.importScripts('/opencv.js');

let ready = false;
const queued = [];

cv['onRuntimeInitialized'] = () => {
  ready = true;
  self.postMessage({ type: 'ready' });
  for (const msg of queued) handle(msg);
  queued.length = 0;
};

self.onmessage = (e) => {
  if (ready) handle(e.data);
  else queued.push(e.data);
};

// English note.
const BACKGROUND_LABEL = 0xff;

// English note.
// English note.
// English note.
const BILATERAL_PRESETS = [
  null,
  { d: 5, sigmaColor: 35, sigmaSpace: 35 },
  { d: 7, sigmaColor: 55, sigmaSpace: 55 },
  { d: 9, sigmaColor: 75, sigmaSpace: 75 },
  { d: 11, sigmaColor: 95, sigmaSpace: 95 },
];

function handle(msg) {
  if (!msg || msg.type !== 'quantize') return;
  const {
    seq,
    width,
    height,
    buffer,
    maskBuffer,
    colorCount,
    iterations = 10,
    epsilon = 1.0,
    smoothing = 0,
  } = msg;

  const pixelCount = width * height;
  const srcU8 = new Uint8ClampedArray(buffer);
  const opaqueMask = maskBuffer ? new Uint8Array(maskBuffer) : null;

  // English note.
  // English note.
  const sIdx = Math.max(0, Math.min(BILATERAL_PRESETS.length - 1, smoothing | 0));
  const bilateral = BILATERAL_PRESETS[sIdx];
  const rgbU8 = new Uint8Array(pixelCount * 3);
  if (bilateral) {
    let srcRgba = null;
    let rgb = null;
    let smoothed = null;
    try {
      srcRgba = cv.matFromArray(height, width, cv.CV_8UC4, srcU8);
      rgb = new cv.Mat();
      cv.cvtColor(srcRgba, rgb, cv.COLOR_RGBA2RGB);
      smoothed = new cv.Mat();
      cv.bilateralFilter(
        rgb,
        smoothed,
        bilateral.d,
        bilateral.sigmaColor,
        bilateral.sigmaSpace,
        cv.BORDER_DEFAULT,
      );
      rgbU8.set(smoothed.data);
    } catch (err) {
      self.postMessage({
        type: 'error',
        seq,
        message: 'bilateralFilter failed: ' + ((err && err.message) || String(err)),
      });
      if (srcRgba) srcRgba.delete();
      if (rgb) rgb.delete();
      if (smoothed) smoothed.delete();
      return;
    }
    srcRgba.delete();
    rgb.delete();
    smoothed.delete();
  } else {
    for (let i = 0; i < pixelCount; i++) {
      rgbU8[i * 3 + 0] = srcU8[i * 4 + 0];
      rgbU8[i * 3 + 1] = srcU8[i * 4 + 1];
      rgbU8[i * 3 + 2] = srcU8[i * 4 + 2];
    }
  }

  // English note.
  // English note.
  const opaqueIndices = [];
  for (let i = 0; i < pixelCount; i++) {
    if (!opaqueMask || opaqueMask[i] === 1) opaqueIndices.push(i);
  }
  const opaqueCount = opaqueIndices.length;

  if (opaqueCount < colorCount) {
    self.postMessage({
      type: 'error',
      seq,
      message: 'Cannot quantize because opaque pixel count is smaller than color count',
    });
    return;
  }

  // English note.
  const rgbF32 = new Float32Array(opaqueCount * 3);
  for (let j = 0; j < opaqueCount; j++) {
    const i = opaqueIndices[j];
    rgbF32[j * 3 + 0] = rgbU8[i * 3 + 0];
    rgbF32[j * 3 + 1] = rgbU8[i * 3 + 1];
    rgbF32[j * 3 + 2] = rgbU8[i * 3 + 2];
  }

  let samples = null;
  let labels = null;
  let centers = null;
  try {
    samples = cv.matFromArray(opaqueCount, 3, cv.CV_32FC1, rgbF32);

    const criteria = new cv.TermCriteria(
      cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER,
      iterations,
      epsilon,
    );

    labels = new cv.Mat();
    centers = new cv.Mat();
    cv.kmeans(
      samples,
      colorCount,
      labels,
      criteria,
      1,
      cv.KMEANS_PP_CENTERS,
      centers,
    );

    const palette = new Uint8Array(colorCount * 3);
    for (let k = 0; k < colorCount; k++) {
      palette[k * 3 + 0] = clampByte(centers.data32F[k * 3 + 0]);
      palette[k * 3 + 1] = clampByte(centers.data32F[k * 3 + 1]);
      palette[k * 3 + 2] = clampByte(centers.data32F[k * 3 + 2]);
    }

    // English note.
    const labelsArr = new Uint8Array(pixelCount).fill(BACKGROUND_LABEL);
    const outRgba = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
      outRgba[i * 4 + 0] = 255;
      outRgba[i * 4 + 1] = 255;
      outRgba[i * 4 + 2] = 255;
      outRgba[i * 4 + 3] = 255;
    }
    for (let j = 0; j < opaqueCount; j++) {
      const i = opaqueIndices[j];
      const k = labels.data32S[j];
      labelsArr[i] = k;
      outRgba[i * 4 + 0] = palette[k * 3 + 0];
      outRgba[i * 4 + 1] = palette[k * 3 + 1];
      outRgba[i * 4 + 2] = palette[k * 3 + 2];
      outRgba[i * 4 + 3] = 255;
    }

    self.postMessage(
      {
        type: 'result',
        seq,
        width,
        height,
        colorCount,
        paletteBuf: palette.buffer,
        labelsBuf: labelsArr.buffer,
        outBuf: outRgba.buffer,
      },
      [palette.buffer, labelsArr.buffer, outRgba.buffer],
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      seq,
      message: (err && err.message) || String(err),
    });
  } finally {
    if (samples) samples.delete();
    if (labels) labels.delete();
    if (centers) centers.delete();
  }
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
