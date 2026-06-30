"use client";

import { Activity, GitBranch, Scissors, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { summarizeDebugMetrics } from "@/lib/pipeline";
import type { EmbroideryDesign, StitchPattern } from "@/lib/pipeline/types";

export type DebugOverlayOptions = {
  showJumps: boolean;
  showTrims: boolean;
  showStitchTypes: boolean;
};

type Props = {
  design: EmbroideryDesign | null;
  pattern: StitchPattern | null;
  overlay: DebugOverlayOptions;
  onOverlayChange: (next: DebugOverlayOptions) => void;
};

const LAYER_LABEL: Record<string, string> = {
  "base-fill": "Base fill",
  detail: "Detail",
  outline: "Outline",
  highlight: "Highlight",
  background: "Background",
  noise: "Noise",
};

const STROKE_LABEL: Record<string, string> = {
  "thin-run": "Thin run",
  "bean-run": "Bean run",
  "narrow-satin": "Narrow satin",
  "border-satin": "Border satin",
};

export function LayerDebugPanel({
  design,
  pattern,
  overlay,
  onOverlayChange,
}: Props) {
  const summary = summarizeDebugMetrics({ design, pattern });
  const disabled = !design || !pattern;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" />
          Layer Debug
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Jumps" value={summary.commands.jumpCount} />
          <Metric label="Trims" value={summary.commands.trimCount} />
          <Metric label="Short jumps" value={summary.commands.shortJumpCount} />
          <Metric label="Mid jumps" value={summary.commands.mediumJumpCount} />
          <Metric label="Long jumps" value={summary.commands.longJumpCount} />
          <Metric label="Max jump" value={`${summary.commands.maxJumpMm.toFixed(1)} mm`} />
          <Metric label="Travel" value={`${summary.commands.travelLengthMm.toFixed(1)} mm`} />
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <GitBranch className="size-3.5" />
            Layers
          </div>
          {summary.layers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Generate stitches to inspect layers.</p>
          ) : (
            <div className="space-y-1.5">
              {summary.layers.map((item) => (
                <div key={item.layer} className="flex items-center justify-between gap-2 text-sm">
                  <span>{LAYER_LABEL[item.layer] ?? item.layer}</span>
                  <Badge variant="outline">{item.objectCount}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Waves className="size-3.5" />
            Strokes
          </div>
          {summary.strokes.totalStrokeObjects === 0 ? (
            <p className="text-xs text-muted-foreground">No stroke objects detected.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Stroke objects" value={summary.strokes.totalStrokeObjects} />
                <Metric
                  label="Avg width"
                  value={`${summary.strokes.averageEstimatedWidthMm.toFixed(1)} mm`}
                />
                <Metric label="Fill risk" value={summary.strokes.fillRiskCount} />
              </div>
              <div className="space-y-1.5">
                {summary.strokes.kinds.map((item) => (
                  <div
                    key={item.strokeKind}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>{STROKE_LABEL[item.strokeKind] ?? item.strokeKind}</span>
                    <Badge variant="outline">{item.objectCount}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Scissors className="size-3.5" />
            Overlay
          </div>
          <ToggleRow
            label="Jump paths"
            checked={overlay.showJumps}
            disabled={disabled}
            onChange={(showJumps) => onOverlayChange({ ...overlay, showJumps })}
          />
          <ToggleRow
            label="Trim markers"
            checked={overlay.showTrims}
            disabled={disabled}
            onChange={(showTrims) => onOverlayChange({ ...overlay, showTrims })}
          />
          <ToggleRow
            label="Stitch types"
            checked={overlay.showStitchTypes}
            disabled={disabled}
            onChange={(showStitchTypes) => onOverlayChange({ ...overlay, showStitchTypes })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
