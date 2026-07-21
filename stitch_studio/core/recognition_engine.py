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
    detail_design_ids: Tuple[int, ...]
    metrics: RecognitionMetrics


class RecognitionEngine:
    """Extract design colors without collapsing them into the thread library."""

    _AUTO_BUDGETS = (24, 32, 48, 64, 96, 128)
    _EDGE_SAMPLE_WEIGHT = 4.0

    @classmethod
    def recognize(cls, image, physical_threads, settings) -> RecognitionResult:
        rgb = np.asarray(image)
        if rgb.ndim != 3 or rgb.shape[2] < 3 or rgb.size == 0:
            raise ValueError("Recognition requires a non-empty RGB image")
        rgb = np.ascontiguousarray(rgb[:, :, :3], dtype=np.uint8)
        height, width = rgb.shape[:2]
        pixels_rgb = rgb.reshape(-1, 3)
        pixels_lab = rgb2lab(rgb.astype(np.float64) / 255.0).reshape(-1, 3)

        sensitivity = float(getattr(settings, "detail_sensitivity", 0.65))
        detail_mask = (
            cls.detect_fine_details(rgb, sensitivity=sensitivity)
            if settings.preserve_details
            else np.zeros((height, width), dtype=bool)
        )
        flat_detail = detail_mask.reshape(-1)
        budget = cls._design_color_budget(rgb, settings)
        packed = (
            (pixels_rgb[:, 0].astype(np.uint32) << 16)
            | (pixels_rgb[:, 1].astype(np.uint32) << 8)
            | pixels_rgb[:, 2].astype(np.uint32)
        )
        weights = cls._sampling_weights(rgb)
        detail_count = 0
        if budget >= 8 and np.any(flat_detail) and np.any(~flat_detail):
            detail_unique = int(np.unique(packed[flat_detail]).size)
            detail_count = min(max(4, budget // 4), detail_unique, budget - 2)
        base_count = max(1, budget - detail_count)
        base_unique_source = packed[~flat_detail] if detail_count > 0 else packed
        base_unique = int(np.unique(base_unique_source).size)
        base_count = min(base_count, max(1, base_unique))

        base_selector = (
            ~flat_detail
            if detail_count > 0 and np.any(~flat_detail)
            else np.ones(flat_detail.shape, dtype=bool)
        )
        base_centers = cls._fit_design_centers(
            pixels_lab[base_selector],
            pixels_rgb[base_selector],
            weights.reshape(-1)[base_selector],
            base_count,
        )
        centers = [base_centers]
        labels = cls._nearest_design_indices(
            pixels_lab,
            rgb2lab(base_centers.reshape(1, -1, 3).astype(np.float64) / 255.0)[0],
        )
        if detail_count > 0:
            detail_centers = cls._fit_design_centers(
                pixels_lab[flat_detail],
                pixels_rgb[flat_detail],
                weights.reshape(-1)[flat_detail],
                detail_count,
            )
            detail_labs = rgb2lab(
                detail_centers.reshape(1, -1, 3).astype(np.float64) / 255.0
            )[0]
            labels[flat_detail] = (
                cls._nearest_design_indices(pixels_lab[flat_detail], detail_labs)
                + base_centers.shape[0]
            )
            centers.append(detail_centers)

        centers_rgb = np.concatenate(centers, axis=0)
        cluster_count = centers_rgb.shape[0]
        order = sorted(
            range(cluster_count),
            key=lambda idx: tuple(int(channel) for channel in centers_rgb[idx]),
        )
        remap = np.empty(cluster_count, dtype=np.int32)
        for new_id, old_id in enumerate(order):
            remap[old_id] = new_id
        detail_design_ids = (
            tuple(sorted(int(remap[index]) for index in range(base_centers.shape[0], cluster_count)))
            if detail_count > 0 else ()
        )
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

        metrics = cls.measure_fidelity(
            rgb,
            reconstructed,
            source_detail_mask=detail_mask,
            recognized_detail_mask=detail_mask,
        )
        return RecognitionResult(
            design_map=design_map,
            design_colors=design_colors,
            reconstructed_rgb=reconstructed,
            detail_mask=detail_mask,
            detail_design_ids=detail_design_ids,
            metrics=metrics,
        )

    @classmethod
    def _fit_design_centers(
        cls,
        pixels_lab: np.ndarray,
        pixels_rgb: np.ndarray,
        weights: np.ndarray,
        cluster_count: int,
    ) -> np.ndarray:
        cluster_count = max(1, min(cluster_count, pixels_lab.shape[0]))
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
        clusterer.fit(pixels_lab, sample_weight=weights)
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
        return centers_rgb

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
        if score < 37:
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
        weights = 1.0 + edges.astype(np.float64) * RecognitionEngine._EDGE_SAMPLE_WEIGHT
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
    def detect_fine_details(
        image: np.ndarray,
        sensitivity: float = 0.65,
    ) -> np.ndarray:
        """Detect open fine marks without promoting closed object boundaries."""
        if image.ndim != 3 or image.shape[2] < 3:
            return np.zeros(image.shape[:2], dtype=bool)

        sensitivity = float(np.clip(sensitivity, 0.0, 1.0))
        rgb = image.astype(np.float32)
        contrast = np.zeros(image.shape[:2], dtype=np.float32)
        for sigma in (0.8, 1.6, 2.8):
            local = cv2.GaussianBlur(rgb, (0, 0), sigma)
            contrast = np.maximum(contrast, np.linalg.norm(rgb - local, axis=2))

        gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_RGB2GRAY)
        ridge = np.zeros(gray.shape, dtype=np.uint8)
        for size in (3, 5, 7):
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
            ridge = np.maximum(ridge, cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel))
            ridge = np.maximum(ridge, cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel))

        threshold = 36.0 - sensitivity * 22.0
        candidate = (contrast >= threshold) | (ridge >= max(8, int(threshold * 0.55)))
        candidate |= cv2.Canny(
            gray,
            max(18, int(70 - sensitivity * 40)),
            max(55, int(150 - sensitivity * 55)),
        ) > 0

        n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            candidate.astype(np.uint8),
            connectivity=8,
        )
        detail = np.zeros(candidate.shape, dtype=bool)
        image_area = candidate.size
        for label in range(1, n_labels):
            component = labels == label
            area = int(stats[label, cv2.CC_STAT_AREA])
            width = int(stats[label, cv2.CC_STAT_WIDTH])
            height = int(stats[label, cv2.CC_STAT_HEIGHT])
            if area < 3:
                continue

            short_axis = min(width, height)
            long_axis = max(width, height)
            aspect = long_axis / max(1, short_axis)
            occupancy = area / max(1, width * height)
            distance = cv2.distanceTransform(
                component.astype(np.uint8),
                cv2.DIST_L2,
                5,
            )
            median_width = float(np.median(distance[component]) * 2.0)
            contours, _ = cv2.findContours(
                component.astype(np.uint8),
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )
            enclosed_area = max(
                (float(cv2.contourArea(contour)) for contour in contours),
                default=0.0,
            )
            is_large_closed_boundary = (
                enclosed_area >= image_area * 0.02
                and enclosed_area >= area * 1.7
                and aspect < 3.0
            )
            is_fine_geometry = (
                short_axis <= 8
                or aspect >= 2.5
                or occupancy <= 0.38
                or median_width <= 6.0
            )
            if is_fine_geometry and not is_large_closed_boundary:
                detail[component] = True

        return detail

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
