# Cross Stitch Plan Task 5 Report

## Delivered

- Added one deterministic 96x96 synthetic face and drove the same source through
  recognition, layer construction, the real `StitchWorker`, pattern build, PES
  and DST export, and real pyembroidery decode.
- Rasterized all Worker-final fill and overlay `stitch_paths` from 0.1 mm units
  back to source pixels with `source_px = stitch_unit * px_per_mm / 10`, grouped
  by `(physical thread UID, physical thread RGB)`.
- Gated every semantic class against only its expected physical-color raster:
  eyes and highlights use white; pupils, brows, pointed mouth corners, and the
  continuous line below the mouth use black. Both required color groups must
  contain paths and raster pixels. Highlights may be satisfied by white fill.
- Each fixture semantic is structured as `{mask, expected_rgb, minimum_recall}`.
  The same local RGB variable draws the source feature, creates its oracle, and
  populates the thread palette; tests do not reconstruct identity from roles or
  fixed palette indices.
- Kept cross-stitch ownership unique, fill regions before same-thread overlays,
  colors/layers bounded, background fills moderately simplified, and the
  identical synthetic source healthy in photo-stitch mode.
- Compared decoded PES/DST `STITCH` and `JUMP` commands against separately
  exported and decoded full-cross baselines. Thread count, sewn bounds, final
  `END`, and non-empty files remain covered.
- Replaced the whole-image 8% saturated-region cutoff. Image-generated
  cross-stitch fills now explicitly select standard `cross`; manually configured
  `auto` retains dense decoration independent of region area.
- Replaced the 15-second absolute performance check with a 384x384 relative
  benchmark: warm-ups, alternating order, five samples per variant, and median
  ratio <= 1.50. The baseline now mocks overlay construction during layer
  building instead of constructing and deleting overlays afterward.

## TDD Evidence

1. RED: after switching fidelity from region masks to final Worker paths, overall
   recall reproduced at `0.8912685`, below the `0.90` gate. The test also gained
   explicit non-empty path/raster assertions.
2. GREEN: applying generic `preserve` corners and one pass to every contour-traced
   cross overlay raised final-path recall to `0.9110379`. The change has no
   facial-role branches and does not mutate shared settings objects.
3. RED: the first real-format budget assertion could not compare decoded output
   because the round-trip helper exported only the enhanced pattern. The helper
   was extended to write and decode enhanced and baseline PES/DST independently.
4. GREEN: both decoded formats satisfy stitch and jump budgets while retaining
   bounds, threads, bytes, and terminal `END`.
5. RED: the old 8% rule made a large saturated decoration choose `cross`, and
   method selection changed discontinuously from `double_cross` at 7.9% to
   `cross` at 8.1%. Generated regions also still used ambiguous `auto`.
6. GREEN: both 7.9% and 8.1% manual-auto regions choose `double_cross`, a full
   96x96 saturated decoration remains dense, and generated fills explicitly use
   `cross`.
7. The revised performance test was added before considering optimization. Its
   measured ratio was already below 1.50, so no ownership/overlay hot-path change
   was justified.
8. RED: the physical-color regression showed that the previous color-blind
   overlay union credited neighboring black paths to white eyes. Correct white
   final-path recall is `0.78241 / 0.82870`; both white highlights are `1.0`.
9. RED: the baseline harness had no evidence that overlay construction was
   disabled and failed the new assertion for `overlay_builder_mock_calls`.
10. GREEN: fidelity now groups every final fill and overlay path by physical
    thread identity/color. The baseline patches the overlay builder to a no-op
    around `build_layers_from_recognition`; the enhanced path remains unchanged.
11. RED: the new oracle mutation test initially failed with
    `KeyError: ground_truth` because the fixture exposed only bare masks.
12. GREEN: the fixture now owns color-aware structured truth. Changing only the
    under-mouth line's expected RGB from black to the fixture's white RGB changes
    its recall from `1.0` to `0.0`, and the unchanged `0.95` gate rejects it.

## Fidelity And Complexity

All recall values below use final Worker paths with a two-source-pixel
tolerance. Per-class values use only the expected physical thread/color.

| Metric | Result | Gate |
| --- | ---: | ---: |
| All-color union recall | 1.00000 | >= 0.95 |
| White eye recall, left / right | 0.78241 / 0.82870 | each >= 0.75 |
| White highlight recall, left / right | 1.000 / 1.000 | each = 1.00 |
| Black pupil recall, left / right | 1.000 / 1.000 | each >= 0.95 |
| Black brows, mouth corners, under-mouth line | 1.000 each | each >= 0.95 |
| White final paths / raster pixels | 23 / 156 | both non-empty |
| Black final paths / raster pixels | 41 / 472 | both non-empty |
| Final overlay regions / paths | 12 / 21 | both non-empty |
| Wrong-color mutation, under-mouth line | 0.000 | fails 0.95 gate |
| Drawable physical colors / layers | 5 / 5 | each <= 8 |
| Shared ownership overlap max | 1 | exactly 1 |
| Boundary methods | 211 full, 10 half, 4 half-flipped | half present |
| Background fills / paths | 2 / 321 | 1-2 fills; paths < 40% of source pixels |
| Photo-stitch drawable layers / points | 5 / 4,462 | non-empty; layers <= 8 |

