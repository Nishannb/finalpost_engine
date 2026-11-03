"""Speech-gated integrated loudness of the creator audio. Offline; never touches Runware.

CLI: python -m music_specialist.vo_lufs <audio file> <intervals.json>
intervals.json = [[start_sec, end_sec], ...] in the timeline of the audio file.
Prints {"vo_lufs": <float|null>} on stdout.
"""

from __future__ import annotations

import json
import sys
from typing import Iterable, Optional, Sequence

import numpy as np
import pyloudnorm as pyln

MIN_GATED_SEC = 0.6
TALKING_OFFSETS_LU = {"speech": -18.0, "pause": -9.0, "open": -4.0}


def duck_gain_db(vo_lufs: float, bed_lufs: float, offset_lu: float) -> float:
    """Gain that puts the bed offset_lu under the voice. Mirrors server duckEnvelope.ts (talking preset)."""
    return float(min(0.0, max(-40.0, (vo_lufs + offset_lu) - bed_lufs)))


def speech_gated_lufs(samples: np.ndarray, rate: int, intervals: Iterable[Sequence[float]]) -> Optional[float]:
    mono = samples if samples.ndim == 1 else samples.mean(axis=1)
    parts = []
    for start, end in intervals:
        a, b = max(0, int(start * rate)), min(len(mono), int(end * rate))
        if b > a:
            parts.append(mono[a:b])
    if not parts:
        return None
    gated = np.concatenate(parts)
    if len(gated) < MIN_GATED_SEC * rate:
        return None
    value = float(pyln.Meter(rate).integrated_loudness(gated))
    return value if np.isfinite(value) else None


def measure_file(path: str, intervals: Iterable[Sequence[float]]) -> Optional[float]:
    from pydub import AudioSegment

    segment = AudioSegment.from_file(path).set_channels(1).set_sample_width(2)
    samples = np.array(segment.get_array_of_samples(), dtype=np.float64) / float(1 << 15)
    return speech_gated_lufs(samples, segment.frame_rate, intervals)


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(2)
    with open(sys.argv[2], encoding="utf-8") as handle:
        intervals = json.load(handle)
    value = measure_file(sys.argv[1], intervals)
    json.dump({"vo_lufs": None if value is None else round(value, 2)}, sys.stdout)


if __name__ == "__main__":
    main()
