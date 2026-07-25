import unittest

import numpy as np

from stitch_studio.core.contour_geometry import (
    adaptive_closed_contour,
    detect_locked_corner_indices,
    normalize_closed_contour,
)


class LocalContourGeometryTests(unittest.TestCase):
    def test_mixed_curve_keeps_two_supported_mouth_corners(self):
        points = [
            (4, 12), (6, 8), (10, 5), (16, 4), (22, 5), (26, 8),
            (30, 12), (26, 11), (22, 10), (16, 9), (10, 10), (6, 11),
            (4, 12),
        ]

        rebuilt = adaptive_closed_contour(points, spacing_px=2.0)

        self.assertIn((4.0, 12.0), rebuilt)
        self.assertIn((30.0, 12.0), rebuilt)
        self.assertEqual(rebuilt[0], rebuilt[-1])

    def test_rounded_eye_does_not_lock_pixel_stair_steps(self):
        angles = np.linspace(0.0, 2.0 * np.pi, 48, endpoint=False)
        points = [
            (round(24 + 13 * np.cos(angle)), round(20 + 17 * np.sin(angle)))
            for angle in angles
        ]
        points.append(points[0])

        anchors = detect_locked_corner_indices(points)

        self.assertLessEqual(len(anchors), 1)

    def test_single_pixel_spike_without_support_is_not_locked(self):
        points = [
            (4, 4), (12, 4), (13, 3), (14, 4), (22, 4),
            (22, 16), (4, 16), (4, 4),
        ]

        anchors = detect_locked_corner_indices(
            points,
            support=2,
            min_support_length=4.0,
        )

        self.assertNotIn(2, anchors)

    def test_degenerate_input_returns_a_safe_normalized_fallback(self):
        self.assertEqual(normalize_closed_contour([]).shape, (0, 2))
        self.assertEqual(adaptive_closed_contour([], spacing_px=2.0), [])
        self.assertEqual(
            adaptive_closed_contour([(3, 4), (3, 4)], spacing_px=2.0),
            [(3.0, 4.0)],
        )


if __name__ == "__main__":
    unittest.main()
