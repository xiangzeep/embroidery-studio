import unittest
import hashlib
import os

import cv2
import numpy as np
from PIL import Image

from stitch_studio.core.recognition_engine import RecognitionEngine
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

    def test_close_design_colors_share_one_thread_layer_but_keep_editable_regions(self):
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
        self.assertEqual(len(layers[0].regions), 2)
        self.assertEqual(
            len({region.design_color_rgb for region in layers[0].regions}),
            2,
        )

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
        "codex-clipboard-70fefa60-8745-4e77-8642-e7e85c45be8d.png"
    )

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
