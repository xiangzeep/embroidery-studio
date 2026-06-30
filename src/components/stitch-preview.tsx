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
  showJumpOverlay?: boolean;
  showTrimOverlay?: boolean;
  showStitchTypeOverlay?: boolean;
};

const STAGE_LABEL: Record<PipelineProgress["stage"], string> = {
  "loading-cv": "Loading OpenCV.js",
  "loading-py": "Loading Pyodide",
  quantize: "Quantizing colors",
  vectorize: "Vectorizing",
  stitch: "Generating stitches",
  write: "Writing embroidery file",
};

type TabValue = "source" | "stitch" | "3d";

export function StitchPreview({
  imageSrc,
  isProcessing,
  pattern,
  progress,
  showJumpOverlay = false,
  showTrimOverlay = false,
  showStitchTypeOverlay = false,
}: Props) {
  const [tab, setTab] = useState<TabValue>("source");

  // English note.
  // English note.
  const [lastPattern, setLastPattern] = useState<StitchPattern | null>(null);
  if (pattern !== lastPattern) {
    setLastPattern(pattern);
    if (pattern) setTab("stitch");
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
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
            <TabsTrigger value="source">Source Image</TabsTrigger>
            <TabsTrigger value="stitch" disabled={!pattern}>
              Stitches
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
                <EmptyState text="Load an image from the left panel" />
              )}
            </PreviewSurface>
          </TabsContent>

          <TabsContent value="stitch">
            <PreviewSurface>
              {pattern ? (
                <StitchCanvas
                  pattern={pattern}
                  showJumpOverlay={showJumpOverlay}
                  showTrimOverlay={showTrimOverlay}
                  showStitchTypeOverlay={showStitchTypeOverlay}
                />
              ) : (
                <EmptyState text="Thread simulation with three.js" />
              )}
            </PreviewSurface>
          </TabsContent>

          <TabsContent value="3d">
            <PreviewSurface>
              {pattern ? (
                <StitchPreview3D pattern={pattern} />
              ) : (
                <EmptyState text="Thread simulation with three.js" />
              )}
            </PreviewSurface>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export function StitchCanvas({
  pattern,
  showJumpOverlay = false,
  showTrimOverlay = false,
  showStitchTypeOverlay = false,
}: {
  pattern: StitchPattern;
  showJumpOverlay?: boolean;
  showTrimOverlay?: boolean;
  showStitchTypeOverlay?: boolean;
}) {
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
      ctx.lineWidth = 0.3;

      let prev: { x: number; y: number } | null = null;
      for (const s of block.stitches) {
        if (s.kind === "jump" || s.kind === "trim" || s.kind === "stop") {
          prev = null;
          continue;
        }
        if (prev) {
          ctx.strokeStyle = showStitchTypeOverlay ? stitchTypeColor(s.kind) : rgbToCss(block.rgb);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        prev = { x: s.x, y: s.y };
      }
    }

    if (showJumpOverlay || showTrimOverlay || showStitchTypeOverlay) {
      drawCommandOverlay(ctx, pattern, showJumpOverlay, showTrimOverlay, showStitchTypeOverlay);
    }
  }, [pattern, w, h, scale, showJumpOverlay, showTrimOverlay, showStitchTypeOverlay]);

  return <canvas ref={ref} className="bg-white shadow-sm" />;
}

function rgbToCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function drawCommandOverlay(
  ctx: CanvasRenderingContext2D,
  pattern: StitchPattern,
  showJumps: boolean,
  showTrims: boolean,
  showStitchTypes: boolean,
) {
  ctx.save();
  ctx.lineWidth = 0.2;
  ctx.setLineDash([1, 1]);
  for (const block of pattern.blocks) {
    let prev: { x: number; y: number } | null = null;
    for (const stitch of block.stitches) {
      if (stitch.kind === "jump" && showJumps && prev) {
        ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(stitch.x, stitch.y);
        ctx.stroke();
      }
      if (stitch.kind === "trim" && showTrims) {
        ctx.fillStyle = "rgba(245, 158, 11, 0.95)";
        ctx.beginPath();
        ctx.arc(stitch.x, stitch.y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      if (
        showStitchTypes &&
        (stitch.kind === "run" || stitch.kind === "satin" || stitch.kind === "fill")
      ) {
        ctx.fillStyle = stitchTypeOverlayColor(stitch.kind);
        ctx.beginPath();
        ctx.arc(stitch.x, stitch.y, 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      if (stitch.kind !== "stop") {
        prev = { x: stitch.x, y: stitch.y };
      }
    }
  }
  ctx.restore();
}

function stitchTypeColor(kind: "run" | "satin" | "fill"): string {
  if (kind === "run") return "rgba(34, 197, 94, 0.95)";
  if (kind === "satin") return "rgba(249, 115, 22, 0.95)";
  return "rgba(59, 130, 246, 0.92)";
}

function stitchTypeOverlayColor(kind: "run" | "satin" | "fill"): string {
  if (kind === "run") return "rgba(21, 128, 61, 0.95)";
  if (kind === "satin") return "rgba(194, 65, 12, 0.95)";
  return "rgba(29, 78, 216, 0.88)";
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
