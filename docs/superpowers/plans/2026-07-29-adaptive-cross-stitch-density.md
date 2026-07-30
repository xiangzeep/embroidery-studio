# Adaptive Cross-Stitch Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce cross-stitch visual density while preserving readable subject contours and facial details.

**Architecture:** Split each recognized design-color mask into background, subject, and closed-feature zones, then assign 2.6 mm, 2.1 mm, and 1.4 mm grids respectively. Keep all zones in the same thread layer and retain the existing protected running-stitch overlays after the fills.

**Tech Stack:** Python, NumPy, OpenCV, PySide6, unittest.

## Global Constraints

- Do not add a new project file format field.
- Do not create extra physical thread layers for density zones.
- Keep advanced per-region cross-stitch settings editable.
- Preserve protected continuous contour overlays and their export order.

---

### Task 1: Density-Zone Classification

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: `recognition.subject_mask`, `recognition.feature_outline_groups`, and each design-color mask.
- Produces: `ImageEngine._cross_stitch_density_zones(mask, recognition) -> list[tuple[str, np.ndarray, float]]`.

- [ ] **Step 1: Write failing tests**

Add tests that construct a color spanning subject and background plus a closed
eye group, then assert disjoint zones, exact mask coverage, and grid sizes of
2.6 mm, 2.1 mm, and 1.4 mm.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
../../.venv/bin/python -m unittest tests.test_recognition_engine.RecognitionEngineTests.test_cross_stitch_density_zones_preserve_mask_and_use_semantic_grid_sizes
```

Expected: failure because `_cross_stitch_density_zones` does not exist.

- [ ] **Step 3: Implement minimal classifier**

Build closed feature support with `_feature_outline_support_mask`, merge it into
subject support, intersect all masks with the source color mask, and return only
non-empty zones.

- [ ] **Step 4: Run test and verify GREEN**

Run the same command and expect `OK`.

### Task 2: Layer Construction Integration

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: `_cross_stitch_density_zones`.
- Produces: multiple same-layer `Region` objects with zone-specific `cross_pattern_size_mm`.

- [ ] **Step 1: Write failing integration test**

Assert one physical thread layer contains background, subject, and feature fill
regions, and that their union equals the original design-color mask.

- [ ] **Step 2: Run test and verify RED**

Run the named integration test and expect the existing single-region behavior
to fail.

- [ ] **Step 3: Integrate zone regions**

Create one region per non-empty zone only in `cross_stitch` mode, retain design
color metadata, and set the returned grid size on each copied default setting.

- [ ] **Step 4: Run cross-stitch recognition tests**

Run:

```bash
../../.venv/bin/python -m unittest tests.test_recognition_engine
```

Expected: `OK`.

### Task 3: Ordering and Regression Verification

**Files:**
- Modify: `tests/test_recognition_engine.py`
- Modify only if required: `stitch_studio/ui/main_window.py`

**Interfaces:**
- Consumes: density-zone regions and existing protected overlays.
- Produces: generated paths where fills precede continuous semantic outlines.

- [ ] **Step 1: Add ordering assertion**

Extend the synthetic face test to verify every overlay index is greater than
all cross-stitch fill indices in the same layer after density splitting.

- [ ] **Step 2: Run focused generation tests**

Run:

```bash
../../.venv/bin/python -m unittest tests.test_recognition_engine tests.test_export_paths
```

Expected: `OK`.

- [ ] **Step 3: Run full suite and real calibration sample**

Run:

```bash
QT_QPA_PLATFORM=offscreen LOKY_MAX_CPU_COUNT=8 ../../.venv/bin/python -m unittest discover -s tests
```

Then render one real cross-stitch calibration sample and compare stitch count,
edge recall, and generated preview against the current baseline.
