"""
Export Engine
Converts project layers/stitches into machine embroidery files
via pyembroidery (DST, PES, JEF, VP3, EXP, SVG, PNG).
"""

import pyembroidery
import numpy as np
from typing import List, Tuple, Optional, Dict
from .project import Project, Layer, Region


SUPPORTED_FORMATS = {
    'dst': 'Tajima DST (Universal)',
    'pes': 'Brother PES',
    'jef': 'Janome JEF',
    'vp3': 'Pfaff VP3',
    'exp': 'Melco EXP',
    'hus': 'Husqvarna HUS',
    'xxx': 'Singer XXX',
    'svg': 'SVG Preview',
    'png': 'PNG Preview',
    'csv': 'CSV Debug',
    'json': 'JSON Debug',
}


class ExportEngine:
    """Builds pyembroidery patterns from project data and exports to files."""

    def __init__(self):
        self.max_stitch_units = 120  # 12.0mm - max single stitch distance (DST limit ~12.1mm)
        self.jump_threshold_units = 30  # 3mm - insert jump for gaps larger than this
        self.trim_threshold_units = 100  # 10mm - insert trim for gaps larger

    def build_pattern(self, project: Project) -> pyembroidery.EmbPattern:
        """Build complete EmbPattern from project layers."""
        pattern = pyembroidery.EmbPattern()

        # Metadata
        pattern.extras['name'] = project.name

        # Process only layers that will actually write stitches. This prevents
        # blank/background or empty antialias layers from becoming DST colors.
        drawable_layers = []
        for layer in sorted(project.layers, key=lambda l: l.order):
            if not layer.visible:
                continue
            region_paths = []
            for region in layer.regions:
                if not region.visible:
                    continue
                paths = self._region_paths(region)
                if paths:
                    region_paths.append((region, paths))
            if region_paths:
                drawable_layers.append((layer, region_paths))

        for layer_idx, (layer, region_paths) in enumerate(drawable_layers):
            # Add thread for this layer
            thread = pyembroidery.EmbThread()
            r, g, b = layer.thread_color_rgb
            thread.color = (r << 16) | (g << 8) | b
            thread.name = layer.thread_name or layer.name
            thread.catalog_number = layer.thread_uid
            pattern.add_thread(thread)

            # Color change if not first layer
            if layer_idx > 0:
                pattern.add_stitch_absolute(pyembroidery.COLOR_BREAK, 0, 0)

            last_x, last_y = None, None
            for _, paths in region_paths:
                for path in self._order_paths_from(paths, last_x, last_y):
                    last_x, last_y = self._write_path(pattern, path, last_x, last_y)

        # End pattern
        pattern.add_stitch_absolute(pyembroidery.END, 0, 0)

        # Fix up thread/color consistency
        pattern.fix_color_count()

        return pattern

    def export(self, project: Project, filepath: str, settings: dict = None):
        """Export project to embroidery file."""
        pattern = self.build_pattern(project)

        write_settings = {}
        if settings:
            write_settings.update(settings)

        pyembroidery.write(pattern, filepath, write_settings)

    def export_layer(self, layer: Layer, filepath: str, settings: dict = None):
        """Export a single layer to its own embroidery file."""
        pattern = pyembroidery.EmbPattern()

        thread = pyembroidery.EmbThread()
        r, g, b = layer.thread_color_rgb
        thread.color = (r << 16) | (g << 8) | b
        thread.name = layer.thread_name or layer.name
        pattern.add_thread(thread)

        for region in layer.regions:
            if not region.visible:
                continue
            last_x, last_y = None, None
            for path in self._region_paths(region):
                last_x, last_y = self._write_path(pattern, path, last_x, last_y)

        pattern.add_stitch_absolute(pyembroidery.END, 0, 0)

        write_settings = settings or {}
        pyembroidery.write(pattern, filepath, write_settings)

    def get_stats(self, project: Project) -> Dict:
        """Get pattern statistics."""
        pattern = self.build_pattern(project)
        bounds = pattern.bounds()

        total_stitches = 0
        total_jumps = 0
        total_trims = 0
        color_changes = 0

        for stitch in pattern.stitches:
            cmd = stitch[2]
            if cmd == pyembroidery.STITCH:
                total_stitches += 1
            elif cmd == pyembroidery.JUMP:
                total_jumps += 1
            elif cmd == pyembroidery.TRIM:
                total_trims += 1
            elif cmd in (pyembroidery.COLOR_BREAK, pyembroidery.COLOR_CHANGE):
                color_changes += 1

        # Estimate thread length
        total_length = 0
        prev = None
        for stitch in pattern.stitches:
            x, y, cmd = stitch[0], stitch[1], stitch[2]
            if prev and cmd == pyembroidery.STITCH:
                total_length += np.hypot(x - prev[0], y - prev[1])
            prev = (x, y)

        width_mm = (bounds[2] - bounds[0]) / 10 if bounds else 0
        height_mm = (bounds[3] - bounds[1]) / 10 if bounds else 0

        return {
            'total_stitches': total_stitches,
            'total_jumps': total_jumps,
            'total_trims': total_trims,
            'color_changes': color_changes,
            'n_colors': len(pattern.threadlist),
            'width_mm': width_mm,
            'height_mm': height_mm,
            'thread_length_m': total_length / 10000,  # units to meters
            'bounds': bounds,
        }

    def _optimize_stitch_order(
        self, stitches: List[Tuple[float, float]]
    ) -> List[Tuple[float, float]]:
        """Basic optimization: keep stitch order but detect natural segments."""
        # For now, return as-is. Future: detect jumps and reorder segments.
        return stitches

    def _region_paths(self, region: Region) -> List[List[Tuple[float, float]]]:
        """Return stitch paths without losing object boundaries."""
        paths = getattr(region, "stitch_paths", None)
        if paths:
            return [p for p in paths if len(p) >= 2]
        if region.stitch_points:
            return [region.stitch_points]
        return []

    def _order_paths_from(
        self,
        paths: List[List[Tuple[float, float]]],
        last_x: Optional[int],
        last_y: Optional[int],
    ) -> List[List[Tuple[float, float]]]:
        """Nearest-neighbor path ordering with reversible path direction."""
        remaining = [p[:] for p in paths if len(p) >= 2]
        ordered: List[List[Tuple[float, float]]] = []
        current = None if last_x is None or last_y is None else (float(last_x), float(last_y))

        while remaining:
            if current is None:
                path = remaining.pop(0)
                ordered.append(path)
                current = path[-1]
                continue

            best = None
            for idx, path in enumerate(remaining):
                d_start = float(np.hypot(path[0][0] - current[0], path[0][1] - current[1]))
                d_end = float(np.hypot(path[-1][0] - current[0], path[-1][1] - current[1]))
                if best is None or min(d_start, d_end) < best[0]:
                    best = (min(d_start, d_end), idx, d_end < d_start)

            _, idx, reverse = best
            path = remaining.pop(idx)
            if reverse:
                path = path[::-1]
            ordered.append(path)
            current = path[-1]

        return ordered

    def _write_path(
        self,
        pattern: pyembroidery.EmbPattern,
        path: List[Tuple[float, float]],
        last_x: Optional[int],
        last_y: Optional[int],
    ) -> Tuple[Optional[int], Optional[int]]:
        """Write one continuous path, stitching safe in-object gaps."""
        if len(path) < 2:
            return last_x, last_y

        first_x, first_y = int(round(path[0][0])), int(round(path[0][1]))
        connected_to_previous = False
        if last_x is not None and last_y is not None:
            gap = float(np.hypot(first_x - last_x, first_y - last_y))
            if gap <= self.jump_threshold_units:
                self._write_stitch_segment(pattern, last_x, last_y, first_x, first_y)
                connected_to_previous = True
            elif gap > self.trim_threshold_units:
                pattern.add_stitch_absolute(pyembroidery.TRIM, last_x, last_y)
        if not connected_to_previous:
            pattern.add_stitch_absolute(pyembroidery.JUMP, first_x, first_y)

        prev_x, prev_y = first_x, first_y
        for x, y in path[1:]:
            ix, iy = int(round(x)), int(round(y))
            self._write_stitch_segment(pattern, prev_x, prev_y, ix, iy)
            prev_x, prev_y = ix, iy

        return prev_x, prev_y

    def _write_stitch_segment(
        self,
        pattern: pyembroidery.EmbPattern,
        prev_x: int,
        prev_y: int,
        ix: int,
        iy: int,
    ):
        dist = float(np.hypot(ix - prev_x, iy - prev_y))
        if dist <= 1e-6:
            return
        if dist > self.max_stitch_units:
            n_splits = int(np.ceil(dist / self.max_stitch_units))
            for s in range(1, n_splits + 1):
                t = s / n_splits
                sx = int(round(prev_x + t * (ix - prev_x)))
                sy = int(round(prev_y + t * (iy - prev_y)))
                pattern.add_stitch_absolute(pyembroidery.STITCH, sx, sy)
        else:
            pattern.add_stitch_absolute(pyembroidery.STITCH, ix, iy)
