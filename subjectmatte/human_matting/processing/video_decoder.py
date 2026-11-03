"""Streaming video decoder: one frame at a time, never the whole clip in memory."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional, Union

import cv2
import numpy as np


@dataclass(frozen=True)
class VideoInfo:
    path: str
    width: int
    height: int
    fps: float
    #: Container-reported frame count; None when the container does not report one (it can be approximate).
    frame_count: Optional[int]
    #: frame_count / fps, or None when frame_count is unknown.
    duration_sec: Optional[float]


class VideoDecoder:
    """Context manager around ``cv2.VideoCapture``. ``frames()`` yields BGR uint8 HxWx3 arrays in order.

    OpenCV applies container rotation metadata, so the yielded frame shape is authoritative; the
    width/height in ``info`` come from the stream properties and should agree with it.
    """

    def __init__(self, path: Union[str, "Path"]) -> None:
        self._path = str(path)
        self._cap: Optional[cv2.VideoCapture] = None
        self.info: Optional[VideoInfo] = None

    def __enter__(self) -> "VideoDecoder":
        if not Path(self._path).is_file():
            raise FileNotFoundError(f"input video not found: {self._path}")
        cap = cv2.VideoCapture(self._path)
        if not cap.isOpened():
            raise RuntimeError(f"cannot open video: {self._path}")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not fps > 0:
            cap.release()
            raise RuntimeError(f"video reports no frame rate: {self._path}")
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        self._cap = cap
        self.info = VideoInfo(
            path=self._path,
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            fps=fps,
            frame_count=count if count > 0 else None,
            duration_sec=(count / fps) if count > 0 else None,
        )
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def frames(self, max_frames: Optional[int] = None) -> Iterator[np.ndarray]:
        """Yield up to ``max_frames`` frames (all frames if None), one at a time."""
        if self._cap is None:
            raise RuntimeError("VideoDecoder must be used as a context manager")
        produced = 0
        while max_frames is None or produced < max_frames:
            ok, frame = self._cap.read()
            if not ok:
                return
            produced += 1
            yield frame
