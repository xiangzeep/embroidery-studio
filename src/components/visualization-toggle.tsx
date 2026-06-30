"use client";

// English note.
//
// English note.
// English note.
// English note.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDesignStore } from "./design-store";

export function VisualizationToggle() {
  const visualization = useDesignStore((s) => s.visualization);
  const setVisualization = useDesignStore((s) => s.setVisualization);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visualization</CardTitle>
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
        <ToggleRow
          label="stitch types"
          checked={visualization.showStitchTypes}
          onChange={(v) => setVisualization({ showStitchTypes: v })}
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
