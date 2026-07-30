"""Structured visual parts shared by recognition and stitch generation."""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
import heapq
from typing import Iterable, Mapping, Optional, Sequence, Tuple

import cv2
import numpy as np
from skimage.morphology import skeletonize

from .contour_geometry import (
    adaptive_closed_contour,
    detect_locked_corner_indices,
)


Point = Tuple[float, float]
Path = Tuple[Point, ...]


class SemanticPartKind(str, Enum):
    CLOSED_CONTOUR = "closed_contour"
    OPEN_LINE = "open_line"
    COMPACT_FILL = "compact_fill"
    PROTECTED_HIGHLIGHT = "protected_highlight"


@dataclass(frozen=True)
class SemanticPart:
    part_id: str
    kind: SemanticPartKind
    role: str
    design_color_id: int
    source_color_rgb: Tuple[int, int, int]
    thread_index: Optional[int]
    mask: np.ndarray
    paths: Tuple[Path, ...]
    hole_paths: Tuple[Path, ...] = ()
    locked_corner_indices: Tuple[int, ...] = ()
    parent_id: Optional[str] = None
    z_order: int = 0
    confidence: float = 1.0
    detail_confidence: float = 0.0
    subject_confidence: float = 0.0
    stitch_intent: str = "run"

    @property
    def area(self) -> int:
        return int(np.count_nonzero(self.mask))

    @property
    def centroid(self) -> Point:
        ys, xs = np.where(self.mask)
        if not xs.size:
            return (0.0, 0.0)
        return (float(np.mean(xs)), float(np.mean(ys)))


