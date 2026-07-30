# Source Vector Semantic Reconstruction Design

## Goal

Preserve source-image geometry through recognition, layer construction, stitch
generation, preview, and export so that smooth curves remain smooth, supported
sharp corners remain sharp, continuous lines do not break at antialiased color
boundaries, and nested subject details are not erased by color reduction.

## Root Causes

The current pipeline extracts semantic components independently from each
quantized design color. A visually continuous antialiased line can therefore be
split into several disconnected masks. Closed semantic parts already contain
ordered vector paths and locked corners, but layer construction only persists
guide paths for open lines. Stitch generation consequently retraces closed
features from raster masks, reintroducing pixel stair steps and discarding the
recognized corners.

Small-detail fallback currently connects the two farthest mask pixels and
repeats that segment. This can create a visible bar that never existed in the
source. Destructive carving and area limits can also remove nested fills such
as tongues, eye highlights, and small enclosed regions.

Canvas antialiasing only changes how existing geometry is displayed. It cannot
repair geometry that was already quantized, fragmented, or retraced.

## Geometry Contract

Recognition must produce source-resolution semantic geometry before physical
thread colors are applied. Every semantic part can carry:

- one or more ordered source-coordinate guide paths;
- whether each guide is open or closed;
- locked corner indices for supported sharp turns;
- hole paths and parent-child ownership;
- source color, matched thread, and visual z-order;
- confidence and stitch intent.

Closed contours must use their recognition-time guide paths directly. They may
fall back to mask tracing only when their guide data is invalid.

## Source Geometry

Semantic geometry is extracted from the source image and the design map
together:

1. Design-map components provide stable region interiors.
2. Source luminance and Lab gradients recover antialiased edge support.
3. Nearby fragments with compatible orientation, color contrast, and endpoint
   distance are grouped into one visual stroke.
4. Subpixel contours are reconstructed at the source resolution.
5. Curvature analysis separates smooth spans from supported corners.

The implementation is generic. It must not contain character names, fixed
coordinates, or source-specific color constants.

## Curve And Corner Rules

- Rounded closed features use subpixel contours and bounded smoothing.
- Sharp corners remain exact anchors and split neighboring smooth spans.
- Smoothing never crosses a locked corner.
- Single-pixel spikes without bilateral support are rejected as noise.
- Open paths preserve endpoints and remain continuous.
- A connected closed path is emitted as one stitch path.

## Layer Ownership

Broad fills remain underneath semantic details. Semantic regions do not carve
holes from same-color or parent fills unless the source explicitly contains a
transparent or differently colored hole.

Nested fills such as tongue, pupil, and highlight retain independent child
regions and z-order. Same-thread children remain separate editable regions
inside one physical thread layer.

## Stitch Compilation

- Thin open guides use one continuous running stitch.
- Wider supported strokes use a bounded satin border.
- Closed contour guides use one continuous adaptive run or narrow satin path.
- Compact areas use dense fill and preserve source support.
- Tiny details without a valid guide are skipped instead of inventing a
  farthest-point bar.
- Cross stitch retains adaptive coarse grids and adds source-vector backstitch
  overlays for important contours and lines.

## Regression Gates

Synthetic fixtures must verify:

- an antialiased line split across design colors becomes one continuous guide;
- a mouth-like closed contour preserves both pointed corners;
- a rounded eye contour has low radial jitter and no invented corners;
- closed semantic guides reach stitch generation without raster retracing;
- a nested tongue remains above the mouth fill;
- an unsupported tiny blob does not become a repeated bar;
- source holes and explicit highlights remain represented;
- photo and cross-stitch exports remain readable and bounded.

Real-image verification must compare recognition, vector guides, generated
stitches, and exported-file readback as separate stages so the first failing
stage is visible.

