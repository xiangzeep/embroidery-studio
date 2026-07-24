# Semantic Detail Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve continuous thin lines, sharp facial corners, nested eye highlights, and stitchable tiny marks in photo-stitch output.

**Architecture:** Recognition records semantic detail masks without flattening nested colors. Layer construction classifies those masks into closed contours, open runs, compact fills, and protected highlights. Stitch generation uses corner-aware contour paths and branch-pruned centerlines.

**Tech Stack:** Python, NumPy, OpenCV, scikit-image, unittest, pyembroidery.

## Global Constraints

- Do not add image-specific coordinates, colors, or character rules.
- Keep existing project files compatible by making new settings optional.
- Do not alter cross-stitch generation behavior.
- Validate both preview paths and exported PES readability.

---

### Task 1: Corner-Preserving Closed Contours

**Files:**
- Modify: `tests/test_export_paths.py`
- Modify: `stitch_studio/core/project.py`
- Modify: `stitch_studio/core/stitch_engine.py`

**Interfaces:**
- Consumes: `StitchSettings.run_trace_contour`
- Produces: `StitchSettings.run_preserve_corners: bool` and corner-aware contour paths.

- [ ] **Step 1: Write failing contour tests**

Add tests that generate an asymmetric polygon with acute mouth corners and assert
that the resulting path contains points near both original acute vertices while
remaining one closed path.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_export_paths.py -k "sharp_feature or contour" -q`

Expected: the sharp-corner assertion fails because Chaikin smoothing moves the
vertices inward.

- [ ] **Step 3: Implement curvature anchors**

Add a corner-preserving option to `StitchSettings`. In
`_generate_closed_contour_run`, simplify the contour, identify vertices whose
turn angle is below the corner threshold, smooth only spans between anchors, and
resample without moving anchor coordinates.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m pytest tests/test_export_paths.py -k "sharp_feature or contour" -q`

Expected: all selected tests pass.

### Task 2: Clean Continuous Open Runs

**Files:**
- Modify: `tests/test_export_paths.py`
- Modify: `stitch_studio/core/stitch_engine.py`

**Interfaces:**
- Consumes: binary run mask and optional source image.
- Produces: branch-pruned centerline paths with directional endpoint bridging.

- [ ] **Step 1: Write failing open-line tests**

Add one mask containing a broken curved line plus a short side spur. Assert that
generation returns one continuous path covering both main endpoints and does not
visit the spur endpoint. Add a second test proving disconnected tiny marks remain
separate paths.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_export_paths.py -k "branch_pruned or directional_bridge" -q`

Expected: the spur remains or the main line stays split.

- [ ] **Step 3: Implement graph cleanup**

Prune terminal branches shorter than the physical stitch threshold when their
source support is weaker than the main branch. Bridge endpoints only when gap
distance, tangent alignment, and source-color support all pass.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m pytest tests/test_export_paths.py -k "branch_pruned or directional_bridge" -q`

Expected: all selected tests pass.

### Task 3: Preserve Eye Layers and Tiny Marks

**Files:**
- Modify: `tests/test_recognition_engine.py`
- Modify: `stitch_studio/core/recognition_engine.py`
- Modify: `stitch_studio/core/image_engine.py`

**Interfaces:**
- Consumes: quantized design map, source RGB image, subject mask.
- Produces: protected detail mask and regions for eye highlights, uniform pupils,
  and stitchable short marks.

- [ ] **Step 1: Write failing recognition tests**

Build synthetic eyes with two white sclera components, two black pupils, and a
small white highlight in each pupil. Assert that cleanup preserves all nested
components. Add high-contrast short marks next to low-contrast antialias specks
and assert only the real marks survive as running-stitch regions.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_recognition_engine.py -k "eye_hierarchy or stitchable_tiny" -q`

Expected: highlights are merged or both tiny component types are removed.

- [ ] **Step 3: Implement protected nested details**

Detect enclosed light components inside compact dark components and add them to
the detail protection mask before cleanup. Regularize each pupil independently
using close/fill operations bounded by its original component envelope. Replace
fixed tiny-area deletion with a contrast, shape, and physical-length score.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m pytest tests/test_recognition_engine.py -k "eye_hierarchy or stitchable_tiny" -q`

Expected: all selected tests pass.

### Task 4: End-to-End Export Verification

**Files:**
- Modify: `tests/test_recognition_engine.py`
- Modify: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: the Patrick source image through the existing image-to-project flow.
- Produces: readable PES with stable bounds and visual preview artifacts.

- [ ] **Step 1: Run complete automated tests**

Run: `python -m pytest -q`

Expected: all tests pass.

- [ ] **Step 2: Generate the real project and PES**

Use the existing photo-stitch generation entry point with the original Patrick
image, save the PES under `/tmp`, and read it back through pyembroidery.

- [ ] **Step 3: Verify output invariants**

Assert non-empty stitch blocks, stable dimensions, valid color changes, separate
jumps between disconnected marks, and no visible connector paths.

- [ ] **Step 4: Render and inspect**

Render the generated paths and PES preview. Compare the mouth-bottom line, both
mouth corners, both pupil/highlight stacks, and right-side short marks against
the recognized image.

- [ ] **Step 5: Commit implementation**

Stage only the relevant source, tests, and plan files. Commit with:

`git commit -m "fix: preserve semantic photo stitch details"`
