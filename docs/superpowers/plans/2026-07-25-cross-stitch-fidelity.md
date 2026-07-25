# Cross-Stitch Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve cross-stitch likeness with directional half-stitch boundary cells and final running/backstitch overlays for protected facial and line details.

**Architecture:** Preserve the existing shared ownership grid, but retain each region's original mask when generating owned cells so boundary occupancy is measurable. Add a focused boundary resolver for partial cells, then append protected semantic detail regions after cross-stitch fills using the adaptive contour engine from the local-corner plan.

**Tech Stack:** Python 3.10+, NumPy, OpenCV, unittest, pyembroidery, existing recognition/layer/export pipeline.

## Global Constraints

- Complete cross stitches remain the base fill.
- Partial boundary cells may use `half` or `half_flipped`.
- Protected thin details may use continuous running/backstitch paths.
- Adjacent fill ownership masks remain non-overlapping.
- Same-thread regions stay grouped under one color layer.
- Background noise is simplified more aggressively than subject detail.
- Color, stitch, jump, and generation-time growth must remain bounded.

---

## File Structure

- Create `stitch_studio/core/cross_stitch_geometry.py`: immutable cell specification and diagonal boundary scoring.
- Create `tests/test_cross_stitch_geometry.py`: boundary orientation tests.
- Modify `stitch_studio/core/project.py`: persist the cross-stitch overlay role.
- Modify `stitch_studio/core/stitch_engine.py`: carry original masks through ownership generation and apply per-cell method overrides.
- Modify `stitch_studio/core/image_engine.py`: build protected cross-stitch detail overlay regions without subtracting base fill ownership.
- Modify `stitch_studio/ui/main_window.py`: generate mixed cross-fill and run-overlay work items in one background worker.
- Modify `stitch_studio/core/export_engine.py`: preserve fill-before-overlay order inside a shared thread group.
- Modify `tests/test_export_paths.py`: ownership, worker, path order, stitch-count, jump-count, and export round-trip regression tests.
- Modify `tests/test_recognition_engine.py`: cross-stitch semantic detail retention tests.

### Task 1: Resolve Directional Half-Stitch Boundary Geometry

**Files:**
- Create: `stitch_studio/core/cross_stitch_geometry.py`
- Create: `tests/test_cross_stitch_geometry.py`

**Interfaces:**
- Produces: `CrossStitchCell(bounds, coverage, method_override)`.
- Produces: `choose_boundary_half_method(cell_mask) -> str`.
- Produces: `classify_cross_stitch_cell(cell_mask, coverage_threshold, full_threshold=0.82) -> Optional[str]`.

- [ ] **Step 1: Write failing boundary-orientation tests**

```python
import unittest
import numpy as np

from stitch_studio.core.cross_stitch_geometry import (
    choose_boundary_half_method,
    classify_cross_stitch_cell,
)


class CrossStitchBoundaryGeometryTests(unittest.TestCase):
    def test_descending_boundary_selects_normal_half(self):
        mask = np.tri(12, 12, k=0, dtype=np.uint8) * 255
        self.assertEqual(choose_boundary_half_method(mask), "half")

    def test_ascending_boundary_selects_flipped_half(self):
        mask = np.fliplr(np.tri(12, 12, k=0, dtype=np.uint8)) * 255
        self.assertEqual(choose_boundary_half_method(mask), "half_flipped")

    def test_full_cell_keeps_configured_full_method(self):
        mask = np.full((12, 12), 255, dtype=np.uint8)
        self.assertIsNone(classify_cross_stitch_cell(mask, 0.5))

    def test_below_threshold_cell_is_rejected(self):
        mask = np.zeros((12, 12), dtype=np.uint8)
        mask[0, 0] = 255
        self.assertEqual(classify_cross_stitch_cell(mask, 0.5), "reject")
```

- [ ] **Step 2: Run tests and verify import failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_cross_stitch_geometry -v
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement cell classification and diagonal scoring**

Create:

