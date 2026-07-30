"""Mask-only geometry helpers for directional cross-stitch boundary cells."""

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class CrossStitchCell:
    """One grid cell and an optional boundary-specific stitch method."""

    bounds: Tuple[float, float, float, float]
    coverage: float
    method_override: Optional[str] = None


def choose_boundary_half_method(
    cell_mask: np.ndarray,
    *,
    grid_row: Optional[int] = None,
    grid_col: Optional[int] = None,
) -> str:
    """Return the half-stitch diagonal nearest to the mask boundary.

    ``half`` follows the top-left to bottom-right diagonal and
    ``half_flipped`` follows the opposing diagonal. Only binary occupancy is
    considered, so the scored result is independent of color or canvas
    position. Equal scores require both grid coordinates; their checkerboard
    parity prevents a systematic preference for one half-stitch direction.
    """

    binary = np.asarray(cell_mask, dtype=np.uint8) > 0
    if binary.ndim != 2:
        raise ValueError("cell_mask must be a two-dimensional array")
    if binary.size == 0:
        raise ValueError("cell_mask must not be empty")

    boundary = cv2.morphologyEx(
        binary.astype(np.uint8),
        cv2.MORPH_GRADIENT,
        np.ones((3, 3), dtype=np.uint8),
    )
    distance = cv2.distanceTransform(
        (boundary == 0).astype(np.uint8),
        cv2.DIST_L2,
        3,
    )
    height, width = binary.shape
    sample_count = max(height, width)
    normal = np.rint(
        np.linspace([0, 0], [height - 1, width - 1], sample_count)
    ).astype(int)
    flipped = np.rint(
        np.linspace([0, width - 1], [height - 1, 0], sample_count)
    ).astype(int)
    normal_score = float(np.mean(distance[normal[:, 0], normal[:, 1]]))
    flipped_score = float(np.mean(distance[flipped[:, 0], flipped[:, 1]]))
    if not np.isclose(normal_score, flipped_score, rtol=0.0, atol=1e-9):
        return "half" if normal_score < flipped_score else "half_flipped"
    if grid_row is None or grid_col is None:
        raise ValueError("tied boundary scores require grid_row and grid_col")
    return "half" if (grid_row + grid_col) % 2 == 0 else "half_flipped"


def choose_boundary_three_quarter_method(
    cell_mask: np.ndarray,
    half_method: str,
) -> str:
    """Add the missing leg from the most occupied interior corner."""

    binary = np.asarray(cell_mask, dtype=np.uint8) > 0
    if binary.ndim != 2:
        raise ValueError("cell_mask must be a two-dimensional array")
    if binary.size == 0:
        raise ValueError("cell_mask must not be empty")
    if half_method not in ("half", "half_flipped"):
        raise ValueError("half_method must be half or half_flipped")

    height, width = binary.shape
    mid_y = max(1, (height + 1) // 2)
    mid_x = max(1, (width + 1) // 2)
    corner_patches = {
        "tl": binary[:mid_y, :mid_x],
        "tr": binary[:mid_y, width // 2:],
        "br": binary[height // 2:, width // 2:],
        "bl": binary[height // 2:, :mid_x],
    }
    candidates = ("tr", "bl") if half_method == "half" else ("tl", "br")
    corner = max(
        candidates,
        key=lambda name: (
            float(np.mean(corner_patches[name])),
            int(np.count_nonzero(corner_patches[name])),
            -candidates.index(name),
        ),
    )
    return f"three_quarter_{corner}"


def classify_cross_stitch_cell(
    cell_mask: np.ndarray,
    coverage_threshold: float,
    full_threshold: float = 0.82,
    *,
    grid_row: Optional[int] = None,
    grid_col: Optional[int] = None,
) -> Optional[str]:
    """Classify a cell as rejected, full, or one directional half stitch."""

    binary = np.asarray(cell_mask) > 0
    if binary.ndim != 2:
        raise ValueError("cell_mask must be a two-dimensional array")
    if binary.size == 0 or not np.any(binary):
        return "reject"

    coverage = float(np.count_nonzero(binary)) / float(binary.size)
    if coverage + 1e-9 < coverage_threshold:
        return "reject"
    if coverage >= full_threshold:
        return None
    return choose_boundary_half_method(
        binary,
        grid_row=grid_row,
        grid_col=grid_col,
    )
