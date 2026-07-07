"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import type { FillStrategy } from "@/lib/pipeline/render";
import {
  QUALITY_PRESETS,
  applyFabricDefaults,
  applyQualityPreset,
  type ConversionConfig,
  type DigitizingMode,
  type EmbroideryFormat,
  type OutlineFontStrategy,
  type QualityPreset,
} from "@/lib/pipeline/config";
import type { FabricKind } from "@/lib/pipeline/types";

type Props = {
  value: ConversionConfig;
  onChange: (v: ConversionConfig) => void;
  disabled: boolean;
  onConvert: () => void;
};

const FORMATS: { value: EmbroideryFormat; label: string }[] = [
  { value: "dst", label: "DST (Tajima)" },
  { value: "pes", label: "PES (Brother)" },
  { value: "jef", label: "JEF (Janome)" },
  { value: "exp", label: "EXP (Melco)" },
  { value: "vp3", label: "VP3 (Husqvarna)" },
];

const FABRICS: { value: FabricKind; label: string }[] = [
  { value: "denim", label: "Denim" },
  { value: "twill", label: "Twill" },
  { value: "canvas", label: "Canvas" },
  { value: "knit-light", label: "Knit (Light)" },
  { value: "knit-heavy", label: "Knit (Heavy)" },
  { value: "terry", label: "Terry Cloth" },
  { value: "fleece", label: "Fleece" },
  { value: "leather", label: "Leather" },
  { value: "silk", label: "Silk" },
  { value: "felt", label: "Felt" },
];

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "high", label: "High" },
  { value: "detail", label: "Detail" },
];

const DIGITIZING_MODES: { value: DigitizingMode; label: string; hint: string }[] = [
  {
    value: "line-art",
    label: "Line Art",
    hint: "Fine outlines prefer plain run stitches.",
  },
  {
    value: "photo-stitch",
    label: "Photo Stitch",
    hint: "Allows denser decorative stitch treatment.",
  },
];

const OUTLINE_FONT_STRATEGIES: {
  value: OutlineFontStrategy;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "Run for contours, satin for decorative bands.",
  },
  {
    value: "prefer-run",
    label: "Prefer Run",
    hint: "Push outlines and text-like strokes toward run.",
  },
  {
    value: "prefer-satin",
    label: "Prefer Satin",
    hint: "Allow clear decorative bands to stay satin.",
  },
];

const STRATEGIES: { value: FillStrategy; label: string }[] = [
  { value: "global-angle", label: "Use Global Angle" },
  { value: "shape-long-axis", label: "Follow Shape Long Axis" },
  { value: "shape-cross-axis", label: "Perpendicular to Shape Long Axis" },
];

export function ConversionSettings({
  value,
  onChange,
  disabled,
  onConvert,
}: Props) {
  const update = <K extends keyof ConversionConfig>(
    key: K,
    v: ConversionConfig[K],
  ) => onChange({ ...value, [key]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">2. Adjust Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Fabric</Label>
          <Select
            value={value.fabric}
            onValueChange={(v) =>
              onChange(applyFabricDefaults(value, v as FabricKind))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FABRICS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>


        <div className="space-y-2">
          <Label>Quality</Label>
          <Select
            value={value.qualityPreset}
            onValueChange={(v) =>
              onChange(applyQualityPreset(value, v as QualityPreset))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUALITY_OPTIONS.map((option) => {
                const preset = QUALITY_PRESETS[option.value];
                return (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} · {preset.maxDimension}px · {preset.maxColorCount} colors
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Output Format</Label>
          <Select
            value={value.format}
            onValueChange={(v) => update("format", v as EmbroideryFormat)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Digitizing Mode</Label>
          <Select
            value={value.digitizingMode}
            onValueChange={(v) => update("digitizingMode", v as DigitizingMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIGITIZING_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label} · {mode.hint}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Outline / Font Strategy</Label>
          <Select
            value={value.outlineFontStrategy}
            onValueChange={(v) =>
              update("outlineFontStrategy", v as OutlineFontStrategy)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTLINE_FONT_STRATEGIES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label} · {option.hint}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <SliderField
          label="Width"
          unit="mm"
          value={value.widthMm}
          min={20}
          max={300}
          step={1}
          onChange={(v) => update("widthMm", v)}
        />
        <SliderField
          label="Scale"
          unit="%"
          value={value.outputScalePercent ?? 100}
          min={25}
          max={200}
          step={1}
          onChange={(v) => update("outputScalePercent", v)}
        />
        <SliderField
          label="Color Count"
          unit=""
          value={value.colorCount}
          min={1}
          max={QUALITY_PRESETS[value.qualityPreset].maxColorCount}
          step={1}
          onChange={(v) => update("colorCount", v)}
        />
        <SliderField
          label="Stitch Density"
          unit="mm"
          value={value.stitchDensity}
          min={0.2}
          max={1.0}
          step={0.05}
          onChange={(v) =>
            onChange({
              ...value,
              stitchDensity: v,
              overrides: { ...value.overrides, stitchDensity: true },
            })
          }
        />
        <SliderField
          label="Stitch Direction (Global)"
          unit="mm"
          value={value.satinMaxWidthMm}
          min={1}
          max={12}
          step={0.5}
          onChange={(v) => update("satinMaxWidthMm", v)}
        />
        <div className="space-y-2">
          <Label>Direction Strategy</Label>
          <Select
            value={value.fillStrategy}
            onValueChange={(v) => update("fillStrategy", v as FillStrategy)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SliderField
          label="Stitch Direction (Global)"
          unit="°"
          value={value.fillAngleDeg}
          min={0}
          max={179}
          step={1}
          onChange={(v) => update("fillAngleDeg", v)}
        />
        <SliderField
          label="Color Smoothing"
          unit=""
          value={value.smoothing}
          min={0}
          max={4}
          step={1}
          onChange={(v) => update("smoothing", v)}
        />
        <SliderField
          label="Boundary Overlap"
          unit="px"
          value={value.boundaryDilatePx}
          min={0}
          max={3}
          step={1}
          onChange={(v) => update("boundaryDilatePx", v)}
        />
        <SliderField
          label="Min Region Area"
          unit="px²"
          value={value.minRegionAreaPx}
          min={0}
          max={120}
          step={1}
          onChange={(v) => update("minRegionAreaPx", v)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.removeWhiteBackground}
            onChange={(event) =>
              update("removeWhiteBackground", event.target.checked)
            }
          />
          Remove White Background
        </label>

        <Button
          className="w-full"
          onClick={onConvert}
          disabled={disabled}
        >
          {disabled ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Processing
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Generate Embroidery Data
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => {
          const next = typeof v === "number" ? v : v[0];
          if (typeof next === "number") onChange(next);
        }}
      />
    </div>
  );
}
