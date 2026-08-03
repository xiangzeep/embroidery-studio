import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from stitch_studio.calibration.msemb_dataset import MSEmbDataset
from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity
from stitch_studio.calibration.pipeline_runner import MSEmbPipelineRunner
from stitch_studio.tools.msemb_calibrate import run_calibration


def write_rgb(path: Path, color=(10, 20, 30), size=(256, 256)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path)


class MSEmbDatasetTests(unittest.TestCase):
    def test_pairs_complete_numeric_ids_and_loads_rgb_arrays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_rgb(root / "trainX_c" / "c_00002.png", (2, 0, 0))
            write_rgb(root / "trainX_e" / "e_00002.png", (0, 2, 0))
            write_rgb(root / "trainX_c" / "c_00001.png", (1, 0, 0))
            write_rgb(root / "trainX_e" / "e_00001.png", (0, 1, 0))

            dataset = MSEmbDataset(root)
            audit = dataset.audit()
            pairs = dataset.pairs()
            source, target = dataset.load_pair(pairs[0])

            self.assertEqual(audit.total_pairs, 2)
            self.assertEqual([pair.pair_id for pair in pairs], ["00001", "00002"])
            self.assertEqual(source.shape, (256, 256, 3))
            self.assertEqual(target.shape, (256, 256, 3))
            self.assertEqual(tuple(source[0, 0]), (1, 0, 0))
            self.assertEqual(tuple(target[0, 0]), (0, 1, 0))

    def test_audit_reports_missing_and_bad_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_rgb(root / "trainX_c" / "c_00001.png")
            write_rgb(root / "trainX_e" / "e_00002.png")
            write_rgb(root / "trainX_c" / "c_00003.png", size=(128, 256))
            write_rgb(root / "trainX_e" / "e_00003.png")
            bad = root / "trainX_c" / "c_00004.png"
            bad.parent.mkdir(parents=True, exist_ok=True)
            bad.write_bytes(b"not an image")
            write_rgb(root / "trainX_e" / "e_00004.png")

            audit = MSEmbDataset(root).audit()

            self.assertEqual(audit.total_pairs, 0)
            self.assertEqual(audit.missing_targets, ("00001",))
            self.assertEqual(audit.missing_sources, ("00002",))
            self.assertEqual(audit.size_mismatches, ("00003",))
            self.assertEqual(audit.unreadable, ("00004",))

    def test_split_ids_is_deterministic_and_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(10):
                pair_id = f"{index:05d}"
                write_rgb(root / "trainX_c" / f"c_{pair_id}.png")
                write_rgb(root / "trainX_e" / f"e_{pair_id}.png")

            first = MSEmbDataset(root).split_ids(seed=7, train=0.6, val=0.2)
            second = MSEmbDataset(root).split_ids(seed=7, train=0.6, val=0.2)

            self.assertEqual(first, second)
            self.assertEqual(len(first["train"]), 6)
            self.assertEqual(len(first["val"]), 2)
            self.assertEqual(len(first["test"]), 2)
            all_ids = set(first["train"]) | set(first["val"]) | set(first["test"])
            self.assertEqual(all_ids, {f"{index:05d}" for index in range(10)})


class MSEmbMetricTests(unittest.TestCase):
    def test_identical_images_score_near_perfect(self):
        image = np.zeros((32, 32, 3), dtype=np.uint8)
        image[:, 16:] = (240, 20, 20)
        scores = measure_msemb_fidelity(image, image.copy())

        self.assertGreaterEqual(scores.color_similarity, 0.99)
        self.assertGreaterEqual(scores.edge_recall, 0.99)
        self.assertGreaterEqual(scores.edge_precision, 0.99)
        self.assertGreaterEqual(scores.texture_similarity, 0.99)
        self.assertLessEqual(scores.noise_penalty, 0.01)
        self.assertGreaterEqual(scores.overall, 0.98)

    def test_missing_edges_and_wrong_colors_reduce_score(self):
        target = np.zeros((64, 64, 3), dtype=np.uint8)
        target[8:57, 8:57] = (240, 40, 40)
        target[31:34, 8:57] = (10, 10, 10)
        generated = np.full_like(target, (30, 120, 220))

        scores = measure_msemb_fidelity(generated, target)

        self.assertLess(scores.color_similarity, 0.80)
        self.assertLess(scores.edge_recall, 0.70)
        self.assertLess(scores.overall, 0.80)

    def test_isolated_specks_increase_noise_penalty(self):
        target = np.zeros((48, 48, 3), dtype=np.uint8)
        generated = target.copy()
        for index in range(12):
            generated[2 + index * 3, 3 + index * 3] = (255, 255, 255)

        scores = measure_msemb_fidelity(generated, target)

        self.assertGreater(scores.noise_penalty, 0.0)
        self.assertLess(scores.overall, 0.98)


