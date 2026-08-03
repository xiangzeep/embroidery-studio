"""
Export Engine
Converts project layers/stitches into machine embroidery files
via pyembroidery (DST, PES, JEF, VP3, EXP, SVG, PNG).
"""

import pyembroidery
import numpy as np
import os
from copy import copy
from dataclasses import asdict, dataclass
from typing import List, Tuple, Optional, Dict
from .project import Project, Layer, Region
from .pattern_renderer import PatternRenderer


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


@dataclass(frozen=True)
class ExportRoundTripReport:
    valid: bool
    source_stitch_commands: int
    decoded_stitch_commands: int
    source_jump_commands: int
    decoded_jump_commands: int
    source_bounds: Optional[Tuple[float, float, float, float]]
    decoded_bounds: Optional[Tuple[float, float, float, float]]
    source_thread_colors: Tuple[Tuple[int, int, int], ...]
    decoded_thread_colors: Tuple[Tuple[int, int, int], ...]
    render_similarity: float

    def as_dict(self):
        return asdict(self)


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
            region_paths = sorted(
                region_paths,
                key=lambda item: (
                    self._scene_plane_rank(
                        getattr(item[0], "scene_plane", "subject_base")
                    ),
                    bool(getattr(item[0], "is_cross_stitch_overlay", False)),
                    bool(item[0].is_detail_region),
                    int(getattr(item[0], "semantic_z_order", 0)),
                ),
            )
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

            cross_fill_paths = [
                (region, paths)
                for region, paths in region_paths
                if (
                    region.stitch_settings.fill_mode == "cross_stitch"
                    and not getattr(region, "is_cross_stitch_overlay", False)
                )
            ]
            remaining_region_paths = [
                (region, paths)
                for region, paths in region_paths
                if not (
                    region.stitch_settings.fill_mode == "cross_stitch"
                    and not getattr(region, "is_cross_stitch_overlay", False)
                )
            ]
            if cross_fill_paths:
                ordered_paths = self._order_cross_stitch_group_paths(
                    cross_fill_paths,
                    last_x,
                    last_y,
                )
                connection_threshold_units = max(
                    float(self.jump_threshold_units),
                    max(
                        float(region.stitch_settings.cross_pattern_size_mm)
                        * 10.0
                        * np.sqrt(2.0)
                        * 1.05
                        for region, _ in cross_fill_paths
                    ),
                )
                for path in ordered_paths:
                    last_x, last_y = self._write_path(
                        pattern,
                        path,
                        last_x,
                        last_y,
                        connect_nearby=True,
                        connection_threshold_units=connection_threshold_units,
                    )
            else:
                remaining_region_paths = region_paths
            for region, paths in remaining_region_paths:
                for path in self._order_region_paths(region, paths, last_x, last_y):
                    last_x, last_y = self._write_path(
                        pattern,
                        path,
                        last_x,
                        last_y,
                        connect_nearby=region.stitch_settings.fill_mode not in (
                            "run",
                            "satin",
                            "contour",
                        ),
                    )

        # END does not encode movement in DST. Keep it at the needle position so
        # in-memory bounds match the file that machines and viewers decode.
        end_x = 0 if last_x is None else last_x
        end_y = 0 if last_y is None else last_y
        pattern.add_stitch_absolute(pyembroidery.END, end_x, end_y)

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
        if filepath.lower().endswith(".pes"):
            # PES v1 remaps custom RGB values to a small built-in Brother
            # palette. Version 6 embeds the actual thread chart and colors.
            write_settings.setdefault("version", 6.0)
        pyembroidery.write(pattern, filepath, write_settings)
        written_files = [filepath]
        if filepath.lower().endswith(".pes") and os.path.isfile(filepath):
            self.validate_roundtrip(pattern, filepath)
        if filepath.lower().endswith(".dst"):
            self._embed_compact_dst_metadata(filepath, pattern)
            self._validate_dst_roundtrip(pattern, filepath)
            edr_path = os.path.splitext(filepath)[0] + ".edr"
            pyembroidery.write(pattern, edr_path, {})
            written_files.append(edr_path)
        return written_files

    def validate_roundtrip(
        self,
        source_pattern: pyembroidery.EmbPattern,
        filepath: str,
    ) -> ExportRoundTripReport:
        """Decode an export and reject material geometry or color changes."""
        if not os.path.isfile(filepath):
            raise ValueError(f"Exported embroidery file does not exist: {filepath}")
        try:
            decoded = pyembroidery.EmbPattern(filepath)
        except Exception as error:
            raise ValueError(f"Export readback failed: {error}") from error

        source = PatternRenderer.statistics(source_pattern)
        actual = PatternRenderer.statistics(decoded)
        if source.sewn_bounds is None or actual.sewn_bounds is None:
            raise ValueError("Export readback failed: missing sewn stitches")

        tolerance = tuple(
            max(2.0, abs(source.sewn_bounds[index + 2] - source.sewn_bounds[index]) * 0.01)
            for index in range(2)
        )
        for index, (expected, observed) in enumerate(
            zip(source.sewn_bounds, actual.sewn_bounds)
        ):
            allowed = tolerance[index % 2]
            if abs(observed - expected) > allowed:
                raise ValueError(
                    "Export readback failed: sewn bounds changed from "
                    f"{source.sewn_bounds} to {actual.sewn_bounds}"
                )

        stitch_tolerance = max(2, int(round(source.stitch_commands * 0.01)))
        if abs(actual.stitch_commands - source.stitch_commands) > stitch_tolerance:
            raise ValueError(
                "Export readback failed: stitch count changed from "
                f"{source.stitch_commands} to {actual.stitch_commands}"
            )

        extension = os.path.splitext(filepath)[1].lower()
        if extension == ".pes" and actual.thread_colors != source.thread_colors:
            raise ValueError(
                "Export readback failed: thread colors changed from "
                f"{source.thread_colors} to {actual.thread_colors}"
            )

        source_render = PatternRenderer.render(source_pattern, size=(720, 960))
        decoded_render = PatternRenderer.render(decoded, size=(720, 960))
        difference = (
            source_render.astype(np.float32)
            - decoded_render.astype(np.float32)
        )
        rmse = float(np.sqrt(np.mean(difference * difference)))
        render_similarity = float(np.clip(1.0 - rmse / 255.0, 0.0, 1.0))
        if render_similarity < 0.99:
            raise ValueError(
                "Export readback failed: rendered stitch similarity "
                f"{render_similarity:.4f} is below 0.9900"
            )

        return ExportRoundTripReport(
            valid=True,
            source_stitch_commands=source.stitch_commands,
            decoded_stitch_commands=actual.stitch_commands,
            source_jump_commands=source.jump_commands,
            decoded_jump_commands=actual.jump_commands,
            source_bounds=source.sewn_bounds,
            decoded_bounds=actual.sewn_bounds,
            source_thread_colors=source.thread_colors,
            decoded_thread_colors=actual.thread_colors,
            render_similarity=render_similarity,
        )

    def _validate_dst_roundtrip(
        self,
        source_pattern: pyembroidery.EmbPattern,
        filepath: str,
    ):
        """Reject a DST whose encoded sewing area changes design size."""
        # Test doubles may capture writes without creating a physical file.
        if not os.path.isfile(filepath):
            return
        try:
            decoded = pyembroidery.EmbPattern(filepath)
            expected = self._sewn_bounds(source_pattern)
            actual = self._sewn_bounds(decoded)
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

    @staticmethod
    def _sewn_bounds(pattern: pyembroidery.EmbPattern):
        """Return bounds of sewn segments, excluding travel-only movement."""
        points = []
        previous = None
        for x, y, command in pattern.stitches:
            point = (float(x), float(y))
            if (int(command) & 0xFF) == pyembroidery.STITCH:
                # DST readers commonly omit a zero-length initial jump. The
                # first stitch still starts at the machine origin, so include
                # it when no explicit prior position survived decoding.
                points.append((0.0, 0.0) if previous is None else previous)
                points.append(point)
            previous = point
        if not points:
            return None
        xs, ys = zip(*points)
        return min(xs), min(ys), max(xs), max(ys)

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
        project = Project()
        project.name = layer.name
        selected_layer = copy(layer)
        selected_layer.visible = True
        project.layers = [selected_layer]
        return self.export(project, filepath, settings)

    def _safe_design_name(self, name: str) -> str:
        """Embroidery headers are safest with short ASCII design names."""
        safe = "".join(ch if 32 <= ord(ch) <= 126 else "_" for ch in (name or "Untitled"))
        safe = safe.strip(" _") or "Untitled"
        return safe[:16]

    def _thread_for_layer(self, layer: Layer, index: int) -> pyembroidery.EmbThread:
        """Create a thread with fields used by embroidery writers."""
        thread = pyembroidery.EmbThread()
        r, g, b = layer.effective_color_rgb()
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
        """Combine equal threads only when moving them cannot change occlusion."""
        grouped = []
        latest_indexes = {}
        for layer, region_paths in drawable_layers:
            color = layer.effective_color_rgb()
            if layer.thread_uid and layer.matched_thread_rgb:
                key = ("thread", layer.thread_uid)
            else:
                key = ("color", color)

            index = latest_indexes.get(key)
            can_merge = index is not None and all(
                not self._drawable_regions_overlap(
                    region_paths,
                    intervening_paths,
                )
                for _, intervening_paths in grouped[index + 1:]
            )
            if not can_merge:
                latest_indexes[key] = len(grouped)
                grouped.append((layer, list(region_paths)))
            else:
                grouped[index][1].extend(region_paths)
        return grouped

    @staticmethod
    def _scene_plane_rank(scene_plane):
        return {
            "background_base": 0,
            "background_detail": 1,
            "subject_base": 2,
            "subject_detail": 3,
        }.get(scene_plane, 2)

    @classmethod
    def _drawable_regions_overlap(cls, first, second):
        """Conservatively detect visual dependency between drawable objects."""
        first_bounds = cls._drawable_bounds(first)
        second_bounds = cls._drawable_bounds(second)
        if first_bounds is None or second_bounds is None:
            return True
        return not (
            first_bounds[2] < second_bounds[0]
            or second_bounds[2] < first_bounds[0]
            or first_bounds[3] < second_bounds[1]
            or second_bounds[3] < first_bounds[1]
        )

    @staticmethod
    def _drawable_bounds(region_paths):
        points = [
            point
            for _, paths in region_paths
            for path in paths
            for point in path
        ]
        if not points:
            return None
        xs, ys = zip(*points)
        return min(xs), min(ys), max(xs), max(ys)

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
        if getattr(region.stitch_settings, "fill_mode", "") == "cross_stitch":
            return self._order_paths_linear(paths, last_x, last_y)
        if len(paths) >= 256:
            return self._order_paths_spatial(paths, last_x, last_y)
        return self._order_paths_from(paths, last_x, last_y)

    def _order_paths_spatial(
        self,
        paths: List[List[Tuple[float, float]]],
        last_x: Optional[int],
        last_y: Optional[int],
    ) -> List[List[Tuple[float, float]]]:
        """Order large path sets by coarse rows without quadratic searches."""
        row_height = max(40.0, float(self.jump_threshold_units) * 4.0)
        rows = {}
        for path in paths:
            if len(path) < 2:
                continue
            center_x = (path[0][0] + path[-1][0]) * 0.5
            center_y = (path[0][1] + path[-1][1]) * 0.5
            row = int(np.floor(center_y / row_height))
            rows.setdefault(row, []).append((center_x, center_y, path))

        spatial = []
        for row_index, row in enumerate(sorted(rows)):
            entries = sorted(
                rows[row],
                key=lambda entry: (entry[0], entry[1]),
                reverse=bool(row_index % 2),
            )
            spatial.extend(path for _, _, path in entries)
        return self._order_paths_linear(spatial, last_x, last_y)

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

    def _order_cross_stitch_group_paths(
        self,
        region_paths,
        last_x: Optional[int],
        last_y: Optional[int],
    ) -> List[List[Tuple[float, float]]]:
        """Spatially order all shades assigned to one physical cross-stitch thread."""
        flattened = []
        cell_sizes = []
        for region, paths in region_paths:
            cell_sizes.append(
                max(1.0, float(region.stitch_settings.cross_pattern_size_mm) * 10.0)
            )
            for path in paths:
                if len(path) < 2:
                    continue
                center_x = (path[0][0] + path[-1][0]) * 0.5
                center_y = (path[0][1] + path[-1][1]) * 0.5
                flattened.append((center_x, center_y, path))
        if not flattened:
            return []

        row_height = float(np.median(cell_sizes)) if cell_sizes else 20.0
        rows = {}
        for center_x, center_y, path in flattened:
            row = int(np.floor(center_y / max(1.0, row_height) + 0.5))
            rows.setdefault(row, []).append((center_x, center_y, path))

        spatial = []
        for row_index, row in enumerate(sorted(rows)):
            entries = sorted(
                rows[row],
                key=lambda entry: (entry[0], entry[1]),
                reverse=bool(row_index % 2),
            )
            spatial.extend(path for _, _, path in entries)
        return self._order_paths_linear(spatial, last_x, last_y)

    def _write_path(
        self,
        pattern: pyembroidery.EmbPattern,
        path: List[Tuple[float, float]],
        last_x: Optional[int],
        last_y: Optional[int],
        connect_nearby: bool = True,
        connection_threshold_units: Optional[float] = None,
    ) -> Tuple[Optional[int], Optional[int]]:
        """Write one path, optionally sewing a short gap from the prior path."""
        if len(path) < 2:
            return last_x, last_y

        first_x, first_y = int(round(path[0][0])), int(round(path[0][1]))
        connection_threshold = (
            float(self.jump_threshold_units)
            if connection_threshold_units is None
            else float(connection_threshold_units)
        )
        connected_to_previous = False
        if last_x is not None and last_y is not None:
            gap = float(np.hypot(first_x - last_x, first_y - last_y))
            if connect_nearby and gap <= connection_threshold:
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
            # Establish the path start as a sewn needle position. Without this
            # anchor, PES normalization can convert the first visible segment
            # into travel and silently remove it during write/read round trips.
            pattern.add_stitch_absolute(
                pyembroidery.STITCH,
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
