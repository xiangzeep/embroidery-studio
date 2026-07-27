# MSEmb Dataset Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MSEmb dataset evaluation and calibration foundation without changing the normal beginner workflow.

**Architecture:** Add a focused `stitch_studio.calibration` package for dataset pairing, visual metrics, and offline reports. Add a `stitch_studio.tools.msemb_calibrate` command that reads a local dataset root, evaluates deterministic samples, and writes JSON plus montage artifacts to a user-specified output directory.

**Tech Stack:** Python stdlib, NumPy, OpenCV, Pillow, existing `RecognitionEngine`, existing stitch preview/rendering utilities where available, `unittest`.

## Global Constraints

- Do not copy the 4250-pair dataset into git.
- Default dataset root: `/Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned`.
- Input pairs are `trainX_c/c_XXXXX.png` and `trainX_e/e_XXXXX.png`.
- All expected dataset images are 256x256 RGB PNGs.
- Metrics compare generated preview images against embroidery-style target images; they do not infer PES/DST jump commands.
- The initial runner is read-only and must not change application behavior.
- Unit tests must use temporary synthetic fixtures, not the full external dataset.
- Normal UI import/export workflow must remain unchanged.

---

### Task 1: Dataset Pairing and Audit

**Files:**
- Create: `stitch_studio/calibration/__init__.py`
- Create: `stitch_studio/calibration/msemb_dataset.py`
- Create: `tests/test_msemb_calibration.py`

**Interfaces:**
- Produces: `MSEmbPair(pair_id: str, source_path: Path, target_path: Path)`
- Produces: `MSEmbAudit(total_pairs: int, missing_sources: tuple[str, ...], missing_targets: tuple[str, ...], unreadable: tuple[str, ...], size_mismatches: tuple[str, ...])`
- Produces: `MSEmbDataset(root: str | Path, expected_size: tuple[int, int] = (256, 256))`
- Produces: `MSEmbDataset.audit() -> MSEmbAudit`
- Produces: `MSEmbDataset.pairs() -> list[MSEmbPair]`
- Produces: `MSEmbDataset.load_pair(pair: MSEmbPair) -> tuple[np.ndarray, np.ndarray]`
- Produces: `MSEmbDataset.split_ids(seed: int = 20260727, train: float = 0.8, val: float = 0.1) -> dict[str, tuple[str, ...]]`

- [ ] **Step 1: Write failing dataset tests**

Add this test class to `tests/test_msemb_calibration.py`:

```python
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from stitch_studio.calibration.msemb_dataset import MSEmbDataset


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

            self.assertEqual(audit.total_pairs, 1)
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration.MSEmbDatasetTests
```

Expected: fail because `stitch_studio.calibration.msemb_dataset` does not exist.

- [ ] **Step 3: Implement dataset adapter**

Create `stitch_studio/calibration/__init__.py`:

```python
"""Local calibration utilities for paired embroidery-style datasets."""
```

Create `stitch_studio/calibration/msemb_dataset.py`:

