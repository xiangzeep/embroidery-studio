"""
Project Model
Manages the embroidery project state: source image, layers, regions,
stitch settings, and serialization.
"""

import json
import os
import uuid
import base64
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple, Any
from enum import Enum
import numpy as np


class FillMode(Enum):
    RUN = "run"
    SCANLINE = "scanline"
    CONTOUR = "contour"
    FLOW_GUIDED = "flow_guided"
    SATIN = "satin"
    CROSS_STITCH = "cross_stitch"
    STIPPLE = "stipple"
    RADIAL = "radial"
    SPIRAL = "spiral"
    NONE = "none"


class StitchDirection(Enum):
    FIXED_ANGLE = "fixed_angle"
    IMAGE_GRADIENT = "image_gradient"
    CONTOUR_FOLLOW = "contour_follow"
    RADIAL_FROM_CENTER = "radial_from_center"
    MANUAL = "manual"


@dataclass
class StitchSettings:
    """Settings that control how stitches are generated for a region."""
    fill_mode: str = "scanline"
    direction_mode: str = "fixed_angle"
    angle_deg: float = 45.0
    stitch_length_mm: float = 2.5
    stitch_length_min_mm: float = 1.0
    stitch_length_max_mm: float = 5.0
    row_spacing_mm: float = 0.4
    density: float = 1.0  # multiplier on default density
    underlay: bool = True
    underlay_angle_offset: float = 90.0
    underlay_density: float = 0.5
    contour_offset_mm: float = 0.5
    contour_count: int = 0  # number of contour rows before fill
    pull_compensation_mm: float = 0.0  # outward expansion to compensate stitch pull
    randomize_length: float = 0.0  # 0-1, amount of length randomization
    run_passes: int = 1  # odd pass counts retrace a run without changing its endpoint
    run_trace_contour: bool = False  # trace one closed contour instead of a branched skeleton
    run_preserve_corners: bool = False  # retain high-curvature vertices in closed runs
    run_corner_mode: str = "legacy"  # legacy, smooth, preserve, or adaptive
    flow_strength: float = 1.0  # how much flow field influences direction
    flow_smoothing: float = 3.0  # gaussian sigma for flow field smoothing
    cross_method: str = "auto"
    cross_pattern_size_mm: float = 1.8
    cross_coverage: float = 0.5
    cross_align_grid: bool = True
    cross_grid_offset_x_mm: float = 0.0
    cross_grid_offset_y_mm: float = 0.0
    cross_detail_boost: float = 0.5

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_dict(cls, d: dict) -> 'StitchSettings':
        s = cls()
        for k, v in d.items():
            if hasattr(s, k):
                setattr(s, k, v)
        return s


