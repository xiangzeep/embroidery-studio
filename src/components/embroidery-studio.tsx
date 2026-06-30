"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageUploader } from "@/components/image-uploader";
import { ConversionSettings } from "@/components/conversion-settings";
import { StitchPreview } from "@/components/stitch-preview";
import { ResultPanel } from "@/components/result-panel";
import { ColorAngleEditor } from "@/components/color-angle-editor";
import { ObjectInspector } from "@/components/object-inspector";
import { SewingOrderPanel } from "@/components/sewing-order-panel";
import { resolveSampleImageFromSearch } from "@/components/sample-image";
import {
  LayerDebugPanel,
  type DebugOverlayOptions,
} from "@/components/layer-debug-panel";
import {
  rerenderDesignAndWrite,
  runPrepipeline,
  runStitchAndWrite,
  type PipelineProgress,
  type PrepipelineResult,
} from "@/lib/pipeline";
import {
  makeDefaultConfig,
  type ConversionConfig,
} from "@/lib/pipeline/config";
import { getPyodideWorkerStatus, warmupPyodide, type PyodideWorkerStatus } from "@/lib/pipeline/pyodide-loader";
import { warmupOpenCV } from "@/lib/pipeline/quantize";
import type { PatternStats } from "@/lib/pipeline";
import type { EmbroideryDesign, StitchPattern } from "@/lib/pipeline/types";
import { useDesignStore } from "@/components/design-store";
import { Button } from "@/components/ui/button";

export const defaultConfig: ConversionConfig = makeDefaultConfig("denim");

type StitchResult = {
  fileBlob: Blob;
  stats: PatternStats;
};

