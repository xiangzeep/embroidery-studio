import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from stitch_studio.calibration.msemb_dataset import MSEmbDataset
from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity


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
