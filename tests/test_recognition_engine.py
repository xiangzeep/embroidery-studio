import unittest

import cv2
import numpy as np

from stitch_studio.core.recognition_engine import RecognitionEngine
from stitch_studio.core.image_engine import ImageEngine
from stitch_studio.core.project import QuantizationSettings
from stitch_studio.core.thread_db import ThreadColor


class RecognitionMetricTests(unittest.TestCase):
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
    def test_close_design_colors_remain_distinct_when_thread_match_is_shared(self):
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
        self.assertEqual(len(layers), 2)
        self.assertEqual({layer.thread_uid for layer in layers}, {threads[0].uid})
        self.assertEqual(
            len({layer.design_color_rgb for layer in layers}),
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


if __name__ == "__main__":
    unittest.main()
