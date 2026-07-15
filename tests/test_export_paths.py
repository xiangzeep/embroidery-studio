import importlib
import os
import sys
import tempfile
import types
import unittest
import numpy as np


def install_fake_pyembroidery():
    fake = types.ModuleType("pyembroidery")
    fake.STITCH = 0
    fake.JUMP = 1
    fake.TRIM = 2
    fake.COLOR_BREAK = 3
    fake.COLOR_CHANGE = 4
    fake.END = 5

    class EmbThread:
        def __init__(self):
            self.color = 0
            self.name = ""
            self.catalog_number = ""

    class EmbPattern:
        def __init__(self):
            self.extras = {}
            self.threadlist = []
            self.stitches = []

        def add_thread(self, thread):
            self.threadlist.append(thread)

        def add_stitch_absolute(self, cmd, x, y):
            self.stitches.append((x, y, cmd))

        def fix_color_count(self):
            pass

        def bounds(self):
            pts = [(x, y) for x, y, cmd in self.stitches if cmd != fake.END]
            if not pts:
                return None
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return min(xs), min(ys), max(xs), max(ys)

    fake.EmbThread = EmbThread
    fake.EmbPattern = EmbPattern
    fake.write = lambda pattern, filepath, settings=None: None
    sys.modules["pyembroidery"] = fake
    return fake