@dataclass
class Region:
    """A masked area within a layer that gets its own stitch settings."""
    uid: str = ""
    name: str = "Region"
    mask: Optional[np.ndarray] = None  # H×W bool/uint8
    polygon: Optional[Any] = None  # Shapely geometry reconstructed from mask
    stitch_settings: StitchSettings = field(default_factory=StitchSettings)
    visible: bool = True
    locked: bool = False
    design_color_id: Optional[int] = None
    design_color_rgb: Optional[Tuple[int, int, int]] = None
    thread_match_delta_e: Optional[float] = None
    is_detail_region: bool = False
    is_cross_stitch_overlay: bool = False
    # Generated stitch data (populated by engine)
    stitch_points: Optional[List[Tuple[float, float]]] = None
    stitch_paths: Optional[List[List[Tuple[float, float]]]] = None

    def __post_init__(self):
        if not self.uid:
            self.uid = str(uuid.uuid4())[:8]

    def stitch_bounds(self) -> Optional[Tuple[float, float, float, float]]:
        points = self._all_stitch_points()
        if not points:
            return None
        xs = [pt[0] for pt in points]
        ys = [pt[1] for pt in points]
        return min(xs), min(ys), max(xs), max(ys)

    def scale_stitches(
        self,
        factor: float,
        origin: Optional[Tuple[float, float]] = None,
    ):
        """Scale generated stitches around their center or an explicit origin."""
        if factor <= 0:
            raise ValueError("Scale factor must be positive")
        if not self.stitch_paths and not self.stitch_points:
            return

        if origin is None:
            bounds = self.stitch_bounds()
            if bounds is None:
                return
            origin = ((bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0)

        ox, oy = origin

        def scale_point(pt: Tuple[float, float]) -> Tuple[float, float]:
            x, y = pt
            return (ox + (x - ox) * factor, oy + (y - oy) * factor)

        if self.stitch_paths:
            self.stitch_paths = [
                [scale_point(pt) for pt in path]
                for path in self.stitch_paths
            ]
            self.stitch_points = [pt for path in self.stitch_paths for pt in path]
        elif self.stitch_points:
            self.stitch_points = [scale_point(pt) for pt in self.stitch_points]

    def translate_stitches(self, dx: float, dy: float):
        """Move generated stitches by a scene-unit delta."""
        if not self.stitch_paths and not self.stitch_points:
            return

        def move_point(pt: Tuple[float, float]) -> Tuple[float, float]:
            x, y = pt
            return (x + dx, y + dy)

        if self.stitch_paths:
            self.stitch_paths = [
                [move_point(pt) for pt in path]
                for path in self.stitch_paths
            ]
            self.stitch_points = [pt for path in self.stitch_paths for pt in path]
        elif self.stitch_points:
            self.stitch_points = [move_point(pt) for pt in self.stitch_points]

    def _all_stitch_points(self) -> List[Tuple[float, float]]:
        if self.stitch_paths:
            return [pt for path in self.stitch_paths for pt in path]
        return self.stitch_points or []

    def to_dict(self) -> dict:
        d = {
            'uid': self.uid,
            'name': self.name,
            'stitch_settings': self.stitch_settings.to_dict(),
            'visible': self.visible,
            'locked': self.locked,
            'design_color_id': self.design_color_id,
            'design_color_rgb': (
                list(self.design_color_rgb)
                if self.design_color_rgb is not None else None
            ),
            'thread_match_delta_e': self.thread_match_delta_e,
            'is_detail_region': self.is_detail_region,
            'is_cross_stitch_overlay': self.is_cross_stitch_overlay,
        }
        if self.mask is not None:
            # Store mask as RLE-encoded base64
            d['mask_rle'] = _rle_encode(self.mask)
            d['mask_shape'] = list(self.mask.shape)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> 'Region':
        d = dict(d)
        ss = StitchSettings.from_dict(d.pop('stitch_settings', {}))
        mask_rle = d.pop('mask_rle', None)
        mask_shape = d.pop('mask_shape', None)
        design_color_rgb = d.get('design_color_rgb')
        r = cls(
            uid=d.get('uid', ''),
            name=d.get('name', 'Region'),
            stitch_settings=ss,
            visible=d.get('visible', True),
            locked=d.get('locked', False),
            design_color_id=d.get('design_color_id'),
            design_color_rgb=(
                tuple(design_color_rgb) if design_color_rgb is not None else None
            ),
            thread_match_delta_e=d.get('thread_match_delta_e'),
            is_detail_region=d.get('is_detail_region', False),
            is_cross_stitch_overlay=d.get('is_cross_stitch_overlay', False),
        )
        if mask_rle and mask_shape:
            r.mask = _rle_decode(mask_rle, tuple(mask_shape))
        return r


@dataclass
class Layer:
    """A color layer – one thread color, containing one or more regions."""
    uid: str = ""
    name: str = "Layer"
    thread_uid: str = ""  # reference to ThreadColor.uid
    thread_color_rgb: Tuple[int, int, int] = (0, 0, 0)
    thread_name: str = ""
    regions: List[Region] = field(default_factory=list)
    visible: bool = True
    locked: bool = False
    opacity: float = 1.0
    order: int = 0  # stitch order (0 = first/bottom)
    design_color_id: Optional[int] = None
    design_color_rgb: Optional[Tuple[int, int, int]] = None
    matched_thread_rgb: Optional[Tuple[int, int, int]] = None
    thread_match_delta_e: Optional[float] = None
    is_detail_layer: bool = False
    # Layer-level stitch settings (defaults for new regions)
    default_stitch_settings: StitchSettings = field(default_factory=StitchSettings)

    def __post_init__(self):
        if not self.uid:
            self.uid = str(uuid.uuid4())[:8]

    def add_region(self, region: Region):
        self.regions.append(region)

    def remove_region(self, uid: str):
        self.regions = [r for r in self.regions if r.uid != uid]

    def get_region(self, uid: str) -> Optional[Region]:
        for r in self.regions:
            if r.uid == uid:
                return r
        return None

    def get_combined_mask(self) -> Optional[np.ndarray]:
        """Combine all region masks into one layer mask."""
        masks = [r.mask for r in self.regions if r.mask is not None and r.visible]
        if not masks:
            return None
        combined = np.zeros_like(masks[0], dtype=np.uint8)
        for m in masks:
            combined = np.maximum(combined, m)
        return combined

    def stitch_bounds(self) -> Optional[Tuple[float, float, float, float]]:
        bounds = [r.stitch_bounds() for r in self.regions if r.visible]
        bounds = [b for b in bounds if b is not None]
        if not bounds:
            return None
        return (
            min(b[0] for b in bounds),
            min(b[1] for b in bounds),
            max(b[2] for b in bounds),
            max(b[3] for b in bounds),
        )

    def scale_stitches(
        self,
        factor: float,
        origin: Optional[Tuple[float, float]] = None,
    ):
        """Scale generated stitches for every visible region in this layer."""
        if factor <= 0:
            raise ValueError("Scale factor must be positive")
        if origin is None:
            bounds = self.stitch_bounds()
            if bounds is None:
                return
            origin = ((bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0)
        for region in self.regions:
            if region.visible:
                region.scale_stitches(factor, origin)

    def translate_stitches(self, dx: float, dy: float):
        """Move generated stitches for every visible region in this layer."""
        for region in self.regions:
            if region.visible:
                region.translate_stitches(dx, dy)

    def to_dict(self) -> dict:
        return {
            'uid': self.uid,
            'name': self.name,
            'thread_uid': self.thread_uid,
            'thread_color_rgb': list(self.thread_color_rgb),
            'thread_name': self.thread_name,
            'regions': [r.to_dict() for r in self.regions],
            'visible': self.visible,
            'locked': self.locked,
            'opacity': self.opacity,
            'order': self.order,
            'design_color_id': self.design_color_id,
            'design_color_rgb': (
                list(self.design_color_rgb)
                if self.design_color_rgb is not None else None
            ),
            'matched_thread_rgb': (
                list(self.matched_thread_rgb)
                if self.matched_thread_rgb is not None else None
            ),
            'thread_match_delta_e': self.thread_match_delta_e,
            'is_detail_layer': self.is_detail_layer,
            'default_stitch_settings': self.default_stitch_settings.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> 'Layer':
        d = dict(d)
        regions = [Region.from_dict(rd) for rd in d.pop('regions', [])]
        dss = StitchSettings.from_dict(d.pop('default_stitch_settings', {}))
        d['thread_color_rgb'] = tuple(d.get('thread_color_rgb', (0, 0, 0)))
        design_color_rgb = d.get('design_color_rgb')
        matched_thread_rgb = d.get('matched_thread_rgb')
        layer = cls(
            uid=d.get('uid', ''),
            name=d.get('name', 'Layer'),
            thread_uid=d.get('thread_uid', ''),
            thread_color_rgb=d['thread_color_rgb'],
            thread_name=d.get('thread_name', ''),
            visible=d.get('visible', True),
            locked=d.get('locked', False),
            opacity=d.get('opacity', 1.0),
            order=d.get('order', 0),
            design_color_id=d.get('design_color_id'),
            design_color_rgb=(
                tuple(design_color_rgb) if design_color_rgb is not None else None
            ),
            matched_thread_rgb=(
                tuple(matched_thread_rgb) if matched_thread_rgb is not None else None
            ),
            thread_match_delta_e=d.get('thread_match_delta_e'),
            is_detail_layer=d.get('is_detail_layer', False),
            default_stitch_settings=dss,
        )
        layer.regions = regions
        return layer


@dataclass
class ImageSettings:
    """Settings for the source image processing."""
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0
    sharpness: float = 0.0
    blur: float = 0.0
    resize_width: int = 0  # 0 = auto
    resize_height: int = 0
    crop_rect: Optional[Tuple[int, int, int, int]] = None  # x, y, w, h
    output_width_mm: float = 100.0  # physical output size
    output_height_mm: float = 100.0
    dpi: float = 96.0

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        if d['crop_rect'] is not None:
            d['crop_rect'] = list(d['crop_rect'])
        return d

    @classmethod
    def from_dict(cls, d: dict) -> 'ImageSettings':
        d = dict(d)
        if d.get('crop_rect'):
            d['crop_rect'] = tuple(d['crop_rect'])
        s = cls()
        for k, v in d.items():
            if hasattr(s, k):
                setattr(s, k, v)
        return s


@dataclass
class QuantizationSettings:
    """Settings for color quantization."""
    n_colors: int = 12
    method: str = "kmeans_lab"  # "kmeans_lab", "median_cut", "octree"
    dither: bool = False
    include_background: bool = False
    preserve_details: bool = True
    design_color_budget: int = 0
    auto_design_colors: bool = True
    detail_sensitivity: float = 0.65
    min_region_area_px: int = 40
    morphology_kernel_size: int = 5
    smooth_regions: bool = True

    def to_dict(self) -> dict:
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, d: dict) -> 'QuantizationSettings':
        s = cls()
        for k, v in d.items():
            if hasattr(s, k):
                setattr(s, k, v)
        return s


class Project:
    """Top-level project container."""

    def __init__(self):
        self.uid = str(uuid.uuid4())[:8]
        self.name = "Untitled Project"
        self.filepath = ""
        self.source_image_path = ""
        self.source_image: Optional[np.ndarray] = None  # RGB uint8
        self.processed_image: Optional[np.ndarray] = None
        self.quantized_map: Optional[np.ndarray] = None  # H×W int
        self.layers: List[Layer] = []
        self.image_settings = ImageSettings()
        self.quant_settings = QuantizationSettings()
        self.generation_mode = "photo_stitch"
        # Thread pack UIDs used in this project
        self.active_pack_uids: List[str] = []
        self.modified = False

    def add_layer(self, layer: Layer):
        layer.order = len(self.layers)
        self.layers.append(layer)
        self.modified = True

    def remove_layer(self, uid: str):
        self.layers = [l for l in self.layers if l.uid != uid]
        for i, l in enumerate(self.layers):
            l.order = i
        self.modified = True

    def get_layer(self, uid: str) -> Optional[Layer]:
        for l in self.layers:
            if l.uid == uid:
                return l
        return None

    def move_layer(self, uid: str, direction: int):
        """Move layer up (-1) or down (+1) in order."""
        idx = next((i for i, l in enumerate(self.layers) if l.uid == uid), None)
        if idx is None:
            return
        new_idx = max(0, min(len(self.layers) - 1, idx + direction))
        if new_idx != idx:
            self.layers.insert(new_idx, self.layers.pop(idx))
            for i, l in enumerate(self.layers):
                l.order = i
            self.modified = True

    def save(self, filepath: str = ""):
        """Save project to .ssp (Stitch Studio Project) JSON file."""
        if filepath:
            self.filepath = filepath
        if not self.filepath:
            raise ValueError("No filepath specified")

        data = {
            'version': '1.0',
            'uid': self.uid,
            'name': self.name,
            'source_image_path': self.source_image_path,
            'generation_mode': self.generation_mode,
            'image_settings': self.image_settings.to_dict(),
            'quant_settings': self.quant_settings.to_dict(),
            'active_pack_uids': self.active_pack_uids,
            'layers': [l.to_dict() for l in self.layers],
        }

        # Store source image as base64 PNG
        if self.source_image is not None:
            from PIL import Image
            import io
            img = Image.fromarray(self.source_image)
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            data['source_image_b64'] = base64.b64encode(buf.getvalue()).decode()

        with open(self.filepath, 'w') as f:
            json.dump(data, f, indent=2)
        self.modified = False

    def load(self, filepath: str):
        """Load project from .ssp file."""
        self.filepath = filepath
        with open(filepath, 'r') as f:
            data = json.load(f)

        loaded = Project.from_dict(data)
        self.uid = loaded.uid
        self.name = loaded.name
        self.source_image_path = loaded.source_image_path
        self.image_settings = loaded.image_settings
        self.quant_settings = loaded.quant_settings
        self.generation_mode = loaded.generation_mode
        self.active_pack_uids = loaded.active_pack_uids
        self.layers = loaded.layers

        # Restore source image
        self.source_image = loaded.source_image
        self.modified = False

    @classmethod
    def from_dict(cls, data: dict) -> 'Project':
        data = data or {}
        project = cls()
        project.uid = data.get('uid', str(uuid.uuid4())[:8])
        project.name = data.get('name', 'Untitled')
        project.source_image_path = data.get('source_image_path', '')
        project.generation_mode = data.get('generation_mode', 'photo_stitch')
        project.image_settings = ImageSettings.from_dict(data.get('image_settings', {}))
        project.quant_settings = QuantizationSettings.from_dict(data.get('quant_settings', {}))
        project.active_pack_uids = data.get('active_pack_uids', [])
        project.layers = [Layer.from_dict(ld) for ld in data.get('layers', [])]

        # Restore source image
        if 'source_image_b64' in data:
            from PIL import Image
            import io
            img_bytes = base64.b64decode(data['source_image_b64'])
            img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
            project.source_image = np.array(img)

        project.modified = False
        return project


# --- RLE Encoding for Masks ---

def _rle_encode(mask: np.ndarray) -> str:
    """Run-length encode a binary mask to compact string."""
    flat = mask.flatten().astype(np.uint8)
    runs = []
    current_val = flat[0]
    count = 1
    for i in range(1, len(flat)):
        if flat[i] == current_val:
            count += 1
        else:
            runs.append(f"{current_val}:{count}")
            current_val = flat[i]
            count = 1
    runs.append(f"{current_val}:{count}")
    return ",".join(runs)


def _rle_decode(rle_str: str, shape: tuple) -> np.ndarray:
    """Decode RLE string back to binary mask."""
    flat = []
    for run in rle_str.split(","):
        val, count = run.split(":")
        flat.extend([int(val)] * int(count))
    return np.array(flat, dtype=np.uint8).reshape(shape)
