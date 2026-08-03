import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


class RealExportRoundTripTests(unittest.TestCase):
    def test_patrick_photo_stitch_pes_roundtrip_keeps_real_pattern(self):
        source_path = (
            Path(__file__).resolve().parent
            / "fixtures"
            / "patrick-source.png"
        )
        script = r"""
import json
import os
import tempfile

import numpy as np
from PIL import Image

from stitch_studio.calibration.pipeline_runner import MSEmbPipelineRunner
from stitch_studio.core.export_engine import ExportEngine
from stitch_studio.core.image_engine import ImageEngine
from stitch_studio.core.project import Project, QuantizationSettings
from stitch_studio.core.recognition_engine import RecognitionEngine
from stitch_studio.core.stitch_engine import StitchEngine
from stitch_studio.ui.main_window import StitchWorker

source = np.array(Image.open(os.environ["PATRICK_SOURCE"]).convert("RGB"))
runner = MSEmbPipelineRunner(max_colors=15, max_dimension=512)
threads = runner._build_thread_palette(source)
settings = QuantizationSettings(
    n_colors=min(15, len(threads)),
    design_color_budget=min(24, max(8, len(threads) * 2)),
    include_background=True,
    preserve_details=True,
    detail_sensitivity=0.72,
    min_region_area_px=4,
    morphology_kernel_size=3,
    smooth_regions=False,
)
recognition = RecognitionEngine.recognize(source, threads, settings)
layers = ImageEngine.build_layers_from_recognition(
    recognition,
    threads,
    source,
    generation_mode="photo_stitch",
    quant_settings=settings,
)
project = Project()
project.name = "patrick-roundtrip"
project.source_image = source
project.processed_image = source
project.quant_settings = settings
project.generation_mode = "photo_stitch"
project.layers = layers
worker = StitchWorker(project, StitchEngine(), image=source)
worker.run()
if worker.failure_message:
    raise RuntimeError(worker.failure_message)

engine = ExportEngine()
pattern = engine.build_pattern(project)
with tempfile.TemporaryDirectory() as directory:
    path = os.path.join(directory, "patrick.pes")
    engine.export(project, path)
    report = engine.validate_roundtrip(pattern, path)
    print("ROUNDTRIP=" + json.dumps(report.as_dict()))
"""
        environment = os.environ.copy()
        environment["PATRICK_SOURCE"] = str(source_path)
        environment["QT_QPA_PLATFORM"] = "offscreen"
        completed = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            env=environment,
            check=False,
            timeout=45,
        )

        self.assertEqual(
            completed.returncode,
            0,
            completed.stdout + completed.stderr,
        )
        payload = next(
            line.removeprefix("ROUNDTRIP=")
            for line in completed.stdout.splitlines()
            if line.startswith("ROUNDTRIP=")
        )
        report = json.loads(payload)
        self.assertTrue(report["valid"])
        self.assertEqual(
            report["source_stitch_commands"],
            report["decoded_stitch_commands"],
        )
        self.assertEqual(report["source_bounds"], report["decoded_bounds"])
        self.assertEqual(
            report["source_thread_colors"],
            report["decoded_thread_colors"],
        )
        self.assertGreaterEqual(report["render_similarity"], 0.99)

    def test_pes_roundtrip_preserves_render_geometry_and_colors(self):
        script = r"""
import json
import os
import tempfile

from stitch_studio.core.export_engine import ExportEngine
from stitch_studio.core.project import Layer, Project, Region

project = Project()
project.name = "roundtrip"
project.layers = [
    Layer(
        name="coral",
        thread_color_rgb=(250, 139, 119),
        matched_thread_rgb=(250, 139, 119),
        order=0,
        regions=[Region(stitch_paths=[[(0, 0), (100, 0), (100, 100)]])],
    ),
    Layer(
        name="navy",
        thread_color_rgb=(12, 34, 56),
        matched_thread_rgb=(12, 34, 56),
        order=1,
        regions=[Region(stitch_paths=[[(20, 20), (80, 80)]])],
    ),
]
engine = ExportEngine()
source = engine.build_pattern(project)
with tempfile.TemporaryDirectory() as directory:
    path = os.path.join(directory, "roundtrip.pes")
    engine.export(project, path)
    report = engine.validate_roundtrip(source, path)
    print("ROUNDTRIP=" + json.dumps(report.as_dict()))
"""
        environment = os.environ.copy()
        environment["QT_QPA_PLATFORM"] = "offscreen"
        completed = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            env=environment,
            check=False,
            timeout=30,
        )

        self.assertEqual(
            completed.returncode,
            0,
            completed.stdout + completed.stderr,
        )
        payload = next(
            line.removeprefix("ROUNDTRIP=")
            for line in completed.stdout.splitlines()
            if line.startswith("ROUNDTRIP=")
        )
        report = json.loads(payload)
        self.assertGreaterEqual(report["render_similarity"], 0.99)
        self.assertEqual(report["source_thread_colors"], report["decoded_thread_colors"])
        self.assertEqual(report["source_stitch_commands"], report["decoded_stitch_commands"])
        self.assertTrue(report["valid"])

    def test_new_path_has_a_sewn_anchor_before_its_first_visible_segment(self):
        script = r"""
import json

import pyembroidery

from stitch_studio.core.export_engine import ExportEngine
from stitch_studio.core.project import Layer, Project, Region

project = Project()
project.layers = [
    Layer(
        name="outline",
        thread_color_rgb=(12, 34, 56),
        regions=[Region(stitch_paths=[[(20, 20), (80, 80)]])],
    ),
]
pattern = ExportEngine().build_pattern(project)
commands = [
    [int(x), int(y), int(command) & 0xFF]
    for x, y, command in pattern.stitches
]
print("COMMANDS=" + json.dumps(commands))
"""
        completed = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        self.assertEqual(
            completed.returncode,
            0,
            completed.stdout + completed.stderr,
        )
        payload = next(
            line.removeprefix("COMMANDS=")
            for line in completed.stdout.splitlines()
            if line.startswith("COMMANDS=")
        )
        commands = json.loads(payload)
        self.assertEqual(commands[:3], [[20, 20, 1], [20, 20, 0], [80, 80, 0]])


if __name__ == "__main__":
    unittest.main()
