"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageUploader } from "@/components/image-uploader";
import { ConversionSettings } from "@/components/conversion-settings";
import { StitchPreview } from "@/components/stitch-preview";
import { ResultPanel } from "@/components/result-panel";
import { ColorAngleEditor } from "@/components/color-angle-editor";
import {
  runPrepipeline,
  runStitchAndWrite,
  type PipelineProgress,
  type PrepipelineResult,
} from "@/lib/pipeline";
import {
  makeDefaultConfig,
  type ConversionConfig,
} from "@/lib/pipeline/config";
import { warmupPyodide } from "@/lib/pipeline/pyodide-loader";
import { warmupOpenCV } from "@/lib/pipeline/quantize";
import type { StitchPattern } from "@/lib/pipeline/types";

export const defaultConfig: ConversionConfig = makeDefaultConfig("denim");

type StitchResult = {
  stitchCount: number;
  colorCount: number;
  fileBlob: Blob;
};

export function EmbroideryStudio() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [config, setConfig] = useState<ConversionConfig>(defaultConfig);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stitchResult, setStitchResult] = useState<StitchResult | null>(null);
  const [pattern, setPattern] = useState<StitchPattern | null>(null);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  /**
   * quantize+vectorize 済みの中間結果。色別角度を変えて再生成するときに使い回す。
   * 画像 or 量子化系のパラメータ (色数・幅・平滑化) を変えたら invalid 化する。
   */
  const [prepipeline, setPrepipeline] = useState<PrepipelineResult | null>(
    null,
  );

  useEffect(() => {
    void warmupOpenCV();
    void warmupPyodide();
  }, []);

  const onImage = (src: string | null) => {
    setImageSrc(src);
    setStitchResult(null);
    setPattern(null);
    setProgress(null);
    setPrepipeline(null);
    setConfig((c) => ({ ...c, fillAngleByColor: {} }));
  };

  const onConfigChange = (next: ConversionConfig) => {
    // quantize/vectorize の入力が変わったら中間キャッシュを無効化する。
    // (fillAngleDeg / fillAngleByColor / format / fabric は stitch+write 段でのみ
    // 参照されるためキャッシュ維持。fabric は config.stitchDensity の派生と
    // generateStitches の入力に流れるが、いずれも prepipeline 出力には依らない。)
    const invalidates =
      next.widthMm !== config.widthMm ||
      next.colorCount !== config.colorCount ||
      next.smoothing !== config.smoothing ||
      next.boundaryDilatePx !== config.boundaryDilatePx;
    if (invalidates) {
      setPrepipeline(null);
      setConfig({ ...next, fillAngleByColor: {} });
    } else {
      setConfig(next);
    }
  };

  const onConvert = async () => {
    if (!imageSrc) return;
    // quantize/vectorize の中間キャッシュが残っているなら、stitch+write だけ走らせる。
    // (角度・形式など stitch 以降のパラメータだけ変えた再生成はこちら経由になる)
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
      const { pattern: pat, fileBlob } = await runStitchAndWrite(
        pre,
        config,
        (p) => setProgress(p),
      );
      setPattern(pat);
      setStitchResult({
        stitchCount: pat.totalStitches,
        colorCount: pat.blocks.length,
        fileBlob,
      });
      toast.success(
        `生成完了: ${pat.totalStitches.toLocaleString()} ステッチ`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`変換失敗: ${message}`);
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
      const { pattern: pat, fileBlob } = await runStitchAndWrite(
        prepipeline,
        config,
        (p) => setProgress(p),
      );
      setPattern(pat);
      setStitchResult({
        stitchCount: pat.totalStitches,
        colorCount: pat.blocks.length,
        fileBlob,
      });
      toast.success("縫う向きを反映しました");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`再生成失敗: ${message}`);
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
        />
      </section>

      <aside className="flex flex-col gap-6">
        <ResultPanel result={stitchResult} format={config.format} />
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
      </aside>
    </div>
  );
}
