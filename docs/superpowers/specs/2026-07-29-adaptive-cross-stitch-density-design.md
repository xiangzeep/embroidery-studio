# Adaptive Cross-Stitch Density Design

## Goal

Make cross-stitch output easier to read by reducing visual grid density without
losing the subject silhouette, facial features, or important fine lines.

## Approved Approach

Use three automatic density zones while preserving one editable region per zone:

- Background color blocks use a 2.6 mm cross-stitch grid.
- Subject color blocks use a reduced-density 2.1 mm grid.
- Closed facial-feature interiors use a 1.4 mm grid.
- Protected contours, eyebrows, highlights, mouth corners, and other supported
  fine details remain independent continuous running-stitch overlays.

This is deliberately not a global density reduction. A global larger grid makes
small eyes and mouth corners disappear. A global smaller grid recreates the
current visual problem where the grid overwhelms the silhouette.

## Segmentation

For each recognized design color, split its mask into disjoint background,
subject, and feature-interior masks. Feature interiors are reconstructed from
the already recognized closed feature-outline groups. Subject support includes
those interiors so eyes are not incorrectly treated as background holes.

Empty zones are omitted. All zones remain in the same physical thread layer so
the layer tree and export color changes do not grow.

## Stitch Ordering

Cross-stitch fills are generated first. Protected continuous overlays remain
after all same-color fills, preserving readable eyes, mouth corners, eyebrows,
highlights, and silhouette transitions.

## Compatibility

The density zones only affect automatically generated cross-stitch projects.
Professional users can still edit each region's cross-pattern size and stitch
settings in the existing properties panel. Project serialization requires no
new format fields because each zone stores its effective settings on its region.

## Verification

Automated tests must prove:

1. One source color can produce disjoint background and subject regions without
   creating another thread layer.
2. Background regions use a larger grid than subject regions.
3. Feature interiors use a smaller grid than the subject.
4. The union of zone masks equals the original color mask.
5. Protected contour overlays remain after cross-stitch fills.
6. The full test suite and a real cross-stitch calibration sample still export.
