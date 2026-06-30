import type { StitchPattern } from "./types";
import type { EmbroideryFormat } from "./config";
import { writeEmbroideryViaWorker } from "./pyodide-worker";

export type WriteInput = {
  pattern: StitchPattern;
  format: EmbroideryFormat;
};

/**
 * pyembroidery 出力。Pyodide は Web Worker 内で動く (pyodide-worker.ts)。
 */
export async function writeEmbroidery(input: WriteInput): Promise<Blob> {
  return writeEmbroideryViaWorker(input);
}
