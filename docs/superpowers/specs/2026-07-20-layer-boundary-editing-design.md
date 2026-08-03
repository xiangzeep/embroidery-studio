# Layer Boundary Editing Design

## Goal

Make generated embroidery regions editable directly from the canvas: selecting or double-clicking a stitch region must update the right-hand layer tree, expose mouse handles, and allow shape correction through Bezier anchor editing followed by local stitch regeneration.

## Scope

- Canvas click selection must work without first selecting a row in the Layers panel.
- Canvas selection must synchronize the Layers panel to the exact selected layer or region.
- Double-clicking a single region on the canvas must start Bezier boundary editing for that region.
- Anchor and control-handle edits must update the region polygon and regenerate only the affected region/layer.
- Stitch generation must avoid unnecessary multi-path fragmentation for one continuous filled polygon, while still preserving genuinely disconnected components as separate paths.

## Architecture

The existing `EmbroideryCanvas` remains the interaction surface. `StitchObjectItem` continues to represent generated stitch regions, and `MainWindow` remains responsible for mapping selected UIDs to project layers/regions and regenerating stitches. The implementation reuses the existing boundary editor instead of creating a second editing system.

The Layers panel already exposes `select_uid`, so canvas-to-panel synchronization will use the existing `object_selected -> _on_canvas_object_selected -> layer_panel.select_uid` path. Any missing tree expansion/scrolling behavior belongs in `LayerPanel.select_uid`.

For double-click editing, `EmbroideryCanvas.mouseDoubleClickEvent` will hit-test the item under the cursor, select it, and emit `boundary_edit_requested` when the hit is a single region item. This keeps the same edit command as the context-menu entry.

For multi-path fragmentation, the generator/export path contract remains: separate paths mean separate jumps. The fix should occur before export, by merging adjacent scanline/tatami fill rows when they belong to one continuous polygon and only splitting paths where there is a real gap or disconnected component.

## Testing

- Canvas double-click on a `StitchObjectItem` emits `boundary_edit_requested` for that region.
- Canvas selection emits the exact region UID, and `MainWindow._on_canvas_object_selected` calls `LayerPanel.select_uid`.
- `LayerPanel.select_uid` expands parent layers and scrolls to the selected region.
- Continuous fill regions should not be exported as unnecessary fragmented paths.
- Existing tests must continue to pass with `QT_QPA_PLATFORM=offscreen .venv-codex/bin/python -m unittest discover -s tests`.
