# Cross Stitch Photo Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing generation target choice between photo stitch and cross stitch, with Ink/Stitch-inspired cross-stitch settings and a coverage-based cross-stitch generator.

**Architecture:** Extend the existing project model and panels instead of adding a new subsystem. Cross-stitch generation stays inside `StitchEngine`, using helper methods for grid selection, automatic method choice, and per-cell stitch templates. Image quantization and layer building remain the shared front of the pipeline, then generation mode determines default stitch settings.

**Tech Stack:** Python 3.12, PySide6, NumPy, OpenCV, Shapely, standard `unittest`.

## Global Constraints

- Do not fully port Ink/Stitch's GPL implementation into this project.
- Do not add a full cross-stitch chart editor in the first pass.
- Do not replace existing photo-stitch fill modes.
- Do not implement graph/Eulerian path optimization in the first pass.
- Keep project serialization backward-compatible for existing `.ssp` files.
- Use deterministic automatic method selection.
- Use standard-library `unittest` commands because the local environment does not have `pytest`.

---

### Task 1: Cross-Stitch Settings Data Model

**Files:**
- Modify: `stitch_studio/core/project.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces: `Project.generation_mode: str`
- Produces: `StitchSettings.cross_method: str`
- Produces: `StitchSettings.cross_pattern_size_mm: float`
- Produces: `StitchSettings.cross_coverage: float`
- Produces: `StitchSettings.cross_align_grid: bool`
- Produces: `StitchSettings.cross_grid_offset_x_mm: float`
- Produces: `StitchSettings.cross_grid_offset_y_mm: float`
- Produces: `StitchSettings.cross_detail_boost: float`

- [ ] **Step 1: Write failing tests**

Add these tests to `tests/test_export_paths.py`:

```python
    def test_stitch_settings_include_cross_stitch_defaults(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        settings = project_mod.StitchSettings()

        self.assertEqual(settings.cross_method, "auto")
        self.assertAlmostEqual(settings.cross_pattern_size_mm, 2.0)
        self.assertAlmostEqual(settings.cross_coverage, 0.5)
        self.assertTrue(settings.cross_align_grid)
        self.assertAlmostEqual(settings.cross_grid_offset_x_mm, 0.0)
        self.assertAlmostEqual(settings.cross_grid_offset_y_mm, 0.0)
        self.assertAlmostEqual(settings.cross_detail_boost, 0.5)

    def test_project_generation_mode_serializes_with_backward_compatible_default(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        project = project_mod.Project()
        self.assertEqual(project.generation_mode, "photo_stitch")
        project.generation_mode = "cross_stitch"

        data = {
            "version": "1.0",
            "uid": project.uid,
            "name": project.name,
            "generation_mode": project.generation_mode,
            "image_settings": project.image_settings.to_dict(),
            "quant_settings": project.quant_settings.to_dict(),
            "active_pack_uids": [],
            "layers": [],
        }
        loaded = project_mod.Project.from_dict(data)

        self.assertEqual(loaded.generation_mode, "cross_stitch")
        self.assertEqual(project_mod.Project.from_dict({}).generation_mode, "photo_stitch")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_stitch_settings_include_cross_stitch_defaults \
  tests.test_export_paths.ExportPathTests.test_project_generation_mode_serializes_with_backward_compatible_default
```

Expected: fail with missing `cross_method` or `generation_mode`.

- [ ] **Step 3: Implement settings**

In `stitch_studio/core/project.py`, add fields to `StitchSettings`:

```python
    cross_method: str = "auto"
    cross_pattern_size_mm: float = 2.0
    cross_coverage: float = 0.5
    cross_align_grid: bool = True
    cross_grid_offset_x_mm: float = 0.0
    cross_grid_offset_y_mm: float = 0.0
    cross_detail_boost: float = 0.5
```

In `Project.__init__`, add:

```python
        self.generation_mode = "photo_stitch"
```

In `Project.save`, add to `data`:

```python
            'generation_mode': self.generation_mode,
```

In `Project.from_dict`, after creating the project object and before returning it, add:

```python
        project.generation_mode = data.get('generation_mode', 'photo_stitch')
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2. Expected: `OK`.

---

### Task 2: Generation Mode Defaults During Layer Building

**Files:**
- Modify: `stitch_studio/core/image_engine.py`
- Modify: `stitch_studio/ui/main_window.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `Project.generation_mode`
- Produces: `ImageEngine.build_layers_from_regions(..., generation_mode: str = "photo_stitch") -> List[Layer]`

- [ ] **Step 1: Write failing tests**

Add these tests to `tests/test_export_paths.py`:

```python
    def test_cross_stitch_generation_mode_sets_region_defaults_to_cross_stitch(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [thread_mod.ThreadColor(name="Green", color_rgb=(50, 180, 80))]
        mask = np.zeros((30, 30), dtype=np.uint8)
        mask[4:26, 4:26] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask)],
            palette,
            generation_mode="cross_stitch",
        )

        settings = layers[0].regions[0].stitch_settings
        self.assertEqual(settings.fill_mode, "cross_stitch")
        self.assertFalse(settings.underlay)
        self.assertEqual(settings.cross_method, "auto")

    def test_photo_stitch_generation_mode_keeps_existing_region_defaults(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [thread_mod.ThreadColor(name="Green", color_rgb=(50, 180, 80))]
        mask = np.zeros((30, 30), dtype=np.uint8)
        mask[4:26, 4:26] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask)],
            palette,
            generation_mode="photo_stitch",
        )

        self.assertEqual(layers[0].regions[0].stitch_settings.fill_mode, "scanline")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_generation_mode_sets_region_defaults_to_cross_stitch \
  tests.test_export_paths.ExportPathTests.test_photo_stitch_generation_mode_keeps_existing_region_defaults
