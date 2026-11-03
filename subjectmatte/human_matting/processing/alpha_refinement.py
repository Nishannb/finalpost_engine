"""Targeted cleanup of RVM output, and packing into straight (non-premultiplied) RGBA.

RVM's soft matte has product-level defects that a pure clamp cannot fix:

1. **Edge fringe** — semi-transparent edge pixels carry dark contaminated ``fgr``. We decontaminate colour from
   bright solid interior samples, then gently contract the soft band (no hard silhouette erode — that flickered).
2. **False-foreground pockets** — arm–torso chair gaps painted opaque. Cleared only outside the eroded person
   core, in defect / warm-brown near-person corridors.
3. **Interior speckles** — small enclosed transparent holes inside the silhouette (hair notches, body marks) are
   filled back so the cutout does not show the behind-layer through the subject.
4. **Optional white stroke** — a soft outer ring for a clean sticker edge on busy behind-layers.
5. **Temporal EMA** — applied in ``matting_service`` across frames so pocket/edge decisions do not sparkle.

Packing: Remotion ``OffthreadVideo transparent`` wants straight alpha once ``fgr`` is decontaminated.
"""
from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np

# edge shaping (gentle — aggressive erode/contract caused border flicker)
ALPHA_FLOOR = 0.10
ALPHA_CEIL = 0.90
CONTRACT_WEIGHT = 0.50
SOLID_ALPHA = 0.97
EXTEND_SIGMA = 4.0
EXTEND_MIN_WEIGHT = 0.03
SOFT_DARK_LUM = 110.0
# false-fg pockets
BG_ALPHA_MAX = 0.05
CORE_ALPHA_MIN = 0.95
MIN_SAMPLE_FRAC = 0.01
BG_DIST_MAX = 42.0
PERSON_ERODE = 15  # protect face/torso; keep small enough that arm–torso bays stay clearable
PERSON_EXCLUDE_BG = 22.0
PERSON_MARGIN = 5.0
PERSON_BIN_FRAC = 0.004
PERSON_PAL_MIN_LUM = 28.0
DEFECT_MIN_DEPTH = 12.0
DEFECT_LINE_THICK = 13
DEFECT_DILATE = 17
WARM_GROW_ITERS = 48
NEAR_PERSON_DIST = 48.0
MIN_POCKET_PX = 60
MAX_CLEAR_FRAC = 0.07
POCKET_PASSES = 1
# interior hole fill (hair speckles / body marks) — keep well below arm-gap size
MAX_INTERIOR_HOLE_PX = 1200
# soft white outer stroke (0 disables)
WHITE_STROKE_PX = 4.0


def _smoothstep(a: np.ndarray, lo: float, hi: float) -> np.ndarray:
    t = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _palette(px: np.ndarray, min_frac: float, max_bins: int) -> np.ndarray:
    q = px.astype(np.int32) >> 4
    keys = (q[:, 0] << 8) | (q[:, 1] << 4) | q[:, 2]
    uniq, inv, counts = np.unique(keys, return_inverse=True, return_counts=True)
    sums = np.zeros((len(uniq), 3), np.float64)
    np.add.at(sums, inv, px)
    order = np.argsort(-counts)[:max_bins]
    order = order[counts[order] >= min_frac * len(px)]
    return (sums[order] / counts[order, None]).astype(np.float32)


def _nearest_dist(img: np.ndarray, pal: np.ndarray) -> np.ndarray:
    d = np.full(img.shape[:2], np.inf, np.float32)
    for c in pal:
        d = np.minimum(d, np.linalg.norm(img - c, axis=2))
    return d


def _deep_defect_mask(alpha: np.ndarray, min_depth: float = DEFECT_MIN_DEPTH) -> np.ndarray:
    m = (alpha > 0.5).astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return np.zeros(alpha.shape, dtype=bool)
    cnt = max(contours, key=cv2.contourArea)
    if len(cnt) < 24:
        return np.zeros(alpha.shape, dtype=bool)
    hull = cv2.convexHull(cnt, returnPoints=False)
    if hull is None or len(hull) < 3:
        return np.zeros(alpha.shape, dtype=bool)
    try:
        defects = cv2.convexityDefects(cnt, hull)
    except cv2.error:
        return np.zeros(alpha.shape, dtype=bool)
    if defects is None:
        return np.zeros(alpha.shape, dtype=bool)
    mark = np.zeros(alpha.shape, np.uint8)
    for s, e, f, depth in defects.reshape(-1, 4):
        if float(depth) / 256.0 < min_depth:
            continue
        s, e, f = int(s), int(e), int(f)
        if min(s, e, f) < 0 or max(s, e, f) >= len(cnt):
            continue
        tri = np.array([cnt[s][0], cnt[e][0], cnt[f][0]], dtype=np.int32)
        cv2.fillConvexPoly(mark, tri, 1)
        p0 = (int(cnt[s][0][0]), int(cnt[s][0][1]))
        p1 = (int(cnt[e][0][0]), int(cnt[e][0][1]))
        p2 = (int(cnt[f][0][0]), int(cnt[f][0][1]))
        cv2.line(mark, p0, p2, 1, thickness=DEFECT_LINE_THICK)
        cv2.line(mark, p1, p2, 1, thickness=DEFECT_LINE_THICK)
    if DEFECT_DILATE > 1:
        ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DEFECT_DILATE, DEFECT_DILATE))
        mark = cv2.dilate(mark, ker)
    return mark.astype(bool)


