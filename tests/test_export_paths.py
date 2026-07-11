import importlib
import sys
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


if __name__ == "__main__":
    unittest.main()
