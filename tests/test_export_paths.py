import importlib
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest

import cv2
import numpy as np
from PIL import Image


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
    loaded_exporter = sys.modules.get("stitch_studio.core.export_engine")
    if loaded_exporter is not None:
        loaded_exporter.pyembroidery = fake
    return fake


def real_synthetic_roundtrip_metrics():
    """Export and decode Task 5 artifacts in a clean, real-pyembroidery process."""
    import pyembroidery

    from stitch_studio.core.export_engine import ExportEngine
    from tests.test_recognition_engine import build_synthetic_face_pipeline

    result = build_synthetic_face_pipeline()
    baseline_result = build_synthetic_face_pipeline(full_cross_baseline=True)
    projects = {
        "enhanced": result["project"],
        "baseline": baseline_result["project"],
    }
    exporter = ExportEngine()
    source = exporter.build_pattern(projects["enhanced"])
    baseline_source = exporter.build_pattern(projects["baseline"])
    metrics = {
        "source": {
            "stitches": len(source.stitches),
            "threads": len(source.threadlist),
            "bounds": exporter._sewn_bounds(source),
        },
        "baseline_source": {
            "stitches": len(baseline_source.stitches),
            "threads": len(baseline_source.threadlist),
            "bounds": exporter._sewn_bounds(baseline_source),
        },
        "overlay_paths": sum(
            len(region.stitch_paths)
            for layer in result["layers"]
            for region in layer.regions
            if region.is_cross_stitch_overlay
        ),
    }
    with tempfile.TemporaryDirectory() as directory:
        for extension in ("pes", "dst"):
            metrics[extension] = {}
            for label, project in projects.items():
                path = os.path.join(
                    directory,
                    f"cross-fidelity-{label}.{extension}",
                )
                exporter.export(project, path)
                decoded = pyembroidery.EmbPattern(path)
                commands = [
                    int(command) & 0xFF
                    for _, _, command in decoded.stitches
                ]
                metrics[extension][label] = {
                    "stitches": len(decoded.stitches),
                    "stitch_commands": commands.count(pyembroidery.STITCH),
                    "jump_commands": commands.count(pyembroidery.JUMP),
                    "threads": len(decoded.threadlist),
                    "bounds": exporter._sewn_bounds(decoded),
                    "end": bool(
                        decoded.stitches
                        and commands[-1] == pyembroidery.END
                    ),
                    "bytes": os.path.getsize(path),
                }
    return metrics


