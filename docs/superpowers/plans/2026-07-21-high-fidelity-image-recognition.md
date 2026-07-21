# High-Fidelity Image Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic local recognition pipeline that preserves close colors and fine lines at the design stage and passes the 95% fidelity gates before photo-stitch or cross-stitch generation.

**Architecture:** Add a focused recognition module that produces image-derived design colors, a stable design-color map, detail evidence, physical-thread suggestions, and measured fidelity. Keep segmentation and stitch generation downstream, but stop using owned-thread indices as the recognition map. The Qt worker consumes the structured result and only replaces project layers after the complete pipeline succeeds.

**Tech Stack:** Python 3.10+, NumPy, OpenCV, scikit-image, scikit-learn, PySide6, unittest

## Global Constraints

- Meaningful boundary recall at one-pixel tolerance must be at least 0.95.
- Fine-detail component recall must be at least 0.95.
- Source-pixel assignment coverage must be at least 0.995.
- Normalized perceptual color similarity `mean(exp(-delta_e / 20))` must be at least 0.95.
- Recognition must be deterministic for identical image and settings.
- Recognition colors must not collapse into the physical thread inventory.
- Background inclusion must remain an explicit switch.
- Heavy processing must remain off the Qt UI thread and use bounded memory.
- Existing photo-stitch, cross-stitch, export, and localization tests must remain green.

---

### Task 1: Fidelity Metrics and Recognition Result Model

**Files:**
- Create: `stitch_studio/core/recognition_engine.py`
- Create: `tests/test_recognition_engine.py`
- Modify: `stitch_studio/core/project.py`

**Interfaces:**
- Produces: `DesignColor`, `RecognitionMetrics`, `RecognitionResult`, and `RecognitionEngine.measure_fidelity(source, reconstructed, detail_mask=None)`.
- Consumes: NumPy RGB arrays and optional boolean detail masks.

- [ ] **Step 1: Write failing tests for metric semantics**

```python
def test_identical_image_has_perfect_recognition_metrics():
    image = np.array([[[10, 20, 30], [220, 210, 200]]], dtype=np.uint8)
    metrics = RecognitionEngine.measure_fidelity(image, image.copy())
    assert metrics.perceptual_similarity == 1.0
    assert metrics.pixel_coverage == 1.0
    assert metrics.boundary_recall == 1.0

def test_unassigned_pixels_reduce_coverage():
    source = np.full((4, 4, 3), 120, dtype=np.uint8)
    reconstructed = source.copy()
    assigned = np.ones((4, 4), dtype=bool)
    assigned[0, 0] = False
    metrics = RecognitionEngine.measure_fidelity(source, reconstructed, assigned_mask=assigned)
    assert metrics.pixel_coverage == 15 / 16
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine -v`

Expected: import failure because `recognition_engine` does not exist.

- [ ] **Step 3: Add immutable result models and vectorized metrics**

Implement dataclasses with these fields:

```python
@dataclass(frozen=True)
class DesignColor:
    design_id: int
    color_rgb: Tuple[int, int, int]
    pixel_count: int
    nearest_thread_index: Optional[int] = None
    nearest_thread_delta_e: Optional[float] = None

@dataclass(frozen=True)
class RecognitionMetrics:
    perceptual_similarity: float
    pixel_coverage: float
    boundary_recall: float
    detail_recall: float

@dataclass
class RecognitionResult:
    design_map: np.ndarray
    design_colors: List[DesignColor]
    reconstructed_rgb: np.ndarray
    detail_mask: np.ndarray
    metrics: RecognitionMetrics
```

Use CIEDE2000 for perceptual similarity and Canny edges with one-pixel dilation for boundary recall. Empty-edge identical images return boundary recall `1.0`.

- [ ] **Step 4: Run Task 1 tests and verify GREEN**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine -v`

Expected: all Task 1 tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add stitch_studio/core/recognition_engine.py stitch_studio/core/project.py tests/test_recognition_engine.py
git commit -m "feat: add recognition fidelity model"
```

### Task 2: Edge- and Rarity-Aware Design Palette

**Files:**
- Modify: `stitch_studio/core/recognition_engine.py`
- Modify: `stitch_studio/core/project.py`
- Modify: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces: `RecognitionEngine.recognize(image, physical_threads, settings) -> RecognitionResult`.
- Consumes: `QuantizationSettings.design_color_budget`, `auto_design_colors`, and `preserve_details`.

- [ ] **Step 1: Write failing tests for close colors, rare colors, and determinism**

