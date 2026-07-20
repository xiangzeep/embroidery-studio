# Vector Boundary Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pixel-stair mask boundaries with reconstructed vector polygons for preview and stitch generation.

**Architecture:** Keep masks for segmentation and region identity, but add a geometry stage that converts each mask into an embroidery-ready Shapely polygon. Regions store both `mask` and `polygon`; stitch generation and canvas preview use `polygon` when available and fall back to `mask` for hairlines.

**Tech Stack:** Python, NumPy, OpenCV contours, Shapely polygons, PySide canvas, existing unittest suite.

## Global Constraints

- Do not blur or resample source colors to hide jagged edges.
- Preserve acute tips that are present in the artwork.
- Straight long edges must be represented as straight polygon edges, not pixel stairs.
- Preview and stitch generation must consume the same vector geometry whenever possible.

---

### Task 1: Geometry Engine

**Files:**
- Create: `stitch_studio/core/geometry_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces: `GeometryEngine.reconstruct_region_polygon(mask: np.ndarray, compensation_px: float = 0.0) -> Optional[shapely.geometry.Polygon]`

- [ ] Write failing tests for straight stair-step edges and acute corners.
- [ ] Implement contour extraction, polygon simplification, compensation, straight-edge fitting, and curve smoothing.
- [ ] Run targeted geometry tests.

### Task 2: Region Polygon Storage

**Files:**
- Modify: `stitch_studio/core/project.py`
- Modify: `stitch_studio/core/image_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `GeometryEngine.reconstruct_region_polygon(...)`
- Produces: `Region.polygon`

- [ ] Write failing test that `build_layers_from_regions()` attaches a polygon to each area region.
- [ ] Add `polygon` field to `Region`.
- [ ] Populate `region.polygon` during layer construction.
- [ ] Run targeted layer tests.

### Task 3: Polygon-First Stitch And Preview

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py`
- Modify: `stitch_studio/ui/canvas.py`
- Modify: `stitch_studio/ui/main_window.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `Region.polygon`
- Produces: scanline paths and preview overlays generated from polygon geometry.

- [ ] Write failing test proving scanline fills from a stair-step mask use one straight diagonal boundary.
- [ ] Update stitch generation to call polygon-aware scanline logic.
- [ ] Add polygon preview path items for region masks when available.
- [ ] Pass polygon data from `main_window` to `canvas`.
- [ ] Run full test suite.
