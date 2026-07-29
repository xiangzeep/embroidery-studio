# Semantic Vector Pipeline Design

## Goal

Replace the current collection of loosely related detail masks with one
structured intermediate representation that preserves visual intent between
image recognition and stitch generation.

The first implementation must improve general subject fidelity without
character-specific templates. It must preserve:

- closed visual features and their holes;
- open line art as separate continuous paths;
- compact fills such as pupils;
- protected highlights nested inside dark fills;
- stable sharp corners without retaining pixel stair-step noise;
- parent-child and visual stacking relationships.

## Root Cause

The current pipeline recognizes design colors, immediately maps them to a
physical thread map, and later tries to infer facial and line details from
binary masks. This loses distinctions between source colors and does not record
whether a component is an eye, an open mark, a fill, or an outline.

The photo-stitch generator then chooses a stitch mode from region geometry,
while the cross-stitch generator assigns one dominant color to each grid cell.
Both stages therefore operate on incomplete visual intent.

## Semantic Contract

Recognition produces immutable `SemanticPart` values alongside the existing
compatibility masks. Each part records:

- a stable identifier and semantic role;
- `closed_contour`, `open_line`, `compact_fill`, or `protected_highlight`;
- source design color and suggested physical thread;
- binary support mask;
- ordered vector paths in source-image coordinates;
- hole paths for closed components;
- locked sharp-corner indices;
- parent identifier and z-order;
- subject/detail confidence and suggested stitch intent.

The first version is role-agnostic: it does not require a face detector. Parts
are classified from topology, enclosure, contrast, line width, compactness,
and subject location. A later learned classifier can replace the classifier
without changing consumers.

## Extraction

Semantic extraction runs after design-color recognition but before physical
thread cleanup. It uses the original design map and source image so nearby
source colors cannot erase geometry prematurely.

Connected components are classified as follows:

- elongated thin components and branch-pruned detail skeletons become open
  lines;
- enclosed boundaries become closed contours and retain their holes;
- compact dark or saturated components become compact fills;
- small light components enclosed by a dark compact fill become protected
  highlights.

Closed paths use the existing local contour analyzer. Stable corners are
locked, smooth spans are regularized, and hole topology is retained. Open lines
use topology-safe skeleton paths and remain separate when no supported bridge
exists.

## Photo-Stitch Consumption

Broad color masks continue to create fill regions. Semantic parts are appended
as explicit child regions in visual order:

1. subject and background fills;
2. compact feature fills;
3. protected highlights;
4. closed outlines;
5. open line details.

Open lines use continuous running stitches. Closed contours use adaptive
running stitches initially; narrow satin borders may be selected only when
source width supports them. Compact fills use dense fill settings. Semantic
regions remain separate children under the same physical thread layer.

## Cross-Stitch Consumption

The base cross-stitch grid remains globally owned and non-overlapping.
Semantic parts provide protected source support:

- compact fills influence cell ownership before thread-color collapse;
- partial boundary cells retain directional half-stitch selection;
- closed contours and open lines become backstitch-style running overlays;
- highlights survive as a compact fill or short overlay when smaller than one
  base grid cell.

No global grid-size reduction is introduced. Subject detail may use a bounded
half-size local grid only when a compact semantic part cannot be represented by
the base grid and an overlay would not express its area.

## Calibration

The MSEmb runner must execute the actual product pipeline. For each profile it
records metrics at recognition, layer, stitch-preview, and export-readback
stages, plus:

- elapsed time by stage;
- layer and region counts;
- stitch and jump-like path counts;
- export bounds and color-block stability.

Source-to-target comparison remains a dataset baseline, not a product score.
The report must clearly distinguish baseline target similarity from generated
pipeline similarity.

## Compatibility And Failure Handling

- Existing `RecognitionResult` callers remain valid because semantic parts
  default to an empty tuple.
- Existing project files load without semantic metadata.
- Degenerate masks produce no semantic part rather than failing recognition.
- Unsupported holes and paths fall back to the current mask-based behavior.
- Semantic extraction is bounded by component and point budgets.
- UI generation remains cancellable and receives no per-stitch callbacks.

## Verification

Automated tests must demonstrate:

- a sharp closed mouth-like polygon retains both corners and its hole;
- a rounded eye-like contour becomes smoother without gaining corners;
- an open line remains one continuous branch-free path;
- two pupils remain independent compact parts;
- enclosed highlights remain children of the correct compact part;
- photo layers receive role-appropriate stitch modes;
- cross-stitch output contains both base grid stitches and protected overlays;
- the real calibration runner invokes recognition and stitch generation;
- PES readback preserves expected bounds and color-block order.

The existing test suite and six-sample local audit remain regression gates.

