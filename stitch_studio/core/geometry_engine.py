"""
Geometry reconstruction for embroidery regions.

Masks remain useful for segmentation, but embroidery boundaries should be
vector geometry. This module converts mask contours into polygons that can be
shared by preview and stitch generation.
"""

from typing import Optional

import cv2
import numpy as np
from shapely.geometry import Polygon


class GeometryEngine:
    """Build embroidery-ready vector polygons from raster region masks."""

    @staticmethod
    def reconstruct_region_polygon(
        mask: np.ndarray,
        compensation_px: float = 0.0,
    ) -> Optional[Polygon]:
        clean = (mask > 0).astype(np.uint8) * 255
        if int(np.count_nonzero(clean)) == 0:
            return None

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        clean = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, kernel, iterations=1)
        contours, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not contours:
            return None

        contour = max(contours, key=cv2.contourArea)
        perimeter = float(cv2.arcLength(contour, True))
        epsilon = max(0.9, 0.006 * perimeter)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) < 3:
            return None

        poly = Polygon(approx[:, 0, :].astype(np.float64))
        if not poly.is_valid:
            poly = poly.buffer(0)
        if compensation_px:
            poly = poly.buffer(float(compensation_px), join_style=1)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if hasattr(poly, "geoms"):
            poly = max(poly.geoms, key=lambda geom: geom.area)
        if poly.is_empty:
            return None
        return poly