def open_false_foreground(alpha: np.ndarray, source_rgb: np.ndarray) -> np.ndarray:
    """Clear false-foreground in silhouette concavities (never inside the eroded person core)."""
    h, w = alpha.shape
    n = h * w
    src = cv2.GaussianBlur(source_rgb.astype(np.float32), (0, 0), 1.0)
    sure_bg = alpha < BG_ALPHA_MAX
    core_m = alpha > CORE_ALPHA_MIN
    if sure_bg.sum() < MIN_SAMPLE_FRAC * n or core_m.sum() < MIN_SAMPLE_FRAC * n:
        return alpha

    bg_pal = _palette(src[sure_bg], 0.004, max_bins=24)
    if len(bg_pal) == 0:
        return alpha
    d_bg = _nearest_dist(src, bg_pal)

    core_u8 = core_m.astype(np.uint8)
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (PERSON_ERODE, PERSON_ERODE))
    eroded = cv2.erode(core_u8, ker)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(eroded, connectivity=8)
    if nlab <= 1:
        return alpha
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    protected = labels == main
    person_m = protected & (d_bg > PERSON_EXCLUDE_BG)
    if person_m.sum() < MIN_SAMPLE_FRAC * n:
        person_m = protected
    if person_m.sum() < MIN_SAMPLE_FRAC * n:
        return alpha
    person_pal = _palette(src[person_m], PERSON_BIN_FRAC, max_bins=32)
    if len(person_pal) == 0:
        return alpha
    person_pal = person_pal[person_pal.mean(axis=1) >= PERSON_PAL_MIN_LUM]
    if len(person_pal) == 0:
        return alpha
    d_person = _nearest_dist(src, person_pal)

    bg_prefer = (d_bg + PERSON_MARGIN < d_person) & (d_bg < BG_DIST_MAX)
    personish = (alpha > 0.5) & ~bg_prefer

    defect = _deep_defect_mask(alpha)
    seed = (defect & (alpha > 0.5) & bg_prefer & ~protected).astype(np.uint8)

    # Warm chair/wood only (high chroma) — avoids clearing dark desaturated hair.
    warm = (
        (source_rgb[:, :, 0].astype(np.int16) - source_rgb[:, :, 2].astype(np.int16) > 32)
        & (source_rgb[:, :, 1] < 110)
        & ((source_rgb.max(axis=2) - source_rgb.min(axis=2)) > 28)
    )
    dist_person = cv2.distanceTransform((~personish).astype(np.uint8), cv2.DIST_L2, 5)
    near_person_warm = (alpha > 0.5) & bg_prefer & warm & (dist_person < NEAR_PERSON_DIST) & ~protected
    seed = np.maximum(seed, near_person_warm.astype(np.uint8))

    warm_opaque = ((alpha > 0.5) & warm & bg_prefer & ~protected).astype(np.uint8)
    corridor = cv2.dilate(
        np.maximum(defect.astype(np.uint8), near_person_warm.astype(np.uint8)),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)),
    )
    grown = seed.copy()
    k3 = np.ones((3, 3), np.uint8)
    for _ in range(WARM_GROW_ITERS):
        dil = cv2.dilate(grown, k3)
        add = (dil > 0) & (grown == 0) & (warm_opaque > 0) & (corridor > 0)
        if not add.any():
            break
        grown[add] = 1

    personish_u8 = personish.astype(np.uint8) * 255
    flooded = personish_u8.copy()
    ff_mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flooded, ff_mask, (0, 0), 255)
    enclosed = (personish_u8 == 0) & (flooded == 0) & (alpha > 0.5) & bg_prefer & warm & ~protected

    cleared = grown.astype(bool) | enclosed
    if not cleared.any():
        return alpha
    labels_count, clabels, cstats, _ = cv2.connectedComponentsWithStats(cleared.astype(np.uint8), connectivity=8)
    keep = np.zeros(labels_count, bool)
    keep[1:] = cstats[1:, cv2.CC_STAT_AREA] >= MIN_POCKET_PX
    pocket = keep[clabels]
    if not pocket.any() or float(pocket.mean()) > MAX_CLEAR_FRAC:
        return alpha
    out = alpha.copy()
    out[pocket] = 0.0
    return out


