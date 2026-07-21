import unittest

import numpy as np

from stitch_studio.core.recognition_engine import RecognitionEngine


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


if __name__ == "__main__":
    unittest.main()
