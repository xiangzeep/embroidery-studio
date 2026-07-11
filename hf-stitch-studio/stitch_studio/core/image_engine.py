"""
Image Processing Engine
Handles image loading, adjustment, color quantization to thread palette,
segmentation into regions, and flow field computation.
"""

import numpy as np
import cv2
from typing import List, Tuple, Optional, Dict
from PIL import Image, ImageEnhance, ImageFilter
from scipy.ndimage import gaussian_filter
from skimage.color import rgb2lab, deltaE_ciede2000
from sklearn.cluster import KMeans

from .project import ImageSettings, QuantizationSettings, Layer, Region, StitchSettings
from .thread_db import ThreadColor


class ImageEngine:
    """Processes source images into embroidery-ready data."""

    @staticmethod
    def load_image(filepath: str) -> np.ndarray:
        """Load image file as RGB numpy array."""
        img = Image.open(filepath).convert('RGB')
        return np.array(img)

    @staticmethod
    def apply_adjustments(image: np.ndarray, settings: ImageSettings) -> np.ndarray:
        """Apply brightness, contrast, saturation, sharpness, blur adjustments."""
        img = Image.fromarray(image)

        # Crop
        if settings.crop_rect:
            x, y, w, h = settings.crop_rect
            img = img.crop((x, y, x + w, y + h))

        # Resize
        if settings.resize_width > 0 and settings.resize_height > 0:
            img = img.resize((settings.resize_width, settings.resize_height),
                             Image.LANCZOS)

        # Brightness
        if settings.brightness != 0:
            enhancer = ImageEnhance.Brightness(img)
            img = enhancer.enhance(1.0 + settings.brightness)

        # Contrast
        if settings.contrast != 1.0:
            enhancer = ImageEnhance.Contrast(img)
            img = enhancer.enhance(settings.contrast)

        # Saturation
        if settings.saturation != 1.0:
            enhancer = ImageEnhance.Color(img)
            img = enhancer.enhance(settings.saturation)

        # Sharpness
        if settings.sharpness > 0:
            enhancer = ImageEnhance.Sharpness(img)
            img = enhancer.enhance(1.0 + settings.sharpness)

        # Blur
        if settings.blur > 0:
            img = img.filter(ImageFilter.GaussianBlur(radius=settings.blur))

        return np.array(img)

    @staticmethod
    def quantize_to_palette(
        image: np.ndarray,
        palette_threads: List[ThreadColor],
        settings: QuantizationSettings,
    ) -> Tuple[np.ndarray, List[int]]:
        """
        Quantize image colors to nearest threads from palette.

        Returns:
            thread_map: H×W array of thread indices into palette_threads
            used_indices: list of palette indices actually used
        """
        h, w = image.shape[:2]
        pixels = image.reshape(-1, 3).astype(np.float64)

        # Step 1: K-means clustering in LAB space
        pixels_lab = rgb2lab(image.astype(np.float64) / 255.0).reshape(-1, 3)

        n_clusters = min(settings.n_colors, len(palette_threads))
        kmeans = KMeans(n_clusters=n_clusters, n_init=10, random_state=42, max_iter=100)
        labels = kmeans.fit_predict(pixels_lab)
        cluster_centers = kmeans.cluster_centers_  # in LAB

        # Step 2: Match each cluster center to nearest thread (CIEDE2000)
        palette_rgb = np.array([t.color_rgb for t in palette_threads], dtype=np.float64)
        palette_lab = rgb2lab(palette_rgb.reshape(1, -1, 3) / 255.0)[0]  # N×3

        assignments = []
        for center in cluster_centers:
            dists = deltaE_ciede2000(
                center.reshape(1, 1, 3),
                palette_lab.reshape(1, -1, 3)
            )[0]
            best_idx = int(np.argmin(dists))
            assignments.append(best_idx)

        # Step 3: Map pixels to thread indices
        thread_map = np.array(assignments)[labels].reshape(h, w)

        # Deduplicate: if multiple clusters map to same thread
        used_indices = sorted(set(assignments))

        return thread_map, used_indices

    @staticmethod
    def segment_regions(
        thread_map: np.ndarray,
        settings: QuantizationSettings,
        source_image: Optional[np.ndarray] = None,
    ) -> List[Tuple[int, np.ndarray]]:
        """
        Segment thread_map into connected regions.

        Returns:
            list of (thread_idx, mask) tuples where mask is H×W uint8
        """
        regions = []
        foreground = None
        if source_image is not None:
            foreground = ~ImageEngine._detect_background_mask(source_image)

        kernel_size = settings.morphology_kernel_size
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                           (kernel_size, kernel_size))

        for tid in np.unique(thread_map):
            binary = (thread_map == tid).astype(np.uint8)
            if foreground is not None:
                binary = (binary & foreground.astype(np.uint8)).astype(np.uint8)
                if int(binary.sum()) == 0:
                    continue

            if settings.smooth_regions:
                binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
                # Avoid MORPH_OPEN here: line-art strokes in the butterfly
                # sample are often only a few pixels wide and opening with the
                # default 5px kernel erases them before run-stitch generation.

            n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
                binary, connectivity=8
            )

            for lbl in range(1, n_labels):
                area = stats[lbl, cv2.CC_STAT_AREA]
                if area >= settings.min_region_area_px:
                    mask = (labels == lbl).astype(np.uint8) * 255
                    regions.append((int(tid), mask))

        # Sort by area (largest first = background first)
        regions.sort(key=lambda x: x[1].sum(), reverse=True)
        return regions

    @staticmethod
    def _detect_background_mask(image: np.ndarray) -> np.ndarray:
        """Detect the dominant canvas/background from image borders.

        Uploaded art commonly sits on white, black, or gray canvas. K-means
        otherwise turns that canvas into a large stitch region, which then
        covers the design and explodes jump/color counts. Border-connected
        color matching removes only that canvas while preserving interior dark
        outlines or highlights.
        """
        if image.ndim != 3 or image.shape[2] < 3:
            return np.zeros(image.shape[:2], dtype=bool)

        h, w = image.shape[:2]
        if h == 0 or w == 0:
            return np.zeros((h, w), dtype=bool)

        rgb = image[:, :, :3].astype(np.int16)
        border = np.concatenate([
            rgb[0, :, :],
            rgb[-1, :, :],
            rgb[:, 0, :],
            rgb[:, -1, :],
        ], axis=0)
        # Median is robust when a foreground stroke touches a small border area.
        bg = np.median(border, axis=0)
        dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
        luminance = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2])
        chroma = rgb.max(axis=2) - rgb.min(axis=2)

        # First pass: dominant border color. The tolerance covers antialiased
        # canvas edges without swallowing saturated artwork.
        candidate = dist <= 36
        neutral_canvas = (chroma <= 18) & ((luminance >= 238) | (luminance <= 24))
        candidate |= neutral_canvas

        # Keep only components that are actually connected to the image border.
        n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            candidate.astype(np.uint8), connectivity=8
        )
        background = np.zeros((h, w), dtype=bool)
        image_area = h * w
        for lbl in range(1, n_labels):
            touches_border = (
                np.any(labels[0, :] == lbl) or
                np.any(labels[-1, :] == lbl) or
                np.any(labels[:, 0] == lbl) or
                np.any(labels[:, -1] == lbl)
            )
            area = stats[lbl, cv2.CC_STAT_AREA]
            if touches_border and area >= max(4, int(0.01 * image_area)):
                background[labels == lbl] = True
        return background

    @staticmethod
    def build_layers_from_regions(
        regions: List[Tuple[int, np.ndarray]],
        palette_threads: List[ThreadColor],
    ) -> List[Layer]:
        """Group regions by thread color into layers."""
        layer_map = {}  # thread_idx -> Layer
        if not regions:
            return []

        image_area = regions[0][1].shape[0] * regions[0][1].shape[1]
        min_layer_area = max(3, int(0.0005 * image_area))

        for tid, mask in regions:
            if int(np.count_nonzero(mask)) < min_layer_area:
                continue
            if tid not in layer_map:
                thread = palette_threads[tid] if tid < len(palette_threads) else None
                layer = Layer(
                    name=thread.name if thread else f"Color {tid}",
                    thread_uid=thread.uid if thread else "",
                    thread_color_rgb=thread.color_rgb if thread else (128, 128, 128),
                    thread_name=thread.name if thread else f"Color {tid}",
                )
                layer_map[tid] = layer

            region = Region(
                name=f"{layer_map[tid].name} region {len(layer_map[tid].regions) + 1}",
                mask=mask,
            )
            region.stitch_settings = ImageEngine._default_stitch_settings_for_mask(mask)
            layer_map[tid].add_region(region)

        ImageEngine._merge_tiny_similar_layers(layer_map, image_area)

        # Sort layers: largest area (background) first
        layers = sorted(layer_map.values(),
                        key=lambda l: sum(r.mask.sum() for r in l.regions if r.mask is not None),
                        reverse=True)

        for i, layer in enumerate(layers):
            layer.order = i

        return layers

    @staticmethod
    def _merge_tiny_similar_layers(layer_map: Dict[int, Layer], image_area: int):
        """Fold antialias slivers into nearby main colors instead of threads."""
        if len(layer_map) <= 1:
            return

        def layer_area(layer: Layer) -> int:
            return int(sum(np.count_nonzero(r.mask) for r in layer.regions if r.mask is not None))

        layers = list(layer_map.items())
        areas = {tid: layer_area(layer) for tid, layer in layers}
        tiny_limit = max(8, int(0.004 * image_area))

        for tid, layer in list(layers):
            area = areas.get(tid, 0)
            if area <= 0 or area > tiny_limit:
                continue
            color = np.array(layer.thread_color_rgb, dtype=np.float64)
            candidates = []
            for other_tid, other in layer_map.items():
                if other_tid == tid or areas.get(other_tid, 0) <= area:
                    continue
                other_color = np.array(other.thread_color_rgb, dtype=np.float64)
                dist = float(np.linalg.norm(color - other_color))
                if dist <= 58:
                    candidates.append((dist, other_tid, other))
            if not candidates:
                continue
            _, target_tid, target = min(candidates, key=lambda item: item[0])
            for region in layer.regions:
                region.name = f"{target.name} region {len(target.regions) + 1}"
                target.add_region(region)
            del layer_map[tid]

    @staticmethod
    def _default_stitch_settings_for_mask(mask: np.ndarray) -> StitchSettings:
        """Choose an initial stitch mode from region geometry."""
        binary = (mask > 0).astype(np.uint8)
        area = int(binary.sum())
        if area <= 0:
            return StitchSettings(fill_mode="none", underlay=False)

        ys, xs = np.where(binary > 0)
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        bbox_area = max(1, width * height)
        fill_ratio = area / bbox_area
        dt = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
        nonzero_dt = dt[dt > 0]
        median_width_px = float(np.median(nonzero_dt) * 2) if nonzero_dt.size else 0.0
        max_width_px = float(dt.max() * 2)
        long_axis = max(width, height)
        short_axis = max(1, min(width, height))
        aspect = long_axis / short_axis

        is_thin_stroke = (
            area >= 8 and
            long_axis >= 12 and
            (
                median_width_px <= 5.0 or
                (fill_ratio < 0.34 and aspect >= 2.0 and max_width_px <= 12.0)
            )
        )

        if is_thin_stroke:
            return StitchSettings(
                fill_mode="run",
                stitch_length_mm=2.0,
                stitch_length_min_mm=1.0,
                stitch_length_max_mm=2.5,
                row_spacing_mm=0.4,
                density=1.0,
                underlay=False,
                contour_count=0,
                pull_compensation_mm=0.0,
            )

        return StitchSettings(
            fill_mode="scanline",
            stitch_length_mm=2.2,
            row_spacing_mm=0.24,
            density=1.25,
            underlay=False,
            underlay_density=0.25,
            contour_count=0,
            pull_compensation_mm=0.12,
        )


