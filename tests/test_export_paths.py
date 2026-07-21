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

    def test_region_scale_stitches_updates_paths_and_points(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)], [(10.0, 10.0), (0.0, 10.0)]]
        region.stitch_points = [pt for path in region.stitch_paths for pt in path]

        region.scale_stitches(2.0)

        self.assertEqual(region.stitch_paths[0], [(-5.0, -5.0), (15.0, -5.0)])
        self.assertEqual(region.stitch_paths[1], [(15.0, 15.0), (-5.0, 15.0)])
        self.assertEqual(region.stitch_points, [pt for path in region.stitch_paths for pt in path])

    def test_layer_scale_stitches_updates_all_regions_around_layer_center(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        layer = project_mod.Layer()
        left = project_mod.Region()
        right = project_mod.Region()
        left.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        right.stitch_paths = [[(20.0, 0.0), (30.0, 0.0)]]
        layer.regions = [left, right]

        layer.scale_stitches(0.5)

        self.assertEqual(left.stitch_paths, [[(7.5, 0.0), (12.5, 0.0)]])
        self.assertEqual(right.stitch_paths, [[(17.5, 0.0), (22.5, 0.0)]])

    def test_region_translate_stitches_updates_paths_and_points(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)], [(10.0, 10.0), (0.0, 10.0)]]
        region.stitch_points = [pt for path in region.stitch_paths for pt in path]

        region.translate_stitches(3.0, -2.0)

        self.assertEqual(region.stitch_paths[0], [(3.0, -2.0), (13.0, -2.0)])
        self.assertEqual(region.stitch_paths[1], [(13.0, 8.0), (3.0, 8.0)])
        self.assertEqual(region.stitch_points, [pt for path in region.stitch_paths for pt in path])

    def test_layer_translate_stitches_updates_all_visible_regions(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        layer = project_mod.Layer()
        visible = project_mod.Region()
        hidden = project_mod.Region(visible=False)
        visible.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        hidden.stitch_paths = [[(20.0, 0.0), (30.0, 0.0)]]
        layer.regions = [visible, hidden]

        layer.translate_stitches(-4.0, 6.0)

        self.assertEqual(visible.stitch_paths, [[(-4.0, 6.0), (6.0, 6.0)]])
        self.assertEqual(hidden.stitch_paths, [[(20.0, 0.0), (30.0, 0.0)]])

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

    def test_tiny_contrasting_source_color_becomes_own_layer(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Navy", color_rgb=(32, 38, 93)),
            thread_mod.ThreadColor(name="Orange", color_rgb=(255, 140, 0)),
        ]
        source = np.full((256, 256, 3), 255, dtype=np.uint8)
        navy = np.zeros((256, 256), dtype=np.uint8)
        orange = np.zeros((256, 256), dtype=np.uint8)
        navy[170:220, 180:230] = 255
        orange[185:189, 229:233] = 255
        source[navy > 0] = (32, 38, 93)
        source[orange > 0] = (255, 140, 0)

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, navy), (1, orange)],
            palette,
            source,
        )

        self.assertEqual({layer.thread_name for layer in layers}, {"Navy", "Orange"})

    def test_tiny_neutral_antialias_region_merges_into_colored_neighbor(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Navy", color_rgb=(32, 38, 93)),
            thread_mod.ThreadColor(name="Light Gray", color_rgb=(167, 169, 191)),
        ]
        source = np.full((256, 256, 3), 255, dtype=np.uint8)
        navy = np.zeros((256, 256), dtype=np.uint8)
        gray = np.zeros((256, 256), dtype=np.uint8)
        navy[170:220, 180:230] = 255
        gray[166:170, 190:206] = 255
        source[navy > 0] = (32, 38, 93)
        source[gray > 0] = (167, 169, 191)

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, navy), (1, gray)],
            palette,
            source,
        )

        self.assertEqual([layer.thread_name for layer in layers], ["Navy"])
        self.assertEqual(
            sum(int(np.count_nonzero(region.mask)) for region in layers[0].regions),
            int(np.count_nonzero(navy)),
        )

    def test_region_mask_preview_renders_zoomed_diagonal_as_straight_antialias(self):
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        mask = np.zeros((256, 256), dtype=np.uint8)
        for y in range(130, 225):
            x0 = 255 - int((y - 130) * 0.55)
            mask[y, x0:256] = 255

        rgba, item_scale = canvas_mod._render_region_mask_rgba(
            mask,
            (32, 38, 93),
            opacity=1.0,
            scale=5.0,
        )
        alpha = rgba[:, :, 3]
        rows = []
        edges = []
        for y in range(130 * 5, 225 * 5):
            xs = np.flatnonzero(alpha[y] > 127)
            if xs.size:
                rows.append(y)
                edges.append(xs.min())

        slope, intercept = np.polyfit(np.asarray(rows), np.asarray(edges), 1)
        residuals = np.abs(np.asarray(edges) - (slope * np.asarray(rows) + intercept))

        self.assertEqual(rgba.shape, (1280, 1280, 4))
        self.assertAlmostEqual(item_scale, 1.0)
        self.assertLess(float(residuals.max()), 2.0)
        self.assertTrue(np.any((alpha > 0) & (alpha < 255)))

    def test_canvas_plain_left_drag_starts_panning(self):
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")
        qt_core = importlib.import_module("PySide6.QtCore")

        self.assertTrue(
            canvas_mod.EmbroideryCanvas._is_pan_gesture(
                qt_core.Qt.LeftButton,
                qt_core.Qt.NoModifier,
            )
        )

    def test_canvas_scene_rect_includes_pan_margin(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        canvas.resize(400, 300)
        canvas.set_background_image(np.full((64, 64, 3), 255, dtype=np.uint8), (64, 64))
        app.processEvents()

        content = canvas.scene.itemsBoundingRect()
        scene_rect = canvas.scene.sceneRect()

        self.assertLess(scene_rect.left(), content.left())
        self.assertGreater(scene_rect.right(), content.right())
        self.assertLess(scene_rect.top(), content.top())
        self.assertGreater(scene_rect.bottom(), content.bottom())

    def test_canvas_region_preview_uses_vector_polygon_when_available(self):
        from shapely.geometry import Polygon

        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        mask = np.zeros((80, 80), dtype=np.uint8)
        mask[20:70, 10:70] = 255
        polygon = Polygon([(40, 70), (70, 70), (70, 20)])

        canvas.set_region_mask(
            "region-1",
            mask,
            (32, 38, 93),
            scale=2.0,
            polygon=polygon,
        )
        app.processEvents()

        item = canvas._mask_items["region-1"]
        self.assertEqual(item.__class__.__name__, "RegionPolygonItem")
        self.assertGreaterEqual(item.boundingRect().left(), 79.0)
        self.assertLessEqual(item.boundingRect().right(), 141.0)

    def test_canvas_region_preview_keeps_large_base_masks_behind_small_details(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        small = np.zeros((100, 100), dtype=np.uint8)
        small[20:40, 20:40] = 255
        large = np.zeros((100, 100), dtype=np.uint8)
        large[5:95, 5:95] = 255

        canvas.set_region_mask("small-green", small, (80, 200, 80), scale=1.0)
        canvas.set_region_mask("large-black", large, (0, 0, 0), scale=1.0)
        app.processEvents()

        self.assertLess(
            canvas._mask_items["large-black"].zValue(),
            canvas._mask_items["small-green"].zValue(),
        )

    def test_canvas_stitch_region_item_is_selectable_and_emits_uid(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        selected = []
        canvas.object_selected.connect(selected.append)

        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (10.0, 0.0)],
                "paths": [[(0.0, 0.0), (10.0, 0.0)]],
                "color": (10, 20, 30),
            }],
        )

        item = canvas._object_items["region-1"]
        item.setSelected(True)
        app.processEvents()

        self.assertTrue(item.flags() & canvas_mod.QGraphicsItem.ItemIsSelectable)
        self.assertEqual(selected[-1], "region-1")

    def test_canvas_stitch_items_use_device_cache_for_large_design_interaction(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)],
                "paths": [[(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)]],
                "color": (10, 20, 30),
            }],
        )
        app.processEvents()

        object_item = canvas._object_items["region-1"]
        path_item = next(
            child for child in object_item.childItems()
            if child.__class__.__name__ == "StitchPathItem"
        )

        self.assertEqual(
            object_item.cacheMode(),
            canvas_mod.QGraphicsItem.DeviceCoordinateCache,
        )
        self.assertEqual(
            path_item.cacheMode(),
            canvas_mod.QGraphicsItem.DeviceCoordinateCache,
        )

    def test_canvas_arrow_key_moves_selected_stitch_object(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        qt_core = importlib.import_module("PySide6.QtCore")
        qt_gui = importlib.import_module("PySide6.QtGui")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        moves = []
        canvas.object_move_requested.connect(lambda uid, dx, dy: moves.append((uid, dx, dy)))
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (10.0, 0.0)],
                "paths": [[(0.0, 0.0), (10.0, 0.0)]],
                "color": (10, 20, 30),
            }],
        )
        canvas.select_object("region-1")

        event = qt_gui.QKeyEvent(
            qt_core.QEvent.KeyPress,
            qt_core.Qt.Key_Right,
            qt_core.Qt.NoModifier,
        )
        canvas.keyPressEvent(event)
        app.processEvents()

        self.assertEqual(moves[-1], ("region-1", 10.0, 0.0))

    def test_canvas_selection_shows_mouse_resize_handles(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)],
                "paths": [[(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)]],
                "color": (10, 20, 30),
            }],
        )

        canvas.select_object("region-1")
        app.processEvents()

        self.assertIsNotNone(canvas._selection_box_item)
        self.assertEqual(len(canvas._resize_handle_items), 8)

    def test_canvas_resize_handle_emits_new_bounds_for_selected_region(self):
        qt_core = importlib.import_module("PySide6.QtCore")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        resized = []
        canvas.object_resize_requested.connect(
            lambda uid, rect: resized.append((uid, rect))
        )
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)],
                "paths": [[(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)]],
                "color": (10, 20, 30),
            }],
        )
        canvas.select_object("region-1")
        start_rect = canvas._selection_box_item.rect()

        handle = next(item for item in canvas._resize_handle_items if item.role == "se")
        handle.setPos(qt_core.QPointF(30.0, 18.0))
        handle.mouseReleaseEvent(None)
        app.processEvents()

        self.assertEqual(resized[0][0], "region-1")
        self.assertEqual(resized[0][1], (start_rect.left(), start_rect.top(), 30.0, 18.0))

    def test_canvas_selection_box_drag_emits_move_for_selected_region(self):
        qt_core = importlib.import_module("PySide6.QtCore")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        moves = []
        canvas.object_move_requested.connect(lambda uid, dx, dy: moves.append((uid, dx, dy)))
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)],
                "paths": [[(0.0, 0.0), (20.0, 0.0), (20.0, 10.0)]],
                "color": (10, 20, 30),
            }],
        )
        canvas.select_object("region-1")

        canvas._selection_box_item.setPos(qt_core.QPointF(12.0, -4.0))
        canvas._finish_selection_box_drag()
        app.processEvents()

        self.assertEqual(moves[-1], ("region-1", 12.0, -4.0))

    def test_canvas_double_click_region_requests_boundary_edit(self):
        qt_core = importlib.import_module("PySide6.QtCore")
        qt_gui = importlib.import_module("PySide6.QtGui")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        requested = []
        canvas.boundary_edit_requested.connect(requested.append)
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (40.0, 0.0), (40.0, 30.0), (0.0, 30.0)],
                "paths": [[(0.0, 0.0), (40.0, 0.0), (40.0, 30.0), (0.0, 30.0)]],
                "color": (10, 20, 30),
            }],
        )
        canvas.resize(400, 300)
        canvas.fit_to_content()
        scene_pos = canvas._object_items["region-1"].sceneBoundingRect().center()
        view_pos = canvas.mapFromScene(scene_pos)
        event = qt_gui.QMouseEvent(
            qt_core.QEvent.MouseButtonDblClick,
            qt_core.QPointF(view_pos),
            qt_core.Qt.LeftButton,
            qt_core.Qt.LeftButton,
            qt_core.Qt.NoModifier,
        )

        canvas.mouseDoubleClickEvent(event)
        app.processEvents()

        self.assertEqual(requested, ["region-1"])

    def test_main_window_move_region_refreshes_only_affected_layer(self):
        project_mod = importlib.import_module("stitch_studio.core.project")
        main_mod = importlib.import_module("stitch_studio.ui.main_window")

        project = project_mod.Project()
        layer_1 = project_mod.Layer(thread_color_rgb=(10, 20, 30), order=0)
        layer_2 = project_mod.Layer(thread_color_rgb=(40, 50, 60), order=1)
        region_1 = project_mod.Region()
        region_2 = project_mod.Region()
        region_1.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        region_1.stitch_points = [pt for path in region_1.stitch_paths for pt in path]
        region_2.stitch_paths = [[(20.0, 0.0), (30.0, 0.0)]]
        region_2.stitch_points = [pt for path in region_2.stitch_paths for pt in path]
        layer_1.regions = [region_1]
        layer_2.regions = [region_2]
        project.layers = [layer_1, layer_2]

        refreshed = []
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.canvas = types.SimpleNamespace(
            set_layer_stitches=lambda layer_uid, data: refreshed.append(layer_uid),
            select_object=lambda uid: None,
        )
        window.layer_panel = types.SimpleNamespace(
            refresh=lambda: None,
            select_uid=lambda uid: None,
        )
        window.status_info = types.SimpleNamespace(setText=lambda text: None)
        window._update_stats = lambda: None

        window._move_stitch_object(region_1.uid, 5.0, 0.0)

        self.assertEqual(refreshed, [layer_1.uid])

    def test_stitch_worker_sizes_generation_pool_to_available_cpu(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")

        original_cpu_count = main_mod.os.cpu_count
        try:
            main_mod.os.cpu_count = lambda: 8
            self.assertEqual(main_mod.StitchWorker._generation_worker_count(3), 3)
            self.assertEqual(main_mod.StitchWorker._generation_worker_count(20), 8)
            self.assertEqual(main_mod.StitchWorker._generation_worker_count(1), 1)
        finally:
            main_mod.os.cpu_count = original_cpu_count

    def test_layer_panel_select_uid_expands_parent_and_scrolls_to_region(self):
        qt_core = importlib.import_module("PySide6.QtCore")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        project_mod = importlib.import_module("stitch_studio.core.project")
        panels_mod = importlib.import_module("stitch_studio.ui.panels")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        panel = panels_mod.LayerPanel()
        project = project_mod.Project()
        layer = project_mod.Layer(name="Layer A")
        region = project_mod.Region(name="Region A")
        layer.regions = [region]
        project.layers = [layer]
        panel.set_project(project)
        top = panel.layer_tree.topLevelItem(0)
        top.setExpanded(False)

        panel.select_uid(region.uid)
        app.processEvents()

        self.assertTrue(top.isExpanded())
        self.assertEqual(
            panel.layer_tree.currentItem().data(0, qt_core.Qt.UserRole),
            region.uid,
        )

    def test_image_panel_exposes_generation_mode_choice(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        panels_mod = importlib.import_module("stitch_studio.ui.panels")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        panel = panels_mod.ImagePanel()

        self.assertTrue(panel.btn_photo_stitch.isCheckable())
        self.assertTrue(panel.btn_cross_stitch.isCheckable())
        self.assertTrue(panel.btn_photo_stitch.isChecked())
        self.assertEqual(panel.get_generation_mode(), "photo_stitch")
        self.assertIn("Photo Stitch", panel.btn_quantize.text())
        panel.set_generation_mode("cross_stitch")
        self.assertEqual(panel.get_generation_mode(), "cross_stitch")
        self.assertTrue(panel.btn_cross_stitch.isChecked())
        self.assertIn("Cross Stitch", panel.btn_quantize.text())

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

    def test_canvas_boundary_editor_builds_bezier_controls_from_polygon(self):
        from shapely.geometry import Polygon

        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        polygon = Polygon([(2.0, 4.0), (12.0, 4.0), (8.0, 10.0)])

        canvas.start_boundary_edit("region-1", polygon, scale=3.0)
        app.processEvents()

        self.assertEqual(canvas._boundary_edit_uid, "region-1")
        self.assertEqual(len(canvas._boundary_anchor_items), 3)
        self.assertEqual(len(canvas._boundary_control_items), 6)
        self.assertGreater(canvas._boundary_edit_item.path().elementCount(), 3)

    def test_canvas_boundary_anchor_visual_size_scales_with_canvas_zoom(self):
        from shapely.geometry import Polygon

        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        polygon = Polygon([(2.0, 4.0), (12.0, 4.0), (8.0, 10.0)])
        canvas.start_boundary_edit("region-1", polygon, scale=3.0)
        anchor = canvas._boundary_anchor_items[0]

        before = anchor.visual_diameter_scene * canvas.transform().m11()
        canvas.zoom_in()
        app.processEvents()
        after = anchor.visual_diameter_scene * canvas.transform().m11()

        self.assertGreater(after, before)

    def test_canvas_boundary_anchor_has_larger_drag_hit_target_than_visual_dot(self):
        from shapely.geometry import Polygon

        qt_core = importlib.import_module("PySide6.QtCore")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        polygon = Polygon([(2.0, 4.0), (12.0, 4.0), (8.0, 10.0)])
        canvas.start_boundary_edit("region-1", polygon, scale=3.0)
        anchor = canvas._boundary_anchor_items[0]

        just_outside_dot = qt_core.QPointF(anchor.visual_radius_scene + 1.0, 0.0)

        self.assertTrue(anchor.shape().contains(just_outside_dot))

    def test_canvas_boundary_editor_applies_dragged_anchor_in_source_coordinates(self):
        from shapely.geometry import Polygon

        qt_core = importlib.import_module("PySide6.QtCore")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        applied = []
        canvas.boundary_edit_applied.connect(
            lambda uid, points: applied.append((uid, points))
        )
        polygon = Polygon([(2.0, 4.0), (12.0, 4.0), (12.0, 10.0), (2.0, 10.0)])
        canvas.start_boundary_edit("region-1", polygon, scale=2.0)

        canvas._boundary_anchor_items[0].setPos(qt_core.QPointF(8.0, 12.0))
        canvas.apply_boundary_edit()
        app.processEvents()

        self.assertEqual(applied[0][0], "region-1")
        self.assertAlmostEqual(applied[0][1][0][0], 4.0)
        self.assertAlmostEqual(applied[0][1][0][1], 6.0)
        self.assertIsNone(canvas._boundary_edit_uid)

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

    def test_thin_colored_detail_line_is_preserved_for_fill(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((50, 90), dtype=np.uint8)
        cv2.line(region.mask, (10, 32), (78, 18), 255, thickness=2)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=0,
            pull_compensation_mm=0.0,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertTrue(paths)
        self.assertGreater(sum(len(path) for path in paths), 20)

    def test_hairline_detail_falls_back_to_centerline_fill(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((60, 100), dtype=np.uint8)
        cv2.line(mask, (8, 48), (92, 10), 255, thickness=1)
        settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=0,
            pull_compensation_mm=0.0,
            underlay=False,
        )

        paths = engine._generate_scanline_paths(mask, settings)

        self.assertTrue(paths)
        self.assertGreaterEqual(sum(len(path) for path in paths), 10)

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

    def test_acute_tip_fill_adds_multiple_miter_cap_strokes(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((120, 160), dtype=np.uint8)
        tip = (138, 18)
        cv2.fillPoly(
            region.mask,
            [np.array([[16, 96], [76, 44], tip, [88, 72], [36, 106]], dtype=np.int32)],
            255,
        )
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=0,
            pull_compensation_mm=0.0,
            underlay=False,
        )

        local_paths = engine._generate_acute_tip_fill_paths(
            region.mask,
            region.stitch_settings,
        )
        tip_paths = [
            path for path in local_paths
            if min(np.hypot(x - tip[0], y - tip[1]) for x, y in path) <= 2.0
        ]

        self.assertGreaterEqual(len(tip_paths), 4)

    def test_mask_to_polygon_preserves_large_acute_corner(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((140, 180), dtype=np.uint8)
        acute = np.array([150, 24], dtype=np.float64)
        cv2.fillPoly(
            mask,
            [np.array([[18, 112], [80, 44], acute, [92, 74], [38, 124]], dtype=np.int32)],
            255,
        )

        poly = engine._mask_to_polygon(mask, 0)
        distances = [
            np.hypot(x - acute[0], y - acute[1])
            for x, y in poly.exterior.coords
        ]

        self.assertLess(min(distances), 3.0)

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

    def test_mask_polygon_straightens_long_pixel_stair_diagonal(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((256, 256), dtype=np.uint8)
        for y in range(130, 225):
            x0 = 255 - int((y - 130) * 0.55)
            mask[y, x0:256] = 255

        poly = engine._mask_to_polygon(mask, compensation_mm=0.0)
        coords = np.asarray(poly.exterior.coords[:-1])
        edges = []
        for idx, start in enumerate(coords):
            end = coords[(idx + 1) % len(coords)]
            dx = abs(float(end[0] - start[0]))
            dy = abs(float(end[1] - start[1]))
            length = float(np.hypot(dx, dy))
            if dx > 20.0 and dy > 20.0:
                edges.append((length, start, end))

        self.assertEqual(len(edges), 1)
        _, start, end = edges[0]
        self.assertLess(float(min(start[0], end[0])), 206.0)
        self.assertGreater(float(max(start[0], end[0])), 253.0)
        self.assertLess(float(min(start[1], end[1])), 132.0)
        self.assertGreater(float(max(start[1], end[1])), 222.0)

    def test_geometry_engine_reconstructs_stair_edge_as_vector_line(self):
        geom_mod = importlib.import_module("stitch_studio.core.geometry_engine")
        mask = np.zeros((256, 256), dtype=np.uint8)
        for y in range(130, 225):
            x0 = 255 - int((y - 130) * 0.55)
            mask[y, x0:256] = 255

        poly = geom_mod.GeometryEngine.reconstruct_region_polygon(mask)
        coords = np.asarray(poly.exterior.coords[:-1])
        diagonal_edges = []
        for idx, start in enumerate(coords):
            end = coords[(idx + 1) % len(coords)]
            dx = abs(float(end[0] - start[0]))
            dy = abs(float(end[1] - start[1]))
            if dx > 20.0 and dy > 20.0:
                diagonal_edges.append((start, end))

        self.assertEqual(len(diagonal_edges), 1)
        self.assertLessEqual(len(coords), 5)

    def test_layer_regions_store_reconstructed_polygon(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [thread_mod.ThreadColor(name="Navy", color_rgb=(32, 38, 93))]
        mask = np.zeros((80, 80), dtype=np.uint8)
        for y in range(20, 62):
            x0 = 60 - int((y - 20) * 0.75)
            mask[y, x0:70] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions([(0, mask)], palette)

        self.assertIsNotNone(layers[0].regions[0].polygon)
        self.assertTrue(layers[0].regions[0].polygon.is_valid)

    def test_scanline_fill_prefers_region_polygon_over_mask_boundary(self):
        from shapely.geometry import Polygon

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((80, 80), dtype=np.uint8)
        region.mask[20:70, 10:70] = 255
        region.polygon = Polygon([(40, 70), (70, 70), (70, 20)])
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="scanline",
            angle_deg=0.0,
            stitch_length_mm=1.0,
            row_spacing_mm=1.0,
            density=1.0,
            contour_count=0,
            pull_compensation_mm=0.0,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)
        xs = [x for path in paths for x, _ in path]
        self.assertTrue(xs)
        self.assertGreater(min(xs), 90.0)

    def test_scanline_fill_does_not_stitch_across_polygon_gap(self):
        from shapely.geometry import Polygon

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((90, 150), dtype=np.uint8)
        mask[20:70, 10:135] = 255
        polygon = Polygon(
            [(10, 20), (135, 20), (135, 70), (10, 70)],
            holes=[[(64, 28), (72, 28), (72, 36), (64, 36)]],
        )
        settings = project_mod.StitchSettings(
            fill_mode="scanline",
            angle_deg=0.0,
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=0,
            pull_compensation_mm=0.0,
            underlay=False,
        )

        paths = engine._generate_scanline_paths(mask, settings, polygon)
        gap = polygon.interiors[0]
        gap_poly = Polygon(gap)
        crossing_segments = 0
        for path in paths:
            for start, end in zip(path, path[1:]):
                segment = stitch_mod.LineString([start, end])
                if segment.crosses(gap_poly) or segment.within(gap_poly):
                    crossing_segments += 1

        self.assertEqual(crossing_segments, 0)

    def test_polygon_acute_tip_fill_adds_fullness_strokes(self):
        from shapely.geometry import Polygon

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((100, 100), dtype=np.uint8)
        polygon = Polygon([(46, 92), (66, 52), (76, 10), (84, 92)])
        settings = project_mod.StitchSettings(
            fill_mode="scanline",
            angle_deg=45.0,
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            contour_count=0,
            pull_compensation_mm=0.0,
            underlay=False,
        )

        paths = engine._generate_acute_tip_fill_paths(mask, settings, polygon)
        near_tip_paths = [
            path for path in paths
            if len(path) >= 2 and any(np.hypot(x - 76.0, y - 10.0) <= 3.0 for x, y in path)
        ]

        self.assertGreaterEqual(len(near_tip_paths), 4)

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

    def test_export_uses_scaled_region_stitch_paths(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        layer.regions = [region]
        project.layers = [layer]

        region.scale_stitches(2.0, origin=(0.0, 0.0))
        pattern = export_mod.ExportEngine().build_pattern(project)
        stitch_points = [
            (x, y)
            for x, y, cmd in pattern.stitches
            if cmd == pyembroidery.STITCH
        ]

        self.assertIn((20.0, 0.0), stitch_points)

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
