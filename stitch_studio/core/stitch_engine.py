"""
Stitch Generation Engine
Converts masked regions + stitch settings into stitch point sequences.
Supports multiple fill modes with flow control.
"""

from dataclasses import dataclass
from typing import List, Tuple, Optional, Mapping
from types import MappingProxyType

import numpy as np
import cv2
from scipy.interpolate import RegularGridInterpolator
from shapely.geometry import Polygon, LineString, MultiLineString, Point
from shapely.affinity import rotate as shapely_rotate
from shapely.ops import unary_union

from .contour_geometry import adaptive_closed_contour
from .cross_stitch_geometry import CrossStitchCell, classify_cross_stitch_cell
from .project import Region, StitchSettings


# Physical constants
UNITS_PER_MM = 10  # pyembroidery uses 1/10mm


class CrossStitchOwnershipMasks(dict):
    """Ownership masks plus the grid origin that assigned their cells."""

    def __init__(self, masks, grid_origin_px: Tuple[float, float]):
        super().__init__(masks)
        self.grid_origin_px = grid_origin_px


@dataclass(frozen=True)
class CrossStitchOwnershipContext:
    """Immutable shared-grid ownership inputs for cross-stitch generation."""

    base_masks: Mapping[str, np.ndarray]
    base_grid_origin_px: Tuple[float, float]
    immutable: bool = True
    dense_masks: Optional[Mapping[str, np.ndarray]] = None
    dense_grid_origin_px: Optional[Tuple[float, float]] = None
    shared: bool = True

    def __post_init__(self):
        if not self.shared:
            raise ValueError("Cross stitch ownership context must be shared")
        if not self.immutable:
            raise ValueError("Cross stitch ownership context masks must be immutable")
        if not self.base_masks:
            raise ValueError("Cross stitch ownership context requires base masks")
        if self.base_grid_origin_px is None:
            raise ValueError("Cross stitch ownership context requires a base grid origin")
        if (self.dense_masks is None) != (self.dense_grid_origin_px is None):
            raise ValueError(
                "Cross stitch dense ownership requires both masks and a grid origin"
            )
        if self.dense_masks is not None and not self.dense_masks:
            raise ValueError("Cross stitch dense ownership context requires masks")

        object.__setattr__(self, "base_masks", self._freeze_masks(self.base_masks))
        if self.dense_masks is not None:
            object.__setattr__(self, "dense_masks", self._freeze_masks(self.dense_masks))

    @staticmethod
    def _freeze_masks(masks: Mapping[str, np.ndarray]) -> Mapping[str, np.ndarray]:
        """Freeze ownership storage without copying its full-size mask arrays."""
        frozen = dict(masks)
        for mask in frozen.values():
            mask.setflags(write=False)
        return MappingProxyType(frozen)

    @classmethod
    def from_ownership_masks(
        cls,
        base_masks: Mapping[str, np.ndarray],
        dense_masks: Optional[Mapping[str, np.ndarray]] = None,
    ) -> "CrossStitchOwnershipContext":
        """Build a context from builder output, requiring its grid metadata."""
        try:
            base_origin = base_masks.grid_origin_px
        except AttributeError as exc:
            raise ValueError(
                "Cross stitch ownership masks require grid_origin_px metadata"
            ) from exc
        if base_origin is None:
            raise ValueError("Cross stitch ownership masks require grid_origin_px metadata")

        dense_origin = None
        if dense_masks is not None:
            try:
                dense_origin = dense_masks.grid_origin_px
            except AttributeError as exc:
                raise ValueError(
                    "Dense cross stitch ownership masks require grid_origin_px metadata"
                ) from exc
            if dense_origin is None:
                raise ValueError(
                    "Dense cross stitch ownership masks require grid_origin_px metadata"
                )

        return cls(
            base_masks=base_masks,
            base_grid_origin_px=base_origin,
            dense_masks=dense_masks,
            dense_grid_origin_px=dense_origin,
        )

    def base_mask_for(self, region_uid: str) -> np.ndarray:
        try:
            return self.base_masks[region_uid]
        except KeyError as exc:
            raise ValueError(
                f"Cross stitch ownership context has no base mask for region {region_uid}"
            ) from exc

    def dense_mask_for(self, region_uid: str) -> Optional[np.ndarray]:
        if self.dense_masks is None:
            return None
        try:
            return self.dense_masks[region_uid]
        except KeyError as exc:
            raise ValueError(
                f"Cross stitch ownership context has no dense mask for region {region_uid}"
            ) from exc


