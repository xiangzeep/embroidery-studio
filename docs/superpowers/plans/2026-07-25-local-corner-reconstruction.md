# Local Corner Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct one closed feature outline with smooth curved spans and exact locked sharp corners so eyes stop jittering and mouth corners remain pointed.

**Architecture:** Add a pure contour-geometry module that detects stable local corner anchors and reconstructs each span independently. `StitchEngine` delegates adaptive closed runs to this module, while legacy smooth/preserve behavior remains available for old projects and explicit professional settings.

**Tech Stack:** Python 3.10+, NumPy, OpenCV, unittest, existing `StitchEngine` path utilities.

## Global Constraints

- No character-specific coordinates, colors, or templates.
- A single contour may contain both smooth spans and locked sharp corners.
- Existing serialized projects remain readable.
- Degenerate geometry must fall back to the existing safe running-stitch path.
- PES and DST output bounds must remain stable within existing format tolerance.

---

## File Structure

- Create `stitch_studio/core/contour_geometry.py`: pure local-corner analysis and adaptive closed-contour reconstruction.
- Create `tests/test_contour_geometry.py`: focused synthetic geometry tests independent of UI and embroidery export.
- Modify `stitch_studio/core/project.py`: serialize a three-mode contour policy while retaining the legacy boolean.
- Modify `stitch_studio/core/image_engine.py`: assign adaptive contour policy to semantic feature outlines and remove whole-region shape classification.
- Modify `stitch_studio/core/stitch_engine.py`: route adaptive feature contours through the new geometry module.
- Modify `tests/test_export_paths.py`: integration, serialization, and path-quality regression tests.
- Modify `tests/test_recognition_engine.py`: assert semantic feature outlines select adaptive local corners.

### Task 1: Add Backward-Compatible Contour Policy

**Files:**
- Modify: `stitch_studio/core/project.py:38-78`
- Modify: `stitch_studio/core/image_engine.py:1387-1434`
- Test: `tests/test_export_paths.py:667-685`
- Test: `tests/test_recognition_engine.py:740-780`

**Interfaces:**
- Produces: `StitchSettings.run_corner_mode: str`, with values `"legacy"`, `"smooth"`, `"preserve"`, or `"adaptive"`.
- Consumes: existing `run_preserve_corners: bool` when `run_corner_mode == "legacy"`.

- [ ] **Step 1: Write failing serialization and semantic-default tests**

```python
def test_run_corner_mode_round_trip_and_legacy_default(self):
    settings = project_mod.StitchSettings(
        fill_mode="run",
        run_corner_mode="adaptive",
        run_preserve_corners=True,
    )
    restored = project_mod.StitchSettings.from_dict(settings.to_dict())
    legacy = project_mod.StitchSettings.from_dict({"fill_mode": "run"})
    self.assertEqual(restored.run_corner_mode, "adaptive")
    self.assertEqual(legacy.run_corner_mode, "legacy")

def test_feature_outline_uses_adaptive_local_corners(self):
    settings = ImageEngine._feature_outline_stitch_settings()
    self.assertEqual(settings.fill_mode, "run")
    self.assertTrue(settings.run_trace_contour)
    self.assertEqual(settings.run_corner_mode, "adaptive")
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_run_corner_mode_round_trip_and_legacy_default \
  tests.test_recognition_engine.DetailRecognitionTests.test_feature_outline_uses_adaptive_local_corners
```

Expected: FAIL because `run_corner_mode` does not exist and feature outlines still call the whole-region classifier.

- [ ] **Step 3: Add the setting and replace whole-region classification**

In `StitchSettings` add:

```python
run_corner_mode: str = "legacy"
```

Replace `_feature_outline_stitch_settings(preserve_corners=...)` with:

```python
@staticmethod
def _feature_outline_stitch_settings() -> StitchSettings:
    return StitchSettings(
        fill_mode="run",
        stitch_length_mm=1.5,
        stitch_length_min_mm=0.8,
        stitch_length_max_mm=2.0,
        row_spacing_mm=0.4,
        density=1.0,
        underlay=False,
        contour_count=0,
        pull_compensation_mm=0.0,
        run_passes=3,
        run_trace_contour=True,
        run_corner_mode="adaptive",
    )
```

Delete `_feature_outline_preserves_corners()` and call
`_feature_outline_stitch_settings()` directly for every semantic closed
feature outline.

- [ ] **Step 4: Run the focused tests and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add stitch_studio/core/project.py stitch_studio/core/image_engine.py \
  tests/test_export_paths.py tests/test_recognition_engine.py
git commit -m "refactor: select adaptive feature contours"
```

### Task 2: Implement Stable Local Corner Analysis

**Files:**
- Create: `stitch_studio/core/contour_geometry.py`
- Create: `tests/test_contour_geometry.py`

**Interfaces:**
- Produces: `normalize_closed_contour(points) -> np.ndarray`.
- Produces: `detect_locked_corner_indices(points, support=3, min_deflection_degrees=55.0, min_support_length=3.0) -> tuple[int, ...]`.
- Produces: `adaptive_closed_contour(points, spacing_px, smoothing_iterations=2) -> list[tuple[float, float]]`.

- [ ] **Step 1: Write failing local-corner tests**

```python
import unittest
import numpy as np

