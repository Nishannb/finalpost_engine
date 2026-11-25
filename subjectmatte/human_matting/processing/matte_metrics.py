"""Cutout quality bar (plan P1): numeric metrics + thresholds that define "clean enough" for a talking-head alpha.

Pure numpy, no model, no I/O: usable on RVM output frames, a provided cutout, or a chroma key. Frames are float alpha 0..1 (H, W) and uint8 RGB (H, W, 3).

Metrics
  fringe_luma_p5      lowest per-frame 5th percentile luminance (0..255) of the soft edge band composited over WHITE. A dark rim (background-contaminated colour) pulls it down.
  halo_excess         mean luminance of the soft-edge band's own colour minus the mean luminance of the solid core (alpha >= 0.98). A bright halo / white outline is a large positive value.
  edge_flicker        mean |alpha(t) - alpha(t-1)| inside the edge band (union of both frames). Temporal shimmer of the silhouette.
  core_hole_fraction  share of the person's filled area that is transparent (alpha < 0.5) yet enclosed by the person (true holes: sealed gaps are separate, see note).
  face_alpha_min      the lowest mean alpha over the face box across frames (a face must stay solid).
  area_ratio / detected_ratio  mirror personMatte.matteQualityGate so one verdict covers both.

Note: arm-torso gaps that RVM paints opaque are NOT holes in the alpha (they are solid); they are judged by eye / fixture frames. This module measures what a number can.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np

EDGE_LO = 0.02
EDGE_HI = 0.98

# The bar. Tuned conservative; revisit with real fixture clips (docs/RVM_SUBJECT_STAGE_PLAN.md, P1).
THRESHOLDS = {
    "fringe_luma_p5_min": 150.0,  # over white: edge pixels must not be dark sludge (before the fix the p5 was ~142, after ~200)
    "halo_excess_max": 60.0,  # edge colour brighter than the core by more than this reads as a white outline
    "edge_flicker_max": 0.06,
    "core_hole_fraction_max": 0.01,
    "face_alpha_min": 0.98,
    "detected_ratio_min": 0.7,
    "mean_area_min": 0.015,
    "mean_area_max": 0.8,
}


def _luma(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32)
    return 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]


def edge_band(alpha: np.ndarray) -> np.ndarray:
    return (alpha > EDGE_LO) & (alpha < EDGE_HI)


def _composite_luma(rgb: np.ndarray, alpha: np.ndarray, bg: float) -> np.ndarray:
    a = alpha.astype(np.float32)
    return _luma(rgb) * a + bg * (1.0 - a)


def fringe_luma_over_white(rgb: np.ndarray, alpha: np.ndarray) -> float | None:
    """Per-frame 5th percentile luminance of the edge band composited over white. None when the frame has no edge band."""
    band = edge_band(alpha)
    if not band.any():
        return None
    return float(np.percentile(_composite_luma(rgb, alpha, 255.0)[band], 5))


def halo_excess(rgb: np.ndarray, alpha: np.ndarray) -> float | None:
    """Per-frame: mean luma of the edge band's colour minus mean luma of the solid core. None without both."""
    band = edge_band(alpha)
    core = alpha >= 0.98
    if not band.any() or not core.any():
        return None
    luma = _luma(rgb)
    return float(luma[band].mean() - luma[core].mean())


def edge_flicker(alphas: Sequence[np.ndarray]) -> float | None:
    if len(alphas) < 2:
        return None
    diffs = []
    for prev, cur in zip(alphas[:-1], alphas[1:]):
        band = edge_band(prev) | edge_band(cur)
        if band.any():
            diffs.append(float(np.abs(cur[band] - prev[band]).mean()))
    return float(np.mean(diffs)) if diffs else None


def _enclosed_transparent(solid: np.ndarray) -> np.ndarray:
    """Transparent pixels NOT reachable from the frame border through transparent pixels (i.e. holes inside / between solid regions). Iterative flood fill, numpy only."""
    empty = ~solid
    reach = np.zeros_like(empty)
    reach[0, :] = empty[0, :]
    reach[-1, :] = empty[-1, :]
    reach[:, 0] |= empty[:, 0]
    reach[:, -1] |= empty[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]
        grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= empty
        if (grown == reach).all():
            break
        reach = grown
    return empty & ~reach


def core_hole_fraction(alpha: np.ndarray) -> float | None:
    solid = alpha >= 0.5
    area = int(solid.sum())
    if area == 0:
        return None
    holes = int(_enclosed_transparent(solid).sum())
    return holes / float(area + holes)


def face_alpha(alpha: np.ndarray, box: tuple[float, float, float, float]) -> float:
    """Mean alpha inside a face box given as (x, y, w, h) fractions of the frame."""
    h, w = alpha.shape
    x0, y0 = int(max(0.0, box[0]) * w), int(max(0.0, box[1]) * h)
    x1, y1 = int(min(1.0, box[0] + box[2]) * w), int(min(1.0, box[1] + box[3]) * h)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return float(alpha[y0:y1, x0:x1].mean())


@dataclass
class MatteQualityReport:
    metrics: dict[str, float | None] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.failures


def evaluate_matte(
    rgb_frames: Iterable[np.ndarray],
    alpha_frames: Iterable[np.ndarray],
    face_box: tuple[float, float, float, float] | None = None,
    thresholds: dict[str, float] | None = None,
) -> MatteQualityReport:
    """Score a clip's frames against THRESHOLDS. `face_box` (x, y, w, h fractions) enables the face check. Missing measurements (no edge band, one frame) are not failures: they are reported as None."""
    th = {**THRESHOLDS, **(thresholds or {})}
    rgbs = list(rgb_frames)
    alphas = [a.astype(np.float32) for a in alpha_frames]
    if len(rgbs) != len(alphas) or not alphas:
        raise ValueError("rgb_frames and alpha_frames must be the same non-zero length")
    present = [float((a >= 0.5).mean()) for a in alphas]
    detected = float(np.mean([p >= 0.005 for p in present]))
    mean_area = float(np.mean(present))

    white = [v for v in (fringe_luma_over_white(r, a) for r, a in zip(rgbs, alphas)) if v is not None]
    halos = [v for v in (halo_excess(r, a) for r, a in zip(rgbs, alphas)) if v is not None]
    holes = [v for v in (core_hole_fraction(a) for a in alphas) if v is not None]
    metrics: dict[str, float | None] = {
        "fringe_luma_p5": float(np.min(white)) if white else None,
        "halo_excess": float(np.max(halos)) if halos else None,
        "edge_flicker": edge_flicker(alphas),
        "core_hole_fraction": float(np.max(holes)) if holes else None,
        "face_alpha_min": min(face_alpha(a, face_box) for a in alphas) if face_box else None,
        "detected_ratio": detected,
        "mean_area": mean_area,
    }
    failures: list[str] = []

    def below(name: str, key: str) -> None:
        v = metrics[name]
        if v is not None and v < th[key]:
            failures.append(f"{name}={v:.3f}<{th[key]}")

    def above(name: str, key: str) -> None:
        v = metrics[name]
        if v is not None and v > th[key]:
            failures.append(f"{name}={v:.3f}>{th[key]}")

    below("fringe_luma_p5", "fringe_luma_p5_min")
    above("halo_excess", "halo_excess_max")
    above("edge_flicker", "edge_flicker_max")
    above("core_hole_fraction", "core_hole_fraction_max")
    below("face_alpha_min", "face_alpha_min")
    below("detected_ratio", "detected_ratio_min")
    below("mean_area", "mean_area_min")
    above("mean_area", "mean_area_max")
    return MatteQualityReport(metrics=metrics, failures=failures)
