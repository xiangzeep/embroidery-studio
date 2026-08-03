# Export Fidelity Closed-Loop Design

## Goal

Make source recognition, stitch preview, and exported embroidery readback
measurable stages of one pipeline. A change may advance only when the final
decoded embroidery result improves or remains within established regression
limits.

## Root Causes

Recognition currently reports detail recall by comparing the same detail mask
to itself. The real-image Patrick tests use a temporary clipboard path and are
skipped after that file disappears. Canvas preview draws project paths directly,
while export separately compiles an `EmbPattern`; calibration uses another
one-pixel polyline renderer. These paths can disagree in color, ordering,
travel commands, and visible coverage.

PES output is not decoded and compared with the in-memory pattern after write.
The application can therefore report success even when a writer or reader
changes colors, removes commands, or changes layer ordering.

## Quality Stages

Every benchmark records these stages independently:

1. Source RGB image.
2. Recognition reconstruction.
3. Physical-thread reconstruction.
4. Generated project regions and paths.
5. In-memory `EmbPattern` render.
6. Exported-file readback render.

The report stores metrics and images for every stage so the first degrading
boundary is visible.

## Canonical Pattern Renderer

A renderer consumes only `pyembroidery.EmbPattern`. It interprets stitch,
jump, trim, color-change, and end commands, uses the pattern thread list, and
draws only sewn segments. Travel movement is not visible. Thread width is
specified in millimeters and converted through a fit transform shared by the
in-memory and decoded patterns.

The desktop detailed stitch view and offline calibration use this renderer.
Region-mask preview may remain available as an explicit recognition view, but
it must not be labeled as final embroidery preview.

## Fidelity Metrics

Recognition detail recall compares a source-derived detail mask with a detail
mask independently derived from the reconstruction. The masks may use a small
distance tolerance, but may never be the same object.

Final fidelity includes:

- subject-weighted Lab color similarity;
- edge recall and precision;
- foreground coverage;
- small-component noise penalty;
- preview-to-readback geometry and color parity;
- thread count, stitch count, jump count, and sewn bounds.

## Regression Fixtures

Real source images live under `tests/fixtures` and never reference clipboard or
download directories. The Patrick fixture is the first subject-priority gate.
Its required semantic anchors are both eyes, both pupils, both eyebrows, mouth
cavity, tongue, both pointed mouth corners, lower lip line, arm outlines, and
the principal background bands.

## Acceptance Gates

- No real-image regression test may skip because a fixture is missing.
- Recognition detail recall must use independent masks.
- In-memory and PES-readback renders must have at least 0.99 structural parity.
- Thread order and RGB values must survive PES readback within the writer's
  supported representation.
- Every required Patrick semantic anchor must be present.
- Changes that reduce final subject fidelity are rejected even if recognition
  reconstruction improves.
- Benchmarks record wall time and peak stitch/path counts to prevent quality
  fixes from causing unbounded performance regressions.

## Delivery Order

First establish trustworthy fixtures, metrics, pattern rendering, and PES
readback. Then improve semantic topology and stitch planning against those
gates. This prevents another sequence of source-specific visual patches whose
final exported result is unknown.
