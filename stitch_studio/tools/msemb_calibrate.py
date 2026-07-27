from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw

from stitch_studio.calibration.msemb_dataset import MSEmbDataset
from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity


DEFAULT_DATASET_ROOT = Path(
    "/Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned"
)


def run_calibration(
    dataset_root: str | Path,
    output_dir: str | Path,
    limit: int = 128,
    seed: int = 20260727,
) -> dict:
    dataset = MSEmbDataset(dataset_root)
    audit = dataset.audit()
    pairs = dataset.pairs()
    if limit > 0 and len(pairs) > limit:
        rng = np.random.default_rng(seed)
        indices = sorted(rng.choice(len(pairs), size=limit, replace=False).tolist())
        pairs = [pairs[index] for index in indices]

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    profile_scores: dict[str, list[dict[str, float]]] = {"identity_preview": []}
    montage_rows = []
    failures: list[tuple[str, float]] = []
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
            "source_count": audit.source_count,
            "target_count": audit.target_count,
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


def _average_dict(items: Iterable[dict[str, float]]) -> dict[str, float]:
    rows = list(items)
    if not rows:
        return {}
    return {
        key: float(np.mean([row[key] for row in rows]))
        for key in rows[0]
    }


def _write_montage(rows: list[dict], output_path: Path, thumb_size: int = 96) -> None:
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


if __name__ == "__main__":
    raise SystemExit(main())
