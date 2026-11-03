"""Bed-only loudness check: the same measurer the render hook uses (vo_lufs.measure_mix), on a gain-applied fixture."""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import pytest

from music_specialist.vo_lufs import measure_file, measure_mix, read_audio

BED = Path(__file__).resolve().parents[3] / "remotion" / "public" / "music-smoke-bed.wav"
# buildDuckEnvelope talking preset: target bed level = voLufs - 18 in speech, voLufs - 9 in pause
VO_LUFS = -20.0
SPEECH_GAP_LU = 18.0
PAUSE_GAP_LU = 9.0
SPEECH = [[0.5, 2.0], [3.2, 4.7]]  # the 1.2 s gap between them is a pause window (>= 0.6 s)
PAUSE = [[2.0, 3.2]]


def _write(path: Path, samples: np.ndarray, rate: int) -> None:
    """samples: 1-D mono or (n, channels) floats in -1..1."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16)
    channels = 1 if pcm.ndim == 1 else pcm.shape[1]
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def _voice(seconds: float, rate: int) -> np.ndarray:
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(int(seconds * rate))
    out = np.zeros_like(noise)
    for start, end in SPEECH:
        a, b = int(start * rate), int(end * rate)
        chunk = noise[a:b]
        gain = 10 ** ((-20.0 - pyln.Meter(rate).integrated_loudness(chunk)) / 20)
        out[a:b] = chunk * gain
    return out


def _duck_gain(bed_lufs: float, gap_lu: float) -> float:
    """Same formula and clamp as duck_gain_db: (voLufs - gap) - bedLufs, within [-40, 0]."""
    return max(-40.0, min(0.0, (VO_LUFS - gap_lu) - bed_lufs))


@pytest.mark.skipif(not BED.exists(), reason="salvaged bed not on disk")
def test_gain_applied_fixture_gaps(tmp_path: Path) -> None:
    # Native rate and channel count: a stereo bed is measured as stereo (BS.1770), not as a mono downmix.
    full, rate = read_audio(str(BED))
    assert measure_file(str(BED), [[0.0, len(full) / rate]]) == pytest.approx(-16.0, abs=1.0)

    seconds = 6.0
    bed = full[: int(seconds * rate)]
    assert len(bed) >= int(seconds * rate) - 1

    # Short slices of the real bed are not -16, so measure the ungained bed per region first.
    raw_path = tmp_path / "bed_raw.wav"
    _write(raw_path, bed, rate)
    bed_speech = measure_file(str(raw_path), SPEECH)
    bed_pause = measure_file(str(raw_path), PAUSE)
    assert bed_speech is not None and bed_pause is not None
    speech_db = _duck_gain(bed_speech, SPEECH_GAP_LU)
    pause_db = _duck_gain(bed_pause, PAUSE_GAP_LU)

    stem = bed * 10 ** (speech_db / 20)  # same gain on every channel
    for start, end in PAUSE:
        a, b = int(start * rate), int(end * rate)
        stem[a:b] = bed[a:b] * 10 ** (pause_db / 20)
    bed_path, vo_path = tmp_path / "bed.wav", tmp_path / "vo.wav"
    _write(bed_path, stem, rate)
    _write(vo_path, _voice(seconds, rate), rate)

    measured = measure_mix(str(bed_path), str(vo_path), SPEECH, PAUSE)
    assert measured["vo_speech_lufs"] == pytest.approx(-20.0, abs=0.5)
    speech_gap = measured["vo_speech_lufs"] - measured["bed_speech_lufs"]
    pause_gap = measured["vo_speech_lufs"] - measured["bed_pause_lufs"]
    assert speech_gap == pytest.approx(18.0, abs=1.0)
    assert pause_gap == pytest.approx(9.0, abs=1.0)