class SemanticPartExtractor:
    """Extract topology-preserving visual parts before thread substitution."""

    def __init__(self, max_parts: int = 256, max_points_per_path: int = 512):
        self.max_parts = max(1, int(max_parts))
        self.max_points_per_path = max(16, int(max_points_per_path))

    def extract(
        self,
        *,
        image: np.ndarray,
        design_map: np.ndarray,
        design_colors,
        detail_mask: np.ndarray,
        subject_mask: np.ndarray,
        thread_matches: Optional[Mapping[int, int]] = None,
    ) -> Tuple[SemanticPart, ...]:
        source = np.asarray(image, dtype=np.uint8)
        labels = np.asarray(design_map)
        detail = np.asarray(detail_mask, dtype=bool)
        subject = np.asarray(subject_mask, dtype=bool)
        if (
            source.ndim != 3
            or source.shape[:2] != labels.shape
            or detail.shape != labels.shape
            or subject.shape != labels.shape
        ):
            return ()

        colors = self._color_lookup(design_colors)
        threads = dict(thread_matches or {})
        candidates = []
        image_area = labels.size
        grouped_ids = {}
        for design_id in sorted(int(value) for value in np.unique(labels)):
            color = colors.get(design_id)
            if color is None:
                pixels = source[labels == design_id, :3]
                if not pixels.size:
                    continue
                color = tuple(
                    int(round(value)) for value in np.median(pixels, axis=0)
                )
            thread_index = threads.get(design_id)
            key = (
                ("thread-color", thread_index, tuple(color))
                if thread_index is not None
                else ("design", design_id)
            )
            grouped_ids.setdefault(key, []).append((design_id, tuple(color)))

        for grouped in grouped_ids.values():
            design_ids = [item[0] for item in grouped]
            binary = np.isin(labels, design_ids).astype(np.uint8)
            pixel_counts = [
                int(np.count_nonzero(labels == design_id))
                for design_id in design_ids
            ]
            dominant_index = int(np.argmax(pixel_counts))
            design_id, color = grouped[dominant_index]
            thread_index = threads.get(design_id)
            count, components, stats, _ = cv2.connectedComponentsWithStats(
                binary,
                connectivity=8,
            )
            for component_id in range(1, count):
                area = int(stats[component_id, cv2.CC_STAT_AREA])
                if area < 2 or area > int(image_area * 0.48):
                    continue
                component = components == component_id
                subject_ratio = float(np.mean(subject[component]))
                detail_ratio = float(np.mean(detail[component]))
                if subject_ratio < 0.05 and detail_ratio < 0.25:
                    continue
                if self._is_tiny_antialias_blend(
                    component,
                    color=color,
                    labels=labels,
                    colors=colors,
                    excluded_design_ids=design_ids,
                ):
                    continue
                part = self._build_part(
                    component,
                    design_id=design_id,
                    color=color,
                    thread_index=thread_index,
                    sequence=len(candidates),
                    detail_ratio=detail_ratio,
                    subject_ratio=subject_ratio,
                )
                if part is not None:
                    priority = (
                        detail_ratio * 4.0
                        + subject_ratio
                        + 1.0 / max(1.0, np.sqrt(area))
                    )
                    candidates.append((priority, part))

        candidates.sort(key=lambda item: (-item[0], item[1].part_id))
        parts = [part for _, part in candidates[: self.max_parts]]
        parts = list(self._merge_same_thread_line_parts(source, detail, parts))
        parts = list(self._suppress_redundant_same_thread_fragments(parts))
        parts = list(self._assign_nested_parents(parts))
        parts = list(self._assign_highlight_parents(parts))
        parts.extend(
            self._recover_nested_highlights(
                source,
                labels,
                colors,
                threads,
                parts,
            )
        )
        parts.sort(key=lambda item: (item.z_order, item.part_id))
        return tuple(parts[: self.max_parts])

    @staticmethod
    def _is_tiny_antialias_blend(
        component: np.ndarray,
        *,
        color: Tuple[int, int, int],
        labels: np.ndarray,
        colors: Mapping[int, Tuple[int, int, int]],
        excluded_design_ids: Sequence[int],
    ) -> bool:
        """Reject tiny boundary colors explained by a blend of two neighbors."""
        area = int(np.count_nonzero(component))
        max_area = max(12, int(round(labels.size * 0.0002)))
        if area > max_area:
            return False

        ring = cv2.dilate(
            component.astype(np.uint8),
            np.ones((5, 5), dtype=np.uint8),
            iterations=1,
        ).astype(bool)
        ring &= ~component
        neighbor_labels = labels[ring]
        if not neighbor_labels.size:
            return False

        excluded = {int(value) for value in excluded_design_ids}
        values, counts = np.unique(neighbor_labels, return_counts=True)
        ranked = sorted(
            (
                (int(count), int(value))
                for value, count in zip(values, counts)
                if int(value) not in excluded and int(value) in colors
            ),
            reverse=True,
        )
        neighbor_colors = []
        for _, design_id in ranked[:6]:
            candidate = np.asarray(colors[design_id], dtype=np.float64)
            if any(
                np.linalg.norm(candidate - existing) < 4.0
                for existing in neighbor_colors
            ):
                continue
            neighbor_colors.append(candidate)
        if len(neighbor_colors) < 2:
            return False

        mixed = np.asarray(color, dtype=np.float64)
        for index, start in enumerate(neighbor_colors[:-1]):
            for end in neighbor_colors[index + 1 :]:
                direction = end - start
                length_squared = float(np.dot(direction, direction))
                if length_squared < 64.0:
                    continue
                ratio = float(np.dot(mixed - start, direction) / length_squared)
                if ratio <= 0.05 or ratio >= 0.95:
                    continue
                projected = start + direction * ratio
                residual = float(np.linalg.norm(mixed - projected))
                endpoint_distance = min(
                    float(np.linalg.norm(mixed - start)),
                    float(np.linalg.norm(mixed - end)),
                )
                if residual <= 18.0 and endpoint_distance >= 8.0:
                    return True
        return False

    def _merge_same_thread_line_parts(
        self,
        source: np.ndarray,
        detail_mask: np.ndarray,
        parts: Sequence[SemanticPart],
    ) -> Tuple[SemanticPart, ...]:
        """Rejoin antialiased fragments that resolve to one physical thread."""
        by_thread = {}
        for part in parts:
            if (
                part.kind == SemanticPartKind.OPEN_LINE
                and part.thread_index is not None
            ):
                by_thread.setdefault(part.thread_index, []).append(part)

        removed = set()
        merged_parts = []
        kernel = np.ones((3, 3), dtype=np.uint8)
        for thread_index, candidates in by_thread.items():
            if len(candidates) < 2:
                continue
            union = np.zeros(source.shape[:2], dtype=np.uint8)
            for candidate in candidates:
                union[np.asarray(candidate.mask, dtype=bool)] = 1

            # Close only one-pixel gaps that the source detail detector also
            # supports. This reconnects antialias shades without bridging
            # unrelated nearby marks.
            closed = cv2.morphologyEx(union, cv2.MORPH_CLOSE, kernel)
            supported_bridge = (
                (closed > 0)
                & (union == 0)
                & np.asarray(detail_mask, dtype=bool)
            )
            supported = union.copy()
            supported[supported_bridge] = 1
            count, labels = cv2.connectedComponents(supported, connectivity=8)
            for component_id in range(1, count):
                component = labels == component_id
                contributors = [
                    part
                    for part in candidates
                    if np.any(component & np.asarray(part.mask, dtype=bool))
                ]
                if len(contributors) < 2:
                    continue
                dominant = max(contributors, key=lambda part: part.area)
                pixels = source[component, :3]
                color = tuple(
                    int(round(value))
                    for value in np.median(pixels.astype(np.float64), axis=0)
                )
                merged = self._build_part(
                    component,
                    design_id=dominant.design_color_id,
                    color=color,
                    thread_index=thread_index,
                    sequence=len(merged_parts),
                    detail_ratio=max(
                        part.detail_confidence for part in contributors
                    ),
                    subject_ratio=max(
                        part.subject_confidence for part in contributors
                    ),
                )
                if merged is None or merged.kind != SemanticPartKind.OPEN_LINE:
                    continue
                contributor_ids = sorted(part.part_id for part in contributors)
                merged_parts.append(
                    replace(
                        merged,
                        part_id=(
                            f"t{thread_index}-line-"
                            f"{contributor_ids[0]}-{len(contributor_ids)}"
                        ),
                        confidence=max(part.confidence for part in contributors),
                    )
                )
                removed.update(contributor_ids)

        result = [part for part in parts if part.part_id not in removed]
        result.extend(merged_parts)
        return tuple(sorted(result, key=lambda item: (item.z_order, item.part_id)))

    def _suppress_redundant_same_thread_fragments(
        self,
        parts: Sequence[SemanticPart],
    ) -> Tuple[SemanticPart, ...]:
        """Drop antialias rims already represented by a larger same-thread part."""
        containers = [
            part
            for part in parts
            if (
                part.thread_index is not None
                and part.kind in (
                    SemanticPartKind.COMPACT_FILL,
                    SemanticPartKind.CLOSED_CONTOUR,
                )
            )
        ]
        dilated = {}
        retained = []
        for part in parts:
            if (
                part.thread_index is None
                or part.kind not in (
                    SemanticPartKind.OPEN_LINE,
                    SemanticPartKind.CLOSED_CONTOUR,
                )
            ):
                retained.append(part)
                continue
            redundant = False
            candidate_mask = np.asarray(part.mask, dtype=bool)
            for parent in containers:
                if (
                    parent.part_id == part.part_id
                    or parent.thread_index != part.thread_index
                    or parent.area < part.area * 6
                ):
                    continue
                parent_neighborhood = dilated.get(parent.part_id)
                if parent_neighborhood is None:
                    parent_neighborhood = cv2.dilate(
                        np.asarray(parent.mask, dtype=np.uint8),
                        np.ones((3, 3), dtype=np.uint8),
                        iterations=1,
                    ).astype(bool)
                    dilated[parent.part_id] = parent_neighborhood
                overlap = np.count_nonzero(
                    candidate_mask & parent_neighborhood
                ) / max(1, part.area)
                if overlap >= 0.92:
                    redundant = True
                    break
            if not redundant:
                retained.append(part)
        return tuple(retained)

    def _assign_nested_parents(
        self,
        parts: Sequence[SemanticPart],
    ) -> Tuple[SemanticPart, ...]:
        """Preserve painter order for pupils, tongues, and other nested fills."""
        containers = [
            part
            for part in parts
            if part.kind in (
                SemanticPartKind.COMPACT_FILL,
                SemanticPartKind.CLOSED_CONTOUR,
            )
            and part.paths
        ]
        result = []
        for part in parts:
            possible = []
            for parent in containers:
                if parent.part_id == part.part_id:
                    continue
                if parent.area <= part.area * 1.15:
                    continue
                if not self._contains_point(parent.paths[0], part.centroid):
                    continue
                possible.append(parent)
            if possible:
                parent = min(possible, key=lambda item: item.area)
                part = replace(
                    part,
                    parent_id=parent.part_id,
                    z_order=max(part.z_order, parent.z_order + 1),
                )
            result.append(part)
        return tuple(sorted(result, key=lambda item: (item.z_order, item.part_id)))

    def _build_part(
        self,
        component: np.ndarray,
        *,
        design_id: int,
        color: Tuple[int, int, int],
        thread_index: Optional[int],
        sequence: int,
        detail_ratio: float,
        subject_ratio: float,
    ) -> Optional[SemanticPart]:
        mask_u8 = component.astype(np.uint8)
        contours, hierarchy = cv2.findContours(
            mask_u8,
            cv2.RETR_CCOMP,
            cv2.CHAIN_APPROX_NONE,
        )
        if not contours:
            return None
        outer_indices = [
            index
            for index in range(len(contours))
            if hierarchy is None or hierarchy[0][index][3] < 0
        ]
        if not outer_indices:
            return None
        outer_index = max(outer_indices, key=lambda index: cv2.contourArea(contours[index]))
        outer = contours[outer_index][:, 0, :].astype(np.float64)
        if len(outer) < 2:
            return None

        ys, xs = np.where(component)
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        bbox_area = max(1, width * height)
        fill_ratio = float(np.count_nonzero(component)) / bbox_area
        distance = cv2.distanceTransform(mask_u8, cv2.DIST_L2, 5)
        stroke_width = float(distance.max() * 2.0)
        elongation = max(width, height) / max(1, min(width, height))
        hole_contours = self._child_contours(contours, hierarchy, outer_index)

        is_open_line = (
            not hole_contours
            and max(width, height) >= 5
            and stroke_width <= 4.2
            and (elongation >= 1.35 or fill_ratio <= 0.34)
        )
        if is_open_line:
            open_path = self._trace_open_component(component)
            if len(open_path) < 2:
                return None
            kind = SemanticPartKind.OPEN_LINE
            paths = (open_path,)
            holes: Tuple[Path, ...] = ()
            locked = ()
            role = "line_detail"
            stitch_intent = "continuous_run"
            z_order = 40
        else:
            outer_path, locked = self._closed_path(outer)
            if len(outer_path) < 4:
                return None
            paths = (outer_path,)
            holes = tuple(
                path
                for path, _ in (
                    self._closed_path(contour[:, 0, :].astype(np.float64))
                    for contour in hole_contours
                )
                if len(path) >= 4
            )
            is_compact = fill_ratio >= 0.68 or (
                not hole_contours
                and fill_ratio >= 0.58
                and stroke_width >= 5.0
            )
            kind = (
                SemanticPartKind.COMPACT_FILL
                if is_compact
                else SemanticPartKind.CLOSED_CONTOUR
            )
            if kind == SemanticPartKind.COMPACT_FILL:
                role = "compact_feature"
                stitch_intent = "compact_fill"
                z_order = 20
                locked = ()
            else:
                role = "feature_outline"
                stitch_intent = "adaptive_closed_run"
                z_order = 30

        immutable_mask = np.array(component, dtype=bool, copy=True)
        immutable_mask.setflags(write=False)
        confidence = float(
            np.clip(0.35 + 0.35 * detail_ratio + 0.3 * subject_ratio, 0.0, 1.0)
        )
        return SemanticPart(
            part_id=f"d{design_id}-c{sequence}",
            kind=kind,
            role=role,
            design_color_id=design_id,
            source_color_rgb=tuple(int(channel) for channel in color),
            thread_index=thread_index,
            mask=immutable_mask,
            paths=paths,
            hole_paths=holes,
            locked_corner_indices=locked,
            z_order=z_order,
            confidence=confidence,
            detail_confidence=float(detail_ratio),
            subject_confidence=float(subject_ratio),
            stitch_intent=stitch_intent,
        )

    def _closed_path(self, contour: np.ndarray) -> Tuple[Path, Tuple[int, ...]]:
        anchors = detect_locked_corner_indices(contour)
        geometry = contour
        if not anchors:
            perimeter = float(
                cv2.arcLength(
                    contour.astype(np.float32).reshape(-1, 1, 2),
                    True,
                )
            )
            approximated = cv2.approxPolyDP(
                contour.astype(np.float32).reshape(-1, 1, 2),
                max(0.6, perimeter * 0.004),
                True,
            )[:, 0, :].astype(np.float64)
            supported = detect_locked_corner_indices(
                approximated,
                support=1,
                min_deflection_degrees=55.0,
                min_support_length=2.0,
            )
            if supported and len(approximated) <= 24:
                geometry = approximated
                anchors = supported
        if anchors and geometry is not contour:
            rebuilt = self._resample_closed_edges(geometry, 1.25)
        else:
            rebuilt = adaptive_closed_contour(
                geometry,
                spacing_px=1.25,
                smoothing_iterations=1,
            )
        rebuilt = self._limit_path(rebuilt, closed=True)
        if not rebuilt:
            return (), ()
        locked_output = []
        path_array = np.asarray(rebuilt[:-1], dtype=np.float64)
        for anchor_index in anchors:
            anchor = geometry[anchor_index]
            locked_output.append(
                int(np.argmin(np.linalg.norm(path_array - anchor, axis=1)))
            )
        return tuple(rebuilt), tuple(sorted(set(locked_output)))

    @staticmethod
    def _resample_closed_edges(points: np.ndarray, spacing: float) -> list[Point]:
        output = []
        for index, start in enumerate(points):
            end = points[(index + 1) % len(points)]
            length = float(np.linalg.norm(end - start))
            count = max(1, int(np.ceil(length / max(0.1, spacing))))
            for step in range(count):
                ratio = step / count
                point = start + (end - start) * ratio
                output.append((float(point[0]), float(point[1])))
        if output:
            output.append(output[0])
        return output

    def _trace_open_component(self, component: np.ndarray) -> Path:
        skeleton = skeletonize(component).astype(np.uint8)
        coords = [tuple(int(value) for value in point) for point in np.argwhere(skeleton)]
        if len(coords) < 2:
            return ()
        nodes = set(coords)
        neighbors = {
            point: [
                candidate
                for candidate in self._neighbors(point)
                if candidate in nodes
            ]
            for point in nodes
        }
        endpoints = sorted(point for point, adjacent in neighbors.items() if len(adjacent) == 1)
        starts = endpoints if len(endpoints) >= 2 else sorted(nodes)[:1]
        best = ()
        for start in starts:
            distances, parents = self._graph_distances(start, neighbors)
            targets = endpoints if len(endpoints) >= 2 else distances
            target = max(targets, key=lambda point: distances.get(point, -1.0))
            path_yx = self._restore_graph_path(start, target, parents)
            if len(path_yx) > len(best):
                best = path_yx
        path_xy = [(float(x), float(y)) for y, x in best]
        if len(path_xy) >= 3:
            approximated = cv2.approxPolyDP(
                np.asarray(path_xy, dtype=np.float32).reshape(-1, 1, 2),
                0.55,
                False,
            )[:, 0, :]
            path_xy = [(float(x), float(y)) for x, y in approximated]
        return tuple(self._limit_path(path_xy, closed=False))

    def _assign_highlight_parents(
        self,
        parts: Sequence[SemanticPart],
    ) -> Tuple[SemanticPart, ...]:
        compact = [
            part for part in parts if part.kind == SemanticPartKind.COMPACT_FILL
        ]
        result = []
        for part in parts:
            luminance = self._luminance(part.source_color_rgb)
            possible = []
            for parent in compact:
                if parent.part_id == part.part_id or part.area > parent.area * 0.24:
                    continue
                if luminance - self._luminance(parent.source_color_rgb) < 90.0:
                    continue
                if not self._contains_point(parent.paths[0], part.centroid):
                    continue
                possible.append(parent)
            if possible:
                parent = min(possible, key=lambda item: item.area)
                part = replace(
                    part,
                    kind=SemanticPartKind.PROTECTED_HIGHLIGHT,
                    role="highlight",
                    parent_id=parent.part_id,
                    z_order=parent.z_order + 1,
                    stitch_intent="protected_highlight",
                    locked_corner_indices=(),
                )
            result.append(part)
        return tuple(sorted(result, key=lambda item: (item.z_order, item.part_id)))

    def _recover_nested_highlights(
        self,
        source: np.ndarray,
        labels: np.ndarray,
        colors: Mapping[int, Tuple[int, int, int]],
        threads: Mapping[int, int],
        parts: Sequence[SemanticPart],
    ) -> list[SemanticPart]:
        """Recover tiny bright islands hidden by a connected quantized component."""
        luminance = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2GRAY)
        existing = [
            part
            for part in parts
            if part.kind == SemanticPartKind.PROTECTED_HIGHLIGHT
        ]
        recovered = []
        for parent in parts:
            if parent.kind == SemanticPartKind.OPEN_LINE:
                continue
            if self._luminance(parent.source_color_rgb) > 80.0:
                continue
            if parent.area < 8 or parent.area > int(labels.size * 0.03):
                continue
            ys, xs = np.where(parent.mask)
            width = int(np.ptp(xs) + 1)
            height = int(np.ptp(ys) + 1)
            elongation = max(width, height) / max(1, min(width, height))
            if elongation > 1.8:
                continue

            interior = np.zeros(labels.shape, dtype=np.uint8)
            contour = np.rint(np.asarray(parent.paths[0])).astype(np.int32)
            contour = cv2.convexHull(contour.reshape(-1, 1, 2))
            cv2.fillPoly(interior, [contour], 1)
            candidate = (
                (interior > 0)
                & ~np.asarray(parent.mask, dtype=bool)
                & (luminance >= 242)
            ).astype(np.uint8)
            count, components, stats, _ = cv2.connectedComponentsWithStats(
                candidate,
                connectivity=8,
            )
            component_ids = sorted(
                range(1, count),
                key=lambda component_id: int(
                    stats[component_id, cv2.CC_STAT_AREA]
                ),
                reverse=True,
            )
            highlight_index = 0
            for component_id in component_ids:
                area = int(stats[component_id, cv2.CC_STAT_AREA])
                if area < 2 or area > max(24, int(parent.area * 0.30)):
                    continue
                component = components == component_id
                if any(
                    np.count_nonzero(component & np.asarray(item.mask, dtype=bool))
                    / max(1, area)
                    >= 0.70
                    for item in (*existing, *recovered)
                ):
                    continue
                component_labels = labels[component].astype(np.int64)
                if not component_labels.size:
                    continue
                design_id = int(
                    np.bincount(component_labels).argmax()
                )
                color = colors.get(design_id)
                if color is None:
                    color = tuple(
                        int(round(value))
                        for value in np.median(source[component, :3], axis=0)
                    )
                built = self._build_part(
                    component,
                    design_id=design_id,
                    color=color,
                    thread_index=threads.get(design_id),
                    sequence=highlight_index,
                    detail_ratio=1.0,
                    subject_ratio=parent.subject_confidence,
                )
                if built is None:
                    continue
                highlight_index += 1
                recovered.append(
                    replace(
                        built,
                        part_id=f"{parent.part_id}-h{highlight_index}",
                        kind=SemanticPartKind.PROTECTED_HIGHLIGHT,
                        role="highlight",
                        parent_id=parent.part_id,
                        z_order=parent.z_order + 1,
                        stitch_intent="protected_highlight",
                        locked_corner_indices=(),
                    )
                )
                break
        return recovered

    def _limit_path(self, points: Iterable[Point], *, closed: bool) -> list[Point]:
        path = list(points)
        if not path:
            return []
        reserve = 1 if closed and path[0] == path[-1] else 0
        core = path[:-1] if reserve else path
        if len(core) > self.max_points_per_path:
            indices = np.linspace(
                0,
                len(core) - 1,
                self.max_points_per_path,
            ).round().astype(np.int32)
            core = [core[int(index)] for index in indices]
        if closed and core and core[0] != core[-1]:
            core.append(core[0])
        return [
            (float(point[0]), float(point[1]))
            for point in core
        ]

    @staticmethod
    def _child_contours(contours, hierarchy, parent_index):
        if hierarchy is None:
            return []
        return [
            contours[index]
            for index in range(len(contours))
            if hierarchy[0][index][3] == parent_index
        ]

    @staticmethod
    def _color_lookup(design_colors) -> dict[int, Tuple[int, int, int]]:
        if isinstance(design_colors, Mapping):
            return {
                int(key): tuple(int(channel) for channel in value)
                for key, value in design_colors.items()
            }
        result = {}
        for item in design_colors:
            design_id = int(getattr(item, "design_id"))
            color = getattr(item, "color_rgb")
            result[design_id] = tuple(int(channel) for channel in color)
        return result

    @staticmethod
    def _neighbors(point):
        y, x = point
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx or dy:
                    yield (y + dy, x + dx)

    @staticmethod
    def _graph_distances(start, neighbors):
        distances = {start: 0.0}
        parents = {}
        pending = [(0.0, start)]
        while pending:
            distance, current = heapq.heappop(pending)
            if distance > distances.get(current, float("inf")):
                continue
            cy, cx = current
            for adjacent in neighbors[current]:
                ay, ax = adjacent
                candidate = distances[current] + float(np.hypot(ax - cx, ay - cy))
                if candidate >= distances.get(adjacent, float("inf")):
                    continue
                distances[adjacent] = candidate
                parents[adjacent] = current
                heapq.heappush(pending, (candidate, adjacent))
        return distances, parents

    @staticmethod
    def _restore_graph_path(start, target, parents):
        path = [target]
        while path[-1] != start and path[-1] in parents:
            path.append(parents[path[-1]])
        path.reverse()
        return tuple(path)

    @staticmethod
    def _luminance(color):
        return float(0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2])

    @staticmethod
    def _contains_point(path: Path, point: Point) -> bool:
        contour = np.asarray(path, dtype=np.float32).reshape(-1, 1, 2)
        return cv2.pointPolygonTest(contour, point, False) >= 0
