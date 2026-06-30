"use client";

// sewing-order-panel.tsx — Phase 5 PR22 縫い順編集パネル。
//
// design.objects を order 昇順でリスト表示し、@dnd-kit/sortable で縦並び替え。
// 並び替え結果は design-store の reorderObjects 経由で order を 0..n-1 で再採番。
// 各行に lock / visibility / delete 操作、ヘッダに「自動最適化」(applyOptimizeOrder)
// と travel/jump 可視化トグルを置く。
//
// 純ロジック (DnD → id 配列変換) は sewing-order-helpers.ts に切り出して store
// 経由でテスト。本コンポーネントは UI バインドのみ。

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Lock, LockOpen, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useDesignStore } from "./design-store";
import { sortByOrder } from "./sewing-order-helpers";
import type { EmbroideryObject } from "@/lib/pipeline/types";

const KIND_BADGE: Record<EmbroideryObject["kind"], string> = {
  run: "R",
  satin: "S",
  fill: "F",
};

type Props = {
  /** travel/jump 可視化トグル (購読は別 PR で配線) */
  showTravel: boolean;
  onShowTravelChange: (next: boolean) => void;
};

export function SewingOrderPanel({ showTravel, onShowTravelChange }: Props) {
  const design = useDesignStore((s) => s.design);
  const reorderObjects = useDesignStore((s) => s.reorderObjects);
  const updateObject = useDesignStore((s) => s.updateObject);
  const removeObject = useDesignStore((s) => s.removeObject);
  const applyOptimizeOrder = useDesignStore((s) => s.applyOptimizeOrder);

  const sorted = design ? sortByOrder(design.objects) : [];
  const ids = sorted.map((o) => o.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    reorderObjects(arrayMove(ids, oldIdx, newIdx));
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">縫い順</CardTitle>
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={applyOptimizeOrder}
            disabled={!design || sorted.length < 2}
          >
            <Wand2 className="mr-1 size-3.5" />
            自動最適化
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showTravel}
              onChange={(e) => onShowTravelChange(e.target.checked)}
            />
            travel/jump 可視化
          </label>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0
          ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">
              オブジェクトがありません。
            </p>
          )
          : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="divide-y">
                  {sorted.map((obj) => (
                    <SortableRow
                      key={obj.id}
                      object={obj}
                      onToggleLocked={(locked) =>
                        updateObject(obj.id, { locked })}
                      onToggleVisible={(visible) =>
                        updateObject(obj.id, { visible })}
                      onDelete={() => removeObject(obj.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
      </CardContent>
    </Card>
  );
}

function SortableRow({
  object,
  onToggleLocked,
  onToggleVisible,
  onDelete,
}: {
  object: EmbroideryObject;
  onToggleLocked: (locked: boolean) => void;
  onToggleVisible: (visible: boolean) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: object.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isLocked = object.locked === true;
  const isVisible = object.visible !== false;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2 text-sm"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground"
        {...attributes}
        {...listeners}
        aria-label="ドラッグハンドル"
      >
        <GripVertical className="size-4" />
      </button>
      <span
        className="size-3.5 shrink-0 rounded-sm border"
        style={{ backgroundColor: rgbToCss(object.rgb) }}
      />
      <span className="inline-flex w-5 justify-center rounded bg-muted px-1 text-[10px] font-bold tabular-nums">
        {KIND_BADGE[object.kind]}
      </span>
      <Label className="flex-1 truncate text-xs">
        #{object.order} / {object.id}
      </Label>
      <IconBtn
        title={isLocked ? "lock 解除" : "lock"}
        onClick={() => onToggleLocked(!isLocked)}
      >
        {isLocked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
      </IconBtn>
      <IconBtn
        title={isVisible ? "非表示" : "表示"}
        onClick={() => onToggleVisible(!isVisible)}
      >
        {isVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </IconBtn>
      <IconBtn title="削除" onClick={onDelete} destructive>
        <Trash2 className="size-3.5" />
      </IconBtn>
    </li>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded p-1 hover:bg-muted ${
        destructive ? "text-red-600 hover:bg-red-50" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function rgbToCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
