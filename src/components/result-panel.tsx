"use client";

import { Download, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { EmbroideryFormat } from "@/lib/pipeline/config";
import type { PatternStats } from "@/lib/pipeline";
import type { PyodideWorkerStatus } from "@/lib/pipeline/pyodide-loader";

type Result = {
  fileBlob: Blob;
  stats: PatternStats;
};

type Props = {
  result: Result | null;
  format: EmbroideryFormat;
  exportStatus: PyodideWorkerStatus;
};

export function ResultPanel({ result, format, exportStatus }: Props) {
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.fileBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `embroidery.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3. Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result ? (
          <>
            <Stat label="Total Stitches" value={result.stats.stitchCount.toLocaleString()} />
            <Stat label="Colors" value={result.stats.colorCount.toLocaleString()} />
            <Stat label="Blocks" value={result.stats.blockCount.toLocaleString()} />
            <Stat label="Jumps" value={result.stats.jumpCount.toLocaleString()} />
            <Stat label="Trims" value={result.stats.trimCount.toLocaleString()} />
            <Stat label="Stops" value={result.stats.stopCount.toLocaleString()} />
            <Stat label="Max Stitch" value={`${result.stats.maxStitchLengthMm.toFixed(1)} mm`} />
            <Stat label="Avg Stitch" value={`${result.stats.averageStitchLengthMm.toFixed(1)} mm`} />
            <Stat label="Thread Length" value={`${result.stats.threadLengthMm.toFixed(1)} mm`} />
            <Stat label="Travel Length" value={`${result.stats.travelLengthMm.toFixed(1)} mm`} />
            <Stat label="Tiny Blocks" value={result.stats.tinyBlockCount.toLocaleString()} />
            <Stat label="Format" value={format.toUpperCase()} />
            <Stat label="Export Engine" value={exportEngineLabel(format, exportStatus)} />
            {result.stats.warnings.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                {result.stats.warnings.map((warning) => (
                  <div key={warning.code} className="flex items-start justify-between gap-3">
                    <span>{warning.message}</span>
                    <Badge variant={warning.level === "danger" ? "destructive" : "secondary"}>
                      {warning.level}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <Separator />
            <Button className="w-full" onClick={download}>
              <Download className="size-4" />
              Download File
            </Button>
          </>
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>
                Set an image and parameters on the left, then click Generate Embroidery Data.
                Results will appear here.
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">No Server Upload</Badge>
              <Badge variant="outline">Fully Local</Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function exportEngineLabel(format: EmbroideryFormat, status: PyodideWorkerStatus): string {
  if (format === "dst") return "Direct DST";
  if (status.state === "ready") return "Pyodide Ready";
  if (status.state === "warming") return "Pyodide Warming";
  if (status.state === "error") return "Pyodide Error";
  return "Pyodide Idle";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
