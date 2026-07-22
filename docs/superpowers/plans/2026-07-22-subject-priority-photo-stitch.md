# Subject-Priority Photo Stitch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the main subject ahead of background detail while producing cleaner, color-limited photo-stitch PES files.

**Architecture:** Recognition derives an optional subject mask from quantized components and uses it to rank physical thread colors. Layer reconstruction uses that mask to distinguish subject silhouette satin from internal running stitches while retaining the current beginner workflow.

**Tech Stack:** Python 3, NumPy, OpenCV, scikit-image, scikit-learn, PySide6, pyembroidery, unittest.

## Global Constraints

- Default maximum physical colors remains 12.
- No neural-network dependency or network download.
- Cross-stitch output remains unchanged.
- Existing projects without subject metadata remain compatible.
- Implementation follows failing-test-first TDD.

---

### Task 1: Subject Mask Detection

**Files:**
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces: `RecognitionEngine.detect_primary_subject(design_map, image) -> np.ndarray`
- Produces: optional `RecognitionResult.subject_mask`.

- [ ] Write a synthetic failing test containing a large central coral subject, full-width blue background, white eyes, and a red mouth. Assert that the subject, eyes, and mouth are selected while corner background is rejected.
- [ ] Run `QT_QPA_PLATFORM=offscreen .venv/bin/python -m unittest tests.test_recognition_engine.RecognitionEngineTests.test_primary_subject_grows_into_enclosed_details` and confirm it fails because the API is absent.
- [ ] Implement connected-component scoring using center overlap, component area, border span, adjacency, and the primary component bounding area.
- [ ] Run the focused test and confirm it passes.

### Task 2: Subject-Weighted Thread Selection

**Files:**
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: `RecognitionResult.subject_mask`.
- Produces: `_match_threads_with_budget(..., subject_pixel_counts=None)`.

- [ ] Write a failing test where a small central subject color and several large background colors compete for a two-thread budget. Assert that the subject's nearest thread is retained.
- [ ] Run the focused test and confirm the background-only ranking currently wins.
- [ ] Rank thread candidates with `subject_pixels * 4.0 + background_pixels * 0.35`, preserving darkest and lightest subject candidates when present.
- [ ] Run the focused test and existing deterministic-recognition tests.

### Task 3: Subject-Aware Stitch Classification

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: optional `recognition.subject_mask`.
- Produces: `_reclassify_photo_layer_components(layer, subject_mask=None)`.

- [ ] Write a failing test with one dark outer silhouette stroke and one same-color internal arm mark. Assert satin for the silhouette and run for the internal mark.
- [ ] Run the focused test and confirm geometry-only classification makes both satin.
- [ ] Build a narrow subject outer-boundary band and require sufficient component contact with that band before selecting satin; retain existing width and area limits.
- [ ] Run the focused test and all layer-ordering, halo, and underpaint tests.

### Task 4: Real Sample Metrics And PES Round Trip

**Files:**
- Modify: `tests/test_recognition_engine.py`
- Modify: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: the supplied Patrick PNG when available.
- Produces: regression assertions for subject coverage, boundary recall, color count, and PES readback.

- [ ] Add subject coverage and subject boundary assertions to `PatrickRegressionTests`.
- [ ] Add an export test that generates the real sample, writes PES v6, reads it with pyembroidery, and verifies color count, stitches, and END.
- [ ] Run both tests and capture recognition, layer, stitch, jump, trim, and thread counts.
- [ ] Render an offscreen stitch-only preview with the same layer Z-order as `MainWindow` and inspect eyes, mouth, arms, silhouette, and background.

### Task 5: Full Verification And Delivery

**Files:**
- Modify only files required by Tasks 1-4.

- [ ] Run `QT_QPA_PLATFORM=offscreen .venv/bin/python -m unittest discover -s tests` and require zero failures.
- [ ] Run `.venv/bin/python -m compileall -q stitch_studio tests`.
- [ ] Run `git diff --check` and inspect `git status --short` so unrelated files remain untouched.
- [ ] Commit the implementation and push `codex/vector-boundary-reconstruction`.