```python
from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class CrossStitchCell:
    bounds: Tuple[float, float, float, float]
    coverage: float
    method_override: Optional[str] = None


def choose_boundary_half_method(cell_mask):
    binary = np.asarray(cell_mask, dtype=np.uint8) > 0
    boundary = cv2.morphologyEx(
        binary.astype(np.uint8),
        cv2.MORPH_GRADIENT,
        np.ones((3, 3), dtype=np.uint8),
    )
    distance = cv2.distanceTransform((boundary == 0).astype(np.uint8), cv2.DIST_L2, 3)
    height, width = binary.shape
    normal = np.rint(np.linspace([0, 0], [height - 1, width - 1], max(height, width))).astype(int)
    flipped = np.rint(np.linspace([0, width - 1], [height - 1, 0], max(height, width))).astype(int)
    normal_score = float(np.mean(distance[normal[:, 0], normal[:, 1]]))
    flipped_score = float(np.mean(distance[flipped[:, 0], flipped[:, 1]]))
    return "half" if normal_score <= flipped_score else "half_flipped"


def classify_cross_stitch_cell(cell_mask, coverage_threshold, full_threshold=0.82):
    binary = np.asarray(cell_mask) > 0
    coverage = float(np.count_nonzero(binary)) / max(1, binary.size)
    if coverage + 1e-9 < coverage_threshold:
        return "reject"
    if coverage >= full_threshold:
        return None
    return choose_boundary_half_method(binary)
```

- [ ] **Step 4: Run geometry tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_cross_stitch_geometry -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add stitch_studio/core/cross_stitch_geometry.py tests/test_cross_stitch_geometry.py
git commit -m "feat: resolve cross stitch boundary diagonals"
```

### Task 2: Preserve Source Occupancy Through Shared Grid Ownership

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py:41-104`
- Modify: `stitch_studio/core/stitch_engine.py:1179-1433`
- Modify: `tests/test_export_paths.py:2067-2311`

**Interfaces:**
- Consumes: `CrossStitchCell`, `classify_cross_stitch_cell`.
- Produces: `_cross_stitch_cell_specs(ownership_mask, source_mask, settings) -> list[CrossStitchCell]`.
- Extends: `_dispatch_fill_paths(..., cross_source_mask=None)`.

- [ ] **Step 1: Write failing owned-boundary tests**

```python
def test_owned_cross_cell_uses_original_mask_for_half_direction(self):
    engine = stitch_mod.StitchEngine(px_per_mm=10.0)
    original = np.zeros((10, 10), dtype=np.uint8)
    original[np.tril_indices(10)] = 255
    ownership = np.full((10, 10), 255, dtype=np.uint8)
    settings = project_mod.StitchSettings(
        fill_mode="cross_stitch",
        cross_method="cross",
        cross_pattern_size_mm=1.0,
        cross_coverage=0.5,
    )
    cells = engine._cross_stitch_cell_specs(ownership, original, settings)
    self.assertEqual(len(cells), 1)
    self.assertEqual(cells[0].method_override, "half")

def test_owned_full_cell_retains_configured_cross_method(self):
    cells = engine._cross_stitch_cell_specs(full, full, settings)
    self.assertIsNone(cells[0].method_override)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_owned_cross_cell_uses_original_mask_for_half_direction \
  tests.test_export_paths.ExportPathTests.test_owned_full_cell_retains_configured_cross_method
```

Expected: FAIL because `_cross_stitch_cell_specs` does not exist.

- [ ] **Step 3: Carry original and ownership masks separately**

In `generate_region_paths()` retain:

```python
original_mask = region.mask
source_mask = mask_override if mask_override is not None else original_mask
```

Extend `_dispatch_fill_paths()` with:

```python
cross_source_mask: Optional[np.ndarray] = None
```

For cross stitch dispatch:

```python
return self._generate_cross_stitch_paths(
    mask,
    settings,
    image,
    source_mask=cross_source_mask,
)
```

The main fill call passes `cross_source_mask=original_mask`; underlay and
non-cross calls omit it.

- [ ] **Step 4: Add `_cross_stitch_cell_specs()` and keep compatibility wrapper**

