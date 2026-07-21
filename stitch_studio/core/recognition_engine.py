"""High-fidelity image recognition before physical thread substitution."""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from skimage.color import deltaE_ciede2000, rgb2lab


@dataclass(frozen=True)
class DesignColor:
    design_id: int
    color_rgb: Tuple[int, int, int]
    pixel_count: int
    nearest_thread_index: Optional[int] = None
    nearest_thread_delta_e: Optional[float] = None


@dataclass(frozen=True)
class RecognitionMetrics:
    perceptual_similarity: float
    pixel_coverage: float
    boundary_recall: float
    detail_recall: float


@dataclass
class RecognitionResult:
    design_map: np.ndarray
    design_colors: List[DesignColor]
    reconstructed_rgb: np.ndarray
    detail_mask: np.ndarray
    metrics: RecognitionMetrics


class RecognitionEngine:
    """Extract design colors without collapsing them into the thread library."""

    @staticmethod
    def measure_fidelity(
        source: np.ndarray,
        reconstructed: np.ndarray,
        assigned_mask: Optional[np.ndarray] = None,
        source_detail_mask: Optional[np.ndarray] = None,
        recognized_detail_mask: Optional[np.ndarray] = None,
    ) -> RecognitionMetrics:
        if source.shape != reconstructed.shape or source.ndim != 3:
            raise ValueError("Source and reconstructed images must have matching RGB shapes")

        shape = source.shape[:2]
        if assigned_mask is None:
            assigned = np.ones(shape, dtype=bool)
        else:
            assigned = np.asarray(assigned_mask, dtype=bool)
            if assigned.shape != shape:
                raise ValueError("Assigned mask must match image dimensions")

        pixel_coverage = float(np.mean(assigned)) if assigned.size else 1.0
        if np.any(assigned):
            source_lab = rgb2lab(source.astype(np.float64) / 255.0)
            reconstructed_lab = rgb2lab(reconstructed.astype(np.float64) / 255.0)
            delta_e = deltaE_ciede2000(source_lab, reconstructed_lab)
            perceptual_similarity = float(np.mean(np.exp(-delta_e[assigned] / 20.0)))
        else:
            perceptual_similarity = 0.0

        boundary_recall = RecognitionEngine._boundary_recall(
            source,
            reconstructed,
        )
        detail_recall = RecognitionEngine._detail_recall(
            source_detail_mask,
            recognized_detail_mask,
            shape,
        )
        return RecognitionMetrics(
            perceptual_similarity=perceptual_similarity,
            pixel_coverage=pixel_coverage,
            boundary_recall=boundary_recall,
            detail_recall=detail_recall,
        )

    @staticmethod
    def _boundary_recall(source: np.ndarray, reconstructed: np.ndarray) -> float:
        source_gray = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2GRAY)
        reconstructed_gray = cv2.cvtColor(
            reconstructed[:, :, :3],
            cv2.COLOR_RGB2GRAY,
        )
        source_edges = cv2.Canny(source_gray, 50, 120) > 0
        if not np.any(source_edges):
            return 1.0
        reconstructed_edges = cv2.Canny(reconstructed_gray, 50, 120)
        nearby_edges = cv2.dilate(
            reconstructed_edges,
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        ) > 0
        return float(np.count_nonzero(source_edges & nearby_edges) / np.count_nonzero(source_edges))

    @staticmethod
    def _detail_recall(
        source_detail_mask: Optional[np.ndarray],
        recognized_detail_mask: Optional[np.ndarray],
        shape: Tuple[int, int],
    ) -> float:
        if source_detail_mask is None:
            return 1.0
        source_detail = np.asarray(source_detail_mask, dtype=bool)
        if source_detail.shape != shape:
            raise ValueError("Source detail mask must match image dimensions")
        if not np.any(source_detail):
            return 1.0
        if recognized_detail_mask is None:
            return 0.0
        recognized = np.asarray(recognized_detail_mask, dtype=bool)
        if recognized.shape != shape:
            raise ValueError("Recognized detail mask must match image dimensions")
        nearby = cv2.dilate(
            recognized.astype(np.uint8),
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        return float(np.count_nonzero(source_detail & nearby) / np.count_nonzero(source_detail))
