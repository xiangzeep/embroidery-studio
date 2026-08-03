"""Canonical raster rendering and statistics for embroidery patterns."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class PatternStatistics:
    stitch_commands: int
    jump_commands: int
    trim_commands: int
    color_changes: int
    sewn_bounds: Optional[Tuple[float, float, float, float]]
    thread_colors: Tuple[Tuple[int, int, int], ...]


class PatternRenderer:
    """Render only sewn segments from an EmbPattern-compatible object."""

    STITCH = 0
    JUMP = 1
    TRIM = 2
    END = 4
    COLOR_CHANGE = 5
    COMMAND_MASK = 0xFF

    @classmethod
    def render(
        cls,
        pattern,
        size: Sequence[int] = (720, 960),
        padding: int = 12,
        thread_width_mm: float = 0.30,
        background_rgb: Tuple[int, int, int] = (255, 255, 255),
        design_bounds: Optional[Tuple[float, float, float, float]] = None,
    ) -> np.ndarray:
        """Render an absolute-coordinate pattern into a deterministic RGB image."""
        height, width = cls._normalize_size(size)
        padding = int(np.clip(padding, 0, max(0, min(height, width) // 3)))
        canvas = np.full((height, width, 3), background_rgb, dtype=np.uint8)
        stats = cls.statistics(pattern)
        if stats.sewn_bounds is None:
            return canvas

        explicit_bounds = design_bounds is not None
        x0, y0, x1, y1 = (
            stats.sewn_bounds
            if not explicit_bounds
            else tuple(float(value) for value in design_bounds)
        )
        if explicit_bounds and (x1 <= x0 or y1 <= y0):
            raise ValueError("Pattern design bounds must have positive area")
        available_width = max(1.0, float(width - padding * 2))
        available_height = max(1.0, float(height - padding * 2))
        design_width = max(1e-6, x1 - x0)
        design_height = max(1e-6, y1 - y0)
        scale = min(
            available_width / design_width,
            available_height / design_height,
        )
        rendered_width = design_width * scale
        rendered_height = design_height * scale
        offset_x = (width - rendered_width) * 0.5 - x0 * scale
        offset_y = (height - rendered_height) * 0.5 - y0 * scale

        thread_width_units = max(0.1, float(thread_width_mm)) * 10.0
        line_width = max(1, int(round(thread_width_units * scale)))
        colors = stats.thread_colors or ((0, 0, 0),)
        thread_index = 0
        previous = None
        can_connect = False
        for x, y, raw_command in getattr(pattern, "stitches", ()):
            command = int(raw_command) & cls.COMMAND_MASK
            point = (float(x), float(y))
            if command == cls.COLOR_CHANGE:
                thread_index = min(thread_index + 1, len(colors) - 1)
                can_connect = False
            elif command == cls.TRIM:
                can_connect = False
            elif command == cls.JUMP:
                can_connect = True
            elif command == cls.STITCH:
                if previous is not None and can_connect:
                    start = cls._map_point(previous, scale, offset_x, offset_y)
                    end = cls._map_point(point, scale, offset_x, offset_y)
                    cv2.line(
                        canvas,
                        start,
                        end,
                        colors[thread_index],
                        line_width,
                        lineType=cv2.LINE_AA,
                    )
                can_connect = True
            previous = point
            if command == cls.END:
                break
        return canvas

    @classmethod
    def statistics(cls, pattern) -> PatternStatistics:
        stitch_count = 0
        jump_count = 0
        trim_count = 0
        color_changes = 0
        sewn_points = []
        previous = None
        can_connect = False
        for x, y, raw_command in getattr(pattern, "stitches", ()):
            command = int(raw_command) & cls.COMMAND_MASK
            point = (float(x), float(y))
            if command == cls.STITCH:
                stitch_count += 1
                if previous is not None and can_connect:
                    sewn_points.append(previous)
                sewn_points.append(point)
                can_connect = True
            elif command == cls.JUMP:
                jump_count += 1
                can_connect = True
            elif command == cls.TRIM:
                trim_count += 1
                can_connect = False
            elif command == cls.COLOR_CHANGE:
                color_changes += 1
                can_connect = False
            previous = point
            if command == cls.END:
                break

        bounds = None
        if sewn_points:
            points = np.asarray(sewn_points, dtype=np.float64)
            bounds = (
                float(np.min(points[:, 0])),
                float(np.min(points[:, 1])),
                float(np.max(points[:, 0])),
                float(np.max(points[:, 1])),
            )
        colors = tuple(
            cls._thread_rgb(thread)
            for thread in getattr(pattern, "threadlist", ())
        )
        return PatternStatistics(
            stitch_commands=stitch_count,
            jump_commands=jump_count,
            trim_commands=trim_count,
            color_changes=color_changes,
            sewn_bounds=bounds,
            thread_colors=colors,
        )

    @staticmethod
    def _normalize_size(size: Sequence[int]) -> Tuple[int, int]:
        if len(size) != 2:
            raise ValueError("Pattern render size must be (height, width)")
        height, width = int(size[0]), int(size[1])
        if height <= 0 or width <= 0:
            raise ValueError("Pattern render dimensions must be positive")
        return height, width

    @staticmethod
    def _map_point(point, scale, offset_x, offset_y):
        return (
            int(round(float(point[0]) * scale + offset_x)),
            int(round(float(point[1]) * scale + offset_y)),
        )

    @staticmethod
    def _thread_rgb(thread) -> Tuple[int, int, int]:
        color = getattr(thread, "color", 0)
        try:
            packed = int(color)
        except (TypeError, ValueError):
            packed = 0
        return (
            int((packed >> 16) & 0xFF),
            int((packed >> 8) & 0xFF),
            int(packed & 0xFF),
        )
