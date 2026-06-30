// Minimal ambient declaration for clipper-lib@^6.4.2 (no @types/clipper-lib upstream).
// Only the surface used by src/lib/pipeline/polygon-offset.ts is declared.
declare module "clipper-lib" {
  export type IntPoint = { X: number; Y: number };
  export type Path = IntPoint[];
  export type Paths = Path[];

  export const ClipType: {
    ctIntersection: number;
    ctUnion: number;
    ctDifference: number;
    ctXor: number;
  };
  export const PolyType: { ptSubject: number; ptClip: number };
  export const PolyFillType: {
    pftEvenOdd: number;
    pftNonZero: number;
    pftPositive: number;
    pftNegative: number;
  };
  export const JoinType: {
    jtSquare: number;
    jtRound: number;
    jtMiter: number;
  };
  export const EndType: {
    etOpenSquare: number;
    etOpenRound: number;
    etOpenButt: number;
    etClosedLine: number;
    etClosedPolygon: number;
  };

  export class Clipper {
    constructor(initOptions?: number);
    AddPath(path: Path, polyType: number, closed: boolean): boolean;
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: Paths,
      subjFillType?: number,
      clipFillType?: number,
    ): boolean;
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
  }

  const ClipperLib: {
    ClipType: typeof ClipType;
    PolyType: typeof PolyType;
    PolyFillType: typeof PolyFillType;
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    Clipper: typeof Clipper;
    ClipperOffset: typeof ClipperOffset;
  };
  export default ClipperLib;
}
