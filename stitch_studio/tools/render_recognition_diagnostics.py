"""Render inspectable recognition artifacts before stitch generation.

This tool deliberately does not export embroidery.  It gives image restoration
its own acceptance gate: source pixels -> design colors -> diagnostic previews.
Only after this output is acceptable should a physical thread palette and stitch
planner be allowed to change the design.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from stitch_studio.core.project import QuantizationSettings
from stitch_studio.core.recognition_engine import RecognitionEngine
from stitch_studio.core.thread_db import ThreadColor


def _source_palette_threads(image: np.ndarray, colors: int) -> list[ThreadColor]:
    """Create a deterministic review palette from the source, not a catalog."""
    quantized = Image.fromarray(image).quantize(
        colors=max(2, min(int(colors), 128)),
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    palette = quantized.getpalette() or []
    counts = quantized.getcolors() or []
    threads = []
    for order, (count, index) in enumerate(
        sorted(counts, key=lambda item: (-item[0], item[1]))
    ):
        base = int(index) * 3
        if base + 2 >= len(palette):
            continue
        rgb = tuple(int(channel) for channel in palette[base : base + 3])
        if count <= 0 or rgb in {thread.color_rgb for thread in threads}:
            continue
        threads.append(
            ThreadColor(
                uid=f"review-{order:02d}",
                name=f"Design review {order + 1}",
                color_rgb=rgb,
            )
        )
    return threads or [ThreadColor(uid="review-black", name="Black", color_rgb=(0, 0, 0))]


def render_diagnostics(
    source_path: str | Path,
    output_dir: str | Path,
    *,
    design_colors: int = 64,
    review_palette_colors: int = 48,
) -> dict:
    """Write source, design, layer and error-map PNGs plus a JSON scorecard."""
    source_file = Path(source_path)
    output = Path(output_dir)
    image = np.asarray(Image.open(source_file).convert("RGB"), dtype=np.uint8)
    threads = _source_palette_threads(image, review_palette_colors)
    settings = QuantizationSettings(
        n_colors=min(len(threads), review_palette_colors),
        design_color_budget=max(2, int(design_colors)),
        auto_design_colors=False,
        include_background=True,
        preserve_details=True,
        detail_sensitivity=0.65,
        min_region_area_px=12,
        morphology_kernel_size=3,
        smooth_regions=True,
    )
    result = RecognitionEngine.recognize(image, threads, settings)
    diagnostics = RecognitionEngine.build_design_diagnostics(image, result)

    output.mkdir(parents=True, exist_ok=True)
    images = {
        "source.png": image,
        "design-reconstruction.png": diagnostics.design_preview_rgb,
        "design-layers.png": diagnostics.layer_preview_rgb,
        "difference-heatmap.png": diagnostics.difference_heatmap_rgb,
    }
    for name, pixels in images.items():
        Image.fromarray(np.asarray(pixels, dtype=np.uint8), mode="RGB").save(
            output / name
        )

    report = {
        "source": str(source_file),
        "design_colors": len(result.design_colors),
        "review_palette_colors": len(threads),
        "acceptance_passed": diagnostics.acceptance_passed,
        "acceptance_failures": list(diagnostics.acceptance_failures),
        "overall": diagnostics.metrics.__dict__,
        "subject": diagnostics.subject_metrics.__dict__,
        "artifacts": {name: str(output / name) for name in images},
    }
    (output / "recognition-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render recognition acceptance artifacts before embroidery generation."
    )
    parser.add_argument("source", type=Path, help="Input source image")
    parser.add_argument("--output", type=Path, required=True, help="Artifact directory")
    parser.add_argument("--design-colors", type=int, default=64)
    parser.add_argument("--review-palette-colors", type=int, default=48)
    args = parser.parse_args(argv)
    report = render_diagnostics(
        args.source,
        args.output,
        design_colors=args.design_colors,
        review_palette_colors=args.review_palette_colors,
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
