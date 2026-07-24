# Semantic Detail Reconstruction Design

## Goal

Improve photo-stitch reconstruction of small, high-value visual details without
adding noise or image-specific rules. The generated embroidery must preserve:

- continuous open line art without branches or dirty connector stitches;
- sharp corners in closed facial features;
- nested eye structure, including sclera, pupil, and tiny highlights;
- small high-contrast marks that are stitchable as running stitches.

## Classification

The recognition output will distinguish four detail classes:

1. Closed feature contours, such as eye and mouth outlines.
2. Open line details, such as the line below a mouth and short facial marks.
3. Compact fills, such as pupils.
4. Protected highlights, such as a small white reflection inside a pupil.

Each class keeps its own mask and stitch intent until layer construction. This
prevents cleanup and color merging from flattening nested details into one mask.

## Geometry Rules

Closed contours use curvature-aware simplification. High-curvature vertices are
kept as anchors, while only low-curvature spans are smoothed. This preserves
sharp mouth corners and still removes pixel stair-stepping.

Open lines use a centerline graph. Short side branches are removed when they do
not carry significant source contrast. Nearby endpoints are bridged only when
their direction, color, and gap agree. Separate marks remain separate paths and
therefore use jump movement rather than visible connector stitches.

Compact fills are regularized using their dominant connected component. Small
holes and edge noise are repaired without changing the component's center or
overall dimensions.

## Eye Hierarchy

Eye reconstruction is layered in this order:

1. sclera fill;
2. pupil fill;
3. protected highlight fill or short running stitch;
4. outer eye contour.

Highlights are detected as small light components enclosed by a dark pupil.
They bypass generic speck cleanup. Pupils are normalized independently so one
eye cannot absorb or distort the other.

## Tiny Detail Retention

Small components are retained when they meet a stitchability score based on:

- source contrast;
- compactness or line elongation;
- distance from quantization boundaries;
- minimum physical stitch length.

Low-contrast isolated antialias fragments are removed. High-contrast dots and
short marks are converted to independent running-stitch paths.

## Compatibility

The existing layer and export model remains unchanged. New semantic masks and
geometry flags are optional, so projects created by older versions continue to
load. Photo stitch uses the new rules; cross stitch behavior is unaffected.

## Verification

Automated tests will cover:

- a broken open line repaired into one branch-free path;
- disconnected marks exported as separate paths;
- asymmetric sharp mouth corners surviving contour generation;
- two uniform pupils with independent highlights;
- real tiny marks retained while nearby antialias noise is removed;
- PES export readability and stable design bounds.

The Patrick source image will then be processed end to end. The generated preview
and PES will be checked for the four reported details and compared with the
recognized image before the full test suite runs.
