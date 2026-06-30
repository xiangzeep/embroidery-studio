"use client";

// English note.
//
// English note.
// English note.
// English note.
//
// English note.
// English note.
// English note.

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
import { useDesignStore } from "./design-store";
import {
  applyKindChange,
  applyPropsChange,
  applyStrokeOverrideChange,
  applyUnderlayKindChange,
} from "./object-inspector-bindings";
import type { ConversionConfig } from "@/lib/pipeline/config";
import type {
  EmbroideryObject,
  ObjectKind,
  StrokeOverride,
  UnderlayConfig,
} from "@/lib/pipeline/types";

const KIND_OPTIONS: { value: ObjectKind; label: string }[] = [
  { value: "run", label: "run (thin line)" },
  { value: "satin", label: "satin (band)" },
  { value: "fill", label: "fill (area)" },
];

const UNDERLAY_OPTIONS: { value: UnderlayConfig["kind"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "edge-run", label: "edge-run" },
  { value: "center-run", label: "center-run" },
  { value: "zigzag", label: "zigzag" },
  { value: "fill", label: "fill" },
];

const STROKE_OVERRIDE_OPTIONS: { value: StrokeOverride; label: string }[] = [
  { value: "use-global", label: "Use Global" },
  { value: "force-run", label: "Force Run" },
  { value: "force-satin", label: "Force Satin" },
  { value: "force-fill", label: "Force Fill" },
];

export function ObjectInspector({ config }: { config: ConversionConfig }) {
  const selectedObjectId = useDesignStore((s) => s.selectedObjectId);
  const object = useDesignStore((s) =>
    s.selectedObjectId && s.design
      ? s.design.objects.find((o) => o.id === s.selectedObjectId) ?? null
      : null
  );
  const updateObject = useDesignStore((s) => s.updateObject);

  if (!object || !selectedObjectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Object</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Click an object in the preview to select it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Object ({object.id})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <KindRow object={object} onChange={(kind) =>
          updateObject(object.id, applyKindChange(kind))} />

        {object.strokeRole && object.strokeRole !== "area" ? (
          <StrokeOverrideRow
            value={object.strokeOverride ?? "use-global"}
            onChange={(strokeOverride) =>
              updateObject(object.id, applyStrokeOverrideChange(object, strokeOverride, config))}
          />
        ) : null}

        <SliderRow
          label="Angle"
          value={object.props.angleDeg ?? 0}
          min={0}
          max={180}
          step={1}
          suffix="°"
          onChange={(angleDeg) =>
            updateObject(object.id, applyPropsChange(object, { angleDeg }))}
        />

        <SliderRow
          label="Density"
          value={object.props.densityMm}
          min={0.2}
          max={2.0}
          step={0.1}
          suffix="mm"
          onChange={(densityMm) =>
            updateObject(object.id, applyPropsChange(object, { densityMm }))}
        />

        <SliderRow
          label="Pull Compensation"
          value={object.props.pullCompMm ?? 0}
          min={0}
          max={1.0}
          step={0.05}
          suffix="mm"
          onChange={(pullCompMm) =>
            updateObject(object.id, applyPropsChange(object, { pullCompMm }))}
        />

        <UnderlayRow
          value={object.props.underlay?.kind ?? "none"}
          onChange={(kind) =>
            updateObject(object.id, applyUnderlayKindChange(object, kind))}
        />
      </CardContent>
    </Card>
  );
}

function StrokeOverrideRow({
  value,
  onChange,
}: {
  value: StrokeOverride;
  onChange: (value: StrokeOverride) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Stroke Override</Label>
      <Select value={value} onValueChange={(v) => onChange(v as StrokeOverride)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {STROKE_OVERRIDE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function KindRow({
  object,
  onChange,
}: {
  object: EmbroideryObject;
  onChange: (kind: ObjectKind) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Type</Label>
      <Select value={object.kind} onValueChange={(v) => onChange(v as ObjectKind)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {KIND_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.toFixed(step < 1 ? 2 : 0)}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          if (typeof next === "number" && !Number.isNaN(next)) onChange(next);
        }}
      />
    </div>
  );
}

function UnderlayRow({
  value,
  onChange,
}: {
  value: UnderlayConfig["kind"];
  onChange: (kind: UnderlayConfig["kind"]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Underlay</Label>
      <Select value={value} onValueChange={(v) =>
        onChange(v as UnderlayConfig["kind"])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {UNDERLAY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
