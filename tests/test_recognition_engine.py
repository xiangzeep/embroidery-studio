import unittest
import hashlib
import os

import cv2
import numpy as np
from PIL import Image

from stitch_studio.core.recognition_engine import (
    DesignColor,
    RecognitionEngine,
    RecognitionMetrics,
    RecognitionResult,
)
from stitch_studio.core.image_engine import ImageEngine
from stitch_studio.core.project import QuantizationSettings
from stitch_studio.core.thread_db import ThreadColor


class RecognitionMetricTests(unittest.TestCase):
    def test_beginner_default_limits_physical_thread_count(self):
        self.assertEqual(QuantizationSettings().n_colors, 12)

    def test_identical_image_has_perfect_recognition_metrics(self):
        image = np.array(
            [[[10, 20, 30], [220, 210, 200]]],
            dtype=np.uint8,
        )

        metrics = RecognitionEngine.measure_fidelity(image, image.copy())

        self.assertEqual(metrics.perceptual_similarity, 1.0)
        self.assertEqual(metrics.pixel_coverage, 1.0)
        self.assertEqual(metrics.boundary_recall, 1.0)
        self.assertEqual(metrics.detail_recall, 1.0)

    def test_unassigned_pixels_reduce_coverage(self):
        source = np.full((4, 4, 3), 120, dtype=np.uint8)
        reconstructed = source.copy()
        assigned = np.ones((4, 4), dtype=bool)
        assigned[0, 0] = False

        metrics = RecognitionEngine.measure_fidelity(
            source,
            reconstructed,
            assigned_mask=assigned,
        )

        self.assertEqual(metrics.pixel_coverage, 15 / 16)


