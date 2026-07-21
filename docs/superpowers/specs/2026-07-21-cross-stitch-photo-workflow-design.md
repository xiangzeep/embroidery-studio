# Cross Stitch Photo Workflow Design

## Goal

Add a practical image-to-stitch workflow that lets the user choose between cross-stitch generation and photo-stitch generation after image adjustment and color processing. Cross-stitch mode should follow Ink/Stitch's grid-and-coverage model while adding automatic stitch-method selection to improve photo restoration.

## Background

Ink/Stitch's cross-stitch documentation describes cross stitch as a grid-aligned fill: each grid cell is evaluated against the fill shape, and a stitch is built when the covered area passes a coverage threshold. Its implementation also treats crosses as connected graph geometry so stitch-out order can reduce jumps and preserve the intended layer order of each cross.

The current project already has image import, image adjustment, color quantization, segmentation into thread-color layers, mask preview, region/layer properties, and embroidery export. It also already exposes `cross_stitch` as a fill mode, but the current generator is a simple fixed X grid that checks only one mask pixel per cell. It does not support coverage, grid alignment, offsets, flipped variants, or the six cross-stitch method families from Ink/Stitch.

## User Workflow

The standard workflow becomes:

1. Import an image.
2. Adjust brightness, contrast, saturation, sharpness, blur, and output size.
3. Quantize colors into thread layers.
4. Choose the generation target: `Cross Stitch` or `Photo Stitch`.
5. Preview and tune the selected mode.
6. Generate stitches and export.

The choice between cross stitch and photo stitch should happen after color processing, because the user needs to see the reduced palette and segmentation before deciding whether the piece should look grid-based or continuous.

## Modes

### Cross Stitch

Cross Stitch mode is for chart-like embroidery, pixel art, logos, simplified photos, and designs where a regular textile grid is desirable. It uses:

- A physical pattern size in millimeters.
- A coverage threshold for deciding whether a grid cell receives stitches.
- Optional grid alignment with the canvas.
- Optional grid X/Y offsets.
- A cross-stitch method, either chosen manually or selected automatically per region.

### Photo Stitch

Photo Stitch mode keeps the current continuous-fill behavior. It uses the existing scanline, contour, flow-guided, satin, radial, spiral, stipple, and run modes. This mode is for smoother gradients, painterly fills, and detail preservation where a blocky grid would harm likeness.

## Cross-Stitch Methods

The UI should expose the six Ink/Stitch method families in user-friendly language while storing stable internal method IDs.

- `cross` and `cross_flipped`: Classic X stitches. Default for most regions.
- `half` and `half_flipped`: One diagonal only. Use for highlights, soft transitions, low-density areas, and antialias-style edge cells.
- `upright` and `upright_flipped`: Horizontal/vertical upright cross. Use for typography, architectural details, and regions with strong orthogonal image structure.
- `dense_upright` and `dense_upright_flipped`: Upright crosses on both the normal grid and a half-cell offset. Use for high-detail photo regions where likeness matters more than lower stitch count.
- `double_cross` and `upright_double_cross`: Diagonal cross plus upright cross, with upright stitches below the diagonal cross. Use for saturated, dark, or important foreground areas that need stronger coverage.
- `smyrna` and `upright_smyrna`: Diagonal cross plus upright cross, with upright stitches on top. Use sparingly for focal details, hard accents, and selected high-contrast edges.

## Automatic Method Selection

Automatic selection should be deterministic and based on region/image measurements so users can trust regeneration.

For each region, compute:

- Median luminance and chroma from source pixels under the region mask.
- Local image contrast from grayscale gradients.
- Region area and bounding-box aspect ratio.
- Edge orientation dominance: diagonal, horizontal/vertical, or mixed.
- Whether the region is likely background, foreground fill, highlight, shadow, or small detail.

Recommended mapping:

- Large low-contrast regions: `cross`.
- Light low-chroma or highlight regions: `half`.
- Strong horizontal/vertical orientation: `upright`.
- High local contrast with moderate area: `dense_upright`.
- Dark or high-saturation foreground regions: `double_cross`.
- Very small high-contrast focal details: `smyrna`.

The automatic selector should include a `cross_detail_boost` setting from 0 to 1. Higher values should shift more regions toward dense, double, or Smyrna methods. Lower values should favor classic cross and half stitch to reduce stitch count.

## Grid And Coverage

Cross-stitch generation should operate in image pixel space first, then convert to pyembroidery scene units at the end, matching the existing `StitchEngine` pattern.

For each region:

1. Convert `cross_pattern_size_mm` to pixel cell size using `px_per_mm`.
2. Determine the grid origin:
   - If `cross_align_grid` is true, use project/canvas origin plus grid offsets.
   - If false, align to the region bounds plus grid offsets.