Create fixtures containing two LAB-close broad regions and a one-pixel accent line. Assert that both broad colors receive distinct design IDs, the accent survives in the reconstructed image, output IDs are contiguous, and two runs are byte-identical.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.DesignPaletteTests -v`

Expected: failure because `recognize` and the new settings do not exist.

- [ ] **Step 3: Implement adaptive design-color budgeting**

Add settings:

```python
design_color_budget: int = 0
auto_design_colors: bool = True
detail_sensitivity: float = 0.65
```

Budget `0` selects from `24, 32, 48, 64, 96, 128` using image color variance, edge density, and unique LAB-bin count. Explicit values are clamped to `2..128`.

- [ ] **Step 4: Implement weighted LAB clustering**

Build deterministic sample weights from local color contrast, Canny edges, and inverse coarse-LAB-bin frequency. Use bounded repeated sampling for KMeans/MiniBatchKMeans, then classify every source pixel directly against design centers in CIEDE2000 chunks. Keep design IDs independent of physical threads.

- [ ] **Step 5: Verify Task 2 GREEN**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.DesignPaletteTests -v`

Expected: all design-palette tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add stitch_studio/core/recognition_engine.py stitch_studio/core/project.py tests/test_recognition_engine.py
git commit -m "feat: preserve rare and close design colors"
```

### Task 3: Independent Fine-Detail Evidence

**Files:**
- Modify: `stitch_studio/core/recognition_engine.py`
- Modify: `tests/test_recognition_engine.py`

**Interfaces:**
- Produces: `RecognitionEngine.detect_fine_details(image) -> np.ndarray` and detail-aware `RecognitionResult.detail_mask`.
- Consumes: source RGB image and `detail_sensitivity`.

- [ ] **Step 1: Write failing detail-classification tests**

Test one-pixel dark and colored lines, a curved two-pixel line, and a large rectangle boundary. Assert at least 95% recall for true detail pixels and assert the large rectangle interior/boundary is not promoted as an independent detail component.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.DetailRecognitionTests -v`

Expected: failure because independent detail detection is absent.

- [ ] **Step 3: Implement multi-scale detail detection**

Combine color-distance-to-local-median, black-hat/tophat responses, and Canny continuity at scales 1, 2, and 3. Classify connected components by distance-transform width, skeleton continuity, and bounding-box occupancy. Do not use total area as the sole discriminator.

- [ ] **Step 4: Preserve detail colors without altering broad-region IDs**

Cluster detail pixels separately within the remaining design-color budget. Store their IDs in the same design map but retain `detail_mask` so layer construction can force top ordering and run/satin stitch defaults.

- [ ] **Step 5: Verify Task 3 GREEN**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.DetailRecognitionTests -v`

Expected: all detail tests pass with recall at least 0.95.

- [ ] **Step 6: Commit Task 3**

```bash
git add stitch_studio/core/recognition_engine.py tests/test_recognition_engine.py
git commit -m "feat: extract independent fine detail evidence"
```

### Task 4: Thread Suggestions Without Recognition Collapse

**Files:**
- Modify: `stitch_studio/core/recognition_engine.py`
- Modify: `stitch_studio/core/project.py`
- Modify: `stitch_studio/core/image_engine.py`
- Modify: `tests/test_recognition_engine.py`
- Modify: `tests/test_export_paths.py`

**Interfaces:**
- Produces: nearest physical-thread metadata on every `DesignColor`; `ImageEngine.build_layers_from_recognition(result, threads, source, generation_mode)`.
- Consumes: `RecognitionResult` and current physical-thread inventory.

- [ ] **Step 1: Write failing tests for independent design colors**

Use two close design colors whose nearest owned thread is the same. Assert they remain two design IDs and two editable layers while both suggestions point to the same physical thread.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.ThreadSuggestionTests -v`

Expected: failure because recognition-aware layer construction is absent.

- [ ] **Step 3: Add layer metadata**

Add backward-compatible fields to `Layer`:

```python
design_color_id: Optional[int] = None
design_color_rgb: Optional[Tuple[int, int, int]] = None
matched_thread_rgb: Optional[Tuple[int, int, int]] = None
thread_match_delta_e: Optional[float] = None
is_detail_layer: bool = False
```

Include them in project serialization.

- [ ] **Step 4: Build layers by design ID**

Segment the design map without morphology across source edges. Preserve all assigned pixels, create detail regions last, set photo detail to run/narrow satin, and use cross-stitch detail defaults in cross-stitch mode. Do not call `_merge_tiny_similar_layers` for independently recognized design colors.

