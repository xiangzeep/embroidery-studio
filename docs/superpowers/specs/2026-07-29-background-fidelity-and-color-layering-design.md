# Background Fidelity and Color Layering Design

## Goal

Preserve stitchable background content without weakening subject fidelity, while
representing one physical thread as one editable color layer containing ordered
semantic objects. Export should minimize color changes only when doing so does
not change visual overlap.

Pixel-for-pixel identity is not a valid machine-embroidery guarantee because
thread colors, thread width, needle spacing, hoop size, and fabric distortion
are discrete physical constraints. The product guarantee is therefore:

- no supported source object is silently dropped;
- subject edges and facial details receive the highest geometry fidelity;
- background motifs remain visible with lighter coverage;
- identical physical threads share a layer whenever overlap order permits;
- color optimization never moves an object across an overlapping object;
- generation and opacity interaction remain bounded and responsive.

## Product Model

The project uses three related structures:

1. **Physical color layer**: one real thread color and one machine color block
   where possible.
2. **Semantic object**: an editable fill, contour, line, highlight, or protected
   detail stored as a `Region`.
3. **Scene plane**: `background_base`, `background_detail`, `subject_base`, or
   `subject_detail`. The plane controls coverage and ordering, not thread color.

This keeps the beginner UI compact: users see a short list of physical colors
and can expand a color only when they need professional object-level editing.

## Recognition

Color clustering continues to use the full-resolution source image. When
background generation is enabled, physical-thread selection gives background
pixels normal weight rather than the previous strong down-weight. Subject
pixels retain priority, but the optimizer must reserve enough representation
for background colors and detail colors.

Every design-color mask is partitioned by the detected subject envelope without
discarding pixels. Subject and background partitions are complementary, so no
transparent seam is introduced. Background fine lines and compact motifs remain
semantic objects when they have real source support; antialias blends remain
filtered.

## Stitch Strategy

- `subject_base`: dense tatami/scanline fill with underlay where required.
- `subject_detail`: continuous run, reinforced run, satin, or protected compact
  fill based on geometry.
- `background_base`: complete shape geometry with longer stitches and lighter
  coverage to control stitch count.
- `background_detail`: continuous run or compact fill above background bases.
- Cross stitch uses the same planes to choose grid size: subject detail is
  finest, subject base medium, background detail medium, background base coarse.

The background is not replaced with one artificial rectangle. Broad, coherent
color areas form base-plane objects, while bubbles, flowers, coral, and line art
remain separate semantic children.

## Export Sequencing

The exporter groups identical thread colors conservatively:

- consecutive same-thread layers always merge;
- non-consecutive same-thread layers merge only when no intervening drawable
  object overlaps either group;
- overlapping objects keep their original bottom-to-top dependency;
- regions inside a color block are ordered by scene plane and semantic z-order,
  then spatially routed to reduce travel.

This follows the color-block/object distinction used by mature digitizing
software: same color can share a machine stop while objects remain editable.

## Performance

Scene-plane masks are computed with vectorized NumPy/OpenCV operations.
Partitioning does not create one region per connected component. The number of
regions scales with physical colors, four scene planes, and bounded semantic
details. Canvas opacity continues to reuse the cached flattened foreground.

## Verification

Automated tests cover:

- complementary scene-plane masks with no missing pixels;
- background colors retain physical-thread influence when enabled;
- same-thread regions remain one editable color layer;
- background uses lighter fill settings without losing geometry;
- disjoint same-thread blocks merge across another color;
- overlapping same-thread blocks remain separate;
- PES and DST round trips preserve dimensions and thread blocks;
- MSEmb source/target samples generate photo and cross-stitch comparison images;
- full regression suite and generation timing remain within current budgets.