def fill_small_interior_holes(
    alpha: np.ndarray,
    fgr: np.ndarray,
    max_area: int = MAX_INTERIOR_HOLE_PX,
) -> Tuple[np.ndarray, np.ndarray]:
    """Fill small enclosed transparent holes inside the silhouette (hair/body speckles)."""
    opaque = (alpha > 0.45).astype(np.uint8)
    bg = (1 - opaque) * 255
    flooded = bg.copy()
    ff = np.zeros((alpha.shape[0] + 2, alpha.shape[1] + 2), np.uint8)
    cv2.floodFill(flooded, ff, (0, 0), 128)
    holes = (bg == 255) & (flooded == 255)
    if not holes.any():
        return alpha, fgr
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=8)
    fill = np.zeros(alpha.shape, dtype=bool)
    for i in range(1, nlab):
        if int(stats[i, cv2.CC_STAT_AREA]) <= max_area:
            fill[lab == i] = True
    if not fill.any():
        return alpha, fgr
    out_a = alpha.copy()
    out_a[fill] = 1.0
    # Paint filled holes from neighbouring opaque colour
    solid = (alpha > 0.7).astype(np.uint8)
    if solid.any():
        col, den = _extend_colour(fgr, solid.astype(bool))
        out_f = fgr.astype(np.float32)
        reach = den > EXTEND_MIN_WEIGHT
        out_f[fill & reach] = col[fill & reach]
        if (fill & ~reach).any():
            out_f[fill & ~reach] = fgr[solid.astype(bool)].mean(axis=0)
        fgr = np.clip(out_f + 0.5, 0, 255).astype(np.uint8)
    return out_a, fgr


def apply_white_stroke(
    fgr: np.ndarray,
    alpha: np.ndarray,
    width: float = WHITE_STROKE_PX,
) -> Tuple[np.ndarray, np.ndarray]:
    """Soft white outer stroke around the opaque silhouette (hides residual dark fringe)."""
    if width <= 0.5:
        return fgr, alpha
    solid = (alpha >= 0.5).astype(np.uint8)
    if solid.sum() < 64:
        return fgr, alpha
    rad = max(1, int(round(width)))
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rad * 2 + 1, rad * 2 + 1))
    dil = cv2.dilate(solid, ker)
    ring = (dil > 0) & (solid == 0)
    if not ring.any():
        return fgr, alpha
    outside = (1 - solid).astype(np.uint8)
    dist = cv2.distanceTransform(outside, cv2.DIST_L2, 5)
    stroke_a = np.clip(1.0 - (dist / max(width, 1e-3)), 0.0, 1.0).astype(np.float32)
    stroke_a = np.where(ring, np.maximum(stroke_a, 0.85), 0.0)
    stroke_a = cv2.GaussianBlur(stroke_a, (0, 0), 0.75)
    stroke_a = np.where(ring, np.clip(stroke_a, 0.0, 1.0), 0.0)
    out_a = np.maximum(alpha, stroke_a)
    out_f = fgr.astype(np.float32)
    out_f[ring] = 255.0
    # Lift dark fringe just inside the silhouette toward white so the join is clean
    inner = cv2.erode(solid, np.ones((3, 3), np.uint8))
    crust = (solid > 0) & (inner == 0) & (out_f.mean(axis=2) < 100.0)
    if crust.any():
        out_f[crust] = 0.35 * out_f[crust] + 0.65 * 255.0
    return np.clip(out_f + 0.5, 0, 255).astype(np.uint8), out_a.astype(np.float32)


