"""Matting service: video in, silent transparent VP9 WebM (yuva420p) out.

    decode one frame -> RVM infer (recurrent state carried) -> clamp -> RGBA (RVM's fgr + pha) -> ffmpeg stdin -> discard

The model is loaded once per process (``get_model``); the recurrent state is reset exactly once, at the
start of the video. The encoded colour is RVM's own decontaminated foreground, NOT the original camera
frame recoloured with an alpha channel.
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

from ..model.rvm_inference import RvmSession
from ..model.rvm_loader import DEFAULT_WEIGHTS_PATH, get_model, resolve_device
from ..processing.alpha_refinement import refine, temporal_blend, to_rgba_uint8
from ..processing.frame_processor import limit_max_side, to_rgb_input
from ..processing.video_decoder import VideoDecoder
from ..processing.video_encoder import (
    QUALITY_PRESETS,
    TransparentWebmEncoder,
    ensure_vp9_alpha_encoder,
)

SUPPORTED_OUTPUT_FORMATS = ("transparent",)
AUDIO_POLICY = "none: the WebM has no audio track; audio stays on the source asset"
_SUBJECTMATTE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = _SUBJECTMATTE_ROOT / "out"

_sha_cache: Dict[Tuple[str, int, int], str] = {}


def weights_sha256(path: Union[str, "Path"]) -> str:
    p = Path(path).resolve()
    st = p.stat()
    key = (str(p), st.st_size, st.st_mtime_ns)
    if key not in _sha_cache:
        h = hashlib.sha256()
        with open(p, "rb") as fh:
            for block in iter(lambda: fh.read(1 << 20), b""):
                h.update(block)
        _sha_cache[key] = h.hexdigest()
    return _sha_cache[key]


RANGE_PAD_SEC = 0.05  # a frame at time t is matted when a - 0.05 <= t <= b + 0.05 (same semantics as the retired MediaPipe tool)
MODEL_NAME = "rvm_mobilenetv3"
_MIN_SUBJECT_PIXELS = 200  # a frame "detected" a person when more than this many pixels have alpha > 0.5 (same floor as the old tool)

Range = Tuple[float, float]


def parse_ranges(spec: Optional[str]) -> Optional[List[Range]]:
    """``"3.2-6.0,12-15.5"`` -> ``[(3.2, 6.0), (12.0, 15.5)]``. Empty / None -> None. Raises ValueError on a malformed or empty range."""
    if spec is None or not spec.strip():
        return None
    out: List[Range] = []
    for part in spec.split(","):
        a, sep, b = part.strip().partition("-")
        if not sep:
            raise ValueError(f"bad range {part!r}; expected start-end")
        start, end = float(a), float(b)
        if start < 0 or end <= start:
            raise ValueError(f"bad range {part!r}; need 0 <= start < end")
        out.append((start, end))
    return out


def _wanted(t: float, ranges: Sequence[Range]) -> bool:
    return any(a - RANGE_PAD_SEC <= t <= b + RANGE_PAD_SEC for a, b in ranges)


class _MatteStats:
    """What the Node quality gate and the kinetic placement need, measured from RVM's own alpha (nothing invented)."""

    def __init__(self) -> None:
        self.segmented = 0
        self.detected = 0
        self.areas: List[float] = []
        self.boxes: List[Tuple[float, float, float, float]] = []

    def add(self, alpha01: np.ndarray) -> None:
        self.segmented += 1
        mask = alpha01 > 0.5
        count = int(mask.sum())
        if count <= _MIN_SUBJECT_PIXELS:
            return
        h, w = mask.shape
        rows = np.flatnonzero(mask.any(axis=1))
        cols = np.flatnonzero(mask.any(axis=0))
        self.detected += 1
        self.areas.append(count / float(h * w))
        self.boxes.append((cols[0] / w, rows[0] / h, (cols[-1] + 1) / w, (rows[-1] + 1) / h))

    def report(self) -> Dict[str, Any]:
        box = None
        if self.boxes:
            v = np.array(self.boxes)
            x0, y0 = float(np.percentile(v[:, 0], 5)), float(np.percentile(v[:, 1], 5))
            x1, y1 = float(np.percentile(v[:, 2], 95)), float(np.percentile(v[:, 3], 95))
            box = {"x": round(x0, 4), "y": round(y0, 4), "w": round(x1 - x0, 4), "h": round(y1 - y0, 4)}
        return {
            "segmented_frames": self.segmented,
            "detected_ratio": round(self.detected / self.segmented, 4) if self.segmented else 0.0,
            "mean_area": round(float(np.mean(self.areas)), 4) if self.areas else 0.0,
            "box": box,
        }


