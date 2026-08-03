"""Local contour smoothing that preserves stable sharp corners."""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np


_EPSILON = 1e-6


def normalize_closed_contour(points) -> np.ndarray:
    """Return finite, distinct contour vertices without a closing duplicate."""
    try:
        array = np.asarray(points, dtype=np.float64)
    except (TypeError, ValueError):
        return np.empty((0, 2), dtype=np.float64)

    if array.size == 0:
        return np.empty((0, 2), dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != 2:
        return np.empty((0, 2), dtype=np.float64)

    array = array[np.isfinite(array).all(axis=1)]
    if len(array) > 1 and np.allclose(array[0], array[-1]):
        array = array[:-1]
    if len(array) == 0:
        return array

    keep = np.ones(len(array), dtype=bool)
    keep[1:] = np.linalg.norm(np.diff(array, axis=0), axis=1) > _EPSILON
    return array[keep]


def detect_locked_corner_indices(
    points,
    support=3,
    min_deflection_degrees=55.0,
    min_support_length=3.0,
) -> tuple[int, ...]:
    """Find locally supported, high-deflection vertices in a closed contour."""
    contour = normalize_closed_contour(points)
    try:
        support = max(1, int(support))
        min_deflection_degrees = float(min_deflection_degrees)
        min_support_length = max(0.0, float(min_support_length))
    except (TypeError, ValueError, OverflowError):
        return ()

    if (
        not np.isfinite(min_deflection_degrees)
        or not np.isfinite(min_support_length)
        or len(contour) < support * 2 + 3
    ):
        return ()

    scores = np.zeros(len(contour), dtype=np.float64)
    for index, current in enumerate(contour):
        previous = contour[(index - support) % len(contour)]
        following = contour[(index + support) % len(contour)]
        incoming = previous - current
        outgoing = following - current
        left = float(np.linalg.norm(incoming))
        right = float(np.linalg.norm(outgoing))
        if min(left, right) < min_support_length:
            continue

        immediate_left = float(
            np.linalg.norm(contour[(index - 1) % len(contour)] - current)
        )
        immediate_right = float(
            np.linalg.norm(contour[(index + 1) % len(contour)] - current)
        )
        if max(immediate_left, immediate_right) < min_support_length:
            continue

        cosine = np.clip(np.dot(incoming, outgoing) / (left * right), -1.0, 1.0)
        interior = float(np.degrees(np.arccos(cosine)))
        scores[index] = max(0.0, 180.0 - interior)

    candidates = [
        index
        for index, score in enumerate(scores)
        if score >= min_deflection_degrees
        and score >= scores[(index - 1) % len(scores)]
        and score >= scores[(index + 1) % len(scores)]
    ]
    return _merge_cyclic_candidates(candidates, scores, len(contour), radius=support)


def adaptive_closed_contour(
    points,
    spacing_px,
    smoothing_iterations=2,
    locked_corner_indices=None,
) -> list[tuple[float, float]]:
    """Smooth a closed contour while leaving locally stable anchors unchanged."""
    contour = normalize_closed_contour(points)
    if len(contour) < 3:
        return _as_tuples(contour)

    iterations = _nonnegative_int(smoothing_iterations)
    if locked_corner_indices is None:
        anchors = detect_locked_corner_indices(contour)
    else:
        anchors = tuple(
            sorted(
                {
                    int(index) % len(contour)
                    for index in locked_corner_indices
                    if isinstance(index, (int, np.integer))
                }
            )
        )
    if not anchors:
        smooth = _chaikin_closed(contour, iterations)
        return _close(_resample_closed(smooth, spacing_px))

    output: list[tuple[float, float]] = []
    for start, end in _cyclic_anchor_pairs(anchors):
        span = _cyclic_slice(contour, start, end)
        smooth_span = _chaikin_open(span, iterations)
        sampled = _resample_open(smooth_span, spacing_px)
        if output:
            sampled = sampled[1:]
        output.extend(sampled)
    return _close(output)


def _merge_cyclic_candidates(
    candidates: Sequence[int],
    scores: np.ndarray,
    size: int,
    radius: int,
) -> tuple[int, ...]:
    if not candidates or size <= 0:
        return ()

    ordered = sorted(candidates)
    groups = [[ordered[0]]]
    for candidate in ordered[1:]:
        if candidate - groups[-1][-1] <= radius:
            groups[-1].append(candidate)
        else:
            groups.append([candidate])
    if len(groups) > 1 and groups[0][0] + size - groups[-1][-1] <= radius:
        groups[0] = groups[-1] + groups[0]
        groups.pop()

    return tuple(sorted(max(group, key=lambda index: (scores[index], -index)) for group in groups))


def _cyclic_anchor_pairs(anchors: Sequence[int]) -> Iterable[tuple[int, int]]:
    for index, start in enumerate(anchors):
        yield start, anchors[(index + 1) % len(anchors)]


def _cyclic_slice(contour: np.ndarray, start: int, end: int) -> np.ndarray:
    if end > start:
        return contour[start : end + 1]
    return np.vstack((contour[start:], contour[: end + 1]))


def _chaikin_closed(contour: np.ndarray, iterations: int) -> np.ndarray:
    result = contour.copy()
    for _ in range(iterations):
        following = np.roll(result, -1, axis=0)
        result = np.empty((len(result) * 2, 2), dtype=np.float64)
        result[0::2] = 0.75 * contour + 0.25 * following
        result[1::2] = 0.25 * contour + 0.75 * following
        contour = result
    return result


def _chaikin_open(points: np.ndarray, iterations: int) -> np.ndarray:
    result = points.copy()
    for _ in range(iterations):
        if len(result) < 2:
            return result
        smoothed = np.empty((len(result) * 2, 2), dtype=np.float64)
        smoothed[0] = result[0]
        smoothed[-1] = result[-1]
        smoothed[1:-1:2] = 0.75 * result[:-1] + 0.25 * result[1:]
        smoothed[2:-1:2] = 0.25 * result[:-1] + 0.75 * result[1:]
        result = smoothed
    return result


def _resample_closed(contour: np.ndarray, spacing_px) -> list[tuple[float, float]]:
    if len(contour) < 2:
        return _as_tuples(contour)
    following = np.roll(contour, -1, axis=0)
    distances = np.linalg.norm(following - contour, axis=1)
    return _resample_segments(contour, distances, spacing_px, closed=True)


def _resample_open(points: np.ndarray, spacing_px) -> list[tuple[float, float]]:
    if len(points) < 2:
        return _as_tuples(points)
    distances = np.linalg.norm(np.diff(points, axis=0), axis=1)
    return _resample_segments(points, distances, spacing_px, closed=False)


def _resample_segments(
    points: np.ndarray,
    distances: np.ndarray,
    spacing_px,
    closed: bool,
) -> list[tuple[float, float]]:
    try:
        spacing = float(spacing_px)
    except (TypeError, ValueError):
        spacing = 0.0
    if not np.isfinite(spacing) or spacing <= _EPSILON:
        return _as_tuples(points)

    total = float(distances.sum())
    if total <= _EPSILON:
        return _as_tuples(points[:1])

    cumulative = np.concatenate(([0.0], np.cumsum(distances)))
    targets = list(np.arange(0.0, total, spacing))
    if targets and total - targets[-1] <= _EPSILON:
        targets.pop()
    if not closed or not targets:
        targets.append(total)

    result = []
    for target in targets:
        if total - target <= _EPSILON:
            point = points[0] if closed else points[-1]
            result.append((float(point[0]), float(point[1])))
            continue
        segment = min(np.searchsorted(cumulative, target, side="right") - 1, len(distances) - 1)
        segment = max(0, segment)
        length = distances[segment]
        if length <= _EPSILON:
            point = points[segment]
        else:
            ratio = (target - cumulative[segment]) / length
            point = points[segment] + ratio * (points[(segment + 1) % len(points)] - points[segment])
        result.append((float(point[0]), float(point[1])))
    return result


def _close(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    result = list(points)
    if len(result) > 1 and result[0] != result[-1]:
        result.append(result[0])
    return result


def _as_tuples(points: np.ndarray) -> list[tuple[float, float]]:
    return [(float(point[0]), float(point[1])) for point in points]


def _nonnegative_int(value) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return 0