```python
def _cross_stitch_cell_specs(self, ownership_mask, source_mask, settings):
    specs = []
    for cell, slices in self._iter_cross_grid_cells(ownership_mask, settings):
        ownership_patch = ownership_mask[slices] > 0
        if not np.any(ownership_patch):
            continue
        source_patch = source_mask[slices] if source_mask is not None else ownership_patch
        override = classify_cross_stitch_cell(
            source_patch,
            min(float(settings.cross_coverage), 0.5),
        )
        if override == "reject" and np.count_nonzero(ownership_patch):
            override = None
        coverage = float(np.count_nonzero(source_patch)) / max(1, source_patch.size)
        specs.append(CrossStitchCell(cell, coverage, override))
    return specs

def _cross_stitch_cells(self, mask, settings):
    return [
        spec.bounds
        for spec in self._cross_stitch_cell_specs(mask, mask, settings)
        if spec.method_override != "reject"
    ]
```

Extract existing grid iteration into `_iter_cross_grid_cells()` so ownership
and source slices always use identical rounded boundaries.

- [ ] **Step 5: Apply per-cell method overrides**

In `_generate_cross_stitch_paths()`:

```python
occupancy_mask = source_mask if source_mask is not None else mask
for spec in self._cross_stitch_cell_specs(mask, occupancy_mask, settings):
    cell_method = spec.method_override or method
    paths.extend(
        self._cross_stitch_cell_paths(spec.bounds, cell_method, max_segment_px)
    )
```

Keep the existing boustrophedon row ordering and dense-upright offset pass.

- [ ] **Step 6: Run ownership and template tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cross_stitch_geometry \
  tests.test_export_paths.ExportPathTests.test_owned_cross_cell_uses_original_mask_for_half_direction \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_global_grid_assigns_split_cell_to_one_color \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_global_grid_masks_do_not_overlap_at_fractional_boundaries \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_method_templates_emit_distinct_geometry
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add stitch_studio/core/stitch_engine.py tests/test_export_paths.py
git commit -m "feat: fit cross stitch edges with half stitches"
```

### Task 3: Build Protected Semantic Detail Overlays

**Files:**
- Modify: `stitch_studio/core/project.py:81-209`
- Modify: `stitch_studio/core/image_engine.py:541-691`
- Modify: `tests/test_export_paths.py:667-685`
- Modify: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: `recognition.feature_outline_groups`, `recognition.detail_mask`, and `recognition.subject_mask`.
- Produces: `_append_cross_stitch_detail_overlays(layer_map, recognition) -> None`.
- Produces: serialized run regions with `is_detail_region=True`, `run_corner_mode="adaptive"`, and `is_cross_stitch_overlay=True`.

- [ ] **Step 1: Write failing overlay construction tests**

```python
def test_cross_stitch_builds_fill_and_protected_run_overlay(self):
    layers = ImageEngine.build_layers_from_recognition(
        recognition,
        threads,
        source_image=image,
        generation_mode="cross_stitch",
        quant_settings=settings,
    )
    fills = [
        region for layer in layers for region in layer.regions
        if region.stitch_settings.fill_mode == "cross_stitch"
    ]
    overlays = [
        region for layer in layers for region in layer.regions
        if getattr(region, "is_cross_stitch_overlay", False)
    ]
    self.assertTrue(fills)
    self.assertTrue(overlays)
    self.assertTrue(all(r.stitch_settings.fill_mode == "run" for r in overlays))
    self.assertTrue(all(r.stitch_settings.run_corner_mode == "adaptive" for r in overlays))

def test_cross_stitch_overlay_stays_inside_subject_detail_union(self):
    overlay_union = np.logical_or.reduce([region.mask > 0 for region in overlays])
    protected = recognition.detail_mask & recognition.subject_mask
    self.assertEqual(int(np.count_nonzero(overlay_union & ~protected)), 0)

