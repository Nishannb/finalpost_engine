"""QC gate. Offline: local files and dry mode only."""

import math
from pathlib import Path

import numpy as np
import pytest
from pydub import AudioSegment

from music_specialist import qc as qc_mod
from music_specialist.agent import AIMusicSpecialistAgent
from music_specialist.postprocess import postprocess_bed
from music_specialist.qc import qc_bed

SMOKE = Path(__file__).resolve().parents[3] / "remotion" / "public" / "music-smoke-bed.wav"


def _write_tone_gap(path: str) -> None:
    rate = 48000
    t = np.arange(rate * 2) / rate
    tone = (0.3 * np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
    mono = np.concatenate([tone, np.zeros(rate * 2, dtype=np.int16), tone])
    stereo = np.repeat(mono[:, None], 2, axis=1).reshape(-1)
    AudioSegment(stereo.tobytes(), frame_rate=rate, sample_width=2, channels=2).export(path, format="wav")


@pytest.mark.skipif(not SMOKE.exists(), reason="music-smoke-bed.wav missing")
def test_salvaged_bed_passes(tmp_path, monkeypatch):
    out = postprocess_bed(str(SMOKE), str(tmp_path / "bed.wav"))
    kwargs = dict(bed_full_path=out["bed_full_path"], bed_loop_path=out["bed_loop_path"],
                  measured_bpm=out["measured_bpm"], requested_bpm=128, loop_fallback=out["loop_fallback"])
    result = qc_bed(**kwargs)
    print("QC", result)
    assert result["passed"], result
    assert result["silence_sec"] <= 1.5
    assert math.isfinite(result["vocal_score"]) and 0 <= result["vocal_score"] <= 1
    # a fake score cannot flip passed
    monkeypatch.setattr(qc_mod, "_vocal_score", lambda x, r: 1.0)
    forced = qc_bed(**kwargs)
    assert forced["vocal_score"] == 1.0 and forced["passed"] is True


def test_interior_silence_fails_without_raising(tmp_path):
    path = str(tmp_path / "gap.wav")
    _write_tone_gap(path)
    result = qc_bed(bed_full_path=path, bed_loop_path=path, measured_bpm=128, requested_bpm=128, loop_fallback=True)
    assert result["silence_sec"] >= 1.9
    assert result["passed"] is False
    assert result["seam_db"] is None


def test_missing_bpm_fails(tmp_path):
    path = str(tmp_path / "gap.wav")
    _write_tone_gap(path)
    result = qc_bed(bed_full_path=path, bed_loop_path=path, measured_bpm=None, requested_bpm=128, loop_fallback=True)
    assert result["bpm_error_ratio"] is None and result["passed"] is False


def test_dry_run_returns_bed_even_if_qc_fails(tmp_path, monkeypatch):
    import music_specialist.agent as agent_mod

    monkeypatch.setattr(agent_mod, "qc_bed", lambda **kw: {
        "silence_sec": 9.0, "true_peak_dbfs": -1.5, "bpm_error_ratio": 0.0, "seam_db": None,
        "vocal_score": 0.5, "passed": False})
    out = AIMusicSpecialistAgent().run({"emotional_tone": "calm", "canvas_sec": 10, "video_id": "v"}, str(tmp_path), mode="dry")
    assert out["qc_passed"] is False and out["qc_retried"] is False
    assert Path(out["bed_path"]).exists() if "bed_path" in out else True
    assert out["qc_vocal_score"] == 0.5


def test_speech_band_stats_is_log_only_and_separates_busy_from_steady():
    import numpy as np
    from music_specialist.postprocess import speech_band_stats

    rate = 48000
    t = np.arange(rate * 4) / rate
    low = np.stack([0.3 * np.sin(2 * np.pi * 110 * t)] * 2, axis=1)  # a pad far below the speech band
    mid_steady = np.stack([0.3 * np.sin(2 * np.pi * 2000 * t)] * 2, axis=1)
    rng = np.random.default_rng(1)
    gate = (np.floor(t * 8) % 2)[:, None]  # 8 Hz on/off bursts: busy
    mid_busy = np.stack([0.3 * np.sin(2 * np.pi * 2000 * t)] * 2, axis=1) * gate + 0.001 * rng.standard_normal((len(t), 2))

    a, b, c = (speech_band_stats(x, rate) for x in (low, mid_steady, mid_busy))
    assert a["energy_share"] < 0.05
    assert b["energy_share"] > 0.9 and c["energy_share"] > 0.9
    assert c["flux"] > b["flux"] * 3
