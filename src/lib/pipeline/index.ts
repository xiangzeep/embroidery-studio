export {
  convertImageToEmbroideryDirect,
  rerenderDesignAndWrite,
  runPrepipeline,
  runStitchAndWrite,
  type PipelineStage,
  type PipelineProgress,
  type PipelineResult,
  type PrepipelineResult,
} from "./compose";
export {
  generateStitches,
  renderDesign,
  renderDesignGraph,
  renderRun,
  renderSatin,
  renderFill,
  resamplePolyline,
  makeStitch,
  __internal,
  type RenderOptions,
  type RenderContext,
  type StitchInput,
  type FillStrategy,
} from "./render";
export { analyzePattern, type PatternStats, type PatternWarning } from "./stats";
export { vectorizeViaWorker, type VectorizeWorkerOptions } from "./vectorize-worker";

export { analyzeDstBytes, classifyDstRecord, decodeDstDelta, parseDstHeader, type DstAnalysis, type DstCommandKind } from "./dst-analyzer";

export { assignLayers, classifyLayer, measureLayerShape, type AssignLayersInput, type LayerClassificationInput, type LayeredShape, type LayerKind } from "./layers";

export { classifyBackgroundShape, shouldKeepNearWhiteShape, touchesCanvasEdge, shapeArea, type BackgroundClassification, type BackgroundClassificationInput, type BackgroundShapeKind } from "./background";

export { simplifyPolygon, simplifyShapeBoundary } from "./region-merge";

export { resolveLayerStitchPolicy, type LayerStitchPolicy, type LayerStitchPolicyInput } from "./layer-stitch-policy";

export { isSafeTravelBetweenObjects, isSegmentInsideShape, type SafeTravelInput } from "./safe-travel";

export { optimizePatternCommands, optimizeStitches } from "./command-optimizer";

export { summarizeDebugMetrics, type CommandDebugMetric, type DebugMetricsSummary, type LayerDebugMetric } from "./debug-metrics";

export { runBenchmarkFixture, type BenchmarkInput, type Phase2BenchmarkRow } from "./benchmark";

export { groupObjectsByLayerOrder, layerOrderRank, type LayerObjectGroup } from "./layer-ordering";

export { analyzeStrokeMetrics, type StrokeMetrics } from "./stroke-metrics";
export { skeletonizeMask } from "./skeleton";
export { computeDistanceMap, measureSkeletonWidths } from "./distance-map";

export { classifyStrokeKind, resolveObjectKindForStroke, type StrokeKind } from "./stroke-classifier";

export { beanStitchPolyline } from "./bean-stitch";
export {
  classifyRunSegmentStyle,
  doubleRunPolyline,
  isClosedRunSegment,
  styleRunSegment,
  tripleRunPolyline,
} from "./run-style";

export { shouldRenderAsStrokeSatin } from "./curved-satin";

export { isStrokeBranchGroup, orderStrokeBranchObjects } from "./stroke-graph";

export { buildDesignGraph, mapObjectType, type DesignGraph, type DesignGraphNode, type DesignGraphEdge, type GraphObjectType } from "./design-graph";
export { connectLineArtRunObjects } from "./line-art-stroke-connector";
export { regularizeShapeForStitch, type ShapeRegularizerOptions } from "./shape-regularizer";
export { cleanPath, filterNearDuplicates, resampleClosed, resampleOpen } from "./path-cleaner";
export { routeGraphObjects } from "./object-router";
