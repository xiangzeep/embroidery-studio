# Cross Stitch Task 2 Report

## Scope

- Thread the unmodified region mask through cross-stitch fill dispatch while
  retaining the prepared ownership mask for cell allocation.
- Classify each owned cell from its source occupancy and apply `half` or
  `half_flipped` only at boundaries.
- Preserve configured region methods for source-full cells.
- Keep the legacy `_cross_stitch_cells(mask, settings)` bounds API available.
- Carry explicit shared-ownership context instead of inferring it from mask
  contents, and allocate dense shifted-grid cells globally.
- Preserve the ownership builder's grid origin and treat its masks as immutable
  occupancy during shared cross-stitch generation.

## TDD Evidence

The new owned-boundary tests were added before the implementation. Their first
run failed because `_cross_stitch_cell_specs` did not exist and generated paths
still emitted a complete cross. A second red/green cycle caught isolated-source
noise being restored as a full cross. A third cycle caught tie-break parity
being calculated from region-local rather than global aligned-grid coordinates.
A review-fix cycle added explicit ownership context, dense shifted-grid
ownership, unaligned offset-origin, Worker propagation, and final-path tests.
A final review cycle added Worker-level tests for the single-region coverage
rule, shared non-aligned origins, and checkerboard path uniqueness.

## Implementation

- Added `_iter_cross_grid_cells()` so ownership and source masks use identical
  rounded grid slices, including fractional boundaries.
- Added `_cross_stitch_cell_specs(ownership_mask, source_mask, settings)` which
  returns `CrossStitchCell` instances with source coverage and method overrides.
- Passed global grid row and column coordinates to `classify_cross_stitch_cell`.
- Routed `generate_region_paths(..., mask_override=...)` with the original
  source mask into cross-stitch generation, so shared ownership never erases
  boundary direction.
- Limited low-coverage fallback to genuinely shared ownership. The legacy
  single-mask path continues to filter isolated noise and honor the configured
  coverage threshold.
- Replaced prepared/raw full-image mask comparison with the explicit
  `cross_ownership_override` context propagated by `StitchWorker`.
- Added `dense_mask_override`, built once from the globally shifted grid in
  `StitchWorker`. Dense secondary upright paths use this unique allocation and
  only source-full-classified cells, so they cannot duplicate an adjacent color
  or cancel a boundary half stitch.
- Kept unaligned-grid offsets relative to the mask origin and covered the
  single-application contract with an exact cell-origin test.
- Verified connected one-pixel detail and isolated noise through
  `generate_region_paths`, not only ownership-mask inspection.
- Shared ownership is now enabled only for compatible multi-region jobs. A
  single cross-stitch region does not build an ownership mask and still rejects
  low-coverage cells normally.
- `CrossStitchOwnershipMasks` carries the builder origin as metadata without
  copying mask arrays. The iterator consumes this explicit origin, avoiding a
  second offset application for non-aligned shared grids.
- Immutable ownership masks bypass morphology and only undergo binary
  normalization, preventing neighboring checkerboard cells from expanding into
  duplicate final stitch paths.

## Verification

```text
../../.venv/bin/python -m compileall -q stitch_studio tests
QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Result: 228 tests passed; 3 skipped. The suite retains pre-existing Qt mouse
event deprecation, font-alias, and joblib physical-core discovery warnings.

## Residual Risk

Mixed-grid cross-stitch jobs intentionally use normal per-region generation;
they do not claim shared-cell exclusivity. Dense ownership metadata adds only a
small mapping object and reuses the existing full-size ownership masks.
