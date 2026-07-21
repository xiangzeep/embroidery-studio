"""High-fidelity image recognition before physical thread substitution."""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from skimage.color import deltaE_ciede2000, lab2rgb, rgb2lab
from sklearn.cluster import KMeans, MiniBatchKMeans


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

    _AUTO_BUDGETS = (24, 32, 48, 64, 96, 128)

    @classmethod
    def recognize(cls, image, physical_threads, settings) -> RecognitionResult:
        rgb = np.asarray(image)
        if rgb.ndim != 3 or rgb.shape[2] < 3 or rgb.size == 0:
            raise ValueError("Recognition requires a non-empty RGB image")
        rgb = np.ascontiguousarray(rgb[:, :, :3], dtype=np.uint8)
        height, width = rgb.shape[:2]
        pixels_rgb = rgb.reshape(-1, 3)
        pixels_lab = rgb2lab(rgb.astype(np.float64) / 255.0).reshape(-1, 3)

        budget = cls._design_color_budget(rgb, settings)
        packed = (
            (pixels_rgb[:, 0].astype(np.uint32) << 16)
            | (pixels_rgb[:, 1].astype(np.uint32) << 8)
            | pixels_rgb[:, 2].astype(np.uint32)
        )
        cluster_count = max(1, min(budget, int(np.unique(packed).size)))
        weights = cls._sampling_weights(rgb)
        if pixels_lab.shape[0] > 250_000:
            clusterer = MiniBatchKMeans(
                n_clusters=cluster_count,
                n_init=3,
                random_state=42,
                max_iter=80,
                batch_size=8192,
            )
        else:
            clusterer = KMeans(
                n_clusters=cluster_count,
                n_init=5,
                random_state=42,
                max_iter=100,
            )
        clusterer.fit(pixels_lab, sample_weight=weights.reshape(-1))
        labels = cls._nearest_design_indices(pixels_lab, clusterer.cluster_centers_)

        centers_rgb = np.clip(
            lab2rgb(clusterer.cluster_centers_.reshape(1, -1, 3))[0] * 255.0,
            0,
            255,
        ).round().astype(np.uint8)
        for design_id in range(cluster_count):
            members = pixels_rgb[labels == design_id]
            if members.size:
                centers_rgb[design_id] = np.median(members, axis=0).round().astype(np.uint8)

        center_labs = rgb2lab(
            centers_rgb.reshape(1, -1, 3).astype(np.float64) / 255.0
        )[0]
        labels = cls._nearest_design_indices(pixels_lab, center_labs)
        order = sorted(
            range(cluster_count),
            key=lambda idx: tuple(int(channel) for channel in centers_rgb[idx]),
        )
        remap = np.empty(cluster_count, dtype=np.int32)
        for new_id, old_id in enumerate(order):
            remap[old_id] = new_id
        labels = remap[labels]
        centers_rgb = centers_rgb[order]
        design_map = labels.reshape(height, width).astype(np.int32)
        reconstructed = centers_rgb[design_map]

        palette_lab = cls._physical_palette_lab(physical_threads)
        design_colors = []
        for design_id, color in enumerate(centers_rgb):
            nearest_idx, nearest_delta = cls._nearest_thread(color, palette_lab)
            design_colors.append(DesignColor(
                design_id=design_id,
                color_rgb=tuple(int(channel) for channel in color),
                pixel_count=int(np.count_nonzero(design_map == design_id)),
                nearest_thread_index=nearest_idx,
                nearest_thread_delta_e=nearest_delta,
            ))

        detail_mask = (
            cls._initial_detail_mask(rgb)
            if settings.preserve_details
            else np.zeros((height, width), dtype=bool)
        )
        metrics = cls.measure_fidelity(rgb, reconstructed)
        return RecognitionResult(
            design_map=design_map,
            design_colors=design_colors,
            reconstructed_rgb=reconstructed,
            detail_mask=detail_mask,
            metrics=metrics,
        )

    @classmethod
    def _design_color_budget(cls, image: np.ndarray, settings) -> int:
        explicit = int(getattr(settings, "design_color_budget", 0))
        if explicit > 0:
            return int(np.clip(explicit, 2, 128))

        lab = rgb2lab(image.astype(np.float64) / 255.0)
        variance = float(np.mean(np.std(lab.reshape(-1, 3), axis=0)))
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edge_density = float(np.mean(cv2.Canny(gray, 50, 120) > 0))
        score = variance + edge_density * 180.0
        if score < 16:
            return 24
        if score < 22:
            return 32
        if score < 29:
            return 48
        if score < 36:
            return 64
        if score < 44:
            return 96
        return 128

    @staticmethod
    def _sampling_weights(image: np.ndarray) -> np.ndarray:
        rgb = image.astype(np.float32)
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edges = cv2.dilate(
            (cv2.Canny(gray, 40, 110) > 0).astype(np.uint8),
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        local = cv2.GaussianBlur(rgb, (0, 0), 1.2)
        contrast = np.linalg.norm(rgb - local, axis=2)

        coarse = image[:, :, :3].astype(np.uint16) // 16
        keys = (
            (coarse[:, :, 0] << 8)
            | (coarse[:, :, 1] << 4)
            | coarse[:, :, 2]
        )
        _, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
        rarity = 1.0 / np.sqrt(counts[inverse].reshape(keys.shape).astype(np.float64))
        rarity /= max(float(rarity.mean()), 1e-8)
        weights = 1.0 + edges.astype(np.float64) * 3.0
        weights += np.clip(contrast / 18.0, 0.0, 4.0)
        weights += np.clip(rarity, 0.0, 5.0)
        return weights

    @staticmethod
    def _nearest_design_indices(pixels_lab: np.ndarray, centers_lab: np.ndarray) -> np.ndarray:
        result = np.empty(pixels_lab.shape[0], dtype=np.int32)
        chunk_size = 8192
        for start in range(0, pixels_lab.shape[0], chunk_size):
            chunk = pixels_lab[start:start + chunk_size]
            distances = deltaE_ciede2000(
                chunk.reshape(-1, 1, 3),
                centers_lab.reshape(1, -1, 3),
            )
            result[start:start + chunk.shape[0]] = np.argmin(distances, axis=1)
        return result

    @staticmethod
    def _physical_palette_lab(physical_threads) -> np.ndarray:
        if not physical_threads:
            return np.empty((0, 3), dtype=np.float64)
        colors = np.array([thread.color_rgb for thread in physical_threads], dtype=np.float64)
        return rgb2lab(colors.reshape(1, -1, 3) / 255.0)[0]

    @staticmethod
    def _nearest_thread(color: np.ndarray, palette_lab: np.ndarray):
        if palette_lab.size == 0:
            return None, None
        color_lab = rgb2lab(
            color.reshape(1, 1, 3).astype(np.float64) / 255.0
        )[0, 0]
        distances = deltaE_ciede2000(
            color_lab.reshape(1, 1, 3),
            palette_lab.reshape(1, -1, 3),
        )[0]
        index = int(np.argmin(distances))
        return index, float(distances[index])

    @staticmethod
    def _initial_detail_mask(image: np.ndarray) -> np.ndarray:
        rgb = image.astype(np.float32)
        local = cv2.GaussianBlur(rgb, (0, 0), 1.0)
        contrast = np.linalg.norm(rgb - local, axis=2)
        return contrast >= 28.0

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
