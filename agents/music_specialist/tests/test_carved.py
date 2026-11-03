"""VO-carved twin. Offline: local files only, no Runware."""

from pathlib import Path

import numpy as np
import pytest
from pydub import AudioSegment

from music_specialist.postprocess import RATE, carve_for_voice, postprocess_bed

SMOKE = Path(__file__).resolve().parents[3] / "remotion" / "public" / "music-smoke-bed.wav"

pytestmark = pytest.mark.skipif(not SMOKE.exists(), reason="music-smoke-bed.wav missing")


def _samples(path: str) -> np.ndarray:
    seg = AudioSegment.from_file(path).set_channels(2)
    return np.array(seg.get_array_of_samples(), dtype=np.float64).reshape(-1, 2) / 32768.0


def _band_energy(x: np.ndarray, lo: float, hi: float) -> float:
    mono = x.mean(axis=1)
    spec = np.abs(np.fft.rfft(mono)) ** 2
    freqs = np.fft.rfftfreq(mono.size, 1.0 / RATE)
    return float(spec[(freqs >= lo) & (freqs < hi)].sum()) or 1e-20


def _db(a: float, b: float) -> float:
    return 10 * np.log10(a / b)


def test_carved_twin_spectrum(tmp_path):
    out = postprocess_bed(str(SMOKE), str(tmp_path / "bed.wav"))
    carved_path = Path(out["bed_carved_path"])
    assert carved_path.exists() and carved_path.name == "bed_carved.wav"
    src = _samples(out["bed_full_path"])
    carved = _samples(str(carved_path))
    assert carved.shape == src.shape
    low = _db(_band_energy(carved, 20, 150), _band_energy(src, 20, 150))
    assert low <= -6.0, low
    mid = _db(_band_energy(carved, 2500, 3500), _band_energy(src, 2500, 3500))
    assert -4.5 <= mid <= -1.5, mid


def test_carve_is_pure_function_of_input():
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.1, (RATE, 2))
    assert np.allclose(carve_for_voice(x, RATE), carve_for_voice(x, RATE))
