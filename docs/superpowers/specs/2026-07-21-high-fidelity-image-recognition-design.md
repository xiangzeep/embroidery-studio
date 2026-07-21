# High-Fidelity Image Recognition Design

## Goal

Replace the destructive thread-first quantization pipeline with a local,
edge-aware recognition pipeline that preserves at least 95% of meaningful
color and fine-line information before embroidery stitches are generated.

The 95% target is measured automatically on fixed regression fixtures. It is
not a claim that a limited physical thread set can reproduce every source
pixel exactly. Recognition fidelity and physical thread matching are measured
and reported separately.

## Root Cause

The current pipeline clusters source pixels, immediately maps every cluster to
the owned thread library, and then groups regions by the mapped thread index.
Several visually different clusters can map to the same thread and collapse
into one layer. Small-region merging and morphology then remove additional
boundaries. On the Patrick fixture, 18 requested clusters become 10 preview
layers; the reconstructed regional preview has about 0.74 SSIM and 0.68
one-pixel edge recall.

Fine-detail detection currently edits the same fill map. That makes a single
threshold responsible for two incompatible jobs: preserving thin marks and
preventing large boundaries from fragmenting. Repeated threshold changes
therefore trade one failure for another.

## Options Considered

### 1. Stronger global K-Means

Increase cluster count and adjust detail thresholds. This is the smallest
change, but global clustering still under-represents rare colors and thin
lines. It cannot prevent different clusters from collapsing when mapped to the
thread inventory.

### 2. Pure superpixel segmentation

Use SLIC-style superpixels and merge them by color. This preserves local
boundaries, but creates many tiny regions, increases stitch jumps, and makes
beginner output difficult to manage.

### 3. Dual-layer recognition (selected)

Create an image-derived design palette for broad color regions and a separate
detail layer for thin marks. Match design colors to physical threads only
after recognition. This preserves the visual structure while keeping the
result editable and physically explainable.

## Architecture

### Design Palette

Add a recognition result containing stable design-color IDs, representative
RGB/LAB values, pixel counts, and nearest physical-thread suggestions. The
region map stores design-color IDs rather than owned-thread indices.

Palette extraction uses edge- and rarity-aware LAB sampling. Broad areas are
represented by normal pixel samples. Rare colors and pixels near meaningful
edges receive extra sampling weight so they cannot disappear merely because
they occupy a small percentage of the image. Cluster centers remain distinct
unless their perceptual distance and spatial role are both equivalent.

The default beginner preset selects a practical color budget automatically
from image complexity. Professional controls may override it up to 128 design
colors. Design colors are analysis classes, not mandatory physical thread
changes: the UI displays the number of design colors and the number of unique
physical threads separately.

### Region Layer

Segment connected components from the design-color map. Edge-aware cleanup
may close one-pixel holes inside a region but must not bridge across detected
source edges. Region filtering uses physical output size as well as source
pixel area, so a visible line is not discarded solely because the imported
image is small.

Background inclusion remains an explicit beginner-facing switch. Background
detection changes only whether border-connected background regions are
included; it never changes foreground color recognition.

### Detail Layer

Detect fine marks independently with multi-scale color contrast, luminance
ridges, and source-edge continuity. Components are classified by geometric
width and continuity instead of a single area threshold. Large object borders
are excluded from the detail layer but remain boundaries of their fill
regions.

Each accepted detail component retains its local source color and becomes a
topmost run-stitch or narrow satin region in photo-stitch mode. Cross-stitch
mode converts the same detail evidence into smaller or denser cells without
changing the base recognition result.

### Thread Matching

Recognition never collapses design colors to the owned thread list. After the
design palette is complete, each design color receives:

- nearest owned-thread ID;
- CIEDE2000 color difference;
- an exact design preview color;
- a warning when the available thread match exceeds the accepted difference.

Stitch generation uses the selected physical thread while the preparation
preview can switch between exact design colors and physical-thread simulation.

### Performance and Stability

The worker remains off the UI thread. Recognition stages use NumPy/OpenCV
vectorized operations and bounded-memory chunks. Clustering uses all safe local
CPU capacity through the existing worker process without creating nested Qt
threads. Every stage reports progress and supports cancellation between
stages. Large imports retain a high-resolution analysis image while using a
downscaled display image; the analysis budget is bounded to prevent crashes.

## Beginner Workflow

The default left-panel workflow remains four steps:

1. Import and adjust the image.
2. Choose photo stitch or cross stitch.
3. Choose whether to stitch the background.
4. Click the single preparation button.

High-fidelity recognition and detail preservation are enabled by default.
Advanced controls expose the design-color budget, detail sensitivity, minimum
physical feature size, smoothing strength, and preview mode. No advanced
setting is required for a normal first result.

## Acceptance Metrics

Regression fixtures include flat artwork with close colors, one- and two-pixel
colored lines, dark antialiased outlines, gradients, border-connected
backgrounds, and the supplied Patrick image.

The recognition stage must satisfy all of the following:

- meaningful boundary recall at one-pixel tolerance: at least 0.95;
- fine-detail component recall: at least 0.95;
- source-pixel assignment coverage: at least 0.995;
- normalized perceptual color similarity: at least 0.95;
- no large source boundary promoted to a standalone fine-detail component;
- deterministic output for the same image and settings;
- existing background-on and background-off behavior remains covered;
- the full unit-test suite remains green.

Perceptual similarity is computed from CIEDE2000 as
`mean(exp(-delta_e / 20))`. It evaluates recognition colors before physical
thread substitution. Thread simulation reports its own mean and 95th
percentile color difference and is not allowed to silently replace the design
preview.

SSIM and edge precision are recorded as diagnostic metrics but are not the sole
gate because thread-count-limited artwork deliberately posterizes gradients.

## Error Handling

Recognition returns a structured error if the image is empty, the design-color
budget is invalid, or no thread inventory is available for final matching.
Running out of memory must not terminate the application: the worker retries
once with a reduced analysis scale and reports that fallback in the status bar.
No partially generated layers replace the current project when a stage fails.

## Testing Strategy

Unit tests cover weighted palette extraction, stable design-color IDs, close
color separation, edge-aware region cleanup, detail classification, thread
suggestion, and metric calculations. Integration tests run the complete
recognition pipeline on compact deterministic fixtures and the supplied
Patrick image when the fixture is present locally. UI tests verify beginner
defaults and advanced-control persistence. Existing stitch and export tests
guard photo-stitch and cross-stitch behavior after the new recognition result
is converted into project layers.
