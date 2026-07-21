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
from sklearn.cluster import KMeans, MiniBatchKMeans

from .project import ImageSettings, QuantizationSettings, Layer, Region, StitchSettings
from .thread_db import ThreadColor
from .geometry_engine import GeometryEngine


class ImageEngine:
    """Processes source images into embroidery-ready data."""

    @staticmethod
    def load_image(filepath: str, max_pixels: int = 2_250_000) -> np.ndarray:
        """Load image file as RGB numpy array."""
        img = Image.open(filepath).convert('RGB')
        if max_pixels and img.width * img.height > max_pixels:
            scale = (max_pixels / float(img.width * img.height)) ** 0.5
            size = (
                max(1, int(img.width * scale)),
                max(1, int(img.height * scale)),
            )
            img = img.resize(size, Image.LANCZOS)
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
        if pixels_lab.shape[0] > 250_000:
            kmeans = MiniBatchKMeans(
                n_clusters=n_clusters,
                n_init=3,
                random_state=42,
                max_iter=60,
                batch_size=8192,
            )
        else:
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

        black_thread_idx = ImageEngine._find_black_thread_index(palette_threads)
        if black_thread_idx is not None:
            rgb = image[:, :, :3].astype(np.int16)
            luminance = (
                0.299 * rgb[:, :, 0] +
                0.587 * rgb[:, :, 1] +
                0.114 * rgb[:, :, 2]
            )
            chroma = rgb.max(axis=2) - rgb.min(axis=2)
            near_black = (luminance <= 38) & (chroma <= 28)
            outline_black = ImageEngine._expand_black_outline_pixels(
                near_black,
                luminance,
                chroma,
            )
            thread_map[outline_black] = black_thread_idx
            assignments.append(black_thread_idx)

        # Deduplicate: if multiple clusters map to same thread
        used_indices = sorted(set(assignments))

        return thread_map, used_indices

    @staticmethod
    def _expand_black_outline_pixels(
        near_black: np.ndarray,
        luminance: np.ndarray,
        chroma: np.ndarray,
    ) -> np.ndarray:
        """Absorb dark antialias pixels immediately attached to black artwork."""
        if not np.any(near_black):
            return near_black

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        dark_edge = (luminance <= 96) & (chroma <= 90)
        near_outline = cv2.dilate(near_black.astype(np.uint8), kernel, iterations=1).astype(bool)
        candidates = (near_outline & dark_edge & ~near_black).astype(np.uint8)
        n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(candidates, connectivity=8)

        absorbed = near_black.copy()
        for lbl in range(1, n_labels):
            area = int(stats[lbl, cv2.CC_STAT_AREA])
            width = int(stats[lbl, cv2.CC_STAT_WIDTH])
            height = int(stats[lbl, cv2.CC_STAT_HEIGHT])
            short_axis = min(width, height)
            long_axis = max(width, height)
            is_antialias_edge = (
                area <= 45 or
                short_axis <= 3 or
                (area <= 90 and long_axis >= short_axis * 3)
            )
            if is_antialias_edge:
                absorbed[labels == lbl] = True

        return absorbed

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
        protected_black = None
        black_tids = set()
        if source_image is not None:
            protected_black = ImageEngine._protected_black_art_mask(source_image, foreground)
            if np.any(protected_black):
                black_tids = {int(tid) for tid in np.unique(thread_map[protected_black])}

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

            if protected_black is not None and black_tids:
                if int(tid) in black_tids:
                    binary = (binary.astype(bool) | protected_black).astype(np.uint8)
                else:
                    binary = (binary.astype(bool) & ~protected_black).astype(np.uint8)
                if int(binary.sum()) == 0:
                    continue

            n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
                binary, connectivity=8
            )

            for lbl in range(1, n_labels):
                area = stats[lbl, cv2.CC_STAT_AREA]
                min_area = ImageEngine._component_min_area(
                    source_image,
                    labels,
                    lbl,
                    settings.min_region_area_px,
                )
                if area >= min_area:
                    mask = (labels == lbl).astype(np.uint8) * 255
                    regions.append((int(tid), mask))

        # Sort by area (largest first = background first)
        regions.sort(key=lambda x: x[1].sum(), reverse=True)
        return regions

    @staticmethod
    def _protected_black_art_mask(
        image: np.ndarray,
        foreground: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        rgb = image[:, :, :3].astype(np.int16)
        luminance = (
            0.299 * rgb[:, :, 0] +
            0.587 * rgb[:, :, 1] +
            0.114 * rgb[:, :, 2]
        )
        chroma = rgb.max(axis=2) - rgb.min(axis=2)
        near_black = (luminance <= 38) & (chroma <= 28)
        protected = ImageEngine._expand_black_outline_pixels(
            near_black,
            luminance,
            chroma,
        )
        if foreground is not None:
            protected &= foreground
        return protected

    @staticmethod
    def _find_black_thread_index(palette_threads: List[ThreadColor]) -> Optional[int]:
        best = None
        best_luminance = 255.0
        for idx, thread in enumerate(palette_threads):
            rgb = np.array(thread.color_rgb, dtype=np.float64)
            luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
            chroma = float(rgb.max() - rgb.min())
            if luminance <= 45 and chroma <= 35 and luminance < best_luminance:
                best = idx
                best_luminance = luminance
        return best

    @staticmethod
    def _component_min_area(
        source_image: Optional[np.ndarray],
        labels: np.ndarray,
        label: int,
        configured_min_area: int,
    ) -> int:
        if source_image is None:
            return configured_min_area

        pixels = source_image[labels == label]
        if pixels.size == 0:
            return configured_min_area

        rgb = pixels[:, :3].astype(np.float64)
        mean = rgb.mean(axis=0)
        luminance = 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2]
        chroma = float(mean.max() - mean.min())
        is_real_detail = luminance <= 115 or chroma >= 35
        if not is_real_detail:
            return configured_min_area

        detail_floor = max(6, int(0.00012 * labels.size))
        return min(configured_min_area, detail_floor)

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
        neutral_canvas = (chroma <= 18) & (luminance >= 238)
        candidate |= neutral_canvas
        candidate &= ~ImageEngine._preserve_foreground_dark_detail(rgb, candidate)

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
    def _preserve_foreground_dark_detail(
        rgb: np.ndarray,
        background_candidate: np.ndarray,
    ) -> np.ndarray:
        """Keep dark art strokes that touch real colored foreground regions."""
        luminance = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2])
        chroma = rgb.max(axis=2) - rgb.min(axis=2)

        colored_foreground = (
            ~background_candidate &
            (luminance >= 35) &
            (chroma >= 24)
        )
        if not np.any(colored_foreground):
            return np.zeros(background_candidate.shape, dtype=bool)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        near_foreground = cv2.dilate(colored_foreground.astype(np.uint8), kernel, iterations=1).astype(bool)
        dark_candidate = background_candidate & (luminance <= 32) & (chroma <= 32)
        return dark_candidate & near_foreground

    @staticmethod
    def build_layers_from_regions(
        regions: List[Tuple[int, np.ndarray]],
        palette_threads: List[ThreadColor],
        source_image: Optional[np.ndarray] = None,
        generation_mode: str = "photo_stitch",
    ) -> List[Layer]:
        """Group regions by thread color into layers."""
        layer_map = {}  # thread_idx -> Layer
        if not regions:
            return []

        image_area = regions[0][1].shape[0] * regions[0][1].shape[1]
        default_min_layer_area = max(3, int(0.0005 * image_area))

        for tid, mask in regions:
            if ImageEngine._is_tiny_neutral_antialias_region(
                mask,
                source_image,
                image_area,
            ):
                continue
            min_layer_area = ImageEngine._layer_min_area_for_region(
                mask,
                source_image,
                default_min_layer_area,
            )
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
            region.polygon = GeometryEngine.reconstruct_region_polygon(mask)
            if generation_mode == "cross_stitch":
                region.stitch_settings = ImageEngine._default_cross_stitch_settings_for_mask(
                    mask,
                    source_image,
                )
            else:
                region.stitch_settings = ImageEngine._default_stitch_settings_for_mask(
                    mask,
                    layer_map[tid].thread_color_rgb,
                )
            layer_map[tid].add_region(region)

        ImageEngine._merge_tiny_similar_layers(layer_map, image_area)
        if source_image is not None:
            ImageEngine._apply_source_region_colors(layer_map, source_image)

        # Sort fill colors first, then near-black outlines/details last so
        # they are stitched and previewed on top of expanded fill regions.
        layers = sorted(layer_map.values(), key=ImageEngine._layer_sort_key)

        for i, layer in enumerate(layers):
            layer.order = i

        return layers

    @staticmethod
    def _layer_min_area_for_region(
        mask: np.ndarray,
        source_image: Optional[np.ndarray],
        default_min_area: int,
    ) -> int:
        if source_image is None or mask.shape != source_image.shape[:2]:
            return default_min_area

        pixels = source_image[mask > 0, :3]
        if pixels.size == 0:
            return default_min_area

        rgb = pixels.astype(np.float64)
        median = np.median(rgb, axis=0)
        luminance = 0.299 * median[0] + 0.587 * median[1] + 0.114 * median[2]
        chroma = float(median.max() - median.min())
        is_foreground_detail = luminance < 245 and chroma >= 45
        if is_foreground_detail:
            return min(default_min_area, 3)
        return default_min_area

    @staticmethod
    def _is_tiny_neutral_antialias_region(
        mask: np.ndarray,
        source_image: Optional[np.ndarray],
        image_area: int,
    ) -> bool:
        if source_image is None or mask.shape != source_image.shape[:2]:
            return False

        area = int(np.count_nonzero(mask))
        if area <= 0 or area > max(96, int(0.002 * image_area)):
            return False

        pixels = source_image[mask > 0, :3]
        if pixels.size == 0:
            return False

        median = np.median(pixels.astype(np.float64), axis=0)
        luminance = 0.299 * median[0] + 0.587 * median[1] + 0.114 * median[2]
        chroma = float(median.max() - median.min())
        return bool(luminance >= 135 and chroma <= 42)

    @staticmethod
    def _apply_source_region_colors(
        layer_map: Dict[int, Layer],
        source_image: np.ndarray,
    ):
        for layer in layer_map.values():
            combined = layer.get_combined_mask()
            if combined is None:
                continue
            if combined.shape != source_image.shape[:2]:
                continue
            pixels = source_image[combined > 0, :3]
            if pixels.size == 0:
                continue

            representative = np.median(pixels.astype(np.float64), axis=0)
            layer.thread_color_rgb = tuple(int(round(v)) for v in representative)
            for region in layer.regions:
                if region.mask is None:
                    continue
                if region.stitch_settings.fill_mode == "cross_stitch":
                    continue
                region.stitch_settings = ImageEngine._default_stitch_settings_for_mask(
                    region.mask,
                    layer.thread_color_rgb,
                )

    @staticmethod
    def _layer_sort_key(layer: Layer) -> Tuple[int, int]:
        area = int(sum(np.count_nonzero(r.mask) for r in layer.regions if r.mask is not None))
        is_black_detail = ImageEngine._is_near_black_rgb(layer.thread_color_rgb)
        return (1 if is_black_detail else 0, -area)

    @staticmethod
    def _merge_tiny_similar_layers(layer_map: Dict[int, Layer], image_area: int):
        """Fold antialias slivers into nearby main colors instead of threads."""
        if len(layer_map) <= 1:
            return

        layers = list(layer_map.items())
        tiny_limit = max(24, int(0.003 * image_area))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

        for tid, layer in list(layers):
            if tid not in layer_map:
                continue

            kept_regions = []
            for region in layer.regions:
                if region.mask is None:
                    kept_regions.append(region)
                    continue

                area = int(np.count_nonzero(region.mask))
                if area <= 0 or area > tiny_limit:
                    kept_regions.append(region)
                    continue

                dilated = cv2.dilate((region.mask > 0).astype(np.uint8), kernel, iterations=1).astype(bool)
                candidates = []
                for other_tid, other in layer_map.items():
                    if other_tid == tid:
                        continue
                    if ImageEngine._is_near_black_rgb(other.thread_color_rgb):
                        continue
                    contact = 0
                    other_area = 0
                    for other_region in other.regions:
                        if other_region.mask is None:
                            continue
                        other_mask = other_region.mask > 0
                        other_area += int(np.count_nonzero(other_mask))
                        contact += int(np.count_nonzero(dilated & other_mask))
                    if (
                        contact > 0 and
                        other_area > area and
                        ImageEngine._colors_are_antialias_related(
                            layer.thread_color_rgb,
                            other.thread_color_rgb,
                        )
                    ):
                        candidates.append((contact, other_area, other_tid, other))

                if not candidates:
                    kept_regions.append(region)
                    continue

                _, _, _, target = max(candidates, key=lambda item: (item[0], item[1]))
                region.name = f"{target.name} region {len(target.regions) + 1}"
                target.add_region(region)

            layer.regions = kept_regions
            if not layer.regions:
                del layer_map[tid]

    @staticmethod
    def _colors_are_antialias_related(
        rgb_a: Tuple[int, int, int],
        rgb_b: Tuple[int, int, int],
    ) -> bool:
        hsv = cv2.cvtColor(
            np.array([[rgb_a, rgb_b]], dtype=np.uint8),
            cv2.COLOR_RGB2HSV,
        )[0].astype(np.float64)
        hue_a, sat_a, _ = hsv[0]
        hue_b, sat_b, _ = hsv[1]
        if min(sat_a, sat_b) <= 48:
            if max(sat_a, sat_b) >= 48:
                return True
            return float(np.linalg.norm(np.array(rgb_a, dtype=np.float64) - np.array(rgb_b, dtype=np.float64))) <= 72.0

        hue_delta = abs(hue_a - hue_b)
        hue_delta = min(hue_delta, 180.0 - hue_delta)
        return hue_delta <= 28.0

    @staticmethod
    def _default_stitch_settings_for_mask(
        mask: np.ndarray,
        thread_color_rgb: Optional[Tuple[int, int, int]] = None,
    ) -> StitchSettings:
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

        is_compact_fill_detail = (
            fill_ratio >= 0.38 and
            aspect <= 2.4 and
            max_width_px >= 5.5
        )
        is_thin_stroke = (
            area >= 8 and
            long_axis >= 12 and
            not is_compact_fill_detail and
            (
                (median_width_px <= 5.0 and (fill_ratio < 0.45 or aspect >= 2.4)) or
                (fill_ratio < 0.34 and aspect >= 2.0 and max_width_px <= 12.0)
            )
        )

        is_outline_thread = (
            thread_color_rgb is None or
            ImageEngine._is_near_black_rgb(thread_color_rgb)
        )
        is_broad_art_stroke = area >= 180 and max_width_px >= 7.0
        if is_thin_stroke and is_outline_thread and not is_broad_art_stroke:
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
            stitch_length_mm=2.0,
            row_spacing_mm=0.18,
            density=1.45,
            underlay=False,
            underlay_density=0.25,
            contour_count=1,
            pull_compensation_mm=0.22,
        )

    @staticmethod
    def _default_cross_stitch_settings_for_mask(
        mask: np.ndarray,
        source_image: Optional[np.ndarray] = None,
    ) -> StitchSettings:
        """Choose initial cross-stitch settings for a quantized region."""
        binary = (mask > 0).astype(np.uint8)
        area = int(binary.sum())
        if area <= 0:
            return StitchSettings(fill_mode="none", underlay=False)

        return StitchSettings(
            fill_mode="cross_stitch",
            stitch_length_mm=2.0,
            stitch_length_min_mm=0.5,
            stitch_length_max_mm=12.0,
            row_spacing_mm=2.0,
            density=1.0,
            underlay=False,
            contour_count=0,
            pull_compensation_mm=0.0,
            cross_method="auto",
            cross_pattern_size_mm=2.0,
            cross_coverage=0.5,
            cross_align_grid=True,
            cross_grid_offset_x_mm=0.0,
            cross_grid_offset_y_mm=0.0,
            cross_detail_boost=0.5,
        )

    @staticmethod
    def _is_near_black_rgb(rgb: Tuple[int, int, int]) -> bool:
        color = np.array(rgb, dtype=np.float64)
        luminance = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
        chroma = float(color.max() - color.min())
        return bool(luminance <= 45 and chroma <= 35)


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