Every same-thread fill precedes its overlays. Disconnected overlay paths remain
separate and therefore export with jump transitions.

## Stitch Budgets

| Pattern | Enhanced STITCH / JUMP | Baseline STITCH / JUMP | Gate |
| --- | ---: | ---: | --- |
| In-memory | 950 / 55 | 752 / 33 | STITCH <= 1.35x; JUMP <= 33 + 21 + 8 |
| Decoded PES | 975 / 73 | 764 / 46 | STITCH <= 1.35x; JUMP <= 46 + 21 + 8 |
| Decoded DST | 950 / 54 | 752 / 32 | STITCH <= 1.35x; JUMP <= 32 + 21 + 8 |

The enhanced/baseline STITCH ratios are `1.263x` in memory, `1.276x` after PES
decode, and `1.263x` after DST decode.

## Export Round Trip

| Artifact | Commands | Threads | Sewn bounds | Bytes |
| --- | ---: | ---: | --- | ---: |
| Enhanced source | 1,025 | 5 | `(0, 0, 270, 270)` | n/a |
| Baseline source | 802 | 5 | `(0, 0, 270, 270)` | n/a |
| Enhanced PES | 1,125 | 5 | `(0, 0, 270, 270)` | 10,374 |
| Baseline PES | 860 | 5 | `(0, 0, 270, 270)` | 8,548 |
| Enhanced DST | 1,022 | 5 | `(0, 0, 270, 270)` | 3,659 |
| Baseline DST | 797 | 5 | `(0, 0, 270, 270)` | 2,954 |

Both decoded formats and both variants end with `END`. Bounds are unchanged and
decoded thread counts exactly match their five-thread source patterns.

## Performance

Final 384x384 offscreen sampling, after enhanced and true no-overlay baseline
warm-ups:

- Enhanced median over five runs: `0.55788s`
- Full-cross baseline median over five runs: `0.45870s`
- Median ratio: `1.216x` (gate: <= `1.50x`)
- Warm-up peak Python-managed memory: `50.92 MiB` (gate: < `256 MiB`)
- Enhanced / baseline overlay regions: `12 / 0`
- Baseline overlay-builder mock calls: `1`

Each timed helper call covers fixture setup, recognition, layer building, and
the real worker. The test alternates run order to reduce thermal/scheduling bias
and has no absolute runtime threshold.

## Verification

```text
QT_QPA_PLATFORM=offscreen LOKY_MAX_CPU_COUNT=8 ../../.venv/bin/python \
  -m unittest tests.test_cross_stitch_geometry \
  tests.test_recognition_engine tests.test_export_paths -v
Ran 250 tests in 8.410s
OK (skipped=3)

QT_QPA_PLATFORM=offscreen LOKY_MAX_CPU_COUNT=8 ../../.venv/bin/python \
  -m unittest discover -s tests -v
Ran 256 tests in 8.434s
OK (skipped=3)
```

The three unchanged skips require an external Patrick regression image that is
not present in this worktree.

## Self Review

- The fidelity rasters use all final worker geometry, not masks or pre-worker
  polygons. A wrong-color path cannot satisfy a semantic class.
- Expected thread identity originates beside each fixture drawing operation.
  The assertion code resolves it through exact palette RGB matching and never
  uses a semantic-role-to-thread table or fixed thread index.
- The wrong-color mutation traverses the same palette lookup, bucket validation,
  raster recall, and gate code as the positive regression, demonstrating that
  the oracle distinguishes physical colors.
- White highlights are intentionally not required to be overlays; the final
  white fill paths satisfy them completely.
- The contour-overlay adjustment is generic and scoped to cross overlays. A
  copied `StitchSettings` prevents accidental mutation of contributor settings.
- The export integration runs in a fresh interpreter, so fake pyembroidery state
  from unit tests cannot satisfy it.
- No semantic background role exists in the current region model. The generated
  mode therefore uses an explicit standard-cross setting instead of guessing
  background from area or color; manual `auto` remains decoration-sensitive.
- The relative performance baseline disables the overlay builder at the layer
  construction call. It does not pay overlay construction cost and delete the
  result later.
- Both review findings were verification-harness defects. The corrected
  assertions passed without a production change, so production geometry and hot
  paths were left untouched.

## Residual Risk

- `tracemalloc` measures Python-managed allocations, not native OpenCV, Qt, or
  pyembroidery allocations.
- Synthetic raster recall cannot model fabric, tension, needle, or
  machine-specific compensation.
- Sparse white cross fill recalls the eye outlines at `0.782 / 0.829`; this is
  above the planned per-class gate but has less margin than the other classes.
- PES decoding adds format-level commands and sits closest to the jump budget
  (73 versus a limit of 75); the decoded comparison will catch future drift.
- The explicit generated `cross` strategy favors predictable stitch budgets over
  automatic decorative density. Users can still select denser methods
  explicitly, while manual `auto` preserves large saturated decoration.
