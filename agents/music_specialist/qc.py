"""QC gate for a postprocessed bed. Local only. vocal_score is log-only."""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
from pydub import AudioSegment

SILENCE_DBFS = -50.0
MAX_SILENCE_SEC = 1.5
MAX_PEAK_DBFS = -0.1
MAX_BPM_ERROR = 0.03
MAX_SEAM_DB = 1.5
CHUNK_MS = 10
SEAM_WINDOW_MS = 20


def _load(path: str):
    seg = AudioSegment.from_file(path).set_channels(2)
    scale = float(1 << (8 * seg.sample_width - 1))
    x = np.array(seg.get_array_of_samples(), dtype=np.float64).reshape(-1, 2) / scale
    return x, seg.frame_rate


def _silence_sec(x: np.ndarray, rate: int) -> float:
    n = max(1, int(rate * CHUNK_MS / 1000))
    count = x.shape[0] // n
    if count == 0:
        return 0.0
    chunks = x[: count * n].reshape(count, n, x.shape[1])
    energy = np.sqrt(np.mean(np.square(chunks), axis=(1, 2)))  # both channels, per chunk
    quiet = energy <= 10 ** (SILENCE_DBFS / 20)
    longest = run = 0
    for q in quiet:
        run = run + 1 if q else 0
        longest = max(longest, run)
    return round(longest * CHUNK_MS / 1000, 3)


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)))) or 1e-12


def _seam_db(loop: np.ndarray, rate: int) -> float:
    joined = np.concatenate([loop, loop])
    join = loop.shape[0]
    n = int(rate * SEAM_WINDOW_MS / 1000)
    return round(abs(20 * math.log10(_rms(joined[join : join + n]) / _rms(joined[join - n : join]))), 3)


def _vocal_score(x: np.ndarray, rate: int) -> float:
    """Harmonic-component energy in 300-3000 Hz over total harmonic energy, 0..1."""
    try:
        import librosa

        mono = x.mean(axis=1)[: rate * 60]
        target = 22050
        if rate != target:
            mono = librosa.resample(mono, orig_sr=rate, target_sr=target)
        harm = librosa.effects.harmonic(mono)
        spec = np.abs(np.fft.rfft(harm)) ** 2
        freqs = np.fft.rfftfreq(harm.shape[0], 1 / target)
        total = float(spec.sum())
        if total <= 0:
            return 0.0
        score = float(spec[(freqs >= 300) & (freqs <= 3000)].sum()) / total
        return round(min(1.0, max(0.0, score)), 4) if math.isfinite(score) else 0.0
    except Exception:
        return 0.0


def qc_bed(*, bed_full_path: str, bed_loop_path: str, measured_bpm: Optional[float],
           requested_bpm: float, loop_fallback: bool) -> dict:
    full, rate = _load(bed_full_path)
    peak = float(np.max(np.abs(full))) if full.size else 0.0
    peak_db = round(20 * math.log10(peak), 3) if peak > 0 else -120.0
    silence = _silence_sec(full, rate)
    bpm_err = None
    if measured_bpm is not None and requested_bpm:
        bpm_err = round(abs(float(measured_bpm) - requested_bpm) / requested_bpm, 4)
    seam = None
    if not loop_fallback:
        loop, loop_rate = _load(bed_loop_path)
        seam = _seam_db(loop, loop_rate)
    vocal = _vocal_score(full, rate)

    ok = silence <= MAX_SILENCE_SEC and peak_db <= MAX_PEAK_DBFS
    ok = ok and bpm_err is not None and bpm_err <= MAX_BPM_ERROR
    if not loop_fallback:
        ok = ok and seam is not None and seam <= MAX_SEAM_DB
    return {
        "silence_sec": silence,
        "true_peak_dbfs": peak_db,
        "bpm_error_ratio": bpm_err,
        "seam_db": seam,
        "vocal_score": vocal,  # log-only: never read by `passed`
        "passed": bool(ok),
    }
