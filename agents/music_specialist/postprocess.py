"""Bed post: trim, −16 LUFS, peak ceiling, 40 ms equal-power loop seam."""

from __future__ import annotations

import os

import numpy as np
import pyloudnorm as pyln
from pydub import AudioSegment

from .silence_trimmer import trim_segment

POSTPROCESS_VERSION = 1
TARGET_LUFS = -16.0
PEAK_CEILING_DBFS = -1.5
SEAM_MS = 40.0
RATE = 48000


def write_click_bed(path: str, bpm: int, seconds: float = 60.0, rate: int = RATE) -> None:
    """Deterministic 48 kHz stereo bed: a steady tone plus a click on each beat."""
    bpm = max(int(bpm), 1)
    n = int(seconds * rate)
    t = np.arange(n) / rate
    tone = 0.2 * np.sin(2 * np.pi * 220.0 * t)
    click_n = int(0.02 * rate)
    click = np.sin(2 * np.pi * 1000.0 * np.arange(click_n) / rate) * np.linspace(1.0, 0.0, click_n)
    hits = np.zeros(n)
    step = int(rate * 60.0 / bpm)
    for start in range(0, n, max(step, 1)):
        end = min(n, start + click_n)
        hits[start:end] += click[: end - start]
    mono = np.clip(tone + 0.05 * hits, -1.0, 1.0)
    _write(path, np.stack([mono, mono], axis=1), rate)


def loop_seam(samples: np.ndarray, rate: int, fade_ms: float = SEAM_MS) -> np.ndarray:
    """Blend the tail into the head and drop the overlapped tail.

    After this, sample 0 and the new last sample are neighbours of the original
    audio, so a loop has no click.
    """
    fade = int(rate * fade_ms / 1000.0)
    if samples.shape[0] <= fade * 2 or fade < 2:
        return samples
    head = samples[:fade]
    tail = samples[-fade:]
    t = np.linspace(0.0, 1.0, fade, endpoint=False)[:, None]
    mixed = head * np.sin(t * np.pi / 2.0) + tail * np.cos(t * np.pi / 2.0)
    out = samples[:-fade].copy()
    out[:fade] = mixed
    return out


def postprocess_bed(src_path: str, dest_path: str) -> dict:
    segment = AudioSegment.from_file(src_path)
    segment, _trimmed = trim_segment(segment)
    if len(segment) < 400:
        raise RuntimeError("bed is empty after silence trim")
    segment = segment.set_frame_rate(RATE).set_channels(2).set_sample_width(2)
    peak = float(1 << 15)
    samples = np.array(segment.get_array_of_samples(), dtype=np.float64).reshape(-1, 2) / peak
    samples = _normalize(samples, RATE)
    samples = loop_seam(samples, RATE, SEAM_MS)
    samples = _limit_peak(samples)
    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    _write(dest_path, samples, RATE)
    loudness = float(pyln.Meter(RATE).integrated_loudness(samples))
    return {
        "bed_path": dest_path,
        "integrated_lufs": round(loudness, 3),
        "duration_sec": round(samples.shape[0] / RATE, 3),
        "postprocess_version": POSTPROCESS_VERSION,
        "sample_rate": RATE,
    }


def _normalize(samples: np.ndarray, rate: int) -> np.ndarray:
    loudness = float(pyln.Meter(rate).integrated_loudness(samples))
    if not np.isfinite(loudness):
        raise RuntimeError("bed loudness could not be measured")
    gained = samples * (10 ** ((TARGET_LUFS - loudness) / 20.0))
    return _limit_peak(gained)


def _limit_peak(samples: np.ndarray) -> np.ndarray:
    ceiling = 10 ** (PEAK_CEILING_DBFS / 20.0)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > ceiling and peak > 0:
        return samples * (ceiling / peak)
    return samples


def _write(path: str, samples: np.ndarray, rate: int) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    segment = AudioSegment(
        (pcm * 32767.0).astype(np.int16).tobytes(),
        frame_rate=rate,
        sample_width=2,
        channels=int(pcm.shape[1]),
    )
    segment.export(path, format="wav")
