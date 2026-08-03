# Facial Feature Fidelity Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve smooth eye outlines, pointed mouth corners, continuous eyebrows, tongue fills, and pupil highlights from recognition through exported photo-stitch geometry.

**Architecture:** Recognition owns one canonical subpixel path for every confirmed facial outline. Semantic extraction attaches that path to the matching part instead of rebuilding it from a one-pixel mask, and the stitch engine resamples the guide without smoothing it again. Raster masks remain authoritative only for color ownership and preview coverage.

**Tech Stack:** Python, NumPy, OpenCV, scikit-image, unittest, pyembroidery.

## Global Constraints

- Work only in `/Users/zeep/myself/code/other/emb/hf-stitch-studio`.
- Preserve existing project and user changes.
- Write a failing regression test before each production behavior change.
- Keep photo stitch and cross stitch generation paths independent.
- Do not claim universal pixel-perfect embroidery; verify key facial geometry and export round trips.

---

### Task 1: Canonical facial outline guides

**Files:**
- Modify: `stitch_studio/core/semantic_parts.py`
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_recognition_engine.py`

- [x] Add a failing test proving a smooth asymmetric eye and pointed mouth retain their source-space geometry.
- [x] Run the focused test and confirm it fails because recognition exposes only raster masks.
- [x] Add an immutable `FeatureGuide` containing mask, path, locked corner indices, and role.
- [x] Generate the guide once from the source component and rasterize that same guide for preview ownership.
- [x] Run the focused test and confirm it passes.

### Task 2: Semantic guide ownership

**Files:**
- Modify: `stitch_studio/core/semantic_parts.py`
- Modify: `stitch_studio/core/recognition_engine.py`
- Test: `tests/test_semantic_parts.py`

- [x] Add a failing test proving the matching semantic outline consumes the recognition guide.
- [x] Run the focused test and confirm the extractor currently rebuilds the path.
- [x] Match guides to semantic parts by mask overlap and replace only the matching outline path.
- [x] Suppress duplicate generic outline parts covered by an authoritative guide.
- [x] Run the focused test and confirm one canonical outline remains.

### Task 3: Stitch compiler geometry preservation

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_semantic_parts.py`

- [x] Add a failing test proving guide vertices and locked mouth corners survive stitch generation.
- [x] Run the focused test and confirm the path is simplified or smoothed again.
- [x] Pass guide closure and corner metadata through `Region`.
- [x] Resample canonical closed guides without another contour reconstruction.
- [x] Run the focused test and confirm the exported stitch path keeps the eye shape and mouth tips.

### Task 4: Real fixture and export round trip

**Files:**
- Modify: `tests/test_recognition_engine.py`
- Modify: `tests/test_export_roundtrip.py`

- [x] Add Patrick fixture checks for eye geometry, mouth tips, eyebrow continuity, tongue presence, and highlight retention.
- [x] Generate a photo-stitch preview and PES file from `tests/fixtures/patrick-source.png`.
- [x] Reload the PES and verify bounds, colors, facial part coverage, and path continuity.
- [x] Run the focused tests, then the complete suite.
