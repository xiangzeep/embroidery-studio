/// <reference lib="webworker" />

import { vectorize, type VectorizeInput } from "./vectorize";
import { compactVectorizeRegionsForTransfer } from "./vectorize-payload";

type VectorizeWorkerRequest = VectorizeInput & {
  type: "vectorize";
  seq: number;
};

self.onmessage = async (event: MessageEvent<VectorizeWorkerRequest>) => {
  const input = event.data;
  if (!input || input.type !== "vectorize") return;
  try {
    const regions = compactVectorizeRegionsForTransfer(await vectorize(input));
    self.postMessage({ type: "result", seq: input.seq, regions });
  } catch (error) {
    self.postMessage({
      type: "error",
      seq: input.seq,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