from stitch_studio.core.contour_geometry import (
    adaptive_closed_contour,
    detect_locked_corner_indices,
)


class LocalContourGeometryTests(unittest.TestCase):
    def test_mixed_curve_keeps_two_supported_mouth_corners(self):
        points = [
            (4, 12), (6, 8), (10, 5), (16, 4), (22, 5), (26, 8),
            (30, 12), (26, 11), (22, 10), (16, 9), (10, 10), (6, 11),
            (4, 12),
        ]
        rebuilt = adaptive_closed_contour(points, spacing_px=2.0)
        self.assertIn((4.0, 12.0), rebuilt)
        self.assertIn((30.0, 12.0), rebuilt)
        self.assertEqual(rebuilt[0], rebuilt[-1])

    def test_rounded_eye_does_not_lock_pixel_stair_steps(self):
        angles = np.linspace(0.0, 2.0 * np.pi, 48, endpoint=False)
        points = [
            (round(24 + 13 * np.cos(a)), round(20 + 17 * np.sin(a)))
            for a in angles
        ]
        points.append(points[0])
        anchors = detect_locked_corner_indices(points)
        self.assertLessEqual(len(anchors), 1)

    def test_single_pixel_spike_without_support_is_not_locked(self):
        points = [
            (4, 4), (12, 4), (13, 3), (14, 4), (22, 4),
            (22, 16), (4, 16), (4, 4),
        ]
        anchors = detect_locked_corner_indices(
            points,
            support=2,
            min_support_length=4.0,
        )
        self.assertNotIn(2, anchors)
```

- [ ] **Step 2: Run tests and verify import failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_contour_geometry -v
```

Expected: FAIL because `stitch_studio.core.contour_geometry` does not exist.

- [ ] **Step 3: Implement normalized contour and local anchor detection**

Create `contour_geometry.py` with these public functions and private helpers:

```python
def normalize_closed_contour(points):
    array = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    if len(array) > 1 and np.allclose(array[0], array[-1]):
        array = array[:-1]
    if len(array) == 0:
        return array
    keep = np.ones(len(array), dtype=bool)
    keep[1:] = np.linalg.norm(np.diff(array, axis=0), axis=1) > 1e-6
    return array[keep]


def detect_locked_corner_indices(
    points,
    support=3,
    min_deflection_degrees=55.0,
    min_support_length=3.0,
):
    contour = normalize_closed_contour(points)
    if len(contour) < support * 2 + 3:
        return ()
    scores = np.zeros(len(contour), dtype=np.float64)
    for index in range(len(contour)):
        previous = contour[(index - support) % len(contour)]
        current = contour[index]
        following = contour[(index + support) % len(contour)]
        incoming = previous - current
        outgoing = following - current
        left = np.linalg.norm(incoming)
        right = np.linalg.norm(outgoing)
        immediate_left = np.linalg.norm(contour[(index - 1) % len(contour)] - current)
        immediate_right = np.linalg.norm(contour[(index + 1) % len(contour)] - current)
        if (
            min(left, right) < min_support_length
            or min(immediate_left, immediate_right) < min_support_length
        ):
            continue
        cosine = np.clip(np.dot(incoming, outgoing) / (left * right), -1.0, 1.0)
        interior = np.degrees(np.arccos(cosine))
        scores[index] = max(0.0, 180.0 - interior)
    candidates = [
        index for index, score in enumerate(scores)
        if score >= min_deflection_degrees
        and score >= scores[(index - 1) % len(scores)]
        and score >= scores[(index + 1) % len(scores)]
    ]
    return _merge_cyclic_candidates(candidates, scores, len(contour), radius=support)
```

Implement `_merge_cyclic_candidates()` so candidates within `support` indices
collapse to the highest score. Keep the normalized contour index stable.

- [ ] **Step 4: Implement anchor-preserving span reconstruction**

Add:

```python
def adaptive_closed_contour(points, spacing_px, smoothing_iterations=2):
    contour = normalize_closed_contour(points)
    if len(contour) < 3:
        return [(float(x), float(y)) for x, y in contour]
    anchors = detect_locked_corner_indices(contour)
    if not anchors:
        smooth = _chaikin_closed(contour, smoothing_iterations)
        return _close(_resample_closed(smooth, spacing_px))
    output = []
    for start, end in _cyclic_anchor_pairs(anchors):
        span = _cyclic_slice(contour, start, end)
        smooth_span = _chaikin_open(span, smoothing_iterations)
        sampled = _resample_open(smooth_span, spacing_px)
        if output:
            sampled = sampled[1:]
        output.extend(sampled)
    return _close(output)
```

`_chaikin_open()` must copy its first and last point unchanged on every
iteration. `_resample_open()` must always emit both endpoints.