class ExportPathTests(unittest.TestCase):
    def test_synthetic_face_cross_fidelity_stays_within_stitch_and_jump_budget(
        self,
    ):
        pyembroidery = install_fake_pyembroidery()
        export_mod = importlib.import_module("stitch_studio.core.export_engine")
        export_mod.pyembroidery = pyembroidery
        from tests.test_recognition_engine import build_synthetic_face_pipeline

        enhanced = build_synthetic_face_pipeline()
        baseline = build_synthetic_face_pipeline(full_cross_baseline=True)
        exporter = export_mod.ExportEngine()
        enhanced_pattern = exporter.build_pattern(enhanced["project"])
        baseline_pattern = exporter.build_pattern(baseline["project"])

        def command_count(pattern, command):
            return sum(
                (int(candidate) & 0xFF) == command
                for _, _, candidate in pattern.stitches
            )

        enhanced_stitches = command_count(enhanced_pattern, pyembroidery.STITCH)
        baseline_stitches = command_count(baseline_pattern, pyembroidery.STITCH)
        enhanced_jumps = command_count(enhanced_pattern, pyembroidery.JUMP)
        baseline_jumps = command_count(baseline_pattern, pyembroidery.JUMP)
        overlay_paths = sum(
            len(region.stitch_paths)
            for layer in enhanced["layers"]
            for region in layer.regions
            if region.is_cross_stitch_overlay
        )

        self.assertGreater(enhanced_stitches, 0)
        self.assertGreater(baseline_stitches, 0)
        self.assertLessEqual(enhanced_stitches, int(baseline_stitches * 1.35))
        self.assertLessEqual(
            enhanced_jumps,
            baseline_jumps + overlay_paths + 8,
        )
        self.assertLessEqual(len(enhanced_pattern.threadlist), 8)

    def test_real_pyembroidery_pes_dst_roundtrip_keeps_bounds_and_threads(
        self,
    ):
        availability = subprocess.run(
            [sys.executable, "-c", "import pyembroidery"],
            capture_output=True,
            text=True,
            check=False,
        )
        if availability.returncode:
            self.skipTest("real pyembroidery package is unavailable")

        script = (
            "import json; "
            "from tests.test_export_paths import real_synthetic_roundtrip_metrics; "
            "print('TASK5_METRICS=' + json.dumps(real_synthetic_roundtrip_metrics()))"
        )
        environment = os.environ.copy()
        environment["QT_QPA_PLATFORM"] = "offscreen"
        completed = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            env=environment,
            check=False,
            timeout=30,
        )
        self.assertEqual(
            completed.returncode,
            0,
            completed.stdout + completed.stderr,
        )
        payload = next(
            line.removeprefix("TASK5_METRICS=")
            for line in completed.stdout.splitlines()
            if line.startswith("TASK5_METRICS=")
        )
        metrics = json.loads(payload)
        source_bounds = metrics["source"]["bounds"]
        self.assertIsNotNone(source_bounds)
        bounds_tolerance = max(
            2.0,
            max(
                source_bounds[2] - source_bounds[0],
                source_bounds[3] - source_bounds[1],
            )
            * 0.01,
        )

        for extension in ("pes", "dst"):
            enhanced = metrics[extension]["enhanced"]
            baseline = metrics[extension]["baseline"]
            for decoded, source_key in (
                (enhanced, "source"),
                (baseline, "baseline_source"),
            ):
                self.assertGreater(decoded["stitches"], 0)
                self.assertTrue(decoded["end"])
                self.assertGreater(decoded["bytes"], 0)
                self.assertEqual(
                    decoded["threads"],
                    metrics[source_key]["threads"],
                )
                self.assertIsNotNone(decoded["bounds"])
                for source_value, decoded_value in zip(
                    metrics[source_key]["bounds"],
                    decoded["bounds"],
                ):
                    self.assertLessEqual(
                        abs(source_value - decoded_value),
                        bounds_tolerance,
                    )
            self.assertLessEqual(
                enhanced["stitch_commands"],
                int(baseline["stitch_commands"] * 1.35),
            )
            self.assertLessEqual(
                enhanced["jump_commands"],
                baseline["jump_commands"] + metrics["overlay_paths"] + 8,
            )

    def test_cross_worker_builds_ownership_for_fills_and_keeps_overlay_separate(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        layer = project_mod.Layer(thread_color_rgb=(20, 30, 40), order=0)
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_pattern_size_mm=2.0,
        )
        fill_a = project_mod.Region(
            mask=np.full((8, 8), 255, dtype=np.uint8),
            stitch_settings=settings,
        )
        fill_b = project_mod.Region(
            mask=np.full((8, 8), 255, dtype=np.uint8),
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        overlay = project_mod.Region(
            mask=np.full((8, 8), 255, dtype=np.uint8),
            stitch_settings=project_mod.StitchSettings(fill_mode="run"),
            is_cross_stitch_overlay=True,
        )

        items = main_mod.StitchWorker._cross_stitch_work_items(
            [(layer, fill_a), (layer, fill_b), (layer, overlay)],
            engine,
        )
        fill_items = [item for item in items if item[1] in (fill_a, fill_b)]
        overlay_items = [item for item in items if item[1] is overlay]

        self.assertTrue(all(item[4] is not None for item in fill_items))
        self.assertEqual(
            set(fill_items[0][4].base_masks),
            {fill_a.uid, fill_b.uid},
        )
        self.assertEqual(overlay_items[0][4], None)

    def test_same_thread_cross_overlay_exports_after_fill_with_jump_between_runs(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        overlay = project_mod.Region(is_cross_stitch_overlay=True)
        overlay.stitch_settings = project_mod.StitchSettings(fill_mode="run")
        overlay.stitch_paths = [
            [(100.0, 0.0), (110.0, 0.0)],
            [(200.0, 0.0), (210.0, 0.0)],
        ]
        fill = project_mod.Region()
        fill.stitch_settings = project_mod.StitchSettings(fill_mode="cross_stitch")
        fill.stitch_paths = [[(0.0, 0.0), (10.0, 0.0)]]
        # Deliberately reversed: export must promote the base fill before its overlay.
        layer.regions = [overlay, fill]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)
        sewing = [
            (x, y) for x, y, command in pattern.stitches
            if command == pyembroidery.STITCH
        ]
        commands = [command for _, _, command in pattern.stitches]

        self.assertEqual(sewing, [(10, 0), (110, 0), (210, 0)])
        self.assertEqual(commands.count(pyembroidery.JUMP), 3)

    def test_cross_stitch_overlay_role_round_trips(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        region = project_mod.Region(is_cross_stitch_overlay=True)
        restored = project_mod.Region.from_dict(region.to_dict())

        self.assertTrue(restored.is_cross_stitch_overlay)

    def test_export_end_command_stays_at_last_needle_position(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        region = project_mod.Region()
        region.stitch_paths = [[(18.0, 5.0), (1494.0, 1458.0)]]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)

        self.assertEqual(pattern.stitches[-1], (1494, 1458, pyembroidery.END))
        self.assertEqual(pattern.bounds(), (18, 5, 1494, 1458))

    def test_dst_validation_bounds_ignore_non_sewing_commands(self):
        pyembroidery = install_fake_pyembroidery()
        export_mod = importlib.import_module("stitch_studio.core.export_engine")
        pattern = pyembroidery.EmbPattern()
        pattern.add_stitch_absolute(pyembroidery.JUMP, -30, -20)
        pattern.add_stitch_absolute(pyembroidery.JUMP, 18, 5)
        pattern.add_stitch_absolute(pyembroidery.STITCH, 1494, 1458)
        pattern.add_stitch_absolute(pyembroidery.END, 0, 0)

        bounds = export_mod.ExportEngine._sewn_bounds(pattern)

        self.assertEqual(bounds, (18.0, 5.0, 1494.0, 1458.0))

    def test_load_image_downscales_oversized_source_for_stable_processing(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")

        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "large.png")
            Image.fromarray(np.full((1200, 1600, 3), 180, dtype=np.uint8)).save(path)

            image = image_mod.ImageEngine.load_image(path, max_pixels=300_000)

        self.assertLessEqual(image.shape[0] * image.shape[1], 300_000)
        self.assertEqual(image.dtype, np.uint8)

    def test_main_window_quantization_runs_through_background_worker(self):
        import inspect

        main_mod = importlib.import_module("stitch_studio.ui.main_window")

        source = inspect.getsource(main_mod)
        quantize_source = inspect.getsource(main_mod.MainWindow._quantize_and_segment)
        worker_source = inspect.getsource(main_mod.QuantizeWorker.run)

        self.assertIn("class QuantizeWorker", source)
        self.assertIn("self._quant_worker.start()", quantize_source)
        self.assertNotIn("quantize_to_palette(", quantize_source)
        self.assertIn("RecognitionEngine.recognize(", worker_source)
        self.assertNotIn("quantize_to_palette(", worker_source)

    def test_export_without_stitches_generates_then_continues(self):
        import inspect

        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        export_source = inspect.getsource(main_mod.MainWindow._export_pattern)
        done_source = inspect.getsource(main_mod.MainWindow._on_stitch_done)

        self.assertIn("has_stitches", export_source)
        self.assertIn("_pending_export_path", export_source)
        self.assertIn("_generate_stitches", export_source)
        self.assertIn("_pending_export_path", done_source)
        self.assertIn("_write_export_pattern", done_source)
        self.assertIn("act_show_regions.setChecked(False)", done_source)

    def test_i18n_defaults_to_chinese_with_english_fallback(self):
        i18n_mod = importlib.import_module("stitch_studio.i18n")

        self.assertEqual(i18n_mod.current_language(), "zh_CN")
        self.assertEqual(i18n_mod.tr("app.title"), "Stitch Studio — 绣花图案设计器")
        self.assertEqual(i18n_mod.tr("missing.key"), "missing.key")

        i18n_mod.set_language("en_US")
        try:
            self.assertEqual(i18n_mod.tr("action.load_image"), "Load Image...")
            self.assertEqual(i18n_mod.tr("image.cross"), "Cross Stitch")
        finally:
            i18n_mod.set_language("zh_CN")

    def test_image_panel_default_copy_is_chinese_for_beginner_workflow(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        panels_mod = importlib.import_module("stitch_studio.ui.panels")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        panel = panels_mod.ImagePanel()

        self.assertEqual(panel.lbl_step_image.text(), "1. 导入图片并调整")
        self.assertEqual(panel.lbl_step_type.text(), "2. 选择绣法")
        self.assertEqual(panel.btn_photo_stitch.text(), "照片绣")
        self.assertEqual(panel.btn_cross_stitch.text(), "十字绣")
        self.assertEqual(panel.btn_advanced_color.text(), "高级颜色设置")
        self.assertIn("照片绣", panel.btn_quantize.text())
        self.assertEqual(panel.chk_include_background.text(), "生成背景")
        self.assertFalse(panel.chk_include_background.isChecked())
        self.assertEqual(panel.chk_preserve_details.text(), "保留细线")
        self.assertTrue(panel.chk_preserve_details.isChecked())
        self.assertEqual(panel.chk_auto_design_colors.text(), "自动高保真配色")
        self.assertTrue(panel.chk_auto_design_colors.isChecked())
        self.assertEqual(panel.spin_colors.value(), 12)
        self.assertIn(
            "实体绣线颜色上限:",
            {label.text() for label in panel.findChildren(qt_widgets.QLabel)},
        )
        self.assertEqual(panel.spin_design_colors.maximum(), 128)
        self.assertEqual(panel.slider_detail_sensitivity.value(), 65)

    def test_properties_panel_core_parameters_are_chinese(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        panels_mod = importlib.import_module("stitch_studio.ui.panels")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        panel = panels_mod.PropertiesPanel()

        group_titles = {
            child.title()
            for child in panel.findChildren(panels_mod.QGroupBox)
        }

        self.assertIn("填充针法", group_titles)
        self.assertIn("针迹方向", group_titles)
        self.assertIn("十字绣", group_titles)

    def test_main_window_uses_i18n_for_primary_navigation(self):
        import inspect

        main_mod = importlib.import_module("stitch_studio.ui.main_window")

        source = inspect.getsource(main_mod.MainWindow)

        self.assertIn('tr("app.title")', source)
        self.assertIn('tr("action.load_image")', source)
        self.assertIn('tr("dock.image")', source)
        self.assertIn('tr("status.ready")', source)

    def test_stitch_settings_include_cross_stitch_defaults(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        settings = project_mod.StitchSettings()

        self.assertEqual(settings.cross_method, "auto")
        self.assertAlmostEqual(settings.cross_pattern_size_mm, 1.8)
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

    def test_cross_stitch_export_skips_global_nearest_neighbor_reordering(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(255, 100, 0), order=0)
        region = project_mod.Region()
        region.stitch_settings = project_mod.StitchSettings(fill_mode="cross_stitch")
        region.stitch_paths = [
            [(0.0, 0.0), (10.0, 10.0)],
            [(10.0, 0.0), (0.0, 10.0)],
            [(20.0, 0.0), (30.0, 10.0)],
        ]
        region.stitch_points = [pt for path in region.stitch_paths for pt in path]
        layer.regions = [region]
        project.layers = [layer]

        engine = export_mod.ExportEngine()
        original = engine._order_paths_from
        try:
            engine._order_paths_from = lambda *args, **kwargs: (_ for _ in ()).throw(
                AssertionError("cross stitch should use the linear export path")
            )
            pattern = engine.build_pattern(project)
        finally:
            engine._order_paths_from = original

        stitched_points = [
            (x, y)
            for x, y, cmd in pattern.stitches
            if cmd == install_fake_pyembroidery().STITCH
        ]
        self.assertIn((10, 10), stitched_points)

    def test_large_photo_stitch_export_skips_quadratic_path_reordering(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        engine = export_mod.ExportEngine()
        region = project_mod.Region()
        region.stitch_settings.fill_mode = "scanline"
        paths = [
            [(float(index), 0.0), (float(index), 1.0)]
            for index in range(600)
        ]
        engine._order_paths_from = lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("large designs should use the linear export path")
        )

        ordered = engine._order_region_paths(region, paths, None, None)

        self.assertEqual(len(ordered), len(paths))

    def test_large_photo_stitch_spatially_orders_paths_to_reduce_travel(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        engine = export_mod.ExportEngine()
        region = project_mod.Region()
        region.stitch_settings.fill_mode = "scanline"
        paths = [
            [
                (0.0 if index % 2 == 0 else 1000.0, float(index * 10)),
                (1.0 if index % 2 == 0 else 1001.0, float(index * 10)),
            ]
            for index in range(300)
        ]

        ordered = engine._order_region_paths(region, paths, None, None)
        travel = sum(
            np.hypot(
                ordered[index][0][0] - ordered[index - 1][-1][0],
                ordered[index][0][1] - ordered[index - 1][-1][1],
            )
            for index in range(1, len(ordered))
        )

        self.assertLess(travel, 40000.0)


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

    def test_run_components_do_not_sew_diagonally_across_blank_space(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((20, 32), dtype=np.uint8)
        mask[5, 2:13] = 255
        mask[9, 14:25] = 255
        raw_paths = [
            [(2.0, 5.0), (12.0, 5.0)],
            [(14.0, 9.0), (24.0, 9.0)],
        ]

        merged = engine._assemble_run_components(raw_paths, mask)

        self.assertEqual(len(merged), 2)

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

    def test_colored_run_restoration_does_not_absorb_neighboring_fill(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        image = np.full((30, 50, 3), (250, 140, 119), dtype=np.uint8)
        image[15, 5:45] = (230, 52, 25)
        mask = np.zeros((30, 50), dtype=np.uint8)
        mask[15, 5:18] = 255
        mask[15, 32:45] = 255

        restored = engine._restore_line_art_run_mask(
            mask,
            image,
            source_color=(230, 52, 25),
        )

        self.assertTrue(np.all(restored[15, 5:45] > 0))
        self.assertEqual(int(np.count_nonzero(restored)), 40)

    def test_run_restoration_does_not_absorb_flat_same_color_area(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        image = np.full((30, 50, 3), (230, 52, 25), dtype=np.uint8)
        mask = np.zeros((30, 50), dtype=np.uint8)
        mask[15, 5:18] = 255
        mask[15, 32:45] = 255

        restored = engine._restore_line_art_run_mask(
            mask,
            image,
            source_color=(230, 52, 25),
        )

        self.assertEqual(int(np.count_nonzero(restored)), 26)

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

    def test_thick_open_run_stroke_uses_one_centerline_without_closed_outline(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((50, 60), dtype=np.uint8)
        cv2.ellipse(mask, (30, 30), (20, 8), 0, 190, 350, 255, 4)
        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.6,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), 1)
        self.assertNotEqual(paths[0][0], paths[0][-1])

    def test_hollow_run_ring_stays_one_closed_centerline(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((50, 50), dtype=np.uint8)
        cv2.circle(mask, (25, 25), 15, 255, 3)
        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.6,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0][0], paths[0][-1])

    def test_feature_contour_preserves_sharp_asymmetric_corners(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((64, 64), dtype=np.uint8)
        corners = np.asarray(
            [(6, 32), (30, 5), (55, 31), (43, 50), (16, 48)],
            dtype=np.int32,
        )
        cv2.polylines(mask, [corners], True, 255, 3)
        settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.7,
            underlay=False,
            run_trace_contour=True,
            run_preserve_corners=True,
        )

        paths = engine._generate_closed_contour_run(mask, settings)

        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0][0], paths[0][-1])
        for corner_x, corner_y in corners:
            distance = min(
                np.hypot(x - corner_x, y - corner_y)
                for x, y in paths[0]
            )
            self.assertLessEqual(distance, 1.5)

    def test_smooth_feature_contour_reduces_pixel_stair_step_turns(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((80, 80), dtype=np.uint8)
        cv2.ellipse(mask, (40, 40), (18, 25), 0, 0, 360, 255, 3)
        sharp = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.55,
            underlay=False,
            run_trace_contour=True,
            run_preserve_corners=True,
        )
        smooth = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.55,
            underlay=False,
            run_trace_contour=True,
            run_preserve_corners=False,
        )

        sharp_path = engine._generate_closed_contour_run(mask, sharp)[0]
        smooth_path = engine._generate_closed_contour_run(mask, smooth)[0]

        def high_frequency_turn_energy(path):
            points = np.asarray(path, dtype=np.float64)
            vectors = np.diff(points, axis=0)
            angles = np.unwrap(np.arctan2(vectors[:, 1], vectors[:, 0]))
            turns = np.diff(angles)
            return float(np.sum(np.abs(np.diff(turns))))

        self.assertEqual(smooth_path[0], smooth_path[-1])
        self.assertLess(
            high_frequency_turn_energy(smooth_path),
            high_frequency_turn_energy(sharp_path) * 0.72,
        )

    def test_adaptive_closed_run_smooths_rounded_eye_more_than_preserve(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((80, 80), dtype=np.uint8)
        cv2.ellipse(mask, (40, 40), (18, 25), 0, 0, 360, 255, 3)
        preserve = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.55,
            underlay=False,
            run_trace_contour=True,
            run_corner_mode="preserve",
        )
        adaptive = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.55,
            underlay=False,
            run_trace_contour=True,
            run_corner_mode="adaptive",
        )

        preserve_path = engine._generate_closed_contour_run(mask, preserve)[0]
        adaptive_path = engine._generate_closed_contour_run(mask, adaptive)[0]

        def high_frequency_turn_energy(path):
            points = np.asarray(path, dtype=np.float64)
            vectors = np.diff(points, axis=0)
            angles = np.unwrap(np.arctan2(vectors[:, 1], vectors[:, 0]))
            turns = np.diff(angles)
            return float(np.sum(np.abs(np.diff(turns))))

        self.assertEqual(adaptive_path[0], adaptive_path[-1])
        self.assertLess(
            high_frequency_turn_energy(adaptive_path),
            high_frequency_turn_energy(preserve_path) * 0.72,
        )

    def test_legacy_corner_mode_matches_explicit_smooth_and_preserve_profiles(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((80, 80), dtype=np.uint8)
        corners = np.asarray(
            [(8, 38), (20, 15), (40, 8), (61, 17), (71, 42), (49, 65), (23, 60)],
            dtype=np.int32,
        )
        cv2.fillPoly(mask, [corners], 255)

        def settings(**overrides):
            values = {
                "fill_mode": "run",
                "stitch_length_mm": 0.55,
                "underlay": False,
                "run_trace_contour": True,
            }
            values.update(overrides)
            return project_mod.StitchSettings(**values)

        legacy_smooth = engine._generate_closed_contour_run(
            mask,
            settings(run_corner_mode="legacy", run_preserve_corners=False),
        )[0]
        explicit_smooth = engine._generate_closed_contour_run(
            mask,
            settings(run_corner_mode="smooth"),
        )[0]
        legacy_preserve = engine._generate_closed_contour_run(
            mask,
            settings(run_corner_mode="legacy", run_preserve_corners=True),
        )[0]
        explicit_preserve = engine._generate_closed_contour_run(
            mask,
            settings(run_corner_mode="preserve"),
        )[0]

        self.assertEqual(legacy_smooth, explicit_smooth)
        self.assertEqual(legacy_preserve, explicit_preserve)

    def test_adaptive_closed_run_keeps_mouth_tips_without_chords_or_zero_edges(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((48, 64), dtype=np.uint8)
        mouth = np.array(
            [
                [6, 28], [10, 18], [18, 11], [28, 8], [38, 11], [46, 18],
                [56, 28], [46, 25], [38, 23], [28, 22], [18, 23], [10, 25],
            ],
            dtype=np.int32,
        )
        cv2.fillPoly(mask, [mouth], 255)
        settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.5,
            underlay=False,
            run_trace_contour=True,
            run_corner_mode="adaptive",
            run_passes=1,
        )

        path = engine._generate_closed_contour_run(mask, settings)[0]
        left_tip = np.asarray((6.0, 28.0))
        right_tip = np.asarray((56.0, 28.0))
        points = np.asarray(path, dtype=np.float64)

        self.assertEqual(path[0], path[-1])
        self.assertLess(np.min(np.linalg.norm(points - left_tip, axis=1)), 1.5)
        self.assertLess(np.min(np.linalg.norm(points - right_tip, axis=1)), 1.5)
        distances = np.linalg.norm(np.diff(points, axis=0), axis=1)
        self.assertTrue(np.all(distances > 1e-6), distances)
        self.assertFalse(
            any(
                (
                    np.linalg.norm(start - left_tip) < 1.5
                    and np.linalg.norm(end - right_tip) < 1.5
                )
                or (
                    np.linalg.norm(start - right_tip) < 1.5
                    and np.linalg.norm(end - left_tip) < 1.5
                )
                for start, end in zip(points, points[1:])
            )
        )

    def test_adaptive_closed_run_keeps_reinforced_pass_traversal(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((48, 64), dtype=np.uint8)
        cv2.ellipse(mask, (32, 24), (18, 9), 0, 0, 360, 255, 3)
        base_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.5,
            underlay=False,
            run_trace_contour=True,
            run_corner_mode="adaptive",
            run_passes=1,
        )
        reinforced_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.5,
            underlay=False,
            run_trace_contour=True,
            run_corner_mode="adaptive",
            run_passes=3,
        )

        base = engine._generate_closed_contour_run(mask, base_settings)[0]
        reinforced = engine._generate_closed_contour_run(mask, reinforced_settings)[0]

        self.assertEqual(reinforced[: len(base)], base)
        self.assertEqual(
            reinforced[len(base) : len(base) * 2 - 1],
            list(reversed(base))[1:],
        )
        self.assertEqual(reinforced[len(base) * 2 - 1 :], base[1:])

    def test_adaptive_photo_feature_export_preserves_bounds_and_stitch_budget(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        stitch_engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.5,
            underlay=False,
            run_trace_contour=True,
            run_corner_mode="adaptive",
            run_passes=3,
        )
        feature_masks = {
            "eye": cv2.ellipse(
                np.zeros((88, 112), dtype=np.uint8),
                (12, 10),
                (6, 4),
                0,
                0,
                360,
                255,
                3,
            ),
            "mouth": np.zeros((88, 112), dtype=np.uint8),
        }
        mouth = np.asarray(
            [(12, 12), (48, 16), (40, 24), (48, 32), (12, 36), (24, 22)],
            dtype=np.int32,
        )
        cv2.polylines(feature_masks["mouth"], [mouth], True, 255, 3)
        expected_stitch_counts = {"eye": 69, "mouth": 210}
        scene_scale = 10.0 / stitch_engine.px_per_mm

        for feature_name, mask in feature_masks.items():
            with self.subTest(feature=feature_name):
                project = project_mod.Project()
                layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
                region = project_mod.Region(mask=mask, stitch_settings=settings)
                region.stitch_paths = stitch_engine.generate_region_paths(region)
                region.stitch_points = [
                    point for path in region.stitch_paths for point in path
                ]
                layer.regions = [region]
                project.layers = [layer]

                before = region.stitch_bounds()
                pattern = export_mod.ExportEngine().build_pattern(project)
                after = pattern.bounds()
                self.assertIsNotNone(before)
                self.assertIsNotNone(after)
                ys, xs = np.where(mask > 0)
                expected = (
                    float(xs.min()) * scene_scale,
                    float(ys.min()) * scene_scale,
                    float(xs.max()) * scene_scale,
                    float(ys.max()) * scene_scale,
                )
                for actual in (before, after):
                    for actual_edge, expected_edge in zip(actual, expected):
                        self.assertLessEqual(
                            abs(actual_edge - expected_edge),
                            scene_scale,
                        )
                self.assertLessEqual(
                    abs((before[2] - before[0]) - (after[2] - after[0])),
                    1.0,
                )
                self.assertLessEqual(
                    abs((before[3] - before[1]) - (after[3] - after[1])),
                    1.0,
                )

                allowed = cv2.dilate(
                    mask,
                    np.ones((5, 5), dtype=np.uint8),
                    iterations=1,
                ) > 0
                previous = None
                for x, y, command in pattern.stitches:
                    if command != pyembroidery.STITCH:
                        previous = None
                        continue
                    current = np.asarray((x, y), dtype=np.float64)
                    if previous is not None:
                        distance = float(np.linalg.norm(current - previous))
                        self.assertGreater(distance, 0.0)
                        sample_count = max(2, int(np.ceil(distance / 0.75)))
                        for sample in np.linspace(previous, current, sample_count):
                            px = int(round(sample[0] / scene_scale))
                            py = int(round(sample[1] / scene_scale))
                            self.assertGreaterEqual(px, 0)
                            self.assertGreaterEqual(py, 0)
                            self.assertLess(px, allowed.shape[1])
                            self.assertLess(py, allowed.shape[0])
                            self.assertTrue(
                                allowed[py, px],
                                msg=f"{feature_name} stitch left feature mask at {(px, py)}",
                            )
                    previous = current
                stitch_count = sum(
                    command == pyembroidery.STITCH
                    for _, _, command in pattern.stitches
                )
                expected_count = expected_stitch_counts[feature_name]
                self.assertGreaterEqual(stitch_count, int(expected_count * 0.75))
                self.assertLessEqual(stitch_count, int(expected_count * 1.5))

    def test_short_skeleton_spur_is_pruned_from_open_detail(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        skeleton = np.zeros((32, 64), dtype=np.uint8)
        skeleton[16, 5:58] = 1
        skeleton[12:17, 31] = 1

        cleaned = engine._prune_short_skeleton_branches(
            skeleton,
            min_branch_px=6.0,
        )

        self.assertTrue(np.all(cleaned[16, 5:58] > 0))
        self.assertEqual(int(np.count_nonzero(cleaned[12:16, 31])), 0)

    def test_directional_gap_bridge_keeps_unrelated_marks_separate(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        horizontal = [
            [(5.0, 12.0), (20.0, 12.0)],
            [(23.0, 12.0), (38.0, 12.0)],
        ]
        # This perpendicular mark is within the merge radius. Distance alone
        # must not turn it into a dirty connector.
        unrelated = [(20.5, 13.5), (20.5, 23.0)]

        merged = engine._merge_directional_run_paths(
            horizontal + [unrelated],
            max_gap_px=5.0,
        )

        self.assertEqual(len(merged), 2)
        self.assertTrue(
            any(
                min(x for x, _ in path) <= 5
                and max(x for x, _ in path) >= 38
                for path in merged
            )
        )

    def test_run_corner_settings_round_trip_and_old_default(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        settings = project_mod.StitchSettings(
            fill_mode="run",
            run_passes=3,
            run_trace_contour=True,
            run_preserve_corners=True,
        )

        restored = project_mod.StitchSettings.from_dict(settings.to_dict())
        legacy = project_mod.StitchSettings.from_dict({"fill_mode": "run"})

        self.assertEqual(restored.run_passes, 3)
        self.assertTrue(restored.run_trace_contour)
        self.assertTrue(restored.run_preserve_corners)
        self.assertEqual(legacy.run_passes, 1)
        self.assertFalse(legacy.run_trace_contour)
        self.assertFalse(legacy.run_preserve_corners)

    def test_run_corner_mode_round_trip_and_legacy_default(self):
        project_mod = importlib.import_module("stitch_studio.core.project")

        settings = project_mod.StitchSettings(
            fill_mode="run",
            run_corner_mode="adaptive",
            run_preserve_corners=True,
        )
        restored = project_mod.StitchSettings.from_dict(settings.to_dict())
        legacy = project_mod.StitchSettings.from_dict({"fill_mode": "run"})

        self.assertEqual(restored.run_corner_mode, "adaptive")
        self.assertEqual(legacy.run_corner_mode, "legacy")

    def test_disconnected_run_strokes_remain_separate_jump_paths(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((30, 50), dtype=np.uint8)
        mask[14, 5:20] = 255
        mask[14, 25:42] = 255
        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=0.6,
            underlay=False,
        )

        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), 2)

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

    def test_segmentation_can_include_border_background_when_requested(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        image = np.full((20, 20, 3), (190, 0, 20), dtype=np.uint8)
        image[5:15, 8:12] = (0, 0, 0)
        thread_map = np.zeros((20, 20), dtype=np.int32)
        thread_map[5:15, 8:12] = 1

        settings = project_mod.QuantizationSettings(
            min_region_area_px=1,
            include_background=True,
        )
        regions = image_mod.ImageEngine.segment_regions(thread_map, settings, image)
        region_pixels = {
            tid: sum(
                int(np.count_nonzero(mask))
                for region_tid, mask in regions
                if region_tid == tid
            )
            for tid in {0, 1}
        }

        self.assertEqual(region_pixels[0], 360)
        self.assertEqual(region_pixels[1], 40)

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

    def test_quantization_preserves_one_pixel_colored_line_detail(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Skin", color_rgb=(252, 156, 132)),
            thread_mod.ThreadColor(name="Red Detail", color_rgb=(136, 30, 18)),
        ]
        image = np.full((44, 44, 3), (252, 156, 132), dtype=np.uint8)
        image[22, 8:36] = (136, 30, 18)

        thread_map, used_indices = image_mod.ImageEngine.quantize_to_palette(
            image,
            palette,
            project_mod.QuantizationSettings(n_colors=1, preserve_details=True),
        )

        self.assertEqual(int(np.count_nonzero(thread_map[22, 8:36] == 1)), 28)
        self.assertIn(1, used_indices)

    def test_detail_detection_does_not_promote_large_shape_boundaries(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")

        image = np.full((80, 80, 3), (0, 150, 210), dtype=np.uint8)
        image[:, 40:] = (252, 156, 132)
        image[:, 39] = (126, 90, 80)

        detail_mask = image_mod.ImageEngine._detect_detail_pixels(image)

        self.assertEqual(int(np.count_nonzero(detail_mask[:, 38:42])), 0)

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

    def test_colored_detail_layers_default_to_run_stitch(self):
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
        self.assertEqual(modes["Dark Green"], "run")

    def test_photo_layers_underpaint_run_details_with_adjacent_fills(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            thread_mod.ThreadColor(name="Blue", color_rgb=(30, 120, 210)),
        ]
        coral = np.zeros((30, 40), dtype=np.uint8)
        coral[:, :19] = 255
        outline = np.zeros((30, 40), dtype=np.uint8)
        outline[:, 19:21] = 255
        blue = np.zeros((30, 40), dtype=np.uint8)
        blue[:, 21:] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, coral), (1, outline), (2, blue)],
            palette,
            generation_mode="photo_stitch",
        )

        run_mask = np.zeros(outline.shape, dtype=bool)
        fill_mask = np.zeros(outline.shape, dtype=bool)
        for layer in layers:
            for region in layer.regions:
                if region.stitch_settings.fill_mode == "run":
                    run_mask |= region.mask > 0
                elif region.stitch_settings.fill_mode == "scanline":
                    fill_mask |= region.mask > 0

        self.assertTrue(np.all(fill_mask[run_mask]))

    def test_cross_stitch_layers_remain_non_overlapping(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [
            thread_mod.ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            thread_mod.ThreadColor(name="Black", color_rgb=(0, 0, 0)),
        ]
        left = np.zeros((20, 20), dtype=np.uint8)
        left[:, :10] = 255
        right = np.zeros((20, 20), dtype=np.uint8)
        right[:, 10:] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, left), (1, right)],
            palette,
            generation_mode="cross_stitch",
        )

        coverage = np.zeros(left.shape, dtype=np.uint8)
        for layer in layers:
            for region in layer.regions:
                coverage += (region.mask > 0).astype(np.uint8)
        self.assertEqual(int(coverage.max()), 1)

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
        self.assertEqual(settings.cross_method, "cross")

    def test_cross_stitch_generation_mode_survives_source_color_application(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [thread_mod.ThreadColor(name="Orange", color_rgb=(255, 110, 0))]
        source = np.full((30, 30, 3), (250, 118, 12), dtype=np.uint8)
        mask = np.zeros((30, 30), dtype=np.uint8)
        mask[4:26, 4:26] = 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask)],
            palette,
            source,
            generation_mode="cross_stitch",
        )

        settings = layers[0].regions[0].stitch_settings
        self.assertEqual(settings.fill_mode, "cross_stitch")
        self.assertEqual(settings.cross_method, "cross")

    def test_cross_stitch_generation_mode_with_source_image_emits_cross_paths(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        thread_mod = importlib.import_module("stitch_studio.core.thread_db")

        palette = [thread_mod.ThreadColor(name="Orange", color_rgb=(255, 110, 0))]
        source = np.full((20, 20, 3), (250, 118, 12), dtype=np.uint8)
        mask = np.ones((20, 20), dtype=np.uint8) * 255

        layers = image_mod.ImageEngine.build_layers_from_regions(
            [(0, mask)],
            palette,
            source,
            generation_mode="cross_stitch",
        )
        region = layers[0].regions[0]
        region.stitch_settings.cross_method = "cross"
        region.stitch_settings.cross_pattern_size_mm = 1.0
        region.stitch_settings.cross_coverage = 0.5

        paths = stitch_mod.StitchEngine(px_per_mm=10.0).generate_region_paths(region, source)

        self.assertGreaterEqual(len(paths), 8)
        self.assertTrue(all(len(path) == 2 for path in paths[:8]))
        diagonal_slopes = {
            round((path[-1][1] - path[0][1]) / (path[-1][0] - path[0][0]), 2)
            for path in paths[:8]
            if path[-1][0] != path[0][0]
        }
        self.assertEqual(diagonal_slopes, {-1.0, 1.0})

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

    def test_generated_layer_stack_places_details_above_green_fills(self):
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

        indexes = {layer.thread_name: layer.order for layer in layers}
        self.assertLess(indexes["Black"], indexes["Light Green"])

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

    def test_toolbar_image_opacity_coalesces_rapid_slider_updates(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")

        class TimerStub:
            def __init__(self):
                self.starts = 0
                self.active = False

            def isActive(self):
                return self.active

            def start(self):
                self.starts += 1
                self.active = True

        class CanvasStub:
            def __init__(self):
                self.applied = []

            def set_image_opacity(self, value):
                self.applied.append(value)

        window = types.SimpleNamespace(
            _pending_image_opacity=None,
            _image_opacity_timer=TimerStub(),
            canvas=CanvasStub(),
        )

        for value in range(51, 91):
            main_mod.MainWindow._queue_image_opacity(window, value)
        main_mod.MainWindow._flush_image_opacity(window)

        self.assertEqual(window._image_opacity_timer.starts, 1)
        self.assertEqual(window.canvas.applied, [0.9])

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

    def test_canvas_stitch_layer_respects_visual_stack_z_value(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        app = qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        region_data = [{
            "uid": "outline-region",
            "points": [(0.0, 0.0), (10.0, 0.0)],
            "paths": [[(0.0, 0.0), (10.0, 0.0)]],
            "color": (0, 0, 0),
        }]

        canvas.set_layer_stitches("outline", region_data, z_value=20.0)
        app.processEvents()

        self.assertEqual(canvas._layer_groups["outline"].zValue(), 20.0)

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
        preview_item = next(
            child for child in object_item.childItems()
            if child.__class__.__name__ == "StitchPreviewItem"
        )

        self.assertEqual(
            object_item.cacheMode(),
            canvas_mod.QGraphicsItem.DeviceCoordinateCache,
        )
        self.assertEqual(
            preview_item.cacheMode(),
            canvas_mod.QGraphicsItem.DeviceCoordinateCache,
        )

    def test_canvas_stitch_preview_reuses_prebuilt_painter_path(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        item = canvas_mod.StitchPreviewItem(
            [
                [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)],
                [(20.0, 0.0), (20.0, 10.0)],
            ],
            canvas_mod.QColor(10, 20, 30),
        )

        first = item._path_for_stride(1)
        second = item._path_for_stride(1)

        self.assertIs(first, second)
        self.assertEqual(first.elementCount(), 5)

    def test_canvas_preview_keeps_physical_thread_width_at_every_zoom(self):
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        widths = [
            canvas_mod.StitchPreviewItem._thread_width_for_lod(lod)
            for lod in (0.25, 0.5, 1.0, 2.0, 4.0)
        ]

        self.assertEqual(widths, [3.6] * 5)

    def test_canvas_dark_thread_preview_stays_visible_on_dark_background(self):
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        item = canvas_mod.StitchPreviewItem(
            [[(0.0, 0.0), (10.0, 0.0)]],
            canvas_mod.QColor(0, 0, 0),
        )

        overview = item._overview_color()
        highlight = item._highlight_color()

        self.assertEqual(item.color.getRgb()[:3], (0, 0, 0))
        self.assertGreaterEqual(overview.lightness(), 90)
        self.assertGreaterEqual(highlight.lightness(), 105)

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
        self.assertEqual(canvas._object_items["region-1"].pos().x(), 10.0)

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

    def test_canvas_repeated_drag_keeps_previous_preview_offset(self):
        qt_core = importlib.import_module("PySide6.QtCore")
        qt_widgets = importlib.import_module("PySide6.QtWidgets")
        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        qt_widgets.QApplication.instance() or qt_widgets.QApplication([])
        canvas = canvas_mod.EmbroideryCanvas()
        canvas.set_layer_stitches(
            "layer-1",
            [{
                "uid": "region-1",
                "points": [(0.0, 0.0), (20.0, 0.0)],
                "paths": [[(0.0, 0.0), (20.0, 0.0)]],
                "color": (10, 20, 30),
            }],
        )
        canvas.select_object("region-1")

        canvas._begin_selection_box_drag()
        canvas._selection_box_item.setPos(qt_core.QPointF(10.0, 0.0))
        canvas._finish_selection_box_drag()
        canvas._begin_selection_box_drag()
        canvas._selection_box_item.setPos(qt_core.QPointF(15.0, 0.0))

        self.assertEqual(canvas._object_items["region-1"].pos().x(), 15.0)

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

    def test_main_window_move_region_does_not_rebuild_canvas_or_stats(self):
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

        expensive_calls = []
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.canvas = types.SimpleNamespace(
            set_layer_stitches=lambda *args: expensive_calls.append("redraw"),
            select_object=lambda uid: None,
        )
        window.layer_panel = types.SimpleNamespace(
            refresh=lambda: expensive_calls.append("layers"),
            select_uid=lambda uid: None,
        )
        window.status_info = types.SimpleNamespace(setText=lambda text: None)
        window._update_stats = lambda: expensive_calls.append("stats")

        window._move_stitch_object(region_1.uid, 5.0, 0.0)

        self.assertEqual(expensive_calls, [])
        self.assertEqual(region_1.stitch_points, [(5.0, 0.0), (15.0, 0.0)])

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

    def test_photo_worker_merges_identical_thread_settings_before_generation(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        layer = project_mod.Layer(thread_uid="coral", order=0)
        first = project_mod.Region(mask=np.pad(np.ones((4, 4), dtype=np.uint8), 2))
        second_mask = np.zeros((8, 8), dtype=np.uint8)
        second_mask[1:3, 5:7] = 1
        second = project_mod.Region(mask=second_mask)

        work_items = main_mod.StitchWorker._photo_stitch_work_items(
            [(layer, first), (layer, second)]
        )

        self.assertEqual(len(work_items), 1)
        _, target, members, working_region, mask_override = work_items[0]
        self.assertIs(target, first)
        self.assertEqual(members, [first, second])
        self.assertIsNone(mask_override)
        np.testing.assert_array_equal(
            working_region.mask > 0,
            (first.mask > 0) | (second.mask > 0),
        )
        self.assertIsNone(working_region.polygon)

    def test_photo_worker_preserves_separate_professional_settings(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        layer = project_mod.Layer(thread_uid="coral", order=0)
        first = project_mod.Region(mask=np.ones((8, 8), dtype=np.uint8))
        second = project_mod.Region(mask=np.ones((8, 8), dtype=np.uint8))
        second.stitch_settings.angle_deg = first.stitch_settings.angle_deg + 15.0

        work_items = main_mod.StitchWorker._photo_stitch_work_items(
            [(layer, first), (layer, second)]
        )

        self.assertEqual(len(work_items), 2)

    def test_photo_worker_keeps_satin_features_separate(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        layer = project_mod.Layer(thread_uid="black", order=0)
        first = project_mod.Region(mask=np.ones((8, 8), dtype=np.uint8))
        second = project_mod.Region(mask=np.ones((8, 8), dtype=np.uint8))
        first.stitch_settings.fill_mode = "satin"
        second.stitch_settings.fill_mode = "satin"

        work_items = main_mod.StitchWorker._photo_stitch_work_items(
            [(layer, first), (layer, second)]
        )

        self.assertEqual(len(work_items), 2)

    def test_stitch_worker_uses_qthread_finished_after_run_returns(self):
        import inspect

        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        worker_source = inspect.getsource(main_mod.StitchWorker)
        generate_source = inspect.getsource(main_mod.MainWindow._generate_stitches)

        self.assertNotIn("finished = Signal()", worker_source)
        self.assertNotIn("self.finished.emit()", worker_source)
        self.assertIn("self.failure_message", worker_source)
        self.assertIn(
            "self._worker.finished.connect(self._on_stitch_worker_finished)",
            generate_source,
        )

    def test_generate_stitches_ignores_repeat_request_while_worker_runs(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        statuses = []
        running_worker = types.SimpleNamespace(isRunning=lambda: True)
        window = types.SimpleNamespace(
            _worker=running_worker,
            status_info=types.SimpleNamespace(setText=statuses.append),
        )

        main_mod.MainWindow._generate_stitches(window)

        self.assertIs(window._worker, running_worker)
        self.assertEqual(statuses, [main_mod.tr("status.generating")])

    def test_stitch_completion_releases_worker_only_after_qthread_finished(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        events = []
        worker = types.SimpleNamespace(failure_message=None)
        window = types.SimpleNamespace(
            _worker=worker,
            _on_stitch_done=lambda: events.append("done"),
            _on_stitch_error=lambda message: events.append(message),
        )

        main_mod.MainWindow._on_stitch_worker_finished(window)

        self.assertIsNone(window._worker)
        self.assertEqual(events, ["done"])

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
        self.assertIn("照片绣", panel.btn_quantize.text())
        panel.set_generation_mode("cross_stitch")
        self.assertEqual(panel.get_generation_mode(), "cross_stitch")
        self.assertTrue(panel.btn_cross_stitch.isChecked())
        self.assertIn("十字绣", panel.btn_quantize.text())
        self.assertEqual(panel.lbl_step_type.text(), "2. 选择绣法")
        self.assertTrue(panel.btn_advanced_color.isCheckable())
        self.assertFalse(panel.grp_quant.isVisible())
        self.assertTrue(hasattr(panel, "combo_method"))

    def test_canvas_uses_aggregated_lod_stitch_preview_item(self):
        import inspect

        canvas_mod = importlib.import_module("stitch_studio.ui.canvas")

        source = inspect.getsource(canvas_mod)

        self.assertIn("class StitchPreviewItem", source)
        self.assertIn("levelOfDetailFromTransform", source)
        self.assertIn("_visible_path_stride", source)
        self.assertIn("thread highlight", source)

    def test_main_window_keeps_generation_mode_in_left_panel_not_toolbar(self):
        import inspect

        main_mod = importlib.import_module("stitch_studio.ui.main_window")

        source = inspect.getsource(main_mod.MainWindow)

        self.assertIn("act_photo_stitch_mode", source)
        self.assertIn("act_cross_stitch_mode", source)
        self.assertIn("_set_generation_mode", source)
        toolbar_source = source[
            source.index("    def _create_toolbar(self):"):
            source.index("    def _create_canvas(self):")
        ]
        self.assertNotIn("Generate As:", toolbar_source)

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

    def test_owned_cross_cell_uses_original_mask_for_half_direction(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        original = np.zeros((10, 10), dtype=np.uint8)
        original[np.tril_indices(10)] = 255
        ownership = np.full((10, 10), 255, dtype=np.uint8)
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
        )

        cells = engine._cross_stitch_cell_specs(ownership, original, settings)

        self.assertEqual(len(cells), 1)
        self.assertEqual(cells[0].method_override, "half")

    def test_owned_full_cell_retains_configured_cross_method(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        full = np.full((10, 10), 255, dtype=np.uint8)
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="upright",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
        )

        cells = engine._cross_stitch_cell_specs(full, full, settings)

        self.assertEqual(len(cells), 1)
        self.assertIsNone(cells[0].method_override)

    def test_owned_cross_cells_use_grid_coordinates_for_tie_breaks(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        ownership = np.full((10, 20), 255, dtype=np.uint8)
        original = np.zeros((10, 20), dtype=np.uint8)
        original[:5, :] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
        )

        cells = engine._cross_stitch_cell_specs(ownership, original, settings)

        self.assertEqual(
            [cell.method_override for cell in cells],
            ["half", "half_flipped"],
        )

    def test_owned_cross_cells_keep_global_grid_coordinates_for_tie_breaks(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        ownership = np.zeros((10, 30), dtype=np.uint8)
        ownership[:, 10:30] = 255
        original = np.zeros((10, 30), dtype=np.uint8)
        original[:5, 10:30] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            cross_align_grid=True,
        )

        cells = engine._cross_stitch_cell_specs(ownership, original, settings)

        self.assertEqual(
            [cell.method_override for cell in cells],
            ["half_flipped", "half"],
        )

    def test_owned_cross_paths_keep_source_boundary_instead_of_full_cross(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        source = np.zeros((10, 10), dtype=np.uint8)
        source[np.tril_indices(10)] = 255
        ownership = np.full((10, 10), 255, dtype=np.uint8)
        region = project_mod.Region(mask=source)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )

        context = stitch_mod.CrossStitchOwnershipContext(
            {region.uid: ownership},
            base_grid_origin_px=(0.0, 0.0),
        )
        paths = engine.generate_region_paths(region, ownership_context=context)

        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0], [(0.0, 0.0), (10.0, 10.0)])

    def test_mask_override_without_ownership_context_rejects_low_source_coverage(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        source = np.zeros((10, 10), dtype=np.uint8)
        source[:5, :5] = 255
        ownership = np.full((10, 10), 255, dtype=np.uint8)
        region = project_mod.Region(mask=source)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            underlay=False,
        )

        paths = engine.generate_region_paths(
            region,
            mask_override=ownership,
        )

        self.assertEqual(paths, [])

    def test_ownership_context_keeps_low_coverage_owned_detail_stitchable(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        source = np.zeros((10, 10), dtype=np.uint8)
        source[:5, :5] = 255
        ownership = np.full((10, 10), 255, dtype=np.uint8)
        region = project_mod.Region(mask=source)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            underlay=False,
        )

        context = stitch_mod.CrossStitchOwnershipContext(
            {region.uid: ownership},
            base_grid_origin_px=(0.0, 0.0),
        )
        paths = engine.generate_region_paths(region, ownership_context=context)

        self.assertEqual(len(paths), 2)

    def test_unaligned_cross_grid_applies_offset_once_to_cell_origin(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        mask = np.zeros((30, 30), dtype=np.uint8)
        mask[10:20, 10:20] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            cross_align_grid=False,
            cross_grid_offset_x_mm=0.2,
            cross_grid_offset_y_mm=0.3,
        )

        cells = engine._cross_stitch_cells(mask, settings)

        self.assertEqual(cells, [(12.0, 13.0, 10.0, 10.0)])

    def test_dense_owned_boundary_skips_shifted_full_upright(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        left_mask = np.zeros((20, 20), dtype=np.uint8)
        right_mask = np.zeros((20, 20), dtype=np.uint8)
        left_mask[:, :10] = 255
        right_mask[:, 10:] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="dense_upright",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        left = project_mod.Region(mask=left_mask, stitch_settings=settings)
        right = project_mod.Region(
            mask=right_mask,
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        base_ownership = engine.build_cross_stitch_ownership_masks(
            [(left, 1.0), (right, 1.0)]
        )
        dense_ownership = engine.build_cross_stitch_ownership_masks(
            [(left, 1.0), (right, 1.0)],
            grid_offset_shift_mm=(0.5, 0.5),
        )

        context = stitch_mod.CrossStitchOwnershipContext.from_ownership_masks(
            base_ownership,
            dense_ownership,
        )
        paths = []
        for region in (left, right):
            paths.extend(engine.generate_region_paths(region, ownership_context=context))

        centered_horizontal = [(5.0, 10.0), (15.0, 10.0)]
        centered_vertical = [(10.0, 5.0), (10.0, 15.0)]
        self.assertNotIn(centered_horizontal, paths)
        self.assertNotIn(centered_vertical, paths)
        self.assertIn([(-5.0, 0.0), (5.0, 0.0)], paths)

    def test_connected_one_pixel_detail_has_final_cross_stitch_paths(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        base_mask = np.full((6, 6), 255, dtype=np.uint8)
        detail_mask = np.zeros((6, 6), dtype=np.uint8)
        detail_mask[1, :] = 255
        base_mask[1, :] = 0
        base = project_mod.Region(mask=base_mask)
        detail = project_mod.Region(mask=detail_mask)
        for region in (base, detail):
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_method="cross",
                cross_pattern_size_mm=2.0,
                cross_coverage=0.5,
                underlay=False,
            )

        assigned = engine.build_cross_stitch_ownership_masks(
            [(base, 1.0), (detail, 5.0)]
        )
        context = stitch_mod.CrossStitchOwnershipContext.from_ownership_masks(assigned)
        paths = engine.generate_region_paths(detail, ownership_context=context)

        self.assertTrue(paths)

    def test_isolated_one_pixel_noise_has_no_final_cross_stitch_paths(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        base_mask = np.full((6, 6), 255, dtype=np.uint8)
        detail_mask = np.zeros((6, 6), dtype=np.uint8)
        detail_mask[2, 2] = 255
        base_mask[2, 2] = 0
        base = project_mod.Region(mask=base_mask)
        detail = project_mod.Region(mask=detail_mask)
        for region in (base, detail):
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_method="cross",
                cross_pattern_size_mm=2.0,
                cross_coverage=0.5,
                underlay=False,
            )

        assigned = engine.build_cross_stitch_ownership_masks(
            [(base, 1.0), (detail, 5.0)]
        )
        context = stitch_mod.CrossStitchOwnershipContext.from_ownership_masks(assigned)
        paths = engine.generate_region_paths(detail, ownership_context=context)

        self.assertEqual(paths, [])

    def test_single_cross_stitch_worker_does_not_claim_shared_ownership(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")

        class RecordingEngine:
            def __init__(self):
                self.calls = []

            def build_cross_stitch_ownership_masks(
                self,
                region_priorities,
                grid_offset_shift_mm=(0.0, 0.0),
            ):
                return {
                    region.uid: np.full(region.mask.shape, 255, dtype=np.uint8)
                    for region, _ in region_priorities
                }

            def generate_region_paths(
                self,
                region,
                image,
                flow_field,
                mask_override=None,
                ownership_context=None,
            ):
                self.calls.append((
                    region.uid,
                    mask_override,
                    ownership_context,
                ))
                return []

        project = project_mod.Project()
        layer = project_mod.Layer()
        region = project_mod.Region(mask=np.full((10, 10), 255, dtype=np.uint8))
        region.stitch_settings = project_mod.StitchSettings(fill_mode="cross_stitch")
        layer.regions = [region]
        project.layers = [layer]
        engine = RecordingEngine()

        main_mod.StitchWorker(project, engine).run()

        self.assertEqual(len(engine.calls), 1)
        uid, mask_override, ownership_context = engine.calls[0]
        self.assertEqual(uid, region.uid)
        self.assertIsNone(mask_override)
        self.assertIsNone(ownership_context)

    def test_single_cross_stitch_worker_rejects_twenty_five_percent_coverage(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = importlib.import_module("stitch_studio.core.stitch_engine").StitchEngine(
            px_per_mm=10.0
        )
        project = project_mod.Project()
        layer = project_mod.Layer()
        mask = np.zeros((10, 10), dtype=np.uint8)
        mask[:5, :5] = 255
        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            underlay=False,
        )
        layer.regions = [region]
        project.layers = [layer]

        main_mod.StitchWorker(project, engine).run()

        self.assertEqual(region.stitch_paths, [])

    def test_worker_non_aligned_ownership_uses_builder_grid_origin_once(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        project = project_mod.Project()
        layer = project_mod.Layer()
        first_mask = np.zeros((40, 40), dtype=np.uint8)
        first_mask[10:30, 10:30] = 255
        second_mask = np.zeros((40, 40), dtype=np.uint8)
        second_mask[10:30, 30:40] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
            cross_align_grid=False,
            cross_grid_offset_x_mm=0.2,
            cross_grid_offset_y_mm=0.3,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        first = project_mod.Region(mask=first_mask, stitch_settings=settings)
        second = project_mod.Region(
            mask=second_mask,
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [first, second]
        project.layers = [layer]

        main_mod.StitchWorker(project, engine).run()

        self.assertIn([(12.0, 13.0), (22.0, 23.0)], first.stitch_paths)

    def test_worker_checkerboard_ownership_paths_do_not_duplicate_cells(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        project = project_mod.Project()
        layer = project_mod.Layer()
        first_mask = np.zeros((6, 6), dtype=np.uint8)
        second_mask = np.zeros((6, 6), dtype=np.uint8)
        for row in range(3):
            for column in range(3):
                target = first_mask if (row + column) % 2 == 0 else second_mask
                target[row * 2:(row + 1) * 2, column * 2:(column + 1) * 2] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=2.0,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        first = project_mod.Region(mask=first_mask, stitch_settings=settings)
        second = project_mod.Region(
            mask=second_mask,
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [first, second]
        project.layers = [layer]

        main_mod.StitchWorker(project, engine).run()

        paths = first.stitch_paths + second.stitch_paths
        self.assertEqual(len(paths), len({tuple(path) for path in paths}))

    def test_worker_auto_cross_method_has_dense_ownership_context(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        engine._choose_cross_stitch_method = lambda *args: "dense_upright"
        project = project_mod.Project()
        layer = project_mod.Layer()
        left_mask = np.zeros((20, 20), dtype=np.uint8)
        right_mask = np.zeros((20, 20), dtype=np.uint8)
        left_mask[:, :10] = 255
        right_mask[:, 10:] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="auto",
            cross_pattern_size_mm=1.0,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        left = project_mod.Region(mask=left_mask, stitch_settings=settings)
        right = project_mod.Region(
            mask=right_mask,
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [left, right]
        project.layers = [layer]

        worker = main_mod.StitchWorker(project, engine)
        worker.run()

        self.assertIsNone(worker.failure_message)
        self.assertTrue(left.stitch_paths or right.stitch_paths)

    def test_shared_context_is_mapping_and_array_read_only(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        mask = np.full((4, 4), 255, dtype=np.uint8)
        context = stitch_mod.CrossStitchOwnershipContext(
            {"region": mask},
            base_grid_origin_px=(0.0, 0.0),
        )

        self.assertFalse(context.base_masks["region"].flags.writeable)
        with self.assertRaises(TypeError):
            context.base_masks["another"] = mask
        with self.assertRaises(ValueError):
            context.base_masks["region"][0, 0] = 0

    def test_worker_keeps_checkerboard_ownership_with_unrelated_run_region(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        project = project_mod.Project()
        layer = project_mod.Layer()
        first_mask = np.zeros((6, 6), dtype=np.uint8)
        second_mask = np.zeros((6, 6), dtype=np.uint8)
        for row in range(3):
            for column in range(3):
                first_mask[row * 2:(row + 1) * 2, column * 2] = 255
                second_mask[row * 2:(row + 1) * 2, column * 2 + 1] = 255
        cross_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=2.0,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        first = project_mod.Region(mask=first_mask, stitch_settings=cross_settings)
        second = project_mod.Region(
            mask=second_mask,
            stitch_settings=project_mod.StitchSettings.from_dict(cross_settings.to_dict()),
        )
        run_mask = np.zeros((6, 6), dtype=np.uint8)
        run_mask[:, 0] = 255
        run = project_mod.Region(
            mask=run_mask,
            stitch_settings=project_mod.StitchSettings(
                fill_mode="run",
                stitch_length_mm=1.0,
                underlay=False,
            ),
        )
        layer.regions = [first, second, run]
        project.layers = [layer]

        worker = main_mod.StitchWorker(project, engine)
        worker.run()

        cross_paths = first.stitch_paths + second.stitch_paths
        self.assertIsNone(worker.failure_message)
        self.assertEqual(len(cross_paths), 9)
        self.assertEqual(len(cross_paths), len({tuple(path) for path in cross_paths}))

    def test_resize_and_boundary_edit_rasterize_masks_and_confine_cross_paths(self):
        from shapely.geometry import Polygon

        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        project = project_mod.Project()
        layer = project_mod.Layer()
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=0.4,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        first_mask = np.zeros((16, 16), dtype=np.uint8)
        second_mask = np.zeros((16, 16), dtype=np.uint8)
        first_mask[:, :8] = 255
        second_mask[:, 8:] = 255
        first = project_mod.Region(
            mask=first_mask,
            polygon=Polygon([(0, 0), (8, 0), (8, 16), (0, 16)]),
            stitch_settings=settings,
        )
        second = project_mod.Region(
            mask=second_mask,
            polygon=Polygon([(8, 0), (16, 0), (16, 16), (8, 16)]),
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [first, second]
        for region in layer.regions:
            region.stitch_points = [(0.0, 0.0), (16.0, 16.0)]
        project.layers = [layer]
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.stitch_engine = engine
        window._flow_field = None
        window._current_mask_scale = lambda: 1.0
        window._refresh_region_mask = lambda *args: None
        window._refresh_layer_stitches = lambda *args: None
        window._update_stats = lambda: None
        window.status_info = types.SimpleNamespace(setText=lambda text: None)
        window.canvas = types.SimpleNamespace(select_object=lambda uid: None)
        window.layer_panel = types.SimpleNamespace(
            refresh=lambda: None,
            select_uid=lambda uid: None,
        )

        window._resize_layer_regions(layer, (0.0, 0.0, 8.0, 8.0))

        self.assertEqual(int(np.count_nonzero(first.mask[:, 4:])), 0)
        self.assertEqual(int(np.count_nonzero(second.mask[:, :4])), 0)
        resized_points = [pt for region in layer.regions for path in region.stitch_paths for pt in path]
        self.assertTrue(resized_points)
        self.assertGreaterEqual(min(x for x, _ in resized_points), 0.0)
        self.assertLessEqual(max(x for x, _ in resized_points), 8.0)
        self.assertLessEqual(max(y for _, y in resized_points), 8.0)

        window._apply_boundary_edit(first.uid, [(4, 0), (8, 0), (8, 8), (4, 8)])

        self.assertEqual(int(np.count_nonzero(first.mask[:, :4])), 0)
        edited_points = [pt for path in first.stitch_paths for pt in path]
        self.assertTrue(edited_points)
        self.assertGreaterEqual(min(x for x, _ in edited_points), 4.0)
        self.assertLessEqual(max(x for x, _ in edited_points), 8.0)
        self.assertGreaterEqual(min(y for _, y in edited_points), 0.0)
        self.assertLessEqual(max(y for _, y in edited_points), 8.0)

    def test_layer_resize_regenerates_adjacent_cross_regions_from_one_final_context(self):
        from shapely.geometry import Polygon

        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        project = project_mod.Project()
        layer = project_mod.Layer()
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=0.4,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        left_mask = np.zeros((16, 16), dtype=np.uint8)
        right_mask = np.zeros((16, 16), dtype=np.uint8)
        left_mask[:, :8] = 255
        right_mask[:, 8:] = 255
        left = project_mod.Region(
            mask=left_mask,
            polygon=Polygon([(0, 0), (8, 0), (8, 16), (0, 16)]),
            stitch_settings=settings,
        )
        right = project_mod.Region(
            mask=right_mask,
            polygon=Polygon([(8, 0), (16, 0), (16, 16), (8, 16)]),
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [left, right]
        for region in layer.regions:
            region.stitch_points = [(0.0, 0.0), (16.0, 16.0)]
        project.layers = [layer]
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.stitch_engine = engine
        window._flow_field = None
        window._current_mask_scale = lambda: 1.0

        window._resize_layer_regions(layer, (0.0, 0.0, 10.0, 10.0))

        resized_paths = {region.uid: region.stitch_paths for region in layer.regions}
        contexts = window._cross_stitch_ownership_contexts()
        expected_paths = {
            region.uid: engine.generate_region_paths(
                region,
                ownership_context=contexts.get(region.uid),
            )
            for region in layer.regions
        }
        all_paths = [path for paths in resized_paths.values() for path in paths]

        self.assertEqual(resized_paths, expected_paths)
        self.assertEqual(len(all_paths), len({tuple(path) for path in all_paths}))
        self.assertTrue(all_paths)

    def test_layer_resize_keeps_run_region_generation(self):
        from shapely.geometry import Polygon

        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")

        class RecordingEngine:
            def __init__(self):
                self.calls = []

            def generate_region_paths(
                self,
                region,
                image,
                flow_field,
                mask_override=None,
                ownership_context=None,
            ):
                self.calls.append((region.uid, ownership_context))
                return [[(0.0, 0.0), (8.0, 8.0)]]

        project = project_mod.Project()
        layer = project_mod.Layer()
        mask = np.full((16, 16), 255, dtype=np.uint8)
        region = project_mod.Region(
            mask=mask,
            polygon=Polygon([(0, 0), (16, 0), (16, 16), (0, 16)]),
            stitch_settings=project_mod.StitchSettings(
                fill_mode="run",
                stitch_length_mm=1.0,
                underlay=False,
            ),
        )
        region.stitch_points = [(0.0, 0.0), (16.0, 16.0)]
        layer.regions = [region]
        project.layers = [layer]
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.stitch_engine = RecordingEngine()
        window._flow_field = None
        window._current_mask_scale = lambda: 1.0

        window._resize_layer_regions(layer, (0.0, 0.0, 8.0, 8.0))

        self.assertEqual(window.stitch_engine.calls, [(region.uid, None)])
        self.assertEqual(region.stitch_paths, [[(0.0, 0.0), (8.0, 8.0)]])
        self.assertEqual(int(np.count_nonzero(region.mask[:, 8:])), 0)

    def test_layer_resize_scales_fallback_region_without_regeneration(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")

        class RecordingEngine:
            def __init__(self):
                self.calls = []

            def generate_region_paths(
                self,
                region,
                image,
                flow_field,
                mask_override=None,
                ownership_context=None,
            ):
                self.calls.append(region.uid)
                return []

        project = project_mod.Project()
        layer = project_mod.Layer()
        region = project_mod.Region(
            mask=np.full((10, 10), 255, dtype=np.uint8),
            stitch_settings=project_mod.StitchSettings(
                fill_mode="run",
                stitch_length_mm=1.0,
                underlay=False,
            ),
        )
        region.stitch_paths = [[(0.0, 0.0), (10.0, 10.0)]]
        region.stitch_points = [(0.0, 0.0), (10.0, 10.0)]
        layer.regions = [region]
        project.layers = [layer]
        engine = RecordingEngine()
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.stitch_engine = engine
        window._flow_field = None
        window._current_mask_scale = lambda: 1.0

        window._resize_layer_regions(layer, (0.0, 0.0, 20.0, 20.0))

        self.assertEqual(region.stitch_paths, [[(0.0, 0.0), (20.0, 20.0)]])
        self.assertEqual(region.stitch_points, [(0.0, 0.0), (20.0, 20.0)])
        self.assertEqual(engine.calls, [])

    def test_ownership_context_rejects_missing_base_or_dense_origin(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        mask = np.full((10, 10), 255, dtype=np.uint8)
        with self.assertRaises(ValueError):
            stitch_mod.CrossStitchOwnershipContext.from_ownership_masks({"base": mask})
        with self.assertRaises(ValueError):
            stitch_mod.CrossStitchOwnershipContext(
                {"base": mask},
                base_grid_origin_px=(0.0, 0.0),
                dense_masks={"base": mask},
            )

    def test_dense_ownership_context_requires_dense_mapping(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        mask = np.full((10, 10), 255, dtype=np.uint8)
        region = project_mod.Region(mask=mask)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="dense_upright",
            cross_pattern_size_mm=1.0,
            underlay=False,
        )
        context = stitch_mod.CrossStitchOwnershipContext(
            {region.uid: mask},
            base_grid_origin_px=(0.0, 0.0),
        )

        with self.assertRaisesRegex(ValueError, "dense ownership"):
            stitch_mod.StitchEngine(px_per_mm=10.0).generate_region_paths(
                region,
                ownership_context=context,
            )

    def test_direct_regeneration_rebuilds_checkerboard_ownership_context(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        project = project_mod.Project()
        layer = project_mod.Layer()
        first_mask = np.zeros((6, 6), dtype=np.uint8)
        second_mask = np.zeros((6, 6), dtype=np.uint8)
        for row in range(3):
            for column in range(3):
                target = first_mask if (row + column) % 2 == 0 else second_mask
                target[row * 2:(row + 1) * 2, column * 2:(column + 1) * 2] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="cross",
            cross_pattern_size_mm=2.0,
            cross_coverage=0.5,
            stitch_length_max_mm=20.0,
            underlay=False,
        )
        first = project_mod.Region(mask=first_mask, stitch_settings=settings)
        second = project_mod.Region(
            mask=second_mask,
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [first, second]
        project.layers = [layer]
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.stitch_engine = engine
        window.project = project
        window._flow_field = None

        window._regenerate_region(layer, first)
        window._regenerate_region(layer, second)

        paths = first.stitch_paths + second.stitch_paths
        self.assertEqual(len(paths), len({tuple(path) for path in paths}))

    def test_resize_and_boundary_regeneration_pass_ownership_context(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")
        from shapely.geometry import Polygon

        class OwnershipMasks(dict):
            grid_origin_px = (0.0, 0.0)

        class RecordingEngine:
            def __init__(self):
                self.contexts = []

            def build_cross_stitch_ownership_masks(self, region_priorities, **kwargs):
                return OwnershipMasks({
                    region.uid: np.full(region.mask.shape, 255, dtype=np.uint8)
                    for region, _ in region_priorities
                })

            def generate_region_paths(
                self,
                region,
                image,
                flow_field,
                mask_override=None,
                ownership_context=None,
            ):
                self.contexts.append(ownership_context)
                return [[(0.0, 0.0), (10.0, 10.0)]]

        project = project_mod.Project()
        layer = project_mod.Layer()
        settings = project_mod.StitchSettings(fill_mode="cross_stitch")
        first = project_mod.Region(
            mask=np.full((10, 10), 255, dtype=np.uint8),
            polygon=Polygon([(0, 0), (4, 0), (4, 4), (0, 4)]),
            stitch_settings=settings,
        )
        second = project_mod.Region(
            mask=np.full((10, 10), 255, dtype=np.uint8),
            polygon=Polygon([(5, 0), (9, 0), (9, 4), (5, 4)]),
            stitch_settings=project_mod.StitchSettings.from_dict(settings.to_dict()),
        )
        layer.regions = [first, second]
        for region in layer.regions:
            region.stitch_points = [(0.0, 0.0), (10.0, 10.0)]
        project.layers = [layer]
        engine = RecordingEngine()
        window = main_mod.MainWindow.__new__(main_mod.MainWindow)
        window.project = project
        window.stitch_engine = engine
        window._flow_field = None
        window._current_mask_scale = lambda: 1.0
        window._refresh_region_mask = lambda *args: None
        window._refresh_layer_stitches = lambda *args: None
        window._update_stats = lambda: None
        window.status_info = types.SimpleNamespace(setText=lambda text: None)
        window.canvas = types.SimpleNamespace(select_object=lambda uid: None)
        window.layer_panel = types.SimpleNamespace(
            refresh=lambda: None,
            select_uid=lambda uid: None,
        )

        window._resize_layer_regions(layer, (0.0, 0.0, 20.0, 10.0))
        window._apply_boundary_edit(first.uid, [(0, 0), (5, 0), (5, 5), (0, 5)])

        self.assertGreaterEqual(len(engine.contexts), 3)
        self.assertTrue(all(context is not None for context in engine.contexts))

    def test_cross_stitch_worker_disables_context_without_shared_ownership(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")

        class RecordingEngine:
            def __init__(self):
                self.calls = []

            def build_cross_stitch_ownership_masks(self, *args, **kwargs):
                return {}

            def generate_region_paths(
                self,
                region,
                image,
                flow_field,
                mask_override=None,
                ownership_context=None,
            ):
                self.calls.append(ownership_context)
                return []

        project = project_mod.Project()
        layer = project_mod.Layer()
        region = project_mod.Region(mask=np.full((10, 10), 255, dtype=np.uint8))
        region.stitch_settings = project_mod.StitchSettings(fill_mode="cross_stitch")
        layer.regions = [region]
        project.layers = [layer]
        engine = RecordingEngine()

        main_mod.StitchWorker(project, engine).run()

        self.assertEqual(engine.calls, [None])

    def test_cross_stitch_cells_keep_filtering_isolated_source_noise(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        mask = np.zeros((10, 10), dtype=np.uint8)
        mask[0, 0] = 255
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_pattern_size_mm=1.0,
            cross_coverage=0.5,
        )

        self.assertEqual(engine._cross_stitch_cells(mask, settings), [])

    def test_cross_stitch_global_grid_assigns_split_cell_to_one_color(self):
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=2.0)
        regions = []
        for coordinates in (
            [(0, 0), (1, 0), (0, 1), (1, 1), (0, 2), (1, 2)],
            [(2, 0), (3, 0), (2, 1), (3, 1), (2, 2)],
            [(3, 2), (0, 3), (1, 3), (2, 3), (3, 3)],
        ):
            mask = np.zeros((4, 4), dtype=np.uint8)
            for x, y in coordinates:
                mask[y, x] = 255
            region = project_mod.Region(mask=mask)
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_pattern_size_mm=2.0,
                cross_coverage=0.5,
            )
            regions.append(region)

        assigned = engine.build_cross_stitch_ownership_masks(
            [(region, 1.0) for region in regions]
        )

        self.assertEqual(sum(np.count_nonzero(mask) for mask in assigned.values()), 16)
        self.assertEqual(sum(bool(np.any(mask)) for mask in assigned.values()), 1)

    def test_cross_stitch_grid_rejects_isolated_high_priority_color_speck(self):
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        base_mask = np.full((6, 6), 255, dtype=np.uint8)
        detail_mask = np.zeros((6, 6), dtype=np.uint8)
        detail_mask[2, 2] = 255
        base_mask[2, 2] = 0
        base = project_mod.Region(mask=base_mask)
        detail = project_mod.Region(mask=detail_mask)
        for region in (base, detail):
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_pattern_size_mm=2.0,
                cross_coverage=0.5,
            )

        assigned = engine.build_cross_stitch_ownership_masks(
            [(base, 1.0), (detail, 5.0)]
        )

        self.assertEqual(int(np.count_nonzero(assigned[detail.uid])), 0)
        self.assertEqual(int(np.count_nonzero(assigned[base.uid])), 36)

    def test_cross_stitch_grid_preserves_connected_one_pixel_detail_line(self):
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.0)
        base_mask = np.full((6, 6), 255, dtype=np.uint8)
        detail_mask = np.zeros((6, 6), dtype=np.uint8)
        detail_mask[1, :] = 255
        base_mask[1, :] = 0
        base = project_mod.Region(mask=base_mask)
        detail = project_mod.Region(mask=detail_mask)
        for region in (base, detail):
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_pattern_size_mm=2.0,
                cross_coverage=0.5,
            )

        assigned = engine.build_cross_stitch_ownership_masks(
            [(base, 1.0), (detail, 5.0)]
        )

        self.assertEqual(int(np.count_nonzero(assigned[detail.uid])), 12)
        self.assertEqual(int(np.count_nonzero(assigned[base.uid])), 24)

    def test_cross_stitch_priority_uses_region_detail_metadata_after_layer_merge(self):
        main_mod = importlib.import_module("stitch_studio.ui.main_window")
        project_mod = importlib.import_module("stitch_studio.core.project")

        layer = project_mod.Layer(
            thread_color_rgb=(30, 120, 210),
            design_color_rgb=(30, 120, 210),
        )
        base = project_mod.Region(
            design_color_rgb=(30, 120, 210),
            is_detail_region=False,
        )
        detail = project_mod.Region(
            design_color_rgb=(15, 15, 15),
            is_detail_region=True,
        )

        self.assertEqual(main_mod.StitchWorker._cross_stitch_priority(layer, base), 1.0)
        self.assertEqual(main_mod.StitchWorker._cross_stitch_priority(layer, detail), 5.0)

    def test_cross_stitch_global_grid_masks_do_not_overlap_at_fractional_boundaries(self):
        project_mod = importlib.import_module("stitch_studio.core.project")
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=1.75)
        masks = []
        for column_slice in (slice(0, 4), slice(4, 7)):
            mask = np.zeros((7, 7), dtype=np.uint8)
            mask[:, column_slice] = 255
            region = project_mod.Region(mask=mask)
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_pattern_size_mm=2.0,
                cross_coverage=0.5,
            )
            masks.append(region)

        assigned = engine.build_cross_stitch_ownership_masks(
            [(region, 1.0) for region in masks]
        )
        assignment_count = np.sum(
            [mask > 0 for mask in assigned.values()],
            axis=0,
        )

        self.assertLessEqual(int(assignment_count.max()), 1)
        self.assertEqual(int(np.count_nonzero(assignment_count)), 49)

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

    def test_short_cross_stitch_segments_do_not_call_shapely_segmentize(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")

        engine = stitch_mod.StitchEngine(px_per_mm=10.0)
        original = stitch_mod.LineString
        try:
            stitch_mod.LineString = lambda *args, **kwargs: (_ for _ in ()).throw(
                AssertionError("short two-point cross stitches should use math fast path")
            )
            path = engine._segmentized_path([(0.0, 0.0), (10.0, 10.0)], 20.0)
        finally:
            stitch_mod.LineString = original

        self.assertEqual(path, [(0.0, 0.0), (10.0, 10.0)])

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

    def test_cross_stitch_auto_method_keeps_large_saturated_decoration_dense(
        self,
    ):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.ones((96, 96), dtype=np.uint8) * 255
        image = np.full((96, 96, 3), (42, 88, 168), dtype=np.uint8)
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="auto",
            cross_detail_boost=0.5,
        )

        self.assertEqual(
            engine._choose_cross_stitch_method(mask, settings, image),
            "double_cross",
        )

    def test_cross_stitch_auto_density_is_continuous_across_eight_percent_area(
        self,
    ):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        image = np.full((100, 100, 3), (42, 88, 168), dtype=np.uint8)
        settings = project_mod.StitchSettings(
            fill_mode="cross_stitch",
            cross_method="auto",
            cross_detail_boost=0.5,
        )

        methods = []
        for area in (790, 810):
            mask = np.zeros((100, 100), dtype=np.uint8)
            mask[:10, : area // 10] = 255
            methods.append(
                engine._choose_cross_stitch_method(mask, settings, image)
            )

        self.assertEqual(methods, ["double_cross", "double_cross"])

    def test_default_fill_settings_are_dense_without_duplicate_edge_contour(self):
        image_mod = importlib.import_module("stitch_studio.core.image_engine")

        mask = np.zeros((60, 60), dtype=np.uint8)
        mask[10:50, 14:46] = 255

        settings = image_mod.ImageEngine._default_stitch_settings_for_mask(mask)

        self.assertEqual(settings.fill_mode, "scanline")
        self.assertLessEqual(settings.row_spacing_mm, 0.20)
        self.assertGreaterEqual(settings.density, 1.35)
        self.assertGreaterEqual(settings.pull_compensation_mm, 0.18)
        self.assertEqual(settings.contour_count, 0)

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

    def test_satin_outline_keeps_disconnected_borders_as_separate_paths(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((30, 60), dtype=np.uint8)
        region.mask[8:11, 5:25] = 255
        region.mask[19:22, 35:55] = 255
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="satin",
            stitch_length_mm=0.45,
            row_spacing_mm=0.5,
            underlay=False,
            contour_count=0,
        )

        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), 2)
        self.assertTrue(all(len(path) >= 4 for path in paths))

    def test_triple_run_retraces_one_continuous_centerline(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((30, 70), dtype=np.uint8)
        region.mask[14:17, 8:62] = 255
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=1.5,
            run_passes=3,
            underlay=False,
            contour_count=0,
        )

        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), 1)
        total_length = sum(
            np.hypot(b[0] - a[0], b[1] - a[1])
            for a, b in zip(paths[0], paths[0][1:])
        )
        direct_length = np.hypot(
            paths[0][-1][0] - paths[0][0][0],
            paths[0][-1][1] - paths[0][0][1],
        )
        self.assertGreater(total_length, direct_length * 2.5)
        self.assertLess(
            max(
                np.hypot(b[0] - a[0], b[1] - a[1])
                for a, b in zip(paths[0], paths[0][1:])
            ),
            20.0,
        )

    def test_feature_contour_run_turns_branched_ring_into_one_closed_path(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        region = project_mod.Region()
        region.mask = np.zeros((64, 64), dtype=np.uint8)
        cv2.circle(region.mask, (32, 32), 18, 255, 3)
        cv2.line(region.mask, (32, 14), (32, 28), 255, 2)
        cv2.line(region.mask, (50, 32), (36, 32), 255, 2)
        region.stitch_settings = project_mod.StitchSettings(
            fill_mode="run",
            stitch_length_mm=1.5,
            run_passes=3,
            underlay=False,
            contour_count=0,
        )
        region.stitch_settings.run_trace_contour = True

        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0][0], paths[0][-1])
        self.assertGreater(len(paths[0]), 24)

    def test_satin_stitch_length_controls_border_density(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((30, 100), dtype=np.uint8)
        mask[12:17, 8:92] = 255
        dense = project_mod.StitchSettings(
            fill_mode="satin",
            stitch_length_mm=0.2,
            row_spacing_mm=0.5,
            underlay=False,
            contour_count=0,
        )
        sparse = project_mod.StitchSettings(
            fill_mode="satin",
            stitch_length_mm=1.0,
            row_spacing_mm=0.5,
            underlay=False,
            contour_count=0,
        )

        dense_path = engine._generate_satin_fill(mask, dense)
        sparse_path = engine._generate_satin_fill(mask, sparse)

        self.assertGreater(len(dense_path), len(sparse_path) * 2)

    def test_branching_satin_border_splits_paths_instead_of_crossing_blank_space(self):
        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((80, 80), dtype=np.uint8)
        mask[8:68, 37:43] = 255
        mask[25:31, 12:68] = 255
        settings = project_mod.StitchSettings(
            fill_mode="satin",
            stitch_length_mm=0.2,
            row_spacing_mm=0.5,
            underlay=False,
            contour_count=0,
        )

        paths = engine._generate_satin_paths(mask, settings)
        longest_segment = max(
            np.hypot(b[0] - a[0], b[1] - a[1])
            for path in paths
            for a, b in zip(path, path[1:])
        )

        self.assertGreaterEqual(len(paths), 3)
        self.assertLess(longest_segment, 10.0)

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

    def test_large_scanline_region_does_not_receive_artificial_acute_tip_paths(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((120, 120), dtype=np.uint8)
        cv2.fillPoly(
            mask,
            [np.array([[8, 108], [60, 8], [112, 108]], dtype=np.int32)],
            255,
        )
        settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.2,
            density=1.4,
            underlay=False,
            contour_count=0,
            pull_compensation_mm=0.0,
        )
        region = project_mod.Region(mask=mask, stitch_settings=settings)

        base_paths = engine._generate_scanline_paths(mask, settings)
        generated_paths = engine.generate_region_paths(region)

        self.assertEqual(len(generated_paths), len(base_paths))

    def test_small_scanline_detail_does_not_add_automatic_miter_paths(self):
        import cv2

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        project_mod = importlib.import_module("stitch_studio.core.project")

        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((60, 80), dtype=np.uint8)
        cv2.fillPoly(
            mask,
            [np.array([[8, 40], [42, 20], [34, 38]], dtype=np.int32)],
            255,
        )
        settings = project_mod.StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.0,
            row_spacing_mm=0.2,
            density=1.4,
            underlay=False,
            contour_count=0,
            pull_compensation_mm=0.0,
        )
        region = project_mod.Region(mask=mask, stitch_settings=settings)
        primary = engine._generate_scanline_paths(mask, settings)
        reinforce = project_mod.StitchSettings(
            fill_mode="scanline",
            angle_deg=settings.angle_deg + 90.0,
            stitch_length_mm=max(1.2, settings.stitch_length_mm * 0.75),
            row_spacing_mm=max(0.10, settings.row_spacing_mm * 0.75),
            density=max(settings.density, 1.65),
            underlay=False,
            contour_count=0,
            pull_compensation_mm=settings.pull_compensation_mm,
            randomize_length=settings.randomize_length,
        )
        reinforced = engine._generate_scanline_paths(mask, reinforce)

        generated = engine.generate_region_paths(region)

        self.assertEqual(len(generated), len(primary) + len(reinforced))

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

    def test_large_scanline_shape_does_not_add_automatic_acute_tip_fill(self):
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

        prepared = engine._prepare_mask(region.mask, region.stitch_settings)
        expected_count = len(
            engine._generate_contour_paths(prepared, region.stitch_settings)
        ) + len(
            engine._generate_scanline_paths(prepared, region.stitch_settings)
        )
        paths = engine.generate_region_paths(region)

        self.assertEqual(len(paths), expected_count)

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

    def test_mask_polygon_preserves_border_hole_and_disconnected_island(self):
        from shapely.geometry import Point

        stitch_mod = importlib.import_module("stitch_studio.core.stitch_engine")
        engine = stitch_mod.StitchEngine(px_per_mm=4.0)
        mask = np.zeros((80, 100), dtype=np.uint8)
        mask[2:6, 2:98] = 255
        mask[74:78, 2:98] = 255
        mask[2:78, 2:6] = 255
        mask[2:78, 94:98] = 255
        mask[28:42, 42:56] = 255

        poly = engine._mask_to_polygon(mask, compensation_mm=0.0)

        self.assertIsNotNone(poly)
        self.assertFalse(poly.covers(Point(20, 30)))
        self.assertTrue(poly.covers(Point(48, 34)))
        self.assertTrue(hasattr(poly, "geoms"))
        self.assertGreaterEqual(len(poly.geoms), 2)

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

    def test_geometry_engine_preserves_disconnected_islands_and_holes(self):
        import cv2

        geom_mod = importlib.import_module("stitch_studio.core.geometry_engine")
        mask = np.zeros((96, 128), dtype=np.uint8)
        cv2.rectangle(mask, (8, 8), (62, 82), 255, -1)
        cv2.rectangle(mask, (24, 26), (48, 64), 0, -1)
        cv2.circle(mask, (102, 25), 14, 255, -1)
        mask[74:77, 86:120] = 255

        geometry = geom_mod.GeometryEngine.reconstruct_region_polygon(mask)

        self.assertIsNotNone(geometry)
        self.assertTrue(geometry.is_valid)
        self.assertGreaterEqual(len(getattr(geometry, "geoms", [geometry])), 3)

        raster = np.zeros_like(mask)
        geometries = getattr(geometry, "geoms", [geometry])
        for polygon in geometries:
            exterior = np.rint(np.asarray(polygon.exterior.coords)).astype(np.int32)
            cv2.fillPoly(raster, [exterior], 255)
            for interior in polygon.interiors:
                hole = np.rint(np.asarray(interior.coords)).astype(np.int32)
                cv2.fillPoly(raster, [hole], 0)

        source = mask > 0
        rendered = raster > 0
        intersection = int(np.count_nonzero(source & rendered))
        union = int(np.count_nonzero(source | rendered))
        self.assertGreaterEqual(intersection / union, 0.95)
        self.assertEqual(int(raster[45, 35]), 0)
        self.assertEqual(int(raster[25, 102]), 255)
        self.assertEqual(int(raster[75, 105]), 255)

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

    def test_export_run_paths_jump_instead_of_sewing_across_blank_space(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(0, 0, 0), order=0)
        region = project_mod.Region()
        region.stitch_settings = project_mod.StitchSettings(fill_mode="run")
        region.stitch_paths = [
            [(0.0, 0.0), (10.0, 0.0)],
            [(25.0, 0.0), (35.0, 0.0)],
        ]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)
        commands = [cmd for _, _, cmd in pattern.stitches]

        self.assertEqual(commands.count(pyembroidery.JUMP), 2)

    def test_export_spatially_orders_merged_cross_stitch_shades(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        for index, x_positions in enumerate(((0, 40, 80), (20, 60, 100))):
            layer = project_mod.Layer(
                thread_uid="shared-thread",
                thread_color_rgb=(20 + index, 100, 200),
                matched_thread_rgb=(20, 100, 200),
                order=index,
            )
            region = project_mod.Region()
            region.stitch_settings = project_mod.StitchSettings(
                fill_mode="cross_stitch",
                cross_pattern_size_mm=2.0,
            )
            region.stitch_paths = [
                [(float(x), 0.0), (float(x), 10.0)]
                for x in x_positions
            ]
            layer.regions = [region]
            project.layers.append(layer)

        pattern = export_mod.ExportEngine().build_pattern(project)
        commands = [command for _, _, command in pattern.stitches]

        self.assertEqual(len(pattern.threadlist), 1)
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

    def test_export_merges_design_layers_matched_to_same_physical_thread(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        for index, design_color in enumerate(((15, 100, 205), (25, 110, 215))):
            layer = project_mod.Layer(
                thread_uid="physical-blue",
                thread_color_rgb=design_color,
                matched_thread_rgb=(20, 105, 210),
                order=index,
            )
            region = project_mod.Region()
            region.stitch_paths = [[(0.0, float(index)), (10.0, float(index))]]
            layer.regions = [region]
            project.layers.append(layer)

        pattern = export_mod.ExportEngine().build_pattern(project)

        self.assertEqual(len(pattern.threadlist), 1)
        self.assertEqual(pattern.threadlist[0].color, 0x1469D2)
        self.assertNotIn(
            pyembroidery.COLOR_CHANGE,
            [command for _, _, command in pattern.stitches],
        )

    def test_compact_dst_thread_metadata_stays_inside_fixed_header(self):
        install_fake_pyembroidery()
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        header = b"LA:test\rST:    10\rCO: 19\rPD:******\r".ljust(511, b" ") + b"\x1a"
        colors = [(index * 123457) & 0xFFFFFF for index in range(20)]

        updated = export_mod.ExportEngine._compact_dst_header(header, colors)

        self.assertEqual(len(updated), 512)
        self.assertEqual(updated[-1], 0x1A)
        self.assertEqual(updated.count(b"TC:#"), 20)

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
                (filepath, {}),
                (edr_path, {}),
            ],
        )
        self.assertEqual(written_files, [filepath, edr_path])

    def test_pes_export_defaults_to_version_6_for_exact_thread_colors(self):
        fake = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")
        calls = []

        def capture_write(pattern, filepath, settings=None):
            calls.append((filepath, dict(settings or {})))

        fake.write = capture_write
        export_mod.pyembroidery.write = capture_write
        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(250, 139, 119), order=0)
        region = project_mod.Region()
        region.stitch_paths = [[(0.0, 0.0), (20.0, 20.0)]]
        layer.regions = [region]
        project.layers = [layer]

        export_mod.ExportEngine().export(project, "/tmp/exact-color.pes")

        self.assertEqual(calls[0][1]["version"], 6.0)

    def test_export_splits_long_jump_moves_into_dst_safe_deltas(self):
        pyembroidery = install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(10, 120, 30), order=0)
        region = project_mod.Region()
        region.stitch_paths = [
            [(0.0, 0.0), (10.0, 0.0)],
            [(1500.0, 900.0), (1510.0, 900.0)],
        ]
        layer.regions = [region]
        project.layers = [layer]

        pattern = export_mod.ExportEngine().build_pattern(project)
        previous = (0.0, 0.0)
        for x, y, command in pattern.stitches:
            if command in (pyembroidery.STITCH, pyembroidery.JUMP):
                distance = float(np.hypot(x - previous[0], y - previous[1]))
                self.assertLessEqual(distance, 120.0)
                previous = (x, y)

    def test_export_rejects_pattern_without_stitches(self):
        install_fake_pyembroidery()
        project_mod = importlib.import_module("stitch_studio.core.project")
        export_mod = importlib.import_module("stitch_studio.core.export_engine")

        project = project_mod.Project()
        layer = project_mod.Layer(thread_color_rgb=(10, 120, 30), order=0)
        layer.regions = [project_mod.Region()]
        project.layers = [layer]

        with tempfile.TemporaryDirectory() as tmpdir:
            filepath = os.path.join(tmpdir, "empty.dst")
            with self.assertRaisesRegex(ValueError, "no stitches"):
                export_mod.ExportEngine().export(project, filepath)

            self.assertFalse(os.path.exists(filepath))

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