- [ ] **Step 5: Verify Task 4 GREEN and export compatibility**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.ThreadSuggestionTests tests.test_export_paths -v`

Expected: recognition tests pass and all existing export tests remain green.

- [ ] **Step 6: Commit Task 4**

```bash
git add stitch_studio/core/recognition_engine.py stitch_studio/core/project.py stitch_studio/core/image_engine.py tests/test_recognition_engine.py tests/test_export_paths.py
git commit -m "feat: keep design colors independent from thread matches"
```

### Task 5: Worker and Beginner UI Integration

**Files:**
- Modify: `stitch_studio/ui/main_window.py`
- Modify: `stitch_studio/ui/panels.py`
- Modify: `stitch_studio/i18n.py`
- Modify: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `RecognitionEngine.recognize` and `RecognitionResult`.
- Produces: atomic project update, progress messages, exact-design preview, advanced fidelity controls, and fidelity status text.

- [ ] **Step 1: Write failing worker and UI tests**

Assert `QuantizeWorker` calls `RecognitionEngine`, beginner defaults enable high fidelity, advanced design colors permit `2..128`, and status text includes the four measured percentages.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `.venv-codex/bin/python -m unittest tests.test_export_paths.ImageWorkflowTests -v`

Expected: failures for missing recognition integration and controls.

- [ ] **Step 3: Replace worker quantization flow atomically**

Run adjustment, recognition, recognition-aware layer construction, and metric validation inside `QuantizeWorker`. Emit one result only after all stages succeed. On `MemoryError`, retry once with a reduced analysis image and report the fallback. Preserve the previous project on all failures.

- [ ] **Step 4: Add beginner defaults and professional controls**

Keep `保留细线` and `生成背景` visible. Under advanced settings add automatic design colors, explicit design-color budget, and detail sensitivity. Display recognition fidelity and physical-thread color difference separately in Chinese and English.

- [ ] **Step 5: Verify Task 5 GREEN**

Run: `.venv-codex/bin/python -m unittest tests.test_export_paths.ImageWorkflowTests -v`

Expected: all workflow tests pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add stitch_studio/ui/main_window.py stitch_studio/ui/panels.py stitch_studio/i18n.py tests/test_export_paths.py
git commit -m "feat: integrate high fidelity recognition workflow"
```

### Task 6: Patrick Regression Gate and Full Verification

**Files:**
- Create: `tests/fixtures/patrick-source.png`
- Modify: `tests/test_recognition_engine.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete recognition pipeline.
- Produces: reproducible end-to-end fidelity and performance evidence.

- [ ] **Step 1: Add the supplied source image as a regression fixture**

Copy only the 315x200 original source image supplied by the user, not any generated screenshot. Record its SHA-256 in the test so fixture replacement is explicit.

- [ ] **Step 2: Write the failing 95% end-to-end test**

Run recognition with beginner defaults and assert all four global fidelity gates, deterministic output, at least two distinct close blue design colors, retained black facial lines, and non-empty background when background inclusion is enabled.

- [ ] **Step 3: Run the regression test and verify RED or GREEN for the right reason**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine.PatrickRegressionTests -v`

Expected before final tuning: any failure names the specific metric below threshold; no assertion may be relaxed below the global constraints.

- [ ] **Step 4: Tune only documented algorithm parameters**

Adjust adaptive budget and weighting constants through named module constants. Do not special-case the fixture filename, dimensions, or source colors.

- [ ] **Step 5: Run full verification**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine tests.test_export_paths -v`

Expected: all tests pass, Patrick metrics meet every gate, and no crashes occur.

- [ ] **Step 6: Update user documentation**

Document design colors versus physical threads, the beginner workflow, fidelity metrics, and why exact recognition can suggest fewer physical thread changes.

- [ ] **Step 7: Commit Task 6**

```bash
git add tests/fixtures/patrick-source.png tests/test_recognition_engine.py README.md
git commit -m "test: enforce high fidelity image recognition"
```

### Task 7: Final Review, Commit, and Push

**Files:**
- Review all files changed by Tasks 1-6.

**Interfaces:**
- Produces: verified remote branch `codex/vector-boundary-reconstruction`.

- [ ] **Step 1: Run whitespace and repository checks**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 2: Run the complete suite from a clean process**

Run: `.venv-codex/bin/python -m unittest tests.test_recognition_engine tests.test_export_paths -v`

Expected: all tests pass.

- [ ] **Step 3: Review scope**

Run: `git status --short` and `git diff --stat origin/codex/vector-boundary-reconstruction...HEAD`

Expected: only recognition implementation, tests, fixture, documentation, and the pre-approved spec/plan are included; unrelated untracked files remain untouched.

- [ ] **Step 4: Push the verified branch**

Run: `git push origin codex/vector-boundary-reconstruction`

Expected: remote branch advances to the final verified commit.