```

Expected: fail because `build_layers_from_regions` does not accept `generation_mode`.

- [ ] **Step 3: Implement generation-mode defaults**

Change `ImageEngine.build_layers_from_regions` signature:

```python
    def build_layers_from_regions(
        regions: List[Tuple[int, np.ndarray]],
        palette_threads: List[ThreadColor],
        source_image: Optional[np.ndarray] = None,
        generation_mode: str = "photo_stitch",
    ) -> List[Layer]:
```

When assigning `region.stitch_settings`, replace the existing assignment with:

```python
            if generation_mode == "cross_stitch":
                region.stitch_settings = ImageEngine._default_cross_stitch_settings_for_mask(
                    mask,
                    source_image,
                )
            else:
                region.stitch_settings = ImageEngine._default_stitch_settings_for_mask(
                    mask,
                    layer_map[tid].thread_color_rgb,
                )
```

Add this method near `_default_stitch_settings_for_mask`:

```python
    @staticmethod
    def _default_cross_stitch_settings_for_mask(
        mask: np.ndarray,
        source_image: Optional[np.ndarray] = None,
    ) -> StitchSettings:
        binary = (mask > 0).astype(np.uint8)
        area = int(binary.sum())
        if area <= 0:
            return StitchSettings(fill_mode="none", underlay=False)
        return StitchSettings(
            fill_mode="cross_stitch",
            stitch_length_mm=2.0,
            stitch_length_min_mm=0.5,
            stitch_length_max_mm=12.0,
            row_spacing_mm=2.0,
            density=1.0,
            underlay=False,
            contour_count=0,
            pull_compensation_mm=0.0,
            cross_method="auto",
            cross_pattern_size_mm=2.0,
            cross_coverage=0.5,
            cross_align_grid=True,
            cross_grid_offset_x_mm=0.0,
            cross_grid_offset_y_mm=0.0,
            cross_detail_boost=0.5,
        )
```

In `MainWindow._quantize_and_segment`, pass the project mode:

```python
            layers = self.image_engine.build_layers_from_regions(
                regions,
                all_threads,
                processed,
                self.project.generation_mode,
            )
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2. Expected: `OK`.

---

### Task 3: Coverage-Based Cross-Stitch Cell Selection

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `StitchSettings.cross_pattern_size_mm`
- Consumes: `StitchSettings.cross_coverage`
- Consumes: `StitchSettings.cross_align_grid`
- Consumes: `StitchSettings.cross_grid_offset_x_mm`
- Consumes: `StitchSettings.cross_grid_offset_y_mm`
- Produces: `StitchEngine._cross_stitch_cells(mask: np.ndarray, settings: StitchSettings) -> List[Tuple[float, float, float, float]]`

- [ ] **Step 1: Write failing tests**

Add these tests:

