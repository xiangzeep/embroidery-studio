"use client";

// object-inspector.tsx — Phase 5 PR21 選択中 object のプロパティ編集 UI。
//
// design-store の selectedObjectId が指す EmbroideryObject に対し、kind /
// angleDeg / densityMm / pullCompMm / underlay.kind を編集する。変更は
// updateObject(id, patch) 経由で store に反映する。未選択時はプレースホルダ。
//
// 本 PR では Sewing Order との結線 / レイアウト統合は対象外。
// 純ロジック (patch ビルダ) は applyKindChange / applyPropsChange に切り出して
// store 経由のテストで挙動を担保する。

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
  applyUnderlayKindChange,
} from "./object-inspector-bindings";
import type {
  EmbroideryObject,
  ObjectKind,
  UnderlayConfig,
} from "@/lib/pipeline/types";

const KIND_OPTIONS: { value: ObjectKind; label: string }[] = [
  { value: "run", label: "run (細線)" },
  { value: "satin", label: "satin (帯)" },
  { value: "fill", label: "fill (塗り)" },
];

const UNDERLAY_OPTIONS: { value: UnderlayConfig["kind"]; label: string }[] = [
  { value: "none", label: "なし" },
  { value: "edge-run", label: "edge-run" },
  { value: "center-run", label: "center-run" },
  { value: "zigzag", label: "zigzag" },
  { value: "fill", label: "fill" },
];

export function ObjectInspector() {
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
          <CardTitle className="text-base">オブジェクト</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            プレビュー上でオブジェクトをクリックして選択してください。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          オブジェクト ({object.id})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <KindRow object={object} onChange={(kind) =>
          updateObject(object.id, applyKindChange(kind))} />

        <SliderRow
          label="角度"
          value={object.props.angleDeg ?? 0}
          min={0}
          max={180}
          step={1}
          suffix="°"
          onChange={(angleDeg) =>
            updateObject(object.id, applyPropsChange(object, { angleDeg }))}
        />

        <SliderRow
          label="密度"
          value={object.props.densityMm}
          min={0.2}
          max={2.0}
          step={0.1}
          suffix="mm"
          onChange={(densityMm) =>
            updateObject(object.id, applyPropsChange(object, { densityMm }))}
        />

        <SliderRow
          label="Pull 補正"
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

function KindRow({
  object,
  onChange,
}: {
  object: EmbroideryObject;
  onChange: (kind: ObjectKind) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>種別</Label>
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
      <Label>下縫い (underlay)</Label>
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
