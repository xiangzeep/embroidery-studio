# Adaptive Feature Contours Design

## Goal

Remove visible stair-step jitter from rounded facial outlines without rounding
off intentional sharp details such as mouth corners.

## Design

Each recognized feature-outline group is classified independently from its
binary mask. A compact, convex, sufficiently circular group is treated as a
smooth contour. Concave or angular groups retain their simplified vertices.

Smooth contours use the existing closed-run path with corner preservation
disabled, which applies controlled Chaikin smoothing before equal-distance
resampling. Angular contours keep corner preservation enabled. Both profiles
remain reinforced three-pass running stitches so line weight stays consistent.

The classifier uses geometry only and contains no image- or character-specific
coordinates. It therefore applies to eyes, circular badges, mouth openings,
logos, and similar features in future source images.

## Safety Constraints

- Smoothing must not change the feature mask or feature ownership.
- Smooth and angular profiles must remain separate editable regions.
- Rounded contours must remain closed and retain their overall bounds.
- Sharp asymmetric test contours must retain their original vertices.
- Existing project serialization remains backward compatible.

## Verification

- A pixelated ellipse is classified as smooth and produces a lower-jitter
  closed path.
- A concave polygon is classified as angular and preserves its sharp tips.
- Full unit tests and a PES write/read round trip must pass.
