# Export Fidelity Closed-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a trustworthy source-to-PES quality loop that catches missing details, color drift, geometry drift, and preview/export disagreement.

**Architecture:** Add a canonical renderer for `pyembroidery.EmbPattern`, decode exported files back into that representation, and measure each pipeline boundary independently. Replace temporary image paths and self-referential metrics with permanent fixtures and independently derived observations.

**Tech Stack:** Python 3, NumPy, OpenCV, scikit-image, Pillow, pyembroidery, unittest.

## Global Constraints

- No character-specific production coordinates or color constants.
- Real regression fixtures must never reference temporary directories.
- Preview and export comparison must consume the same `EmbPattern` contract.
- Travel and jump movement must not be rendered as sewn thread.
- Preserve existing project-file compatibility.
- Final decoded embroidery quality, not intermediate reconstruction, is the release gate.

---

### Task 1: Permanent Real-Image Fixture

**Files:**
- Create: `tests/fixtures/patrick-source.png`
- Modify: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces: `PATRICK_SOURCE_PATH: pathlib.Path` resolved relative to the test module.

- [ ] Copy the supplied source image into `tests/fixtures`.
- [ ] Replace the temporary clipboard path with the repository fixture.
- [ ] Remove skip-on-missing behavior and assert that the fixture exists.
- [ ] Run the Patrick tests and confirm they execute.

### Task 2: Independent Detail Recall

**Files:**
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces: `RecognitionEngine.extract_observed_detail_mask(image, support_mask=None) -> np.ndarray`.

- [ ] Add a failing test where source detail is absent from reconstruction.
- [ ] Run the test and confirm the current self-comparison reports a false pass.
- [ ] Derive source and reconstructed detail masks independently.
- [ ] Use independent masks for design, thread, and subject metrics.
- [ ] Verify removed lines reduce detail recall and retained lines pass.

### Task 3: Canonical EmbPattern Renderer

**Files:**
- Create: `stitch_studio/core/pattern_renderer.py`
- Create: `tests/test_pattern_renderer.py`

**Interfaces:**
- Produces: `PatternRenderer.render(pattern, size, padding=8, thread_width_mm=0.35) -> np.ndarray`.
- Produces: `PatternRenderer.statistics(pattern) -> PatternStatistics`.

- [ ] Write failing tests for stitch rendering, hidden jumps, color changes,
  bounds, and deterministic dimensions.
- [ ] Implement command interpretation and fit transform.
- [ ] Render sewn segments with the current thread color.
- [ ] Verify jumps and trims move the needle without drawing.
- [ ] Verify identical patterns render byte-identically.

### Task 4: PES Export Readback Validation

**Files:**
- Modify: `stitch_studio/core/export_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces: `ExportRoundTripReport` containing geometry, color, command, and render parity.
- Produces: `ExportEngine.validate_roundtrip(source_pattern, filepath)`.

- [ ] Write a failing real-pyembroidery PES roundtrip test.
- [ ] Export PES v6, decode it, and compare sewn bounds and command counts.
- [ ] Compare thread RGB/order and canonical renders.
- [ ] Reject unreadable, empty, or materially changed files.
- [ ] Keep DST metadata behavior and route its validation through shared checks.

### Task 5: Pipeline Report And Preview Source

**Files:**
- Modify: `stitch_studio/calibration/pipeline_runner.py`
- Modify: `stitch_studio/ui/main_window.py`
- Test: `tests/test_msemb_calibration.py`
- Test: `tests/test_pattern_renderer.py`

**Interfaces:**
- Pipeline results include `pattern_preview`, `readback_preview`,
  `roundtrip_metrics`, and stage timings.

- [ ] Replace the calibration one-pixel path renderer with `PatternRenderer`.
- [ ] Build one `EmbPattern` and use it for final detailed preview.
- [ ] Preserve recognition-mask view as a separately named mode.
- [ ] Verify preview and exported readback use the same dimensions and palette.

### Task 6: Real-Image Quality Report

**Files:**
- Create: `stitch_studio/tools/fidelity_report.py`
- Modify: `tests/test_msemb_calibration.py`

**Interfaces:**
- CLI writes source, reconstruction, thread reconstruction, pattern preview,
  PES readback, heatmap, and JSON metrics into one output directory.

- [ ] Add a deterministic CLI integration test.
- [ ] Generate the Patrick report for photo stitch and cross stitch.
- [ ] Record subject color, edge, detail, coverage, noise, and roundtrip metrics.
- [ ] Establish the current baseline without claiming it meets the final gate.
- [ ] Use the report as the gate for subsequent semantic and stitch changes.

### Task 7: Verification

**Files:**
- Modify only files required by verified failures.

**Interfaces:**
- Produces test logs and before/after visual artifacts.

- [ ] Run focused recognition, renderer, calibration, and export tests.
- [ ] Run the complete test suite.
- [ ] Read both generated PES files back with real pyembroidery.
- [ ] Inspect the comparison montage and reject visual regressions.
- [ ] Record generation time, stitches, jumps, threads, and output size.
