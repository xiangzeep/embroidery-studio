import unittest

import numpy as np

from stitch_studio.core.cross_stitch_geometry import (
    CrossStitchCell,
    choose_boundary_half_method,
    classify_cross_stitch_cell,
)


class CrossStitchBoundaryGeometryTests(unittest.TestCase):
    def test_cross_stitch_cell_is_an_immutable_geometry_specification(self):
        cell = CrossStitchCell((1.0, 2.0, 3.0, 4.0), 0.5, "half")

        self.assertEqual(cell.bounds, (1.0, 2.0, 3.0, 4.0))
        self.assertEqual(cell.coverage, 0.5)
        self.assertEqual(cell.method_override, "half")
        with self.assertRaises(AttributeError):
            cell.coverage = 0.75

    def test_descending_boundary_selects_normal_half(self):
        mask = np.tri(12, 12, k=0, dtype=np.uint8) * 255

        self.assertEqual(choose_boundary_half_method(mask), "half")

    def test_ascending_boundary_selects_flipped_half(self):
        mask = np.fliplr(np.tri(12, 12, k=0, dtype=np.uint8)) * 255

        self.assertEqual(choose_boundary_half_method(mask), "half_flipped")

    def test_ninety_degree_rotation_flips_half_direction(self):
        descending = np.tri(12, 12, k=0, dtype=np.uint8) * 255

        self.assertEqual(
            choose_boundary_half_method(np.rot90(descending)),
            "half_flipped",
        )

    def test_horizontal_mirror_of_rotated_boundary_flips_direction_again(self):
        descending = np.tri(12, 12, k=0, dtype=np.uint8) * 255
        rotated = np.rot90(descending)
        mirrored = np.fliplr(rotated)

        self.assertEqual(choose_boundary_half_method(mirrored), "half")

    def test_full_cell_keeps_configured_full_method(self):
        mask = np.full((12, 12), 255, dtype=np.uint8)

        self.assertIsNone(classify_cross_stitch_cell(mask, 0.5))

    def test_below_threshold_cell_is_rejected(self):
        mask = np.zeros((12, 12), dtype=np.uint8)
        mask[0, 0] = 255

        self.assertEqual(classify_cross_stitch_cell(mask, 0.5), "reject")

    def test_empty_cell_is_rejected_without_assigning_a_half_direction(self):
        mask = np.zeros((12, 12), dtype=np.uint8)

        self.assertEqual(classify_cross_stitch_cell(mask, 0.0), "reject")


if __name__ == "__main__":
    unittest.main()
