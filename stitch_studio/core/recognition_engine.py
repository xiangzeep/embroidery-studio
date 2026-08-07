"""High-fidelity image recognition before physical thread substitution."""

from dataclasses import dataclass, replace
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image
from skimage.color import deltaE_ciede2000, lab2rgb, rgb2lab
from sklearn.cluster import KMeans, MiniBatchKMeans

from .contour_geometry import (
    adaptive_closed_contour,
    detect_locked_corner_indices,
)
from .semantic_parts import (
    FeatureGuide,
    SemanticPart,
    SemanticPartExtractor,
    SemanticPartKind,
)


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


@dataclass(frozen=True)
class RecognitionDiagnostics:
    """Inspectable recognition-stage artifacts before thread substitution."""

    design_preview_rgb: np.ndarray
    layer_preview_rgb: np.ndarray
    difference_heatmap_rgb: np.ndarray
    metrics: RecognitionMetrics
    subject_metrics: RecognitionMetrics
    acceptance_passed: bool
    acceptance_failures: Tuple[str, ...]


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
    feature_guides: Tuple[FeatureGuide, ...] = ()
    semantic_parts: Tuple[SemanticPart, ...] = ()
    stitch_design_map: Optional[np.ndarray] = None
    stitch_design_colors: Tuple[DesignColor, ...] = ()
    stitch_detail_design_ids: Tuple[int, ...] = ()


