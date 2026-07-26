# Cross Stitch Task 1 Report

## Commits

- `bd19711 feat: resolve cross stitch boundary diagonals`
- Pending: `fix: alternate tied cross stitch boundary diagonals`

## Changed Files

- `stitch_studio/core/cross_stitch_geometry.py`
  - Added the immutable `CrossStitchCell` specification.
  - Added binary-mask boundary scoring for stable `half` and `half_flipped`
    selection.
  - Added coverage classification: empty and below-threshold cells reject,
    full cells keep their configured method, and partial cells select a half
    direction.
  - Added keyword-only `grid_row` and `grid_col` inputs. Equal directional
    scores require this stable cell identity and resolve by checkerboard parity
    instead of a global `half` bias.
- `tests/test_cross_stitch_geometry.py`
  - Added TDD coverage for the specification, both diagonal directions,
    rotation/mirror direction changes, full cells, below-threshold cells, and
    empty cells.
  - Added horizontal, vertical, and symmetric tie cases; verifies adjacent
    parity alternates, repeat calls remain stable, mirror/rotation preserve a
    tie's assigned direction, and scored diagonal directions remain unchanged.

## TDD Evidence

- RED: `QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest tests.test_cross_stitch_geometry -v`
  failed with `ModuleNotFoundError` for
  `stitch_studio.core.cross_stitch_geometry` before implementation.
- GREEN: the same command passed all 8 geometry tests after implementation.
- Tie-break RED: the expanded geometry suite failed with the expected
  `TypeError` because the pre-fix classifier did not accept `grid_row` and
  `grid_col`.
- Tie-break GREEN: the expanded geometry suite passed all 12 tests after the
  parity resolver was added.

## Verification

- `QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest discover -s tests -v`
  passed: 211 tests, 0 failures, 3 skipped because the optional Patrick
  regression image is unavailable.
- `git diff --check` passed.

## Constraints and Risks

- The resolver is pure mask geometry: it does not receive colors, semantic
  labels, or canvas/character coordinates.
- Tied scores require stable grid row and column identity, then alternate by
  checkerboard parity. This avoids directional bias while keeping repeated
  generation deterministic.
- This task only introduces the resolver. Task 2 must consume the override
  while retaining source occupancy separately from shared-grid ownership.