def _extend_colour(fgr: np.ndarray, solid: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    lum = fgr.astype(np.float32).mean(axis=2)
    m = solid.astype(np.float32) * (0.3 + 0.7 * np.clip(lum / 180.0, 0.0, 1.0))
    num = cv2.GaussianBlur(fgr.astype(np.float32) * m[:, :, None], (0, 0), EXTEND_SIGMA)
    den = cv2.GaussianBlur(m, (0, 0), EXTEND_SIGMA)
    col = num / np.maximum(den, 1e-6)[:, :, None]
    return col, den


def refine(
    fgr: np.ndarray,
    alpha: np.ndarray,
    source_rgb: Optional[np.ndarray] = None,
    white_stroke_px: float = WHITE_STROKE_PX,
) -> Tuple[np.ndarray, np.ndarray]:
    """Return (foreground uint8 HxWx3, alpha float32 HxW in [0, 1])."""
    if fgr.ndim != 3 or fgr.shape[2] != 3:
        raise ValueError(f"foreground must be HxWx3, got {fgr.shape}")
    if alpha.ndim != 2 or alpha.shape != fgr.shape[:2]:
        raise ValueError(f"alpha must be HxW matching the foreground, got {alpha.shape} vs {fgr.shape}")
    if source_rgb is not None and source_rgb.shape != fgr.shape:
        raise ValueError(f"source_rgb must match the foreground shape, got {source_rgb.shape} vs {fgr.shape}")
    a = np.clip(np.nan_to_num(alpha.astype(np.float32, copy=False), nan=0.0, posinf=1.0, neginf=0.0), 0.0, 1.0)
    if fgr.dtype == np.uint8:
        f = np.ascontiguousarray(fgr)
    else:
        f = np.clip(np.nan_to_num(fgr, nan=0.0), 0, 255).astype(np.uint8)

    if source_rgb is not None:
        for _ in range(POCKET_PASSES):
            a = open_false_foreground(a, source_rgb)

    # Close hair/body speckles punched by RVM or pocket clear
    a, f = fill_small_interior_holes(a, f)

    solid = a >= SOLID_ALPHA
    if solid.sum() > 64:
        solid_eroded = cv2.erode(solid.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        if solid_eroded.any():
            solid = solid_eroded
    out = f.astype(np.float32)
    if solid.any():
        col, den = _extend_colour(f, solid)
        reach = den > EXTEND_MIN_WEIGHT
        replace = (~solid) & reach & (a > 0.02)
        out[replace] = col[replace]
        mean_c = f[solid].mean(axis=0)
        soft_dark = (a > 0.02) & (~solid) & (out.mean(axis=2) < SOFT_DARK_LUM)
        out[soft_dark] = mean_c
        out[(a <= ALPHA_FLOOR) & ~reach] = 0.0
    else:
        out[a <= ALPHA_FLOOR] = 0.0
    f = np.clip(out + 0.5, 0, 255).astype(np.uint8)

    a = _smoothstep(a, ALPHA_FLOOR, ALPHA_CEIL).astype(np.float32)
    soft = (a > 0.0) & (a < 0.95)
    if soft.any():
        amin = cv2.erode(a, np.ones((3, 3), np.uint8))
        a = np.where(soft, (1.0 - CONTRACT_WEIGHT) * a + CONTRACT_WEIGHT * amin, a).astype(np.float32)

    # Light morphological close on the binary silhouette to kill 1px edge sparkle, then blend
    bin_u8 = (a >= 0.5).astype(np.uint8)
    closed = cv2.morphologyEx(bin_u8, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    added = (closed > 0) & (bin_u8 == 0)
    if added.any():
        a = np.where(added, np.maximum(a, 0.75), a).astype(np.float32)

    if white_stroke_px > 0:
        f, a = apply_white_stroke(f, a, width=white_stroke_px)
    return f, a


def temporal_blend(
    alpha: np.ndarray,
    fgr: np.ndarray,
    prev_alpha: Optional[np.ndarray],
    prev_fgr: Optional[np.ndarray],
    weight: float = 0.55,
) -> Tuple[np.ndarray, np.ndarray]:
    """EMA with the previous refined frame to kill border / pocket flicker."""
    if prev_alpha is None or prev_alpha.shape != alpha.shape or weight <= 0:
        return alpha, fgr
    w = float(np.clip(weight, 0.0, 0.85))
    out_a = ((1.0 - w) * alpha + w * prev_alpha).astype(np.float32)
    if prev_fgr is not None and prev_fgr.shape == fgr.shape:
        # Blend colour only where both frames are meaningfully opaque
        both = (alpha > 0.2) & (prev_alpha > 0.2)
        out_f = fgr.astype(np.float32)
        out_f[both] = (1.0 - w) * out_f[both] + w * prev_fgr.astype(np.float32)[both]
        fgr = np.clip(out_f + 0.5, 0, 255).astype(np.uint8)
    return out_a, fgr


def to_rgba_uint8(fgr_u8: np.ndarray, alpha01: np.ndarray) -> np.ndarray:
    """Pack foreground colour and matte into straight RGBA uint8 (HxWx4)."""
    h, w = alpha01.shape
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = fgr_u8
    rgba[:, :, 3] = np.rint(alpha01 * 255.0).astype(np.uint8)
    return rgba