def test_cross_stitch_overlay_role_round_trips(self):
    region = project_mod.Region(is_cross_stitch_overlay=True)
    restored = project_mod.Region.from_dict(region.to_dict())
    self.assertTrue(restored.is_cross_stitch_overlay)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_recognition_engine.DetailRecognitionTests.test_cross_stitch_builds_fill_and_protected_run_overlay \
  tests.test_recognition_engine.DetailRecognitionTests.test_cross_stitch_overlay_stays_inside_subject_detail_union
```

Expected: FAIL because cross-stitch mode currently skips semantic feature
reconstruction and `Region` does not serialize an overlay role.

- [ ] **Step 3: Add the persistent overlay role**

Add to `Region`:

```python
is_cross_stitch_overlay: bool = False
```

Include `"is_cross_stitch_overlay"` in `Region.to_dict()` and restore it in
`Region.from_dict()` with a default of `False`.

- [ ] **Step 4: Implement overlay extraction**

Add:

```python
@staticmethod
def _append_cross_stitch_detail_overlays(layer_map, recognition):
    subject = np.asarray(recognition.subject_mask, dtype=bool)
    detail = np.asarray(recognition.detail_mask, dtype=bool) & subject
    feature_groups = tuple(getattr(recognition, "feature_outline_groups", ()))
    protected_groups = [
        np.asarray(group, dtype=bool) & detail
        for group in feature_groups
        if np.any(np.asarray(group, dtype=bool) & detail)
    ]
    feature_union = (
        np.logical_or.reduce(protected_groups)
        if protected_groups else np.zeros(detail.shape, dtype=bool)
    )
    for layer in layer_map.values():
        color_mask = np.zeros(detail.shape, dtype=bool)
        for region in layer.regions:
            if region.mask is not None:
                color_mask |= region.mask > 0
        for index, group in enumerate(protected_groups, 1):
            overlay_mask = group & color_mask
            if not np.any(overlay_mask):
                continue
            overlay = Region(
                name=f"{layer.name} cross detail {index}",
                mask=overlay_mask.astype(np.uint8) * 255,
                design_color_id=layer.design_color_id,
                design_color_rgb=layer.design_color_rgb,
                is_detail_region=True,
                is_cross_stitch_overlay=True,
                stitch_settings=ImageEngine._feature_outline_stitch_settings(),
            )
            layer.add_region(overlay)

        remaining = detail & color_mask & ~feature_union
        count, labels = cv2.connectedComponents(
            remaining.astype(np.uint8),
            connectivity=8,
        )
        for component_id in range(1, count):
            component = labels == component_id
            area = int(np.count_nonzero(component))
            if area < 3:
                continue
            ys, xs = np.where(component)
            long_axis = max(
                int(xs.max() - xs.min() + 1),
                int(ys.max() - ys.min() + 1),
            )
            width = cv2.distanceTransform(
                component.astype(np.uint8), cv2.DIST_L2, 3
            ).max() * 2.0
            if long_axis < 4 or width > 5.0:
                continue
            overlay = Region(
                name=f"{layer.name} cross line {component_id}",
                mask=component.astype(np.uint8) * 255,
                design_color_id=layer.design_color_id,
                design_color_rgb=layer.design_color_rgb,
                is_detail_region=True,
                is_cross_stitch_overlay=True,
                stitch_settings=ImageEngine._running_stitch_settings(),
            )
            layer.add_region(overlay)
```

Call `_append_cross_stitch_detail_overlays()` after cross-fill regions are
created and before layer sorting.

- [ ] **Step 5: Run recognition and serialization tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_recognition_engine \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_overlay_role_round_trips \
  -v
```

Expected: PASS, including existing background-speck rejection tests.

- [ ] **Step 6: Commit**

```bash
git add stitch_studio/core/project.py stitch_studio/core/image_engine.py \
  tests/test_export_paths.py tests/test_recognition_engine.py
git commit -m "feat: retain semantic details in cross stitch"
```

### Task 4: Generate Mixed Cross Fill and Detail Work Items

