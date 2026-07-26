# Cross Stitch Task 2 Report

## Scope

- Thread the unmodified region mask through cross-stitch fill dispatch while
  retaining the prepared ownership mask for cell allocation.
- Classify each owned cell from its source occupancy and apply `half` or
  `half_flipped` only at boundaries.
- Preserve configured region methods for source-full cells.
- Keep the legacy `_cross_stitch_cells(mask, settings)` bounds API available.

## TDD Evidence

The new owned-boundary tests were added before the implementation. Their first
run failed because `_cross_stitch_cell_specs` did not exist and generated paths
still emitted a complete cross. A second red/green cycle caught isolated-source
noise being restored as a full cross. A third cycle caught tie-break parity
being calculated from region-local rather than global aligned-grid coordinates.

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

## Verification

```text
../../.venv/bin/python -m compileall -q stitch_studio tests
QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Result: 217 tests passed; 3 skipped. The suite retains pre-existing Qt mouse
event deprecation, font-alias, and joblib physical-core discovery warnings.

## Residual Risk

`dense_upright` keeps its established offset pass. The primary owned boundary
cell now uses its half-stitch override, while the existing dense offset behavior
remains unchanged.