```python
"""Dataset adapter for local MSEmb paired source/style images."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple
import random

import numpy as np
from PIL import Image, UnidentifiedImageError


@dataclass(frozen=True)
class MSEmbPair:
    pair_id: str
    source_path: Path
    target_path: Path


@dataclass(frozen=True)
class MSEmbAudit:
    total_pairs: int
    missing_sources: Tuple[str, ...]
    missing_targets: Tuple[str, ...]
    unreadable: Tuple[str, ...]
    size_mismatches: Tuple[str, ...]


class MSEmbDataset:
    def __init__(self, root: str | Path, expected_size: Tuple[int, int] = (256, 256)):
        self.root = Path(root)
        self.expected_size = tuple(expected_size)
        self.source_dir = self.root / "trainX_c"
        self.target_dir = self.root / "trainX_e"

    def _ids_for(self, folder: Path, prefix: str) -> Dict[str, Path]:
        if not folder.exists():
            return {}
        result: Dict[str, Path] = {}
        for path in folder.glob(f"{prefix}_*.png"):
            pair_id = path.stem.removeprefix(f"{prefix}_")
            if pair_id.isdigit():
                result[pair_id] = path
        return result

    def _source_paths(self) -> Dict[str, Path]:
        return self._ids_for(self.source_dir, "c")

    def _target_paths(self) -> Dict[str, Path]:
        return self._ids_for(self.target_dir, "e")

    def pairs(self) -> List[MSEmbPair]:
        sources = self._source_paths()
        targets = self._target_paths()
        ids = sorted(set(sources) & set(targets))
        return [MSEmbPair(pair_id, sources[pair_id], targets[pair_id]) for pair_id in ids]

    def _validate_image(self, path: Path) -> Tuple[bool, bool]:
        try:
            with Image.open(path) as image:
                return True, image.mode == "RGB" and image.size == self.expected_size
        except (OSError, UnidentifiedImageError):
            return False, False

    def audit(self) -> MSEmbAudit:
        sources = self._source_paths()
        targets = self._target_paths()
        source_ids = set(sources)
        target_ids = set(targets)
        unreadable = []
        size_mismatches = []
        valid_pairs = 0
        for pair_id in sorted(source_ids & target_ids):
            source_readable, source_size_ok = self._validate_image(sources[pair_id])
            target_readable, target_size_ok = self._validate_image(targets[pair_id])
            if not source_readable or not target_readable:
                unreadable.append(pair_id)
                continue
            if not source_size_ok or not target_size_ok:
                size_mismatches.append(pair_id)
                continue
            valid_pairs += 1
        return MSEmbAudit(
            total_pairs=valid_pairs,
            missing_sources=tuple(sorted(target_ids - source_ids)),
            missing_targets=tuple(sorted(source_ids - target_ids)),
            unreadable=tuple(unreadable),
            size_mismatches=tuple(size_mismatches),
        )

    def load_pair(self, pair: MSEmbPair) -> Tuple[np.ndarray, np.ndarray]:
        with Image.open(pair.source_path) as source_image:
            source = np.asarray(source_image.convert("RGB"), dtype=np.uint8)
        with Image.open(pair.target_path) as target_image:
            target = np.asarray(target_image.convert("RGB"), dtype=np.uint8)
        return source, target

    def split_ids(
        self,
        seed: int = 20260727,
        train: float = 0.8,
        val: float = 0.1,
    ) -> Dict[str, Tuple[str, ...]]:
        ids = [pair.pair_id for pair in self.pairs()]
        rng = random.Random(seed)
        rng.shuffle(ids)
        train_count = int(len(ids) * train)
        val_count = int(len(ids) * val)
        return {
            "train": tuple(sorted(ids[:train_count])),
            "val": tuple(sorted(ids[train_count : train_count + val_count])),
            "test": tuple(sorted(ids[train_count + val_count :])),
        }
```