class DesignPaletteTests(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((32, 32, 3), dtype=np.uint8)
        self.image[:, :16] = (36, 142, 205)
        self.image[:, 16:] = (42, 151, 211)
        self.image[5:27, 8] = (224, 45, 71)
        self.threads = [
            ThreadColor(name="Blue", color_rgb=(38, 146, 208)),
            ThreadColor(name="Red", color_rgb=(220, 40, 70)),
        ]

    def test_recognition_keeps_close_broad_colors_and_rare_line(self):
        settings = QuantizationSettings(
            n_colors=4,
            design_color_budget=4,
            auto_design_colors=False,
            preserve_details=True,
        )

        result = RecognitionEngine.recognize(self.image, self.threads, settings)

        left_id = int(result.design_map[16, 4])
        right_id = int(result.design_map[16, 24])
        line_id = int(result.design_map[16, 8])
        self.assertNotEqual(left_id, right_id)
        self.assertNotIn(line_id, {left_id, right_id})
        self.assertGreaterEqual(result.metrics.perceptual_similarity, 0.95)
        self.assertGreaterEqual(result.metrics.pixel_coverage, 0.995)

    def test_recognition_is_deterministic_with_contiguous_ids(self):
        settings = QuantizationSettings(
            design_color_budget=4,
            auto_design_colors=False,
        )

        first = RecognitionEngine.recognize(self.image, self.threads, settings)
        second = RecognitionEngine.recognize(self.image, self.threads, settings)

        np.testing.assert_array_equal(first.design_map, second.design_map)
        np.testing.assert_array_equal(first.reconstructed_rgb, second.reconstructed_rgb)
        self.assertEqual(
            sorted(np.unique(first.design_map).tolist()),
            list(range(len(first.design_colors))),
        )


class DetailRecognitionTests(unittest.TestCase):
    def test_detects_dark_colored_and_curved_fine_lines(self):
        image = np.full((72, 72, 3), 245, dtype=np.uint8)
        expected = np.zeros((72, 72), dtype=np.uint8)
        cv2.line(image, (6, 12), (60, 12), (20, 20, 20), 1)
        cv2.line(expected, (6, 12), (60, 12), 255, 1)
        curve = np.array([[8, 55], [20, 42], [35, 40], [50, 48], [62, 60]])
        cv2.polylines(image, [curve], False, (220, 45, 92), 2)
        cv2.polylines(expected, [curve], False, 255, 2)

        detail = RecognitionEngine.detect_fine_details(image, sensitivity=0.65)

        nearby = cv2.dilate(
            detail.astype(np.uint8),
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        expected_mask = expected > 0
        recall = np.count_nonzero(expected_mask & nearby) / np.count_nonzero(expected_mask)
        self.assertGreaterEqual(recall, 0.95)

    def test_does_not_promote_large_closed_shape_boundary_as_detail(self):
        image = np.full((72, 72, 3), 245, dtype=np.uint8)
        cv2.rectangle(image, (12, 12), (60, 60), (25, 80, 180), -1)

        detail = RecognitionEngine.detect_fine_details(image, sensitivity=0.65)

        self.assertLessEqual(int(np.count_nonzero(detail)), 12)


class ThreadSuggestionTests(unittest.TestCase):
    def test_thread_map_removes_isolated_subject_speckles_but_keeps_detail(self):
        thread_map = np.full((9, 9), 2, dtype=np.int32)
        thread_map[4, 4] = 0
        thread_map[2, 2] = 3
        detail = np.zeros((9, 9), dtype=bool)
        detail[2, 2] = True
        subject = np.ones((9, 9), dtype=bool)

        cleaned = RecognitionEngine._clean_thread_map(
            thread_map,
            subject,
            detail,
        )

        self.assertEqual(cleaned[4, 4], 2)
        self.assertEqual(cleaned[2, 2], 3)

    def test_thread_map_removes_neutral_antialias_from_subject_silhouette(self):
        subject = np.zeros((15, 15), dtype=bool)
        subject[2:13, 2:13] = True
        thread_map = np.zeros((15, 15), dtype=np.int32)
        thread_map[subject] = 1
        thread_map[2, 6:9] = 2
        detail = np.zeros((15, 15), dtype=bool)
        detail[2, 6:9] = True
        palette = np.array(
            [
                (40, 90, 180),
                (255, 127, 80),
                (128, 128, 128),
            ],
            dtype=np.uint8,
        )

        cleaned = RecognitionEngine._clean_thread_map(
            thread_map,
            subject,
            detail,
            palette,
        )

        self.assertTrue(np.all(cleaned[2, 6:9] == 1))

    def test_thread_budget_prioritizes_subject_over_broad_background(self):
        design_colors = np.array(
            [
                (20, 55, 130),
                (100, 190, 245),
                (255, 125, 100),
                (10, 10, 10),
            ],
            dtype=np.uint8,
        )
        threads = [
            ThreadColor(name="Dark blue", color_rgb=(20, 55, 130)),
            ThreadColor(name="Light blue", color_rgb=(100, 190, 245)),
            ThreadColor(name="Coral", color_rgb=(255, 125, 100)),
            ThreadColor(name="Black", color_rgb=(10, 10, 10)),
        ]
        palette_lab = RecognitionEngine._physical_palette_lab(threads)

        matches = RecognitionEngine._match_threads_with_budget(
            design_colors,
            np.array([8000, 6000, 1800, 250]),
            (3,),
            palette_lab,
            2,
            subject_pixel_counts=np.array([0, 0, 1800, 250]),
        )

        selected = {match[0] for match in matches}
        self.assertEqual(selected, {2, 3})

    def test_physical_thread_matches_respect_requested_color_limit(self):
        colors = [
            (12, 18, 24),
            (245, 245, 240),
            (210, 35, 45),
            (35, 170, 75),
            (30, 90, 210),
            (235, 190, 30),
        ]
        image = np.zeros((24, 24, 3), dtype=np.uint8)
        for index, color in enumerate(colors):
            image[:, index * 4:(index + 1) * 4] = color
        threads = [
            ThreadColor(name=f"Thread {index}", color_rgb=color)
            for index, color in enumerate(colors)
        ]
        settings = QuantizationSettings(
            n_colors=4,
            design_color_budget=6,
            auto_design_colors=False,
            preserve_details=True,
            include_background=True,
        )

        result = RecognitionEngine.recognize(image, threads, settings)
        matched = {
            color.nearest_thread_index
            for color in result.design_colors
            if color.nearest_thread_index is not None
        }

        self.assertLessEqual(len(matched), 4)
        darkest = min(result.design_colors, key=lambda color: sum(color.color_rgb))
        self.assertEqual(darkest.nearest_thread_index, 0)

    def test_close_design_colors_share_one_thread_layer_and_geometry_region(self):
        image = np.zeros((20, 20, 3), dtype=np.uint8)
        image[:, :10] = (30, 140, 205)
        image[:, 10:] = (38, 149, 212)
        threads = [ThreadColor(name="Shared blue", color_rgb=(34, 145, 208))]
        settings = QuantizationSettings(
            design_color_budget=2,
            auto_design_colors=False,
            preserve_details=False,
            include_background=True,
        )
        result = RecognitionEngine.recognize(image, threads, settings)

        layers = ImageEngine.build_layers_from_recognition(
            result,
            threads,
            image,
            "photo_stitch",
            settings,
        )

        self.assertEqual(len(result.design_colors), 2)
        self.assertEqual(len(layers), 1)
        self.assertEqual(layers[0].thread_uid, threads[0].uid)
        self.assertEqual(len(layers[0].regions), 1)
        self.assertTrue(np.all(layers[0].regions[0].mask > 0))
        self.assertEqual(layers[0].regions[0].stitch_settings.fill_mode, "scanline")

    def test_recognition_photo_layers_underpaint_outline_pixels(self):
        design_map = np.zeros((30, 40), dtype=np.int32)
        design_map[:, 19:21] = 1
        design_map[:, 21:] = 2
        detail_mask = design_map == 1
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            ThreadColor(name="Blue", color_rgb=(30, 120, 210)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), 570, 0, 0.0),
                DesignColor(1, (0, 0, 0), 60, 1, 0.0),
                DesignColor(2, (30, 120, 210), 570, 2, 0.0),
            ],
            reconstructed_rgb=np.zeros((30, 40, 3), dtype=np.uint8),
            detail_mask=detail_mask,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        run_mask = np.zeros(design_map.shape, dtype=bool)
        fill_mask = np.zeros(design_map.shape, dtype=bool)
        for layer in layers:
            for region in layer.regions:
                if region.stitch_settings.fill_mode == "run":
                    run_mask |= region.mask > 0
                elif region.stitch_settings.fill_mode == "scanline":
                    fill_mask |= region.mask > 0
        self.assertTrue(np.all(fill_mask[run_mask]))

    def test_recognition_reclassifies_joined_thread_components_by_geometry(self):
        design_map = np.zeros((48, 64), dtype=np.int32)
        design_map[8:22, 12:15] = 1
        design_map[8:22, 15:18] = 2
        design_map[26:28, 25:43] = 1
        design_map[29:33, 4:7] = 2
        design_map[34:44, 35:47] = 1
        design_map[36:42, 37:45] = 0
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), 1654, 0, 0.0),
                DesignColor(1, (6, 6, 6), 78, 1, 0.0),
                DesignColor(2, (35, 20, 18), 42, 1, 1.0),
            ],
            reconstructed_rgb=np.zeros((48, 64, 3), dtype=np.uint8),
            detail_mask=design_map > 0,
            detail_design_ids=(1, 2),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        self.assertEqual(
            {region.stitch_settings.fill_mode for region in black.regions},
            {"scanline", "run"},
        )
        self.assertLessEqual(len(black.regions), 2)
        fill_mask = next(
            region.mask > 0
            for region in black.regions
            if region.stitch_settings.fill_mode == "scanline"
        )
        run_mask = next(
            region.mask > 0
            for region in black.regions
            if region.stitch_settings.fill_mode == "run"
        )
        self.assertTrue(np.all(fill_mask[8:22, 12:18]))
        self.assertTrue(np.all(run_mask[26:28, 25:43]))
        self.assertTrue(np.all(run_mask[29:33, 4:7]))
        self.assertTrue(np.all(run_mask[34:36, 35:47]))
        self.assertTrue(np.all(run_mask[36:42, 35:37]))
        self.assertFalse(np.any(run_mask[8:22, 12:18]))

    def test_recognition_uses_satin_for_long_dark_photo_outline(self):
        design_map = np.zeros((24, 64), dtype=np.int32)
        design_map[10:13, 8:56] = 1
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Red", color_rgb=(220, 30, 30)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), 1392, 0, 0.0),
                DesignColor(1, (220, 30, 30), 144, 1, 0.0),
            ],
            reconstructed_rgb=np.zeros((24, 64, 3), dtype=np.uint8),
            detail_mask=design_map == 1,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        red = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        self.assertEqual(len(red.regions), 1)
        self.assertEqual(red.regions[0].stitch_settings.fill_mode, "satin")
        self.assertEqual(red.regions[0].stitch_settings.contour_count, 0)
        self.assertLessEqual(red.regions[0].stitch_settings.row_spacing_mm, 0.18)

    def test_satin_border_owns_adjacent_antialias_detail_pixels(self):
        design_map = np.zeros((24, 64), dtype=np.int32)
        design_map[10:13, 8:56] = 1
        design_map[13:14, 20:44] = 2
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Red", color_rgb=(220, 30, 30)),
            ThreadColor(name="Blue", color_rgb=(80, 100, 200)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), 1368, 0, 0.0),
                DesignColor(1, (220, 30, 30), 144, 1, 0.0),
                DesignColor(2, (80, 100, 200), 24, 2, 0.0),
            ],
            reconstructed_rgb=np.zeros((24, 64, 3), dtype=np.uint8),
            detail_mask=design_map > 0,
            detail_design_ids=(1, 2),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        blue = next(layer for layer in layers if layer.thread_uid == threads[2].uid)
        blue_mask = blue.get_combined_mask()
        self.assertIsNone(blue_mask)

    def test_layer_recognition_metadata_survives_serialization(self):
        image = np.full((8, 8, 3), (80, 120, 160), dtype=np.uint8)
        threads = [ThreadColor(name="Blue", color_rgb=(70, 110, 150))]
        settings = QuantizationSettings(
            design_color_budget=2,
            auto_design_colors=False,
            preserve_details=False,
            include_background=True,
        )
        result = RecognitionEngine.recognize(image, threads, settings)
        layer = ImageEngine.build_layers_from_recognition(
            result,
            threads,
            image,
            "photo_stitch",
            settings,
        )[0]

        from stitch_studio.core.project import Layer
        restored = Layer.from_dict(layer.to_dict())

        self.assertEqual(restored.design_color_id, layer.design_color_id)
        self.assertEqual(restored.design_color_rgb, layer.design_color_rgb)
        self.assertEqual(restored.matched_thread_rgb, layer.matched_thread_rgb)
        self.assertEqual(restored.thread_match_delta_e, layer.thread_match_delta_e)
        self.assertEqual(
            restored.regions[0].design_color_id,
            layer.regions[0].design_color_id,
        )
        self.assertEqual(
            restored.regions[0].design_color_rgb,
            layer.regions[0].design_color_rgb,
        )
        self.assertEqual(
            restored.regions[0].is_detail_region,
            layer.regions[0].is_detail_region,
        )

    def test_disconnected_pixels_of_one_design_color_share_one_region(self):
        image = np.full((16, 16, 3), (240, 120, 80), dtype=np.uint8)
        image[1:3, 1:3] = (20, 90, 180)
        image[1:3, 12:14] = (20, 90, 180)
        image[12:14, 1:3] = (20, 90, 180)
        image[12:14, 12:14] = (20, 90, 180)
        threads = [
            ThreadColor(name="Blue", color_rgb=(20, 90, 180)),
            ThreadColor(name="Coral", color_rgb=(240, 120, 80)),
        ]
        settings = QuantizationSettings(
            design_color_budget=2,
            auto_design_colors=False,
            preserve_details=False,
            include_background=True,
        )
        result = RecognitionEngine.recognize(image, threads, settings)

        layers = ImageEngine.build_layers_from_recognition(
            result,
            threads,
            image,
            "cross_stitch",
            settings,
        )

        self.assertEqual(len(layers), 2)
        self.assertTrue(all(len(layer.regions) == 1 for layer in layers))
        covered = np.zeros(image.shape[:2], dtype=bool)
        for layer in layers:
            covered |= layer.regions[0].mask > 0
        self.assertTrue(np.all(covered))


