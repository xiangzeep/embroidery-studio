# Source Vector Semantic Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve source geometry and semantic topology through photo-stitch and cross-stitch generation.

**Architecture:** Extend the existing semantic-part contract so both open and closed recognition-time vectors are persisted on regions. Build stable subpixel contours with explicit corner anchors, recover compatible antialiased line fragments before thread collapse, preserve nested fill ownership, and compile only validated guide geometry into stitches.

**Tech Stack:** Python 3, NumPy, OpenCV, scikit-image, Shapely, pyembroidery, unittest.

## Global Constraints

- No character-specific coordinates, colors, or templates.
- Preserve existing project-file compatibility.
- Keep same-thread semantic parts in one physical thread layer.
- Do not invent geometry when source support is absent.
- Keep PES/DST output readable and bounds-stable.

---

### Task 1: Persist Closed Semantic Guides

**Files:**
- Modify: `stitch_studio/core/project.py`
- Modify: `stitch_studio/core/image_engine.py`
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_semantic_parts.py`

**Interfaces:**
- Consumes: `SemanticPart.paths` and `SemanticPart.locked_corner_indices`.
- Produces: `Region.guide_paths_px`, `Region.guide_paths_closed`, and `Region.guide_corner_indices`.

- [ ] Write a failing round-trip test for closed guide metadata.
- [ ] Write a failing stitch test proving a closed guide is used directly.
- [ ] Run the focused tests and confirm raster retracing causes failure.
- [ ] Persist optional guide topology with backwards-compatible defaults.
- [ ] Pass closed semantic guides and corner indices into regions.
- [ ] Compile valid closed guides directly and retain mask fallback.
- [ ] Run focused semantic and export tests.

### Task 2: Stable Source Contours And Corners

**Files:**
- Modify: `stitch_studio/core/contour_geometry.py`
- Modify: `stitch_studio/core/semantic_parts.py`
- Test: `tests/test_contour_geometry.py`
- Test: `tests/test_semantic_parts.py`

**Interfaces:**
- Produces: stable source-resolution closed paths and supported corner indices.

- [ ] Write failing tests for a rounded contour with pixel stair steps and a
  pointed mouth contour with two corners.
- [ ] Run tests and verify the current contour loses smoothness or corners.
- [ ] Add scale-aware subpixel contour regularization.
- [ ] Reject unsupported spikes and lock only bilaterally supported corners.
- [ ] Verify smooth spans and pointed spans independently.

### Task 3: Cross-Color Line Grouping And Nested Ownership

**Files:**
- Modify: `stitch_studio/core/semantic_parts.py`
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_semantic_parts.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces: grouped source-supported open guides and explicit nested child parts.

- [ ] Write a failing antialiased split-line fixture.
- [ ] Write a failing mouth-and-tongue z-order fixture.
- [ ] Group compatible fragments by endpoint distance, tangent, and source-edge
  support without merging unrelated marks.
- [ ] Preserve nested compact fills and avoid destructive same-color carving.
- [ ] Run recognition and layer-construction tests.

### Task 4: Remove Invented Micro Geometry

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_semantic_parts.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: validated guides or real component skeletons.
- Produces: no synthetic farthest-point bars.

- [ ] Write a failing test for an unsupported compact blob.
- [ ] Remove the repeated farthest-point fallback.
- [ ] Use a real skeleton path only when it has supported length and topology.
- [ ] Verify tiny highlights still survive through compact fill behavior.

### Task 5: Pipeline Verification

**Files:**
- Modify only files required by test failures.

**Interfaces:**
- Produces: stage images and export-readback evidence.

- [ ] Run contour, semantic, recognition, cross-stitch, and export tests.
- [ ] Run the complete unittest suite.
- [ ] Generate source, recognition, vector-guide, photo-stitch, and cross-stitch
  comparison images.
- [ ] Export PES and DST fixtures and verify readback bounds, colors, stitches,
  and path continuity.
- [ ] Inspect the diff for compatibility and unrelated changes.

