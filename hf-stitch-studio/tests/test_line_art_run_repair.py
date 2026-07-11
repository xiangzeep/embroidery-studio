import unittest

import numpy as np

from stitch_studio.core.stitch_engine import StitchEngine


class LineArtRunRepairTests(unittest.TestCase):
    def setUp(self):
        self.engine = StitchEngine(px_per_mm=2.0)

    def test_restores_source_gap_only_near_existing_run_mask(self):
        combined = np.zeros((20, 30), dtype=np.uint8)
        combined[10, 3:10] = 255
        combined[10, 13:20] = 255

        image = np.full((20, 30, 3), 255, dtype=np.uint8)
        image[10, 3:20] = (40, 120, 230)
        image[3, 23:28] = (40, 120, 230)

        repaired = self.engine._restore_line_art_run_mask(combined, image)

        self.assertTrue(np.all(repaired[10, 10:13] > 0))
        self.assertEqual(0, int(np.count_nonzero(repaired[3, 23:28])))

    def test_chaikin_smoothing_preserves_open_endpoints(self):
        points = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0)]
        smoothed = self.engine._chaikin_smooth(points, closed=False, iterations=2)
        self.assertEqual(points[0], smoothed[0])
        self.assertEqual(points[-1], smoothed[-1])
        self.assertGreater(len(smoothed), len(points))

    def test_chaikin_smoothing_keeps_closed_path_explicitly_closed(self):
        points = [(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0), (0.0, 0.0)]
        smoothed = self.engine._chaikin_smooth(points, closed=True, iterations=2)
        self.assertEqual(smoothed[0], smoothed[-1])
        self.assertGreater(len(smoothed), len(points))

    def test_close_antiparallel_paths_join_at_a_petal_cusp(self):
        left = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)]
        right = [(2.1, 0.0), (1.1, 0.1), (0.1, 0.2)]
        joined = self.engine._best_path_join(left, right, max_gap=1.0)
        self.assertIsNotNone(joined)

    def test_close_perpendicular_paths_do_not_join_at_a_junction(self):
        horizontal = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)]
        vertical = [(2.1, 0.0), (2.1, 1.0), (2.1, 2.0)]
        joined = self.engine._best_path_join(horizontal, vertical, max_gap=1.0)
        self.assertIsNone(joined)

    def test_chaikin_smoothing_preserves_acute_cusp(self):
        cusp = (3.0, 0.0)
        points = [(0.0, 0.0), cusp, (0.4, 0.3), (0.0, 2.0)]
        smoothed = self.engine._chaikin_smooth(points, closed=False, iterations=2)
        self.assertIn(cusp, smoothed)

    def test_skeleton_neighbors_do_not_create_diagonal_corner_shortcut(self):
        points = {(0, 0), (1, 0), (1, 1)}
        neighbors = self.engine._skeleton_neighbors((0, 0), points)
        self.assertEqual([(1, 0)], neighbors)

    def test_skeleton_neighbors_keep_true_diagonal_connection(self):
        points = {(0, 0), (1, 1)}
        neighbors = self.engine._skeleton_neighbors((0, 0), points)
        self.assertEqual([(1, 1)], neighbors)

    def test_extracts_explicit_closed_loop_from_ring_mask(self):
        import cv2

        mask = np.zeros((40, 40), dtype=np.uint8)
        cv2.circle(mask, (20, 20), 12, 255, thickness=3)
        loops, exclusion = self.engine._extract_closed_run_loops(mask)
        self.assertEqual(1, len(loops))
        self.assertEqual(loops[0][0], loops[0][-1])
        self.assertGreater(int(np.count_nonzero(exclusion)), 0)

    def test_does_not_extract_loop_from_solid_run_blob(self):
        mask = np.zeros((40, 40), dtype=np.uint8)
        mask[10:30, 10:30] = 255
        loops, _ = self.engine._extract_closed_run_loops(mask)
        self.assertEqual([], loops)

    def test_simplify_run_path_removes_small_jitter_and_keeps_cusp(self):
        cusp = (4.0, 0.0)
        points = [
            (0.0, 0.0),
            (1.0, 0.08),
            (2.0, -0.06),
            (3.0, 0.05),
            cusp,
            (2.5, 0.3),
            (1.0, 1.0),
        ]
        simplified = self.engine._simplify_run_path(points, closed=False)
        self.assertLess(len(simplified), len(points))
        self.assertIn(cusp, simplified)

    def test_restores_compact_source_loop_with_gap_wider_than_local_support(self):
        import cv2

        image = np.full((60, 60, 3), 255, dtype=np.uint8)
        source_mask = np.zeros((60, 60), dtype=np.uint8)
        cv2.circle(source_mask, (30, 30), 16, 255, thickness=2)
        image[source_mask > 0] = (40, 120, 230)

        combined = source_mask.copy()
        combined[12:20, 25:36] = 0

        repaired = self.engine._restore_line_art_run_mask(combined, image)
        _, hierarchy = cv2.findContours(repaired, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

        self.assertIsNotNone(hierarchy)
        self.assertTrue(any(item[3] >= 0 for item in hierarchy[0]))

    def test_run_resampling_forces_stitch_at_acute_cusp(self):
        cusp = (5.0, 0.0)
        points = [(0.0, 0.0), cusp, (0.4, 0.4), (0.0, 5.0)]
        resampled = self.engine._resample_run_path(points, stitch_len=3.0, closed=False)
        self.assertIn(cusp, resampled)


if __name__ == "__main__":
    unittest.main()
