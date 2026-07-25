# Local Corner and Cross-Stitch Fidelity Design

## Status

This design supersedes the whole-region contour classification in
`2026-07-25-adaptive-feature-contours-design.md`. A feature is not globally
"smooth" or "angular": a single mouth outline can contain both smooth arcs and
sharp corners.

## Goal

Improve subject fidelity in both photo-stitch and cross-stitch output without
using character-specific coordinates, colors, or templates.

The implementation must:

- smooth rounded eye and face contours without visible stair-step jitter;
- preserve sharp mouth corners, line endpoints, and intentional cusps;
- retain eyes, pupils, highlights, eyebrows, mouth details, and small marks;
- improve cross-stitch boundaries without allowing adjacent colors to overlap;
- keep background detail simpler than subject detail;
- preserve editable color grouping and readable PES/DST output;
- avoid solving fidelity by unbounded color, stitch, or jump growth.

## Root Causes

### Photo Stitch

The current feature classifier assigns one `run_preserve_corners` value to an
entire connected feature. When a mouth contains both curved spans and pointed
corners, the smooth profile rounds off the corners and the corner-preserving
profile retains pixel jitter everywhere.

### Cross Stitch

Cross-stitch recognition currently converts color masks directly to a dominant
color grid. It does not run the semantic feature reconstruction used by photo
stitch, and stitch-method selection is region-wide. Thin facial details can be
discarded by cell ownership, while partially covered boundary cells cannot
choose the diagonal that best matches the source edge.

## Architecture

The work is split into three independent stages:

1. `LocalContourAnalyzer` identifies anchors and smooth spans on a contour.
2. `CrossStitchBoundaryResolver` selects full or directional half stitches for
   owned grid cells.
3. `SemanticDetailOverlayBuilder` converts protected thin details into
   continuous running/backstitch paths placed above the grid or photo fill.

These stages consume masks and geometry metadata. They do not depend on a
specific source image or embroidery file format.

## Local Contour Reconstruction

### Anchor Detection

For every closed feature contour:

1. Remove duplicate and zero-length contour points.
2. Apply light geometric simplification at a physical, scale-aware tolerance.
3. Measure signed turning angle and curvature continuity in a local window.
4. Mark a vertex as a locked anchor when it is a stable high-curvature point,
   a cusp, or the endpoint of a narrow concavity.
5. Merge nearby candidates so one visual corner produces one anchor.

An anchor is accepted only when it is supported by neighboring contour length.
This rejects single-pixel antialias spikes while retaining real mouth corners.

### Segment Processing

The contour is split at locked anchors:

- spans without anchors are smoothed and resampled at uniform stitch spacing;
- locked anchor coordinates are copied exactly into the reconstructed path;
- smoothing never crosses an anchor;
- closure joins the last span to the first without duplicating the seam point.

Rounded eyes usually have no locked anchors and receive a stable smooth
outline. A mouth can keep two pointed corners while its upper and lower arcs
are smoothed independently.

### Compatibility

`run_preserve_corners` remains readable for old projects. New semantic feature
outlines use adaptive local anchors by default. Explicit manual settings can
still request fully smooth or fully vertex-preserving behavior.

## Cross-Stitch Reconstruction

### Shared Grid Ownership

All cross-stitch color masks continue to use one canvas-aligned ownership grid.
Every cell has at most one owning fill color, so adjacent layers cannot overlap.
Color ownership is decided before stitch-template selection.

### Boundary Cells

Each owned cell is sampled on a subcell occupancy grid:

- high coverage emits the selected full-cell method;
- partial coverage compares both half-stitch diagonals against the source mask;
- the diagonal with lower occupancy error is selected;
- cells below the stitchability threshold are omitted unless protected by
  semantic detail metadata.

This improves diagonal and curved boundaries without globally shrinking the
grid or multiplying stitch count.

### Semantic Detail Overlay

Cross-stitch mode is allowed to use a small running/backstitch overlay for
details that cannot be represented reliably by the base grid:

- eyebrows and short facial marks;
- eye and mouth outlines;
- sharp mouth corners;
- pupil highlights;
- connected decorative dots and thin lines.

The overlay reuses the semantic masks produced during recognition. Open lines
are centerlined, pruned, and emitted as separate continuous paths. Closed
outlines use the local contour reconstruction described above. Disconnected
details remain separate paths and are connected by jump commands, never visible
travel stitches.

The overlay is generated after cross-stitch fills so important lines remain
visible. It uses existing thread colors where possible and does not create a
new color for every component.

### Subject Priority

Subject and protected-feature masks receive stronger retention than background
masks. Background cells still use the shared grid and normal cleanup rules.
Isolated background specks are removed, while connected high-contrast subject
details can survive at smaller physical sizes.

## Layering and Color Grouping

Regions with the same thread color remain grouped under one color layer.
Within that layer, fill, boundary, and semantic detail regions remain separate
editable children. Export may reorder paths spatially within one color block,
but must not change visual stacking:

1. background fills;
2. subject fills;
3. cross-stitch or photo-fill boundaries;
4. protected facial and line-detail overlays.

This preserves editability without producing unnecessary thread changes.

## Data Flow

1. Recognition produces quantized color masks and protected semantic masks.
2. Cleanup removes unsupported specks but excludes protected details.
3. Photo-stitch mode sends closed details through local contour reconstruction
   and open details through centerline reconstruction.
4. Cross-stitch mode builds shared cell ownership, resolves each boundary
   template, then adds the semantic detail overlay.
5. Layer grouping preserves one thread-color parent with separate child
   regions.
6. Export validates coordinates, bounds, color blocks, jumps, and round-trip
   readability before reporting success.

## Error and Performance Constraints

- Degenerate contours with fewer than three useful points fall back to the
  existing safe running-stitch path.
- If no stable anchor is found, the contour is treated as a smooth closed
  curve; no synthetic corner is invented.
- Boundary occupancy is computed only for partial cells near mask edges.
- Semantic overlays reuse recognition results and do not rerun quantization.
- The UI worker remains cancellable and performs no per-stitch scene updates
  during generation.
- Stitch, jump, and color counts are checked against existing export safety
  limits.

## Verification

### Local Geometry

- A synthetic contour containing an ellipse-like arc and two pointed mouth
  corners retains both corner coordinates while reducing arc jitter.
- A rounded eye outline remains closed, smooth, and within a small bound error.
- A one-pixel antialias spike does not become a locked corner.
- Open detail paths contain no accidental branch connectors.

### Cross Stitch

- A partial diagonal boundary chooses `half` or `half_flipped` according to
  subcell occupancy.
- Full interior cells continue to use the configured full-cell method.
- Adjacent color ownership masks remain non-overlapping.
- A connected eyebrow and sharp mouth corner survive as final detail paths.
- Isolated background noise is removed.
- Subject-detail retention improves without exceeding configured color limits.

### Export and Regression

- PES and DST output can be read back successfully.
- Read-back bounds and color-block order match the generated pattern within
  format tolerance.
- The complete unit-test suite passes.
- A representative subject image is generated in photo-stitch and cross-stitch
  modes; previews verify smooth eyes, pointed mouth corners, retained eyebrows,
  pupil highlights, and connected small marks.
- Generation time, stitch count, and jump count are compared with the current
  baseline and must not grow without a documented reason.

## Non-Goals

- No character-specific face detector or hard-coded Patrick Star geometry.
- No unrestricted tracing of every source pixel.
- No full Bezier-vector editor.
- No global grid-size reduction as the primary fidelity mechanism.
- No guarantee that pure cross stitches alone can reproduce subcell line art;
  protected running/backstitch overlays are part of cross-stitch fidelity mode.
