# Cross Stitch Plan Task 5 Report

## Delivered

- Added one deterministic 96x96 synthetic face fixture and drove it through the
  real recognition, layer construction, `StitchWorker`, pattern build, export,
  and pyembroidery decode path.
- Verified both eyes, pupils, highlights, eyebrows, pointed mouth corners, and
  the continuous line below the mouth independently. Protected overlay recall
  is measured with a two-source-pixel spatial tolerance appropriate to the
  approximately 6.8-pixel cross grid.
- Kept the two broad background colors as two fill regions while retaining 14
  directional boundary half cells.
- Added ownership, layer order, path validity, physical-color, stitch, jump,
  photo-stitch, runtime, and managed-memory bounds.
- Added real PES and DST round trips in an isolated interpreter so the existing
  fake pyembroidery unit tests cannot satisfy the integration test.

## TDD Evidence

1. RED: the new synthetic regression reported protected detail recall `0.7661`;
   both eyebrows and the line below the mouth had zero overlay recall.
2. RED: enhanced generation produced `1,658` stitches against a `752`-stitch
   full-cross baseline, exceeding the 1.35 growth budget.
3. RED: a focused auto-method test showed a broad saturated flat region selected
   `double_cross` instead of `cross`.
4. Root cause: overlay protection stopped at the subject mask, lower-priority
   semantic lines lost the global candidate ranking, and the six-overlay
   per-color cap could not represent seven independent black facial components.
   Separately, auto method selection applied decorative `double_cross` density
   to broad saturated background fills.
5. GREEN: nearby semantic details can now extend just beyond the subject mask;
   detail-contributor lines rank above background fragments; the per-color cap is
   eight while the global overlay budget remains unchanged; `double_cross` is
   restricted to regions covering at most 8% of the source.

## Fidelity And Complexity

| Metric | Result | Gate |
| --- | ---: | ---: |
| Protected detail recall | 0.9374 | >= 0.90 |
| Eye recall, left / right | 0.8704 / 0.9444 | each >= 0.75 |
| Pupils, highlights, brows, mouth corners, under-mouth line | 1.000 each | each >= 0.75 |
| Drawable physical colors / layers | 5 / 5 | each <= 8 |
| Overlay regions / paths | 12 / 21 | bounded; every path has >= 2 points |
| Shared ownership overlap max | 1 | exactly 1 |
| Boundary methods | 211 full, 10 half, 4 half-flipped | half present |
| Background fills / paths | 2 fills, 321 paths | 1-2 fills; < 40% of source pixels |
| Enhanced stitches / baseline | 938 / 752 (1.247x) | <= 1.35x |
| Enhanced jumps / baseline | 53 / 33 | <= baseline + 21 overlay paths + 8 |
| Photo-stitch drawable layers / points | 5 / 4,462 | non-empty; layers <= 8 |

Fill regions precede overlays inside every same-thread layer, and disconnected
overlay paths remain separated by jumps during export.

## Export Round Trip

The real installed pyembroidery package wrote and decoded both formats:

| Pattern | Stitches/commands | Threads | Sewn bounds | Bytes |
| --- | ---: | ---: | --- | ---: |
| In-memory source | 1,011 | 5 | `(0, 0, 270, 270)` | n/a |
| PES | 1,105 | 5 | `(0, 0, 270, 270)` | 10,214 |
| DST | 1,008 | 5 | `(0, 0, 270, 270)` | 3,617 |

Both decoded files end with `END`; bounds are unchanged and thread counts remain
within the eight-color budget.

## Performance

After one warm-up, enhanced and full-cross baseline generation were alternated
for five runs:

- Enhanced median: `0.06604s`
- Baseline median: `0.04602s`
- Median ratio: `1.435x` (gate: <= `1.50x`)
- 192x192 generation: `0.3696s`
- 192x192 peak Python-managed memory: `14.69 MiB`
- 192x192 generated stitch points: `3,639`

The regression uses deliberately loose absolute guards of 15 seconds and
256 MiB so normal CI scheduling and hardware differences do not create a
machine-fragile test.

## Verification

```text
QT_QPA_PLATFORM=offscreen LOKY_MAX_CPU_COUNT=8 ../../.venv/bin/python \
  -m unittest tests.test_cross_stitch_geometry \
  tests.test_recognition_engine tests.test_export_paths -v
Ran 247 tests in 3.417s
OK (skipped=3)

QT_QPA_PLATFORM=offscreen LOKY_MAX_CPU_COUNT=8 ../../.venv/bin/python \
  -m unittest discover -s tests -v
Ran 253 tests in 3.237s
OK (skipped=3)
```

The three unchanged skips require an external Patrick regression image that is
not present in this worktree.

## Self Review

- The real-format test runs in a fresh interpreter; fake module state is
  explicitly synchronized only for legacy fake-export tests.
- The global overlay budget is not increased, and broad background fragments
  cannot outrank same-color semantic line components.
- The auto-method fix affects only cross-stitch decorative density selection;
  photo-stitch generation remains on its existing path and has a same-source
  regression.
- The baseline rebuilds the same deterministic source and recognition
  configuration into full-cross fills without overlays, so the count and
  timing comparisons include equivalent recognition and worker work.

## Residual Risk

- `tracemalloc` measures Python-managed allocations, not all native OpenCV,
  Qt, or pyembroidery allocations. The generous cap and existing image
  downscaling guard reduce, but do not eliminate, native-memory risk.
- Synthetic raster recall cannot prove appearance after fabric, tension, and
  machine-specific compensation.
- The 8% auto-density threshold is deterministic and regression-covered, but
  unusual designs with large intentional decorative double crosses may still
  require an explicit user-selected method.