class MSEmbCalibrationRunnerTests(unittest.TestCase):
    def test_patrick_photo_pipeline_keeps_subject_fill_and_quality_floor(self):
        source_path = (
            Path(__file__).resolve().parent
            / "fixtures"
            / "patrick-source.png"
        )
        source = np.array(Image.open(source_path).convert("RGB"))

        result = MSEmbPipelineRunner(
            max_colors=15,
            max_dimension=512,
        ).evaluate(source, source, "photo_stitch")

        self.assertGreaterEqual(result["scores"]["overall"], 0.72)
        self.assertGreaterEqual(result["scores"]["color_similarity"], 0.86)
        self.assertLess(
            np.linalg.norm(
                result["preview"][170, 160].astype(np.float32)
                - source[170, 160].astype(np.float32)
            ),
            16.0,
        )

    def test_runner_writes_report_without_modifying_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "dataset"
            output = Path(directory) / "report"
            for index in range(3):
                pair_id = f"{index:05d}"
                write_rgb(root / "trainX_c" / f"c_{pair_id}.png", (20 + index, 40, 60))
                write_rgb(root / "trainX_e" / f"e_{pair_id}.png", (20 + index, 40, 60))

            report = run_calibration(root, output, limit=2, seed=1)

            report_path = output / "msemb-calibration-report.json"
            self.assertTrue(report_path.exists())
            self.assertEqual(report["evaluated_pairs"], 2)
            self.assertEqual(report["audit"]["total_pairs"], 3)
            self.assertIn("identity_preview", report["profiles"])
            self.assertIn("overall", report["profiles"]["identity_preview"]["average"])
            self.assertEqual(report["profiles"]["product_photo_stitch"]["samples"], 2)
            self.assertEqual(report["profiles"]["product_cross_stitch"]["samples"], 2)
            self.assertEqual(report["pipeline_failures"], [])
            self.assertFalse((root / "msemb-calibration-report.json").exists())

    def test_runner_evaluates_actual_photo_and_cross_product_pipelines(self):
        class FakePipelineRunner:
            def __init__(self):
                self.calls = []

            def evaluate(self, source, target, generation_mode):
                self.calls.append(generation_mode)
                return {
                    "preview": source.copy(),
                    "scores": measure_msemb_fidelity(source, target).as_dict(),
                    "timings": {
                        "recognition_seconds": 0.01,
                        "layer_seconds": 0.02,
                        "stitch_seconds": 0.03,
                    },
                    "layer_count": 3,
                    "region_count": 5,
                    "semantic_part_count": 4,
                    "stitch_count": 120,
                    "jump_count": 6,
                }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "dataset"
            output = Path(directory) / "report"
            write_rgb(root / "trainX_c" / "c_00001.png", (60, 120, 180))
            write_rgb(root / "trainX_e" / "e_00001.png", (60, 120, 180))
            runner = FakePipelineRunner()

            report = run_calibration(
                root,
                output,
                limit=1,
                pipeline_runner=runner,
                generation_modes=("photo_stitch", "cross_stitch"),
            )

            self.assertEqual(runner.calls, ["photo_stitch", "cross_stitch"])
            self.assertIn("product_photo_stitch", report["profiles"])
            self.assertIn("product_cross_stitch", report["profiles"])
            self.assertEqual(
                report["profiles"]["product_photo_stitch"]["diagnostics"][
                    "average_stitch_count"
                ],
                120.0,
            )
            self.assertEqual(report["pipeline_failures"], [])