```python
    def test_cross_stitch_cells_use_coverage_threshold(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        mask = np.zeros((20, 20), dtype=np.uint8)
        mask[0:10, 0:10] = 255
        mask[10:15, 10:20] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            cross_align_grid=True,
        )

        cells = engine._cross_stitch_cells(mask, settings)

        self.assertEqual(len(cells), 2)

    def test_higher_cross_stitch_coverage_removes_partial_cells(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        mask = np.zeros((20, 20), dtype=np.uint8)
        mask[0:10, 0:10] = 255
        mask[10:15, 10:20] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.75,
            cross_align_grid=True,
        )

        cells = engine._cross_stitch_cells(mask, settings)

        self.assertEqual(len(cells), 1)
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_cells_use_coverage_threshold \
  tests.test_export_paths.ExportPathTests.test_higher_cross_stitch_coverage_removes_partial_cells
```

Expected: fail because `_cross_stitch_cells` does not exist.

- [ ] **Step 3: Implement `_cross_stitch_cells`**

Add to `StitchEngine` near the cross-stitch section:

```python
    def _cross_stitch_cells(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
    ) -> List[Tuple[float, float, float, float]]:
        cell_w = max(1.0, settings.cross_pattern_size_mm * self.px_per_mm)
        cell_h = cell_w
        coverage_threshold = float(np.clip(settings.cross_coverage, 0.0, 1.0))
        offset_x = settings.cross_grid_offset_x_mm * self.px_per_mm
        offset_y = settings.cross_grid_offset_y_mm * self.px_per_mm

        h, w = mask.shape
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return []

        if settings.cross_align_grid:
            start_x = offset_x + np.floor((xs.min() - offset_x) / cell_w) * cell_w
            start_y = offset_y + np.floor((ys.min() - offset_y) / cell_h) * cell_h
        else:
            start_x = float(xs.min()) + offset_x
            start_y = float(ys.min()) + offset_y

        end_x = float(xs.max() + 1)
        end_y = float(ys.max() + 1)
        cells: List[Tuple[float, float, float, float]] = []

        y = start_y
        while y < end_y:
            x = start_x
            while x < end_x:
                ix0 = max(0, int(np.floor(x)))
                iy0 = max(0, int(np.floor(y)))
                ix1 = min(w, int(np.ceil(x + cell_w)))
                iy1 = min(h, int(np.ceil(y + cell_h)))
                if ix1 > ix0 and iy1 > iy0:
                    cell_mask = mask[iy0:iy1, ix0:ix1] > 0
                    coverage = float(np.count_nonzero(cell_mask)) / float(cell_mask.size)
                    if coverage + 1e-9 >= coverage_threshold:
                        cells.append((float(x), float(y), float(cell_w), float(cell_h)))
                x += cell_w
            y += cell_h

        return cells
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2. Expected: `OK`.

---

### Task 4: Cross-Stitch Method Templates

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `StitchEngine._cross_stitch_cells`
- Produces: `StitchEngine._cross_stitch_cell_paths(cell, method, max_segment_px) -> List[List[Tuple[float, float]]]`

- [ ] **Step 1: Write failing tests**

Add these tests:

```python
    def test_cross_stitch_method_templates_emit_distinct_geometry(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        cell = (0.0, 0.0, 10.0, 10.0)

        cross = engine._cross_stitch_cell_paths(cell, "cross", 20.0)
        half = engine._cross_stitch_cell_paths(cell, "half", 20.0)
        upright = engine._cross_stitch_cell_paths(cell, "upright", 20.0)
        double = engine._cross_stitch_cell_paths(cell, "double_cross", 20.0)
        smyrna = engine._cross_stitch_cell_paths(cell, "smyrna", 20.0)

        self.assertEqual(len(cross), 2)
        self.assertEqual(len(half), 1)
        self.assertEqual(len(upright), 2)
        self.assertEqual(len(double), 4)
        self.assertEqual(len(smyrna), 4)
        self.assertNotEqual(double, smyrna)

    def test_cross_stitch_flipped_template_swaps_diagonal_direction(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        cell = (0.0, 0.0, 10.0, 10.0)

        normal = engine._cross_stitch_cell_paths(cell, "half", 20.0)
        flipped = engine._cross_stitch_cell_paths(cell, "half_flipped", 20.0)

        self.assertNotEqual(normal, flipped)
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_method_templates_emit_distinct_geometry \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_flipped_template_swaps_diagonal_direction
```

Expected: fail because `_cross_stitch_cell_paths` does not exist.

- [ ] **Step 3: Implement templates**

Add helper methods:

```python
    def _cross_stitch_cell_paths(
        self,
        cell: Tuple[float, float, float, float],
        method: str,
        max_segment_px: float,
    ) -> List[List[Tuple[float, float]]]:
        x, y, w, h = cell
        tl = (x, y)
        tr = (x + w, y)
        br = (x + w, y + h)
        bl = (x, y + h)
        ml = (x, y + h / 2.0)
        mt = (x + w / 2.0, y)
        mr = (x + w, y + h / 2.0)
        mb = (x + w / 2.0, y + h)

        diagonal_a = [tl, br]
        diagonal_b = [tr, bl]
        if "flipped" in method:
            diagonal_a, diagonal_b = diagonal_b, diagonal_a

        upright_paths = [[ml, mr], [mt, mb]]
        cross_paths = [diagonal_a, diagonal_b]

        if method.startswith("half"):
            return [self._segmentized_path(diagonal_a, max_segment_px)]
        if method.startswith("upright") and "double" not in method and "smyrna" not in method:
            return [self._segmentized_path(path, max_segment_px) for path in upright_paths]
        if "double_cross" in method:
            paths = upright_paths + cross_paths
            return [self._segmentized_path(path, max_segment_px) for path in paths]
        if "smyrna" in method:
            paths = cross_paths + upright_paths
            return [self._segmentized_path(path, max_segment_px) for path in paths]
        return [self._segmentized_path(path, max_segment_px) for path in cross_paths]

    def _segmentized_path(
        self,
        coords: List[Tuple[float, float]],
        max_len: float,
    ) -> List[Tuple[float, float]]:
        if len(coords) < 2:
            return coords
        line = LineString(coords).segmentize(max(max_len, 1e-6))
        return [(float(x), float(y)) for x, y in line.coords]
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2. Expected: `OK`.

---

### Task 5: Coverage Generator And Automatic Method Selection

**Files:**
- Modify: `stitch_studio/core/stitch_engine.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes: `_cross_stitch_cells`
- Consumes: `_cross_stitch_cell_paths`
- Produces: `StitchEngine._choose_cross_stitch_method(mask, settings, image=None) -> str`
- Produces: `_generate_cross_stitch_fill(mask, settings, image=None) -> List[Tuple[float, float]]`

- [ ] **Step 1: Write failing tests**

Add these tests:

```python
    def test_cross_stitch_fill_generates_coverage_based_paths_in_scene_units(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        mask = np.zeros((20, 20), dtype=np.uint8)
        mask[:, :] = 255
        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            cross_align_grid=True,
            stitch_length_max_mm=12.0,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertGreaterEqual(len(paths), 8)
        flat = [pt for path in paths for pt in path]
        self.assertIn((0.0, 0.0), flat)
        self.assertIn((10.0, 10.0), flat)

    def test_cross_stitch_auto_method_prefers_half_for_light_low_detail_region(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        mask = np.ones((10, 10), dtype=np.uint8) * 255
        image = np.full((10, 10, 3), 238, dtype=np.uint8)
        settings = project_mod.StitchSettings(fill_mode="cross_stitch", cross_method="auto")

        self.assertEqual(engine._choose_cross_stitch_method(mask, settings, image), "half")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_fill_generates_coverage_based_paths_in_scene_units \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_auto_method_prefers_half_for_light_low_detail_region
```

Expected: fail because generator still uses old fixed-X logic and auto chooser does not exist.

- [ ] **Step 3: Implement chooser and generator**

Change `_dispatch_fill_paths` cross-stitch branch:

```python
        if mode == "cross_stitch":
            return self._generate_cross_stitch_paths(mask, settings, image)
```

Replace `_generate_cross_stitch_fill` with path-aware helpers:

```python
    def _generate_cross_stitch_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
    ) -> List[List[Tuple[float, float]]]:
        method = settings.cross_method
        if method == "auto":
            method = self._choose_cross_stitch_method(mask, settings, image)
        max_segment_px = settings.stitch_length_max_mm * self.px_per_mm
        cells = self._cross_stitch_cells(mask, settings)
        paths: List[List[Tuple[float, float]]] = []

        rows = {}
        for cell in cells:
            rows.setdefault(round(cell[1], 6), []).append(cell)

        for row_index, row_y in enumerate(sorted(rows)):
            row = sorted(rows[row_y], key=lambda c: c[0], reverse=bool(row_index % 2))
            for cell in row:
                paths.extend(self._cross_stitch_cell_paths(cell, method, max_segment_px))

        if method.startswith("dense_upright"):
            half = max(1.0, settings.cross_pattern_size_mm * self.px_per_mm / 2.0)
            dense_settings = StitchSettings.from_dict(settings.to_dict())
            dense_settings.cross_grid_offset_x_mm += half / self.px_per_mm
            dense_settings.cross_grid_offset_y_mm += half / self.px_per_mm
            for cell in self._cross_stitch_cells(mask, dense_settings):
                paths.extend(self._cross_stitch_cell_paths(cell, "upright_flipped" if "flipped" in method else "upright", max_segment_px))

        return [path for path in paths if len(path) >= 2]

    def _generate_cross_stitch_fill(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
    ) -> List[Tuple[float, float]]:
        return [pt for path in self._generate_cross_stitch_paths(mask, settings, image) for pt in path]

    def _choose_cross_stitch_method(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
    ) -> str:
        binary = mask > 0
        area = int(np.count_nonzero(binary))
        if area <= 0:
            return "cross"
        ys, xs = np.where(binary)
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        aspect = max(width, height) / max(1, min(width, height))
        boost = float(np.clip(settings.cross_detail_boost, 0.0, 1.0))

        if image is None or image.shape[:2] != mask.shape:
            return "cross"

        pixels = image[binary, :3].astype(np.float64)
        median = np.median(pixels, axis=0)
        luminance = 0.299 * median[0] + 0.587 * median[1] + 0.114 * median[2]
        chroma = float(median.max() - median.min())
        gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_RGB2GRAY)
        gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        contrast = float(np.median(np.hypot(gx[binary], gy[binary]))) if area else 0.0
        orthogonal = float(np.mean(np.abs(gx[binary]) + np.abs(gy[binary]))) if area else 0.0

        if area <= 24 and contrast >= 28:
            return "smyrna" if boost >= 0.45 else "cross"
        if luminance >= 220 and contrast < 24:
            return "half"
        if orthogonal >= 42 and aspect >= 1.4:
            return "upright"
        if contrast >= 42 and boost >= 0.65:
            return "dense_upright"
        if luminance <= 85 or (chroma >= 80 and boost >= 0.45):
            return "double_cross"
        return "cross"
```

In `generate_region_paths`, update the cross-stitch dispatch call to pass `image` and avoid underlay/contour for cross-stitch:

```python
        if settings.underlay and settings.fill_mode not in ("run", "cross_stitch"):
```

and:

```python
        if settings.contour_count > 0 and settings.fill_mode not in ("run", "cross_stitch"):
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2. Expected: `OK`.

---

### Task 6: UI Controls For Generation Target And Cross-Stitch Settings

**Files:**
- Modify: `stitch_studio/ui/panels.py`
- Modify: `stitch_studio/ui/main_window.py`
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Produces: `ImagePanel.get_generation_mode() -> str`
- Produces: `ImagePanel.set_generation_mode(mode: str) -> None`
- Produces: Properties panel cross controls mapped to `StitchSettings`

- [ ] **Step 1: Write failing tests**

Add these tests:

```python
    def test_image_panel_exposes_generation_mode_choice(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        panels_mod = importlib.import_module("stitch_studio.ui.panels")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        panel = panels_mod.ImagePanel()

        self.assertEqual(panel.get_generation_mode(), "photo_stitch")
        panel.set_generation_mode("cross_stitch")
        self.assertEqual(panel.get_generation_mode(), "cross_stitch")

    def test_properties_panel_round_trips_cross_stitch_settings(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        project_mod = importlib.import_module("stitch_studio.core.project")
        panels_mod = importlib.import_module("stitch_studio.ui.panels")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        panel = panels_mod.PropertiesPanel()
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="double_cross",
            cross_pattern_size_mm=3.0,
            cross_coverage=0.7,
            cross_align_grid=False,
            cross_grid_offset_x_mm=0.5,
            cross_grid_offset_y_mm=0.25,
            cross_detail_boost=0.8,
        )
        seen = []
        panel.settings_changed.connect(lambda uid, s: seen.append(s))

        panel.set_settings("region-1", settings)
        panel.spin_cross_pattern.setValue(3.5)

        self.assertTrue(seen)
        self.assertAlmostEqual(seen[-1].cross_pattern_size_mm, 3.5)
        self.assertEqual(seen[-1].cross_method, "double_cross")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_image_panel_exposes_generation_mode_choice \
  tests.test_export_paths.ExportPathTests.test_properties_panel_round_trips_cross_stitch_settings
```

Expected: fail because UI controls do not exist.

- [ ] **Step 3: Implement ImagePanel controls**

In `ImagePanel._build_ui`, add a `Generation Target` group before `Color Quantization`:

```python
        grp_target = QGroupBox("Generation Target")
        tl = QHBoxLayout(grp_target)
        self.combo_generation_mode = QComboBox()
        self.combo_generation_mode.addItem("Photo Stitch", "photo_stitch")
        self.combo_generation_mode.addItem("Cross Stitch", "cross_stitch")
        tl.addWidget(self.combo_generation_mode)
        layout.addWidget(grp_target)
```

Add methods:

```python
    def get_generation_mode(self) -> str:
        return self.combo_generation_mode.currentData() or "photo_stitch"

    def set_generation_mode(self, mode: str):
        for idx in range(self.combo_generation_mode.count()):
            if self.combo_generation_mode.itemData(idx) == mode:
                self.combo_generation_mode.setCurrentIndex(idx)
                return
        self.combo_generation_mode.setCurrentIndex(0)
```

- [ ] **Step 4: Implement PropertiesPanel cross controls**

In `PropertiesPanel._build_ui`, add a `Cross Stitch` group before `layout.addStretch()`:

```python
        grp_cross = QGroupBox("Cross Stitch")
        xl = QGridLayout(grp_cross)
        xl.addWidget(QLabel("Method:"), 0, 0)
        self.combo_cross_method = QComboBox()
        self.combo_cross_method.addItems([
            "auto", "cross", "cross_flipped", "half", "half_flipped",
            "upright", "upright_flipped", "dense_upright", "dense_upright_flipped",
            "double_cross", "upright_double_cross", "smyrna", "upright_smyrna",
        ])
        self.combo_cross_method.currentTextChanged.connect(self._on_changed)
        xl.addWidget(self.combo_cross_method, 0, 1)

        xl.addWidget(QLabel("Pattern (mm):"), 1, 0)
        self.spin_cross_pattern = QDoubleSpinBox()
        self.spin_cross_pattern.setRange(0.5, 12.0)
        self.spin_cross_pattern.setSingleStep(0.1)
        self.spin_cross_pattern.setDecimals(1)
        self.spin_cross_pattern.valueChanged.connect(self._on_changed)
        xl.addWidget(self.spin_cross_pattern, 1, 1)

        xl.addWidget(QLabel("Coverage:"), 2, 0)
        self.spin_cross_coverage = QDoubleSpinBox()
        self.spin_cross_coverage.setRange(0.05, 1.0)
        self.spin_cross_coverage.setSingleStep(0.05)
        self.spin_cross_coverage.setDecimals(2)
        self.spin_cross_coverage.valueChanged.connect(self._on_changed)
        xl.addWidget(self.spin_cross_coverage, 2, 1)

        self.chk_cross_align = QCheckBox("Align grid with canvas")
        self.chk_cross_align.stateChanged.connect(self._on_changed)
        xl.addWidget(self.chk_cross_align, 3, 0, 1, 2)

        xl.addWidget(QLabel("Offset X:"), 4, 0)
        self.spin_cross_offset_x = QDoubleSpinBox()
        self.spin_cross_offset_x.setRange(-50.0, 50.0)
        self.spin_cross_offset_x.setSingleStep(0.1)
        self.spin_cross_offset_x.valueChanged.connect(self._on_changed)
        xl.addWidget(self.spin_cross_offset_x, 4, 1)

        xl.addWidget(QLabel("Offset Y:"), 5, 0)
        self.spin_cross_offset_y = QDoubleSpinBox()
        self.spin_cross_offset_y.setRange(-50.0, 50.0)
        self.spin_cross_offset_y.setSingleStep(0.1)
        self.spin_cross_offset_y.valueChanged.connect(self._on_changed)
        xl.addWidget(self.spin_cross_offset_y, 5, 1)

        xl.addWidget(QLabel("Detail Boost:"), 6, 0)
        self.slider_cross_detail = QSlider(Qt.Horizontal)
        self.slider_cross_detail.setRange(0, 100)
        self.slider_cross_detail.valueChanged.connect(self._on_changed)
        xl.addWidget(self.slider_cross_detail, 6, 1)
        layout.addWidget(grp_cross)
```

In `set_settings`, populate those controls:

```python
        self.combo_cross_method.setCurrentText(settings.cross_method)
        self.spin_cross_pattern.setValue(settings.cross_pattern_size_mm)
        self.spin_cross_coverage.setValue(settings.cross_coverage)
        self.chk_cross_align.setChecked(settings.cross_align_grid)
        self.spin_cross_offset_x.setValue(settings.cross_grid_offset_x_mm)
        self.spin_cross_offset_y.setValue(settings.cross_grid_offset_y_mm)
        self.slider_cross_detail.setValue(int(settings.cross_detail_boost * 100))
```

In `_on_changed`, write back:

```python
        s.cross_method = self.combo_cross_method.currentText()
        s.cross_pattern_size_mm = self.spin_cross_pattern.value()
        s.cross_coverage = self.spin_cross_coverage.value()
        s.cross_align_grid = self.chk_cross_align.isChecked()
        s.cross_grid_offset_x_mm = self.spin_cross_offset_x.value()
        s.cross_grid_offset_y_mm = self.spin_cross_offset_y.value()
        s.cross_detail_boost = self.slider_cross_detail.value() / 100.0
```

- [ ] **Step 5: Wire MainWindow generation mode**

In `_quantize_and_segment`, before building layers:

```python
            self.project.generation_mode = self.image_panel.get_generation_mode()
```

Then pass it to `build_layers_from_regions` as in Task 2.

When loading a project or setting image panel state, call:

```python
            self.image_panel.set_generation_mode(self.project.generation_mode)
```

- [ ] **Step 6: Run tests to verify pass**

Run the same command from Step 2. Expected: `OK`.

---

### Task 7: Focused Regression And Full Test Run

**Files:**
- Test: `tests/test_export_paths.py`

**Interfaces:**
- Consumes all previous task outputs.
- Produces verification evidence.

- [ ] **Step 1: Run cross-stitch focused tests**

Run:

```bash
.venv-codex/bin/python -m unittest \
  tests.test_export_paths.ExportPathTests.test_stitch_settings_include_cross_stitch_defaults \
  tests.test_export_paths.ExportPathTests.test_project_generation_mode_serializes_with_backward_compatible_default \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_generation_mode_sets_region_defaults_to_cross_stitch \
  tests.test_export_paths.ExportPathTests.test_photo_stitch_generation_mode_keeps_existing_region_defaults \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_cells_use_coverage_threshold \
  tests.test_export_paths.ExportPathTests.test_higher_cross_stitch_coverage_removes_partial_cells \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_method_templates_emit_distinct_geometry \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_flipped_template_swaps_diagonal_direction \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_fill_generates_coverage_based_paths_in_scene_units \
  tests.test_export_paths.ExportPathTests.test_cross_stitch_auto_method_prefers_half_for_light_low_detail_region \
  tests.test_export_paths.ExportPathTests.test_image_panel_exposes_generation_mode_choice \
  tests.test_export_paths.ExportPathTests.test_properties_panel_round_trips_cross_stitch_settings
```

Expected: all listed tests pass.

- [ ] **Step 2: Run full suite**

Run:

```bash
.venv-codex/bin/python -m unittest tests.test_export_paths
```

Expected: all tests pass. Existing macOS/PySide pasteboard warnings are acceptable if the command exits with code 0 and reports `OK`.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- stitch_studio/core/project.py stitch_studio/core/image_engine.py stitch_studio/core/stitch_engine.py stitch_studio/ui/panels.py stitch_studio/ui/main_window.py tests/test_export_paths.py
```

Expected: changes are scoped to settings, cross-stitch generation, UI wiring, and tests.

---

## Self-Review

Spec coverage:

- Generation target workflow: covered by Tasks 2 and 6.
- Cross-stitch data model: covered by Task 1.
- Grid and coverage: covered by Task 3.
- Method templates: covered by Task 4.
- Automatic method selection: covered by Task 5.
- UI design: covered by Task 6.
- Error handling basics: covered by clamping in Tasks 3 and 5.
- Testing: covered by Task 7.

No unresolved placeholders remain. Type names and method names are consistent across tasks.
