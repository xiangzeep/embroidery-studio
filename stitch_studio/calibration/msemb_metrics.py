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
    # Compare design structure rather than the high-frequency thread texture
    # introduced by a physically faithful embroidery renderer.
    sigma = float(np.clip(min(gray.shape[:2]) / 100.0, 0.7, 2.4))
    gray = cv2.GaussianBlur(gray, (0, 0), sigma)
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
    count, _, stats, _ = cv2.connectedComponentsWithStats(
        diff.astype(np.uint8),
        connectivity=8,
    )
    tiny_area = 0
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area <= 4:
            tiny_area += area
    return float(np.clip(tiny_area / max(1, generated.shape[0] * generated.shape[1]), 0.0, 1.0))
