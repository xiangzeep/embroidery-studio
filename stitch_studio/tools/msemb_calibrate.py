from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw

from stitch_studio.calibration.msemb_dataset import MSEmbDataset
from stitch_studio.calibration.msemb_metrics import measure_msemb_fidelity
from stitch_studio.calibration.pipeline_runner import MSEmbPipelineRunner


DEFAULT_DATASET_ROOT = Path(
    "/Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned"
)


def run_calibration(
    dataset_root: str | Path,
    output_dir: str | Path,
    limit: int = 128,
    seed: int = 20260727,
    pipeline_runner=None,
    generation_modes: tuple[str, ...] = ("photo_stitch", "cross_stitch"),
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

    pipeline_runner = pipeline_runner or MSEmbPipelineRunner()
    profile_scores: dict[str, list[dict[str, float]]] = {"identity_preview": []}
    profile_diagnostics: dict[str, list[dict]] = {}
    for mode in generation_modes:
        profile_scores[f"product_{mode}"] = []
        profile_diagnostics[f"product_{mode}"] = []
    montage_rows = []
    failures: list[tuple[str, float]] = []
    pipeline_failures = []
    for pair in pairs:
        source, target = dataset.load_pair(pair)
        scores = measure_msemb_fidelity(source, target).as_dict()
        profile_scores["identity_preview"].append(scores)
        montage_row = {"pair_id": pair.pair_id, "source": source, "target": target}
        for mode in generation_modes:
            profile_name = f"product_{mode}"
            try:
                evaluation = pipeline_runner.evaluate(source, target, mode)
            except Exception as exc:
                pipeline_failures.append(
                    {
                        "pair_id": pair.pair_id,
                        "generation_mode": mode,
                        "error": str(exc),
                    }
                )
                continue
            profile_scores[profile_name].append(evaluation["scores"])
            profile_diagnostics[profile_name].append(evaluation)
            montage_row[profile_name] = evaluation["preview"]
        montage_rows.append(montage_row)
        failures.append((pair.pair_id, scores["overall"]))

    profiles = {}
    for name, scores in profile_scores.items():
        profile = {
            "average": _average_dict(scores),
            "samples": len(scores),
        }
        diagnostics = profile_diagnostics.get(name)
        if diagnostics is not None:
            profile["diagnostics"] = _average_diagnostics(diagnostics)
        profiles[name] = profile
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
        "pipeline_failures": pipeline_failures,
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


def _average_diagnostics(items: Iterable[dict]) -> dict[str, float]:
    rows = list(items)
    if not rows:
        return {}
    result = {
        f"average_{key}": float(np.mean([row[key] for row in rows]))
        for key in (
            "layer_count",
            "region_count",
            "semantic_part_count",
            "stitch_count",
            "jump_count",
        )
    }
    timing_keys = sorted(
        {
            key
            for row in rows
            for key in row.get("timings", {})
        }
    )
    result.update(
        {
            f"average_{key}": float(
                np.mean([row.get("timings", {}).get(key, 0.0) for row in rows])
            )
            for key in timing_keys
        }
    )
    return result


def _write_montage(rows: list[dict], output_path: Path, thumb_size: int = 96) -> None:
    if not rows:
        return
    profile_names = sorted(
        key
        for row in rows
        for key in row
        if key.startswith("product_")
    )
    profile_names = list(dict.fromkeys(profile_names))
    columns = ("source", "target", *profile_names)
    width = thumb_size * len(columns)
    height = thumb_size * len(rows)
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    for row_index, row in enumerate(rows):
        y = row_index * thumb_size
        for column_index, key in enumerate(columns):
            if key not in row:
                continue
            image = Image.fromarray(row[key]).resize((thumb_size, thumb_size))
            canvas.paste(image, (column_index * thumb_size, y))
        draw.text((4, y + 4), row["pair_id"], fill=(255, 0, 0))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)


if __name__ == "__main__":
    raise SystemExit(main())