def process_video(
    input_video: Union[str, "Path"],
    output_format: str = "transparent",
    quality: str = "high",
    max_frames: Optional[int] = None,
    output_path: Optional[Union[str, "Path"]] = None,
    *,
    weights_path: Optional[Union[str, "Path"]] = None,
    device: Optional[str] = None,
    on_progress: Optional[Callable[[int, Optional[int]], None]] = None,
    ranges: Optional[Sequence[Range]] = None,
    max_side: Optional[int] = None,
) -> Dict[str, Any]:
    """Matte ``input_video`` (first ``max_frames`` frames, or all) into a transparent VP9 WebM and return run facts.

    Everything in the returned dict is measured from this run. ``device`` defaults to the ``RVM_DEVICE`` policy.
    ``on_progress(frames_done, total_or_None)`` is called after each encoded frame; it is optional and has no
    effect on the output. ``total`` is the number of frames this call will encode when the container reports a
    frame count (capped by ``max_frames``), else None.

    ``ranges`` (SOURCE seconds, ``[(a, b), ...]``): the whole video is still decoded sequentially, so the output keeps the source's
    frame count, order, fps and duration, but RVM runs only on frames with ``a - 0.05 <= t <= b + 0.05``; every other frame is written
    fully transparent. The recurrent state is reset at the start of each range. ``ranges=None`` is the original full-video behavior.
    ``max_side`` caps the longest side of the processed / encoded frames (aspect kept); ``None`` keeps the source size.
    """
    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise ValueError(f"unsupported output_format {output_format!r}; only {SUPPORTED_OUTPUT_FORMATS} is supported")
    if quality not in QUALITY_PRESETS:
        raise ValueError(f"quality must be one of {sorted(QUALITY_PRESETS)}")
    if max_frames is not None and (not isinstance(max_frames, int) or max_frames < 1):
        raise ValueError("max_frames must be a positive int or None")
    if ranges is not None:
        ranges = [(float(a), float(b)) for a, b in ranges]
        if not ranges or any(a < 0 or b <= a for a, b in ranges):
            raise ValueError("ranges must be a non-empty list of (start, end) with 0 <= start < end")
    if max_side is not None and (not isinstance(max_side, int) or max_side < 64):
        raise ValueError("max_side must be an int >= 64 or None")

    src = Path(input_video)
    if output_path is None:
        suffix = f"-{max_frames}f" if max_frames else ""
        output_path = DEFAULT_OUTPUT_DIR / f"{src.stem}-rvm{suffix}.webm"
    out = Path(output_path)
    if out.suffix.lower() != ".webm":
        raise ValueError("output_path must end with .webm")

    ensure_vp9_alpha_encoder()  # fail before any inference if there is no libvpx-vp9
    weights = Path(weights_path) if weights_path else DEFAULT_WEIGHTS_PATH
    dev = resolve_device(device)
    model = get_model(weights, dev)  # cached process-wide: no reload on later calls
    session = RvmSession(model)
    session.reset()  # once, at the start of this video; never per frame

    started = time.perf_counter()
    infer_s = 0.0
    frames = 0
    width = height = 0
    stats = _MatteStats()
    blank: Optional[np.ndarray] = None  # one all-zero RGBA frame, reused for every frame outside the ranges
    in_range_prev = False
    prev_alpha: Optional[np.ndarray] = None  # temporal EMA — kills border / pocket flicker
    prev_fgr: Optional[np.ndarray] = None
    with VideoDecoder(src) as decoder:
        info = decoder.info
        assert info is not None
        encoder: Optional[TransparentWebmEncoder] = None
        try:
            for bgr in decoder.frames(max_frames):
                rgb = limit_max_side(to_rgb_input(bgr), max_side)
                del bgr
                if encoder is None:
                    height, width = rgb.shape[:2]  # the decoded frame is authoritative
                    encoder = TransparentWebmEncoder(
                        out,
                        width,
                        height,
                        info.fps,
                        quality=quality,
                        metadata={
                            "finalpost_audio_policy": "none; audio stays on the source asset",
                            "finalpost_source": src.name,
                            "finalpost_matte": "rvm_mobilenetv3 fgr+pha (straight alpha)",
                        },
                    )
                    encoder.__enter__()
                wanted = ranges is None or _wanted(frames / info.fps, ranges)
                if wanted:
                    if ranges is not None and not in_range_prev:
                        session.reset()  # a new range is a new "video": never carry state across a gap
                        prev_alpha = None
                        prev_fgr = None
                    t0 = time.perf_counter()
                    fgr, pha = session.infer_frame(rgb)
                    infer_s += time.perf_counter() - t0
                    fgr, alpha = refine(fgr, pha, source_rgb=rgb)
                    alpha, fgr = temporal_blend(alpha, fgr, prev_alpha, prev_fgr)
                    prev_alpha = alpha.copy()
                    prev_fgr = fgr.copy()
                    stats.add(alpha)
                    encoder.write(to_rgba_uint8(fgr, alpha))
                else:
                    prev_alpha = None
                    prev_fgr = None
                    if blank is None:
                        blank = np.zeros((height, width, 4), dtype=np.uint8)
                    encoder.write(blank)
                in_range_prev = wanted
                frames += 1
                if on_progress is not None:
                    total = info.frame_count
                    if total is not None and max_frames is not None:
                        total = min(total, max_frames)
                    on_progress(frames, total)
            if encoder is None or frames == 0:
                raise RuntimeError(f"no frames could be decoded from {src}")
            encoder.close()
        except BaseException:
            if encoder is not None:
                encoder.abort()  # kills ffmpeg, removes the partial file; the final path is never created
            raise
    elapsed = time.perf_counter() - started
    matte = stats.report()

    return {
        "output_path": str(out),
        "output_bytes": out.stat().st_size,
        "output_format": output_format,
        "codec": "vp9",
        "pix_fmt": "yuva420p",
        "width": width,
        "height": height,
        "fps": info.fps,
        "frames": frames,
        "frames_encoded": frames,
        "duration_sec": frames / info.fps,
        "source_frame_count": info.frame_count,
        "source_duration_sec": info.duration_sec,
        "truncated": info.frame_count is not None and frames < info.frame_count,
        "device": str(session.device),
        "downsample_ratio": session.downsample_ratio,
        "elapsed_sec": elapsed,
        "ms_per_frame": elapsed * 1000.0 / frames,
        "infer_ms_per_frame": (infer_s * 1000.0 / matte["segmented_frames"]) if matte["segmented_frames"] else 0.0,
        "seconds": round(elapsed, 2),
        "model": MODEL_NAME,
        "ranges": [[a, b] for a, b in ranges] if ranges is not None else None,
        **matte,
        "audio_policy": AUDIO_POLICY,
        "weights_path": str(Path(weights).resolve()),
        "weights_sha256": weights_sha256(weights),
        "quality": quality,
    }
