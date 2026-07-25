# Adaptive Feature Contours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smooth rounded eye outlines while preserving deliberate sharp mouth corners.

**Architecture:** Classify each feature mask as smooth or angular in `ImageEngine`, then assign the existing closed-run generator the appropriate corner-preservation profile. Keep path generation generic and verify behavior from masks and generated stitch paths.

**Tech Stack:** Python, NumPy, OpenCV, unittest, pyembroidery

## Global Constraints

- No character-specific coordinates or colors.
- Rounded outlines remain closed three-pass running stitches.
- Angular outlines retain sharp vertices.
- Existing project files remain compatible.

---

### Task 1: Feature Geometry Classification

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_recognition_engine.py`

**Interfaces:**
- Consumes: a single feature mask as `np.ndarray`
- Produces: `ImageEngine._feature_outline_preserves_corners(mask) -> bool`

- [x] **Step 1: Write failing tests**

Add one pixelated ellipse and one concave polygon test. Assert the ellipse
selects smoothing and the polygon selects corner preservation.

- [x] **Step 2: Verify RED**

Run:
`python -m unittest tests.test_recognition_engine.ThreadSuggestionTests.test_rounded_feature_outline_uses_smoothing tests.test_recognition_engine.ThreadSuggestionTests.test_angular_feature_outline_preserves_corners -v`

Expected: failure because the classifier does not exist and all features
currently preserve corners.

- [x] **Step 3: Implement minimal classifier**

Use contour area, convex hull solidity, circularity, and polygon concavity to
distinguish rounded convex features from angular ones.

- [x] **Step 4: Verify GREEN**

Run the two focused tests and confirm both pass.

### Task 2: Path Smoothness Regression

**Files:**
- Modify: `tests/test_export_paths.py`
- Modify: `stitch_studio/core/stitch_engine.py` only if the existing smooth profile fails

**Interfaces:**
- Consumes: closed run masks plus `StitchSettings`
- Produces: closed paths with lower radial jitter for rounded profiles

- [x] **Step 1: Write failing path-quality test**

Compare a pixelated ellipse's radial variation after removing the intended
ellipse radius trend. Assert the smooth profile has less high-frequency
variation than the corner-preserving profile.

- [x] **Step 2: Verify RED**

Run the focused export-path test and confirm the current eye profile fails.

- [x] **Step 3: Apply the selected profile per feature region**

Pass `run_preserve_corners=False` for rounded groups and `True` for angular
groups while retaining three passes and closed contour tracing.

- [x] **Step 4: Verify GREEN**

Run focused tests, then the complete unittest suite.

### Task 3: Export Round Trip

**Files:**
- No production files unless a regression is found

**Interfaces:**
- Consumes: generated project
- Produces: readable PES with stable bounds and thread count

- [x] **Step 1: Generate a synthetic face project**

Use elliptical eye groups and an angular mouth group.

- [x] **Step 2: Export and read back PES**

Confirm pyembroidery reads the file, stitch bounds are non-empty, and all
expected thread groups remain.

- [x] **Step 3: Run final verification**

Run compileall, complete unittest discovery, and `git diff --check`.
