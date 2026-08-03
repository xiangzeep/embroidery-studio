# Layer Boundary Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select generated stitch regions directly on the canvas, double-click to edit Bezier boundary anchors, synchronize the Layers panel, and reduce unnecessary fragmented stitch paths for continuous shapes.

**Architecture:** Reuse `EmbroideryCanvas` selection and boundary-edit signals. Let `MainWindow` keep owning project lookup and regeneration. Keep path fragmentation fixes inside stitch path generation/export behavior instead of adding viewer-only hacks.

**Tech Stack:** Python, PySide6 `QGraphicsView`, Shapely polygons, existing unittest suite.

## Global Constraints

- Do not add a second boundary editor; reuse existing `start_boundary_edit`.
- Do not refresh all layers when one region changes.
- Do not commit `.idea/` or `.venv-codex/`.
- Every behavior change must have a failing test first.

---

### Task 1: Canvas Double-Click Boundary Editing

**Files:**
- Modify: `stitch_studio/ui/canvas.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `EmbroideryCanvas.boundary_edit_requested: Signal(str)`
- Produces: `EmbroideryCanvas.mouseDoubleClickEvent(event)` emits the region UID for a double-clicked `StitchObjectItem`.

- [ ] **Step 1: Write the failing test**

```python
def test_canvas_double_click_region_requests_boundary_edit(self):
    qt_core = importlib.import_module("PySide6.QtCore")
    qt_gui = importlib.import_module("PySide6.QtGui")
    qt_widgets = importlib.import_module("PySide6.QtWidgets")
    canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

    app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
    canvas = canvas_mod.EmbroideryCanvas()
    requested = []
    canvas.boundary_edit_requested.connect(requested.append)
    canvas.set_layer_stitches("layer-1", [{
        "uid": "region-1",
        "points": [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0)],
        "paths": [[(0.0, 0.0), (20.0, 0.0), (20.0, 20.0)]],
        "color": (10, 20, 30),
    }])
    canvas.fit_to_content()
    scene_pos = canvas._object_items["region-1"].sceneBoundingRect().center()
    view_pos = canvas.mapFromScene(scene_pos)
    event = qt_gui.QMouseEvent(
        qt_core.QEvent.MouseButtonDblClick,
        qt_core.QPointF(view_pos),
        qt_core.Qt.LeftButton,
        qt_core.Qt.LeftButton,
        qt_core.Qt.NoModifier,
    )

    canvas.mouseDoubleClickEvent(event)
    app.processEvents()

    self.assertEqual(requested, ["region-1"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `QT_QPA_PLATFORM=offscreen .venv-codex/bin/python -m unittest tests.test_export_paths.ExportPathTests.test_canvas_double_click_region_requests_boundary_edit`
Expected: FAIL because no double-click handler emits the signal.

- [ ] **Step 3: Implement minimal code**

Add `mouseDoubleClickEvent` to `EmbroideryCanvas`; hit-test interactive items, select the region item, and emit `boundary_edit_requested`.

- [ ] **Step 4: Verify**

Run the target test and full suite.

### Task 2: Layers Panel Scroll/Expand Synchronization

**Files:**
- Modify: `stitch_studio/ui/panels.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `LayerPanel.select_uid(uid: str)`
- Produces: parent layer expands and the selected item becomes current/visible.

- [ ] **Step 1: Write the failing test**

```python
def test_layer_panel_select_uid_expands_parent_and_scrolls_to_region(self):
    qt_widgets = importlib.import_module("PySide6.QtWidgets")
    project_mod = importlib.import_module("stitch_studio.core.project")
    panels_mod = importlib.import_module("stitch_studio.ui.panels")

    app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
    panel = panels_mod.LayerPanel()
    project = project_mod.Project()
    layer = project_mod.Layer(name="Layer A")
    region = project_mod.Region(name="Region A")
    layer.regions = [region]
    project.layers = [layer]
    panel.set_project(project)
    top = panel.layer_tree.topLevelItem(0)
    top.setExpanded(False)

    panel.select_uid(region.uid)
    app.processEvents()

    self.assertTrue(top.isExpanded())
    self.assertEqual(panel.layer_tree.currentItem().data(0, qt_core.Qt.UserRole), region.uid)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `QT_QPA_PLATFORM=offscreen .venv-codex/bin/python -m unittest tests.test_export_paths.ExportPathTests.test_layer_panel_select_uid_expands_parent_and_scrolls_to_region`
Expected: FAIL if parent is not expanded or item is not made visible.

- [ ] **Step 3: Implement minimal code**

Update `select_uid` to expand the matched item's parent chain and call `scrollToItem`.

- [ ] **Step 4: Verify**

Run target test and full suite.

### Task 3: Reduce Continuous Fill Fragmentation

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: generated `Region.stitch_paths`
- Produces: continuous polygon fill paths avoid unnecessary isolated one-line fragments; true disconnected components remain separate paths.

- [ ] **Step 1: Write a failing regression test**

Add a small polygon/mask fixture that currently returns fragmented paths for one continuous shape. Assert that tiny adjacent fragments are merged or eliminated while path count for disconnected islands stays greater than one.

- [ ] **Step 2: Run test to verify it fails**

Run the new target test.

- [ ] **Step 3: Implement minimal merge**

Add a post-processing helper that joins adjacent scanline fragments when endpoints are within one row spacing and belong to the same polygon component.

- [ ] **Step 4: Verify**

Run target test and full suite.