class ExportPathTests(unittest.TestCase):
    def test_export_preserves_region_path_boundaries_as_jumps(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        region = project_mod.Region()
        region.stitch_paths = [
            [(0.0, 0.0), (10.0, 0.0)],
            [(100.0, 0.0), (110.0, 0.0)],
        ]
        region.stitch_points = [pt for path in region.stitch_paths for pt in path]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)
        commands = [cmd for _, _, cmd in pattern.stitches]

        self.assertEqual(
            commands[:4],
            [
                pyembroidery.JUMP,
                pyembroidery.STITCH,
                pyembroidery.JUMP,
                pyembroidery.STITCH,
            ],
        )


    def test_region_can_store_path_boundaries_for_preview_and_export(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (1.0, 0.0)]]

        self.assertEqual(region.stitch_paths, [[(0.0, 0.0), (1.0, 0.0)]])

    def test_run_components_heal_nearby_line_art_gaps(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((20, 40), dtype=np.uint8)
        mask[10, 2:30] = 255
        raw_paths = [
            [(2.0, 10.0), (8.0, 10.0)],
            [(10.0, 10.0), (18.0, 10.0)],
            [(20.0, 10.0), (29.0, 10.0)],
        ]

        merged = engine._assemble_run_components(raw_paths, mask)

        self.assertEqual(len(merged), 1)
        self.assertGreater(engine._polyline_length(merged[0]), 25.0)

    def test_run_generation_restores_line_art_mask_from_source_image(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        image = np.full((30, 50, 3), 255, dtype=np.uint8)
        image[15, 5:45] = (0, 120, 255)

        mask = np.zeros((30, 50), dtype=np.uint8)
        mask[15, 5:18] = 255
        mask[15, 32:45] = 255

        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=2.0,
            underlay=False,
        )

        paths = engine.generate_region_paths(region, image=image)

        self.assertTrue(paths)
        total_length = sum(engine._polyline_length(path) for path in paths)
        self.assertGreater(total_length, 80.0)

    def test_run_component_closed_loop_is_explicitly_closed(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((30, 30), dtype=np.uint8)
        cv = [(10.0, 5.0), (18.0, 8.0), (20.0, 16.0), (12.0, 20.0), (10.8, 5.7)]
        for x, y in cv:
            mask[int(y), int(x)] = 255

        assembled = engine._assemble_run_components([cv], mask)

        self.assertEqual(len(assembled), 1)
        self.assertEqual(assembled[0][0], assembled[0][-1])

    def test_segmentation_skips_border_background(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        image = np.full((20, 20, 3), 255, dtype=np.uint8)
        image[5:15, 8:12] = (0, 90, 255)
        thread_map = np.zeros((20, 20), dtype=np.int32)
        thread_map[5:15, 8:12] = 1

        settings = project_mod.QuantizationSettings(min_region_area_px=1)
        regions = image_mod.ImageEngine.segment_regions(thread_map, settings, image)

        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0][0], 1)
        self.assertEqual(int(np.count_nonzero(regions[0][1])), 40)

    def test_segmentation_preserves_dark_outline_on_canvas(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        image = np.full((40, 40, 3), 52, dtype=np.uint8)
        image[10:30, 10:30] = (0, 0, 0)
        image[14:26, 14:26] = (80, 190, 110)
        thread_map = np.zeros((40, 40), dtype=np.int32)
        thread_map[10:30, 10:30] = 1
        thread_map[14:26, 14:26] = 2

        settings = project_mod.QuantizationSettings(min_region_area_px=1)
        regions = image_mod.ImageEngine.segment_regions(thread_map, settings, image)
        tids = {tid for tid, _ in regions}

        self.assertNotIn(0, tids)
        self.assertIn(1, tids)
        self.assertIn(2, tids)

    def test_segmentation_keeps_black_outline_connected_to_black_canvas(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        image = np.zeros((60, 60, 3), dtype=np.uint8)
        image[12:48, 12:48] = (150, 220, 120)
        image[12:48, 12:15] = (0, 0, 0)
        image[12:48, 45:48] = (0, 0, 0)
        image[12:15, 12:48] = (0, 0, 0)
        image[45:48, 12:48] = (0, 0, 0)
        image[29:32, 14:46] = (0, 0, 0)

        thread_map = np.zeros((60, 60), dtype=np.int32)
        thread_map[12:48, 12:48] = 1
        thread_map[np.all(image == (0, 0, 0), axis=2)] = 0

        regions = image_mod.ImageEngine.segment_regions(
            thread_map,
            project_mod.QuantizationSettings(min_region_area_px=1),
            image,
        )
        black_pixels = sum(int(np.count_nonzero(mask)) for tid, mask in regions if tid == 0)
        green_pixels = sum(int(np.count_nonzero(mask)) for tid, mask in regions if tid == 1)

        self.assertGreater(black_pixels, 250)
        self.assertLess(black_pixels, 700)
        self.assertGreater(green_pixels, 800)

    def test_segmentation_keeps_green_layers_out_of_protected_black_art(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        image = np.zeros((42, 42, 3), dtype=np.uint8)
        image[5:37, 5:37] = (62, 154, 62)
        image[8:34, 19:23] = (0, 0, 0)

        thread_map = np.zeros((42, 42), dtype=np.int32)
        thread_map[5:37, 5:37] = 1
        thread_map[8:34, 19:23] = 0

        regions = image_mod.ImageEngine.segment_regions(
            thread_map,
            project_mod.QuantizationSettings(
                min_region_area_px=1,
                morphology_kernel_size=7,
                smooth_regions=True,
            ),
            image,
        )

        black_union = np.zeros((42, 42), dtype=bool)
        green_union = np.zeros((42, 42), dtype=bool)
        for tid, mask in regions:
            if tid == 0:
                black_union |= mask > 0
            if tid == 1:
                green_union |= mask > 0

        seam = np.zeros((42, 42), dtype=bool)
        seam[8:34, 19:23] = True
        self.assertTrue(np.all(black_union[seam]))
        self.assertFalse(np.any(green_union[seam]))

    def test_quantization_absorbs_dark_antialias_pixels_into_black_outline(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(0, 80, 0)),
            thread_mod.ThreadColor(name="Light Green", color_rgb=(150, 220, 120)),
        ]
        image = np.full((24, 24, 3), (150, 220, 120), dtype=np.uint8)
        image[:, 10:12] = (0, 0, 0)
        image[:, 12:15] = (61, 114, 29)

        thread_map, _ = image_mod.ImageEngine.quantize_to_palette(
            image,
            palette,
            project_mod.QuantizationSettings(n_colors=3),
        )

        self.assertTrue(np.all(thread_map[:, 12:15] == 0))

    def test_quantization_keeps_detached_dark_green_detail_green(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(0, 80, 0)),
            thread_mod.ThreadColor(name="Light Green", color_rgb=(150, 220, 120)),
        ]
        image = np.full((28, 28, 3), (150, 220, 120), dtype=np.uint8)
        image[2:6, 2:6] = (0, 0, 0)
        image[18:24, 18:24] = (61, 114, 29)

        thread_map, _ = image_mod.ImageEngine.quantize_to_palette(
            image,
            palette,
            project_mod.QuantizationSettings(n_colors=3),
        )

        self.assertTrue(np.all(thread_map[18:24, 18:24] == 1))

    def test_quantization_keeps_attached_dark_green_shapes_green(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(0, 80, 0)),
            thread_mod.ThreadColor(name="Light Green", color_rgb=(150, 220, 120)),
        ]
        image = np.full((40, 40, 3), (150, 220, 120), dtype=np.uint8)
        image[:, 10:13] = (0, 0, 0)
        image[12:28, 13:27] = (61, 114, 29)

        thread_map, _ = image_mod.ImageEngine.quantize_to_palette(
            image,
            palette,
            project_mod.QuantizationSettings(n_colors=3),
        )

        self.assertTrue(np.all(thread_map[14:26, 16:25] == 1))

    def test_default_segmentation_keeps_small_dark_detail_regions(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        image = np.full((80, 80, 3), 48, dtype=np.uint8)
        image[22:62, 24:64] = (90, 190, 110)
        image[10:20, 30:45] = (0, 0, 0)
        thread_map = np.zeros((80, 80), dtype=np.int32)
        thread_map[22:62, 24:64] = 2
        thread_map[10:20, 30:45] = 1

        regions = image_mod.ImageEngine.segment_regions(
            thread_map,
            project_mod.QuantizationSettings(),
            image,
        )
        tids = {tid for tid, _ in regions}

        self.assertNotIn(0, tids)
        self.assertIn(1, tids)
        self.assertIn(2, tids)

    def test_compact_dark_detail_defaults_to_scanline_fill(self):
        import cv2

        image_mod = importlib.import_module("stitch_studio.core.image_engine")

        mask = np.zeros((40, 40), dtype=np.uint8)
        cv2.fillPoly(
            mask,
            [np.array([[9, 24], [22, 9], [25, 27]], dtype=np.int32)],
            255,
        )

        settings = image_mod.ImageEngine._default_stitch_settings_for_mask(mask)

        self.assertEqual(settings.fill_mode, "scanline")

    def test_colored_detail_layers_default_to_fill_not_run(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(0, 80, 0)),
        ]
        detail = np.zeros((40, 40), dtype=np.uint8)
        detail[18:21, 6:34] = 255
        detail[21:24, 13:28] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, detail), (1, detail.copy())],
            palette,
        )
        modes = {layer.thread_name: layer.regions[0].stitch_settings.fill_mode for layer in layers}

        self.assertEqual(modes["Black"], "run")
        self.assertEqual(modes["Dark Green"], "scanline")

    def test_wide_black_art_region_defaults_to_fill_not_run(self):
        import cv2

        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0))]
        mask = np.zeros((120, 120), dtype=np.uint8)
        cv2.ellipse(mask, (60, 60), (48, 28), -20, 0, 360, 255, thickness=6)
        cv2.line(mask, (18, 70), (100, 42), 255, 6)

        layers = image_mod.ImageEngine.build_layers_from_regions([(0, mask)], palette)

        self.assertEqual(layers[0].regions[0].stitch_settings.fill_mode, "scanline")

    def test_black_detail_layer_stitches_after_green_fills(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            thread_mod.ThreadColor(name="Light Green", color_rgb=(150, 220, 120)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(0, 90, 0)),
        ]
        black = np.zeros((80, 80), dtype=np.uint8)
        black[8:72, 8:14] = 255
        black[34:40, 8:72] = 255
        light = np.zeros((80, 80), dtype=np.uint8)
        light[14:72, 14:72] = 255
        dark = np.zeros((80, 80), dtype=np.uint8)
        dark[20:32, 20:44] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, black), (1, light), (2, dark)],
            palette,
        )

        self.assertEqual(layers[-1].thread_name, "Black")
        self.assertGreater(layers[-1].order, layers[0].order)

    def test_tiny_real_color_layers_are_not_merged_away(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Light Green", color_rgb=(110, 220, 130)),
            thread_mod.ThreadColor(name="Mid Green", color_rgb=(40, 175, 60)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(15, 110, 30)),
        ]
        mask_large = np.zeros((100, 100), dtype=np.uint8)
        mask_large[10:60, 10:60] = 255
        mask_tiny = np.zeros((100, 100), dtype=np.uint8)
        mask_tiny[70:75, 70:75] = 255
        mask_dark = np.zeros((100, 100), dtype=np.uint8)
        mask_dark[80:86, 20:26] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask_large), (1, mask_tiny), (2, mask_dark)],
            palette,
        )

        self.assertEqual({layer.thread_name for layer in layers}, {"Light Green", "Mid Green", "Dark Green"})

    def test_tiny_green_antialias_regions_merge_into_larger_neighbor(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Light Green", color_rgb=(110, 220, 130)),
            thread_mod.ThreadColor(name="Dark Green", color_rgb=(0, 80, 0)),
        ]
        mask_large = np.zeros((100, 100), dtype=np.uint8)
        mask_large[20:60, 20:60] = 255
        mask_sliver = np.zeros((100, 100), dtype=np.uint8)
        mask_sliver[44:48, 55:60] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask_large), (1, mask_sliver)],
            palette,
        )

        self.assertEqual([layer.thread_name for layer in layers], ["Light Green"])

    def test_layers_use_source_region_color_for_quantized_preview(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Thread Green", color_rgb=(110, 220, 130)),
        ]
        source = np.full((20, 20, 3), (95, 158, 88), dtype=np.uint8)
        mask = np.zeros((20, 20), dtype=np.uint8)
        mask[4:16, 4:16] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask)],
            palette,
            source,
        )

        self.assertEqual(layers[0].thread_name, "Thread Green")
        self.assertEqual(layers[0].thread_color_rgb, (95, 158, 88))

    def test_scanline_fill_chains_rows_to_reduce_jumps(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((40, 40), dtype=np.uint8)
        mask[8:32, 8:32] = 255
        settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.5,
            density=1.0,
        )

        paths = engine._generate_scanline_paths(mask, settings)

        self.assertLessEqual(len(paths), 2)
        self.assertGreater(sum(len(path) for path in paths), 8)

    def test_default_fill_settings_are_dense_and_compensated(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")

        mask = np.zeros((60, 60), dtype=np.uint8)
        mask[10:50, 14:46] = 255

        settings = image_mod.ImageEngine._default_stitch_settings_for_mask(mask)

        self.assertEqual(settings.fill_mode, "scanline")
        self.assertLessEqual(settings.row_spacing_mm, 0.20)
        self.assertGreaterEqual(settings.density, 1.35)
        self.assertGreaterEqual(settings.pull_compensation_mm, 0.18)
        self.assertGreaterEqual(settings.contour_count, 1)

    def test_scanline_regions_include_edge_contour_for_fullness(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((40, 40), dtype=np.uint8)
        region.mask[10:30, 10:30] = 255
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.3,
            density=1.0,
            contour_count=1,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertGreater(len(paths), 1)

    def test_small_scanline_details_get_reinforcing_fill_pass(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((60, 60), dtype=np.uint8)
        cv2.fillPoly(
            region.mask,
            [np.array([[8, 50], [22, 16], [30, 45]], dtype=np.int32)],
            255,
        )
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=1,
            pull_compensation_mm=0.22,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertGreaterEqual(len(paths), 3)
        self.assertGreater(sum(len(path) for path in paths), 280)

    def test_large_scanline_shape_adds_local_fill_for_acute_tip(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((100, 140), dtype=np.uint8)
        cv2.fillPoly(
            region.mask,
            [np.array([[10, 75], [42, 35], [122, 10], [96, 42], [36, 88]], dtype=np.int32)],
            255,
        )
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=1,
            pull_compensation_mm=0.22,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertGreaterEqual(len(paths), 3)

    def test_mask_polygon_regularizes_jagged_edges(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((40, 40), dtype=np.uint8)
        for y in range(8, 32):
            x0 = 8 + (y % 3)
            x1 = 32 - (y % 2)
            mask[y, x0:x1] = 255

        poly = engine._mask_to_polygon(mask, compensation_mm=0.25)

        self.assertIsNotNone(poly)
        self.assertTrue(poly.is_valid)
        self.assertGreater(poly.area, float(np.count_nonzero(mask)) * 0.90)
        self.assertLess(len(poly.exterior.coords), 140)

    def test_mask_polygon_smooths_large_curved_surface(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((90, 70), dtype=np.uint8)
        for y in range(10, 82):
            center = 35 + int(8 * np.sin(y / 13.0))
            radius = max(4, int(22 - abs(y - 46) * 0.18))
            jag = y % 4
            mask[y, center - radius + jag:center + radius - (jag % 2)] = 255

        poly = engine._mask_to_polygon(mask, compensation_mm=0.0)

        self.assertIsNotNone(poly)
        self.assertTrue(poly.is_valid)
        self.assertGreater(len(poly.exterior.coords), 100)
        coords = np.array(poly.exterior.coords[:-1])
        turns = []
        for i in range(len(coords)):
            p0, p1, p2 = coords[i - 1], coords[i], coords[(i + 1) % len(coords)]
            v1 = p1 - p0
            v2 = p2 - p1
            if np.linalg.norm(v1) < 1e-6 or np.linalg.norm(v2) < 1e-6:
                continue
            cross = v1[0] * v2[1] - v1[1] * v2[0]
            dot = v1[0] * v2[0] + v1[1] * v2[1]
            turns.append(abs(np.arctan2(cross, dot)))

        self.assertLess(max(turns), 1.0)

    def test_small_pointed_detail_keeps_sharp_corner(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((40, 40), dtype=np.uint8)
        cv2.fillPoly(
            mask,
            [np.array([[7, 30], [30, 10], [24, 30]], dtype=np.int32)],
            255,
        )

        poly = engine._mask_to_polygon(mask, compensation_mm=0.0)

        self.assertIsNotNone(poly)
        coords = np.array(poly.exterior.coords[:-1])
        turns = []
        for i in range(len(coords)):
            p0, p1, p2 = coords[i - 1], coords[i], coords[(i + 1) % len(coords)]
            v1 = p1 - p0
            v2 = p2 - p1
            if np.linalg.norm(v1) < 1e-6 or np.linalg.norm(v2) < 1e-6:
                continue
            cross = v1[0] * v2[1] - v1[1] * v2[0]
            dot = v1[0] * v2[0] + v1[1] * v2[1]
            turns.append(abs(np.arctan2(cross, dot)))

        self.assertGreater(max(turns), 1.2)

    def test_export_stitch_connects_nearby_paths_to_reduce_jumps(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        region = project_mod.Region()
        region.stitch_paths = [
            [(0.0, 0.0), (10.0, 0.0)],
            [(12.0, 0.0), (20.0, 0.0)],
        ]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)
        commands = [cmd for _, _, cmd in pattern.stitches]

        self.assertEqual(commands.count(pyembroidery.JUMP), 1)

    def test_export_omits_empty_layers_from_threadlist(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        empty = project_mod.Layer(thread_color_rgb=(255, 255, 255), order=0)
        empty.regions = [project_mod.Region()]
        real = project_mod.Layer(thread_color_rgb=(0, 0, 255), order=1)
        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        real.regions = [region]
        project.layers = [empty, real]

        pattern = export_mod.ExportEngine().build_pattern(project)

        self.assertEqual(len(pattern.threadlist), 1)
        self.assertEqual(pattern.threadlist[0].color, 0x0000FF)

    def test_export_uses_color_change_between_drawable_layers(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        for idx, color in enumerate([(0, 0, 0), (0, 255, 0)]):
            layer = project_mod.Layer(thread_color_rgb=color, order=idx)
            region = project_mod.Region()
            region.stitch_paths = [[(0.0, idx * 10.0), (10.0, idx * 10.0)]]
            layer.regions = [region]
            project.layers.append(layer)

        pattern = export_mod.ExportEngine().build_pattern(project)
        commands = [cmd for _, _, cmd in pattern.stitches]

        self.assertIn(pyembroidery.COLOR_CHANGE, commands)
        self.assertNotIn(pyembroidery.COLOR_BREAK, commands)

    def test_export_writes_larger_visual_layers_before_small_details(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()

        small = project_mod.Layer(thread_color_rgb=(0, 180, 0), order=0)
        small.name = "Small detail"
        small.thread_name = "Small detail"
        small_region = project_mod.Region()
        small_region.mask = np.zeros((80, 80), dtype=np.uint8)
        small_region.mask[20:28, 20:28] = 255
        small_region.stitch_paths = [[(20.0, 20.0), (28.0, 20.0)]]
        small.regions = [small_region]

        large = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=1)
        large.name = "Large base"
        large.thread_name = "Large base"
        large_region = project_mod.Region()
        large_region.mask = np.zeros((80, 80), dtype=np.uint8)
        large_region.mask[5:75, 5:75] = 255
        large_region.stitch_paths = [[(5.0, 5.0), (75.0, 5.0)]]
        large.regions = [large_region]

        project.layers = [small, large]

        pattern = export_mod.ExportEngine().build_pattern(project)

        self.assertEqual(pattern.threadlist[0].description, "Large base")
        self.assertEqual(pattern.threadlist[1].description, "Small detail")

    def test_export_writes_current_layer_stack_in_reverse_order(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        specs = [
            ("Layer A", 0, (0, 80, 0), (5, 5, 55, 55)),
            ("Layer B", 1, (0, 140, 0), (10, 10, 20, 20)),
            ("Layer C", 2, (0, 0, 0), (15, 15, 45, 45)),
        ]
        for name, order, color, (x1, y1, x2, y2) in specs:
            layer = project_mod.Layer(thread_color_rgb=color, order=order)
            layer.name = name
            layer.thread_name = name
            region = project_mod.Region()
            region.mask = np.zeros((80, 80), dtype=np.uint8)
            region.mask[y1:y2, x1:x2] = 255
            region.stitch_paths = [[(float(x1), float(y1)), (float(x2), float(y1))]]
            layer.regions = [region]
            project.layers.append(layer)

        pattern = export_mod.ExportEngine().build_pattern(project)

        self.assertEqual(
            [thread.description for thread in pattern.threadlist],
            ["Layer C", "Layer B", "Layer A"],
        )

    def test_dst_export_writes_dst_and_edr_color_companion(self):
        fake = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        calls = []

        def capture_write(pattern, filepath, settings=None):
            calls.append((filepath, settings.copy() if settings else {}))

        fake.write = capture_write
        export_mod.pyembroidery.write = capture_write

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(10, 120, 30), order=0)
        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        layer.regions = [region]
        project.layers = [layer]

        with tempfile.TemporaryDirectory() as tmpdir:
            filepath = os.path.join(tmpdir, "bean.dst")
            written_files = export_mod.ExportEngine().export(project, filepath)

        edr_path = os.path.join(tmpdir, "bean.edr")
        self.assertEqual(
            calls,
            [
                (filepath, {"version": "extended"}),
                (edr_path, {}),
            ],
        )
        self.assertEqual(written_files, [filepath, edr_path])

    def test_export_sanitizes_non_ascii_internal_design_name(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        project.name = "豆角"
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)

        self.assertEqual(pattern.extras["name"], "Untitled")

    def test_export_populates_dst_thread_metadata(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(10, 120, 30), order=0)
        layer.thread_name = "深绿"
        layer.name = "Seed shade"
        layer.thread_uid = "thread-001"
        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)
        thread = pattern.threadlist[0]

        self.assertEqual(thread.description, "Seed shade")
        self.assertEqual(thread.details, "Seed shade")
        self.assertEqual(thread.chart, "Stitch Studio")
        self.assertEqual(thread.name, "Seed shade")
        self.assertEqual(thread.catalog_number, "thread-001")


if __name__ == "__main__":
    unittest.main()
