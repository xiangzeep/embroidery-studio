# Semantic Vector Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured semantic intermediate representation, consume it in photo and cross stitch, and measure the real pipeline with MSEmb data.

**Architecture:** A focused semantic extraction module converts design-map components into immutable typed parts before physical thread collapse. Recognition exposes the parts while preserving legacy masks, and layer construction consumes typed parts as explicit child regions. The calibration runner executes recognition, layer generation, stitch generation, preview rasterization, and export readback.

**Tech Stack:** Python 3, NumPy, OpenCV, scikit-image, scikit-learn, Shapely, pyembroidery, unittest.

## Global Constraints

- No character-specific coordinates, colors, or templates.
- Keep existing projects and callers compatible.
- Preserve one physical-thread parent layer with separate editable child regions.
- Preserve PES/DST readability and stable bounds.
- Do not solve fidelity with unbounded color, stitch, region, or jump growth.

---

### Task 1: Semantic Part Contract And Extraction

**Files:**
- Create: `stitch_studio/core/semantic_parts.py`
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_semantic_parts.py`

**Interfaces:**
- Produces: `SemanticPartKind`, `SemanticPart`, and `SemanticPartExtractor.extract(...)`.
- Produces: `RecognitionResult.semantic_parts: tuple[SemanticPart, ...]`.

- [ ] Write failing tests for closed contours with sharp corners and holes,
  rounded contours, open lines, independent compact fills, and nested
  highlights.
- [ ] Run `python -m unittest tests.test_semantic_parts -v` and confirm the
  missing module or behavior fails.
- [ ] Implement immutable semantic values and bounded extraction from design
  masks, detail masks, subject masks, and source colors.
- [ ] Expose semantic parts from `RecognitionEngine.recognize()` while retaining
  the existing feature outline fields.
- [ ] Run the semantic and recognition test modules.

### Task 2: Typed Photo And Cross-Stitch Regions

**Files:**
- Modify: `stitch_studio/core/project.py`
- Modify: `stitch_studio/core/image_engine.py`
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_semantic_parts.py`
- Test: `tests/test_recognition_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces: optional `Region.semantic_part_id`, `semantic_kind`,
  `semantic_role`, and `semantic_parent_id`.
- Consumes: `RecognitionResult.semantic_parts`.

- [ ] Write failing tests that photo mode creates continuous runs for open
  lines, adaptive closed runs for outlines, and compact fills for pupils.
- [ ] Write failing tests that cross mode retains the base grid and appends
  protected semantic overlays without overlapping grid ownership.
- [ ] Run focused tests and confirm the new metadata and behavior are absent.
- [ ] Persist optional semantic region metadata with backwards compatibility.
- [ ] Build typed semantic child regions before legacy heuristic repair and
  deduplicate overlapping compatibility overlays.
- [ ] Reuse local contour anchors and separate disconnected open paths.
- [ ] Run focused photo, cross-stitch, project round-trip, and export tests.

### Task 3: Real Pipeline Calibration

**Files:**
- Create: `stitch_studio/calibration/pipeline_runner.py`
- Modify: `stitch_studio/tools/msemb_calibrate.py`
- Test: `tests/test_msemb_calibration.py`

**Interfaces:**
- Produces: `PipelineCalibrationProfile` and
  `evaluate_pipeline_pair(source, target, mode, threads, settings)`.
- Produces: stage metrics, timings, structural counts, and export readback
  metadata in the calibration report.

- [ ] Write a failing synthetic calibration test that patches or spies on
  recognition and stitch generation and asserts both are invoked.
- [ ] Run the focused calibration test and confirm the identity-only runner
  fails it.
- [ ] Implement deterministic pipeline evaluation and preview rasterization.
- [ ] Extend the CLI report with explicit baseline and generated profiles.
- [ ] Run calibration tests and a bounded six-pair local audit.

### Task 4: Verification And Regression

**Files:**
- Modify only files required by failures discovered during verification.

**Interfaces:**
- Consumes all preceding task interfaces.
- Produces verified test, fidelity, performance, and export evidence.

- [ ] Run semantic, recognition, contour, cross-stitch, export, and calibration
  tests.
- [ ] Run the complete unittest suite.
- [ ] Run the six-pair MSEmb audit in photo and cross modes and compare stage
  timings, region counts, stitches, and jump-like gaps with the saved baseline.
- [ ] Export and read back representative PES and DST files and compare bounds
  and color blocks.
- [ ] Inspect the final diff for compatibility, accidental generated files, and
  unrelated changes.