class FlowFieldEngine:
    """Computes orientation/flow fields for direction-aware stitch generation."""

    @staticmethod
    def compute_structure_tensor(image: np.ndarray, sigma: float = 2.0) -> Tuple[np.ndarray, np.ndarray]:
        """
        Compute dominant local orientation from image structure tensor.

        Returns:
            orientation: H×W array of angles in radians
            coherence: H×W array [0,1] - reliability of orientation
        """
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).astype(np.float64) / 255.0

        # Image gradients
        Ix = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        Iy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)

        # Structure tensor components (smoothed)
        Jxx = gaussian_filter(Ix * Ix, sigma)
        Jxy = gaussian_filter(Ix * Iy, sigma)
        Jyy = gaussian_filter(Iy * Iy, sigma)

        # Dominant orientation: minor eigenvector angle (tangent to edges)
        orientation = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy) + np.pi / 2

        # Coherence measure
        denom = Jxx + Jyy + 1e-8
        coherence = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / denom

        return orientation, coherence

    @staticmethod
    def smooth_orientation(orientation: np.ndarray, n_iters: int = 5,
                           sigma: float = 3.0) -> np.ndarray:
        """Smooth orientation field handling pi-periodicity via double-angle trick."""
        cos2 = np.cos(2 * orientation)
        sin2 = np.sin(2 * orientation)
        for _ in range(n_iters):
            cos2 = gaussian_filter(cos2, sigma)
            sin2 = gaussian_filter(sin2, sigma)
        return 0.5 * np.arctan2(sin2, cos2)

    @staticmethod
    def compute_edge_flow(image: np.ndarray, sigma: float = 1.5) -> Tuple[np.ndarray, np.ndarray]:
        """
        Compute a flow field from edge tangent directions.
        Good for making stitches follow contours of the image content.

        Returns:
            flow_x, flow_y: H×W arrays of flow direction components
        """
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).astype(np.float64)
        gray = gaussian_filter(gray, sigma)

        gy, gx = np.gradient(gray)

        # Edge tangent = perpendicular to gradient
        flow_x = -gy  # perpendicular
        flow_y = gx

        # Normalize
        mag = np.sqrt(flow_x ** 2 + flow_y ** 2) + 1e-8
        flow_x /= mag
        flow_y /= mag

        return flow_x, flow_y

    @staticmethod
    def compute_radial_flow(shape: Tuple[int, int],
                            center: Optional[Tuple[float, float]] = None) -> Tuple[np.ndarray, np.ndarray]:
        """Radial flow field emanating from center point."""
        h, w = shape
        if center is None:
            center = (w / 2, h / 2)
        cx, cy = center

        ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
        dx = xs - cx
        dy = ys - cy
        mag = np.sqrt(dx ** 2 + dy ** 2) + 1e-8

        return dx / mag, dy / mag

    @staticmethod
    def blend_flow_fields(
        flow1: Tuple[np.ndarray, np.ndarray],
        flow2: Tuple[np.ndarray, np.ndarray],
        alpha: float = 0.5,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Blend two flow fields. alpha=0 → all flow1, alpha=1 → all flow2."""
        fx = (1 - alpha) * flow1[0] + alpha * flow2[0]
        fy = (1 - alpha) * flow1[1] + alpha * flow2[1]
        mag = np.sqrt(fx ** 2 + fy ** 2) + 1e-8
        return fx / mag, fy / mag