class RecognitionEngine:
    """Extract design colors without collapsing them into the thread library."""

    _SUBJECT_GRABCUT_MAX_SIDE = 192
    _SUBJECT_GRABCUT_ITERATIONS = 2
    _AUTO_BUDGETS = (24, 32, 48, 64, 96, 128)
    _EDGE_SAMPLE_WEIGHT = 4.0
    _LAYER_REVIEW_SCALE = 4

    @classmethod
    def recognize(cls, image, physical_threads, settings) -> RecognitionResult:
        rgb = np.asarray(image)
        if rgb.ndim != 3 or rgb.shape[2] < 3 or rgb.size == 0:
            raise ValueError("Recognition requires a non-empty RGB image")
        rgb = np.ascontiguousarray(rgb[:, :, :3], dtype=np.uint8)
        height, width = rgb.shape[:2]

        sensitivity = float(getattr(settings, "detail_sensitivity", 0.65))
        detail_mask = (
            cls.detect_fine_details(rgb, sensitivity=sensitivity)
            if settings.preserve_details
            else np.zeros((height, width), dtype=bool)
        )
        # Keep geometry evidence separate from the color-reservation mask.
        # Antialias pixels should not claim design colors, but they can bridge
        # a thin source stroke into one continuous semantic line.
        semantic_detail_mask = detail_mask.copy()
        # Antialiased edge pixels are visual blends between two design colors.
        # Reserving a color for each blend creates the gray/green rims that
        # users see around eyes and mouths after thread substitution.  Keep
        # the solid line core as detail, but let its edge blend with neighbors.
        antialias_mask = cls.detect_antialias_blends(rgb)
        detail_mask &= ~antialias_mask
        subject_mask = cls.detect_primary_subject(rgb)
        stitch_budget = cls._stitch_design_color_budget(rgb, settings)
        recognition_budget = max(
            stitch_budget,
            cls._recognition_color_budget(rgb, settings),
        )
        design_map, centers_rgb, detail_design_ids = cls._quantize_design(
            rgb,
            detail_mask,
            recognition_budget,
            antialias_mask=antialias_mask,
        )
        reconstructed = centers_rgb[design_map]
        if stitch_budget < recognition_budget:
            (
                stitch_design_map,
                stitch_centers_rgb,
                stitch_detail_design_ids,
            ) = cls._quantize_design(
                rgb,
                semantic_detail_mask,
                stitch_budget,
            )
        else:
            stitch_design_map = design_map
            stitch_centers_rgb = centers_rgb
            stitch_detail_design_ids = detail_design_ids

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
            background_weight=(
                0.35
                if not bool(getattr(settings, "include_background", False))
                else 0.35 + 0.9 * float(np.clip(
                    getattr(settings, "background_detail_level", 0.75),
                    0.0,
                    1.0,
                ))
            ),
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
        stitch_pixel_counts = np.bincount(
            stitch_design_map.reshape(-1),
            minlength=len(stitch_centers_rgb),
        )
        stitch_subject_pixel_counts = np.bincount(
            stitch_design_map[subject_mask].reshape(-1),
            minlength=len(stitch_centers_rgb),
        )
        stitch_thread_matches = cls._match_threads_with_budget(
            stitch_centers_rgb,
            stitch_pixel_counts,
            stitch_detail_design_ids,
            palette_lab,
            int(getattr(settings, "n_colors", len(physical_threads))),
            subject_pixel_counts=stitch_subject_pixel_counts,
            background_weight=(
                0.35
                if not bool(getattr(settings, "include_background", False))
                else 0.35 + 0.9 * float(np.clip(
                    getattr(settings, "background_detail_level", 0.75),
                    0.0,
                    1.0,
                ))
            ),
        )
        stitch_design_colors = tuple(
            DesignColor(
                design_id=design_id,
                color_rgb=tuple(int(channel) for channel in color),
                pixel_count=int(stitch_pixel_counts[design_id]),
                nearest_thread_index=stitch_thread_matches[design_id][0],
                nearest_thread_delta_e=stitch_thread_matches[design_id][1],
            )
            for design_id, color in enumerate(stitch_centers_rgb)
        )
        metrics = cls.measure_fidelity(
            rgb,
            reconstructed,
            source_detail_mask=detail_mask,
            recognized_detail_mask=cls.extract_observed_detail_mask(
                reconstructed,
                sensitivity=sensitivity,
            ),
        )
        matched_indices = np.asarray(
            [match[0] if match[0] is not None else -1 for match in thread_matches],
            dtype=np.int32,
        )
        stitch_matched_indices = np.asarray(
            [
                match[0] if match[0] is not None else -1
                for match in stitch_thread_matches
            ],
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
                stitch_matched_indices[stitch_design_map],
                subject_mask,
                semantic_detail_mask,
                palette_rgb,
                rgb,
            )
            (
                thread_map,
                feature_outline_mask,
                feature_outline_groups,
                feature_guides,
            ) = cls._restore_subject_features_with_guides(
                thread_map,
                rgb,
                subject_mask,
                palette_rgb,
            )
            assigned = thread_map >= 0
            thread_reconstructed[assigned] = palette_rgb[thread_map[assigned]]
            used_thread_indices = np.unique(thread_map[assigned])
            physical_design_colors = [
                DesignColor(
                    design_id=int(thread_index),
                    color_rgb=tuple(
                        int(channel) for channel in palette_rgb[thread_index]
                    ),
                    pixel_count=int(
                        np.count_nonzero(thread_map == thread_index)
                    ),
                    nearest_thread_index=int(thread_index),
                    nearest_thread_delta_e=0.0,
                )
                for thread_index in used_thread_indices
            ]
            semantic_parts = SemanticPartExtractor(max_parts=96).extract(
                image=rgb,
                design_map=thread_map,
                design_colors=physical_design_colors,
                detail_mask=detail_mask | feature_outline_mask,
                subject_mask=subject_mask,
                thread_matches={
                    int(thread_index): int(thread_index)
                    for thread_index in used_thread_indices
                },
                feature_guides=feature_guides,
            )
        else:
            thread_map = None
            feature_outline_mask = np.zeros((height, width), dtype=bool)
            feature_outline_groups = ()
            feature_guides = ()
            semantic_parts = SemanticPartExtractor().extract(
                image=rgb,
                design_map=design_map,
                design_colors=design_colors,
                detail_mask=semantic_detail_mask,
                subject_mask=subject_mask,
            )
        thread_detail_mask = cls.extract_observed_detail_mask(
            thread_reconstructed,
            sensitivity=sensitivity,
        )
        thread_metrics = cls.measure_fidelity(
            rgb,
            thread_reconstructed,
            source_detail_mask=detail_mask,
            recognized_detail_mask=thread_detail_mask,
        )
        subject_metrics = cls.measure_fidelity(
            rgb,
            thread_reconstructed,
            assigned_mask=subject_mask,
            source_detail_mask=detail_mask & subject_mask,
            recognized_detail_mask=thread_detail_mask & subject_mask,
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
            feature_guides=feature_guides,
            semantic_parts=semantic_parts,
            stitch_design_map=stitch_design_map,
            stitch_design_colors=stitch_design_colors,
            stitch_detail_design_ids=stitch_detail_design_ids,
        )

    @classmethod
    def build_design_diagnostics(
        cls,
        source_image: np.ndarray,
        result: RecognitionResult,
    ) -> RecognitionDiagnostics:
        """Render source-faithful acceptance artifacts before stitch planning.

        This intentionally consumes ``reconstructed_rgb`` and ``design_map``.
        It must never use the physical thread map: spool selection is a later
        production decision and should not alter the image a user approves.
        """
        source = np.asarray(source_image, dtype=np.uint8)
        design = np.asarray(result.reconstructed_rgb, dtype=np.uint8)
        if (
            source.ndim != 3
            or source.shape[2] < 3
            or design.shape != source[:, :, :3].shape
        ):
            raise ValueError("Source and design reconstruction must have matching RGB shapes")
        source = np.ascontiguousarray(source[:, :, :3])
        subject = (
            np.asarray(result.subject_mask, dtype=bool)
            if result.subject_mask is not None
            else np.ones(source.shape[:2], dtype=bool)
        )
        if subject.shape != source.shape[:2]:
            raise ValueError("Subject mask must match recognition dimensions")

        observed_details = cls.extract_observed_detail_mask(design)
        metrics = cls.measure_fidelity(
            source,
            design,
            source_detail_mask=result.detail_mask,
            recognized_detail_mask=observed_details,
        )
        subject_metrics = cls.measure_fidelity(
            source,
            design,
            assigned_mask=subject,
            source_detail_mask=np.asarray(result.detail_mask, dtype=bool) & subject,
            recognized_detail_mask=observed_details & subject,
        )

        labels = np.asarray(result.design_map, dtype=np.int32)
        if labels.shape != source.shape[:2]:
            raise ValueError("Design map must match recognition dimensions")
        # The reconstruction remains lossless here.  A high colour budget
        # contains compression texture as well as deliberate design colors;
        # drawing every design-map transition would make that texture look
        # like hundreds of broken layers.  The review overlay therefore shows
        # only stable scene-plane and protected-feature boundaries.
        layer_preview = cls._render_stable_layer_preview(
            design,
            result.feature_guides,
        )

        source_lab = rgb2lab(source.astype(np.float64) / 255.0)
        design_lab = rgb2lab(design.astype(np.float64) / 255.0)
        delta = deltaE_ciede2000(source_lab, design_lab)
        heat = cv2.applyColorMap(
            np.clip(delta * (255.0 / 18.0), 0, 255).astype(np.uint8),
            cv2.COLORMAP_TURBO,
        )[:, :, ::-1]
        difference = np.where(
            (delta[:, :, None] <= 1.5),
            design,
            (design.astype(np.float32) * 0.25 + heat.astype(np.float32) * 0.75).round().astype(np.uint8),
        )

        failures = []
        for name, value in (
            ("整体颜色", metrics.perceptual_similarity),
            ("整体轮廓", metrics.boundary_recall),
            ("主体颜色", subject_metrics.perceptual_similarity),
            ("主体细节", subject_metrics.detail_recall),
        ):
            if value < 0.95:
                failures.append(name)
        return RecognitionDiagnostics(
            design_preview_rgb=design.copy(),
            layer_preview_rgb=layer_preview,
            difference_heatmap_rgb=difference,
            metrics=metrics,
            subject_metrics=subject_metrics,
            acceptance_passed=not failures,
            acceptance_failures=tuple(failures),
        )

    @classmethod
    def _render_stable_layer_preview(
        cls,
        design: np.ndarray,
        feature_guides: Tuple[FeatureGuide, ...],
    ) -> np.ndarray:
        """Render an inspection-only layer view with stable vector-like edges.

        Recognition maps may be small (for example 315 by 200 pixels).  Painting
        their raw one-pixel morphology directly into the preview makes every
        zoom level look like a stair-step.  This renderer supersamples the
        review surface and draws simplified contours with antialiasing.  It is
        deliberately isolated from stitch geometry and export data.
        """
        base = np.asarray(design, dtype=np.uint8)
        height, width = base.shape[:2]
        scale = cls._LAYER_REVIEW_SCALE
        review = cv2.resize(
            base,
            (width * scale, height * scale),
            interpolation=cv2.INTER_CUBIC,
        )

        # A dark canvas frame makes the extent of the approved design explicit.
        cv2.rectangle(
            review,
            (scale // 2, scale // 2),
            (width * scale - scale // 2 - 1, height * scale - scale // 2 - 1),
            (18, 18, 18),
            thickness=scale,
            lineType=cv2.LINE_AA,
        )

        eye_contours = cls._extract_eye_fill_contours(base, feature_guides)
        for contour in eye_contours:
            scaled = np.rint(contour.astype(np.float32) * scale).astype(np.int32)
            cv2.polylines(
                review,
                [scaled],
                isClosed=True,
                color=(31, 27, 27),
                thickness=max(2, int(round(scale * 0.72))),
                lineType=cv2.LINE_AA,
            )
        eye_separator = cls._extract_eye_separator_path(feature_guides)
        if eye_contours and eye_separator:
            separator_mask = np.zeros(review.shape[:2], dtype=np.uint8)
            eye_fill_mask = np.zeros(review.shape[:2], dtype=np.uint8)
            scaled_separator = np.rint(
                np.asarray(eye_separator, dtype=np.float32) * scale
            ).astype(np.int32)
            scaled_eye_contours = [
                np.rint(contour.astype(np.float32) * scale).astype(np.int32)
                for contour in eye_contours
            ]
            cv2.fillPoly(eye_fill_mask, scaled_eye_contours, 1)
            # Each fitted eye draws a complete rim.  Restore the original
            # review pixels in their shared seam corridor before drawing one
            # authoritative separator, so the two inner rims cannot double up
            # into a visibly offset black wedge.
            cv2.polylines(
                separator_mask,
                [scaled_separator],
                isClosed=False,
                color=1,
                thickness=max(3, int(round(scale * 1.65))),
                lineType=cv2.LINE_AA,
            )
            # The source separator is a raster line embedded in the review
            # image.  Erasing only inside the fitted eye fills prevents it
            # from sitting beside the new vector seam as a second, offset
            # black line.  The single seam below then owns this boundary.
            reset = (separator_mask > 0) & (eye_fill_mask > 0)
            review[reset] = (248, 248, 248)
            cv2.polylines(
                review,
                [scaled_separator],
                isClosed=False,
                color=(31, 27, 27),
                thickness=max(2, int(round(scale * 0.62))),
                lineType=cv2.LINE_AA,
            )

        # Do not draw a generic subject outline here.  ``subject_mask`` is a
        # segmentation aid, not proof that a dark ink border exists in the
        # source.  Rendering it as a black line produced an invented, jagged
        # silhouette around characters at high zoom.  Only semantic guides
        # below have enough image evidence to become a visible contour.

        for guide in feature_guides:
            if guide.kind not in (
                SemanticPartKind.OPEN_LINE,
                SemanticPartKind.CLOSED_CONTOUR,
                SemanticPartKind.PROTECTED_HIGHLIGHT,
            ):
                continue
            if eye_contours and (
                guide.role == "eye_outline"
                and guide.kind in (
                    SemanticPartKind.CLOSED_CONTOUR,
                    SemanticPartKind.OPEN_LINE,
                )
            ):
                # Eye rims above were generated from the actual light fill.
                # The legacy compound rim and its partial bridge would add a
                # visibly offset double line between the two eyes.
                continue
            path = np.asarray(guide.path, dtype=np.float32)
            if path.ndim != 2 or len(path) < 2:
                continue
            closed = guide.kind == SemanticPartKind.CLOSED_CONTOUR
            perimeter = cv2.arcLength(path.reshape((-1, 1, 2)), closed)
            if guide.role == "mouth_outline" and closed:
                # Facial mouths have intentional pointed corners, but their
                # raster boundary also contains dozens of one-pixel steps.
                # A larger tolerance keeps the silhouette and tips while
                # removing the mechanical jitter from the visible contour.
                epsilon = max(1.35, min(2.4, perimeter * 0.01))
            else:
                epsilon = max(0.35, min(1.0, perimeter * 0.001))
            simplified = cv2.approxPolyDP(path.reshape((-1, 1, 2)), epsilon, closed)
            scaled = np.rint(simplified.astype(np.float32) * scale).astype(np.int32)
            cv2.polylines(
                review,
                [scaled],
                isClosed=closed,
                color=(39, 33, 33),
                thickness=max(2, int(round(scale * 0.7))),
                lineType=cv2.LINE_AA,
            )
        return review

    @staticmethod
    def _extract_eye_fill_contours(
        design: np.ndarray,
        feature_guides: Tuple[FeatureGuide, ...],
    ) -> Tuple[np.ndarray, ...]:
        """Find smooth eye rims from their own light fill, not a dark guide.

        Eye outlines in raster illustrations frequently touch at the bridge.
        A guide extracted from the shared dark line is therefore often one
        compound contour, while the two white eye fills remain the geometry
        users actually see.  Splitting that fill at the recognized bridge
        gives both the fill and its rim one shared source of truth.
        """
        image = np.asarray(design, dtype=np.uint8)
        if image.ndim != 3 or image.shape[2] < 3:
            return ()
        closed_guides = [
            guide
            for guide in feature_guides
            if (
                guide.role == "eye_outline"
                and guide.kind == SemanticPartKind.CLOSED_CONTOUR
                and len(guide.path) >= 3
            )
        ]
        if not closed_guides:
            return ()
        separators = [
            np.asarray(guide.path, dtype=np.float32)
            for guide in feature_guides
            if (
                guide.role == "eye_outline"
                and guide.kind == SemanticPartKind.OPEN_LINE
                and len(guide.path) >= 2
            )
        ]
        channel_min = image.min(axis=2)
        channel_span = image.max(axis=2) - channel_min
        light_neutral = (channel_min >= 180) & (channel_span <= 72)
        contours = []
        for guide in closed_guides:
            enclosure = np.zeros(image.shape[:2], dtype=np.uint8)
            path = np.rint(np.asarray(guide.path, dtype=np.float32)).astype(np.int32)
            cv2.fillPoly(enclosure, [path], 1)
            fill = (light_neutral & enclosure.astype(bool)).astype(np.uint8)
            for separator in separators:
                cv2.polylines(
                    fill,
                    [np.rint(separator).astype(np.int32)],
                    isClosed=False,
                    color=0,
                    thickness=3,
                    lineType=cv2.LINE_8,
                )
            count, components, stats, _ = cv2.connectedComponentsWithStats(fill)
            candidates = sorted(
                (
                    (int(stats[index, cv2.CC_STAT_AREA]), index)
                    for index in range(1, count)
                    if int(stats[index, cv2.CC_STAT_AREA]) >= 36
                ),
                reverse=True,
            )
            components_to_trace = [
                (components == index).astype(np.uint8)
                for _, index in candidates[:2]
            ]
            if len(components_to_trace) == 1:
                # A shared white bridge often joins the eyes *above* the
                # extracted dark centre seam.  Split the connected light fill
                # from its own two distance-transform peaks, instead of
                # trusting that incomplete seam to divide the component.
                split = RecognitionEngine._split_connected_eye_fill(
                    components_to_trace[0]
                )
                if split:
                    components_to_trace = list(split)
            for component in components_to_trace:
                component_contours, _ = cv2.findContours(
                    component,
                    cv2.RETR_EXTERNAL,
                    cv2.CHAIN_APPROX_NONE,
                )
                if not component_contours:
                    continue
                contour = max(component_contours, key=cv2.contourArea)
                smoothed = RecognitionEngine._fit_eye_ellipse(contour)
                if len(smoothed) >= 3:
                    contours.append(smoothed)
        contours.sort(key=lambda contour: cv2.boundingRect(contour)[0])
        return tuple(contours)

    @staticmethod
    def _fit_eye_ellipse(contour: np.ndarray) -> np.ndarray:
        """Return a dense, smooth eye rim fitted to its light-fill support.

        Recognition happens on a compact raster.  Simplifying its boundary
        preserves every pixel corner, which makes an eye look polygonal once
        it is zoomed or converted to running stitches.  Cartoon eye whites
        are deliberately rounded forms, so an ellipse fit is both closer to
        the source intent and gives downstream stitching a stable contour.
        """
        points = np.asarray(contour, dtype=np.int32).reshape((-1, 1, 2))
        if len(points) < 5:
            return points
        (center_x, center_y), (diameter_x, diameter_y), angle = cv2.fitEllipse(points)
        axis_x = max(1, int(round(diameter_x / 2.0)))
        axis_y = max(1, int(round(diameter_y / 2.0)))
        sampled = cv2.ellipse2Poly(
            (int(round(center_x)), int(round(center_y))),
            (axis_x, axis_y),
            int(round(angle)),
            0,
            360,
            5,
        )
        if sampled is None or len(sampled) < 3:
            return points
        return sampled.reshape((-1, 1, 2))

    @staticmethod
    def _extract_eye_separator_path(
        feature_guides: Tuple[FeatureGuide, ...],
    ) -> Tuple[Tuple[float, float], ...]:
        """Return one slightly extended, continuous eye-centre seam."""
        candidates = [
            np.asarray(guide.path, dtype=np.float32)
            for guide in feature_guides
            if (
                guide.role == "eye_outline"
                and guide.kind == SemanticPartKind.OPEN_LINE
                and len(guide.path) >= 2
            )
        ]
        if not candidates:
            return ()
        path = max(candidates, key=lambda item: cv2.arcLength(item, False))
        if len(path) < 2:
            return ()

        start_direction = path[1] - path[0]
        end_direction = path[-1] - path[-2]
        start_length = float(np.linalg.norm(start_direction))
        end_length = float(np.linalg.norm(end_direction))
        if start_length <= 1e-6 or end_length <= 1e-6:
            return tuple((float(x), float(y)) for x, y in path)
        extension = 1.5
        start = path[0] - start_direction / start_length * extension
        end = path[-1] + end_direction / end_length * extension
        extended = np.vstack((start, path[1:-1], end))
        return tuple((float(x), float(y)) for x, y in extended)

    @staticmethod
    def _split_connected_eye_fill(component: np.ndarray) -> Tuple[np.ndarray, ...]:
        """Split a touching eye pair using the two strongest interior peaks."""
        mask = np.asarray(component, dtype=np.uint8)
        ys, xs = np.where(mask > 0)
        if len(xs) < 72:
            return ()
        _, _, width, _ = cv2.boundingRect(mask)
        if width < 10:
            return ()
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
        midpoint = float(np.median(xs))
        left_distance = distance.copy()
        right_distance = distance.copy()
        left_distance[:, int(np.ceil(midpoint)) :] = 0.0
        right_distance[:, : int(np.floor(midpoint)) + 1] = 0.0
        left_y, left_x = np.unravel_index(int(np.argmax(left_distance)), distance.shape)
        right_y, right_x = np.unravel_index(int(np.argmax(right_distance)), distance.shape)
        if (
            left_distance[left_y, left_x] <= 0.0
            or right_distance[right_y, right_x] <= 0.0
            or right_x - left_x < max(4, int(round(width * 0.18)))
        ):
            return ()

        grid_y, grid_x = np.indices(mask.shape)
        left_distance_sq = (grid_x - left_x) ** 2 + (grid_y - left_y) ** 2
        right_distance_sq = (grid_x - right_x) ** 2 + (grid_y - right_y) ** 2
        left = ((mask > 0) & (left_distance_sq <= right_distance_sq)).astype(np.uint8)
        right = ((mask > 0) & (right_distance_sq < left_distance_sq)).astype(np.uint8)
        if min(int(left.sum()), int(right.sum())) < 36:
            return ()
        return left, right

    @staticmethod
    def detect_antialias_blends(image: np.ndarray) -> np.ndarray:
        """Find pixels that interpolate between neighboring design colors.

        A genuine one-pixel ink line is not on the color segment between its
        two neighbors, while an antialiased rim is.  This keeps sharp black
        marks available to the detail stage without producing a third, muddy
        border color around them.
        """
        rgb = np.asarray(image, dtype=np.float32)
        if rgb.ndim != 3 or rgb.shape[2] < 3:
            return np.zeros(rgb.shape[:2], dtype=bool)
        height, width = rgb.shape[:2]
        if height < 3 or width < 3:
            return np.zeros((height, width), dtype=bool)

        center = rgb[1:-1, 1:-1, :3]
        candidates = np.zeros(center.shape[:2], dtype=bool)
        pairs = (
            (rgb[1:-1, :-2, :3], rgb[1:-1, 2:, :3]),
            (rgb[:-2, 1:-1, :3], rgb[2:, 1:-1, :3]),
            (rgb[:-2, :-2, :3], rgb[2:, 2:, :3]),
            (rgb[:-2, 2:, :3], rgb[2:, :-2, :3]),
        )
        for first, second in pairs:
            direction = second - first
            span_sq = np.sum(direction * direction, axis=2)
            valid_span = span_sq >= 42.0 ** 2
            position = np.sum((center - first) * direction, axis=2) / np.maximum(span_sq, 1.0)
            projected = first + position[:, :, None] * direction
            residual = np.linalg.norm(center - projected, axis=2)
            candidates |= (
                valid_span
                & (position >= 0.08)
                & (position <= 0.92)
                & (residual <= np.maximum(7.0, np.sqrt(span_sq) * 0.06))
            )
        result = np.zeros((height, width), dtype=bool)
        result[1:-1, 1:-1] = candidates
        return result

    @staticmethod
    def _restore_subject_features(
        thread_map: np.ndarray,
        source_image: np.ndarray,
        subject_mask: np.ndarray,
        palette_rgb: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray, Tuple[np.ndarray, ...]]:
        restored, outlines, groups, _ = (
            RecognitionEngine._restore_subject_features_with_guides(
                thread_map,
                source_image,
                subject_mask,
                palette_rgb,
            )
        )
        return restored, outlines, groups

    @staticmethod
    def _restore_subject_features_with_guides(
        thread_map: np.ndarray,
        source_image: np.ndarray,
        subject_mask: np.ndarray,
        palette_rgb: np.ndarray,
    ) -> Tuple[
        np.ndarray,
        np.ndarray,
        Tuple[np.ndarray, ...],
        Tuple[FeatureGuide, ...],
    ]:
        """Restore cartoon facial outlines after physical thread reduction."""
        restored = np.asarray(thread_map, dtype=np.int32).copy()
        source = np.asarray(source_image, dtype=np.uint8)
        subject = np.asarray(subject_mask, dtype=bool)
        palette = np.asarray(palette_rgb, dtype=np.uint8)
        outlines = np.zeros(restored.shape, dtype=bool)
        outline_groups = []
        feature_guides = []
        if (
            source.shape[:2] != restored.shape
            or subject.shape != restored.shape
            or palette.ndim != 2
            or palette.shape[1] < 3
        ):
            return restored, outlines, (), ()

        selected = np.unique(restored[restored >= 0])
        if not selected.size:
            return restored, outlines, (), ()
        luminance = (
            palette[:, 0] * 0.299
            + palette[:, 1] * 0.587
            + palette[:, 2] * 0.114
        )
        chroma = palette[:, :3].max(axis=1) - palette[:, :3].min(axis=1)
        darkest = int(selected[np.argmin(luminance[selected])])
        light_candidates = [
            int(index)
            for index in selected
            if luminance[index] >= 185 and chroma[index] <= 48
        ]
        highlight_thread = (
            max(light_candidates, key=lambda index: luminance[index])
            if light_candidates
            else None
        )
        kernel = np.ones((3, 3), dtype=np.uint8)
        image_area = restored.size
        eye_components = []
        eye_masks = []
        gray = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2GRAY)

        def vector_border(
            component_mask: np.ndarray,
            *,
            preserve_tips: bool = False,
        ) -> Tuple[np.ndarray, Tuple[Tuple[float, float], ...], Tuple[int, ...]]:
            contours, _ = cv2.findContours(
                component_mask.astype(np.uint8),
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_NONE,
            )
            outline = np.zeros(restored.shape, dtype=np.uint8)
            viable = [
                contour
                for contour in contours
                if cv2.contourArea(contour) >= 2.0
                and cv2.arcLength(contour, True) > 1.0
            ]
            if not viable:
                return outline > 0, (), ()
            contour = max(viable, key=cv2.contourArea)
            raw = contour[:, 0, :].astype(np.float64)
            locked_source = (
                detect_locked_corner_indices(
                    raw,
                    support=3,
                    min_deflection_degrees=42.0,
                    min_support_length=2.0,
                )
                if preserve_tips
                else ()
            )
            if preserve_tips and not locked_source:
                perimeter = float(cv2.arcLength(contour, True))
                approximated = cv2.approxPolyDP(
                    contour,
                    max(0.8, perimeter * 0.01),
                    True,
                )[:, 0, :].astype(np.float64)
                supported = detect_locked_corner_indices(
                    approximated,
                    support=1,
                    min_deflection_degrees=35.0,
                    min_support_length=2.0,
                )
                locked_source = tuple(
                    sorted(
                        {
                            int(
                                np.argmin(
                                    np.linalg.norm(
                                        raw - approximated[index],
                                        axis=1,
                                    )
                                )
                            )
                            for index in supported
                        }
                    )
                )
            # Eye whites often arrive from anti-aliased source pixels as a
            # staircase contour.  Passing every one of those pixel turns to
            # the stitch engine produces a visibly vibrating eye socket.  A
            # small Douglas-Peucker reduction keeps the overall eye shape and
            # the shared-eye concavity, while removing only sub-pixel noise.
            geometry = raw
            if not preserve_tips:
                perimeter = float(cv2.arcLength(contour, True))
                epsilon = min(2.0, max(1.5, perimeter * 0.008))
                simplified = cv2.approxPolyDP(
                    contour,
                    epsilon,
                    True,
                )[:, 0, :].astype(np.float64)
                if len(simplified) >= 6:
                    geometry = simplified
            path = adaptive_closed_contour(
                geometry,
                spacing_px=0.85,
                smoothing_iterations=1 if preserve_tips else 2,
                locked_corner_indices=(
                    locked_source if preserve_tips else None
                ),
            )
            if len(path) < 4:
                return outline > 0, (), ()
            path_array = np.asarray(path[:-1], dtype=np.float64)
            locked = tuple(
                sorted(
                    {
                        int(
                            np.argmin(
                                np.linalg.norm(
                                    path_array - raw[index],
                                    axis=1,
                                )
                            )
                        )
                        for index in locked_source
                    }
                )
            )
            raster_path = np.rint(path_array).astype(np.int32)
            cv2.polylines(
                outline,
                [raster_path],
                True,
                255,
                thickness=1,
                lineType=cv2.LINE_8,
            )
            return (
                outline > 0,
                tuple((float(x), float(y)) for x, y in path),
                locked,
            )

        def fitted_eye_geometry(component_mask: np.ndarray) -> np.ndarray:
            """Return one sub-pixel ellipse sampled from an eye component.

            The recognition image is raster, but an eye rim is a continuous
            curve.  Keep its canonical geometry in floating point until it is
            rasterized for preview masks, so the stitch path does not inherit
            integer stair-steps from ``ellipse2Poly``.
            """
            contours, _ = cv2.findContours(
                np.asarray(component_mask, dtype=np.uint8),
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_NONE,
            )
            viable = [
                contour
                for contour in contours
                if len(contour) >= 5 and cv2.contourArea(contour) >= 8.0
            ]
            if not viable:
                return np.empty((0, 2), dtype=np.float64)
            contour = max(viable, key=cv2.contourArea)
            (center_x, center_y), (axis_x, axis_y), angle = cv2.fitEllipse(contour)
            radius_x = max(1.0, float(axis_x) * 0.5)
            radius_y = max(1.0, float(axis_y) * 0.5)
            theta = np.deg2rad(np.arange(0.0, 360.0, 3.0, dtype=np.float64))
            rotation = np.deg2rad(float(angle))
            cos_theta = np.cos(theta)
            sin_theta = np.sin(theta)
            return np.column_stack(
                (
                    float(center_x)
                    + radius_x * cos_theta * np.cos(rotation)
                    - radius_y * sin_theta * np.sin(rotation),
                    float(center_y)
                    + radius_x * cos_theta * np.sin(rotation)
                    + radius_y * sin_theta * np.cos(rotation),
                )
            )

        def tangent_eye_geometries(
            geometries: Sequence[np.ndarray],
        ) -> Tuple[np.ndarray, ...]:
            """Make two neighbouring fitted eyes meet at one centre boundary.

            Separately fitted ellipses frequently overlap by a few pixels on
            low-resolution artwork.  Drawing both rims over that overlap makes
            a doubled, displaced black seam.  Preserve each centre and vertical
            shape, while contracting only the inward horizontal radii until the
            two curves are tangent.
            """
            if len(geometries) != 2 or any(len(path) < 8 for path in geometries):
                return tuple(np.asarray(path, dtype=np.float64) for path in geometries)
            left, right = sorted(
                (np.asarray(path, dtype=np.float64) for path in geometries),
                key=lambda path: float(np.mean(path[:, 0])),
            )
            left_center = float(np.mean(left[:, 0]))
            right_center = float(np.mean(right[:, 0]))
            left_edge = float(np.max(left[:, 0]))
            right_edge = float(np.min(right[:, 0]))
            if left_edge <= right_edge or right_center <= left_center:
                return tuple(np.asarray(path, dtype=np.float64) for path in geometries)
            boundary = (left_edge + right_edge) * 0.5
            left_radius = left_edge - left_center
            right_radius = right_center - right_edge
            if left_radius <= 1e-6 or right_radius <= 1e-6:
                return tuple(np.asarray(path, dtype=np.float64) for path in geometries)
            left_scale = (boundary - left_center) / left_radius
            right_scale = (right_center - boundary) / right_radius
            if not (0.65 <= left_scale <= 1.0 and 0.65 <= right_scale <= 1.0):
                return tuple(np.asarray(path, dtype=np.float64) for path in geometries)
            adjusted = []
            for path, center, scale in (
                (left, left_center, left_scale),
                (right, right_center, right_scale),
            ):
                canonical = path.copy()
                canonical[:, 0] = center + (canonical[:, 0] - center) * scale
                adjusted.append(canonical)
            return tuple(adjusted)

        def smooth_eye_border(
            component_mask: np.ndarray,
            *,
            geometry: Optional[np.ndarray] = None,
        ) -> Tuple[np.ndarray, Tuple[Tuple[float, float], ...], Tuple[int, ...]]:
            """Fit one stable ellipse to a single white eye component.

            The stitched eye rim must not inherit the staircase of the image
            mask.  Recognition keeps the original white fill, but supplies a
            sampled ellipse as the authoritative black rim used by the stitch
            planner.  Adjacent eyes are made tangent before this guide is
            emitted, so their shared boundary stays a single stitched line.
            """
            sampled = (
                np.asarray(geometry, dtype=np.float64)
                if geometry is not None
                else fitted_eye_geometry(component_mask)
            )
            if len(sampled) < 8:
                return vector_border(component_mask)
            outline = np.zeros(restored.shape, dtype=np.uint8)
            cv2.polylines(
                outline,
                [np.rint(sampled).astype(np.int32)],
                True,
                255,
                thickness=1,
                lineType=cv2.LINE_8,
            )
            path = tuple((float(x), float(y)) for x, y in sampled)
            return outline > 0, path, ()

        def fitted_eye_fill(
            component_mask: np.ndarray,
            *,
            geometry: Optional[np.ndarray] = None,
        ) -> np.ndarray:
            """Return the same stable eye interior used by the rim geometry.

            The old pipeline only smoothed the black guide.  The fill still
            came from a pixel-quantized eye mask, so it could remain angular
            or leave pale/grey fragments outside the rim.  A facial eye is a
            single visual unit: the white fill and its rim must use one
            canonical shape.
            """
            sampled = (
                np.asarray(geometry, dtype=np.float64)
                if geometry is not None
                else fitted_eye_geometry(component_mask)
            )
            if len(sampled) < 8:
                return np.asarray(component_mask, dtype=bool).copy()
            filled = np.zeros(restored.shape, dtype=np.uint8)
            cv2.fillPoly(filled, [np.rint(sampled).astype(np.int32)], 1)
            return filled.astype(bool)

        def stabilized_mouth_border(
            component_mask: np.ndarray,
        ) -> Tuple[np.ndarray, Tuple[Tuple[float, float], ...], Tuple[int, ...]]:
            """Remove raster steps from a mouth while retaining true corners.

            The mouth is intentionally angular at its two corners and at the
            tongue opening.  We simplify the *source component* first, then
            resample straight spans.  Locking the simplified vertices avoids
            treating every pixel staircase as a corner.
            """
            contours, _ = cv2.findContours(
                np.asarray(component_mask, dtype=np.uint8),
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_NONE,
            )
            viable = [
                contour
                for contour in contours
                if cv2.contourArea(contour) >= 2.0
                and cv2.arcLength(contour, True) > 1.0
            ]
            if not viable:
                return vector_border(component_mask, preserve_tips=True)
            contour = max(viable, key=cv2.contourArea)
            perimeter = float(cv2.arcLength(contour, True))
            simplified = cv2.approxPolyDP(
                contour,
                max(1.0, min(1.8, perimeter * 0.008)),
                True,
            )[:, 0, :].astype(np.float64)
            if len(simplified) < 4:
                return vector_border(component_mask, preserve_tips=True)
            locked = detect_locked_corner_indices(
                simplified,
                support=1,
                min_deflection_degrees=35.0,
                min_support_length=1.5,
            )
            path = adaptive_closed_contour(
                simplified,
                spacing_px=0.85,
                smoothing_iterations=0,
                locked_corner_indices=locked,
            )
            if len(path) < 4:
                return vector_border(component_mask, preserve_tips=True)
            path_array = np.asarray(path[:-1], dtype=np.float64)
            locked_points = simplified[list(locked)] if locked else np.empty((0, 2))
            remapped_locks = tuple(
                sorted(
                    {
                        int(
                            np.argmin(
                                np.linalg.norm(path_array - point, axis=1)
                            )
                        )
                        for point in locked_points
                    }
                )
            )
            outline = np.zeros(restored.shape, dtype=np.uint8)
            cv2.polylines(
                outline,
                [np.rint(path_array).astype(np.int32)],
                True,
                255,
                thickness=1,
                lineType=cv2.LINE_8,
            )
            return (
                outline > 0,
                tuple((float(x), float(y)) for x, y in path),
                remapped_locks,
            )

        def thin_line_endpoint_support(component_mask: np.ndarray) -> np.ndarray:
            coords_yx = np.argwhere(component_mask)
            if len(coords_yx) < 3:
                return np.zeros(restored.shape, dtype=bool)
            coords_xy = coords_yx[:, ::-1].astype(np.float32)
            centered = coords_xy - np.mean(coords_xy, axis=0)
            try:
                _, _, vh = np.linalg.svd(centered, full_matrices=False)
            except np.linalg.LinAlgError:
                return np.zeros(restored.shape, dtype=bool)
            axis = vh[0]
            projections = centered @ axis
            endpoints = (
                coords_xy[int(np.argmin(projections))],
                coords_xy[int(np.argmax(projections))],
            )
            support = np.zeros(restored.shape, dtype=np.uint8)
            for endpoint in endpoints:
                point = tuple(np.rint(endpoint).astype(np.int32).tolist())
                cv2.circle(support, point, 1, 1, thickness=-1)
            return support.astype(bool) & subject

        def shared_eye_seam(
            first_mask: np.ndarray,
            second_mask: np.ndarray,
        ) -> Tuple[np.ndarray, Tuple[Tuple[float, float], ...]]:
            """Return one centerline for the interface of touching eye whites."""
            local_kernel = np.ones((3, 3), dtype=np.uint8)
            first = np.asarray(first_mask, dtype=bool)
            second = np.asarray(second_mask, dtype=bool)
            interface = (
                first
                & cv2.dilate(second.astype(np.uint8), local_kernel, iterations=1).astype(bool)
            ) | (
                second
                & cv2.dilate(first.astype(np.uint8), local_kernel, iterations=1).astype(bool)
            )
            ys, xs = np.where(interface)
            empty = np.zeros(restored.shape, dtype=bool)
            if len(xs) < 4:
                return empty, ()

            x_span = int(xs.max() - xs.min())
            y_span = int(ys.max() - ys.min())
            if max(x_span, y_span) < 4:
                return empty, ()
            if y_span >= x_span:
                first_center_x = float(np.mean(np.where(first)[1]))
                second_center_x = float(np.mean(np.where(second)[1]))
                center_x = (first_center_x + second_center_x) * 0.5
                center_column = int(round(center_x))
                points = np.asarray(
                    [
                        (float(np.median(xs[ys == y])), float(y))
                        for y in np.unique(ys)
                    ],
                    dtype=np.float32,
                )
                trim_top = max(2.0, float(y_span) * 0.16)
                points = points[points[:, 1] >= float(ys.min()) + trim_top]
                guided_x = []
                for x_value, y_value in points:
                    row = int(round(float(y_value)))
                    start = max(0, center_column - 2)
                    stop = min(gray.shape[1], center_column + 3)
                    candidates = np.arange(start, stop, dtype=np.float32)
                    scores = (
                        gray[row, start:stop].astype(np.float32)
                        + np.abs(candidates - float(x_value)) * 22.0
                    )
                    guided_x.append(float(candidates[int(np.argmin(scores))]))
                if len(guided_x) >= 3:
                    stable_x = np.asarray(guided_x, dtype=np.float32)
                    padded = np.pad(stable_x, (1, 1), mode="edge")
                    stable_x = np.asarray(
                        [
                            float(np.median(padded[index:index + 3]))
                            for index in range(len(stable_x))
                        ],
                        dtype=np.float64,
                    )
                    y_values = points[:, 1].astype(np.float64)
                    degree = 2 if len(stable_x) >= 5 else 1
                    coefficients = np.polyfit(y_values, stable_x, degree)
                    smooth_x = np.polyval(coefficients, y_values)
                    smooth_x += float(stable_x[0] - smooth_x[0])
                    guided_x = np.clip(
                        smooth_x,
                        float(start),
                        float(stop - 1),
                    ).tolist()
                points[:, 0] = np.asarray(guided_x, dtype=np.float32)
            else:
                points = np.asarray(
                    [
                        (float(x), float(np.median(ys[xs == x])))
                        for x in np.unique(xs)
                    ],
                    dtype=np.float32,
                )
            if len(points) < 2:
                return empty, ()
            simplified = cv2.approxPolyDP(
                points.reshape(-1, 1, 2),
                0.45,
                False,
            )[:, 0, :]
            if len(simplified) == 2 and len(points) >= 3:
                midpoint = points[len(points) // 2]
                simplified = np.vstack(
                    (simplified[0], midpoint, simplified[-1])
                )
            if len(simplified) < 2:
                return empty, ()
            seam = np.zeros(restored.shape, dtype=np.uint8)
            cv2.polylines(
                seam,
                [np.rint(simplified).astype(np.int32)],
                False,
                255,
                thickness=1,
                lineType=cv2.LINE_8,
            )
            path = tuple(
                (float(point[0]), float(point[1]))
                for point in simplified
            )
            return seam > 0, path

        def add_eye_guide(
            mask: np.ndarray,
            path: Tuple[Tuple[float, float], ...],
            *,
            kind: SemanticPartKind,
            locked: Tuple[int, ...] = (),
        ) -> None:
            if not path or not np.any(mask):
                return
            guide_rgb = source_dark_color(mask)
            restored[mask] = darkest
            outlines[mask] = True
            outline_groups.append(mask.copy())
            feature_guides.append(
                FeatureGuide(
                    guide_id=f"eye-outline-{sum(guide.role == 'eye_outline' for guide in feature_guides)}",
                    role="eye_outline",
                    design_color_id=darkest,
                    source_color_rgb=guide_rgb,
                    thread_index=darkest,
                    mask=mask,
                    path=path,
                    kind=kind,
                    locked_corner_indices=locked,
                )
            )

        def source_dark_color(mask: np.ndarray) -> Tuple[int, int, int]:
            """Sample visible line color from the source, not its thread match."""
            corridor = cv2.dilate(
                np.asarray(mask, dtype=np.uint8),
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                iterations=1,
            ).astype(bool)
            samples = source[corridor, :3]
            if samples.size:
                sample_luminance = (
                    samples[:, 0].astype(np.float32) * 0.299
                    + samples[:, 1].astype(np.float32) * 0.587
                    + samples[:, 2].astype(np.float32) * 0.114
                )
                dark_samples = samples[sample_luminance <= 88.0]
                if dark_samples.size:
                    representative = np.median(
                        dark_samples.astype(np.float64),
                        axis=0,
                    )
                    return tuple(int(round(value)) for value in representative)
            return tuple(int(channel) for channel in palette[darkest, :3])

        subject_envelope = np.zeros(restored.shape, dtype=np.uint8)
        subject_contours, _ = cv2.findContours(
            subject.astype(np.uint8),
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        if subject_contours:
            cv2.drawContours(subject_envelope, subject_contours, -1, 1, thickness=-1)
        eye_candidates = []
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
                eye_candidates.extend(
                    RecognitionEngine._split_touching_light_features(component)
                )

        source_rgb = source[:, :, :3].astype(np.int16)
        source_chroma = source_rgb.max(axis=2) - source_rgb.min(axis=2)
        source_light = (
            (gray >= 190)
            & (source_chroma <= 58)
            & subject
        ).astype(np.uint8)
        source_count, source_labels, source_stats, _ = (
            cv2.connectedComponentsWithStats(source_light, connectivity=8)
        )
        for component_id in range(1, source_count):
            area = int(source_stats[component_id, cv2.CC_STAT_AREA])
            if (
                area < max(35, int(image_area * 0.001))
                or area > int(image_area * 0.18)
            ):
                continue
            eye_candidates.extend(
                RecognitionEngine._split_touching_light_features(
                    source_labels == component_id
                )
            )

        for eye_component in eye_candidates:
            if any(
                np.count_nonzero(existing & eye_component)
                / max(1, np.count_nonzero(eye_component))
                >= 0.72
                for existing in eye_masks
            ):
                continue
            ys, xs = np.where(eye_component)
            if not xs.size:
                continue
            eye_x = int(xs.min())
            eye_y = int(ys.min())
            eye_width = int(xs.max() - eye_x + 1)
            eye_height = int(ys.max() - eye_y + 1)
            eye_area = int(xs.size)
            component_kernel_size = max(
                5,
                int(round(max(eye_width, eye_height) * 0.70)),
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
            if np.mean(component_envelope[eye_component]) < 0.78:
                continue
            if (
                eye_x <= 1
                or eye_y <= 1
                or eye_x + eye_width >= restored.shape[1] - 1
            ):
                continue
            aspect = eye_width / max(1, eye_height)
            if not 0.35 <= aspect <= 2.4:
                continue
            eye_components.append(
                (
                    eye_x,
                    eye_y,
                    eye_width,
                    eye_height,
                    eye_area,
                    np.asarray(
                        [float(np.mean(xs)), float(np.mean(ys))],
                        dtype=np.float64,
                    ),
                )
            )
            eye_masks.append(eye_component.copy())

        eye_fill_specs = []
        ordered_eye_pairs = sorted(
            zip(eye_components, eye_masks),
            key=lambda item: (item[0][0], item[0][1]),
        )
        if len(ordered_eye_pairs) == 2:
            raw_eye_masks = [pair[1] for pair in ordered_eye_pairs]
            eye_geometries = tangent_eye_geometries(
                [fitted_eye_geometry(eye_mask) for eye_mask in raw_eye_masks]
            )
            fitted_eye_masks = [
                fitted_eye_fill(eye_mask, geometry=geometry)
                for eye_mask, geometry in zip(raw_eye_masks, eye_geometries)
            ]
            for raw_eye_mask, fitted_eye_mask in zip(
                raw_eye_masks,
                fitted_eye_masks,
            ):
                light_values = restored[
                    raw_eye_mask & np.isin(restored, light_candidates)
                ]
                if light_values.size:
                    fill_index = int(
                        np.bincount(light_values).argmax()
                    )
                else:
                    fill_index = int(
                        light_candidates[0]
                        if light_candidates
                        else selected[np.argmax(luminance[selected])]
                    )
                eye_fill_specs.append(
                    (raw_eye_mask, fitted_eye_mask, fill_index)
                )

            # Each eye owns one canonical rim.  Merging touching masks first
            # creates a peanut-shaped outline and then adds a second centre
            # seam, which makes the exported eye sockets dark and displaced.
            # Overlap between two fitted ellipses already supplies the visual
            # centre boundary without a third stitched line.
            for fitted_eye_mask, geometry in zip(fitted_eye_masks, eye_geometries):
                border, path, locked = smooth_eye_border(
                    fitted_eye_mask,
                    geometry=geometry,
                )
                add_eye_guide(
                    border,
                    path,
                    kind=SemanticPartKind.CLOSED_CONTOUR,
                    locked=locked,
                )
            eye_masks = fitted_eye_masks
        else:
            for _, eye_mask in ordered_eye_pairs:
                border, path, locked = smooth_eye_border(eye_mask)
                add_eye_guide(
                    border,
                    path,
                    kind=SemanticPartKind.CLOSED_CONTOUR,
                    locked=locked,
                )

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
                long_axis = max(width, height)
                short_axis = max(1, min(width, height))
                if long_axis / short_axis >= 1.4:
                    restored[thin_line_endpoint_support(component)] = darkest

        if highlight_thread is not None and eye_masks:
            source_luminance = (
                source[:, :, 0].astype(np.float32) * 0.299
                + source[:, :, 1].astype(np.float32) * 0.587
                + source[:, :, 2].astype(np.float32) * 0.114
            )
            eye_union = np.zeros(restored.shape, dtype=np.uint8)
            for eye_mask in eye_masks:
                eye_contours, _ = cv2.findContours(
                    eye_mask.astype(np.uint8),
                    cv2.RETR_EXTERNAL,
                    cv2.CHAIN_APPROX_SIMPLE,
                )
                if eye_contours:
                    cv2.drawContours(
                        eye_union,
                        eye_contours,
                        -1,
                        1,
                        thickness=-1,
                    )
            eye_interior = cv2.erode(
                eye_union,
                kernel,
                iterations=1,
            ).astype(bool)
            for item in dark_components:
                (
                    component_id,
                    _,
                    _,
                    pupil_width,
                    pupil_height,
                    area,
                    _,
                    pupil_centroid,
                ) = item
                if area < 12 or area > int(image_area * 0.04):
                    continue
                component = labels == component_id
                if np.mean(eye_interior[component]) < 0.72:
                    continue
                contours, _ = cv2.findContours(
                    component.astype(np.uint8),
                    cv2.RETR_EXTERNAL,
                    cv2.CHAIN_APPROX_SIMPLE,
                )
                envelope = np.zeros(restored.shape, dtype=np.uint8)
                if contours:
                    cv2.drawContours(envelope, contours, -1, 1, thickness=-1)
                enclosed = cv2.erode(envelope, kernel, iterations=1).astype(bool)
                highlights = (
                    enclosed
                    & ~component
                    & eye_interior
                    & (source_luminance >= 96)
                    & (source_chroma <= 16)
                )
                highlight_count, highlight_labels, highlight_stats, _ = (
                    cv2.connectedComponentsWithStats(
                        highlights.astype(np.uint8),
                        connectivity=8,
                    )
                )
                for highlight_id in range(1, highlight_count):
                    highlight_area = int(
                        highlight_stats[highlight_id, cv2.CC_STAT_AREA]
                    )
                    if 1 <= highlight_area <= max(6, int(round(area * 0.18))):
                        highlight_seed = highlight_labels == highlight_id
                        highlight_support = highlight_seed
                        if highlight_area < 5:
                            candidates = cv2.dilate(
                                highlight_seed.astype(np.uint8),
                                cv2.getStructuringElement(
                                    cv2.MORPH_ELLIPSE,
                                    (3, 3),
                                ),
                                iterations=1,
                            ).astype(bool)
                            candidates &= envelope > 0
                            candidates &= eye_interior
                            support = highlight_seed.copy()
                            candidate_yx = np.argwhere(
                                candidates & ~highlight_seed
                            )
                            if candidate_yx.size:
                                seed_center = np.mean(
                                    np.argwhere(highlight_seed),
                                    axis=0,
                                )
                                distances = np.linalg.norm(
                                    candidate_yx - seed_center,
                                    axis=1,
                                )
                                needed = min(
                                    5 - highlight_area,
                                    len(candidate_yx),
                                )
                                for index in np.argsort(distances)[:needed]:
                                    y, x = candidate_yx[int(index)]
                                    support[int(y), int(x)] = True
                            highlight_support = support
                        highlight_support &= envelope > 0
                        highlight_support &= eye_interior
                        # Keep the pupil base continuous. The light glint is
                        # emitted below as a protected top-stitch guide, so
                        # assigning its support to the light thread here
                        # would punch a visible hole into the dark fill.
                        restored[highlight_support] = darkest
                        seed_yx = np.argwhere(highlight_seed)
                        highlight_path = ()
                        if seed_yx.size:
                            inset = max(
                                0.75,
                                min(
                                    1.25,
                                    min(pupil_width, pupil_height) * 0.1,
                                ),
                            )
                            target = np.asarray(
                                (
                                    float(pupil_centroid[1]) - inset,
                                    float(pupil_centroid[0]) + inset,
                                ),
                                dtype=np.float64,
                            )
                            pupil_distance = cv2.distanceTransform(
                                component.astype(np.uint8),
                                cv2.DIST_L2,
                                5,
                            )
                            safe_yx = np.argwhere(pupil_distance >= 1.0)
                            if not safe_yx.size:
                                safe_yx = np.argwhere(component)
                            target_y = int(round(float(target[0])))
                            target_x = int(round(float(target[1])))
                            if (
                                0 <= target_y < component.shape[0]
                                and 0 <= target_x < component.shape[1]
                                and pupil_distance[target_y, target_x] >= 1.0
                            ):
                                center_y, center_x = target
                            else:
                                nearest_index = int(
                                    np.argmin(
                                        np.linalg.norm(
                                            safe_yx.astype(np.float64) - target,
                                            axis=1,
                                        )
                                    )
                                )
                                center_y, center_x = safe_yx[nearest_index]
                            # A pupil glint is a top running stitch, not a
                            # miniature filled polygon. Keep its geometry
                            # subpixel-small and consistently rising toward
                            # the upper-right, matching reflected light.
                            highlight_path = (
                                (
                                    float(center_x) - 0.25,
                                    float(center_y) + 0.25,
                                ),
                                (float(center_x), float(center_y)),
                                (
                                    float(center_x) + 0.25,
                                    float(center_y) - 0.25,
                                ),
                            )
                        if highlight_path:
                            feature_guides.append(
                                FeatureGuide(
                                    guide_id=(
                                        f"pupil-highlight-"
                                        f"{len(feature_guides)}"
                                    ),
                                    role="pupil_highlight",
                                    design_color_id=highlight_thread,
                                    source_color_rgb=(255, 255, 255),
                                    thread_index=highlight_thread,
                                    mask=highlight_support,
                                    path=highlight_path,
                                    kind=(
                                        SemanticPartKind.PROTECTED_HIGHLIGHT
                                    ),
                                )
                            )

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
                mouth_item = max(mouth_candidates, key=lambda item: item[5])
                component_id, mouth_x, mouth_y, mouth_width, mouth_height, *_ = (
                    mouth_item
                )
                mouth = labels == component_id
                border, path, locked = stabilized_mouth_border(mouth)
                restored[border] = darkest
                outlines |= border
                if np.any(border):
                    outline_groups.append(border.copy())
                if path:
                    feature_guides.append(
                        FeatureGuide(
                            guide_id="mouth-outline",
                            role="mouth_outline",
                            design_color_id=darkest,
                            source_color_rgb=source_dark_color(border),
                            thread_index=darkest,
                            mask=border,
                            path=path,
                            locked_corner_indices=locked,
                        )
                    )

                # Thin lower-lip strokes are often surrounded by antialias
                # pixels, so palette replacement turns one source mark into
                # several unrelated one-pixel islands.  Preserve the source
                # component as a single semantic open path before it can be
                # fragmented by colour quantization.  The support is snapped
                # just below the mouth envelope: that keeps the run visible
                # instead of burying it in the mouth fill.
                mouth_bottom = mouth_y + mouth_height
                for (
                    detail_component_id,
                    detail_x,
                    detail_y,
                    detail_width,
                    detail_height,
                    detail_area,
                    detail_width_mm,
                    _,
                ) in dark_components:
                    if detail_component_id == component_id:
                        continue
                    long_axis = max(detail_width, detail_height)
                    short_axis = max(1, min(detail_width, detail_height))
                    overlaps_mouth = (
                        detail_x + detail_width >= mouth_x + mouth_width * 0.2
                        and detail_x <= mouth_x + mouth_width * 0.8
                    )
                    is_short_lip_stroke = (
                        5 <= detail_area <= max(42, int(image_area * 0.001))
                        and 5 <= long_axis <= max(18, int(mouth_width * 0.38))
                        and long_axis / short_axis >= 2.5
                        and detail_width_mm <= 4.5
                        and overlaps_mouth
                        and mouth_bottom - 2 <= detail_y <= mouth_bottom + 10
                    )
                    if not is_short_lip_stroke:
                        continue

                    source_mark = labels == detail_component_id
                    points_yx = np.argwhere(source_mark)
                    if len(points_yx) < 2:
                        continue
                    horizontal = detail_width >= detail_height
                    order = np.argsort(points_yx[:, 1 if horizontal else 0])
                    ordered = points_yx[order]
                    start_y, start_x = ordered[0]
                    end_y, end_x = ordered[-1]
                    # The source mark sits on the antialiased mouth edge. A
                    # small outward offset resolves it into the intended lip
                    # crease and supplies a stable corridor for the stitch
                    # planner, without changing its length or direction.
                    offset = max(2.0, min(6.0, mouth_height * 0.12))
                    center_x = (float(start_x) + float(end_x)) / 2.0
                    center_y = (float(start_y) + float(end_y)) / 2.0 + offset
                    path = (
                        (float(start_x), float(start_y) + offset),
                        (center_x, center_y),
                        (float(end_x), float(end_y) + offset),
                    )
                    support = np.zeros(restored.shape, dtype=np.uint8)
                    cv2.polylines(
                        support,
                        [
                            np.rint(
                                np.asarray(path, dtype=np.float32)
                            ).astype(np.int32)
                        ],
                        isClosed=False,
                        color=1,
                        thickness=3,
                        lineType=cv2.LINE_AA,
                    )
                    feature_guides.append(
                        FeatureGuide(
                            guide_id="mouth-lower-lip",
                            role="line_detail",
                            design_color_id=darkest,
                            source_color_rgb=source_dark_color(source_mark),
                            thread_index=darkest,
                            mask=support.astype(bool),
                            path=path,
                            kind=SemanticPartKind.OPEN_LINE,
                        )
                    )
                    break

        source_pixels = source[:, :, :3].astype(np.float32)
        palette_pixels = palette[:, :3].astype(np.float32)
        nearest = np.full(restored.shape, int(selected[0]), dtype=np.int32)
        best_distance_sq = np.full(restored.shape, np.inf, dtype=np.float32)
        for palette_index in selected:
            palette_index = int(palette_index)
            color = palette_pixels[palette_index]
            red = source_pixels[:, :, 0] - color[0]
            green = source_pixels[:, :, 1] - color[1]
            blue = source_pixels[:, :, 2] - color[2]
            distance_sq = red * red + green * green + blue * blue
            improved = distance_sq < best_distance_sq
            best_distance_sq[improved] = distance_sq[improved]
            nearest[improved] = palette_index
        best_distance = np.sqrt(best_distance_sq)
        current_colors = palette_pixels[
            np.clip(restored, 0, len(palette_pixels) - 1)
        ]
        current_distance = np.linalg.norm(
            source_pixels - current_colors,
            axis=2,
        )
        for raw_eye_mask, fitted_eye_mask, fill_index in eye_fill_specs:
            # Remove only source-white pixels outside the canonical eye.  The
            # surrounding ring supplies the local skin/face colour, avoiding
            # a pale anti-alias halo while leaving pupils and the black guide
            # untouched inside the fitted eye.
            ring = cv2.dilate(
                raw_eye_mask.astype(np.uint8),
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
                iterations=1,
            ).astype(bool) & ~raw_eye_mask & subject
            ring_values = restored[
                ring & ~np.isin(restored, light_candidates)
            ]
            replacement = (
                int(np.bincount(ring_values).argmax())
                if ring_values.size
                else int(nearest[np.argwhere(raw_eye_mask)[0][0], np.argwhere(raw_eye_mask)[0][1]])
            )
            old_light = raw_eye_mask & np.isin(restored, light_candidates)
            restored[old_light & ~fitted_eye_mask] = replacement
            # Keep the full pupil, including its grey antialias fringe.
            # Replacing just the strictly-black core leaves a pale crescent
            # or an angular hole around the pupil after thread reduction.
            pupil_protection = cv2.dilate(
                source_dark,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                iterations=1,
            ).astype(bool)
            eye_white = fitted_eye_mask & ~pupil_protection & ~outlines
            restored[eye_white] = fill_index
        max_detail_area = max(32, int(round(image_area * 0.0015)))
        for target_index in np.unique(nearest[subject]):
            target_index = int(target_index)
            if target_index in light_candidates:
                continue
            palette_separation = np.linalg.norm(
                current_colors - palette_pixels[target_index],
                axis=2,
            )
            candidate = (
                subject
                & (nearest == target_index)
                & (restored != target_index)
                & (best_distance <= 32.0)
                & (best_distance + 18.0 < current_distance)
                & (palette_separation >= 35.0)
            )
            candidate_count, candidate_labels, candidate_stats, _ = (
                cv2.connectedComponentsWithStats(
                    candidate.astype(np.uint8),
                    connectivity=8,
                )
            )
            for candidate_id in range(1, candidate_count):
                x, y, width, height, area = candidate_stats[candidate_id].tolist()
                if area < 2 or area > max_detail_area:
                    continue
                long_axis = max(width, height)
                fill_ratio = area / max(1, width * height)
                if long_axis < 3 and area < 4:
                    continue
                if fill_ratio < 0.12:
                    continue
                component = candidate_labels == candidate_id
                ring = cv2.dilate(
                    component.astype(np.uint8),
                    kernel,
                    iterations=1,
                ).astype(bool) & ~component
                ring &= subject
                if not np.any(ring):
                    continue
                component_mean = np.mean(source_pixels[component], axis=0)
                ring_median = np.median(source_pixels[ring], axis=0)
                local_contrast = float(
                    np.linalg.norm(component_mean - ring_median)
                )
                elongated = long_axis / max(1, min(width, height)) >= 1.4
                compact_dot = area >= 4 and fill_ratio >= 0.45
                if local_contrast < 24.0 or not (elongated or compact_dot):
                    continue
                restored[component] = target_index

        return (
            restored,
            outlines,
            tuple(outline_groups),
            tuple(feature_guides),
        )

    @staticmethod
    def _split_touching_light_features(
        component_mask: np.ndarray,
    ) -> Tuple[np.ndarray, ...]:
        """Split a touching pair of rounded light features at its distance peaks."""
        component = np.asarray(component_mask, dtype=bool)
        ys, xs = np.where(component)
        if not xs.size:
            return ()
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        if width / max(1, height) < 1.02 or min(width, height) < 7:
            return (component,)

        filled = np.zeros(component.shape, dtype=np.uint8)
        contours, _ = cv2.findContours(
            component.astype(np.uint8),
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        if contours:
            cv2.drawContours(filled, contours, -1, 1, thickness=-1)
        else:
            filled[component] = 1
        distance = cv2.distanceTransform(
            filled,
            cv2.DIST_L2,
            5,
        )
        peak_value = float(distance.max())
        if peak_value < 2.0:
            return (component,)
        smoothed = cv2.GaussianBlur(distance, (0, 0), 1.0)
        local_maximum = smoothed >= (
            cv2.dilate(smoothed, np.ones((5, 5), dtype=np.uint8)) - 1e-4
        )
        peak_mask = (
            local_maximum
            & (filled > 0)
            & (smoothed >= peak_value * 0.52)
        )
        count, peak_labels, _, peak_centroids = cv2.connectedComponentsWithStats(
            peak_mask.astype(np.uint8),
            connectivity=8,
        )
        candidates = []
        for peak_id in range(1, count):
            peak = peak_labels == peak_id
            if not np.any(peak):
                continue
            candidates.append(
                (
                    float(np.max(smoothed[peak])),
                    np.asarray(peak_centroids[peak_id], dtype=np.float64),
                )
            )
        candidates.sort(key=lambda item: item[0], reverse=True)
        if len(candidates) < 2:
            return (component,)

        first = candidates[0][1]
        second = next(
            (
                center
                for _, center in candidates[1:]
                if abs(float(center[0] - first[0])) >= max(4.0, width * 0.18)
                and abs(float(center[1] - first[1])) <= height * 0.55
                and float(np.linalg.norm(center - first)) >= max(5.0, width * 0.22)
            ),
            None,
        )
        if second is None:
            return (component,)

        pixels = np.column_stack((xs, ys)).astype(np.float64)
        first_distance = np.sum((pixels - first) ** 2, axis=1)
        second_distance = np.sum((pixels - second) ** 2, axis=1)
        first_mask = np.zeros(component.shape, dtype=bool)
        second_mask = np.zeros(component.shape, dtype=bool)
        first_owned = first_distance <= second_distance
        first_mask[ys[first_owned], xs[first_owned]] = True
        second_mask[ys[~first_owned], xs[~first_owned]] = True
        minimum_area = max(12, int(round(np.count_nonzero(component) * 0.22)))
        if (
            np.count_nonzero(first_mask) < minimum_area
            or np.count_nonzero(second_mask) < minimum_area
        ):
            return (component,)
        ordered = sorted(
            (first_mask, second_mask),
            key=lambda mask: float(np.mean(np.where(mask)[1])),
        )
        return tuple(ordered)

    @staticmethod
    def _clean_thread_map(
        thread_map: np.ndarray,
        subject_mask: np.ndarray,
        detail_mask: np.ndarray,
        palette_rgb: Optional[np.ndarray] = None,
        source_rgb: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """Merge isolated subject flecks into their surrounding thread color."""
        cleaned = np.asarray(thread_map, dtype=np.int32).copy()
        original = cleaned.copy()
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

        cleaned = RecognitionEngine._absorb_near_color_enclosure_rims(
            cleaned,
            subject,
            palette,
        )
        cleaned = RecognitionEngine._fill_source_supported_dark_holes(
            cleaned,
            subject,
            palette,
            source_rgb,
        )
        cleaned = RecognitionEngine._suppress_transition_fringes(
            cleaned,
            subject,
            palette,
            source_rgb,
        )
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

        # The transition cleanup is intended to remove color fringes around
        # the subject. Preserve source-confirmed background details once they
        # are safely outside that boundary; otherwise thin bubbles, plants and
        # line art disappear even though recognition found them correctly.
        subject_guard = cv2.dilate(
            subject.astype(np.uint8),
            np.ones((3, 3), dtype=np.uint8),
            iterations=2,
        ).astype(bool)
        protected_background_detail = detail & ~subject_guard
        cleaned[protected_background_detail] = original[protected_background_detail]
        return cleaned

    @staticmethod
    def _suppress_transition_fringes(
        thread_map: np.ndarray,
        subject_mask: np.ndarray,
        palette_rgb: np.ndarray,
        source_rgb: Optional[np.ndarray],
    ) -> np.ndarray:
        """Remove thin third-color bands created by antialiased boundaries."""
        cleaned = np.asarray(thread_map, dtype=np.int32).copy()
        original = cleaned.copy()
        subject = np.asarray(subject_mask, dtype=bool)
        palette = np.asarray(palette_rgb, dtype=np.float64)
        source = np.asarray(source_rgb) if source_rgb is not None else None
        if (
            source is None
            or source.ndim != 3
            or source.shape[:2] != cleaned.shape
            or subject.shape != cleaned.shape
            or palette.ndim != 2
            or palette.shape[1] < 3
        ):
            return cleaned

        source_pixels = source[:, :, :3].astype(np.float64)
        max_area = max(24, int(round(cleaned.size * 0.015)))
        ring_kernel = np.ones((5, 5), dtype=np.uint8)

        def segment_fit(
            color: np.ndarray,
            first: np.ndarray,
            second: np.ndarray,
        ) -> Tuple[float, float]:
            axis = second - first
            denominator = float(np.dot(axis, axis))
            if denominator <= 1.0:
                return np.inf, 0.0
            position = float(np.dot(color - first, axis) / denominator)
            projected = first + np.clip(position, 0.0, 1.0) * axis
            return float(np.linalg.norm(color - projected)), position

        for thread_index in np.unique(original):
            thread_index = int(thread_index)
            if thread_index < 0 or thread_index >= len(palette):
                continue
            label_mask = (original == thread_index).astype(np.uint8)
            component_count, components, stats, _ = (
                cv2.connectedComponentsWithStats(label_mask, connectivity=8)
            )
            for component_id in range(1, component_count):
                area = int(stats[component_id, cv2.CC_STAT_AREA])
                if area < 1 or area > max_area:
                    continue
                component = components == component_id
                thickness = cv2.distanceTransform(
                    component.astype(np.uint8),
                    cv2.DIST_L2,
                    3,
                )
                if float(np.max(thickness)) > 2.4:
                    continue

                ring = cv2.dilate(
                    component.astype(np.uint8),
                    ring_kernel,
                    iterations=1,
                ).astype(bool)
                ring &= ~component
                neighbors = original[ring]
                neighbors = neighbors[
                    (neighbors >= 0)
                    & (neighbors < len(palette))
                    & (neighbors != thread_index)
                ]
                if neighbors.size < 4:
                    continue
                values, counts = np.unique(neighbors, return_counts=True)
                order = np.argsort(counts)[::-1][:4]
                candidates = [
                    (int(values[index]), int(counts[index]))
                    for index in order
                    if int(counts[index]) >= max(2, int(neighbors.size * 0.06))
                ]
                if len(candidates) < 2:
                    continue

                source_color = np.median(source_pixels[component], axis=0)
                current_color = palette[thread_index, :3]
                best_pair = None
                best_score = np.inf
                for first_position in range(len(candidates) - 1):
                    for second_position in range(first_position + 1, len(candidates)):
                        first_index = candidates[first_position][0]
                        second_index = candidates[second_position][0]
                        first_color = palette[first_index, :3]
                        second_color = palette[second_index, :3]
                        source_error, source_position = segment_fit(
                            source_color,
                            first_color,
                            second_color,
                        )
                        palette_error, palette_position = segment_fit(
                            current_color,
                            first_color,
                            second_color,
                        )
                        source_is_mixture = (
                            0.06 <= source_position <= 0.94
                            and source_error <= 38.0
                        )
                        palette_is_mixture = (
                            0.06 <= palette_position <= 0.94
                            and palette_error <= 28.0
                        )
                        if not (source_is_mixture or palette_is_mixture):
                            continue
                        score = min(
                            source_error if source_is_mixture else np.inf,
                            palette_error if palette_is_mixture else np.inf,
                        )
                        if score < best_score:
                            best_score = score
                            best_pair = (first_index, second_index)
                if best_pair is None:
                    continue

                first_index, second_index = best_pair
                first_ring = ring & (original == first_index)
                second_ring = ring & (original == second_index)
                first_subject_ratio = (
                    float(np.mean(subject[first_ring]))
                    if np.any(first_ring)
                    else 0.5
                )
                second_subject_ratio = (
                    float(np.mean(subject[second_ring]))
                    if np.any(second_ring)
                    else 0.5
                )
                if abs(first_subject_ratio - second_subject_ratio) >= 0.55:
                    inside_index = (
                        first_index
                        if first_subject_ratio > second_subject_ratio
                        else second_index
                    )
                    outside_index = (
                        second_index
                        if inside_index == first_index
                        else first_index
                    )
                    cleaned[component & subject] = inside_index
                    cleaned[component & ~subject] = outside_index
                    continue

                distance_to_first = cv2.distanceTransform(
                    (original != first_index).astype(np.uint8),
                    cv2.DIST_L2,
                    3,
                )
                distance_to_second = cv2.distanceTransform(
                    (original != second_index).astype(np.uint8),
                    cv2.DIST_L2,
                    3,
                )
                choose_first = component & (distance_to_first < distance_to_second)
                choose_second = component & (distance_to_second < distance_to_first)
                ties = component & ~(choose_first | choose_second)
                if np.any(ties):
                    first_error = np.linalg.norm(
                        source_pixels - palette[first_index, :3],
                        axis=2,
                    )
                    second_error = np.linalg.norm(
                        source_pixels - palette[second_index, :3],
                        axis=2,
                    )
                    choose_first |= ties & (first_error <= second_error)
                    choose_second |= ties & ~choose_first
                cleaned[choose_first] = first_index
                cleaned[choose_second] = second_index

        return cleaned

    @staticmethod
    def _fill_source_supported_dark_holes(
        thread_map: np.ndarray,
        subject_mask: np.ndarray,
        palette_rgb: np.ndarray,
        source_rgb: Optional[np.ndarray],
    ) -> np.ndarray:
        """Repair tiny quantization holes inside source-solid dark marks."""
        cleaned = np.asarray(thread_map, dtype=np.int32).copy()
        source = np.asarray(source_rgb) if source_rgb is not None else None
        subject = np.asarray(subject_mask, dtype=bool)
        palette = np.asarray(palette_rgb, dtype=np.float64)
        if (
            source is None
            or source.ndim != 3
            or source.shape[:2] != cleaned.shape
            or palette.ndim != 2
            or palette.shape[1] < 3
        ):
            return cleaned

        palette_luminance = (
            palette[:, 0] * 0.299
            + palette[:, 1] * 0.587
            + palette[:, 2] * 0.114
        )
        source_rgb64 = source[:, :, :3].astype(np.float64)
        source_luminance = (
            source_rgb64[:, :, 0] * 0.299
            + source_rgb64[:, :, 1] * 0.587
            + source_rgb64[:, :, 2] * 0.114
        )
        max_component_area = max(256, int(round(cleaned.size * 0.02)))
        max_hole_area = max(16, int(round(cleaned.size * 0.0015)))

        for thread_index in np.unique(cleaned[subject]):
            thread_index = int(thread_index)
            if (
                thread_index < 0
                or thread_index >= len(palette)
                or palette_luminance[thread_index] > 115.0
            ):
                continue
            label_mask = ((cleaned == thread_index) & subject).astype(np.uint8)
            component_count, components, stats, _ = cv2.connectedComponentsWithStats(
                label_mask,
                connectivity=8,
            )
            for component_id in range(1, component_count):
                area = int(stats[component_id, cv2.CC_STAT_AREA])
                if area < 12 or area > max_component_area:
                    continue
                component = components == component_id
                contours, hierarchy = cv2.findContours(
                    component.astype(np.uint8),
                    cv2.RETR_CCOMP,
                    cv2.CHAIN_APPROX_SIMPLE,
                )
                if hierarchy is None:
                    continue
                for contour_index, contour in enumerate(contours):
                    if hierarchy[0][contour_index][3] < 0:
                        continue
                    hole = np.zeros(cleaned.shape, dtype=np.uint8)
                    cv2.drawContours(hole, [contour], -1, 1, thickness=-1)
                    hole_mask = (hole > 0) & ~component & subject
                    hole_area = int(np.count_nonzero(hole_mask))
                    if (
                        hole_area == 0
                        or hole_area > max_hole_area
                        or hole_area / max(1, area) > 0.35
                    ):
                        continue
                    pixels = source_rgb64[hole_mask]
                    median_distance = float(
                        np.median(
                            np.linalg.norm(
                                pixels - palette[thread_index, :3],
                                axis=1,
                            )
                        )
                    )
                    median_luminance = float(np.median(source_luminance[hole_mask]))
                    if (
                        median_distance <= 85.0
                        and median_luminance
                        <= min(145.0, palette_luminance[thread_index] + 70.0)
                    ):
                        cleaned[hole_mask] = thread_index
        return cleaned

    @staticmethod
    def _absorb_near_color_enclosure_rims(
        thread_map: np.ndarray,
        subject_mask: np.ndarray,
        palette_rgb: np.ndarray,
    ) -> np.ndarray:
        """Merge antialias color rings back into the surrounding base color."""
        cleaned = np.asarray(thread_map, dtype=np.int32).copy()
        subject = np.asarray(subject_mask, dtype=bool)
        palette = np.asarray(palette_rgb, dtype=np.float64)
        max_area = max(256, int(round(cleaned.size * 0.025)))
        kernel = np.ones((5, 5), dtype=np.uint8)
        luminance = (
            palette[:, 0] * 0.299
            + palette[:, 1] * 0.587
            + palette[:, 2] * 0.114
        )

        for thread_index in np.unique(cleaned[subject]):
            thread_index = int(thread_index)
            if thread_index < 0 or thread_index >= len(palette):
                continue
            label_mask = ((cleaned == thread_index) & subject).astype(np.uint8)
            component_count, components, stats, _ = (
                cv2.connectedComponentsWithStats(label_mask, connectivity=8)
            )
            for component_id in range(1, component_count):
                area = int(stats[component_id, cv2.CC_STAT_AREA])
                if area < 8 or area > max_area:
                    continue
                component = components == component_id
                contours, hierarchy = cv2.findContours(
                    component.astype(np.uint8),
                    cv2.RETR_CCOMP,
                    cv2.CHAIN_APPROX_SIMPLE,
                )
                if hierarchy is None:
                    continue
                hole_indices = [
                    index
                    for index in range(len(contours))
                    if hierarchy[0][index][3] >= 0
                ]
                if not hole_indices:
                    continue

                hole_mask = np.zeros(cleaned.shape, dtype=np.uint8)
                cv2.drawContours(
                    hole_mask,
                    [contours[index] for index in hole_indices],
                    -1,
                    1,
                    thickness=-1,
                )
                enclosed = cleaned[(hole_mask > 0) & ~component]
                enclosed = enclosed[
                    (enclosed >= 0) & (enclosed < len(palette))
                ]
                if not enclosed.size or not np.any(
                    luminance[thread_index] - luminance[enclosed] >= 45.0
                ):
                    continue

                neighborhood = cv2.dilate(
                    component.astype(np.uint8),
                    kernel,
                    iterations=1,
                ).astype(bool)
                neighborhood &= ~component
                neighborhood &= subject
                neighbors = cleaned[neighborhood]
                neighbors = neighbors[
                    (neighbors >= 0)
                    & (neighbors < len(palette))
                    & (neighbors != thread_index)
                ]
                if not neighbors.size:
                    continue
                values, counts = np.unique(neighbors, return_counts=True)
                related = [
                    (int(count), int(value))
                    for value, count in zip(values, counts)
                    if float(
                        np.linalg.norm(
                            palette[int(value)] - palette[thread_index]
                        )
                    )
                    <= 18.0
                ]
                if not related:
                    continue
                replacement = max(related, key=lambda item: item[0])[1]
                cleaned[component] = replacement

        return cleaned

    @staticmethod
    def detect_primary_subject(image: np.ndarray) -> np.ndarray:
        """Estimate the main centered subject without depending on a model."""
        rgb = np.asarray(image)
        if rgb.ndim != 3 or rgb.shape[2] < 3 or min(rgb.shape[:2]) < 16:
            return np.ones(rgb.shape[:2], dtype=bool)

        height, width = rgb.shape[:2]
        scale = min(
            1.0,
            RecognitionEngine._SUBJECT_GRABCUT_MAX_SIDE / max(height, width),
        )
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
                RecognitionEngine._SUBJECT_GRABCUT_ITERATIONS,
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
    def _quantize_design(
        cls,
        image: np.ndarray,
        detail_mask: np.ndarray,
        budget: int,
        antialias_mask: Optional[np.ndarray] = None,
    ) -> Tuple[np.ndarray, np.ndarray, Tuple[int, ...]]:
        height, width = image.shape[:2]
        pixels_rgb = image.reshape(-1, 3)
        pixels_lab = rgb2lab(image.astype(np.float64) / 255.0).reshape(-1, 3)
        flat_detail = np.asarray(detail_mask, dtype=bool).reshape(-1)
        packed = (
            (pixels_rgb[:, 0].astype(np.uint32) << 16)
            | (pixels_rgb[:, 1].astype(np.uint32) << 8)
            | pixels_rgb[:, 2].astype(np.uint32)
        )
        weights = cls._sampling_weights(
            image,
            antialias_mask=antialias_mask,
        ).reshape(-1)
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
            weights[base_selector],
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
                weights[flat_detail],
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
            tuple(
                sorted(
                    int(remap[index])
                    for index in range(base_centers.shape[0], cluster_count)
                )
            )
            if detail_count > 0
            else ()
        )
        design_map = remap[labels].reshape(height, width).astype(np.int32)
        return design_map, centers_rgb[order], detail_design_ids

    @classmethod
    def _recognition_color_budget(cls, image: np.ndarray, settings) -> int:
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

    @classmethod
    def _design_color_budget(cls, image: np.ndarray, settings) -> int:
        explicit = int(getattr(settings, "design_color_budget", 0))
        if explicit > 0:
            return int(np.clip(explicit, 2, 128))

        height, width = image.shape[:2]
        scale = min(1.0, 256.0 / max(height, width))
        if scale < 1.0:
            sample = cv2.resize(
                image,
                (max(1, round(width * scale)), max(1, round(height * scale))),
                interpolation=cv2.INTER_AREA,
            )
        else:
            sample = image

        gray = cv2.cvtColor(sample, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 120) > 0
        edge_guard = cv2.dilate(
            edges.astype(np.uint8),
            np.ones((5, 5), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        smooth = cv2.GaussianBlur(sample.astype(np.float32), (0, 0), 1.2)
        residual = np.linalg.norm(sample.astype(np.float32) - smooth, axis=2)
        interior = residual[~edge_guard]
        if not interior.size:
            interior = residual.reshape(-1)
        texture_median = float(np.median(interior))
        texture_p90 = float(np.percentile(interior, 90))

        quantized = np.asarray(
            Image.fromarray(sample, mode="RGB")
            .quantize(
                colors=32,
                method=Image.Quantize.MEDIANCUT,
                dither=Image.Dither.NONE,
            )
            .convert("RGB")
        )
        reconstruction_error = float(
            np.mean(
                np.linalg.norm(
                    sample.astype(np.float32) - quantized.astype(np.float32),
                    axis=2,
                )
            )
        )

        # Sharp cartoon boundaries are not photographic texture.  Use the
        # interiors plus a small-palette reconstruction to tell them apart.
        if reconstruction_error < 8.0 and texture_p90 < 5.0:
            return 24
        if (
            reconstruction_error < 18.0
            and texture_median < 2.75
            and texture_p90 < 8.0
        ):
            return 32
        if reconstruction_error < 23.0 and texture_median < 4.5:
            return 48
        if reconstruction_error < 28.0 and texture_median < 6.5:
            return 64
        if reconstruction_error < 36.0 and texture_median < 9.0:
            return 96
        return 128

    @classmethod
    def _stitch_design_color_budget(cls, image: np.ndarray, settings) -> int:
        """Keep the production palette practical without weakening recognition."""
        detected_budget = cls._design_color_budget(image, settings)
        if (
            not bool(getattr(settings, "auto_design_colors", True))
            or int(getattr(settings, "design_color_budget", 0)) > 0
        ):
            return detected_budget

        requested_threads = max(2, int(getattr(settings, "n_colors", 12)))
        # Fine lines need a small reserve beyond the requested spools, but a
        # flat illustration must not turn every antialias shade into another
        # embroidery color change.
        detail_reserve = min(4, max(2, requested_threads // 3))
        return min(detected_budget, requested_threads + detail_reserve)

    @staticmethod
    def _constrain_semantic_part_threads(
        parts: Tuple[SemanticPart, ...],
        thread_map: np.ndarray,
        palette_rgb: np.ndarray,
    ) -> Tuple[SemanticPart, ...]:
        """Keep semantic detail on the same physical palette as the design."""
        used = np.unique(np.asarray(thread_map, dtype=np.int32))
        used = used[(used >= 0) & (used < len(palette_rgb))]
        if not len(used):
            return tuple(parts)

        usable_palette = np.asarray(palette_rgb[used, :3], dtype=np.float64)
        constrained = []
        for part in parts:
            if (
                part.role in {"eye_outline", "mouth_outline"}
                and part.thread_index in set(used.tolist())
            ):
                # Canonical facial guides are already assigned by the feature
                # restorer. Do not remap a confirmed black outline to a nearby
                # brown thread simply because it is marginally closer in RGB.
                constrained.append(part)
                continue
            source = np.asarray(part.source_color_rgb, dtype=np.float64)
            distances = np.sum((usable_palette - source) ** 2, axis=1)
            nearest = int(used[int(np.argmin(distances))])
            if part.thread_index == nearest:
                constrained.append(part)
            else:
                constrained.append(replace(part, thread_index=nearest))
        return tuple(constrained)

    @staticmethod
    def _sampling_weights(
        image: np.ndarray,
        antialias_mask: Optional[np.ndarray] = None,
    ) -> np.ndarray:
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
        if antialias_mask is not None:
            aliases = np.asarray(antialias_mask, dtype=bool)
            if aliases.shape != weights.shape:
                raise ValueError("Antialias mask must match image dimensions")
            # Still sample transition pixels so colors meet cleanly, but do not
            # let their high edge/rarity score create a separate design color.
            weights[aliases] *= 0.18
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
        background_weight: float = 0.35,
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
            weighted_counts = (
                subject_counts * 4.0
                + background_counts * max(0.0, float(background_weight))
            )
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

    @classmethod
    def extract_observed_detail_mask(
        cls,
        image: np.ndarray,
        support_mask: Optional[np.ndarray] = None,
        sensitivity: float = 0.65,
    ) -> np.ndarray:
        """Measure visible detail independently from the source detail mask."""
        rgb = np.asarray(image, dtype=np.uint8)
        observed = cls.detect_fine_details(
            rgb,
            sensitivity=sensitivity,
        )
        gray = cv2.cvtColor(rgb[:, :, :3], cv2.COLOR_RGB2GRAY)
        sensitivity = float(np.clip(sensitivity, 0.0, 1.0))
        low = max(6, int(round(20.0 * (1.15 - sensitivity))))
        high = max(low + 8, int(round(low * 2.8)))
        visible_edges = cv2.Canny(gray, low, high, L2gradient=True) > 0
        observed |= visible_edges
        if support_mask is None:
            return observed
        support = np.asarray(support_mask, dtype=bool)
        if support.shape != observed.shape:
            raise ValueError("Detail support mask must match image dimensions")
        return observed & support

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