**Files:**
- Modify: `stitch_studio/ui/main_window.py:49-160`
- Modify: `stitch_studio/core/export_engine.py:37-112`
- Modify: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: regions marked `is_cross_stitch_overlay`.
- Produces: `StitchWorker._cross_stitch_work_items(region_jobs)`.
- Preserves: cross-fill ownership before run-overlay generation.

- [ ] **Step 1: Write failing mixed-worker and export-order tests**

```python
def test_cross_worker_builds_ownership_for_fills_and_keeps_overlay_separate(self):
    items = main_mod.StitchWorker._cross_stitch_work_items(
        [(layer, fill), (layer, overlay)],
        engine,
    )
    fill_items = [item for item in items if item[1] is fill]
    overlay_items = [item for item in items if item[1] is overlay]
    self.assertIsNotNone(fill_items[0][4])
    self.assertIsNone(overlay_items[0][4])

def test_same_thread_cross_overlay_exports_after_fill(self):
    pattern = export_mod.ExportEngine().build_pattern(project)
    sewing = [stitch for stitch in pattern.stitches if stitch[2] == pyembroidery.STITCH]
    self.assertEqual(sewing[-len(overlay_points):], overlay_points)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_cross_worker_builds_ownership_for_fills_and_keeps_overlay_separate \
  tests.test_export_paths.ExportPathTests.test_same_thread_cross_overlay_exports_after_fill
```

Expected: FAIL because the worker only recognizes a project where every region
is cross stitch, and export does not explicitly rank overlay regions.

- [ ] **Step 3: Add mixed cross work-item construction**

Add:

```python
@classmethod
def _cross_stitch_work_items(cls, region_jobs, engine):
    fills = [
        (layer, region) for layer, region in region_jobs
        if region.stitch_settings.fill_mode == "cross_stitch"
    ]
    overlays = [
        (layer, region) for layer, region in region_jobs
        if getattr(region, "is_cross_stitch_overlay", False)
    ]
    ownership = engine.build_cross_stitch_ownership_masks([
        (region, cls._cross_stitch_priority(layer, region))
        for layer, region in fills
    ])
    fill_items = [
        (layer, region, [region], region, ownership.get(region.uid))
        for layer, region in fills
    ]
    overlay_items = [
        (layer, region, [region], region, None)
        for layer, region in overlays
    ]
    return fill_items + overlay_items
```

Use this path when at least one cross-fill region exists and every non-cross
region is marked as a cross-stitch overlay.

- [ ] **Step 4: Rank overlays after fills inside a same-thread export block**

Before iterating `region_paths`, sort with:

```python
region_paths = sorted(
    region_paths,
    key=lambda item: (
        bool(getattr(item[0], "is_cross_stitch_overlay", False)),
        bool(item[0].is_detail_region),
    ),
)
```

The false-to-true order writes fills first and overlays last. Keep disconnected
run overlay paths non-connectable so gaps become jumps.

- [ ] **Step 5: Run worker and export tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_cross_worker_builds_ownership_for_fills_and_keeps_overlay_separate \
  tests.test_export_paths.ExportPathTests.test_same_thread_cross_overlay_exports_after_fill \
  tests.test_export_paths.ExportPathTests.test_export_spatially_orders_merged_cross_stitch_shades
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add stitch_studio/ui/main_window.py stitch_studio/core/export_engine.py \
  tests/test_export_paths.py
