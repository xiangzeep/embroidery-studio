"use client";

// visualization-toggle.tsx — Phase 5 PR24 travel/jump/trim 可視化トグル。
//
// design-store の visualization (showTravel/showJump/showTrim) を編集する。
// プレビュー側 (PreviewCanvasEditable) は本 store flag を購読して描画分岐
// (実 canvas での描画は本 PR スコープ外、follow-up での integration が想定)。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDesignStore } from "./design-store";

export function VisualizationToggle() {
  const visualization = useDesignStore((s) => s.visualization);
  const setVisualization = useDesignStore((s) => s.setVisualization);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">可視化</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ToggleRow
          label="travel run"
          checked={visualization.showTravel}
          onChange={(v) => setVisualization({ showTravel: v })}
        />
        <ToggleRow
          label="jump"
          checked={visualization.showJump}
          onChange={(v) => setVisualization({ showJump: v })}
        />
        <ToggleRow
          label="trim"
          checked={visualization.showTrim}
          onChange={(v) => setVisualization({ showTrim: v })}
        />
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