export function EmbroideryStudio() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [config, setConfig] = useState<ConversionConfig>(defaultConfig);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stitchResult, setStitchResult] = useState<StitchResult | null>(null);
  const [pattern, setPattern] = useState<StitchPattern | null>(null);
  const [design, setDesign] = useState<EmbroideryDesign | null>(null);
  const [debugOverlay, setDebugOverlay] = useState<DebugOverlayOptions>({
    showJumps: false,
    showTrims: false,
    showStitchTypes: false,
  });
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [exportStatus, setExportStatus] = useState<PyodideWorkerStatus>({ state: "idle" });
  /**
   * English note.
   * English note.
   */
  const [prepipeline, setPrepipeline] = useState<PrepipelineResult | null>(
    null,
  );
  const setStoreDesign = useDesignStore((s) => s.setDesign);
  const storeDesign = useDesignStore((s) => s.design);
  const storeVisualization = useDesignStore((s) => s.visualization);
  const setVisualization = useDesignStore((s) => s.setVisualization);

  useEffect(() => {
    void warmupOpenCV();
  }, []);

  useEffect(() => {
    const sample = resolveSampleImageFromSearch(window.location.search);
    if (sample) onImage(sample);
    // This local sample hook is intentionally one-shot on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!imageSrc || config.format === "dst") {
      setExportStatus(getPyodideWorkerStatus());
      return;
    }

    setExportStatus(getPyodideWorkerStatus());
    void warmupPyodide()
      .then(() => setExportStatus(getPyodideWorkerStatus()))
      .catch(() => setExportStatus(getPyodideWorkerStatus()));
  }, [imageSrc, config.format]);

  const onImage = (src: string | null) => {
    setImageSrc(src);
    setStitchResult(null);
    setPattern(null);
    setDesign(null);
    setStoreDesign(null);
    setProgress(null);
    setPrepipeline(null);
    setConfig((c) => ({ ...c, fillAngleByColor: {} }));
  };

  const onConfigChange = (next: ConversionConfig) => {
    // English note.
    // English note.
    // English note.
    // English note.
    const invalidates =
      next.widthMm !== config.widthMm ||
      next.qualityPreset !== config.qualityPreset ||
      next.colorCount !== config.colorCount ||
      next.smoothing !== config.smoothing ||
      next.boundaryDilatePx !== config.boundaryDilatePx ||
      next.minRegionAreaPx !== config.minRegionAreaPx ||
      next.removeWhiteBackground !== config.removeWhiteBackground;
    if (invalidates) {
      setPrepipeline(null);
      setConfig({ ...next, fillAngleByColor: {} });
    } else {
      setConfig(next);
    }
  };

  const onConvert = async () => {
    if (!imageSrc) return;
    // English note.
    // English note.
    if (prepipeline) {
      await onRegenerate();
      return;
    }
    setIsProcessing(true);
    setProgress({ stage: "loading-cv", percent: 0 });
    try {
      const blob = await (await fetch(imageSrc)).blob();
      const bitmap = await createImageBitmap(blob);
      const pre = await runPrepipeline(bitmap, config, (p) => setProgress(p));
      setPrepipeline(pre);
      const { pattern: pat, design: nextDesign, fileBlob, stats } = await runStitchAndWrite(
        pre,
        config,
        (p) => setProgress(p),
      );
      setPattern(pat);
      setDesign(nextDesign);
      setStoreDesign(nextDesign);
      setStitchResult({
        fileBlob,
        stats,
      });
      toast.success(
        `Generation complete: ${pat.totalStitches.toLocaleString()} Stitches`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Conversion failed: ${message}`);
      console.error(e);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const onRegenerate = async () => {
    if (!prepipeline) return;
    setIsProcessing(true);
    setProgress({ stage: "stitch", percent: 75 });
    try {
      const { pattern: pat, design: nextDesign, fileBlob, stats } = await runStitchAndWrite(
        prepipeline,
        config,
        (p) => setProgress(p),
      );
      setPattern(pat);
      setDesign(nextDesign);
      setStoreDesign(nextDesign);
      setStitchResult({
        fileBlob,
        stats,
      });
      toast.success("Stitch direction applied");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Regeneration failed: ${message}`);
      console.error(e);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const onApplyObjectEdits = async () => {
    if (!prepipeline || !storeDesign) return;
    setIsProcessing(true);
    setProgress({ stage: "stitch", percent: 75 });
    try {
      const { pattern: pat, design: nextDesign, fileBlob, stats } = await rerenderDesignAndWrite(
        storeDesign,
        prepipeline,
        config,
        (p) => setProgress(p),
      );
      setPattern(pat);
      setDesign(nextDesign);
      setStoreDesign(nextDesign);
      setStitchResult({
        fileBlob,
        stats,
      });
      toast.success("Object edits applied");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Apply edits failed: ${message}`);
      console.error(e);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_320px]">
      <aside className="flex flex-col gap-6">
        <ImageUploader onImage={onImage} />
        <ConversionSettings
          value={config}
          onChange={onConfigChange}
          disabled={!imageSrc || isProcessing}
          onConvert={onConvert}
        />
      </aside>

      <section className="min-h-[520px]">
        <StitchPreview
          imageSrc={imageSrc}
          isProcessing={isProcessing}
          pattern={pattern}
          progress={progress}
          showJumpOverlay={debugOverlay.showJumps}
          showTrimOverlay={debugOverlay.showTrims}
          showStitchTypeOverlay={debugOverlay.showStitchTypes}
        />
      </section>

      <aside className="flex flex-col gap-6">
        <ResultPanel
          result={stitchResult}
          format={config.format}
          exportStatus={exportStatus}
        />
        {pattern && prepipeline && (
          <ColorAngleEditor
            blocks={pattern.blocks}
            defaultAngleDeg={config.fillAngleDeg}
            value={config.fillAngleByColor}
            disabled={isProcessing}
            onChange={(next) =>
              setConfig((c) => ({ ...c, fillAngleByColor: next }))
            }
            onApply={onRegenerate}
          />
        )}
        <LayerDebugPanel
          design={design}
          pattern={pattern}
          overlay={debugOverlay}
          onOverlayChange={setDebugOverlay}
        />
        {design && (
          <>
            <Button
              variant="outline"
              onClick={onApplyObjectEdits}
              disabled={!prepipeline || !storeDesign || isProcessing}
            >
              Apply Object Edits
            </Button>
            <SewingOrderPanel
              showTravel={storeVisualization.showTravel}
              onShowTravelChange={(next) => setVisualization({ showTravel: next })}
            />
            <ObjectInspector config={config} />
          </>
        )}
      </aside>
    </div>
  );
}