- [ ] **Step 4: Run dataset tests**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration.MSEmbDatasetTests
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add stitch_studio/calibration/__init__.py stitch_studio/calibration/msemb_dataset.py tests/test_msemb_calibration.py
git commit -m "feat: add msemb dataset adapter"
```

### Task 2: Visual Fidelity Metrics

**Files:**
- Create: `stitch_studio/calibration/msemb_metrics.py`
- Modify: `tests/test_msemb_calibration.py`

**Interfaces:**
- Consumes: RGB arrays from `MSEmbDataset.load_pair`
- Produces: `MSEmbMetricScores(color_similarity: float, edge_recall: float, edge_precision: float, texture_similarity: float, noise_penalty: float, overall: float)`
- Produces: `measure_msemb_fidelity(generated: np.ndarray, target: np.ndarray) -> MSEmbMetricScores`

- [ ] **Step 1: Write failing metric tests**

Append to `tests/test_msemb_calibration.py`:

```python
from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity


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
        cv2.rectangle(target, (8, 8), (56, 56), (240, 40, 40), -1)
        cv2.line(target, (8, 32), (56, 32), (10, 10, 10), 2)
        generated = np.full_like(target, (30, 120, 220))

        scores = measure_msemb_fidelity(generated, target)

        self.assertLess(scores.color_similarity, 0.80)
        self.assertLess(scores.edge_recall, 0.70)
        self.assertLess(scores.overall, 0.80)

    def test_isolated_specks_increase_noise_penalty(self):
        target = np.zeros((48, 48, 3), dtype=np.uint8)
        generated = target.copy()
        for index in range(12):
            generated[2 + index, 3 + index] = (255, 255, 255)

        scores = measure_msemb_fidelity(generated, target)

        self.assertGreater(scores.noise_penalty, 0.0)
        self.assertLess(scores.overall, 0.98)
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration.MSEmbMetricTests
```

Expected: fail because `msemb_metrics` does not exist.

- [ ] **Step 3: Implement metrics**

Create `stitch_studio/calibration/msemb_metrics.py`:

```python
"""Visual metrics for comparing generated previews with embroidery-style targets."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class MSEmbMetricScores:
    color_similarity: float
    edge_recall: float
    edge_precision: float
    texture_similarity: float
    noise_penalty: float
    overall: float

    def as_dict(self) -> dict[str, float]:
        return {
            "color_similarity": self.color_similarity,
            "edge_recall": self.edge_recall,
            "edge_precision": self.edge_precision,
            "texture_similarity": self.texture_similarity,
            "noise_penalty": self.noise_penalty,
            "overall": self.overall,
        }


def _ensure_rgb(image: np.ndarray) -> np.ndarray:
    array = np.asarray(image, dtype=np.uint8)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ValueError("MSEmb metrics require RGB images")
    return array[:, :, :3]


def _resize_to_target(generated: np.ndarray, target: np.ndarray) -> np.ndarray:
    if generated.shape[:2] == target.shape[:2]:
        return generated
    return cv2.resize(
        generated,
        (target.shape[1], target.shape[0]),
        interpolation=cv2.INTER_AREA,
    )


def _edge_mask(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    high = max(40, int(np.percentile(gray, 75)))
    low = max(15, high // 2)
    return cv2.Canny(gray, low, high) > 0


def _fuzzy_overlap(actual: np.ndarray, expected: np.ndarray, radius: int = 1) -> float:
    if not np.any(expected):
        return 1.0 if not np.any(actual) else 0.0
    kernel = np.ones((radius * 2 + 1, radius * 2 + 1), dtype=np.uint8)
    actual_dilated = cv2.dilate(actual.astype(np.uint8), kernel, iterations=1) > 0
    return float(np.count_nonzero(actual_dilated & expected) / np.count_nonzero(expected))


def _color_similarity(generated: np.ndarray, target: np.ndarray) -> float:
    diff = generated.astype(np.float32) - target.astype(np.float32)
    rmse = float(np.sqrt(np.mean(diff * diff)))
    return float(np.clip(1.0 - rmse / 255.0, 0.0, 1.0))


def _texture_similarity(generated: np.ndarray, target: np.ndarray) -> float:
    gen_gray = cv2.cvtColor(generated, cv2.COLOR_RGB2GRAY).astype(np.float32)
    tar_gray = cv2.cvtColor(target, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gen_dx = cv2.Sobel(gen_gray, cv2.CV_32F, 1, 0, ksize=3)
    gen_dy = cv2.Sobel(gen_gray, cv2.CV_32F, 0, 1, ksize=3)
    tar_dx = cv2.Sobel(tar_gray, cv2.CV_32F, 1, 0, ksize=3)
    tar_dy = cv2.Sobel(tar_gray, cv2.CV_32F, 0, 1, ksize=3)
    gen_mag = np.sqrt(gen_dx * gen_dx + gen_dy * gen_dy)
    tar_mag = np.sqrt(tar_dx * tar_dx + tar_dy * tar_dy)
    mask = (gen_mag > 8.0) | (tar_mag > 8.0)
    if not np.any(mask):
        return 1.0
    gen_angle = np.arctan2(gen_dy[mask], gen_dx[mask])
    tar_angle = np.arctan2(tar_dy[mask], tar_dx[mask])
    similarity = np.cos(gen_angle - tar_angle)
    return float(np.clip((float(np.mean(similarity)) + 1.0) * 0.5, 0.0, 1.0))


def _noise_penalty(generated: np.ndarray, target: np.ndarray) -> float:
    diff = np.linalg.norm(
        generated.astype(np.int16) - target.astype(np.int16),
        axis=2,
    ) > 48
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        diff.astype(np.uint8),
        connectivity=8,
    )
    tiny_area = 0
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area <= 4:
            tiny_area += area
    return float(np.clip(tiny_area / max(1, generated.shape[0] * generated.shape[1]), 0.0, 1.0))


def measure_msemb_fidelity(generated: np.ndarray, target: np.ndarray) -> MSEmbMetricScores:
    target_rgb = _ensure_rgb(target)
    generated_rgb = _resize_to_target(_ensure_rgb(generated), target_rgb)
    generated_edges = _edge_mask(generated_rgb)
    target_edges = _edge_mask(target_rgb)
    edge_recall = _fuzzy_overlap(generated_edges, target_edges)
    edge_precision = _fuzzy_overlap(target_edges, generated_edges)
    color = _color_similarity(generated_rgb, target_rgb)
    texture = _texture_similarity(generated_rgb, target_rgb)
    noise = _noise_penalty(generated_rgb, target_rgb)
    overall = float(
        np.clip(
            0.38 * color
            + 0.24 * edge_recall
            + 0.16 * edge_precision
            + 0.14 * texture
            + 0.08 * (1.0 - noise),
            0.0,
            1.0,
        )
    )
    return MSEmbMetricScores(
        color_similarity=color,
        edge_recall=edge_recall,
        edge_precision=edge_precision,
        texture_similarity=texture,
        noise_penalty=noise,
        overall=overall,
    )
```

- [ ] **Step 4: Run metric tests**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration.MSEmbMetricTests
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add stitch_studio/calibration/msemb_metrics.py tests/test_msemb_calibration.py
git commit -m "feat: add msemb visual metrics"
```

### Task 3: Offline Calibration Report Command

**Files:**
- Create: `stitch_studio/tools/__init__.py`
- Create: `stitch_studio/tools/msemb_calibrate.py`
- Modify: `tests/test_msemb_calibration.py`

**Interfaces:**
- Consumes: `MSEmbDataset`, `measure_msemb_fidelity`
- Produces: `run_calibration(dataset_root: Path, output_dir: Path, limit: int = 128, seed: int = 20260727) -> dict`
- Produces CLI: `python -m stitch_studio.tools.msemb_calibrate --dataset-root PATH --limit 128 --output PATH`

- [ ] **Step 1: Write failing report tests**

Append to `tests/test_msemb_calibration.py`:

```python
from stitch_studio.tools.msemb_calibrate import run_calibration


class MSEmbCalibrationRunnerTests(unittest.TestCase):
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
            self.assertFalse((root / "msemb-calibration-report.json").exists())
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration.MSEmbCalibrationRunnerTests
```

Expected: fail because `stitch_studio.tools.msemb_calibrate` does not exist.

- [ ] **Step 3: Implement command**

Create `stitch_studio/tools/__init__.py`:

```python
"""Command-line tools for local Stitch Studio workflows."""
```

Create `stitch_studio/tools/msemb_calibrate.py`:

```python
"""Offline MSEmb calibration report command."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable

