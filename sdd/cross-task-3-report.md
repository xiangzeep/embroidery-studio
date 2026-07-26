# Cross Stitch Plan Task 3 Report

## Delivered

- Added persistent `Region.is_cross_stitch_overlay`, including backward-compatible serialization with a `False` default.
- Cross-stitch recognition layers now append same-color `run` overlays after their base cross-stitch fills.
- Overlays are derived only from `detail_mask`, `subject_mask`, `feature_outline_groups`, and each layer's color ownership. No character-specific coordinates or colors are used.
- Semantic outline groups use the existing adaptive closed-contour profile. Thin connected marks use adaptive run settings. Compact pupil/highlight-like details require local contrast and proximity to a semantic outline.
- Isolated background and subject-contained noise are rejected; overlays are constrained to `detail_mask & subject_mask`.

## TDD Evidence

1. Added the overlay construction and serialization tests before implementation.
2. Initial run failed as expected: `Region` rejected `is_cross_stitch_overlay`, and cross-stitch generation returned no overlays.
3. After the first green pass, extended the synthetic offscreen fixture to include a filled pupil and isolated 2x2 noise. It failed until compact semantic detail filtering was implemented.

## Verification

```text
QT_QPA_PLATFORM=offscreen ../../.venv/bin/python -m unittest discover -s tests -v
Ran 241 tests in 0.950s
OK (skipped=3)
```

The three skipped tests require a supplied external regression image that is not present in this worktree. A direct GUI test exits through macOS PasteBoard services without `QT_QPA_PLATFORM=offscreen`; the mandated offscreen run completes successfully.

## Self Review

- Overlay masks cannot extend outside the protected semantic-detail union.
- Base fill regions remain before overlays inside each shared thread/color layer, preserving fill-before-detail stitch order while keeping same-color regions merged.
- Existing adaptive contour behavior remains responsible for preserving supported sharp mouth corners while smoothing rounded eye contours.

## Residual Risk

Compact non-line details intentionally require a nearby semantic outline. This avoids promoting isolated noise, but a valid isolated freckle-like mark far from any recovered feature group will remain cross-stitch fill only.

## Review Follow-up

- Replaced layer-wide color-mask overlay extraction with candidate collection per contributing fill region. Overlay metadata now inherits that region's `design_color_id`, `design_color_rgb`, and thread-match delta.
- Added a protected bright-seed path inside filled semantic outline groups, so real recognition-to-layers processing preserves compact pupil highlights even when the broader white fill is a much larger component.
- Added subject-gated semantic/local-contrast checks for generic thin lines. Background marks outside the subject mask and subject-contained, zero-contrast non-semantic lines are rejected.
- Added image-area-scaled total and per-design-color overlay budgets. Candidates are selected by semantic priority, then area, local contrast, and proximity to the subject center.
- Added offscreen regressions for a complete 96x96 synthetic face with two highlights, 484 thin-mark candidates, shared physical thread design identity, and unsupported/background thin lines.
