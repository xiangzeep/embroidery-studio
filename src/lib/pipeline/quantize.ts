/**
 * 画像を k-means で減色するエントリポイント。
 * 実体は OpenCV.js が動く Web Worker で実行される (opencv-worker.ts)。
 * メインスレッドからは ImageData を渡し、減色結果とパレットを受け取るのみ。
 */
export {
  quantizeViaWorker as quantize,
  warmupOpenCV,
  terminateOpenCV,
  type QuantizeInput,
  type QuantizedImage,
} from "./opencv-worker";
