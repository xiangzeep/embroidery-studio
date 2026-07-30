# Background Fidelity and Color Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve stitchable background detail and organize generated objects
under minimal physical color layers without breaking overlap order.

**Architecture:** Add a four-plane scene classification to existing `Region`
objects, partition each color mask into complementary subject/background
objects, and apply plane-specific stitch settings. Keep `Layer` as the physical
thread abstraction and make export color grouping dependency-aware.

**Tech Stack:** Python, NumPy, OpenCV, scikit-image, PySide6, pyembroidery,
`unittest`.

## Global Constraints

- Do not add a required runtime dependency.
- Do not create one region per connected component.
- Preserve all source-mask pixels when splitting scene planes.
- Keep beginner defaults automatic; store professional controls in project
  settings and region metadata.
- Never merge color blocks across an overlapping intervening object.

---

### Task 1: Scene Plane Metadata

**Files:**
- Modify: `stitch_studio/core/project.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces: `Region.scene_plane: str`
- Produces: JSON round-trip support for the four scene-plane values.

- [x] Write a failing project round-trip test asserting that
  `scene_plane="background_detail"` survives serialization.
- [x] Run the focused test and confirm that `Region` rejects or loses the field.
- [x] Add the field with default `"subject_base"` and serialize it.
- [x] Run the focused test and confirm it passes.

### Task 2: Complementary Subject and Background Objects

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces:
  `ImageEngine._scene_plane_masks(mask, subject_mask) -> tuple[(str, ndarray)]`
- Consumes: `QuantizationSettings.include_background`

- [x] Write failing tests proving the returned masks are disjoint and their
  union exactly equals the source color mask.
- [x] Write a failing test proving an included background motif remains in a
  generated physical color layer.
- [x] Implement vectorized complementary partitioning without destructive
  morphology or missing seam pixels.
- [x] Pass a configurable background importance into physical-thread matching.
- [x] Run all recognition tests.

### Task 3: Plane-Specific Stitch Settings

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces:
  `ImageEngine._photo_settings_for_scene_plane(mask, rgb, scene_plane)`
- Consumes: `Region.scene_plane`

- [x] Write failing tests asserting background bases use wider row spacing than
  subject bases while retaining a non-empty polygon and stitch paths.
- [x] Implement lighter background base settings and detail-preserving
  background line settings.
- [x] Assign semantic parts to background or subject detail planes from their
  subject confidence.
- [x] Run focused photo-stitch and semantic tests.

### Task 4: Dependency-Aware Same-Thread Grouping

**Files:**
- Modify: `stitch_studio/core/export_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces:
  `ExportEngine._drawable_groups_overlap(left, right) -> bool`
- Changes: `_group_drawable_layers` merges only overlap-safe groups.

- [x] Write a failing test where disjoint same-thread layers separated by
  another color become one color block.
- [x] Write a failing test where overlapping same-thread layers separated by
  another color remain two color blocks.
- [x] Implement conservative bounds/mask overlap checks.
- [x] Order regions by scene plane and semantic z-order before path routing.
- [x] Run export, PES, and DST tests.

### Task 5: Real Sample and Performance Verification

**Files:**
- Modify: `tests/test_msemb_calibration.py` only if a reusable assertion is
  needed.
- Output: `/tmp/stitch-background-fidelity-validation/`

**Interfaces:**
- Consumes the existing MSEmb calibration runner and real paired dataset.

- [x] Generate photo-stitch and cross-stitch outputs for representative MSEmb
  pairs and the supplied Patrick image when locally available.
- [x] Record design colors, physical colors, regions, stitches, generation time,
  and export color blocks.
- [x] Render a source/target/photo/cross montage.
- [x] Run the complete test suite and `git diff --check`.
- [x] Report measured limitations rather than claiming pixel-perfect physical
  equivalence.
