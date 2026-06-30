"use client";

// undo-redo-buttons.tsx — Phase 5 PR24 Undo/Redo + JSON Save/Load コントロール。
//
// design-store の history を経由した undo/redo、および
// serializeDesign / deserializeDesign による JSON 入出力を提供する。
// ファイル DL は <a download> 経由、UL は <input type="file"> 経由。

import { Redo2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "./design-store";
import { deserializeDesign, serializeDesign } from "@/lib/design/serialize";
import { canRedo, canUndo } from "@/lib/design/history";

export function UndoRedoButtons() {
  const history = useDesignStore((s) => s.history);
  const design = useDesignStore((s) => s.design);
  const undo = useDesignStore((s) => s.undo);
  const redo = useDesignStore((s) => s.redo);
  const setDesign = useDesignStore((s) => s.setDesign);

  const handleSave = () => {
    if (!design) return;
    const json = serializeDesign(design);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `embroidery-design-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const loaded = deserializeDesign(text);
      setDesign(loaded);
    }).catch((err) => {
      console.error("design load failed:", err);
    });
    e.target.value = ""; // 同じファイル再選択を許可
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!history || !canUndo(history)}
        onClick={undo}
        title="Undo"
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!history || !canRedo(history)}
        onClick={redo}
        title="Redo"
      >
        <Redo2 className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!design}
        onClick={handleSave}
        title="JSON 保存"
      >
        Save
      </Button>
      <label
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded border px-3 text-sm hover:bg-muted"
        title="JSON 読込"
      >
        <Upload className="size-3.5" />
        Load
        <input
          type="file"
          accept="application/json"
          onChange={handleLoad}
          className="hidden"
        />
      </label>
    </div>
  );
}
