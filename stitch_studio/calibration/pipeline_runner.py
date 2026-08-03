"""Run the production recognition and stitch pipeline for offline calibration."""

from __future__ import annotations

import time
from dataclasses import asdict

import cv2
import numpy as np
from PIL import Image

from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity
from stitch_studio.core.export_engine import ExportEngine
from stitch_studio.core.image_engine import ImageEngine
from stitch_studio.core.pattern_renderer import PatternRenderer
from stitch_studio.core.project import Project, QuantizationSettings
from stitch_studio.core.recognition_engine import RecognitionEngine
from stitch_studio.core.stitch_engine import StitchEngine
from stitch_studio.core.thread_db import ThreadColor
from stitch_studio.ui.main_window import StitchWorker


class MSEmbPipelineRunner:
    """Evaluate the same image-to-stitches path used by the desktop app."""

    def __init__(self, max_colors: int = 12, max_dimension: int = 512):
        self.max_colors = max(2, int(max_colors))
        self.max_dimension = max(96, int(max_dimension))

    def evaluate(
        self,
        source: np.ndarray,
        target: np.ndarray,
        generation_mode: str,
    ) -> dict:
        if generation_mode not in ("photo_stitch", "cross_stitch"):
            raise ValueError(f"Unsupported generation mode: {generation_mode}")
        working_source = self._bounded_rgb(source)
        threads = self._build_thread_palette(working_source)
        settings = QuantizationSettings(
            n_colors=min(self.max_colors, len(threads)),
            design_color_budget=min(24, max(8, len(threads) * 2)),
            include_background=True,
            preserve_details=True,
            detail_sensitivity=0.72,
            min_region_area_px=4,
            morphology_kernel_size=3,
            smooth_regions=False,
        )

        started = time.perf_counter()
        recognition = RecognitionEngine.recognize(
            working_source,
            threads,
            settings,
        )
        recognized_at = time.perf_counter()
        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            working_source,
            generation_mode=generation_mode,
            quant_settings=settings,
        )
        layered_at = time.perf_counter()

        project = Project()
        project.name = f"MSEmb {generation_mode}"
        project.source_image = working_source
        project.processed_image = working_source
        project.quant_settings = settings
        project.generation_mode = generation_mode
        project.layers = layers
        engine = StitchEngine()
        worker = StitchWorker(project, engine, image=working_source)
        worker.run()
        if worker.failure_message:
            raise RuntimeError(worker.failure_message)
        stitched_at = time.perf_counter()

        pattern = ExportEngine().build_pattern(project)
        pattern_stats = PatternRenderer.statistics(pattern)
        background = self._border_color(target)
        height, width = working_source.shape[:2]
        units_per_pixel = 10.0 / float(engine.px_per_mm)
        preview = PatternRenderer.render(
            pattern,
            size=(height, width),
            padding=0,
            background_rgb=background,
            design_bounds=(
                0.0,
                0.0,
                float(width) * units_per_pixel,
                float(height) * units_per_pixel,
            ),
        )
        scores = measure_msemb_fidelity(preview, target).as_dict()
        return {
            "preview": preview,
            "scores": scores,
            "timings": {
                "recognition_seconds": recognized_at - started,
                "layer_seconds": layered_at - recognized_at,
                "stitch_seconds": stitched_at - layered_at,
                "total_seconds": stitched_at - started,
            },
            "layer_count": len(layers),
            "region_count": sum(len(layer.regions) for layer in layers),
            "semantic_part_count": len(recognition.semantic_parts),
            "stitch_count": pattern_stats.stitch_commands,
            "jump_count": pattern_stats.jump_commands,
            "trim_count": pattern_stats.trim_commands,
            "color_change_count": pattern_stats.color_changes,
            "pattern_statistics": asdict(pattern_stats),
            "recognition_metrics": asdict(recognition.metrics),
            "thread_metrics": asdict(recognition.thread_metrics),
            "subject_metrics": asdict(recognition.subject_metrics),
        }

    def _bounded_rgb(self, source: np.ndarray) -> np.ndarray:
        image = np.asarray(source, dtype=np.uint8)[:, :, :3]
        height, width = image.shape[:2]
        scale = min(1.0, self.max_dimension / max(height, width))
        if scale >= 1.0:
            return np.array(image, copy=True)
        return cv2.resize(
            image,
            (
                max(1, int(round(width * scale))),
                max(1, int(round(height * scale))),
            ),
            interpolation=cv2.INTER_AREA,
        )

    def _build_thread_palette(self, source: np.ndarray) -> list[ThreadColor]:
        image = Image.fromarray(source, mode="RGB")
        quantized = image.quantize(
            colors=self.max_colors,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.NONE,
        )
        palette = quantized.getpalette() or []
        counts = sorted(
            quantized.getcolors(maxcolors=source.shape[0] * source.shape[1]) or [],
            reverse=True,
        )
        colors = []
        seen = set()
        for _, palette_index in counts:
            offset = int(palette_index) * 3
            rgb = tuple(int(value) for value in palette[offset : offset + 3])
            if len(rgb) != 3 or rgb in seen:
                continue
            seen.add(rgb)
            colors.append(rgb)
        if not colors:
            colors = [tuple(int(value) for value in np.mean(source, axis=(0, 1)))]
        return [
            ThreadColor(
                uid=f"cal-{index:02d}",
                name=f"Calibration {index + 1}",
                color_rgb=rgb,
            )
            for index, rgb in enumerate(colors[: self.max_colors])
        ]

    @staticmethod
    def _border_color(target: np.ndarray) -> tuple[int, int, int]:
        target_rgb = np.asarray(target, dtype=np.uint8)[:, :, :3]
        border = np.concatenate(
            (
                target_rgb[0],
                target_rgb[-1],
                target_rgb[:, 0],
                target_rgb[:, -1],
            ),
            axis=0,
        )
        return tuple(int(round(value)) for value in np.median(border, axis=0))
