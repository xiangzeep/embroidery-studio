"use client";

// preview-canvas-editable.tsx — Phase 5 PR20 + PR23。
//
// 既存 StitchCanvas を内部利用しつつ、上層に以下のオーバーレイを重ねる:
//   - select mode (PR20): クリックヒットテスト → designStore.selectedObjectId
//                          選択中 object の outer をハイライト描画
//   - node   mode (PR23): SVG で頂点ハンドル + 辺中点ハンドルを描画
//                          ドラッグで頂点移動、辺中点クリックで頂点挿入、
//                          Delete キーで選択中頂点を削除
//
// 座標系は mm 単位 (shape.outer も mm)。SVG viewBox で mm→px 変換を任せる。

import { useEffect, useMemo, useRef, useState } from "react";
import { StitchCanvas } from "./stitch-preview";
import { hitTestObject } from "./hit-test";
import { useDesignStore } from "./design-store";
import {
  insertVertexAt,
  moveVertexTo,
  pickEdgeMidpoint,
  pickVertex,
  removeVertexAt,
} from "./node-hit-test";
import type {
  EmbroideryDesign,
  Point2D,
  Polygon,
  StitchPattern,
} from "@/lib/pipeline/types";

type Props = {
  pattern: StitchPattern;
  design: EmbroideryDesign | null;
};

const VERTEX_HIT_PX = 8; // SVG ピクセル単位のヒット半径

export function PreviewCanvasEditable({ pattern, design }: Props) {
  const selectedObjectId = useDesignStore((s) => s.selectedObjectId);
  const setSelectedObjectId = useDesignStore((s) => s.setSelectedObjectId);
  const editMode = useDesignStore((s) => s.editMode);
  const updateObject = useDesignStore((s) => s.updateObject);

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(
    null,
  );
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // 選択中 object / mode 切替で頂点選択をリセット (React 公式 "resetting state on
  // prop change" パターン: render 中の条件分岐で setState を呼ぶことで cascading
  // render を避ける)。
  const [prevKey, setPrevKey] = useState<string>(
    `${editMode}|${selectedObjectId ?? "_"}`,
  );
  const key = `${editMode}|${selectedObjectId ?? "_"}`;
  if (prevKey !== key) {
    setPrevKey(key);
    setSelectedVertexIdx(null);
    setDraggingIdx(null);
  }

  const scale = useMemo(
    () => Math.min(480 / pattern.widthMm, 480 / pattern.heightMm),
    [pattern.widthMm, pattern.heightMm],
  );
  const w = Math.max(1, Math.round(pattern.widthMm * scale));
  const h = Math.max(1, Math.round(pattern.heightMm * scale));

  const selectedObject =
    design && selectedObjectId
      ? design.objects.find((o) => o.id === selectedObjectId) ?? null
      : null;

  // canvas overlay (select mode のハイライト)
  useEffect(() => {
    const canvas = overlayRef.current;
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

    if (editMode !== "select" || !selectedObject) return;
    drawOutline(ctx, selectedObject.shape.outer, scale);
  }, [pattern, w, h, scale, selectedObject, editMode]);

  // Delete キーで選択中頂点を削除 (node mode のみ)
  useEffect(() => {
    if (editMode !== "node") return;
    if (selectedVertexIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedObject) return;
      const removed = removeVertexAt(selectedObject.shape.outer, selectedVertexIdx);
      if (removed === null) return; // 3 頂点未満は削除拒否
      e.preventDefault();
      updateObject(selectedObject.id, {
        shape: { ...selectedObject.shape, outer: removed },
      });
      setSelectedVertexIdx(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, selectedVertexIdx, selectedObject, updateObject]);

  const eventToMm = (e: { clientX: number; clientY: number }): Point2D | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    return [xPx / scale, yPx / scale];
  };

  const handleSelectClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editMode !== "select" || !design) return;
    const pt = eventToMm(e);
    if (!pt) return;
    const id = hitTestObject(design, pt);
    setSelectedObjectId(id);
  };

  const handleNodeMouseDown = (e: React.MouseEvent) => {
    if (editMode !== "node" || !selectedObject) return;
    const pt = eventToMm(e);
    if (!pt) return;
    const hitRadiusMm = VERTEX_HIT_PX / scale;
    const vIdx = pickVertex(selectedObject.shape.outer, pt, hitRadiusMm);
    if (vIdx !== null) {
      setSelectedVertexIdx(vIdx);
      setDraggingIdx(vIdx);
      return;
    }
    const eIdx = pickEdgeMidpoint(selectedObject.shape.outer, pt, hitRadiusMm);
    if (eIdx !== null) {
      const inserted = insertVertexAt(selectedObject.shape.outer, eIdx);
      updateObject(selectedObject.id, {
        shape: { ...selectedObject.shape, outer: inserted },
      });
      setSelectedVertexIdx(eIdx + 1);
      setDraggingIdx(eIdx + 1);
    }
  };

  const handleNodeMouseMove = (e: React.MouseEvent) => {
    if (editMode !== "node" || draggingIdx === null || !selectedObject) return;
    const pt = eventToMm(e);
    if (!pt) return;
    const moved = moveVertexTo(selectedObject.shape.outer, draggingIdx, pt);
    updateObject(selectedObject.id, {
      shape: { ...selectedObject.shape, outer: moved },
    });
  };

  const handleNodeMouseUp = () => {
    setDraggingIdx(null);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleSelectClick}
      className={`relative ${
        editMode === "select" ? "cursor-crosshair" : "cursor-default"
      }`}
      style={{ width: w, height: h }}
    >
      <StitchCanvas pattern={pattern} />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute left-0 top-0"
      />
      {editMode === "node" && selectedObject && (
        <svg
          ref={svgRef}
          className="absolute left-0 top-0"
          width={w}
          height={h}
          viewBox={`0 0 ${pattern.widthMm} ${pattern.heightMm}`}
          onMouseDown={handleNodeMouseDown}
          onMouseMove={handleNodeMouseMove}
          onMouseUp={handleNodeMouseUp}
          onMouseLeave={handleNodeMouseUp}
        >
          {/* 辺中点ハンドル (小さい四角) */}
          {edgeMidpoints(selectedObject.shape.outer).map((m, i) => (
            <rect
              key={`edge-${i}`}
              data-testid={`edge-handle-${i}`}
              x={m[0] - 1.5 / scale}
              y={m[1] - 1.5 / scale}
              width={3 / scale}
              height={3 / scale}
              fill="rgba(56,189,248,0.45)"
              stroke="rgba(56,189,248,0.9)"
              strokeWidth={0.5 / scale}
            />
          ))}
          {/* 頂点ハンドル (円) */}
          {selectedObject.shape.outer.map((p, i) => (
            <circle
              key={`vertex-${i}`}
              data-testid={`vertex-handle-${i}`}
              cx={p[0]}
              cy={p[1]}
              r={(i === selectedVertexIdx ? 4 : 3) / scale}
              fill={i === selectedVertexIdx ? "rgba(56,189,248,0.95)" : "white"}
              stroke="rgba(56,189,248,0.95)"
              strokeWidth={1 / scale}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  outer: Polygon,
  scale: number,
) {
  if (outer.length === 0) return;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
  ctx.lineWidth = 1.5 / scale;
  ctx.beginPath();
  ctx.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) {
    ctx.lineTo(outer[i][0], outer[i][1]);
  }
  ctx.closePath();
  ctx.stroke();
}

function edgeMidpoints(outer: Polygon): Point2D[] {
  if (outer.length < 2) return [];
  const out: Point2D[] = [];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}
