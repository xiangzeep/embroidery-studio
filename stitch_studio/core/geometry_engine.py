"""Reconstruct embroidery-ready vector geometry from raster region masks."""

from typing import Any, Optional

import numpy as np
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union
from skimage.measure import find_contours


class GeometryEngine:
    """Build complete region geometry without dropping islands or holes."""

    @staticmethod
    def reconstruct_region_polygon(
        mask: np.ndarray,
        compensation_px: float = 0.0,
        simplify: bool = True,
    ) -> Optional[Any]:
        binary = np.asarray(mask) > 0
        if not np.any(binary):
            return None

        # Padding closes contours that touch an image edge. The 0.5 level lies
        # on pixel boundaries, so isolated pixels and one-pixel lines remain
        # drawable geometry rather than collapsing to zero-area contours.
        padded = np.pad(binary, 1, mode="constant", constant_values=False)
        lines = []
        for contour in find_contours(padded.astype(np.uint8), level=0.5):
            coordinates = [
                (float(column - 1), float(row - 1))
                for row, column in contour
            ]
            if len(coordinates) >= 4:
                lines.append(LineString(coordinates))
        if not lines:
            return None

        faces = polygonize(unary_union(lines))
        polygons = []
        height, width = binary.shape
        for face in faces:
            sample = face.representative_point()
            x = int(round(sample.x))
            y = int(round(sample.y))
            if not (0 <= x < width and 0 <= y < height and binary[y, x]):
                continue

            if simplify:
                epsilon = max(0.25, min(0.9, 0.006 * face.exterior.length))
                simplified = face.simplify(epsilon, preserve_topology=True)
            else:
                simplified = face
            if not simplified.is_empty:
                polygons.append(simplified)

        if not polygons:
            return None

        geometry = unary_union(polygons)
        if compensation_px:
            geometry = geometry.buffer(float(compensation_px), join_style=1)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        return None if geometry.is_empty else geometry