3. Iterate candidate cells intersecting the mask bounds.
4. Measure coverage as the percentage of mask pixels covered inside the cell.
5. Generate the cell only when coverage is at least `cross_coverage`.
6. For edge cells with partial coverage near the threshold, allow `half` in automatic mode to soften boundaries when the region is light or transitional.

This model keeps adjacent regions aligned when desired and makes the result stable when users move or edit regions.

## Stitch Geometry

Each grid cell should emit one or more separated stitch paths. The first implementation can use local cell templates instead of fully porting Ink/Stitch's graph/Eulerian optimizer.

Cell points:

- Corners: top-left, top-right, bottom-right, bottom-left.
- Middles: middle-left, middle-top, middle-right, middle-bottom.
- Center.

Templates:

- `cross`: two diagonals.
- `half`: one diagonal.
- `upright`: horizontal plus vertical.
- `dense_upright`: upright cells on the normal grid plus a half-cell offset pass.
- `double_cross`: upright plus diagonal, upright below.
- `smyrna`: diagonal plus upright, upright above.

Flipped variants swap the diagonal direction or stitch layer order. All generated paths must respect `stitch_length_max_mm` by segmentizing long lines.

## Path Ordering

The first implementation should order cells by rows with boustrophedon traversal, grouped by region and thread layer. This is simpler than Ink/Stitch's full graph algorithm and fits the project's current path model.

Within a region:

- Traverse row by row.
- Alternate left-to-right and right-to-left per row.
- Keep cell templates as short paths to preserve preview clarity.
- Avoid joining cells across empty gaps.

A later optimization can add graph-based routing inspired by Ink/Stitch to reduce jumps for large cross-stitch charts.

## UI Design

The Image panel should gain a compact generation target section near color quantization:

- A segmented choice: `Photo Stitch` and `Cross Stitch`.
- Cross-stitch controls shown only when Cross Stitch is selected:
  - Preset: `Classic`, `Soft Photo`, `Detailed Photo`, `Bold Coverage`.
  - Method: `Auto`, then the six method families.
  - Pattern size in mm.
  - Coverage percentage.
  - Detail boost.
  - Align grid with canvas.
  - Grid offset X/Y.

The Properties panel should expose per-layer or per-region cross-stitch settings only when `fill_mode` is `cross_stitch`.

The Layers panel should continue to show fill mode and stitch counts. No new panel is required.

## Data Model

Extend `StitchSettings` with:

- `cross_method: str = "auto"`
- `cross_pattern_size_mm: float = 2.0`
- `cross_coverage: float = 0.5`
- `cross_align_grid: bool = True`
- `cross_grid_offset_x_mm: float = 0.0`
- `cross_grid_offset_y_mm: float = 0.0`
- `cross_detail_boost: float = 0.5`

Extend `Project` with:

- `generation_mode: str = "photo_stitch"`

Serialization remains backward-compatible because `from_dict` ignores unknown fields and fills missing dataclass defaults.

## Integration Points

- `stitch_studio/core/project.py`: add generation and cross-stitch settings.
- `stitch_studio/core/image_engine.py`: set default region stitch settings based on `Project.generation_mode` or a mode argument.
- `stitch_studio/core/stitch_engine.py`: replace `_generate_cross_stitch_fill` with a coverage-based path generator and automatic method selector.
- `stitch_studio/ui/panels.py`: add generation target and cross-stitch controls.
- `stitch_studio/ui/main_window.py`: read the selected generation target before building layers, apply cross-stitch defaults, and keep stitch generation unchanged.
- `tests/test_export_paths.py`: add focused tests for settings serialization, grid coverage, method templates, auto selection, and UI settings propagation where practical.

## Error Handling

- If pattern size is too small for the output size, clamp to a safe minimum and show a status message.
- If coverage produces no stitches for a visible region, keep the region but report zero stitches rather than crashing.
- If automatic method selection lacks source image data, default to `cross`.
- If grid offsets are invalid, treat them as `0.0`.

## Testing

Tests should prove:

- Cross-stitch settings serialize and load with defaults.
- A filled square mask generates stitches only for cells meeting coverage.
- Increasing coverage reduces or preserves the number of generated cells.
- `half`, `cross`, `upright`, `double_cross`, and `smyrna` emit distinct geometry.
- Auto method selection chooses half for light low-detail regions, upright for orthogonal texture, and double/Smyrna for high-contrast detail.
- Cross-stitch mode applies cross-stitch defaults during layer building while photo-stitch mode keeps current defaults.

## Non-Goals

- Do not fully port Ink/Stitch's GPL implementation into this project.
- Do not add a full cross-stitch chart editor in the first pass.
- Do not replace existing photo-stitch fill modes.
- Do not implement graph/Eulerian path optimization in the first pass.

## Open Design Decisions Resolved

- The first implementation favors stable user-facing behavior over perfect stitch-route optimization.
- Cross-stitch and photo-stitch are generation targets, not merely fill modes.
- Automatic method selection is region-based in the first pass, with possible cell-level refinement later.
