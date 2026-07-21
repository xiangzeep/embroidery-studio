import unittest

import numpy as np

from stitch_studio.core.recognition_engine import RecognitionEngine
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


if __name__ == "__main__":
    unittest.main()
