"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import type { StitchPattern } from "@/lib/pipeline/types";
import type { PipelineProgress } from "@/lib/pipeline";

const StitchPreview3D = dynamic(
  () => import("./stitch-preview-3d").then((m) => m.StitchPreview3D),
  { ssr: false, loading: () => <Loader2 className="size-6 animate-spin" /> },
);

type Props = {
  imageSrc: string | null;
  isProcessing: boolean;
  pattern: StitchPattern | null;
  progress: PipelineProgress | null;
};

const STAGE_LABEL: Record<PipelineProgress["stage"], string> = {
  "loading-cv": "OpenCV.js を読み込み中",
  "loading-py": "Pyodide を読み込み中",
  quantize: "減色処理中",
  vectorize: "ベクター化中",
  stitch: "ステッチ生成中",
  write: "刺繍ファイル書き出し中",
};

type TabValue = "source" | "stitch" | "3d";

export function StitchPreview({
  imageSrc,
  isProcessing,
  pattern,
  progress,
}: Props) {
  const [tab, setTab] = useState<TabValue>("source");

  // pattern が新規に入った瞬間に stitch タブへ自動切替 (派生 state パターン)。
  // ユーザが手動でタブを動かしたあとも、新しい pattern が来たら再度 stitch に戻す。
  const [lastPattern, setLastPattern] = useState<StitchPattern | null>(null);
  if (pattern !== lastPattern) {
    setLastPattern(pattern);
    if (pattern) setTab("stitch");
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">プレビュー</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isProcessing && progress && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{STAGE_LABEL[progress.stage]}</span>
              <span className="tabular-nums">{progress.percent}%</span>
            </div>
            <Progress value={progress.percent} />
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            <TabsTrigger value="source">元画像</TabsTrigger>
            <TabsTrigger value="stitch" disabled={!pattern}>
              ステッチ
            </TabsTrigger>
            <TabsTrigger value="3d" disabled={!pattern}>
              3D
            </TabsTrigger>
          </TabsList>

          <TabsContent value="source">
            <PreviewSurface>
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageSrc}
                  alt="source"
                  className="max-h-[480px] object-contain"
                />
              ) : (
                <EmptyState text="左のパネルから画像を読み込んでください" />
              )}
            </PreviewSurface>
          </TabsContent>

          <TabsContent value="stitch">
            <PreviewSurface>
              {pattern ? (
                <StitchCanvas pattern={pattern} />
              ) : (
                <EmptyState text="ステッチパスはここに描画されます" />
              )}
            </PreviewSurface>
          </TabsContent>

          <TabsContent value="3d">
            <PreviewSurface>
              {pattern ? (
                <StitchPreview3D pattern={pattern} />
              ) : (
                <EmptyState text="three.js による糸シミュレーション" />
              )}
            </PreviewSurface>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export function StitchCanvas({ pattern }: { pattern: StitchPattern }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = useMemo(
    () => Math.min(480 / pattern.widthMm, 480 / pattern.heightMm),
    [pattern.widthMm, pattern.heightMm],
  );
  const w = Math.max(1, Math.round(pattern.widthMm * scale));
  const h = Math.max(1, Math.round(pattern.heightMm * scale));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, pattern.widthMm, pattern.heightMm);

    ctx.fillStyle = "#faf8f3";
    ctx.fillRect(0, 0, pattern.widthMm, pattern.heightMm);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const block of pattern.blocks) {
      const color = rgbToCss(block.rgb);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.3;

      let prev: { x: number; y: number } | null = null;
      for (const s of block.stitches) {
        if (s.kind === "jump" || s.kind === "trim" || s.kind === "stop") {
          prev = null;
          continue;
        }
        if (prev) {
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        prev = { x: s.x, y: s.y };
      }
    }
  }, [pattern, w, h, scale]);

  return <canvas ref={ref} className="bg-white shadow-sm" />;
}

function rgbToCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function PreviewSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex h-[480px] items-center justify-center overflow-auto rounded-md border bg-muted/30">
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
