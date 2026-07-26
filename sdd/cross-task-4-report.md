# Cross Stitch Plan Task 4 Report

## Delivered

- Added `StitchWorker._cross_stitch_work_items()` for cross-stitch fill and
  protected run-overlay jobs.
- Shared `CrossStitchOwnershipContext` instances are built from fill regions
  only. Overlay jobs receive no ownership context and remain independent run
  jobs.
- Normal non-overlay regions retain the existing photo-work-item path, so a
  mixed project continues to generate its ordinary regions after cross fills.
- Export now ranks same-thread region paths so base fill writes before detail
  overlays. Run paths remain non-connectable, so disconnected overlay paths
  are emitted with jumps rather than sewn together.

## TDD Evidence

1. Added focused worker and export-order tests before the production changes.
2. RED: the focused offscreen run failed because `_cross_stitch_work_items`
   did not exist and an overlay inserted before its fill exported first.
3. GREEN: the same focused run passed after adding atomic fill contexts and
   overlay ordering.

## Verification

```text
QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
Ran 247 tests in 1.221s
OK (skipped=3)

git diff --check
```

The three skipped recognition regressions require a supplied external image
that is not present in this worktree.

## Self Review

- Ownership contexts exclude any region marked `is_cross_stitch_overlay`.
- Fill-before-overlay sorting happens after physical-thread grouping, so it
  holds when multiple design layers share one thread.
- Existing cross-stitch spatial-order and checkerboard-plus-normal-run tests
  pass in the full suite.
- The new export regression uses two disconnected overlay paths and asserts
  all three expected jumps, including the two overlay path starts.

## Residual Risk

The overlay role assumes Task 3's invariant that cross-stitch overlays use
`fill_mode="run"`. A manually edited overlay with another fill mode remains
separate from ownership, but will use that selected generator and export
behavior.
