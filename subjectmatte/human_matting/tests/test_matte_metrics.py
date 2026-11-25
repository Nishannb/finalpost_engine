"""Synthetic tests for matte_metrics (plan P1). numpy only."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from human_matting.processing.matte_metrics import (  # noqa: E402
    core_hole_fraction,
    edge_flicker,
    evaluate_matte,
    face_alpha,
)

H, W = 160, 200
SKIN = np.array([200, 150, 120], np.uint8)


def _disc(r=40, soft=4, cx=W / 2):
    yy, xx = np.mgrid[:H, :W]
    d = np.hypot(yy - H / 2, xx - cx)
    return np.clip((r + soft - d) / soft, 0, 1).astype(np.float32)


def _rgb(edge_color=None, alpha=None):
    rgb = np.tile(SKIN, (H, W, 1)).astype(np.uint8)
    if edge_color is not None:
        band = (alpha > 0) & (alpha < 1)
        rgb[band] = edge_color
    return rgb


def test_clean_disc_passes():
    a = _disc()
    rep = evaluate_matte([_rgb()] * 3, [a] * 3, face_box=(0.4, 0.4, 0.2, 0.2))
    assert rep.passed, rep.failures
    assert rep.metrics["core_hole_fraction"] == 0.0


def test_dark_fringe_fails():
    a = _disc()
    rep = evaluate_matte([_rgb((5, 5, 5), a)], [a])
    assert not rep.passed
    assert any(f.startswith("fringe_luma_p5") for f in rep.failures)


def test_bright_halo_fails():
    a = _disc()
    rep = evaluate_matte([_rgb((255, 255, 255), a)], [a])
    assert any(f.startswith("halo_excess") for f in rep.failures)


def test_enclosed_hole_detected_but_edge_gap_is_not():
    a = _disc(r=50, soft=2)
    holed = a.copy()
    holed[70:90, 90:110] = 0.0  # a hole fully inside the person
    assert core_hole_fraction(holed) > 0.01
    assert core_hole_fraction(a) == 0.0
    notch = a.copy()
    notch[:, :] = a
    notch[H // 2 - 5 : H // 2 + 5, 0 : W // 2] = 0.0  # a cut open to the border/outside is not an enclosed hole
    assert core_hole_fraction(notch) < 0.001


def test_flicker_measured_on_moving_edge():
    steady = [_disc()] * 4
    shimmer = [_disc(cx=W / 2 + (3 if i % 2 else -3)) for i in range(4)]
    assert edge_flicker(steady) == 0.0
    assert edge_flicker(shimmer) > 0.06
    rep = evaluate_matte([_rgb()] * 4, shimmer)
    assert any(f.startswith("edge_flicker") for f in rep.failures)


def test_face_must_stay_solid():
    a = _disc()
    a[60:100, 80:120] = 0.5
    assert face_alpha(a, (0.4, 0.37, 0.2, 0.25)) < 0.98
    rep = evaluate_matte([_rgb()], [a], face_box=(0.4, 0.37, 0.2, 0.25))
    assert any(f.startswith("face_alpha_min") for f in rep.failures)


def test_empty_or_full_frame_rejected_like_the_server_gate():
    empty = np.zeros((H, W), np.float32)
    full = np.ones((H, W), np.float32)
    assert not evaluate_matte([_rgb()] * 3, [empty] * 3).passed
    assert any(f.startswith("mean_area") for f in evaluate_matte([_rgb()] * 3, [full] * 3).failures)


def test_length_mismatch_raises():
    try:
        evaluate_matte([_rgb()], [_disc(), _disc()])
    except ValueError:
        return
    raise AssertionError("expected ValueError")
