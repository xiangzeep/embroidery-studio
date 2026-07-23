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
    def test_subject_features_restore_eye_mouth_outlines_and_eyebrow(self):
        image = np.full((80, 100, 3), (255, 127, 80), dtype=np.uint8)
        subject = np.zeros((80, 100), dtype=bool)
        subject[5:78, 15:85] = True
        cv2.ellipse(image, (38, 30), (10, 15), 0, 0, 360, (255, 255, 255), -1)
        cv2.ellipse(image, (64, 30), (10, 15), 0, 0, 360, (255, 255, 255), -1)
        subject[np.all(image == (255, 255, 255), axis=2)] = False
        subject[5:48, 15:34] = False
        cv2.line(image, (32, 11), (43, 8), (0, 0, 0), 2)
        cv2.ellipse(image, (52, 57), (18, 12), 0, 0, 360, (90, 0, 20), -1)
        cv2.circle(image, (38, 30), 4, (0, 0, 0), -1)
        cv2.circle(image, (64, 30), 4, (0, 0, 0), -1)
        cv2.ellipse(image, (52, 58), (7, 4), 0, 0, 360, (255, 127, 80), -1)
        thread_map = np.full((80, 100), 1, dtype=np.int32)
        white = np.all(image == (255, 255, 255), axis=2)
        mouth = np.all(image == (90, 0, 20), axis=2)
        black = np.all(image == (0, 0, 0), axis=2)
        thread_map[white] = 2
        thread_map[mouth] = 3
        thread_map[black] = 0
        palette = np.array(
            [(0, 0, 0), (255, 127, 80), (255, 255, 255), (128, 0, 32)],
            dtype=np.uint8,
        )

        restored, outlines, outline_groups = RecognitionEngine._restore_subject_features(
            thread_map,
            image,
            subject,
            palette,
        )

        self.assertEqual(restored[9, 37], 0)
        self.assertTrue(np.any(restored[27:34, 28:35] == 0))
        self.assertTrue(np.any(restored[53:62, 31:38] == 0))
        self.assertEqual(restored[57, 40], 3)
        self.assertTrue(np.any(outlines[27:34, 28:35]))
        self.assertTrue(np.any(outlines[53:62, 31:38]))
        self.assertEqual(len(outline_groups), 3)
        self.assertFalse(np.any(outline_groups[0][25:36, 34:43]))
        self.assertFalse(np.any(outline_groups[1][25:36, 60:69]))
        self.assertFalse(np.any(outline_groups[2][53:64, 44:61]))

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

    def test_internal_run_detail_underpaints_neighboring_antialias_gap(self):
        design_map = np.zeros((40, 52), dtype=np.int32)
        black_line = np.zeros_like(design_map, dtype=np.uint8)
        alias_line = np.zeros_like(design_map, dtype=np.uint8)
        cv2.line(black_line, (17, 22), (34, 14), 1, 1)
        cv2.line(alias_line, (17, 23), (34, 15), 1, 1)
        design_map[alias_line > 0] = 2
        design_map[black_line > 0] = 1
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            ThreadColor(name="Light Gray", color_rgb=(190, 190, 190)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), int(np.sum(design_map == 0)), 0, 0.0),
                DesignColor(1, (0, 0, 0), int(np.sum(design_map == 1)), 1, 0.0),
                DesignColor(2, (190, 190, 190), int(np.sum(design_map == 2)), 2, 0.0),
            ],
            reconstructed_rgb=np.zeros((40, 52, 3), dtype=np.uint8),
            detail_mask=(black_line | alias_line).astype(bool),
            detail_design_ids=(1, 2),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
            subject_mask=np.ones((40, 52), dtype=bool),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        coral = next(layer for layer in layers if layer.thread_uid == threads[0].uid)
        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        coral_fill = next(
            region.mask > 0
            for region in coral.regions
            if region.stitch_settings.fill_mode == "scanline"
        )
        black_run = next(
            region.mask > 0
            for region in black.regions
            if region.stitch_settings.fill_mode == "run"
        )
        self.assertTrue(np.all(coral_fill[black_run]))
        self.assertTrue(np.all(coral_fill[alias_line > 0]))

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
            ThreadColor(name="Dark Gray", color_rgb=(64, 64, 64)),
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

    def test_internal_closed_feature_outline_uses_satin_and_open_mark_uses_run(self):
        design_map = np.zeros((72, 88), dtype=np.int32)
        left_eye = np.zeros_like(design_map, dtype=np.uint8)
        right_eye = np.zeros_like(design_map, dtype=np.uint8)
        mouth = np.zeros_like(design_map, dtype=np.uint8)
        cv2.circle(left_eye, (28, 27), 11, 1, 2)
        cv2.circle(right_eye, (48, 27), 11, 1, 2)
        cv2.ellipse(mouth, (38, 53), (15, 8), 0, 0, 360, 1, 2)
        feature_outline = (left_eye | right_eye | mouth).astype(bool)
        design_map[feature_outline] = 1
        cv2.circle(design_map, (28, 27), 5, 1, -1)
        cv2.line(design_map, (33, 27), (38, 27), 1, 1)
        cv2.line(design_map, (60, 18), (76, 12), 1, 2)
        cv2.line(design_map, (8, 8), (14, 8), 2, 1)
        threads = [
            ThreadColor(name="Coral", color_rgb=(250, 140, 119)),
            ThreadColor(name="Black", color_rgb=(0, 0, 0)),
            ThreadColor(name="Dark Gray", color_rgb=(64, 64, 64)),
        ]
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[
                DesignColor(0, (250, 140, 119), int(np.sum(design_map == 0)), 0, 0.0),
                DesignColor(1, (0, 0, 0), int(np.sum(design_map == 1)), 1, 0.0),
                DesignColor(2, (64, 64, 64), int(np.sum(design_map == 2)), 2, 0.0),
            ],
            reconstructed_rgb=np.zeros((72, 88, 3), dtype=np.uint8),
            detail_mask=feature_outline,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
            subject_mask=np.ones((72, 88), dtype=bool),
            feature_outline_mask=feature_outline,
            feature_outline_groups=tuple(
                mask.astype(bool) for mask in (left_eye, right_eye, mouth)
            ),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        modes = {region.stitch_settings.fill_mode for region in black.regions}
        self.assertEqual(modes, {"scanline", "satin", "run"})
        self.assertEqual(
            sum(region.stitch_settings.fill_mode == "satin" for region in black.regions),
            3,
        )
        self.assertEqual(
            sorted(
                int(np.count_nonzero(region.mask))
                for region in black.regions
                if region.stitch_settings.fill_mode == "satin"
            ),
            sorted(int(np.count_nonzero(mask)) for mask in (left_eye, right_eye, mouth)),
        )
        self.assertIs(layers[0], black)

    def test_feature_satin_owns_same_color_antialias_halo(self):
        design_map = np.zeros((48, 48), dtype=np.int32)
        eye = np.zeros_like(design_map, dtype=np.uint8)
        cv2.circle(eye, (24, 24), 11, 1, 2)
        design_map[eye > 0] = 1
        design_map[12:15, 17:20] = 1
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
            reconstructed_rgb=np.zeros((48, 48, 3), dtype=np.uint8),
            detail_mask=design_map == 1,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
            subject_mask=np.ones((48, 48), dtype=bool),
            feature_outline_mask=eye.astype(bool),
            feature_outline_groups=(eye.astype(bool),),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        satin_regions = [
            region
            for region in black.regions
            if region.stitch_settings.fill_mode == "satin"
        ]
        self.assertEqual(len(satin_regions), 1)
        np.testing.assert_array_equal(satin_regions[0].mask > 0, eye > 0)
        alias_only = np.zeros_like(eye, dtype=bool)
        alias_only[12:15, 17:20] = True
        alias_only &= ~(eye > 0)
        self.assertFalse(
            any(
                np.any((region.mask > 0) & alias_only)
                for region in black.regions
                if region.mask is not None
            )
        )

    def test_thick_open_facial_mark_uses_independent_satin(self):
        design_map = np.zeros((48, 72), dtype=np.int32)
        cv2.line(design_map, (14, 16), (31, 10), 1, 4)
        cv2.line(design_map, (45, 14), (62, 9), 1, 1)
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
            reconstructed_rgb=np.zeros((48, 72, 3), dtype=np.uint8),
            detail_mask=design_map == 1,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
            subject_mask=np.ones((48, 72), dtype=bool),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        satin = [
            region
            for region in black.regions
            if region.stitch_settings.fill_mode == "satin"
        ]
        running = [
            region
            for region in black.regions
            if region.stitch_settings.fill_mode == "run"
        ]
        self.assertEqual(len(satin), 1)
        self.assertEqual(len(running), 1)
        self.assertTrue(np.any(satin[0].mask[8:20, 10:35]))
        self.assertTrue(np.any(running[0].mask[7:18, 42:65]))

    def test_compact_eyebrow_uses_satin_without_reclassifying_pupil(self):
        design_map = np.zeros((64, 64), dtype=np.int32)
        eye = np.zeros_like(design_map, dtype=np.uint8)
        cv2.ellipse(eye, (32, 35), (11, 15), 0, 0, 360, 1, 2)
        design_map[eye > 0] = 1
        cv2.circle(design_map, (32, 35), 4, 1, -1)
        cv2.line(design_map, (27, 13), (36, 9), 1, 4)
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
            reconstructed_rgb=np.zeros((64, 64, 3), dtype=np.uint8),
            detail_mask=design_map == 1,
            detail_design_ids=(1,),
            metrics=RecognitionMetrics(1.0, 1.0, 1.0, 1.0),
            subject_mask=np.ones((64, 64), dtype=bool),
            feature_outline_mask=eye.astype(bool),
            feature_outline_groups=(eye.astype(bool),),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        black = next(layer for layer in layers if layer.thread_uid == threads[1].uid)
        satin_masks = [
            region.mask > 0
            for region in black.regions
            if region.stitch_settings.fill_mode == "satin"
        ]
        fill_masks = [
            region.mask > 0
            for region in black.regions
            if region.stitch_settings.fill_mode == "scanline"
        ]
        self.assertEqual(len(satin_masks), 2)
        self.assertTrue(any(np.any(mask[7:17, 24:39]) for mask in satin_masks))
        self.assertTrue(any(np.any(mask[31:40, 28:37]) for mask in fill_masks))

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
