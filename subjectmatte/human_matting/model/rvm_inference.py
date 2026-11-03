"""Sequential, recurrent-state inference around the official RVM ``MattingNetwork``.

This wrapper never reimplements the network or its recurrent forward. Per frame it does exactly what the
official ``inference.py`` does:

    src = frame as RGB float32 in [0, 1], NCHW (here N=1 batch, T=1 time step: [1, 1, 3, H, W]); no ImageNet mean/std
    fgr, pha, *rec = model(src, *rec, downsample_ratio)

and carries the four recurrent tensors ``rec`` between calls. Frames are never stretched or cropped to a
square; ``downsample_ratio`` handles scale inside the official model.
"""
from __future__ import annotations

import time
from typing import List, Optional, Tuple

import numpy as np
import torch


def auto_downsample_ratio(h: int, w: int) -> float:
    """The official default (inference.py ``auto_downsample_ratio``): largest side becomes 512 px, never upscaled."""
    return min(512 / max(h, w), 1)


class RvmSession:
    """One video's worth of recurrent state on top of a loaded official model.

    Usage: ``session = RvmSession(get_model(...))``; ``session.reset()`` at the start of every video;
    then ``session.infer_frame(rgb_uint8_hwc)`` once per frame, in order.
    """

    def __init__(self, model: torch.nn.Module, downsample_ratio: Optional[float] = None) -> None:
        if downsample_ratio is not None and not (0 < downsample_ratio <= 1):
            raise ValueError("downsample_ratio must be in (0, 1]")
        self._model = model.eval()
        self._device = next(model.parameters()).device
        self._dtype = torch.float32
        self._configured_ratio = downsample_ratio
        self._rec: List[Optional[torch.Tensor]] = [None] * 4
        self._ratio: Optional[float] = None
        self._frame_hw: Optional[Tuple[int, int]] = None
        self.frames_since_reset = 0
        self.frames_total = 0
        self.last_output_device: Optional[torch.device] = None
        self.last_frame_ms: Optional[float] = None

    # --- state -----------------------------------------------------------------------------------------
    @property
    def device(self) -> torch.device:
        """The device the model parameters live on (where inference actually runs)."""
        return self._device

    @property
    def downsample_ratio(self) -> Optional[float]:
        """The ratio in use for the current video (None before the first frame after reset)."""
        return self._ratio

    @property
    def recurrent_state(self) -> Tuple[Optional[torch.Tensor], ...]:
        return tuple(self._rec)

    @property
    def has_state(self) -> bool:
        return any(r is not None for r in self._rec)

    def reset(self) -> None:
        """Clear recurrent state and the per-video geometry. Call at the start of every video."""
        self._rec = [None] * 4
        self._ratio = None
        self._frame_hw = None
        self.frames_since_reset = 0

    # --- inference -------------------------------------------------------------------------------------
    def infer_frame(self, rgb_uint8_hwc: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Matte one frame. Returns (foreground uint8 HxWx3, alpha float32 HxW in 0..1).

        Foreground is RVM's own decontaminated ``fgr``; alpha is its ``pha``. Both are at the input size.
        """
        frame = rgb_uint8_hwc
        if not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
            raise ValueError("infer_frame expects a uint8 RGB array of shape (H, W, 3)")
        h, w = frame.shape[:2]
        if self._frame_hw is None:
            self._frame_hw = (h, w)
            self._ratio = self._configured_ratio if self._configured_ratio is not None else auto_downsample_ratio(h, w)
        elif self._frame_hw != (h, w):
            raise ValueError(
                f"frame size changed mid-video ({self._frame_hw} -> {(h, w)}); call reset() for a new video"
            )

        started = time.perf_counter()
        with torch.no_grad():
            src = torch.from_numpy(np.ascontiguousarray(frame)).to(self._device)
            src = src.permute(2, 0, 1).to(self._dtype).div_(255.0).unsqueeze(0).unsqueeze(0)  # [B=1, T=1, 3, H, W]
            fgr, pha, *rec = self._model(src, *self._rec, self._ratio)
            self._rec = list(rec)
            self.last_output_device = pha.device
            fgr_u8 = (fgr[0, 0].clamp(0.0, 1.0) * 255.0).round().to(torch.uint8).permute(1, 2, 0).contiguous().cpu().numpy()
            alpha = pha[0, 0, 0].to(torch.float32).cpu().numpy()  # .cpu() synchronises the device before timing stops
        self.last_frame_ms = (time.perf_counter() - started) * 1000.0
        self.frames_since_reset += 1
        self.frames_total += 1
        return fgr_u8, alpha
