from __future__ import annotations

from typing import Tuple

from pydub import AudioSegment
from pydub.silence import detect_leading_silence

THRESHOLD_DBFS = -50.0
CHUNK_MS = 10


def trim_segment(segment: AudioSegment) -> Tuple[AudioSegment, int]:
    """Crop leading silence only. Returns (segment, trimmed_ms)."""
    ms = detect_leading_silence(segment, silence_threshold=THRESHOLD_DBFS, chunk_size=CHUNK_MS)
    ms = min(ms, len(segment))
    return segment[ms:], ms


def trim_trailing_segment(segment: AudioSegment) -> Tuple[AudioSegment, int]:
    """Crop trailing near-silence (same threshold and chunk as the leading trim). Returns (segment, trimmed_ms)."""
    ms = detect_leading_silence(segment.reverse(), silence_threshold=THRESHOLD_DBFS, chunk_size=CHUNK_MS)
    ms = min(ms, len(segment))
    return (segment[: len(segment) - ms] if ms else segment), ms


def trim_leading_silence(src_path: str, dest_path: str) -> int:
    seg = AudioSegment.from_file(src_path)
    out, ms = trim_segment(seg)
    fmt = dest_path.rsplit(".", 1)[-1].lower() if "." in dest_path else "wav"
    out.export(dest_path, format=fmt)
    return ms
