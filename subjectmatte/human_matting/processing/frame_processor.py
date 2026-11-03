"""Normalize one decoded frame into the input ``RvmSession.infer_frame`` expects: uint8 RGB, HxWx3.

Deliberately NO square cropping or padding, and no resizing unless the caller explicitly asks for a cap (``limit_max_side``):
the frame keeps its native size and aspect ratio. Model-internal scale is handled by ``downsample_ratio``.
"""
from __future__ import annotations

from typing import Optional

import cv2
import numpy as np


def limit_max_side(rgb: np.ndarray, max_side: Optional[int]) -> np.ndarray:
    """Downscale so the LONGEST side is at most ``max_side`` (aspect ratio kept, even dimensions); never upscales.

    ``None`` / 0 returns the frame untouched. Used to bound the cost of long clips; the cap applies to the processed
    and encoded frames, so the output WebM has the capped size (same aspect as the source).
    """
    if not max_side:
        return rgb
    h, w = rgb.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return rgb
    scale = max_side / float(longest)
    new_w = max(2, int(round(w * scale)) // 2 * 2)
    new_h = max(2, int(round(h * scale)) // 2 * 2)
    return cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)


def to_rgb_input(frame: np.ndarray, *, color_order: str = "bgr") -> np.ndarray:
    """Return a C-contiguous uint8 RGB HxWx3 array from a BGR (OpenCV default) or RGB frame.

    A 4-channel frame (BGRA / RGBA) has its alpha channel dropped; the camera frame carries no matte.
    """
    if color_order not in ("bgr", "rgb"):
        raise ValueError("color_order must be 'bgr' or 'rgb'")
    if not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3:
        raise ValueError("frame must be a uint8 ndarray of shape (H, W, 3|4)")
    channels = frame.shape[2]
    if channels == 4:
        frame = frame[:, :, :3]
    elif channels != 3:
        raise ValueError(f"unsupported channel count {channels}")
    if color_order == "bgr":
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return np.ascontiguousarray(frame)
