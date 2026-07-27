from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import random
from typing import Iterable

import numpy as np
from PIL import Image, UnidentifiedImageError


@dataclass(frozen=True)
class MSEmbPair:
    pair_id: str
    source_path: Path
    target_path: Path


@dataclass(frozen=True)
class MSEmbAudit:
    source_count: int
    target_count: int
    total_pairs: int
    missing_targets: tuple[str, ...]
    missing_sources: tuple[str, ...]
    unreadable: tuple[str, ...]
    size_mismatches: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not (
            self.missing_targets
            or self.missing_sources
            or self.unreadable
            or self.size_mismatches
        )


class MSEmbDataset:
    """Adapter for paired MSEmb source and embroidery-style render images."""

    def __init__(
        self,
        root: str | Path,
        source_dir: str = "trainX_c",
        target_dir: str = "trainX_e",
    ):
        self.root = Path(root)
        self.source_dir = self.root / source_dir
        self.target_dir = self.root / target_dir

    def pairs(self) -> list[MSEmbPair]:
        source_ids = self._image_ids(self.source_dir, "c_")
        target_ids = self._image_ids(self.target_dir, "e_")
        paired_ids = sorted(set(source_ids) & set(target_ids))
        return [
            MSEmbPair(
                pair_id=pair_id,
                source_path=source_ids[pair_id],
                target_path=target_ids[pair_id],
            )
            for pair_id in paired_ids
            if self._is_valid_pair(source_ids[pair_id], target_ids[pair_id])
        ]

    def audit(self) -> MSEmbAudit:
        source_ids = self._image_ids(self.source_dir, "c_")
        target_ids = self._image_ids(self.target_dir, "e_")
        paired_ids = sorted(set(source_ids) & set(target_ids))
        unreadable: list[str] = []
        size_mismatches: list[str] = []
        valid_pairs = 0

        for pair_id in paired_ids:
            source_size = self._image_size(source_ids[pair_id])
            target_size = self._image_size(target_ids[pair_id])
            if source_size is None or target_size is None:
                unreadable.append(pair_id)
                continue
            if source_size != target_size:
                size_mismatches.append(pair_id)
                continue
            valid_pairs += 1

        return MSEmbAudit(
            source_count=len(source_ids),
            target_count=len(target_ids),
            total_pairs=valid_pairs,
            missing_targets=tuple(sorted(set(source_ids) - set(target_ids))),
            missing_sources=tuple(sorted(set(target_ids) - set(source_ids))),
            unreadable=tuple(unreadable),
            size_mismatches=tuple(size_mismatches),
        )

    def load_pair(self, pair: MSEmbPair) -> tuple[np.ndarray, np.ndarray]:
        return self._load_rgb(pair.source_path), self._load_rgb(pair.target_path)

    def split_ids(
        self,
        seed: int = 42,
        train: float = 0.8,
        val: float = 0.1,
    ) -> dict[str, list[str]]:
        if train < 0 or val < 0 or train + val > 1:
            raise ValueError("train and val fractions must be non-negative and sum to <= 1")
        pair_ids = [pair.pair_id for pair in self.pairs()]
        rng = random.Random(seed)
        rng.shuffle(pair_ids)
        train_end = int(len(pair_ids) * train)
        val_end = train_end + int(len(pair_ids) * val)
        return {
            "train": pair_ids[:train_end],
            "val": pair_ids[train_end:val_end],
            "test": pair_ids[val_end:],
        }

    def iter_pairs(self, limit: int | None = None) -> Iterable[MSEmbPair]:
        pairs = self.pairs()
        yield from pairs if limit is None else pairs[:limit]

    def _is_valid_pair(self, source_path: Path, target_path: Path) -> bool:
        source_size = self._image_size(source_path)
        target_size = self._image_size(target_path)
        return source_size is not None and source_size == target_size

    def _image_ids(self, directory: Path, prefix: str) -> dict[str, Path]:
        if not directory.exists():
            return {}
        result: dict[str, Path] = {}
        for path in directory.glob(f"{prefix}*.png"):
            pair_id = path.stem.removeprefix(prefix)
            if pair_id.isdigit():
                result[pair_id] = path
        return result

    def _image_size(self, path: Path) -> tuple[int, int] | None:
        try:
            with Image.open(path) as image:
                return image.size
        except (OSError, UnidentifiedImageError):
            return None

    def _load_rgb(self, path: Path) -> np.ndarray:
        with Image.open(path) as image:
            return np.asarray(image.convert("RGB"))