- [ ] **Step 5: Run geometry tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_contour_geometry -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add stitch_studio/core/contour_geometry.py tests/test_contour_geometry.py
git commit -m "feat: reconstruct mixed curved and sharp contours"
```

### Task 3: Integrate Adaptive Reconstruction into Stitch Generation

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py:770-845`
- Modify: `tests/test_export_paths.py:540-624`

**Interfaces:**
- Consumes: `adaptive_closed_contour(points, spacing_px)`.
- Produces: `_resolved_run_corner_mode(settings) -> str`.

- [ ] **Step 1: Write a failing mixed-contour integration test**

```python
def test_adaptive_closed_run_smooths_arc_and_keeps_mouth_tips(self):
    engine = stitch_mod.StitchEngine(px_per_mm=4.0)
    mask = np.zeros((48, 64), dtype=np.uint8)
    polygon = np.array([
        [6, 28], [10, 18], [18, 11], [28, 8], [38, 11], [46, 18],
        [56, 28], [46, 25], [38, 23], [28, 22], [18, 23], [10, 25],
    ], dtype=np.int32)
    cv2.fillPoly(mask, [polygon], 255)
    settings = project_mod.StitchSettings(
        fill_mode="run",
        stitch_length_mm=0.5,
        underlay=False,
        run_trace_contour=True,
        run_corner_mode="adaptive",
        run_passes=1,
    )
    path = engine._generate_closed_contour_run(mask, settings)[0]
    self.assertTrue(any(np.linalg.norm(np.asarray(point) - (6, 28)) < 1.5 for point in path))
    self.assertTrue(any(np.linalg.norm(np.asarray(point) - (56, 28)) < 1.5 for point in path))
    self.assertEqual(path[0], path[-1])
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_adaptive_closed_run_smooths_arc_and_keeps_mouth_tips
```

Expected: FAIL because `run_corner_mode="adaptive"` is not dispatched.

- [ ] **Step 3: Route the policy in `_generate_closed_contour_run()`**

Import:

```python
from .contour_geometry import adaptive_closed_contour
```

Add:

```python
@staticmethod
def _resolved_run_corner_mode(settings):
    mode = getattr(settings, "run_corner_mode", "legacy")
    if mode == "legacy":
        return "preserve" if getattr(settings, "run_preserve_corners", False) else "smooth"
    return mode if mode in ("smooth", "preserve", "adaptive") else "smooth"
```

In `_generate_closed_contour_run()`:

```python
corner_mode = self._resolved_run_corner_mode(settings)
if corner_mode == "adaptive":
    points = adaptive_closed_contour(points, stitch_length)
elif corner_mode == "preserve":
    points = self._resample_polyline_preserving_vertices(
        points, stitch_length, closed=True
    )
else:
    points = self._chaikin_smooth(points, closed=True, iterations=2)
    points = self._resample_run_path(points, stitch_length, closed=True)
```

Keep the existing reinforced-pass logic unchanged.

- [ ] **Step 4: Run local and existing contour regressions**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_contour_geometry \
  tests.test_export_paths.ExportPathTests.test_adaptive_closed_run_smooths_arc_and_keeps_mouth_tips \
  tests.test_export_paths.ExportPathTests.test_closed_contour_smoothing_reduces_pixel_jitter \
  tests.test_export_paths.ExportPathTests.test_run_corner_settings_round_trip_and_old_default
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add stitch_studio/core/stitch_engine.py tests/test_export_paths.py
git commit -m "fix: preserve local corners in smooth outlines"
```

### Task 4: Verify Photo-Stitch Regression and Export Safety

**Files:**
- Modify: `tests/test_export_paths.py`
- Modify: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: adaptive semantic feature settings and generated closed paths.
- Produces: regression evidence for path quality and export compatibility.

- [ ] **Step 1: Add bounds and semantic regression assertions**

Extend the synthetic feature tests to assert:

```python
self.assertEqual(eye_region.stitch_settings.run_corner_mode, "adaptive")
self.assertEqual(mouth_region.stitch_settings.run_corner_mode, "adaptive")
```

Add an export pattern test:

```python
before = region.stitch_bounds()
pattern = export_mod.ExportEngine().build_pattern(project)
after = pattern.bounds()
self.assertIsNotNone(before)
self.assertIsNotNone(after)
self.assertLessEqual(abs((before[2] - before[0]) - (after[2] - after[0])), 1.0)
self.assertLessEqual(abs((before[3] - before[1]) - (after[3] - after[1])), 1.0)
```

- [ ] **Step 2: Run photo-stitch and export tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_contour_geometry \
  tests.test_recognition_engine \
  tests.test_export_paths
```

Expected: PASS with no DST/PES bounds regression.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all tests PASS; optional dependency tests may remain skipped for the
same documented reasons as the baseline.

- [ ] **Step 4: Commit**

```bash
git add tests/test_export_paths.py tests/test_recognition_engine.py
git commit -m "test: cover adaptive feature contour export"
```