class StitchEngine:
    """Generates stitch paths from region masks and settings."""

    def __init__(self, px_per_mm: float = 3.7795):
        self.px_per_mm = px_per_mm  # at 96 DPI

    def generate_region_stitches(
        self,
        region: Region,
        image: Optional[np.ndarray] = None,
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]] = None,
    ) -> List[Tuple[float, float]]:
        """
        Generate stitch points for a region based on its settings.
        Coordinates returned in 1/10mm (pyembroidery units).
        """
        paths = self.generate_region_paths(region, image, flow_field)
        return [pt for path in paths for pt in path]

    def generate_region_paths(
        self,
        region: Region,
        image: Optional[np.ndarray] = None,
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]] = None,
        mask_override: Optional[np.ndarray] = None,
        ownership_context: Optional[CrossStitchOwnershipContext] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Generate separated stitch paths for preview and export."""
        original_mask = region.mask
        settings = region.stitch_settings
        if ownership_context is not None:
            if not isinstance(ownership_context, CrossStitchOwnershipContext):
                raise TypeError("ownership_context must be a CrossStitchOwnershipContext")
            if settings.fill_mode != "cross_stitch":
                raise ValueError("Cross stitch ownership context requires cross_stitch fill mode")
            if mask_override is not None:
                raise ValueError(
                    "Cross stitch ownership context cannot be combined with mask_override"
                )
            source_mask = ownership_context.base_mask_for(region.uid)
            # Ownership allocation is authoritative and must not be expanded by
            # morphology; original_mask below still fits the source boundary.
            mask = (source_mask > 0).astype(np.uint8) * 255
        else:
            source_mask = mask_override if mask_override is not None else original_mask
            mask = self._prepare_mask(source_mask, settings) if source_mask is not None else None
        if source_mask is None:
            return []
        if mask is None or np.count_nonzero(mask) == 0:
            return []

        paths: List[List[Tuple[float, float]]] = []

        if settings.underlay and settings.fill_mode not in ("run", "cross_stitch"):
            underlay_settings = StitchSettings(
                fill_mode=settings.fill_mode,
                angle_deg=settings.angle_deg + settings.underlay_angle_offset,
                stitch_length_mm=settings.stitch_length_mm * 1.5,
                row_spacing_mm=settings.row_spacing_mm / max(settings.underlay_density, 1e-3),
                density=settings.underlay_density,
            )
            paths.extend(
                self._dispatch_fill_paths(
                    mask, underlay_settings, image, flow_field, getattr(region, "polygon", None)
                )
            )

        if settings.contour_count > 0 and settings.fill_mode not in ("run", "cross_stitch"):
            paths.extend(self._generate_contour_paths(mask, settings, getattr(region, "polygon", None)))

        fill_paths = self._dispatch_fill_paths(
            mask,
            settings,
            image,
            flow_field,
            getattr(region, "polygon", None),
            getattr(region, "design_color_rgb", None),
            cross_source_mask=original_mask,
            ownership_context=ownership_context,
            cross_region_uid=region.uid,
        )
        paths.extend(fill_paths)
        if settings.fill_mode == "scanline" and self._needs_detail_reinforcement(mask):
            reinforce_settings = StitchSettings(
                fill_mode="scanline",
                angle_deg=settings.angle_deg + 90.0,
                stitch_length_mm=max(1.2, settings.stitch_length_mm * 0.75),
                row_spacing_mm=max(0.10, settings.row_spacing_mm * 0.75),
                density=max(settings.density, 1.65),
                underlay=False,
                contour_count=0,
                pull_compensation_mm=settings.pull_compensation_mm,
                randomize_length=settings.randomize_length,
            )
            paths.extend(
                self._dispatch_fill_paths(
                    mask, reinforce_settings, image, flow_field, getattr(region, "polygon", None)
                )
            )
        scale = UNITS_PER_MM / self.px_per_mm
        return [[(x * scale, y * scale) for x, y in path] for path in paths if len(path) >= 2]

    def _needs_detail_reinforcement(self, mask: np.ndarray) -> bool:
        """Add a second fill pass only for small narrow color details."""
        binary = mask > 0
        area = int(np.count_nonzero(binary))
        if area <= 0 or area > 520:
            return False

        ys, xs = np.where(binary)
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        short_axis = min(width, height)
        long_axis = max(width, height)
        aspect = long_axis / max(1, short_axis)

        return bool(area <= 180 or (short_axis <= 24 and aspect >= 1.4))

    def _generate_acute_tip_fill_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        polygon: Optional[Polygon] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Add short local fill strokes that reach acute pointed tips."""
        poly = self._polygon_for_fill(mask, settings.pull_compensation_mm, polygon)
        if poly is None or poly.is_empty or not hasattr(poly, "exterior"):
            return []

        ring = self._acute_tip_ring(mask, poly, polygon)
        if len(ring) < 3:
            return []

        center = poly.centroid
        if not poly.contains(center):
            center = poly.representative_point()
        center_xy = np.array([center.x, center.y], dtype=np.float64)

        paths: List[List[Tuple[float, float]]] = []
        stitch_len_px = max(2.0, settings.stitch_length_mm * self.px_per_mm * 0.65)
        for i, current in enumerate(ring):
            prev_pt = np.array(ring[i - 1], dtype=np.float64)
            curr_pt = np.array(current, dtype=np.float64)
            next_pt = np.array(ring[(i + 1) % len(ring)], dtype=np.float64)

            v1 = prev_pt - curr_pt
            v2 = next_pt - curr_pt
            len1 = float(np.linalg.norm(v1))
            len2 = float(np.linalg.norm(v2))
            if len1 < 4.0 or len2 < 4.0:
                continue

            denom = max(1e-6, len1 * len2)
            angle = float(np.arccos(np.clip(np.dot(v1, v2) / denom, -1.0, 1.0)))
            if angle > np.deg2rad(72.0):
                continue

            inward = center_xy - curr_pt
            inward_len = float(np.linalg.norm(inward))
            if inward_len < 1e-6:
                continue
            inward /= inward_len

            edge1 = v1 / len1
            edge2 = v2 / len2
            max_depth = min(
                max(9.0, 2.8 * self.px_per_mm),
                len1 * 0.82,
                len2 * 0.82,
                inward_len * 0.65,
            )
            if max_depth < 3.0:
                continue

            row_pitch = max(1.2, settings.row_spacing_mm * self.px_per_mm / max(settings.density, 1e-3))
            stroke_count = int(np.clip(np.ceil(max_depth / row_pitch), 4, 10))
            depths = np.linspace(max_depth, max(1.6, min(max_depth * 0.22, 2.8)), stroke_count)

            for row_idx, depth in enumerate(depths):
                left = curr_pt + edge1 * depth
                right = curr_pt + edge2 * depth
                mid = (left + right + curr_pt) / 3.0
                if not poly.buffer(0.35).contains(Point(float(mid[0]), float(mid[1]))):
                    continue

                # A tiny miter/cap fan: each local stitch points through the
                # acute vertex, so the tip is filled instead of only outlined.
                coords = [
                    (float(left[0]), float(left[1])),
                    (float(curr_pt[0]), float(curr_pt[1])),
                    (float(right[0]), float(right[1])),
                ]
                if row_idx % 2:
                    coords = coords[::-1]
                paths.append(coords)

        return paths

    def _dispatch_fill_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray],
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]],
        polygon: Optional[Polygon] = None,
        source_color: Optional[Tuple[int, int, int]] = None,
        cross_source_mask: Optional[np.ndarray] = None,
        ownership_context: Optional[CrossStitchOwnershipContext] = None,
        cross_region_uid: Optional[str] = None,
    ) -> List[List[Tuple[float, float]]]:
        mode = settings.fill_mode
        if mode == "run":
            return self._generate_run_paths(mask, settings, image, source_color)
        if mode == "scanline":
            return self._generate_scanline_paths(mask, settings, polygon)
        if mode == "contour":
            return self._generate_contour_fill_paths(mask, settings, polygon)
        if mode == "satin":
            return self._generate_satin_paths(mask, settings)
        if mode == "flow_guided":
            return [self._generate_flow_fill(mask, settings, image, flow_field)]
        if mode == "radial":
            return [self._generate_radial_fill(mask, settings)]
        if mode == "spiral":
            return [self._generate_spiral_fill(mask, settings)]
        if mode == "stipple":
            return [self._generate_stipple_fill(mask, settings)]
        if mode == "cross_stitch":
            return self._generate_cross_stitch_paths(
                mask,
                settings,
                image,
                source_mask=cross_source_mask,
                ownership_context=ownership_context,
                region_uid=cross_region_uid,
            )
        if mode == "none":
            return []
        return self._generate_scanline_paths(mask, settings, polygon)

    def _dispatch_fill(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray],
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]],
    ) -> List[Tuple[float, float]]:
        """Route to the correct fill generator based on mode."""
        return [pt for path in self._dispatch_fill_paths(mask, settings, image, flow_field) for pt in path]

    def _legacy_dispatch_fill(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray],
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]],
    ) -> List[Tuple[float, float]]:
        """Legacy route kept for non-path fill generators."""
        mode = settings.fill_mode
        if mode == "scanline":
            return self._generate_scanline_fill(mask, settings)
        elif mode == "contour":
            return self._generate_contour_fill(mask, settings)
        elif mode == "flow_guided":
            return self._generate_flow_fill(mask, settings, image, flow_field)
        elif mode == "satin":
            return self._generate_satin_fill(mask, settings)
        elif mode == "radial":
            return self._generate_radial_fill(mask, settings)
        elif mode == "spiral":
            return self._generate_spiral_fill(mask, settings)
        elif mode == "stipple":
            return self._generate_stipple_fill(mask, settings)
        elif mode == "cross_stitch":
            return self._generate_cross_stitch_fill(mask, settings)
        else:
            return self._generate_scanline_fill(mask, settings)

    def _generate_fill(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]] = None,
    ) -> List[Tuple[float, float]]:
        return self._dispatch_fill(mask, settings, image, flow_field)

    # ========== SCANLINE FILL ==========

    def _generate_scanline_fill(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[Tuple[float, float]]:
        """Classic boustrophedon (zigzag) scanline fill at a fixed angle."""
        return [pt for path in self._generate_scanline_paths(mask, settings) for pt in path]

    def _generate_scanline_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        polygon: Optional[Polygon] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Path-aware scanline fill. Each separated island row is its own path."""
        poly = self._polygon_for_fill(mask, settings.pull_compensation_mm, polygon)
        if poly is None or poly.is_empty:
            return self._generate_hairline_fill_paths(mask, settings)

        geometries = getattr(poly, "geoms", None)
        if geometries is None:
            geometries = [poly]

        paths: List[List[Tuple[float, float]]] = []
        for geometry in geometries:
            if geometry.is_empty or not hasattr(geometry, "exterior"):
                continue
            paths.extend(self._generate_scanline_polygon_paths(geometry, settings))
        return paths or self._generate_hairline_fill_paths(mask, settings)

    def _generate_scanline_polygon_paths(
        self,
        poly: Polygon,
        settings: StitchSettings,
    ) -> List[List[Tuple[float, float]]]:
        """Generate scanlines inside one connected polygon island."""
        angle = settings.angle_deg
        pitch_px = settings.row_spacing_mm * self.px_per_mm / settings.density
        stitch_len_px = settings.stitch_length_mm * self.px_per_mm

        # Rotate polygon to make scanlines horizontal
        centroid = poly.centroid
        rotated = shapely_rotate(poly, -angle, origin=centroid)
        minx, miny, maxx, maxy = rotated.bounds

        row_paths: List[List[Tuple[float, float]]] = []
        y = miny + pitch_px / 2
        row_idx = 0

        while y <= maxy:
            scanline = LineString([(minx - 10, y), (maxx + 10, y)])
            intersection = rotated.intersection(scanline)

            segments = []
            if isinstance(intersection, LineString) and not intersection.is_empty:
                segments = [intersection]
            elif isinstance(intersection, MultiLineString):
                segments = list(intersection.geoms)

            for seg in segments:
                coords = list(seg.coords)
                if row_idx % 2 == 1:
                    coords = coords[::-1]

                # Resample at stitch_length intervals
                resampled = self._resample_line(coords, stitch_len_px, settings.randomize_length)

                path = []
                for px, py in resampled:
                    pt = shapely_rotate(Point(px, py), angle, origin=centroid)
                    path.append((pt.x, pt.y))
                if len(path) >= 2:
                    row_paths.append(path)

            y += pitch_px
            row_idx += 1

        paths = self._chain_fill_rows(
            row_paths,
            max_gap_px=max(pitch_px * 2.8, stitch_len_px * 1.8),
            containment_polygon=poly,
        )
        if paths:
            return paths

        # Very thin islands can fall between scan rows. Trace their boundary
        # instead of silently dropping a one-pixel line or isolated detail.
        outline = self._resample_line(
            list(poly.exterior.coords),
            max(1.0, stitch_len_px),
            0,
        )
        return [outline] if len(outline) >= 2 else []

    def _generate_hairline_fill_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
    ) -> List[List[Tuple[float, float]]]:
        """Preserve one-pixel color details that cannot form an area polygon."""
        from skimage.morphology import skeletonize

        skeleton = skeletonize(mask > 0).astype(np.uint8)
        n_labels, labels = cv2.connectedComponents(skeleton, connectivity=8)
        stitch_len_px = max(1.0, settings.stitch_length_mm * self.px_per_mm)
        raw_paths: List[List[Tuple[float, float]]] = []

        for lbl in range(1, n_labels):
            component = labels == lbl
            if int(component.sum()) < 2:
                continue
            raw_paths.extend(self._trace_skeleton_component(component))

        paths: List[List[Tuple[float, float]]] = []
        for raw in self._assemble_run_components(raw_paths, mask):
            if len(raw) < 2:
                continue
            simplified = self._simplify_run_path(raw, closed=False)
            smoothed = self._chaikin_smooth(
                simplified,
                closed=False,
                iterations=1,
            )
            resampled = self._resample_run_path(smoothed, stitch_len_px, closed=False)
            if len(resampled) >= 2:
                paths.append(resampled)

        return paths

    # ========== CONTOUR FILL ==========

    def _generate_contour(
        self, mask: np.ndarray, settings: StitchSettings
    ) -> List[Tuple[float, float]]:
        """Generate contour running stitches around region boundary."""
        return [pt for path in self._generate_contour_paths(mask, settings) for pt in path]

    def _generate_contour_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        polygon: Optional[Polygon] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Generate closed contour running stitch paths around boundaries."""
        if polygon is not None and not polygon.is_empty and hasattr(polygon, "exterior"):
            poly = self._polygon_for_fill(mask, settings.pull_compensation_mm, polygon)
            if poly is not None and not poly.is_empty and hasattr(poly, "exterior"):
                coords = list(poly.exterior.coords)
                stitch_len = settings.stitch_length_mm * self.px_per_mm
                resampled = self._resample_line(coords, stitch_len, 0)
                if resampled and resampled[0] != resampled[-1]:
                    resampled.append(resampled[0])
                return [resampled] if len(resampled) >= 2 else []

        contours, _ = cv2.findContours(
            mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
        )
        paths: List[List[Tuple[float, float]]] = []
        stitch_len = settings.stitch_length_mm * self.px_per_mm

        for contour in contours:
            pts = contour[:, 0, :].astype(np.float64)
            if len(pts) < 3:
                continue
            coords = [(p[0], p[1]) for p in pts]
            coords.append(coords[0])
            resampled = self._resample_line(
                coords, stitch_len, 0
            )
            if resampled and resampled[0] != resampled[-1]:
                resampled.append(resampled[0])
            if len(resampled) >= 2:
                paths.append(resampled)

        return paths

    def _generate_contour_fill(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[Tuple[float, float]]:
        """Concentric inward contour fill."""
        return [pt for path in self._generate_contour_fill_paths(mask, settings) for pt in path]

    def _generate_contour_fill_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        polygon: Optional[Polygon] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Concentric inward contour fill with path boundaries preserved."""
        poly = self._polygon_for_fill(mask, settings.pull_compensation_mm, polygon)
        if poly is None or poly.is_empty:
            return []

        offset_px = settings.row_spacing_mm * self.px_per_mm / settings.density
        stitch_len_px = settings.stitch_length_mm * self.px_per_mm
        paths: List[List[Tuple[float, float]]] = []
        current = poly

        while not current.is_empty:
            if hasattr(current, 'exterior'):
                coords = list(current.exterior.coords)
                resampled = self._resample_line(coords, stitch_len_px, settings.randomize_length)
                if len(resampled) >= 2:
                    paths.append(resampled)
            elif hasattr(current, 'geoms'):
                for geom in current.geoms:
                    if hasattr(geom, 'exterior'):
                        coords = list(geom.exterior.coords)
                        resampled = self._resample_line(coords, stitch_len_px, settings.randomize_length)
                        if len(resampled) >= 2:
                            paths.append(resampled)
            current = current.buffer(-offset_px)
            if hasattr(current, 'is_empty') and current.is_empty:
                break
            if hasattr(current, 'area') and current.area < offset_px * offset_px:
                break

        return paths

    # ========== FLOW-GUIDED FILL ==========

    def _generate_flow_fill(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray],
        flow_field: Optional[Tuple[np.ndarray, np.ndarray]],
    ) -> List[Tuple[float, float]]:
        """Trace streamlines through a flow/orientation field within the mask."""
        if flow_field is None:
            # Fallback to scanline if no flow field
            return self._generate_scanline_fill(mask, settings)

        h, w = mask.shape
        flow_x, flow_y = flow_field
        pitch_px = settings.row_spacing_mm * self.px_per_mm / settings.density
        stitch_len_px = settings.stitch_length_mm * self.px_per_mm

        # Build interpolators
        ys = np.arange(h, dtype=np.float64)
        xs = np.arange(w, dtype=np.float64)
        interp_fx = RegularGridInterpolator((ys, xs), flow_x,
                                            bounds_error=False, fill_value=0)
        interp_fy = RegularGridInterpolator((ys, xs), flow_y,
                                            bounds_error=False, fill_value=0)

        # Seed points on a grid, filtered to mask
        visited = np.zeros((h, w), dtype=bool)
        all_stitches = []

        # Create seed grid perpendicular to average flow direction
        seed_spacing = int(max(1, pitch_px))
        mask_ys, mask_xs = np.where(mask > 0)
        if len(mask_ys) == 0:
            return []

        seeds = list(zip(mask_xs[::seed_spacing], mask_ys[::seed_spacing]))

        for sx, sy in seeds:
            if visited[int(sy), int(sx)]:
                continue

            # Trace streamline in both directions
            pts_fwd = self._trace_streamline(
                sx, sy, interp_fx, interp_fy, mask, stitch_len_px, max_steps=300
            )
            pts_bwd = self._trace_streamline(
                sx, sy, interp_fx, interp_fy, mask, stitch_len_px, max_steps=300,
                reverse=True
            )

            line = pts_bwd[::-1] + pts_fwd[1:]

            if len(line) >= 2:
                # Mark visited
                for px, py in line:
                    ix, iy = int(np.clip(px, 0, w - 1)), int(np.clip(py, 0, h - 1))
                    # Mark a band around the point as visited
                    r = max(1, int(pitch_px / 2))
                    y_lo = max(0, iy - r)
                    y_hi = min(h, iy + r)
                    x_lo = max(0, ix - r)
                    x_hi = min(w, ix + r)
                    visited[y_lo:y_hi, x_lo:x_hi] = True

                all_stitches.extend(line)

        return all_stitches

    def _trace_streamline(
        self, x0, y0, interp_fx, interp_fy, mask, step, max_steps=300, reverse=False
    ):
        """Trace a streamline using RK4 integration."""
        h, w = mask.shape
        pts = [(float(x0), float(y0))]
        x, y = float(x0), float(y0)
        sign = -1 if reverse else 1

        for _ in range(max_steps):
            # RK4
            def get_dir(xi, yi):
                fx = float(interp_fx([[yi, xi]])[0])
                fy = float(interp_fy([[yi, xi]])[0])
                return sign * fx, sign * fy

            k1x, k1y = get_dir(x, y)
            k2x, k2y = get_dir(x + step * k1x / 2, y + step * k1y / 2)
            k3x, k3y = get_dir(x + step * k2x / 2, y + step * k2y / 2)
            k4x, k4y = get_dir(x + step * k3x, y + step * k3y)

            dx = step * (k1x + 2 * k2x + 2 * k3x + k4x) / 6
            dy = step * (k1y + 2 * k2y + 2 * k3y + k4y) / 6

            nx = x + dx
            ny = y + dy

            if not (0 <= nx < w and 0 <= ny < h):
                break
            if mask[int(ny), int(nx)] == 0:
                break

            pts.append((nx, ny))
            x, y = nx, ny

        return pts

    # ========== SATIN FILL ==========

    def _generate_satin_paths(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[List[Tuple[float, float]]]:
        """Generate independent satin paths for every skeleton branch."""
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            (mask > 0).astype(np.uint8), connectivity=8
        )
        paths = []
        for label in range(1, count):
            if int(stats[label, cv2.CC_STAT_AREA]) < 2:
                continue
            component = (labels == label).astype(np.uint8) * 255
            paths.extend(self._generate_satin_component_paths(component, settings))
        return paths

    def _generate_satin_fill(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[Tuple[float, float]]:
        """Legacy single-path satin entry point."""
        paths = self._generate_satin_component_paths(mask, settings)
        return max(paths, key=len) if paths else []

    def _generate_satin_component_paths(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[List[Tuple[float, float]]]:
        """Trace satin along topology-safe skeleton edges.

        Branches deliberately remain separate paths. Exporters then insert a
        jump between them instead of sewing a diagonal across empty fabric.
        """
        from skimage.morphology import skeletonize

        skeleton = skeletonize(mask > 0)
        raw_spines = self._trace_skeleton_component(skeleton)
        if not raw_spines:
            fallback = self._generate_scanline_fill(mask, settings)
            return [fallback] if len(fallback) >= 2 else []

        width_px = settings.row_spacing_mm * self.px_per_mm * 10  # satin width
        stitch_spacing = max(0.20, settings.stitch_length_mm * self.px_per_mm)
        dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
        paths = []

        for raw_spine in raw_spines:
            if len(raw_spine) < 2:
                continue
            spine_pts = self._resample_line(raw_spine, stitch_spacing)
            if len(spine_pts) < 2:
                continue

            stitches = []
            for i, (x0, y0) in enumerate(spine_pts):
                prev = spine_pts[max(0, i - 1)]
                nxt = spine_pts[min(len(spine_pts) - 1, i + 1)]
                dx, dy = nxt[0] - prev[0], nxt[1] - prev[1]
                length = np.hypot(dx, dy) + 1e-8
                perp_x, perp_y = -dy / length, dx / length

                ix = int(np.clip(round(x0), 0, mask.shape[1] - 1))
                iy = int(np.clip(round(y0), 0, mask.shape[0] - 1))
                local_width = min(dt[iy, ix] * 2, width_px)
                if local_width <= 0:
                    continue

                stitches.append((
                    x0 - perp_x * local_width / 2,
                    y0 - perp_y * local_width / 2,
                ))
                stitches.append((
                    x0 + perp_x * local_width / 2,
                    y0 + perp_y * local_width / 2,
                ))

            if len(stitches) >= 2:
                paths.append(stitches)

        return paths

    # ========== RUN STITCH ==========

    def _generate_run_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
        source_color: Optional[Tuple[int, int, int]] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Generate single-centerline run stitch paths for thin strokes."""
        from skimage.morphology import skeletonize

        if getattr(settings, "run_trace_contour", False):
            return self._generate_closed_contour_run(mask, settings)

        mask = self._restore_line_art_run_mask(mask, image, source_color)
        loop_paths, loop_exclusion = self._extract_closed_run_loops(mask)

        skeleton = skeletonize(mask > 0).astype(np.uint8)
        skeleton[loop_exclusion > 0] = 0
        if not getattr(settings, "run_preserve_short_branches", False):
            skeleton = self._prune_short_skeleton_branches(
                skeleton,
                min_branch_px=max(1.5, 0.7 * self.px_per_mm),
            )
        n_labels, labels = cv2.connectedComponents(skeleton, connectivity=8)
        stitch_len_px = settings.stitch_length_mm * self.px_per_mm
        min_len_px = max(1.5, 0.45 * self.px_per_mm)
        raw_components: List[List[List[Tuple[float, float]]]] = []

        for lbl in range(1, n_labels):
            component = labels == lbl
            if int(component.sum()) < 2:
                continue

            raw_components.append(self._trace_skeleton_component(component))

        components = [(path, True) for path in loop_paths]
        for raw_paths in raw_components:
            component_mask = np.zeros_like(mask, dtype=np.uint8)
            for raw_path in raw_paths:
                for x, y in raw_path:
                    component_mask[int(y), int(x)] = 255
            components.extend(
                (path, False)
                for path in self._assemble_run_components(raw_paths, component_mask)
            )
        paths: List[List[Tuple[float, float]]] = []

        for raw, forced_closed in components:
            raw_len = self._polyline_length(raw)
            closed = forced_closed or self._should_close_path(raw, mask)
            if len(raw) < 2 or (raw_len < min_len_px and not closed):
                continue

            simplified = self._simplify_run_path(raw, closed)
            if closed:
                simplified = self._ensure_closed_path(simplified)

            smoothed = self._chaikin_smooth(
                simplified,
                closed=closed,
                iterations=2 if raw_len >= 8 * self.px_per_mm else 1,
            )
            resampled = self._resample_run_path(smoothed, max(1.0, stitch_len_px), closed)

            if closed and resampled:
                resampled = self._ensure_closed_path(resampled)
            elif len(resampled) >= 2:
                extension = max(
                    0.0,
                    float(getattr(settings, "run_endpoint_extension_mm", 0.0))
                    * self.px_per_mm,
                )
                if extension > 0.0:
                    resampled = self._extend_open_run_endpoints(
                        resampled,
                        extension,
                    )

            if len(resampled) >= 2:
                pass_count = max(1, int(getattr(settings, "run_passes", 1)))
                repeated = list(resampled)
                forward = list(resampled)
                for pass_index in range(1, pass_count):
                    traversal = (
                        list(reversed(forward))
                        if pass_index % 2 == 1
                        else forward
                    )
                    repeated.extend(traversal[1:])
                paths.append(repeated)

        return paths

    @staticmethod
    def _extend_open_run_endpoints(
        path: List[Tuple[float, float]],
        distance: float,
    ) -> List[Tuple[float, float]]:
        if len(path) < 2 or distance <= 0.0:
            return list(path)
        points = np.asarray(path, dtype=np.float64)
        start_vector = points[1] - points[0]
        end_vector = points[-1] - points[-2]
        start_length = float(np.linalg.norm(start_vector))
        end_length = float(np.linalg.norm(end_vector))
        if start_length > 1e-6:
            points[0] -= start_vector / start_length * distance
        if end_length > 1e-6:
            points[-1] += end_vector / end_length * distance
        return [
            (float(point[0]), float(point[1]))
            for point in points
        ]

    @staticmethod
    def _resolved_run_corner_mode(settings: StitchSettings) -> str:
        """Resolve modern corner settings without changing legacy projects."""
        mode = getattr(settings, "run_corner_mode", "legacy")
        if mode == "legacy":
            return (
                "preserve"
                if getattr(settings, "run_preserve_corners", False)
                else "smooth"
            )
        return mode if mode in ("smooth", "preserve", "adaptive") else "smooth"

    def _generate_closed_contour_run(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
    ) -> List[List[Tuple[float, float]]]:
        """Trace a confirmed facial outline as one smooth reinforced loop."""
        binary = (mask > 0).astype(np.uint8)
        binary = cv2.morphologyEx(
            binary,
            cv2.MORPH_CLOSE,
            np.ones((3, 3), dtype=np.uint8),
            iterations=1,
        )
        contours, _ = cv2.findContours(
            binary,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_NONE,
        )
        if not contours:
            return []

        corner_mode = self._resolved_run_corner_mode(settings)
        preserve_corners = corner_mode == "preserve"
        use_centerline = bool(
            getattr(settings, "run_centerline_contour", False)
        )
        points = []
        if preserve_corners or use_centerline:
            from skimage.morphology import thin

            thinned = thin(binary > 0)
            loop_paths = [
                path
                for path in self._trace_skeleton_component(thinned)
                if len(path) >= 4 and path[0] == path[-1]
            ]
            if loop_paths:
                points = max(loop_paths, key=self._polyline_length)
        if not points:
            contour = max(contours, key=lambda item: cv2.arcLength(item, True))
            if len(contour) < 4:
                return []
            points = [
                (float(point[0][0]), float(point[0][1]))
                for point in contour
            ]
        points = self._ensure_closed_path(points)
        points = self._simplify_run_path(points, closed=True)
        stitch_length = max(
            1.0,
            settings.stitch_length_mm * self.px_per_mm,
        )
        if corner_mode == "adaptive":
            points = adaptive_closed_contour(points, stitch_length)
        elif preserve_corners:
            points = self._resample_polyline_preserving_vertices(
                points,
                stitch_length,
                closed=True,
            )
        else:
            points = self._chaikin_smooth(points, closed=True, iterations=3)
            points = self._resample_run_path(
                points,
                stitch_length,
                closed=True,
            )
        if len(points) < 2:
            return []

        pass_count = max(1, int(getattr(settings, "run_passes", 1)))
        repeated = list(points)
        for pass_index in range(1, pass_count):
            traversal = (
                list(reversed(points))
                if pass_index % 2 == 1
                else points
            )
            repeated.extend(traversal[1:])
        return [repeated]

    def _restore_line_art_run_mask(
        self,
        mask: np.ndarray,
        image: Optional[np.ndarray],
        source_color: Optional[Tuple[int, int, int]] = None,
    ) -> np.ndarray:
        """Recover nearby source line pixels that segmentation split away.

        Run-stitch line art often arrives as a broken mask because anti-aliased
        pixels quantize into small neighboring color islands. Only restore
        source pixels that are both visibly non-background and close to the
        current mask, so blank canvas/background areas cannot become stitches.
        """
        restored = (mask > 0).astype(np.uint8) * 255
        if image is None or restored.size == 0 or np.count_nonzero(restored) == 0:
            return restored
        if image.shape[0] != restored.shape[0] or image.shape[1] != restored.shape[1]:
            return restored

        img = image
        if img.ndim == 2:
            rgb = np.repeat(img[:, :, None], 3, axis=2).astype(np.int16)
            alpha = np.ones(restored.shape, dtype=bool)
        else:
            rgb = img[:, :, :3].astype(np.int16)
            alpha = img[:, :, 3] > 8 if img.shape[2] >= 4 else np.ones(restored.shape, dtype=bool)

        max_channel = rgb.max(axis=2)
        min_channel = rgb.min(axis=2)
        mean_channel = rgb.mean(axis=2)
        chroma = max_channel - min_channel
        non_background = alpha & (mean_channel < 248) & ((chroma > 6) | (mean_channel < 220))

        gray = np.clip(mean_channel, 0, 255).astype(np.uint8)
        local_high = cv2.dilate(gray, np.ones((3, 3), dtype=np.uint8), iterations=1)
        local_low = cv2.erode(gray, np.ones((3, 3), dtype=np.uint8), iterations=1)
        source_edge = (local_high.astype(np.int16) - local_low.astype(np.int16)) >= 10
        non_background &= source_edge
        if source_color is not None:
            target = np.asarray(source_color, dtype=np.int16)
            color_distance = np.linalg.norm(rgb - target, axis=2)
            non_background &= color_distance <= 96.0

        radius_px = max(2, int(round(2.0 * self.px_per_mm)))
        kernel_size = radius_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        near_existing_line = cv2.dilate(restored, kernel, iterations=1) > 0

        recovered = np.where(non_background & near_existing_line, 255, 0).astype(np.uint8)
        combined = np.maximum(restored, recovered)

        close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, close_kernel, iterations=1)
        return combined

    @staticmethod
    def _prune_short_skeleton_branches(
        skeleton: np.ndarray,
        min_branch_px: float,
    ) -> np.ndarray:
        """Remove short endpoint spurs while retaining the main centerline."""
        clean = (np.asarray(skeleton) > 0).astype(np.uint8)
        if np.count_nonzero(clean) < 3:
            return clean

        for _ in range(8):
            ys, xs = np.where(clean > 0)
            pixels = {(int(x), int(y)) for x, y in zip(xs, ys)}
            if not pixels:
                break

            def neighbors(pixel):
                x, y = pixel
                return [
                    (x + dx, y + dy)
                    for dy in (-1, 0, 1)
                    for dx in (-1, 0, 1)
                    if (dx or dy) and (x + dx, y + dy) in pixels
                ]

            degree = {pixel: len(neighbors(pixel)) for pixel in pixels}
            removed = set()
            for endpoint in sorted(pixel for pixel, value in degree.items() if value == 1):
                path = [endpoint]
                previous = None
                current = endpoint
                length = 0.0
                while True:
                    options = [
                        item
                        for item in neighbors(current)
                        if item != previous
                    ]
                    if not options:
                        break
                    next_pixel = options[0]
                    length += float(
                        np.hypot(
                            next_pixel[0] - current[0],
                            next_pixel[1] - current[1],
                        )
                    )
                    path.append(next_pixel)
                    previous, current = current, next_pixel
                    if degree.get(current, 0) != 2:
                        break
                if (
                    degree.get(current, 0) >= 3
                    and length < min_branch_px
                ):
                    removed.update(path[:-1])
                    remaining_neighbors = [
                        item
                        for item in neighbors(current)
                        if item != previous
                    ]
                    if len(remaining_neighbors) >= 2:
                        connected = {remaining_neighbors[0]}
                        frontier = [remaining_neighbors[0]]
                        while frontier:
                            item = frontier.pop()
                            for candidate in remaining_neighbors:
                                if candidate in connected:
                                    continue
                                if max(
                                    abs(candidate[0] - item[0]),
                                    abs(candidate[1] - item[1]),
                                ) <= 1:
                                    connected.add(candidate)
                                    frontier.append(candidate)
                        if len(connected) == len(remaining_neighbors):
                            removed.add(current)

            if not removed:
                break
            for x, y in removed:
                clean[y, x] = 0
        return clean

    def _extract_closed_run_loops(
        self,
        mask: np.ndarray,
    ) -> Tuple[List[List[Tuple[float, float]]], np.ndarray]:
        """Extract genuine closed skeleton loops without tracing both edges."""
        from skimage.morphology import skeletonize

        loop_paths: List[List[Tuple[float, float]]] = []
        exclusion = np.zeros_like(mask, dtype=np.uint8)

        skeleton = skeletonize(mask > 0).astype(np.uint8)
        count, labels = cv2.connectedComponents(skeleton, connectivity=8)
        for label in range(1, count):
            component = labels == label
            paths = self._trace_skeleton_component(component)
            if len(paths) != 1 or len(paths[0]) < 4:
                continue
            path = paths[0]
            if path[0] != path[-1]:
                continue
            loop_paths.append(path)
            exclusion[component] = 255

        return loop_paths, exclusion

    def _simplify_run_path(
        self,
        points: List[Tuple[float, float]],
        closed: bool,
    ) -> List[Tuple[float, float]]:
        if len(points) < 3:
            return points
        pts = np.array(points, dtype=np.float32)
        epsilon = max(0.18, 0.05 * self.px_per_mm)
        approx = cv2.approxPolyDP(pts.reshape((-1, 1, 2)), epsilon, closed=closed)
        simplified = [(float(p[0][0]), float(p[0][1])) for p in approx]
        if closed:
            simplified = self._ensure_closed_path(simplified)
        return simplified if len(simplified) >= 2 else points

    def _chaikin_smooth(
        self,
        points: List[Tuple[float, float]],
        closed: bool,
        iterations: int = 1,
    ) -> List[Tuple[float, float]]:
        return self._smooth_polyline(points, closed=closed, iterations=iterations)

    def _resample_run_path(
        self,
        points: List[Tuple[float, float]],
        stitch_len: float,
        closed: bool,
    ) -> List[Tuple[float, float]]:
        if closed:
            points = self._ensure_closed_path(points)
        resampled = self._resample_line(points, stitch_len)
        if closed:
            resampled = self._ensure_closed_path(resampled)
        return resampled

    def _resample_polyline_preserving_vertices(
        self,
        points: List[Tuple[float, float]],
        stitch_len: float,
        closed: bool,
    ) -> List[Tuple[float, float]]:
        """Resample each edge independently so simplified corners remain exact."""
        source = self._ensure_closed_path(points) if closed else list(points)
        if len(source) < 2:
            return source
        result = [source[0]]
        for start, end in zip(source, source[1:]):
            distance = float(
                np.hypot(end[0] - start[0], end[1] - start[1])
            )
            count = max(1, int(np.ceil(distance / max(1.0, stitch_len))))
            for index in range(1, count + 1):
                ratio = index / count
                result.append(
                    (
                        start[0] + (end[0] - start[0]) * ratio,
                        start[1] + (end[1] - start[1]) * ratio,
                    )
                )
        return self._ensure_closed_path(result) if closed else result

    # ========== RADIAL FILL ==========

    def _generate_radial_fill(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[Tuple[float, float]]:
        """Radial fill from center of region outward."""
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return []

        cx, cy = float(xs.mean()), float(ys.mean())
        max_r = max(np.max(np.abs(xs - cx)), np.max(np.abs(ys - cy)))
        pitch_px = settings.row_spacing_mm * self.px_per_mm / settings.density
        stitch_len = settings.stitch_length_mm * self.px_per_mm

        stitches = []
        n_rays = max(8, int(2 * np.pi * max_r / pitch_px))

        for i in range(n_rays):
            angle = 2 * np.pi * i / n_rays
            dx, dy = np.cos(angle), np.sin(angle)

            r = 0
            while r < max_r:
                px = cx + dx * r
                py = cy + dy * r
                ix = int(np.clip(px, 0, mask.shape[1] - 1))
                iy = int(np.clip(py, 0, mask.shape[0] - 1))

                if mask[iy, ix] > 0:
                    stitches.append((px, py))

                r += stitch_len

        return stitches

    # ========== SPIRAL FILL ==========

    def _generate_spiral_fill(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[Tuple[float, float]]:
        """Archimedean spiral fill from center outward."""
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return []

        cx, cy = float(xs.mean()), float(ys.mean())
        max_r = max(np.max(np.abs(xs - cx)), np.max(np.abs(ys - cy)))
        pitch_px = settings.row_spacing_mm * self.px_per_mm / settings.density
        stitch_len = settings.stitch_length_mm * self.px_per_mm

        stitches = []
        theta = 0
        r = 0
        b = pitch_px / (2 * np.pi)  # spacing between spiral arms

        while r < max_r * 1.5:
            px = cx + r * np.cos(theta)
            py = cy + r * np.sin(theta)
            ix = int(np.clip(px, 0, mask.shape[1] - 1))
            iy = int(np.clip(py, 0, mask.shape[0] - 1))

            if 0 <= ix < mask.shape[1] and 0 <= iy < mask.shape[0]:
                if mask[iy, ix] > 0:
                    stitches.append((px, py))

            d_theta = stitch_len / (r + 1)
            theta += d_theta
            r = b * theta

        return stitches

    # ========== STIPPLE FILL ==========

    def _generate_stipple_fill(
        self, mask: np.ndarray, settings: StitchSettings,
    ) -> List[Tuple[float, float]]:
        """Random stipple/meandering fill within the mask."""
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return []

        stitch_len = settings.stitch_length_mm * self.px_per_mm
        n_stitches = int(mask.sum() / 255 / (stitch_len ** 2) * settings.density * 50)
        n_stitches = max(10, min(n_stitches, 50000))

        rng = np.random.RandomState(42)
        indices = rng.choice(len(xs), size=min(n_stitches, len(xs)), replace=False)
        points = list(zip(xs[indices].astype(float), ys[indices].astype(float)))

        # Nearest-neighbor order to minimize jumps
        ordered = [points[0]]
        remaining = set(range(1, len(points)))

        for _ in range(len(points) - 1):
            if not remaining:
                break
            last = ordered[-1]
            best_idx = min(remaining, key=lambda i: (points[i][0] - last[0]) ** 2 + (points[i][1] - last[1]) ** 2)
            ordered.append(points[best_idx])
            remaining.remove(best_idx)

        return ordered

    # ========== CROSS-STITCH FILL ==========

    def build_cross_stitch_ownership_masks(
        self,
        region_priorities: List[Tuple[Region, float]],
        grid_offset_shift_mm: Tuple[float, float] = (0.0, 0.0),
    ) -> dict:
        """Assign every shared grid cell to one dominant design color."""
        entries = [
            (region, max(0.1, float(priority)))
            for region, priority in region_priorities
            if region.mask is not None
            and region.stitch_settings.fill_mode == "cross_stitch"
        ]
        if not entries:
            return {}

        shape = entries[0][0].mask.shape
        if any(region.mask.shape != shape for region, _ in entries):
            return {}
        reference = entries[0][0].stitch_settings
        signature = self._cross_grid_signature(reference)
        if any(
            self._cross_grid_signature(region.stitch_settings) != signature
            for region, _ in entries[1:]
        ):
            return {}

        height, width = shape
        cell_size = max(1.0, reference.cross_pattern_size_mm * self.px_per_mm)
        shift_x_mm, shift_y_mm = grid_offset_shift_mm
        offset_x = (reference.cross_grid_offset_x_mm + shift_x_mm) * self.px_per_mm
        offset_y = (reference.cross_grid_offset_y_mm + shift_y_mm) * self.px_per_mm
        start_x = offset_x + np.floor((0.0 - offset_x) / cell_size) * cell_size
        start_y = offset_y + np.floor((0.0 - offset_y) / cell_size) * cell_size
        assigned = CrossStitchOwnershipMasks(
            {region.uid: np.zeros(shape, dtype=np.uint8) for region, _ in entries},
            (float(start_x), float(start_y)),
        )
        minimum_coverage = max(0.05, min(0.25, reference.cross_coverage * 0.5))

        grid = []
        y = start_y
        while y < height:
            row = []
            x = start_x
            while x < width:
                # Use the same rounded boundary for adjacent cells. Independent
                # floor/ceil slices overlap by one pixel on fractional grids.
                x0 = max(0, int(np.floor(x + 1e-9)))
                y0 = max(0, int(np.floor(y + 1e-9)))
                x1 = min(width, int(np.floor(x + cell_size + 1e-9)))
                y1 = min(height, int(np.floor(y + cell_size + 1e-9)))
                if x1 <= x0 and x0 < width:
                    x1 = x0 + 1
                if y1 <= y0 and y0 < height:
                    y1 = y0 + 1
                if x1 > x0 and y1 > y0:
                    counts = [
                        int(np.count_nonzero(region.mask[y0:y1, x0:x1]))
                        for region, _ in entries
                    ]
                    occupied = min((x1 - x0) * (y1 - y0), sum(counts))
                    cell_area = max(1, (x1 - x0) * (y1 - y0))
                    row.append({
                        "bounds": (y0, y1, x0, x1),
                        "counts": counts,
                        "area": cell_area,
                        "valid": occupied / cell_area + 1e-9 >= minimum_coverage,
                    })
                x += cell_size
            grid.append(row)
            y += cell_size

        priorities = [priority for _, priority in entries]
        for row_index, row in enumerate(grid):
            for column_index, cell in enumerate(row):
                if not cell["valid"]:
                    continue
                counts = cell["counts"]
                base_winner = max(range(len(entries)), key=lambda index: counts[index])
                winner = max(
                    range(len(entries)),
                    key=lambda index: counts[index] * priorities[index],
                )
                if winner != base_winner and priorities[winner] > priorities[base_winner]:
                    coverage = counts[winner] / max(1, cell["area"])
                    support = self._cross_cell_neighbor_support(
                        grid,
                        row_index,
                        column_index,
                        winner,
                    )
                    if coverage < 0.30 and support < 2:
                        winner = base_winner
                if counts[winner] <= 0:
                    continue
                y0, y1, x0, x1 = cell["bounds"]
                assigned[entries[winner][0].uid][y0:y1, x0:x1] = 255
        return assigned

    @staticmethod
    def _cross_cell_neighbor_support(grid, row_index, column_index, color_index):
        support = 0
        for y in range(max(0, row_index - 1), min(len(grid), row_index + 2)):
            row = grid[y]
            for x in range(max(0, column_index - 1), min(len(row), column_index + 2)):
                if y == row_index and x == column_index:
                    continue
                cell = row[x]
                if cell["valid"] and cell["counts"][color_index] > 0:
                    support += 1
        return support

    @staticmethod
    def _cross_grid_signature(settings: StitchSettings) -> tuple:
        return (
            round(float(settings.cross_pattern_size_mm), 6),
            bool(settings.cross_align_grid),
            round(float(settings.cross_grid_offset_x_mm), 6),
            round(float(settings.cross_grid_offset_y_mm), 6),
        )

    def _iter_cross_grid_cells(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        grid_origin_px: Optional[Tuple[float, float]] = None,
    ):
        """Yield shared-grid bounds, pixel slices, and stable grid coordinates."""
        cell_w = max(1.0, settings.cross_pattern_size_mm * self.px_per_mm)
        cell_h = cell_w
        offset_x = settings.cross_grid_offset_x_mm * self.px_per_mm
        offset_y = settings.cross_grid_offset_y_mm * self.px_per_mm

        h, w = mask.shape
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return []

        if grid_origin_px is not None:
            origin_x, origin_y = grid_origin_px
            grid_column_offset = int(np.floor((xs.min() - origin_x) / cell_w + 1e-9))
            grid_row_offset = int(np.floor((ys.min() - origin_y) / cell_h + 1e-9))
            start_x = origin_x + grid_column_offset * cell_w
            start_y = origin_y + grid_row_offset * cell_h
        elif settings.cross_align_grid:
            start_x = offset_x + np.floor((xs.min() - offset_x) / cell_w) * cell_w
            start_y = offset_y + np.floor((ys.min() - offset_y) / cell_h) * cell_h
            grid_column_offset = int(np.floor((start_x - offset_x) / cell_w + 1e-9))
            grid_row_offset = int(np.floor((start_y - offset_y) / cell_h + 1e-9))
        else:
            start_x = float(xs.min()) + offset_x
            start_y = float(ys.min()) + offset_y
            grid_column_offset = 0
            grid_row_offset = 0

        end_x = float(xs.max() + 1)
        end_y = float(ys.max() + 1)

        y = start_y
        row_index = 0
        while y < end_y:
            x = start_x
            column_index = 0
            while x < end_x:
                # Adjacent fractional cells must share an exact rounded edge.
                ix0 = max(0, int(np.floor(x + 1e-9)))
                iy0 = max(0, int(np.floor(y + 1e-9)))
                ix1 = min(w, int(np.floor(x + cell_w + 1e-9)))
                iy1 = min(h, int(np.floor(y + cell_h + 1e-9)))
                if ix1 <= ix0 and ix0 < w:
                    ix1 = ix0 + 1
                if iy1 <= iy0 and iy0 < h:
                    iy1 = iy0 + 1
                if ix1 > ix0 and iy1 > iy0:
                    yield (
                        (float(x), float(y), float(cell_w), float(cell_h)),
                        (slice(iy0, iy1), slice(ix0, ix1)),
                        grid_row_offset + row_index,
                        grid_column_offset + column_index,
                    )
                x += cell_w
                column_index += 1
            y += cell_h
            row_index += 1

    def _cross_stitch_cell_specs(
        self,
        ownership_mask: np.ndarray,
        source_mask: Optional[np.ndarray],
        settings: StitchSettings,
        ownership_override: bool = False,
        grid_origin_px: Optional[Tuple[float, float]] = None,
    ) -> List[CrossStitchCell]:
        """Describe owned cells using source occupancy to fit boundary stitches."""
        specs: List[CrossStitchCell] = []
        for cell, slices, grid_row, grid_col in self._iter_cross_grid_cells(
            ownership_mask,
            settings,
            grid_origin_px=grid_origin_px,
        ):
            ownership_patch = ownership_mask[slices] > 0
            if not np.any(ownership_patch):
                continue
            source_patch = (
                source_mask[slices]
                if source_mask is not None
                else ownership_patch
            )
            coverage = float(np.count_nonzero(source_patch)) / max(1, source_patch.size)
            if (
                not ownership_override
                and coverage + 1e-9 < float(settings.cross_coverage)
            ):
                continue
            override = classify_cross_stitch_cell(
                source_patch,
                min(float(settings.cross_coverage), 0.5),
                grid_row=grid_row,
                grid_col=grid_col,
            )
            # Shared ownership has already rejected isolated color noise. Its
            # full-cell assignment keeps connected one-pixel details stitchable.
            if (
                override == "reject"
                and ownership_override
                and np.count_nonzero(ownership_patch)
            ):
                override = None
            specs.append(CrossStitchCell(cell, coverage, override))
        return specs

    def _cross_stitch_cells(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
    ) -> List[Tuple[float, float, float, float]]:
        """Compatibility wrapper for callers expecting only accepted bounds."""
        return [
            spec.bounds
            for spec in self._cross_stitch_cell_specs(mask, mask, settings)
            if spec.method_override != "reject"
        ]

    def _cross_stitch_cell_paths(
        self,
        cell: Tuple[float, float, float, float],
        method: str,
        max_segment_px: float,
    ) -> List[List[Tuple[float, float]]]:
        x, y, w, h = cell
        tl = (x, y)
        tr = (x + w, y)
        br = (x + w, y + h)
        bl = (x, y + h)
        ml = (x, y + h / 2.0)
        mt = (x + w / 2.0, y)
        mr = (x + w, y + h / 2.0)
        mb = (x + w / 2.0, y + h)

        diagonal_a = [tl, br]
        diagonal_b = [tr, bl]
        if "flipped" in method:
            diagonal_a, diagonal_b = diagonal_b, diagonal_a

        upright_paths = [[ml, mr], [mt, mb]]
        cross_paths = [diagonal_a, diagonal_b]

        if method.startswith("half"):
            return [self._segmentized_path(diagonal_a, max_segment_px)]
        if method.startswith("upright") and "double" not in method and "smyrna" not in method:
            return [self._segmentized_path(path, max_segment_px) for path in upright_paths]
        if "double_cross" in method:
            paths = upright_paths + cross_paths
            return [self._segmentized_path(path, max_segment_px) for path in paths]
        if "smyrna" in method:
            paths = cross_paths + upright_paths
            return [self._segmentized_path(path, max_segment_px) for path in paths]
        return [self._segmentized_path(path, max_segment_px) for path in cross_paths]

    def _segmentized_path(
        self,
        coords: List[Tuple[float, float]],
        max_len: float,
    ) -> List[Tuple[float, float]]:
        if len(coords) < 2:
            return coords
        if len(coords) == 2:
            start, end = coords
            dx = float(end[0] - start[0])
            dy = float(end[1] - start[1])
            dist = float(np.hypot(dx, dy))
            limit = max(float(max_len), 1e-6)
            if dist <= limit:
                return [(float(start[0]), float(start[1])), (float(end[0]), float(end[1]))]
            steps = int(np.ceil(dist / limit))
            return [
                (
                    float(start[0] + dx * (i / steps)),
                    float(start[1] + dy * (i / steps)),
                )
                for i in range(steps + 1)
            ]
        line = LineString(coords).segmentize(max(max_len, 1e-6))
        return [(float(x), float(y)) for x, y in line.coords]

    def _generate_cross_stitch_paths(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
        source_mask: Optional[np.ndarray] = None,
        ownership_context: Optional[CrossStitchOwnershipContext] = None,
        region_uid: Optional[str] = None,
    ) -> List[List[Tuple[float, float]]]:
        occupancy_mask = source_mask if source_mask is not None else mask
        ownership_override = ownership_context is not None
        grid_origin_px = None
        dense_ownership_mask = None
        dense_grid_origin_px = None
        if ownership_context is not None:
            if region_uid is None:
                raise ValueError("Cross stitch ownership context requires a region uid")
            # Validate that the context owns this region even though its base
            # mask has already become `mask` in generate_region_paths().
            ownership_context.base_mask_for(region_uid)
            grid_origin_px = ownership_context.base_grid_origin_px
            dense_ownership_mask = ownership_context.dense_mask_for(region_uid)
            dense_grid_origin_px = ownership_context.dense_grid_origin_px

        method = settings.cross_method
        if method == "auto":
            method = self._choose_cross_stitch_method(occupancy_mask, settings, image)
        max_segment_px = settings.stitch_length_max_mm * self.px_per_mm
        cell_specs = self._cross_stitch_cell_specs(
            mask,
            occupancy_mask,
            settings,
            ownership_override=ownership_override,
            grid_origin_px=grid_origin_px,
        )
        paths: List[List[Tuple[float, float]]] = []

        rows = {}
        for spec in cell_specs:
            rows.setdefault(round(spec.bounds[1], 6), []).append(spec)

        for row_index, row_y in enumerate(sorted(rows)):
            row = sorted(
                rows[row_y],
                key=lambda spec: spec.bounds[0],
                reverse=bool(row_index % 2),
            )
            for spec in row:
                cell_method = spec.method_override or method
                paths.extend(
                    self._cross_stitch_cell_paths(
                        spec.bounds,
                        cell_method,
                        max_segment_px,
                    )
                )

        if method.startswith("dense_upright"):
            half = max(1.0, settings.cross_pattern_size_mm * self.px_per_mm / 2.0)
            dense_settings = StitchSettings.from_dict(settings.to_dict())
            dense_settings.cross_grid_offset_x_mm += half / self.px_per_mm
            dense_settings.cross_grid_offset_y_mm += half / self.px_per_mm
            dense_method = "upright_flipped" if "flipped" in method else "upright"
            if dense_ownership_mask is None:
                if ownership_context is not None:
                    raise ValueError(
                        "Dense cross stitch ownership context requires dense ownership masks"
                    )
                dense_ownership_mask = mask
            dense_specs = self._cross_stitch_cell_specs(
                dense_ownership_mask,
                occupancy_mask,
                dense_settings,
                ownership_override=ownership_override,
                grid_origin_px=dense_grid_origin_px,
            )
            for spec in dense_specs:
                # A shifted upright overlay can only reinforce cells fully
                # occupied by this source color; otherwise it would erase a
                # boundary half stitch or duplicate a neighboring color cell.
                if spec.coverage + 1e-9 < 0.85:
                    continue
                paths.extend(
                    self._cross_stitch_cell_paths(
                        spec.bounds,
                        dense_method,
                        max_segment_px,
                    )
                )

        return [path for path in paths if len(path) >= 2]

    def _generate_cross_stitch_fill(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
        source_mask: Optional[np.ndarray] = None,
        ownership_context: Optional[CrossStitchOwnershipContext] = None,
        region_uid: Optional[str] = None,
    ) -> List[Tuple[float, float]]:
        return [
            pt
            for path in self._generate_cross_stitch_paths(
                mask,
                settings,
                image,
                source_mask=source_mask,
                ownership_context=ownership_context,
                region_uid=region_uid,
            )
            for pt in path
        ]

    def _choose_cross_stitch_method(
        self,
        mask: np.ndarray,
        settings: StitchSettings,
        image: Optional[np.ndarray] = None,
    ) -> str:
        binary = mask > 0
        area = int(np.count_nonzero(binary))
        if area <= 0:
            return "cross"
        ys, xs = np.where(binary)
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        aspect = max(width, height) / max(1, min(width, height))
        boost = float(np.clip(settings.cross_detail_boost, 0.0, 1.0))

        if image is None or image.shape[:2] != mask.shape:
            return "cross"

        pixels = image[binary, :3].astype(np.float64)
        median = np.median(pixels, axis=0)
        luminance = 0.299 * median[0] + 0.587 * median[1] + 0.114 * median[2]
        chroma = float(median.max() - median.min())
        gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_RGB2GRAY)
        gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        contrast = float(np.median(np.hypot(gx[binary], gy[binary]))) if area else 0.0
        orthogonal = float(np.mean(np.abs(gx[binary]) + np.abs(gy[binary]))) if area else 0.0

        if area <= 24 and contrast >= 28:
            return "smyrna" if boost >= 0.45 else "cross"
        if luminance >= 220 and contrast < 24:
            return "half"
        if orthogonal >= 42 and aspect >= 1.4:
            return "upright"
        if contrast >= 42 and boost >= 0.65:
            return "dense_upright"
        if luminance <= 85 or (chroma >= 80 and boost >= 0.45):
            return "double_cross"
        return "cross"

    # ========== UTILITIES ==========

    def _prepare_mask(self, mask: np.ndarray, settings: StitchSettings) -> np.ndarray:
        """Normalize masks and remove isolated noise before stitch generation."""
        clean = (mask > 0).astype(np.uint8) * 255
        if np.count_nonzero(clean) == 0:
            return clean

        if settings.fill_mode == "run":
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            clean = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, kernel, iterations=1)
            min_area = max(2, int(0.08 * self.px_per_mm * self.px_per_mm))
        else:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            clean = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, kernel, iterations=1)
            min_area = max(6, int(0.2 * self.px_per_mm * self.px_per_mm))

        n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            clean, connectivity=8
        )
        filtered = np.zeros_like(clean)
        for lbl in range(1, n_labels):
            area = stats[lbl, cv2.CC_STAT_AREA]
            if area >= min_area:
                filtered[labels == lbl] = 255
        return filtered

    def _trace_skeleton_component(
        self, component: np.ndarray,
    ) -> List[List[Tuple[float, float]]]:
        """Split a skeleton component into graph edges, preserving loops.

        A previous implementation walked pixels with a global visited set. That
        cut paths at junction pixels and made later branches unable to reuse the
        same junction, leaving visible breaks. This walks unvisited graph edges
        instead, so every incident branch gets a clean endpoint at the junction
        and can be reassembled by _assemble_run_components().
        """
        ys, xs = np.where(component)
        pixels = {(int(x), int(y)) for x, y in zip(xs, ys)}
        if not pixels:
            return []

        def neighbors(pixel):
            x, y = pixel
            result = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nb = (x + dx, y + dy)
                    if nb in pixels:
                        result.append(nb)
            return result

        degree = {p: len(neighbors(p)) for p in pixels}
        nodes = {p for p, d in degree.items() if d != 2}
        visited_edges = set()
        paths = []

        def edge_key(a, b):
            return tuple(sorted((a, b)))

        def mark(a, b):
            visited_edges.add(edge_key(a, b))

        def is_marked(a, b):
            return edge_key(a, b) in visited_edges

        def choose_next(prev, current):
            options = [p for p in neighbors(current) if p != prev and not is_marked(current, p)]
            if not options:
                return None
            vx = current[0] - prev[0]
            vy = current[1] - prev[1]
            mag = np.hypot(vx, vy) + 1e-8
            vx, vy = vx / mag, vy / mag

            def score(p):
                dx = p[0] - current[0]
                dy = p[1] - current[1]
                dmag = np.hypot(dx, dy) + 1e-8
                return (dx * vx + dy * vy) / dmag

            return max(options, key=score)

        # Trace edges that begin/end at endpoints or junctions.
        for node in sorted(nodes):
            for nb in neighbors(node):
                if is_marked(node, nb):
                    continue
                path = [node, nb]
                mark(node, nb)
                prev, current = node, nb

                while current not in nodes:
                    nxt = choose_next(prev, current)
                    if nxt is None:
                        break
                    path.append(nxt)
                    mark(current, nxt)
                    prev, current = current, nxt

                if len(path) >= 2:
                    paths.append([(float(x), float(y)) for x, y in path])

        # Components with no endpoints/junctions are closed loops.
        for start in sorted(pixels):
            unused = [nb for nb in neighbors(start) if not is_marked(start, nb)]
            if not unused:
                continue
            path = [start]
            prev = None
            current = start
            while True:
                options = [p for p in neighbors(current) if p != prev and not is_marked(current, p)]
                if not options:
                    break
                nxt = options[0]
                path.append(nxt)
                mark(current, nxt)
                prev, current = current, nxt
                if current == start:
                    break
            if len(path) >= 3:
                paths.append([(float(x), float(y)) for x, y in path])

        return paths

    def _assemble_run_components(
        self,
        raw_paths: List[List[Tuple[float, float]]],
        mask: np.ndarray,
    ) -> List[List[Tuple[float, float]]]:
        """Merge skeleton graph edges into logical continuous run components."""
        min_noise_len = 0.55 * self.px_per_mm
        kept = []
        for path in raw_paths:
            if len(path) < 2:
                continue
            length = self._polyline_length(path)
            if length < min_noise_len and not self._should_close_path(path, mask):
                continue
            kept.append(self._remove_duplicate_points(path, min_dist=0.05))

        if not kept:
            return []

        merged = self._merge_directional_run_paths(
            kept,
            max_gap_px=2.6 * self.px_per_mm,
            support_mask=mask,
        )

        repaired = []
        for path in merged:
            if len(path) < 2:
                continue
            closed = self._should_close_path(path, mask)
            if closed:
                path = self._ensure_closed_path(path)
            repaired.append(path)
        return repaired

    def _should_close_path(
        self, points: List[Tuple[float, float]], mask: np.ndarray,
    ) -> bool:
        if len(points) < 4:
            return False
        gap = np.hypot(points[-1][0] - points[0][0], points[-1][1] - points[0][1])
        length = self._polyline_length(points)
        close_px = max(2.0, 1.8 * self.px_per_mm)
        if gap <= close_px:
            return True
        if length > 0 and gap / length <= 0.10 and gap <= 3.0 * self.px_per_mm:
            return True

        # Closed bitmap islands should become closed run loops if endpoints are near.
        contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        has_hole = hierarchy is not None and any(h[3] >= 0 for h in hierarchy[0])
        return bool(has_hole and gap <= 3.2 * self.px_per_mm)

    def _merge_close_run_paths(
        self,
        paths: List[List[Tuple[float, float]]],
        max_gap_px: float,
        support_mask: Optional[np.ndarray] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Heal small line-art gaps while avoiding long accidental connectors."""
        changed = True
        paths = [p[:] for p in paths if len(p) >= 2]
        while changed:
            changed = False
            best = None
            for i in range(len(paths)):
                for j in range(i + 1, len(paths)):
                    match = self._best_endpoint_match(paths[i], paths[j], max_gap_px)
                    if match is None:
                        continue
                    _, endpoint_a, endpoint_b, _ = match
                    point_a = paths[i][-1] if endpoint_a == 1 else paths[i][0]
                    point_b = paths[j][0] if endpoint_b == 0 else paths[j][-1]
                    if (
                        support_mask is not None
                        and not self._run_connector_has_mask_support(
                            point_a,
                            point_b,
                            support_mask,
                        )
                    ):
                        continue
                    score = match[0] + match[3] * self.px_per_mm
                    if best is None or score < best[0]:
                        best = (score, i, j, match[1], match[2])
            if best is None:
                break
            _, i, j, a, b = best
            merged = self._join_paths(paths[i], paths[j], a, b)
            paths[i] = merged
            del paths[j]
            changed = True
        return paths

    def _merge_directional_run_paths(
        self,
        paths: List[List[Tuple[float, float]]],
        max_gap_px: float,
        support_mask: Optional[np.ndarray] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Join aligned endpoints while leaving unrelated marks as jump paths."""
        paths = [path[:] for path in paths if len(path) >= 2]
        max_turn = np.deg2rad(58.0)
        near_touch = 0.25 * self.px_per_mm
        while True:
            best = None
            for i in range(len(paths)):
                for j in range(i + 1, len(paths)):
                    match = self._best_endpoint_match(
                        paths[i],
                        paths[j],
                        max_gap_px,
                    )
                    if match is None:
                        continue
                    gap, endpoint_a, endpoint_b, turn = match
                    if turn > max_turn and gap > near_touch:
                        continue
                    point_a = (
                        paths[i][-1] if endpoint_a == 1 else paths[i][0]
                    )
                    point_b = (
                        paths[j][0] if endpoint_b == 0 else paths[j][-1]
                    )
                    if (
                        support_mask is not None
                        and not self._run_connector_has_mask_support(
                            point_a,
                            point_b,
                            support_mask,
                        )
                    ):
                        continue
                    score = gap + turn * self.px_per_mm
                    if best is None or score < best[0]:
                        best = (
                            score,
                            i,
                            j,
                            endpoint_a,
                            endpoint_b,
                        )
            if best is None:
                return paths
            _, i, j, endpoint_a, endpoint_b = best
            paths[i] = self._join_paths(
                paths[i],
                paths[j],
                endpoint_a,
                endpoint_b,
            )
            del paths[j]

    @staticmethod
    def _run_connector_has_mask_support(
        start: Tuple[float, float],
        end: Tuple[float, float],
        mask: np.ndarray,
    ) -> bool:
        """Require a prospective sewn connector to follow recognized line art."""
        distance = float(np.hypot(end[0] - start[0], end[1] - start[1]))
        if distance <= 1.5:
            return True

        supported = cv2.dilate(
            (mask > 0).astype(np.uint8),
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
            iterations=1,
        ) > 0
        count = max(3, int(np.ceil(distance * 2.0)) + 1)
        xs = np.linspace(start[0], end[0], count)
        ys = np.linspace(start[1], end[1], count)
        ix = np.clip(np.rint(xs).astype(np.int32), 0, mask.shape[1] - 1)
        iy = np.clip(np.rint(ys).astype(np.int32), 0, mask.shape[0] - 1)
        return float(np.count_nonzero(supported[iy, ix])) / count >= 0.8

    def _best_endpoint_match(self, a, b, max_gap):
        ends_a = [a[0], a[-1]]
        ends_b = [b[0], b[-1]]
        best = None
        for ia, pa in enumerate(ends_a):
            for ib, pb in enumerate(ends_b):
                gap = float(np.hypot(pa[0] - pb[0], pa[1] - pb[1]))
                if gap > max_gap:
                    continue
                left = a[:] if ia == 1 else a[::-1]
                right = b[:] if ib == 0 else b[::-1]
                angle = self._path_end_angle(left) - self._path_start_angle(right)
                angle = abs((angle + np.pi) % (2 * np.pi) - np.pi)
                # Allow near-touching endpoints even at a sharp angle. This keeps
                # junctions connected without inventing long diagonal bridges.
                if angle <= np.deg2rad(68) or gap <= 1.25 * self.px_per_mm:
                    if best is None or gap + angle * self.px_per_mm < best[0] + best[3] * self.px_per_mm:
                        best = (gap, ia, ib, angle)
        return best

    def _endpoint_angle(self, path, end_index):
        if len(path) < 2:
            return 0.0
        if end_index == 0:
            p0, p1 = path[1], path[0]
        else:
            p0, p1 = path[-2], path[-1]
        return float(np.arctan2(p1[1] - p0[1], p1[0] - p0[0]))

    def _path_start_angle(self, path):
        if len(path) < 2:
            return 0.0
        p0, p1 = path[0], path[1]
        return float(np.arctan2(p1[1] - p0[1], p1[0] - p0[0]))

    def _path_end_angle(self, path):
        if len(path) < 2:
            return 0.0
        p0, p1 = path[-2], path[-1]
        return float(np.arctan2(p1[1] - p0[1], p1[0] - p0[0]))

    def _join_paths(self, a, b, end_a, end_b):
        left = a[:] if end_a == 1 else a[::-1]
        right = b[:] if end_b == 0 else b[::-1]
        gap = np.hypot(left[-1][0] - right[0][0], left[-1][1] - right[0][1])
        if gap <= 0.25:
            return left + right[1:]
        if gap <= 2.6 * self.px_per_mm:
            bridge = (
                (left[-1][0] * 0.5 + right[0][0] * 0.5),
                (left[-1][1] * 0.5 + right[0][1] * 0.5),
            )
            return left + [bridge] + right
        return left + right

    def _acute_tip_ring(
        self,
        mask: np.ndarray,
        poly: Polygon,
        source_polygon: Optional[Polygon] = None,
    ) -> List[Tuple[float, float]]:
        """Return the boundary ring used to detect acute fill caps."""
        if source_polygon is not None and not source_polygon.is_empty and hasattr(poly, "exterior"):
            return [(float(x), float(y)) for x, y in poly.exterior.coords[:-1]]

        clean = (mask > 0).astype(np.uint8) * 255
        contours, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not contours:
            return []
        contour = max(contours, key=cv2.contourArea)
        epsilon = max(0.8, 0.16 * self.px_per_mm)
        approx = cv2.approxPolyDP(contour, epsilon, closed=True)
        return [(float(pt[0][0]), float(pt[0][1])) for pt in approx]

    def _remove_duplicate_points(
        self,
        points: List[Tuple[float, float]],
        min_dist: float = 0.1,
    ) -> List[Tuple[float, float]]:
        if not points:
            return []
        result = [points[0]]
        for pt in points[1:]:
            if np.hypot(pt[0] - result[-1][0], pt[1] - result[-1][1]) >= min_dist:
                result.append(pt)
        return result

    def _ensure_closed_path(
        self,
        points: List[Tuple[float, float]],
    ) -> List[Tuple[float, float]]:
        if len(points) < 2:
            return points
        if np.hypot(points[-1][0] - points[0][0], points[-1][1] - points[0][1]) <= 1e-6:
            return points
        return points + [points[0]]

    def _chain_fill_rows(
        self,
        paths: List[List[Tuple[float, float]]],
        max_gap_px: float,
        containment_polygon: Optional[Polygon] = None,
    ) -> List[List[Tuple[float, float]]]:
        """Join adjacent fill rows into boustrophedon components.

        Export treats every path boundary as a jump. Scanline fill naturally
        has many rows, but adjacent rows are meant to be connected inside the
        filled object. Chaining nearby rows preserves island boundaries while
        preventing one jump per row in dense tatami/scanline fills.
        """
        chains: List[List[Tuple[float, float]]] = []
        current: List[Tuple[float, float]] = []

        for path in paths:
            if len(path) < 2:
                continue
            if not current:
                current = path[:]
                continue

            forward_gap = float(np.hypot(
                current[-1][0] - path[0][0],
                current[-1][1] - path[0][1],
            ))
            reverse_gap = float(np.hypot(
                current[-1][0] - path[-1][0],
                current[-1][1] - path[-1][1],
            ))

            if min(forward_gap, reverse_gap) <= max_gap_px:
                next_path = path if forward_gap <= reverse_gap else path[::-1]
                if not self._fill_row_connector_is_inside(
                    current[-1],
                    next_path[0],
                    containment_polygon,
                ):
                    chains.append(current)
                    current = path[:]
                    continue
                current.extend(next_path)
            else:
                chains.append(current)
                current = path[:]

        if current:
            chains.append(current)
        return chains

    def _fill_row_connector_is_inside(
        self,
        start: Tuple[float, float],
        end: Tuple[float, float],
        containment_polygon: Optional[Polygon],
    ) -> bool:
        if containment_polygon is None or containment_polygon.is_empty:
            return True
        connector = LineString([start, end])
        if connector.length <= 0.25:
            return True
        safe_area = containment_polygon.buffer(0.35, join_style=2)
        if not safe_area.covers(connector):
            return False
        if hasattr(containment_polygon, "interiors"):
            for ring in containment_polygon.interiors:
                hole = Polygon(ring)
                if connector.crosses(hole) or connector.within(hole):
                    return False
        return True

    def _polyline_length(self, points: List[Tuple[float, float]]) -> float:
        if len(points) < 2:
            return 0.0
        pts = np.array(points, dtype=np.float64)
        return float(np.sqrt((np.diff(pts, axis=0) ** 2).sum(axis=1)).sum())

    def _polygon_for_fill(
        self,
        mask: np.ndarray,
        compensation_mm: float,
        polygon: Optional[Polygon] = None,
    ) -> Optional[Polygon]:
        if polygon is not None and not polygon.is_empty:
            poly = polygon
            if compensation_mm > 0:
                poly = poly.buffer(compensation_mm * self.px_per_mm, join_style=1)
            if not poly.is_valid:
                poly = poly.buffer(0)
            return None if poly.is_empty else poly
        return self._mask_to_polygon(mask, compensation_mm)

    def _smooth_polyline(
        self,
        points: List[Tuple[float, float]],
        closed: bool = False,
        iterations: int = 1,
    ) -> List[Tuple[float, float]]:
        if len(points) < 3:
            return points
        result = points[:]
        for _ in range(iterations):
            source = result[:]
            if closed and source[0] != source[-1]:
                source.append(source[0])
            smoothed = []
            if not closed:
                smoothed.append(source[0])
            limit = len(source) - 1
            for i in range(limit):
                p0 = np.array(source[i], dtype=np.float64)
                p1 = np.array(source[(i + 1) % len(source)], dtype=np.float64)
                q = 0.75 * p0 + 0.25 * p1
                r = 0.25 * p0 + 0.75 * p1
                smoothed.append((float(q[0]), float(q[1])))
                smoothed.append((float(r[0]), float(r[1])))
            if not closed:
                smoothed.append(source[-1])
            elif smoothed:
                smoothed.append(smoothed[0])
            result = smoothed
        return result

    def _mask_to_polygon(self, mask: np.ndarray, compensation_mm: float = 0) -> Optional[Polygon]:
        """Convert a binary mask without losing holes or separate islands."""
        clean = (mask > 0).astype(np.uint8) * 255
        if np.count_nonzero(clean) == 0:
            return None

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        clean = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, kernel, iterations=1)
        contours, hierarchy = cv2.findContours(
            clean, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
        )
        if not contours or hierarchy is None:
            return None

        epsilon = max(0.9, 0.18 * self.px_per_mm)
        hierarchy = hierarchy[0]
        polygons = []
        for contour_index, contour in enumerate(contours):
            if hierarchy[contour_index][3] != -1:
                continue
            outer = cv2.approxPolyDP(contour, epsilon, closed=True)
            outer_points = outer[:, 0, :].tolist()
            if len(outer_points) < 3:
                continue

            holes = []
            child_index = int(hierarchy[contour_index][2])
            while child_index != -1:
                hole = cv2.approxPolyDP(
                    contours[child_index],
                    epsilon,
                    closed=True,
                )
                hole_points = hole[:, 0, :].tolist()
                if len(hole_points) >= 3:
                    holes.append(hole_points)
                child_index = int(hierarchy[child_index][0])

            polygon = Polygon(outer_points, holes)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            if not polygon.is_empty:
                polygons.append(polygon)

        if not polygons:
            return None

        poly = unary_union(polygons)

        # Apply pull compensation (expand polygon)
        if compensation_mm > 0:
            comp_px = compensation_mm * self.px_per_mm
            poly = poly.buffer(comp_px, join_style=1)

        smooth_px = max(0.5, 0.16 * self.px_per_mm)
        poly = poly.buffer(smooth_px, quad_segs=8, join_style=1).buffer(
            -smooth_px,
            quad_segs=8,
            join_style=1,
        )
        if not poly.is_valid:
            poly = poly.buffer(0)
        simplify_px = max(1.2, 0.30 * self.px_per_mm)
        poly = poly.simplify(simplify_px, preserve_topology=True)

        components = list(poly.geoms) if hasattr(poly, "geoms") else [poly]
        regularized = []
        for component in components:
            if component.is_empty or not hasattr(component, "exterior"):
                continue
            if component.area >= 500 and not self._has_acute_vertices(component):
                component = self._smooth_polygon(component, iterations=2)
            regularized.append(component)
        if not regularized:
            return None
        poly = unary_union(regularized)

        return poly

    def _has_acute_vertices(self, poly: Polygon, threshold_deg: float = 55.0) -> bool:
        """Detect sharp corners that should not be rounded away."""
        if poly.is_empty or not hasattr(poly, "exterior"):
            return False
        coords = list(poly.exterior.coords)
        if len(coords) < 4:
            return False
        pts = [np.array(pt, dtype=np.float64) for pt in coords[:-1]]
        threshold = np.deg2rad(threshold_deg)
        min_edge_len = max(8.0, 2.0 * self.px_per_mm)
        for i, current in enumerate(pts):
            prev_pt = pts[i - 1]
            next_pt = pts[(i + 1) % len(pts)]
            v1 = prev_pt - current
            v2 = next_pt - current
            len1 = float(np.linalg.norm(v1))
            len2 = float(np.linalg.norm(v2))
            if len1 < min_edge_len or len2 < min_edge_len:
                continue
            angle = float(np.arccos(np.clip(np.dot(v1, v2) / max(1e-6, len1 * len2), -1.0, 1.0)))
            if angle <= threshold:
                return True
        return False

    def _smooth_polygon(self, poly: Polygon, iterations: int = 1) -> Polygon:
        """Round polygon corners into embroidery-friendly curves."""
        if poly.is_empty or not hasattr(poly, "exterior"):
            return poly

        exterior = self._chaikin_ring(list(poly.exterior.coords), iterations)
        interiors = [
            self._chaikin_ring(list(ring.coords), iterations)
            for ring in poly.interiors
            if len(ring.coords) >= 4
        ]
        smoothed = Polygon(exterior, interiors)
        if not smoothed.is_valid:
            smoothed = smoothed.buffer(0)
        if hasattr(smoothed, "geoms"):
            smoothed = max(smoothed.geoms, key=lambda geom: geom.area)
        return smoothed if not smoothed.is_empty else poly

    def _chaikin_ring(
        self,
        coords: List[Tuple[float, float]],
        iterations: int,
    ) -> List[Tuple[float, float]]:
        if len(coords) < 4:
            return coords
        ring = [(float(x), float(y)) for x, y in coords[:-1]]
        for _ in range(iterations):
            next_ring = []
            for i, p0 in enumerate(ring):
                p1 = ring[(i + 1) % len(ring)]
                q = (0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1])
                r = (0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1])
                next_ring.extend([q, r])
            ring = next_ring
        ring.append(ring[0])
        return ring

    def _resample_line(
        self,
        coords: List[Tuple[float, float]],
        stitch_len: float,
        randomize: float = 0,
    ) -> List[Tuple[float, float]]:
        """Resample a polyline at regular stitch-length intervals."""
        if len(coords) < 2:
            return list(coords)

        # Compute cumulative distances
        pts = np.array(coords)
        diffs = np.diff(pts, axis=0)
        dists = np.sqrt((diffs ** 2).sum(axis=1))
        cum_dists = np.concatenate([[0], np.cumsum(dists)])
        total = cum_dists[-1]

        if total < stitch_len:
            return [tuple(pts[0]), tuple(pts[-1])]

        rng = np.random.RandomState(42)
        result = []
        d = 0
        while d <= total:
            # Interpolate position at distance d
            idx = np.searchsorted(cum_dists, d, side='right') - 1
            idx = max(0, min(idx, len(pts) - 2))

            seg_start = cum_dists[idx]
            seg_len = dists[idx] if idx < len(dists) else 1.0
            if seg_len < 1e-8:
                result.append(tuple(pts[idx]))
            else:
                t = (d - seg_start) / seg_len
                t = max(0, min(1, t))
                p = pts[idx] + t * (pts[idx + 1] - pts[idx])
                result.append((float(p[0]), float(p[1])))

            # Advance by stitch_len (with optional randomization)
            step = stitch_len
            if randomize > 0:
                step *= (1 + randomize * (rng.random() - 0.5))
            d += step

        if result:
            last = tuple(pts[-1])
            if np.hypot(result[-1][0] - last[0], result[-1][1] - last[1]) > 1e-6:
                result.append((float(last[0]), float(last[1])))

        return result

    def _order_skeleton_points(self, xs, ys) -> List[Tuple[float, float]]:
        """Simple nearest-neighbor ordering of skeleton points."""
        points = list(zip(xs.astype(float), ys.astype(float)))
        if len(points) <= 2:
            return points

        ordered = [points[0]]
        remaining = set(range(1, len(points)))

        for _ in range(min(len(points) - 1, 2000)):
            if not remaining:
                break
            last = ordered[-1]
            best = min(remaining, key=lambda i: (points[i][0] - last[0]) ** 2 + (points[i][1] - last[1]) ** 2)
            ordered.append(points[best])
            remaining.remove(best)

        return ordered
