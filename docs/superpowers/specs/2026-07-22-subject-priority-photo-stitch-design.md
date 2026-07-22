# Subject-Priority Photo Stitch Design

## Goal

Make photo-stitch output preserve the main subject before spending colors and
stitches on the background. The beginner default must improve the exported
PES without adding required controls.

## Default Policy

- Detect one primary subject using quantized connected components, centrality,
  component size, and border/background evidence.
- Give subject pixels four times the physical-thread selection weight of
  background pixels.
- Keep the total physical-thread limit at the user's existing `Colors` value;
  the default remains 12.
- Simplify background color competition instead of deleting large background
  bands.
- Preserve subject eyes, mouth, pupils, and intentional line art above fills.
- Use satin only for line components that belong to the subject silhouette.
  Internal marks use running stitch so they do not become thick red borders.
- Preview and export use the same matched physical RGB metadata.

## Architecture

### Recognition

`RecognitionEngine` produces a boolean `subject_mask` after design-color
assignment. It selects the strongest central non-background component as the
subject base, then grows through small adjacent components inside the base
bounding area. This includes eyes and mouth while rejecting full-width sea,
sky, and sand components.

Physical-thread selection receives per-design-color subject and background
pixel counts. Subject pixels dominate ranking; background remains represented
but cannot consume most of the limited thread slots.

### Layer Reconstruction

`ImageEngine.build_layers_from_recognition` consumes `subject_mask`. Each
connected line component is evaluated against the subject's morphological
outer boundary:

- silhouette line: satin;
- internal or unsupported line: running stitch;
- broad region: scanline fill.

Antialias fragments remain merged by physical thread and do not create new
outline layers. Existing layer ordering keeps detail layers above broad fills.

### Compatibility

Projects and recognition results created before this change remain valid.
`subject_mask` is optional, and old callers fall back to the current behavior.
Cross stitch is unchanged.

## Quality Gates

For the supplied Patrick regression image:

- subject coverage at least 98%;
- subject boundary recall at least 97%;
- overall perceptual similarity at least 95%;
- no more than the configured 12 physical colors;
- generated PES can be read back with its END command and thread count intact;
- internal arm and facial marks are not classified as satin silhouette borders.

## Out Of Scope

- Neural-network model downloads;
- manual semantic labeling;
- per-body-part pose recognition;
- changing cross-stitch generation.
