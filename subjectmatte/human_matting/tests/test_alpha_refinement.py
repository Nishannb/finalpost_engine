"""Synthetic tests for alpha_refinement: edge fringe + false-foreground pockets."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from human_matting.processing.alpha_refinement import refine, to_rgba_uint8  # noqa: E402

H, W = 160, 200
SKIN = np.array([200, 150, 120], np.uint8)
BG = np.array([90, 60, 40], np.uint8)  # brownish room


def _disc_alpha(r_solid=40, soft=4):
    yy, xx = np.mgrid[:H, :W]
    d = np.hypot(yy - H / 2, xx - W / 2)
    return np.clip((r_solid + soft - d) / soft, 0, 1).astype(np.float32), d


def test_dark_fringe_removed_over_white():
    a, d = _disc_alpha()
    fgr = np.tile(SKIN, (H, W, 1)).astype(np.uint8)
    edge = (a > 0) & (a < 1)
    fgr[edge] = (10, 10, 10)  # contaminated dark fringe
    f, a2 = refine(fgr, a)
    comp = f.astype(np.float32) * a2[..., None] + 255.0 * (1 - a2[..., None])
    lum = comp.mean(axis=2)
    band = (d > 38) & (d < 46)
    # before: fringe composites very dark
    raw = fgr.astype(np.float32) * a[..., None] + 255.0 * (1 - a[..., None])
    assert raw.mean(axis=2)[band].min() < 100
    assert lum[band].min() > 120  # no thick dark rim remains
    assert np.all(a2[d < 28] == 1.0)  # solid core untouched
    assert np.all(a2[d > 52] == 0.0)


def test_pocket_path_keeps_cores():
    """Pocket clear must never eat arm/torso cores even when a bay is present."""
    a = np.zeros((H, W), np.float32)
    a[20:140, 40:70] = 1.0  # arm
    a[20:140, 95:160] = 1.0  # torso
    a[20:55, 70:95] = 1.0  # shoulder bridge
    a[55:130, 70:95] = 1.0  # sealed bay (false fg)
    src = np.tile(BG, (H, W, 1)).astype(np.uint8)
    src[20:140, 40:70] = SKIN
    src[20:140, 95:160] = SKIN
    src[20:55, 70:95] = SKIN
    src[55:130, 70:95] = BG
    _, a2 = refine(src.copy(), a, source_rgb=src, white_stroke_px=0)
    assert np.all(a2[30:50, 45:65] == 1.0)
    assert np.all(a2[30:50, 110:150] == 1.0)


def test_small_speck_survives():
    a = np.zeros((H, W), np.float32)
    a[20:140, 40:160] = 1.0
    src = np.tile(BG, (H, W, 1)).astype(np.uint8)
    src[20:140, 40:160] = SKIN
    src[60:63, 80:83] = BG  # tiny freckle-sized speck inside torso
    _, a2 = refine(src.copy(), a, source_rgb=src)
    assert a2[60:63, 80:83].min() == 1.0


def test_hair_strand_not_nuked():
    a = np.zeros((H, W), np.float32)
    a[20:140, 60:140] = 1.0
    a[80, 20:60] = 0.5  # 1px soft strand
    src = np.tile(BG, (H, W, 1)).astype(np.uint8)
    src[20:140, 60:140] = SKIN
    f, a2 = refine(src.copy(), a, source_rgb=src)
    assert a2[80, 25:55].mean() > 0.04  # survives edge shaping, still soft
    assert a2[80, 25:55].max() < 1.0


def test_shapes_and_pack():
    a = np.ones((H, W), np.float32)
    f, a2 = refine(np.zeros((H, W, 3), np.uint8), a, white_stroke_px=0)
    assert f.dtype == np.uint8 and a2.shape == (H, W)
    assert to_rgba_uint8(f, a2).shape == (H, W, 4)


def test_small_interior_hole_filled():
    a = np.zeros((H, W), np.float32)
    a[20:140, 40:160] = 1.0
    a[70:85, 90:105] = 0.0  # enclosed hole inside the body
    fgr = np.tile(SKIN, (H, W, 1)).astype(np.uint8)
    f, a2 = refine(fgr, a, white_stroke_px=0)
    assert float(a2[72:83, 92:103].mean()) > 0.85


def test_white_stroke_expands_silhouette():
    a, d = _disc_alpha(r_solid=35, soft=2)
    fgr = np.tile(SKIN, (H, W, 1)).astype(np.uint8)
    _, a0 = refine(fgr, a, white_stroke_px=0)
    _, a1 = refine(fgr, a, white_stroke_px=4)
    assert float((a1 > 0.05).sum()) > float((a0 > 0.05).sum())
    # stroke ring just outside the solid core should be near-white in the packed RGB
    f1, _ = refine(fgr, a, white_stroke_px=4)
    ring = (d > 36) & (d < 40) & (a1 > 0.2)
    assert ring.any() and float(f1[ring].mean()) > 200
