from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from pydub import AudioSegment

from music_specialist.postprocess import RATE, postprocess_bed

SMOKE = Path(__file__).resolve().parents[3] / "remotion" / "public" / "music-smoke-bed.wav"


def _write_pcm(path, mono):
    pcm = (np.clip(mono, -1, 1) * 32767).astype(np.int16)
    stereo = np.stack([pcm, pcm], axis=1)
    AudioSegment(stereo.tobytes(), frame_rate=RATE, sample_width=2, channels=2).export(str(path), format="wav")


def test_tone_then_digital_silence(tmp_path):
    t = np.arange(int(2 * RATE)) / RATE
    tone = 0.1 * np.sin(2 * np.pi * 440 * t)  # -20 dBFS peak
    _write_pcm(tmp_path / "raw.wav", np.concatenate([tone, np.zeros(3 * RATE)]))
    out = postprocess_bed(str(tmp_path / "raw.wav"), str(tmp_path / "w" / "bed.wav"))
    assert out["trailing_trimmed_sec"] >= 2.5
    assert out["duration_sec"] < 2.4
    assert out["postprocess_version"] == 5


@pytest.mark.skipif(not SMOKE.exists(), reason="music-smoke-bed.wav missing")
def test_smoke_bed_has_no_trailing_silence(tmp_path):
    out = postprocess_bed(str(SMOKE), str(tmp_path / "bed.wav"))
    assert out["trailing_trimmed_sec"] > 1.5
    seg = AudioSegment.from_file(out["bed_full_path"])
    chunk = 10
    last_loud_end = 0
    for start in range(0, len(seg) - chunk + 1, chunk):
        if seg[start : start + chunk].dBFS >= -50.0:
            last_loud_end = start + chunk
    assert len(seg) - last_loud_end <= 200
