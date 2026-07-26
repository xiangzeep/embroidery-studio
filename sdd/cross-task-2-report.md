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
- Rebuild the same context for Worker, resize, boundary-edit, and direct
  single-region regeneration paths when a compatible shared grid exists.
- Keep shared cross ownership active when unrelated non-cross regions are
  present, while separating incompatible cross-grid configurations.
- Resize a layer atomically: update every polygon/mask first, then build the
  final compatible contexts once and regenerate the entire layer.
- Preserve legacy stitch-path fallback resizing for regions without a polygon.

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
The final cycle began red with no atomic context API and a local regeneration
path that generated each checkerboard color independently. It added explicit
missing-base-origin, missing-dense-origin, direct-regeneration, and
resize/boundary regeneration tests before the implementation.
The final review cycle added four red tests for runtime `auto` dense selection,
read-only ownership storage, a checkerboard alongside a run region, and edited
polygon rasterization with final path bounds. They exposed the missing dense
allocation, all-region Worker gating, mutable context inputs, and stale masks.
The final atomic-resize cycle first compared adjacent cross-region resize output
with a manual all-masks-updated unified generation baseline. The sequential
implementation failed because its first region was generated against the
second region's old mask. A run-layer regression confirms non-cross generation
still occurs in phase two.
The Important regression cycle added a no-polygon layer-resize test first. It
failed because the atomic phase two regenerated the fallback region and erased
its existing path. The fix keeps polygon and fallback regions in separate
phase-one collections, then verifies the legacy `scale_stitches` result and
zero regeneration calls for the fallback path.

## Implementation

- Added `_iter_cross_grid_cells()` so ownership and source masks use identical
  rounded grid slices, including fractional boundaries.
- Added `_cross_stitch_cell_specs(ownership_mask, source_mask, settings)` which
  returns `CrossStitchCell` instances with source coverage and method overrides.
- Passed global grid row and column coordinates to `classify_cross_stitch_cell`.
- Added `CrossStitchOwnershipContext`, an immutable atomic carrier for base
  masks/origin, optional dense masks/origin, and the shared-ownership flag.
  `generate_region_paths(..., ownership_context=context)` is now the only
  ownership API; ordinary direct calls without a context retain their existing
  mask and coverage behavior.
- A context cannot be combined with `mask_override`. Context masks are only
  binary-normalized, while the original region mask remains the source for
  boundary direction and `half` / `half_flipped` classification.
- Limited low-coverage fallback to genuinely shared ownership. The legacy
  single-mask path continues to filter isolated noise and honor the configured
  coverage threshold.
- `StitchWorker` constructs the context once and passes it to every compatible
  region. The `MainWindow` rebuilds it for resize, boundary-edit, and direct
  regeneration. Single-region Worker jobs deliberately receive no context.
- The context factory rejects builder mappings that lack base or dense
  `grid_origin_px` metadata with an explicit `ValueError`; it does not silently
  infer an origin from a mask or fall back through `getattr`.
- Dense ownership is built once from the globally shifted grid and stored in
  the same context. Dense secondary upright paths use this unique allocation
  and only source-full-classified cells, so they cannot duplicate an adjacent
  color or cancel a boundary half stitch. A dense method with a context but no
  dense mapping now fails explicitly instead of falling back to the base mask.
- Every compatible shared group now prebuilds dense ownership, including
  `cross_method="auto"` groups where the dense method is only resolved during
  generation. Non-cross regions are excluded from grouping, and cross regions
  are grouped by mask shape plus grid size/alignment/offset before assignment.
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
- Context ownership masks bypass morphology and only undergo binary
  normalization, preventing neighboring checkerboard cells from expanding into
  duplicate final stitch paths. The context reuses the builder's arrays,
  marks them non-writeable, and exposes only `MappingProxyType` mappings, so it
  does not add full-size mask copies or allow Worker threads to mutate them.
- Resize and boundary edit now rasterize the resulting polygon back to the
  region mask before regenerating ownership. Rasterization uses pixel-center
  coverage, so old mask pixels and stitch paths cannot remain outside the new
  boundary.
- Layer resize now has two phases: it transforms and rasterizes every editable
  polygon region without generation, while collecting no-polygon fallback
  regions separately. It builds ownership contexts once from the completed
  project state and regenerates only polygon regions with those stable contexts;
  fallback regions retain the legacy `scale_stitches(sx, origin=old_min)`
  behavior. This prevents stale shared-cell paths at adjacent resized edges
  without changing the existing fallback semantics.

## Verification

```text
../../.venv/bin/python -m compileall -q stitch_studio tests
QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Focused TDD results: atomic adjacent-cross resize, run-layer resize, the new
no-polygon fallback resize regression, and two existing resize/context
regressions passed. Full offscreen result: 239 tests passed; 3 skipped. The
suite retains pre-existing Qt mouse event deprecation, font-alias, and joblib
physical-core discovery warnings.

## Residual Risk

Single-region cross-stitch jobs intentionally use normal per-region generation;
they do not claim shared-cell exclusivity. Prebuilding dense ownership for an
`auto`-safe shared group retains one additional full-size assignment mask set;
the context does not make another copy of either assignment. Polygon
rasterization allocates temporary index arrays only while an edit is applied.