class PatrickRegressionTests(unittest.TestCase):
    SOURCE_PATH = (
        "/var/folders/dr/g_jjd1vj4356dmv095y1l4jc0000gn/T/"
        "codex-clipboard-8db3b55f-c71c-497e-9c3e-45a029756fe6.png"
    )

    def test_primary_subject_mask_prefers_center_character(self):
        if not os.path.exists(self.SOURCE_PATH):
            self.skipTest("Supplied Patrick regression image is not available")
        image = np.array(Image.open(self.SOURCE_PATH).convert("RGB"))

        subject = RecognitionEngine.detect_primary_subject(image)

        self.assertEqual(subject.shape, image.shape[:2])
        self.assertTrue(subject[105, 160])
        self.assertTrue(subject[170, 160])
        self.assertFalse(subject[35, 20])
        self.assertFalse(subject[170, 20])
        self.assertGreater(np.mean(subject), 0.20)
        self.assertLess(np.mean(subject), 0.60)

    def test_reports_fidelity_for_final_physical_threads(self):
        if not os.path.exists(self.SOURCE_PATH):
            self.skipTest("Supplied Patrick regression image is not available")
        image = np.array(Image.open(self.SOURCE_PATH).convert("RGB"))
        threads = [
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            ThreadColor(name="White", color_rgb=(255, 255, 255)),
            ThreadColor(name="Blue", color_rgb=(0, 120, 210)),
            ThreadColor(name="Coral", color_rgb=(255, 125, 100)),
            ThreadColor(name="Red", color_rgb=(210, 35, 25)),
            ThreadColor(name="Green", color_rgb=(130, 160, 110)),
        ]

        result = RecognitionEngine.recognize(
            image,
            threads,
            QuantizationSettings(n_colors=6, include_background=True),
        )

        self.assertIsNotNone(result.thread_reconstructed_rgb)
        self.assertIsNotNone(result.thread_metrics)
        self.assertIsNotNone(result.subject_metrics)
        self.assertEqual(result.thread_reconstructed_rgb.shape, image.shape)
        self.assertLessEqual(
            result.thread_metrics.perceptual_similarity,
            result.metrics.perceptual_similarity,
        )
        self.assertGreater(result.subject_metrics.pixel_coverage, 0.20)

    def test_subject_boundary_uses_satin_but_internal_mark_uses_run(self):
        height, width = 80, 80
        subject = np.zeros((height, width), dtype=bool)
        cv2.circle(subject, (40, 40), 25, 1, -1)
        design_map = np.zeros((height, width), dtype=np.int32)
        boundary = cv2.morphologyEx(
            subject.astype(np.uint8),
            cv2.MORPH_GRADIENT,
            np.ones((3, 3), dtype=np.uint8),
        ).astype(bool)
        design_map[boundary] = 1
        design_map[38:41, 25:55] = 1
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), int(np.sum(design_map == 0)), 0, 0.0),
                DesignColor(1, (0, 0, 0), int(np.sum(design_map == 1)), 1, 0.0),
            ],
            reconstructed_rgb=np.zeros((height, width, 3), dtype=np.uint8),
            detail_mask=design_map == 1,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
            subject_mask=subject,
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        modes = {region.stitch_settings.fill_mode for region in black.regions}
        self.assertEqual(modes, {"satin", "run"})

    def test_supplied_image_meets_high_fidelity_gates(self):
        if not os.path.exists(self.SOURCE_PATH):
            self.skipTest("Supplied Patrick regression image is not available")
        with open(self.SOURCE_PATH, "rb") as source_file:
            digest = hashlib.sha256(source_file.read()).hexdigest()
        self.assertEqual(
            digest,
            "3402b4593d6871802a79b903fba75c5145747c8017f53cb73ff98dc57086bff0",
        )

        image = np.array(Image.open(self.SOURCE_PATH).convert("RGB"))
        threads = [
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            ThreadColor(name="White", color_rgb=(255, 255, 255)),
            ThreadColor(name="Blue", color_rgb=(0, 120, 210)),
            ThreadColor(name="Coral", color_rgb=(255, 125, 100)),
            ThreadColor(name="Red", color_rgb=(210, 35, 25)),
            ThreadColor(name="Green", color_rgb=(130, 160, 110)),
        ]
        settings = QuantizationSettings(
            design_color_budget=0,
            auto_design_colors=True,
            include_background=True,
            preserve_details=True,
        )

        result = RecognitionEngine.recognize(image, threads, settings)

        self.assertGreaterEqual(result.metrics.perceptual_similarity, 0.95)
        self.assertGreaterEqual(result.metrics.boundary_recall, 0.95)
        self.assertGreaterEqual(result.metrics.pixel_coverage, 0.995)
        self.assertGreaterEqual(result.metrics.detail_recall, 0.95)
        self.assertTrue(result.detail_design_ids)
        detail_ids = np.array(result.detail_design_ids, dtype=np.int32)
        self.assertTrue(np.all(np.isin(result.design_map[result.detail_mask], detail_ids)))
        self.assertFalse(np.any(np.isin(result.design_map[~result.detail_mask], detail_ids)))
        blue_design_colors = [
            color for color in result.design_colors
            if color.color_rgb[2] > color.color_rgb[0] * 1.25
            and color.color_rgb[2] > color.color_rgb[1] * 1.08
        ]
        self.assertGreaterEqual(len(blue_design_colors), 2)

        source_luminance = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        output_luminance = cv2.cvtColor(result.reconstructed_rgb, cv2.COLOR_RGB2GRAY)
        black_art = source_luminance <= 35
        retained_black = black_art & (output_luminance <= 60)
        self.assertGreaterEqual(
            np.count_nonzero(retained_black) / max(1, np.count_nonzero(black_art)),
            0.95,
        )

        repeated = RecognitionEngine.recognize(image, threads, settings)
        np.testing.assert_array_equal(result.design_map, repeated.design_map)

        import shapely

        layers = ImageEngine.build_layers_from_recognition(
            result,
            threads,
            image,
            "photo_stitch",
            settings,
        )
        rows, columns = np.indices(image.shape[:2])
        intersection = 0
        union = 0
        for layer in layers:
            for region in layer.regions:
                source = region.mask > 0
                rendered = shapely.intersects_xy(region.polygon, columns, rows)
                intersection += int(np.count_nonzero(source & rendered))
                union += int(np.count_nonzero(source | rendered))

        self.assertGreaterEqual(intersection / max(1, union), 0.95)


if __name__ == "__main__":
    unittest.main()
