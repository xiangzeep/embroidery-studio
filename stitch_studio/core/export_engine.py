"""
Export Engine
Converts project layers/stitches into machine embroidery files
via pyembroidery (DST, PES, JEF, VP3, EXP, SVG, PNG).
"""

import pyembroidery
import numpy as np
import os
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
        pattern.extras['name'] = self._safe_design_name(project.name)

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

        # Project/UI order is visual stack order. Embroidery files stitch the
        # first color first, so write the stack in reverse: bottom first,
        # top/detail layers last.
        drawable_layers.reverse()
        drawable_layers = self._group_drawable_layers(drawable_layers)

        last_x, last_y = None, None
        for layer_idx, (layer, region_paths) in enumerate(drawable_layers):
            # Add thread for this layer
            thread = self._thread_for_layer(layer, layer_idx)
            pattern.add_thread(thread)

            # Color change if not first layer
            if layer_idx > 0:
                pattern.add_stitch_absolute(
                    pyembroidery.COLOR_CHANGE,
                    last_x or 0,
                    last_y or 0,
                )

            for region, paths in region_paths:
                for path in self._order_region_paths(region, paths, last_x, last_y):
                    last_x, last_y = self._write_path(pattern, path, last_x, last_y)

        # End pattern
        pattern.add_stitch_absolute(pyembroidery.END, 0, 0)

        # Fix up thread/color consistency
        pattern.fix_color_count()

        return pattern

    def export(self, project: Project, filepath: str, settings: dict = None) -> List[str]:
        """Export project to embroidery file."""
        if not self.has_stitches(project):
            raise ValueError("Pattern has no stitches to export")
        pattern = self.build_pattern(project)

        write_settings = {}
        if settings:
            write_settings.update(settings)
        pyembroidery.write(pattern, filepath, write_settings)
        written_files = [filepath]
        if filepath.lower().endswith(".dst"):
            self._embed_compact_dst_metadata(filepath, pattern)
            self._validate_dst_roundtrip(pattern, filepath)
            edr_path = os.path.splitext(filepath)[0] + ".edr"
            pyembroidery.write(pattern, edr_path, {})
            written_files.append(edr_path)
        return written_files

    def _validate_dst_roundtrip(
        self,
        source_pattern: pyembroidery.EmbPattern,
        filepath: str,
    ):
        """Reject a DST whose encoded movement stream changes design size."""
        # Test doubles may capture writes without creating a physical file.
        if not os.path.isfile(filepath):
            return
        try:
            decoded = pyembroidery.EmbPattern(filepath)
            expected = source_pattern.bounds()
            actual = decoded.bounds()
            has_end = bool(
                decoded.stitches
                and (int(decoded.stitches[-1][2]) & 0xFF) == pyembroidery.END
            )
            if expected is None or actual is None or not has_end:
                raise ValueError("missing stitches or END command")

            expected_size = (
                float(expected[2] - expected[0]),
                float(expected[3] - expected[1]),
            )
            actual_size = (
                float(actual[2] - actual[0]),
                float(actual[3] - actual[1]),
            )
            tolerance = tuple(max(2.0, size * 0.01) for size in expected_size)
            if any(
                abs(actual_value - expected_value) > allowed
                for actual_value, expected_value, allowed in zip(
                    actual_size,
                    expected_size,
                    tolerance,
                )
            ):
                raise ValueError(
                    f"size changed from {expected_size} to {actual_size}"
                )
        except Exception as error:
            try:
                os.remove(filepath)
            except OSError:
                pass
            raise ValueError(f"DST validation failed: {error}") from error

    def has_stitches(self, project: Project) -> bool:
        """Return whether the project contains at least one drawable path."""
        return any(
            self._region_paths(region)
            for layer in project.layers
            if layer.visible
            for region in layer.regions
            if region.visible
        )

    def export_layer(self, layer: Layer, filepath: str, settings: dict = None):
        """Export a single layer to its own embroidery file."""
        if not any(
            self._region_paths(region)
            for region in layer.regions
            if region.visible
        ):
            raise ValueError("Layer has no stitches to export")
        pattern = pyembroidery.EmbPattern()

        thread = self._thread_for_layer(layer, 0)
        pattern.add_thread(thread)

        last_x, last_y = None, None
        for region in layer.regions:
            if not region.visible:
                continue
            paths = self._region_paths(region)
            for path in self._order_region_paths(region, paths, last_x, last_y):
                last_x, last_y = self._write_path(pattern, path, last_x, last_y)

        pattern.add_stitch_absolute(pyembroidery.END, 0, 0)

        write_settings = settings or {}
        pyembroidery.write(pattern, filepath, write_settings)

    def _safe_design_name(self, name: str) -> str:
        """Embroidery headers are safest with short ASCII design names."""
        safe = "".join(ch if 32 <= ord(ch) <= 126 else "_" for ch in (name or "Untitled"))
        safe = safe.strip(" _") or "Untitled"
        return safe[:16]

    def _thread_for_layer(self, layer: Layer, index: int) -> pyembroidery.EmbThread:
        """Create a thread with fields used by embroidery writers."""
        thread = pyembroidery.EmbThread()
        r, g, b = layer.matched_thread_rgb or layer.thread_color_rgb
        thread.color = (r << 16) | (g << 8) | b

        label = self._safe_thread_text(
            layer.thread_name,
            layer.name,
            f"Color {index + 1}",
            max_len=32,
        )
        catalog = self._safe_thread_text(
            layer.thread_uid,
            f"{index + 1}",
            max_len=16,
        )

        thread.name = label
        thread.description = label
        thread.details = label
        thread.chart = "Stitch Studio"
        thread.catalog_number = catalog
        return thread

    def _group_drawable_layers(self, drawable_layers):
        """Combine design shades that use the same physical embroidery thread."""
        grouped = []
        indexes = {}
        for layer, region_paths in drawable_layers:
            color = tuple(layer.matched_thread_rgb or layer.thread_color_rgb)
            if layer.thread_uid and layer.matched_thread_rgb:
                key = ("thread", layer.thread_uid)
            else:
                key = ("color", color)

            index = indexes.get(key)
            if index is None:
                indexes[key] = len(grouped)
                grouped.append((layer, list(region_paths)))
            else:
                grouped[index][1].extend(region_paths)
        return grouped

    def _embed_compact_dst_metadata(
        self,
        filepath: str,
        pattern: pyembroidery.EmbPattern,
    ):
        """Add thread colors without allowing metadata to overflow the DST header."""
        if not os.path.isfile(filepath):
            return
        colors = [int(thread.color) & 0xFFFFFF for thread in pattern.threadlist]
        with open(filepath, "r+b") as dst_file:
            header = dst_file.read(512)
            updated = self._compact_dst_header(header, colors)
            if updated == header:
                return
            dst_file.seek(0)
            dst_file.write(updated)

    @staticmethod
    def _compact_dst_header(header: bytes, colors) -> bytes:
        """Return a fixed-size Tajima header containing compact TC records."""
        if len(header) != 512:
            return header

        pd_start = header.find(b"PD:")
        pd_end = header.find(b"\r", pd_start)
        if pd_start < 0 or pd_end < 0:
            return header

        prefix = header[:pd_end + 1]
        records = []
        for color in colors:
            if isinstance(color, (tuple, list)):
                r, g, b = color
                value = (int(r) << 16) | (int(g) << 8) | int(b)
            else:
                value = int(color)
            records.append(f"TC:#{value & 0xFFFFFF:06X},C,\r".encode("ascii"))

        payload = prefix + b"".join(records)
        if len(payload) > 511:
            return header
        return payload.ljust(511, b" ") + b"\x1a"

    def _safe_thread_text(self, *candidates: str, max_len: int) -> str:
        """Return a printable ASCII value for conservative embroidery headers."""
        for candidate in candidates:
            if not candidate:
                continue
            safe = "".join(ch if 32 <= ord(ch) <= 126 else "_" for ch in str(candidate))
            safe = safe.strip(" _")
            if safe:
                return safe[:max_len]
        return "Thread"[:max_len]

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

    def _order_region_paths(
        self,
        region: Region,
        paths: List[List[Tuple[float, float]]],
        last_x: Optional[int],
        last_y: Optional[int],
    ) -> List[List[Tuple[float, float]]]:
        """Choose a path order without making large exports quadratic."""
        if (
            getattr(region.stitch_settings, "fill_mode", "") == "cross_stitch"
            or len(paths) >= 256
        ):
            return self._order_paths_linear(paths, last_x, last_y)
        return self._order_paths_from(paths, last_x, last_y)

    def _order_paths_linear(
        self,
        paths: List[List[Tuple[float, float]]],
        last_x: Optional[int],
        last_y: Optional[int],
    ) -> List[List[Tuple[float, float]]]:
        """Keep generator order and only flip each next segment locally."""
        ordered: List[List[Tuple[float, float]]] = []
        current = None if last_x is None or last_y is None else (float(last_x), float(last_y))
        for path in paths:
            if len(path) < 2:
                continue
            candidate = path
            if current is not None:
                d_start = (path[0][0] - current[0]) ** 2 + (path[0][1] - current[1]) ** 2
                d_end = (path[-1][0] - current[0]) ** 2 + (path[-1][1] - current[1]) ** 2
                if d_end < d_start:
                    candidate = path[::-1]
            ordered.append(candidate)
            current = candidate[-1]
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
            jump_x = 0 if last_x is None else last_x
            jump_y = 0 if last_y is None else last_y
            self._write_jump_segment(
                pattern,
                jump_x,
                jump_y,
                first_x,
                first_y,
            )

        prev_x, prev_y = first_x, first_y
        for x, y in path[1:]:
            ix, iy = int(round(x)), int(round(y))
            self._write_stitch_segment(pattern, prev_x, prev_y, ix, iy)
            prev_x, prev_y = ix, iy

        return prev_x, prev_y

    def _write_jump_segment(
        self,
        pattern: pyembroidery.EmbPattern,
        prev_x: int,
        prev_y: int,
        ix: int,
        iy: int,
    ):
        """Split a jump so every encoded DST delta stays machine-safe."""
        distance = float(np.hypot(ix - prev_x, iy - prev_y))
        if distance <= 1e-6:
            pattern.add_stitch_absolute(pyembroidery.JUMP, ix, iy)
            return
        split_count = max(1, int(np.ceil(distance / self.max_stitch_units)))
        for step in range(1, split_count + 1):
            ratio = step / split_count
            x = int(round(prev_x + ratio * (ix - prev_x)))
            y = int(round(prev_y + ratio * (iy - prev_y)))
            pattern.add_stitch_absolute(pyembroidery.JUMP, x, y)

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
