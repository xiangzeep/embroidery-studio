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
    subject_mask: Optional[np.ndarray] = None
    thread_map: Optional[np.ndarray] = None
    thread_reconstructed_rgb: Optional[np.ndarray] = None
    thread_metrics: Optional[RecognitionMetrics] = None
    subject_metrics: Optional[RecognitionMetrics] = None
    feature_outline_mask: Optional[np.ndarray] = None
    feature_outline_groups: Tuple[np.ndarray, ...] = ()


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
        subject_mask = cls.detect_primary_subject(rgb)
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
        pixel_counts = np.bincount(
            design_map.reshape(-1),
            minlength=len(centers_rgb),
        )
        subject_pixel_counts = np.bincount(
            design_map[subject_mask].reshape(-1),
            minlength=len(centers_rgb),
        )
        thread_matches = cls._match_threads_with_budget(
            centers_rgb,
            pixel_counts,
            detail_design_ids,
            palette_lab,
            int(getattr(settings, "n_colors", len(physical_threads))),
            subject_pixel_counts=subject_pixel_counts,
        )
        design_colors = []
        for design_id, color in enumerate(centers_rgb):
            nearest_idx, nearest_delta = thread_matches[design_id]
            design_colors.append(DesignColor(
                design_id=design_id,
                color_rgb=tuple(int(channel) for channel in color),
                pixel_count=int(pixel_counts[design_id]),
                nearest_thread_index=nearest_idx,
                nearest_thread_delta_e=nearest_delta,
            ))

        metrics = cls.measure_fidelity(
            rgb,
            reconstructed,
            source_detail_mask=detail_mask,
            recognized_detail_mask=detail_mask,
        )
        matched_indices = np.asarray(
            [match[0] if match[0] is not None else -1 for match in thread_matches],
            dtype=np.int32,
        )
        palette_rgb = (
            np.asarray([thread.color_rgb for thread in physical_threads], dtype=np.uint8)
            if physical_threads
            else np.empty((0, 3), dtype=np.uint8)
        )
        thread_reconstructed = reconstructed.copy()
        if physical_threads:
            thread_map = cls._clean_thread_map(
                matched_indices[design_map],
                subject_mask,
                detail_mask,
                palette_rgb,
            )
            (
                thread_map,
                feature_outline_mask,
                feature_outline_groups,
            ) = cls._restore_subject_features(
                thread_map,
                rgb,
                subject_mask,
                palette_rgb,
            )
            assigned = thread_map >= 0
            thread_reconstructed[assigned] = palette_rgb[thread_map[assigned]]
        else:
            thread_map = None
            feature_outline_mask = np.zeros((height, width), dtype=bool)
            feature_outline_groups = ()
        thread_metrics = cls.measure_fidelity(
            rgb,
            thread_reconstructed,
            source_detail_mask=detail_mask,
            recognized_detail_mask=detail_mask,
        )
        subject_metrics = cls.measure_fidelity(
            rgb,
            thread_reconstructed,
            assigned_mask=subject_mask,
            source_detail_mask=detail_mask & subject_mask,
            recognized_detail_mask=detail_mask & subject_mask,
        )
        return RecognitionResult(
            design_map=design_map,
            design_colors=design_colors,
            reconstructed_rgb=reconstructed,
            detail_mask=detail_mask,
            detail_design_ids=detail_design_ids,
            metrics=metrics,
            subject_mask=subject_mask,
            thread_map=thread_map,
            thread_reconstructed_rgb=thread_reconstructed,
            thread_metrics=thread_metrics,
            subject_metrics=subject_metrics,
            feature_outline_mask=feature_outline_mask,
            feature_outline_groups=feature_outline_groups,
        )

    @staticmethod
    def _restore_subject_features(
        thread_map: np.ndarray,
        source_image: np.ndarray,
        subject_mask: np.ndarray,
        palette_rgb: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray, Tuple[np.ndarray, ...]]:
        """Restore cartoon facial outlines after physical thread reduction."""
        restored = np.asarray(thread_map, dtype=np.int32).copy()
        source = np.asarray(source_image, dtype=np.uint8)
        subject = np.asarray(subject_mask, dtype=bool)
        palette = np.asarray(palette_rgb, dtype=np.uint8)
        outlines = np.zeros(restored.shape, dtype=bool)
        outline_groups = []
        if (
            source.shape[:2] != restored.shape
            or subject.shape != restored.shape
            or palette.ndim != 2
            or palette.shape[1] < 3
        ):
            return restored, outlines, ()

        selected = np.unique(restored[restored >= 0])
        if not selected.size:
            return restored, outlines
        luminance = (
            palette[:, 0] * 0.299
            + palette[:, 1] * 0.587
            + palette[:, 2] * 0.114
        )
        chroma = palette[:, :3].max(axis=1) - palette[:, :3].min(axis=1)
        darkest = int(np.argmin(luminance))
        light_candidates = [
            int(index)
            for index in selected
            if luminance[index] >= 235 and chroma[index] <= 28
        ]
        kernel = np.ones((3, 3), dtype=np.uint8)
        image_area = restored.size
        eye_components = []

        def outer_border(component_mask: np.ndarray) -> np.ndarray:
            contours, _ = cv2.findContours(
                component_mask.astype(np.uint8),
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )
            filled = np.zeros(restored.shape, dtype=np.uint8)
            if contours:
                cv2.drawContours(filled, contours, -1, 1, thickness=-1)
            return cv2.morphologyEx(
                filled,
                cv2.MORPH_GRADIENT,
                kernel,
            ).astype(bool)

        subject_envelope = np.zeros(restored.shape, dtype=np.uint8)
        subject_contours, _ = cv2.findContours(
            subject.astype(np.uint8),
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        if subject_contours:
            cv2.drawContours(subject_envelope, subject_contours, -1, 1, thickness=-1)
        for light_index in light_candidates:
            light_mask = (restored == light_index).astype(np.uint8)
            component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(
                light_mask,
                connectivity=8,
            )
            for component_id in range(1, component_count):
                x, y, width, height, area = stats[component_id].tolist()
                if area < max(35, int(image_area * 0.001)):
                    continue
                if area > int(image_area * 0.18):
                    continue
                component = labels == component_id
                component_kernel_size = max(
                    5,
                    int(round(max(width, height) * 0.70)),
                )
                if component_kernel_size % 2 == 0:
                    component_kernel_size += 1
                component_envelope = cv2.dilate(
                    subject_envelope,
                    cv2.getStructuringElement(
                        cv2.MORPH_ELLIPSE,
                        (component_kernel_size, component_kernel_size),
                    ),
                )
                if np.mean(component_envelope[component]) < 0.78:
                    continue
                if x <= 1 or y <= 1 or x + width >= restored.shape[1] - 1:
                    continue
                aspect = width / max(1, height)
                if not 0.35 <= aspect <= 2.4:
                    continue
                border = outer_border(component)
                restored[border] = darkest
                outlines |= border
                if np.any(border):
                    outline_groups.append(border.copy())
                eye_components.append((x, y, width, height, area, centroids[component_id]))

        gray = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2GRAY)
        source_dark = ((gray <= 72) & subject).astype(np.uint8)
        component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(
            source_dark,
            connectivity=8,
        )
        dark_components = []
        for component_id in range(1, component_count):
            x, y, width, height, area = stats[component_id].tolist()
            if area < 4:
                continue
            component = labels == component_id
            distance = cv2.distanceTransform(
                component.astype(np.uint8),
                cv2.DIST_L2,
                5,
            )
            positive = distance[distance > 0]
            median_width = float(np.median(positive) * 2) if positive.size else 0.0
            dark_components.append(
                (component_id, x, y, width, height, area, median_width, centroids[component_id])
            )
            if area <= int(image_area * 0.015) and median_width <= 4.5:
                restored[component] = darkest

        if eye_components:
            eye_left = min(item[0] for item in eye_components)
            eye_right = max(item[0] + item[2] for item in eye_components)
            eye_bottom = max(item[1] + item[3] for item in eye_components)
            mouth_candidates = []
            for item in dark_components:
                component_id, x, y, width, height, area, median_width, centroid = item
                overlap = max(0, min(x + width, eye_right) - max(x, eye_left))
                if area < int(image_area * 0.003):
                    continue
                if area > int(image_area * 0.16) or median_width <= 4.5:
                    continue
                if overlap < min(width, eye_right - eye_left) * 0.35:
                    continue
                if float(centroid[1]) < eye_bottom - max(3, int(restored.shape[0] * 0.03)):
                    continue
                mouth_candidates.append(item)
            if mouth_candidates:
                component_id = max(mouth_candidates, key=lambda item: item[5])[0]
                mouth = labels == component_id
                border = outer_border(mouth)
                restored[border] = darkest
                outlines |= border
                if np.any(border):
                    outline_groups.append(border.copy())

        return restored, outlines, tuple(outline_groups)

    @staticmethod
    def _clean_thread_map(
        thread_map: np.ndarray,
        subject_mask: np.ndarray,
        detail_mask: np.ndarray,
        palette_rgb: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """Merge isolated subject flecks into their surrounding thread color."""
        cleaned = np.asarray(thread_map, dtype=np.int32).copy()
        subject = np.asarray(subject_mask, dtype=bool)
        detail = np.asarray(detail_mask, dtype=bool)
        if cleaned.shape != subject.shape or cleaned.shape != detail.shape:
            return cleaned

        max_speck_area = max(4, int(round(cleaned.size * 0.00015)))
        kernel = np.ones((3, 3), dtype=np.uint8)
        for thread_index in np.unique(cleaned[subject]):
            if thread_index < 0:
                continue
            label_mask = ((cleaned == thread_index) & subject).astype(np.uint8)
            component_count, labels, stats, _ = cv2.connectedComponentsWithStats(
                label_mask,
                connectivity=8,
            )
            for component_id in range(1, component_count):
                area = int(stats[component_id, cv2.CC_STAT_AREA])
                if area > max_speck_area:
                    continue
                component = labels == component_id
                if np.mean(detail[component]) >= 0.5:
                    continue
                ring = cv2.dilate(component.astype(np.uint8), kernel, iterations=1).astype(bool)
                ring &= ~component
                ring &= subject
                neighbors = cleaned[ring]
                neighbors = neighbors[neighbors >= 0]
                if not neighbors.size:
                    continue
                values, counts = np.unique(neighbors, return_counts=True)
                replacement = int(values[int(np.argmax(counts))])
                if replacement != thread_index:
                    cleaned[component] = replacement

        palette = np.asarray(palette_rgb) if palette_rgb is not None else None
        if palette is None or palette.ndim != 2 or palette.shape[1] < 3:
            return cleaned

        eroded_subject = cv2.erode(
            subject.astype(np.uint8),
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        dilated_subject = cv2.dilate(
            subject.astype(np.uint8),
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        silhouette = dilated_subject & ~eroded_subject
        luminance = (
            palette[:, 0] * 0.299
            + palette[:, 1] * 0.587
            + palette[:, 2] * 0.114
        )
        chroma = palette[:, :3].max(axis=1) - palette[:, :3].min(axis=1)
        neutral_indices = np.flatnonzero(
            (chroma <= 28) & (luminance >= 40) & (luminance <= 225)
        )
        neutral_lookup = set(int(index) for index in neutral_indices)
        wide_kernel = np.ones((5, 5), dtype=np.uint8)
        for thread_index in neutral_indices:
            candidate = silhouette & (cleaned == int(thread_index))
            if not np.any(candidate):
                continue
            component_count, labels = cv2.connectedComponents(
                candidate.astype(np.uint8),
                connectivity=8,
            )
            for component_id in range(1, component_count):
                component = labels == component_id
                ring = cv2.dilate(
                    component.astype(np.uint8),
                    wide_kernel,
                    iterations=1,
                ).astype(bool)
                ring &= subject
                ring &= ~component
                neighbors = cleaned[ring]
                neighbors = np.asarray(
                    [value for value in neighbors if int(value) not in neutral_lookup and value >= 0],
                    dtype=np.int32,
                )
                if not neighbors.size:
                    continue
                values, counts = np.unique(neighbors, return_counts=True)
                cleaned[component] = int(values[int(np.argmax(counts))])
        return cleaned

    @staticmethod
    def detect_primary_subject(image: np.ndarray) -> np.ndarray:
        """Estimate the main centered subject without depending on a model."""
        rgb = np.asarray(image)
        if rgb.ndim != 3 or rgb.shape[2] < 3 or min(rgb.shape[:2]) < 16:
            return np.ones(rgb.shape[:2], dtype=bool)

        height, width = rgb.shape[:2]
        scale = min(1.0, 512.0 / max(height, width))
        if scale < 1.0:
            work = cv2.resize(
                rgb[:, :, :3],
                (max(16, int(round(width * scale))), max(16, int(round(height * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        else:
            work = np.ascontiguousarray(rgb[:, :, :3], dtype=np.uint8)

        work_h, work_w = work.shape[:2]
        margin = max(1, int(round(min(work_h, work_w) * 0.01)))
        mask = np.full((work_h, work_w), cv2.GC_PR_BGD, dtype=np.uint8)
        mask[:margin, :] = cv2.GC_BGD
        mask[-margin:, :] = cv2.GC_BGD
        mask[:, :margin] = cv2.GC_BGD
        mask[:, -margin:] = cv2.GC_BGD

        x0, x1 = int(work_w * 0.18), int(work_w * 0.82)
        y0, y1 = int(work_h * 0.02), work_h - margin
        mask[y0:y1, x0:x1] = cv2.GC_PR_FGD
        cv2.ellipse(
            mask,
            (work_w // 2, int(work_h * 0.65)),
            (max(2, int(work_w * 0.04)), max(2, int(work_h * 0.04))),
            0,
            0,
            360,
            cv2.GC_FGD,
            -1,
        )

        background_model = np.zeros((1, 65), dtype=np.float64)
        foreground_model = np.zeros((1, 65), dtype=np.float64)
        try:
            cv2.setRNGSeed(42)
            cv2.grabCut(
                cv2.cvtColor(work, cv2.COLOR_RGB2BGR),
                mask,
                None,
                background_model,
                foreground_model,
                5,
                cv2.GC_INIT_WITH_MASK,
            )
            subject = np.isin(mask, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
        except cv2.error:
            subject = np.zeros((work_h, work_w), dtype=np.uint8)
            cv2.ellipse(
                subject,
                (work_w // 2, int(work_h * 0.60)),
                (max(1, int(work_w * 0.28)), max(1, int(work_h * 0.46))),
                0,
                0,
                360,
                1,
                -1,
            )

        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(
            subject,
            connectivity=8,
        )
        if component_count > 1:
            center_x, center_y = work_w * 0.5, work_h * 0.58
            candidates = []
            for label in range(1, component_count):
                area = int(stats[label, cv2.CC_STAT_AREA])
                ys, xs = np.where(labels == label)
                if not area:
                    continue
                distance = ((float(xs.mean()) - center_x) / work_w) ** 2
                distance += ((float(ys.mean()) - center_y) / work_h) ** 2
                candidates.append((area / (1.0 + distance * 4.0), label))
            if candidates:
                subject = (labels == max(candidates)[1]).astype(np.uint8)

        subject = cv2.morphologyEx(
            subject,
            cv2.MORPH_CLOSE,
            np.ones((3, 3), dtype=np.uint8),
        )
        if subject.shape != (height, width):
            subject = cv2.resize(subject, (width, height), interpolation=cv2.INTER_NEAREST)
        coverage = float(np.mean(subject > 0))
        if coverage < 0.05 or coverage > 0.80:
            subject = np.zeros((height, width), dtype=np.uint8)
            cv2.ellipse(
                subject,
                (width // 2, int(height * 0.60)),
                (max(1, int(width * 0.28)), max(1, int(height * 0.46))),
                0,
                0,
                360,
                1,
                -1,
            )
        return subject.astype(bool)

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

    @classmethod
    def _match_threads_with_budget(
        cls,
        design_colors: np.ndarray,
        pixel_counts: np.ndarray,
        detail_design_ids,
        palette_lab: np.ndarray,
        color_limit: int,
        subject_pixel_counts: Optional[np.ndarray] = None,
    ):
        """Limit physical spools while retaining high-resolution design colors."""
        if palette_lab.size == 0:
            return [(None, None) for _ in design_colors]

        design_lab = rgb2lab(
            design_colors.reshape(1, -1, 3).astype(np.float64) / 255.0
        )[0]
        distances = deltaE_ciede2000(
            design_lab.reshape(-1, 1, 3),
            palette_lab.reshape(1, -1, 3),
        )
        nearest = np.argmin(distances, axis=1)
        limit = max(1, min(int(color_limit), palette_lab.shape[0]))
        unique_nearest = np.unique(nearest)
        if unique_nearest.size <= limit:
            return [
                (int(index), float(distances[design_id, index]))
                for design_id, index in enumerate(nearest)
            ]

        detail_ids = set(int(index) for index in detail_design_ids)
        subject_counts = (
            np.asarray(subject_pixel_counts, dtype=np.float64)
            if subject_pixel_counts is not None
            else np.zeros_like(pixel_counts, dtype=np.float64)
        )
        has_subject = bool(np.any(subject_counts > 0))
        if has_subject:
            background_counts = np.maximum(
                np.asarray(pixel_counts, dtype=np.float64) - subject_counts,
                0.0,
            )
            weighted_counts = subject_counts * 4.0 + background_counts * 0.35
            for design_id in detail_ids:
                weighted_counts[design_id] *= 2.0

            subject_ids = np.flatnonzero(subject_counts > 0)
            luminance = (
                design_colors[:, 0] * 0.299
                + design_colors[:, 1] * 0.587
                + design_colors[:, 2] * 0.114
            )
            required = [
                int(nearest[int(np.argmin(luminance))]),
                int(nearest[subject_ids[np.argmin(luminance[subject_ids])]]),
                int(nearest[subject_ids[np.argmax(luminance[subject_ids])]]),
            ]
            selected = []
            for index in required:
                if index not in selected:
                    selected.append(index)
                if len(selected) >= limit:
                    break

            best_distance = (
                np.min(distances[:, np.asarray(selected, dtype=np.int32)], axis=1)
                if selected
                else np.full(len(design_colors), np.inf, dtype=np.float64)
            )
            while len(selected) < limit:
                best_candidate = None
                best_cost = np.inf
                for candidate in range(palette_lab.shape[0]):
                    if candidate in selected:
                        continue
                    cost = float(
                        np.sum(weighted_counts * np.minimum(best_distance, distances[:, candidate]))
                    )
                    if cost < best_cost:
                        best_cost = cost
                        best_candidate = candidate
                if best_candidate is None:
                    break
                selected.append(int(best_candidate))
                best_distance = np.minimum(best_distance, distances[:, best_candidate])

            selected_array = np.asarray(selected, dtype=np.int32)
            selected_distances = distances[:, selected_array]
            selected_positions = np.argmin(selected_distances, axis=1)
            return [
                (
                    int(selected_array[position]),
                    float(selected_distances[design_id, position]),
                )
                for design_id, position in enumerate(selected_positions)
            ]

        scores = {}
        for design_id, thread_index in enumerate(nearest):
            weight = float(pixel_counts[design_id])
            if design_id in detail_ids:
                weight *= 4.0
            scores[int(thread_index)] = scores.get(int(thread_index), 0.0) + weight

        luminance = (
            design_colors[:, 0] * 0.299
            + design_colors[:, 1] * 0.587
            + design_colors[:, 2] * 0.114
        )
        required = [
            int(nearest[int(np.argmin(luminance))]),
            int(nearest[int(np.argmax(luminance))]),
        ]
        detail_candidates = sorted(
            {int(nearest[index]) for index in detail_ids},
            key=lambda index: (-scores.get(index, 0.0), index),
        )
        ranked = sorted(scores, key=lambda index: (-scores[index], index))

        selected = []
        for index in required + detail_candidates + ranked:
            if index not in selected:
                selected.append(index)
            if len(selected) >= limit:
                break

        selected_array = np.asarray(selected, dtype=np.int32)
        selected_distances = distances[:, selected_array]
        selected_positions = np.argmin(selected_distances, axis=1)
        return [
            (
                int(selected_array[position]),
                float(selected_distances[design_id, position]),
            )
            for design_id, position in enumerate(selected_positions)
        ]

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
