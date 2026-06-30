import type { StitchPattern } from "./types";
import type { EmbroideryFormat } from "./config";
import { writeEmbroideryViaWorker } from "./pyodide-worker";
import { writeDst } from "./dst-writer";
import { optimizePatternCommands } from "./command-optimizer";

export type WriteInput = {
  pattern: StitchPattern;
  format: EmbroideryFormat;
};

/**
 * English note.
 */
export async function writeEmbroidery(input: WriteInput): Promise<Blob> {
  const pattern = optimizePatternCommands(input.pattern);
  if (input.format === "dst") {
    return writeDst(pattern);
  }
  return writeEmbroideryViaWorker({ ...input, pattern });
}
