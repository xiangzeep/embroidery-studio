import type { Point2D, SkeletonBranch, SkeletonGraph, SkeletonNode } from "../types";

export type StrokeGraphNode = SkeletonNode;
export type StrokeGraphBranch = SkeletonBranch;

export type StrokeGraph = SkeletonGraph;
export type CleanStrokeGraph = StrokeGraph;

export type StrokePath = {
  id: string;
  points: Point2D[];
  closed: boolean;
  length: number;
  color: number;
};
