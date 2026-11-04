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
MIN_WINDOW_SEC = 0.4  # one BS.1770 block: the shortest window with a loudness of its own
VOICE_FIGHT_LU = 6.0  # a speech window where the bed is within this many LU of the voice is a "fight"
TALKING_OFFSETS_LU = {"speech": -18.0, "pause": -9.0, "open": -4.0}


def duck_gain_db(vo_lufs: float, bed_lufs: float, offset_lu: float) -> float:
    """Gain that puts the bed offset_lu under the voice. Mirrors server duckEnvelope.ts (talking preset)."""
    return float(min(0.0, max(-40.0, (vo_lufs + offset_lu) - bed_lufs)))


def speech_gated_lufs(samples: np.ndarray, rate: int, intervals: Iterable[Sequence[float]], min_sec: float = MIN_GATED_SEC) -> Optional[float]:
    """samples: 1-D mono, or (samples, channels). Multichannel is measured per BS.1770 (channel energies summed), not downmixed."""
    parts = []
    for start, end in intervals:
        a, b = max(0, int(start * rate)), min(len(samples), int(end * rate))
        if b > a:
            parts.append(samples[a:b])  # slices every channel on the same time range
    if not parts:
        return None
    gated = np.concatenate(parts, axis=0)
    if len(gated) < min_sec * rate:
        return None
    value = float(pyln.Meter(rate).integrated_loudness(gated))
    return value if np.isfinite(value) else None


def read_audio(path: str) -> tuple:
    """(float64 samples in -1..1, rate). 1-D when the file is mono, else (samples, channels). Native rate and channels."""
    from pydub import AudioSegment

    segment = AudioSegment.from_file(path).set_sample_width(2)
    samples = np.array(segment.get_array_of_samples(), dtype=np.float64) / float(1 << 15)
    if segment.channels > 1:
        samples = samples.reshape(-1, segment.channels)
    return samples, segment.frame_rate


def measure_file(path: str, intervals: Iterable[Sequence[float]]) -> Optional[float]:
    samples, rate = read_audio(path)
    return speech_gated_lufs(samples, rate, intervals)


def bed_over_voice_windows(voice, bed, rate: int, speech: Sequence[Sequence[float]], threshold_lu: float = VOICE_FIGHT_LU) -> dict:
    """Per speech window: voice LUFS minus bed LUFS. A window with a gap under threshold_lu is a fight.

    Windows shorter than MIN_WINDOW_SEC have no loudness of their own and are counted as unmeasured, never as a pass.
    """
    gaps = []
    unmeasured = 0
    for start, end in speech:
        v = speech_gated_lufs(voice, rate, [[start, end]], MIN_WINDOW_SEC)
        b = speech_gated_lufs(bed, rate, [[start, end]], MIN_WINDOW_SEC)
        if v is None or b is None:
            unmeasured += 1
        else:
            gaps.append(round(v - b, 2))
    return {
        "bed_over_voice_windows": sum(1 for gap in gaps if gap < threshold_lu),
        "speech_window_gaps": gaps,
        "speech_windows_unmeasured": unmeasured,
        "min_speech_window_gap_lu": min(gaps) if gaps else None,
    }


def measure_mix(
    bed_path: str,
    vo_path: str,
    speech: Sequence[Sequence[float]],
    pause: Sequence[Sequence[float]],
    pause_settled: Optional[Sequence[Sequence[float]]] = None,
) -> dict:
    """Loudness of the stems inside speech and pause windows. Offline. A value is None when its windows are too short to gate.

    bed_pause_lufs is the whole pause window (hold and release ramps included). bed_pause_settled_lufs is only the part
    where the envelope has reached the pause gain; it is None when no pause was long enough to settle.
    """
    bed, rate = read_audio(bed_path)
    voice, voice_rate = read_audio(vo_path)
    settled = list(pause_settled or [])
    fight = bed_over_voice_windows(voice, bed, rate, speech) if voice_rate == rate else {}
    return {
        **fight,
        "vo_speech_lufs": speech_gated_lufs(voice, voice_rate, speech),
        "bed_speech_lufs": speech_gated_lufs(bed, rate, speech),
        "bed_pause_lufs": speech_gated_lufs(bed, rate, pause),
        "bed_pause_settled_lufs": speech_gated_lufs(bed, rate, settled) if settled else None,
        "settled_pause_count": len(settled),
        "settled_pause_sec": round(sum(max(0.0, e - s) for s, e in settled), 3),
    }


def mix_main() -> None:
    """CLI: python -m music_specialist.vo_lufs --mix <bed.wav> <vo.wav> <windows.json>; windows = {"speech": [[s,e]], "pause": [[s,e]], "pauseSettled": [[s,e]]}."""
    with open(sys.argv[4], encoding="utf-8") as handle:
        windows = json.load(handle)
    result = measure_mix(sys.argv[2], sys.argv[3], windows.get("speech", []), windows.get("pause", []), windows.get("pauseSettled", []))
    json.dump(
        {key: value if isinstance(value, (list, int)) or value is None else round(value, 2) for key, value in result.items()},
        sys.stdout,
    )


def main() -> None:
    if len(sys.argv) >= 5 and sys.argv[1] == "--mix":
        mix_main()
        return
    if len(sys.argv) < 3:
        raise SystemExit(2)
    with open(sys.argv[2], encoding="utf-8") as handle:
        intervals = json.load(handle)
    value = measure_file(sys.argv[1], intervals)
    json.dump({"vo_lufs": None if value is None else round(value, 2)}, sys.stdout)


if __name__ == "__main__":
    main()