git commit -m "feat: layer cross stitch detail overlays"
```

### Task 5: End-to-End Fidelity, Count, and Round-Trip Verification

**Files:**
- Modify: `tests/test_export_paths.py`
- Modify: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: shared ownership masks, boundary half stitches, semantic overlays, and export ordering.
- Produces: bounded end-to-end regression evidence.

- [ ] **Step 1: Add a synthetic face cross-stitch regression**

Create a deterministic 96x96 synthetic source and run the real recognition and
layer-building pipeline:

```python
image = np.full((96, 96, 3), (60, 130, 210), dtype=np.uint8)
image[48:, :] = (42, 88, 168)
subject = np.array([[24, 88], [48, 8], [72, 88]], dtype=np.int32)
cv2.fillPoly(image, [subject], (245, 120, 102))
cv2.ellipse(image, (42, 40), (10, 14), 0, 0, 360, (248, 248, 248), -1)
cv2.ellipse(image, (58, 40), (10, 14), 0, 0, 360, (248, 248, 248), -1)
cv2.circle(image, (43, 42), 4, (20, 20, 20), -1)
cv2.circle(image, (59, 42), 4, (20, 20, 20), -1)
cv2.circle(image, (44, 40), 1, (248, 248, 248), -1)
cv2.circle(image, (60, 40), 1, (248, 248, 248), -1)
cv2.polylines(
    image,
    [np.array([[36, 54], [50, 62], [66, 54]], dtype=np.int32)],
    False,
    (22, 22, 22),
    2,
)
cv2.line(image, (35, 23), (43, 20), (22, 22, 22), 2)
cv2.line(image, (55, 20), (63, 23), (22, 22, 22), 2)

threads = [
    ThreadColor(name="Blue", color_rgb=(60, 130, 210)),
    ThreadColor(name="Navy", color_rgb=(42, 88, 168)),
    ThreadColor(name="Coral", color_rgb=(245, 120, 102)),
    ThreadColor(name="White", color_rgb=(248, 248, 248)),
    ThreadColor(name="Black", color_rgb=(22, 22, 22)),
]
settings = QuantizationSettings(
    n_colors=8,
    preserve_details=True,
    include_background=True,
)
recognition = RecognitionEngine.recognize(image, threads, settings)
layers = ImageEngine.build_layers_from_recognition(
    recognition,
    threads,
    image,
    generation_mode="cross_stitch",
    quant_settings=settings,
)
```

Assert:

```python
self.assertLessEqual(len(drawable_thread_colors), 8)
self.assertGreaterEqual(protected_detail_recall, 0.90)
self.assertEqual(int(overlap_count.max()), 1)
self.assertTrue(any(method in ("half", "half_flipped") for method in boundary_methods))
self.assertTrue(all(len(path) >= 2 for path in overlay_paths))
```

- [ ] **Step 2: Add stitch and jump growth bounds**

Generate the same synthetic source with the baseline full-cross path and the
new path. Assert:

```python
self.assertLessEqual(new_stitch_count, int(baseline_stitch_count * 1.35))
self.assertLessEqual(new_jump_count, baseline_jump_count + len(overlay_paths) + 8)
```

The comparison prevents fidelity from being purchased with uncontrolled stitch
or jump growth.

- [ ] **Step 3: Add real pyembroidery PES/DST round-trip test when available**

Use a temporary directory:

```python
with tempfile.TemporaryDirectory() as directory:
    pes_path = os.path.join(directory, "cross-fidelity.pes")
    dst_path = os.path.join(directory, "cross-fidelity.dst")
    exporter.export(project, pes_path)
    exporter.export(project, dst_path)
    pes = pyembroidery.EmbPattern(pes_path)
    dst = pyembroidery.EmbPattern(dst_path)
    self.assertTrue(pes.stitches)
    self.assertTrue(dst.stitches)
    self.assertEqual(pes.stitches[-1][2] & 0xFF, pyembroidery.END)
    self.assertEqual(dst.stitches[-1][2] & 0xFF, pyembroidery.END)
```

Skip only when the real pyembroidery package is unavailable; do not replace
the test with the fake module.

- [ ] **Step 4: Run focused cross-stitch tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cross_stitch_geometry \
  tests.test_recognition_engine \
  tests.test_export_paths
```

Expected: PASS.

- [ ] **Step 5: Run the complete suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all tests PASS; existing optional dependency skips remain unchanged.

- [ ] **Step 6: Record a local performance comparison**

Run the synthetic face generation five times with `time.perf_counter()`. Record
median generation time, stitch count, jump count, and color count in the commit
message body. The median must not exceed the baseline by more than 50%.

- [ ] **Step 7: Commit**

```bash
git add tests/test_export_paths.py tests/test_recognition_engine.py
git commit -m "test: verify cross stitch fidelity and export"
```
