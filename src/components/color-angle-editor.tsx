"use client";

import { RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { StitchBlock } from "@/lib/pipeline/types";

type Props = {
  blocks: StitchBlock[];
  defaultAngleDeg: number;
  value: Record<number, number>;
  disabled: boolean;
  onChange: (next: Record<number, number>) => void;
  onApply: () => void;
};

export function ColorAngleEditor({
  blocks,
  defaultAngleDeg,
  value,
  disabled,
  onChange,
  onApply,
}: Props) {
  const setAngle = (colorIndex: number, angle: number) => {
    onChange({ ...value, [colorIndex]: angle });
  };
  const resetAngle = (colorIndex: number) => {
    const next = { ...value };
    delete next[colorIndex];
    onChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">色ごとの縫う向き</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {blocks.map((block) => {
          const overridden = value[block.colorIndex] !== undefined;
          const angle = overridden ? value[block.colorIndex] : defaultAngleDeg;
          return (
            <div key={block.colorIndex} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="size-4 shrink-0 rounded-sm border"
                    style={{ backgroundColor: rgbToCss(block.rgb) }}
                  />
                  <Label className="truncate">色 {block.colorIndex + 1}</Label>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {angle}°
                    {!overridden && (
                      <span className="ml-1 text-[10px]">(全体)</span>
                    )}
                  </span>
                  {overridden && (
                    <button
                      type="button"
                      onClick={() => resetAngle(block.colorIndex)}
                      disabled={disabled}
                      title="全体の向きに戻す"
                      className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  )}
                </div>
              </div>
              <Slider
                value={[angle]}
                min={0}
                max={179}
                step={1}
                disabled={disabled}
                onValueChange={(v) => {
                  const next = typeof v === "number" ? v : v[0];
                  if (typeof next === "number") setAngle(block.colorIndex, next);
                }}
              />
            </div>
          );
        })}

        <Button className="w-full" onClick={onApply} disabled={disabled}>
          <Wand2 className="size-4" />
          向きを反映
        </Button>
      </CardContent>
    </Card>
  );
}

function rgbToCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
