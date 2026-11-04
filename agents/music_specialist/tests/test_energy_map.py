"""Measured arc: a per-bar energy map and the lift bar. Placement uses these numbers, never the requested arc."""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
import pytest

from music_specialist.postprocess import RATE, energy_map_and_lift, postprocess_bed

BPM = 120
BAR_SEC = 4 * 60.0 / BPM  # 2.0 s


def _write(path: Path, mono: np.ndarray) -> None:
    pcm = (np.clip(np.stack([mono, mono], axis=1), -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm.tobytes())


def synthetic_bed(lift_bar: int, bars: int = 20) -> np.ndarray:
    """Quiet pad for `lift_bar` bars, then a loud tone with a kick on every beat. The lift is at lift_bar * BAR_SEC."""
    n = int(bars * BAR_SEC * RATE)
    t = np.arange(n) / RATE
    out = 0.02 * np.sin(2 * np.pi * 220 * t)
    beat = 60.0 / BPM
    lift_t = lift_bar * BAR_SEC
    for k in range(int(bars * 4)):
        start = k * beat
        i = int(start * RATE)
        m = int(0.03 * RATE)
        click = np.sin(2 * np.pi * 1000 * np.arange(m) / RATE) * np.linspace(1, 0, m)
        amp = 0.8 if start >= lift_t else 0.3
        out[i:i + m] += amp * click[: max(0, min(m, n - i))]
    loud = t >= lift_t
    out[loud] += 0.25 * np.sin(2 * np.pi * 330 * t[loud])
    return out


def test_lift_bar_is_the_first_bar_that_rises_by_0_2_over_the_previous_four():
    rate = RATE
    quiet, loud = np.full(int(BAR_SEC * rate), 0.02), np.full(int(BAR_SEC * rate), 0.3)
    samples = np.concatenate([quiet] * 8 + [loud] * 6)[:, None].repeat(2, axis=1)
    downbeats = [i * BAR_SEC for i in range(14)]
    out = energy_map_and_lift(samples, rate, downbeats, None)
    assert out["lift_bar"] == 8
    assert out["lift_sec"] == pytest.approx(16.0)
    assert out["bar_sec"] == pytest.approx(2.0)
    assert out["energy_map"][:8] == [pytest.approx(0.067, abs=0.002)] * 8
    assert out["energy_map"][8:] == [1.0] * 6
    assert all(0.0 <= v <= 1.0 for v in out["energy_map"])


def test_a_steady_bed_has_no_lift_bar_and_too_few_downbeats_gives_an_empty_map():
    steady = np.full((int(10 * BAR_SEC * RATE), 2), 0.1)
    out = energy_map_and_lift(steady, RATE, [i * BAR_SEC for i in range(10)], None)
    assert out["lift_bar"] is None and out["lift_sec"] is None
    assert len(out["energy_map"]) == 10
    assert energy_map_and_lift(steady, RATE, [0.0], None) == {"energy_map": [], "lift_bar": None, "lift_sec": None, "bar_sec": None}


def test_a_rise_below_0_2_is_not_a_lift():
    rate = RATE
    bars = [np.full(int(BAR_SEC * rate), a) for a in (0.2, 0.2, 0.2, 0.2, 0.23, 0.23)]  # normalised 0.87 -> 1.0: a 0.13 rise
    samples = np.concatenate(bars)[:, None].repeat(2, axis=1)
    assert energy_map_and_lift(samples, rate, [i * BAR_SEC for i in range(6)], None)["lift_bar"] is None


def test_postprocess_records_the_measured_energy_map_and_lift_in_its_result(tmp_path):
    src = tmp_path / "raw.wav"
    _write(src, synthetic_bed(lift_bar=8))
    out = postprocess_bed(str(src), str(tmp_path / "bed.wav"))
    assert out["postprocess_version"] == 5
    assert out["measured_bpm"] == pytest.approx(BPM, rel=0.04)
    downbeats = out["downbeat_times"]
    assert len(downbeats) >= 8
    assert float(np.median(np.diff(downbeats))) == pytest.approx(BAR_SEC, rel=0.05)
    energy = out["energy_map"]
    assert len(energy) >= 8 and all(0.0 <= v <= 1.0 for v in energy)
    assert np.mean(energy[-4:]) > np.mean(energy[:3]) + 0.3
    # The measured lift lands at the real change (16 s) to within a beat (0.5 s) plus tracker slack, even though the tracker's bar grid is offset from the music's.
    assert out["lift_bar"] is not None
    assert out["lift_sec"] == pytest.approx(8 * BAR_SEC, abs=0.6)
    assert out["bar_sec"] == pytest.approx(BAR_SEC, rel=0.05)


# ---- Phase 3.1: per-bar loudness maps --------------------------------------------------------------------------------------------------------

def _bar_tone(amplitude: float, bars: int, bar_sec: float = BAR_SEC, freq: float = 220.0) -> np.ndarray:
    t = np.arange(int(bars * bar_sec * RATE)) / RATE
    return amplitude * np.sin(2 * np.pi * freq * t)


def test_bar_loudness_map_matches_a_direct_measurement_of_each_bar():
    import pyloudnorm as pyln

    from music_specialist.postprocess import bar_edges, bar_loudness_map

    quiet, loud = _bar_tone(0.05, 8), _bar_tone(0.25, 6)
    samples = np.concatenate([quiet, loud])[:, None].repeat(2, axis=1)
    edges = bar_edges(samples.shape[0] / RATE, [i * BAR_SEC for i in range(14)])
    got = bar_loudness_map(samples, RATE, edges)
    assert len(got) == 14  # 14 downbeats, and the 2 s after the last is a whole bar
    meter = pyln.Meter(RATE)
    for i, value in enumerate(got):
        chunk = samples[int(edges[i] * RATE): int(edges[i + 1] * RATE)]
        assert value == pytest.approx(meter.integrated_loudness(chunk), abs=0.06)
    assert np.mean(got[8:]) - np.mean(got[:8]) == pytest.approx(20 * np.log10(5), abs=0.5)  # 0.25 / 0.05 = +14 dB


def test_loudness_maps_handle_silence_short_chunks_and_a_missing_grid():
    from music_specialist.postprocess import SILENT_LUFS, bar_edges, bar_loudness_map, chunk_lufs, loop_loudness_map

    assert chunk_lufs(np.zeros((RATE, 2)), RATE) == SILENT_LUFS  # silence is -70, never -inf
    assert chunk_lufs(np.ones((100, 2)) * 0.1, RATE) == SILENT_LUFS  # under one 400 ms block
    assert bar_edges(10.0, [1.0]) == []
    assert bar_loudness_map(np.zeros((10, 2)), RATE, []) == []
    body = np.concatenate([_bar_tone(0.1, 2), _bar_tone(0.4, 2)])[:, None].repeat(2, axis=1)
    loop = loop_loudness_map(body, RATE, 4)
    assert len(loop) == 4 and loop[2] > loop[1] + 10
    assert len(loop_loudness_map(body, RATE, 0)) == 4 or len(loop_loudness_map(body, RATE, 0)) == 1


def test_postprocess_records_the_three_loudness_maps_aligned_to_the_downbeats(tmp_path):
    src = tmp_path / "raw.wav"
    _write(src, synthetic_bed(lift_bar=8))
    out = postprocess_bed(str(src), str(tmp_path / "bed.wav"))
    assert out["postprocess_version"] == 5
    full, carved = out["loudness_map"], out["carved_loudness_map"]
    assert len(full) == len(carved) == len(out["energy_map"])  # one value per bar, same edges as the energy map and the downbeats
    assert len(out["loop_loudness_map"]) == out["loop_bars"]
    # the bed lifts: the loud half is well above the quiet half, in LUFS as well as in the energy map
    assert np.mean(full[-4:]) > np.mean(full[:3]) + 3
    # the carved twin is never louder than the full bed (it only cuts)
    assert all(c <= f + 0.3 for c, f in zip(carved, full))
    # the whole bed is normalised to -16 LUFS, so the per-bar values average (in energy) near that
    assert 10 * np.log10(np.mean(10 ** (np.array(full) / 10))) == pytest.approx(-16.0, abs=1.5)
