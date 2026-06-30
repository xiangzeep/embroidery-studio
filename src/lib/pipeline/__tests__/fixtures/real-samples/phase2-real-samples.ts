export type Phase2Concern =
  | "excessive-function-codes"
  | "unsafe-connector-lines"
  | "missing-right-middle-detail"
  | "messy-slanted-and-bottom-edges";

export type Phase2RealSample = {
  id: string;
  sourceFileName: string;
  widthPx: number;
  heightPx: number;
  description: string;
  concerns: Phase2Concern[];
};

export type Phase2DstBaseline = {
  id: string;
  sourceFileName: string;
  recordCount: number;
  stitchCount: number;
  jumpCount: number;
  jumpRatio: number;
  stopCount: number;
  longestJumpMm: number;
  consecutiveJumpRunCount: number;
  maxConsecutiveJumpRun: number;
  colorBlockCount: number;
};

export function getPhase2RealSamples(): Phase2RealSample[] {
  return [
    {
      id: "c_00000",
      sourceFileName: "c_00000.png",
      widthPx: 256,
      heightPx: 256,
      description: "Small multi-color triangular sample used to expose excessive DST function codes and jump-heavy output.",
      concerns: ["excessive-function-codes", "unsafe-connector-lines"],
    },
    {
      id: "e_00000",
      sourceFileName: "e_00000.png",
      widthPx: 256,
      heightPx: 256,
      description: "Wilcom comparison sample where the generated output misses a right-middle detail and creates messy slanted/bottom edge stitches.",
      concerns: [
        "missing-right-middle-detail",
        "messy-slanted-and-bottom-edges",
        "excessive-function-codes",
      ],
    },
  ];
}

export function getPhase2DstBaselines(): Phase2DstBaseline[] {
  return [
    {
      id: "embroidery-1",
      sourceFileName: "embroidery (1).dst",
      recordCount: 1283,
      stitchCount: 986,
      jumpCount: 292,
      jumpRatio: 0.228,
      stopCount: 4,
      longestJumpMm: 11.6,
      consecutiveJumpRunCount: 253,
      maxConsecutiveJumpRun: 8,
      colorBlockCount: 5,
    },
    {
      id: "embroidery-3",
      sourceFileName: "embroidery (3).dst",
      recordCount: 885,
      stitchCount: 747,
      jumpCount: 133,
      jumpRatio: 0.15,
      stopCount: 4,
      longestJumpMm: 12.7,
      consecutiveJumpRunCount: 119,
      maxConsecutiveJumpRun: 7,
      colorBlockCount: 5,
    },
  ];
}
