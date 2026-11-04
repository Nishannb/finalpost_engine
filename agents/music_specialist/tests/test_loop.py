"""Bar-aligned loop (postprocess v2). Offline: local files only, no Runware."""

import math
import os
from pathlib import Path

import numpy as np
import pytest
from pydub import AudioSegment

from music_specialist.postprocess import POSTPROCESS_VERSION, RATE, postprocess_bed, write_click_bed

SMOKE = Path(__file__).resolve().parents[3] / "remotion" / "public" / "music-smoke-bed.wav"


def _samples(path: str) -> np.ndarray:
    seg = AudioSegment.from_file(path).set_channels(2)
    return np.array(seg.get_array_of_samples(), dtype=np.float64).reshape(-1, 2) / 32768.0


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)))) or 1e-12


def test_version_is_three():
    assert POSTPROCESS_VERSION == 5


def test_click_bed_writes_both_files(tmp_path):
    raw = str(tmp_path / "raw.wav")
    write_click_bed(raw, 120)
    out = postprocess_bed(raw, str(tmp_path / "w" / "bed.wav"))
    assert out["postprocess_version"] == 5
    for name in ("bed.wav", "bed_full.wav", "bed_loop.wav"):
        assert (tmp_path / "w" / name).exists()
    if out["loop_fallback"]:  # beat_track may fail on a pure click bed; that is allowed
        assert out["loop_duration_sec"] == out["duration_sec"]


@pytest.mark.skipif(not SMOKE.exists(), reason="music-smoke-bed.wav missing")
def test_smoke_bed_bar_loop(tmp_path):
    out = postprocess_bed(str(SMOKE), str(tmp_path / "bed.wav"))
    assert os.path.exists(out["bed_full_path"]) and os.path.exists(out["bed_loop_path"])
    assert not out["loop_fallback"], "salvaged bed must reach the bar cutter"
    bpm = out["measured_bpm"]
    assert bpm is not None
    assert any(abs(bpm - target) / target <= 0.03 for target in (128, 64, 256)), bpm
    assert out["downbeat_times"]

    loop = _samples(out["bed_loop_path"])
    joined = np.concatenate([loop, loop])
    join = loop.shape[0]
    n = int(RATE * 0.02)
    before = _rms(joined[join - n : join])
    after = _rms(joined[join : join + n])
    jump = abs(20 * math.log10(after / before))
    assert jump <= 1.5, jump
