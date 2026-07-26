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


def choose_boundary_half_method(cell_mask: np.ndarray) -> str:
    """Return the half-stitch diagonal nearest to the mask boundary.

    ``half`` follows the top-left to bottom-right diagonal and
    ``half_flipped`` follows the opposing diagonal.  Only binary occupancy is
    considered, so the result is independent of color or canvas position.
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
    return "half" if normal_score <= flipped_score else "half_flipped"


def classify_cross_stitch_cell(
    cell_mask: np.ndarray,
    coverage_threshold: float,
    full_threshold: float = 0.82,
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
    return choose_boundary_half_method(binary)