import numpy as np
from PIL import Image, ImageDraw

from stitch_studio.calibration.msemb_dataset import MSEmbDataset
from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity


DEFAULT_DATASET_ROOT = Path(
    "/Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned"
)


def _average_dict(items: Iterable[dict[str, float]]) -> dict[str, float]:
    rows = list(items)
    if not rows:
        return {}
    keys = rows[0].keys()
    return {key: float(np.mean([row[key] for row in rows])) for key in keys}


def _write_montage(rows, output_path: Path, thumb_size: int = 96) -> None:
    if not rows:
        return
    width = thumb_size * 2
    height = thumb_size * len(rows)
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    for row_index, row in enumerate(rows):
        y = row_index * thumb_size
        source = Image.fromarray(row["source"]).resize((thumb_size, thumb_size))
        target = Image.fromarray(row["target"]).resize((thumb_size, thumb_size))
        canvas.paste(source, (0, y))
        canvas.paste(target, (thumb_size, y))
        draw.text((4, y + 4), row["pair_id"], fill=(255, 0, 0))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)


def run_calibration(
    dataset_root: str | Path,
    output_dir: str | Path,
    limit: int = 128,
    seed: int = 20260727,
) -> Dict:
    dataset = MSEmbDataset(dataset_root)
    audit = dataset.audit()
    pairs = dataset.pairs()
    rng = np.random.default_rng(seed)
    if limit > 0 and len(pairs) > limit:
        indices = sorted(rng.choice(len(pairs), size=limit, replace=False).tolist())
        pairs = [pairs[index] for index in indices]
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    profile_scores = {"identity_preview": []}
    montage_rows = []
    failures = []
    for pair in pairs:
        source, target = dataset.load_pair(pair)
        scores = measure_msemb_fidelity(source, target).as_dict()
        profile_scores["identity_preview"].append(scores)
        montage_rows.append({"pair_id": pair.pair_id, "source": source, "target": target})
        failures.append((pair.pair_id, scores["overall"]))

    profiles = {
        name: {
            "average": _average_dict(scores),
            "samples": len(scores),
        }
        for name, scores in profile_scores.items()
    }
    worst = [
        {"pair_id": pair_id, "overall": float(score)}
        for pair_id, score in sorted(failures, key=lambda item: item[1])[:10]
    ]
    report = {
        "dataset_root": str(Path(dataset_root)),
        "evaluated_pairs": len(pairs),
        "audit": {
            "total_pairs": audit.total_pairs,
            "missing_sources": list(audit.missing_sources),
            "missing_targets": list(audit.missing_targets),
            "unreadable": list(audit.unreadable),
            "size_mismatches": list(audit.size_mismatches),
        },
        "profiles": profiles,
        "worst_samples": worst,
    }
    report_path = output / "msemb-calibration-report.json"
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    _write_montage(montage_rows[:12], output / "msemb-sample-montage.jpg")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate local MSEmb calibration pairs.")
    parser.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=128)
    parser.add_argument("--seed", type=int, default=20260727)
    args = parser.parse_args(argv)

    report = run_calibration(
        dataset_root=args.dataset_root,
        output_dir=args.output,
        limit=args.limit,
        seed=args.seed,
    )
    best = report["profiles"]["identity_preview"]["average"].get("overall", 0.0)
    print(f"已评估 {report['evaluated_pairs']} 对样本")
    print(f"数据集有效配对: {report['audit']['total_pairs']}")
    print(f"当前基线 overall: {best:.3f}")
    print(f"报告: {args.output / 'msemb-calibration-report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run runner tests**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration.MSEmbCalibrationRunnerTests
```

Expected: 1 test passes.

- [ ] **Step 5: Run command on a tiny real sample**

Run:

```bash
PYTHONPATH=. ../../.venv/bin/python -m stitch_studio.tools.msemb_calibrate \
  --dataset-root /Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned \
  --limit 8 \
  --output /private/tmp/msemb-calibration-smoke
```

Expected:

- command exits 0;
- prints Chinese summary;
- writes `/private/tmp/msemb-calibration-smoke/msemb-calibration-report.json`;
- writes `/private/tmp/msemb-calibration-smoke/msemb-sample-montage.jpg`.

- [ ] **Step 6: Commit**

```bash
git add stitch_studio/tools/__init__.py stitch_studio/tools/msemb_calibrate.py tests/test_msemb_calibration.py
git commit -m "feat: add msemb calibration runner"
```

### Task 4: Full Verification

**Files:**
- Modify only if verification exposes a defect in earlier task files.

**Interfaces:**
- Consumes all earlier tasks.
- Produces a clean branch with all tests passing.

- [ ] **Step 1: Run focused tests**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest tests.test_msemb_calibration
```

Expected: all MSEmb calibration tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=. ../../.venv/bin/python -m unittest discover -s tests
```

Expected: all tests pass with the existing skipped tests unchanged.

- [ ] **Step 3: Run compile and diff checks**

Run:

```bash
PYTHONPATH=. ../../.venv/bin/python -m compileall -q stitch_studio tests
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 4: Run real dataset smoke command**

Run:

```bash
PYTHONPATH=. ../../.venv/bin/python -m stitch_studio.tools.msemb_calibrate \
  --dataset-root /Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned \
  --limit 16 \
  --output /private/tmp/msemb-calibration-final
```

Expected: command exits 0 and report JSON has `evaluated_pairs` equal to 16.

- [ ] **Step 5: Confirm git state**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: no uncommitted changes; recent commits include the dataset adapter,
metrics, and runner commits.
