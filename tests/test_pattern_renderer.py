import unittest
from types import SimpleNamespace

import numpy as np

from stitch_studio.core.pattern_renderer import PatternRenderer


STITCH = 0
JUMP = 1
TRIM = 2
END = 4
COLOR_CHANGE = 5


def make_thread(rgb):
    r, g, b = rgb
    return SimpleNamespace(color=(r << 16) | (g << 8) | b)


def make_pattern(stitches, colors=((220, 20, 20),)):
    return SimpleNamespace(
        stitches=[tuple(item) for item in stitches],
        threadlist=[make_thread(color) for color in colors],
    )


class PatternRendererTests(unittest.TestCase):
    def test_jump_moves_without_drawing_travel_line(self):
        pattern = make_pattern([
            (0.0, 0.0, JUMP),
            (20.0, 0.0, STITCH),
            (80.0, 0.0, JUMP),
            (100.0, 0.0, STITCH),
            (100.0, 0.0, END),
        ])

        rendered = PatternRenderer.render(
            pattern,
            size=(80, 240),
            padding=12,
            thread_width_mm=0.4,
        )

        red = (rendered[:, :, 0] > 150) & (rendered[:, :, 1] < 100)
        columns = np.flatnonzero(np.any(red, axis=0))
        self.assertGreater(len(columns), 0)
        middle = (columns.min() + columns.max()) // 2
        self.assertFalse(np.any(red[:, middle - 8:middle + 9]))

    def test_color_change_uses_next_thread(self):
        pattern = make_pattern(
            [
                (0.0, 0.0, JUMP),
                (40.0, 0.0, STITCH),
                (40.0, 0.0, COLOR_CHANGE),
                (0.0, 20.0, JUMP),
                (40.0, 20.0, STITCH),
                (40.0, 20.0, END),
            ],
            colors=((220, 20, 20), (20, 40, 220)),
        )

        rendered = PatternRenderer.render(pattern, size=(100, 220), padding=12)

        red_pixels = (
            (rendered[:, :, 0] > 150)
            & (rendered[:, :, 1] < 100)
            & (rendered[:, :, 2] < 100)
        )
        blue_pixels = (
            (rendered[:, :, 2] > 150)
            & (rendered[:, :, 0] < 100)
            & (rendered[:, :, 1] < 120)
        )
        self.assertGreater(np.count_nonzero(red_pixels), 0)
        self.assertGreater(np.count_nonzero(blue_pixels), 0)

    def test_render_is_deterministic_and_statistics_ignore_travel(self):
        pattern = make_pattern([
            (0.0, 0.0, JUMP),
            (20.0, 0.0, STITCH),
            (70.0, 30.0, JUMP),
            (90.0, 30.0, STITCH),
            (90.0, 30.0, TRIM),
            (90.0, 30.0, END),
        ])

        first = PatternRenderer.render(pattern, size=(96, 192))
        second = PatternRenderer.render(pattern, size=(96, 192))
        stats = PatternRenderer.statistics(pattern)

        np.testing.assert_array_equal(first, second)
        self.assertEqual(stats.stitch_commands, 2)
        self.assertEqual(stats.jump_commands, 2)
        self.assertEqual(stats.trim_commands, 1)
        self.assertEqual(stats.sewn_bounds, (0.0, 0.0, 90.0, 30.0))

    def test_explicit_design_bounds_preserve_source_canvas_position(self):
        pattern = make_pattern([
            (50.0, 50.0, JUMP),
            (50.0, 50.0, STITCH),
            (100.0, 50.0, STITCH),
            (100.0, 50.0, END),
        ])

        rendered = PatternRenderer.render(
            pattern,
            size=(200, 200),
            padding=0,
            design_bounds=(0, 0, 200, 200),
        )
        ink = np.any(rendered != 255, axis=2)
        ys, xs = np.nonzero(ink)

        self.assertLess(float(np.mean(xs)), 100.0)
        self.assertLess(float(np.mean(ys)), 100.0)


if __name__ == "__main__":
    unittest.main()
