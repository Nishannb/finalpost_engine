"""Bed post: trim, −16 LUFS, peak ceiling, 40 ms equal-power loop seam."""

from __future__ import annotations

import os
import shutil

import numpy as np
import pyloudnorm as pyln
from pydub import AudioSegment

from .silence_trimmer import trim_segment

POSTPROCESS_VERSION = 2
TARGET_LUFS = -16.0
PEAK_CEILING_DBFS = -1.5
SEAM_MS = 40.0
RATE = 48000
ANALYSIS_RATE = 22050
HOP = 512
BEATS_PER_BAR = 4
SKIP_BARS = 2
ZERO_CROSS_MS = 15.0
DRUM_FADE_MS = 10.0
SOFT_FADE_MS = 30.0
# Mean librosa onset_strength over the loop region (22.05 kHz, hop 512) at or above this
# counts as drum-led. Empirical starting point; tune against real beds.
DRUM_ONSET_DENSITY = 1.5
HIGHPASS_HZ = 200.0
CARVE_HZ = 3000.0
CARVE_BW_HZ = 2000.0
CARVE_DB = -3.0


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


def carve_for_voice(samples: np.ndarray, rate: int) -> np.ndarray:
    """VO-carved twin: 4th-order high-pass at 200 Hz, then a -3 dB bell at 3 kHz (2 kHz wide, Q 1.5).

    Local scipy only. The bell is the RBJ peaking biquad.
    """
    from scipy import signal

    hp = signal.butter(4, HIGHPASS_HZ, btype="highpass", fs=rate, output="sos")
    a_gain = 10 ** (CARVE_DB / 40.0)
    w0 = 2 * np.pi * CARVE_HZ / rate
    alpha = np.sin(w0) / (2 * (CARVE_HZ / CARVE_BW_HZ))
    cosw = np.cos(w0)
    b = np.array([1 + alpha * a_gain, -2 * cosw, 1 - alpha * a_gain])
    a = np.array([1 + alpha / a_gain, -2 * cosw, 1 - alpha / a_gain])
    bell = signal.tf2sos(b / a[0], a / a[0])
    out = signal.sosfilt(bell, signal.sosfilt(hp, samples, axis=0), axis=0)
    return np.clip(out, -1.0, 1.0)


def _measure_beats(samples: np.ndarray, rate: int):
    """Return (bpm, beat_frames, onset_env) or None when no usable beat grid is found."""
    import librosa

    mono = samples.mean(axis=1)
    y = librosa.resample(mono, orig_sr=rate, target_sr=ANALYSIS_RATE)
    env = librosa.onset.onset_strength(y=y, sr=ANALYSIS_RATE, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=env, sr=ANALYSIS_RATE, hop_length=HOP)
    bpm = float(np.atleast_1d(tempo)[0])
    frames = np.asarray(frames, dtype=int)
    if not np.isfinite(bpm) or bpm <= 0 or frames.size < BEATS_PER_BAR * 2:
        return None
    return bpm, frames, env


def _downbeat_frames(beat_frames: np.ndarray, env: np.ndarray) -> np.ndarray:
    """4/4 assumed: the beat phase (0-3) with the strongest summed onset is the downbeat."""
    strength = env[np.clip(beat_frames, 0, len(env) - 1)]
    phase = int(np.argmax([strength[k::BEATS_PER_BAR].sum() for k in range(BEATS_PER_BAR)]))
    return beat_frames[phase::BEATS_PER_BAR]


def _snap_zero_crossing(samples: np.ndarray, index: int, rate: int) -> int:
    """Nearest index within ±15 ms where both channels cross zero between i and i+1."""
    radius = int(rate * ZERO_CROSS_MS / 1000.0)
    lo = max(0, index - radius)
    hi = min(samples.shape[0] - 1, index + radius)
    if hi <= lo:
        return index
    window = samples[lo : hi + 1]
    crossing = np.all(window[:-1] * window[1:] <= 0.0, axis=1)
    candidates = np.nonzero(crossing)[0] + lo + 1
    if candidates.size == 0:
        return index
    return int(candidates[np.argmin(np.abs(candidates - index))])


def _bar_loop(samples: np.ndarray, rate: int, downbeats: np.ndarray, env: np.ndarray):
    """Cut a bar-aligned loop body. Returns (body, start_sec, end_sec, bars, drum_led) or None."""
    n_bars = len(downbeats) - 1
    if n_bars >= 20:
        bars = 16
    elif n_bars >= 8 + 2 * SKIP_BARS:
        bars = 8
    elif n_bars >= 4 + 2 * SKIP_BARS:
        bars = 4
    else:
        return None
    first = SKIP_BARS
    times = downbeats * HOP / ANALYSIS_RATE
    start = _snap_zero_crossing(samples, int(round(times[first] * rate)), rate)
    end = _snap_zero_crossing(samples, int(round(times[first + bars] * rate)), rate)
    region = env[downbeats[first] : downbeats[first + bars]]
    drum_led = bool(region.size and float(region.mean()) >= DRUM_ONSET_DENSITY)
    fade = int(rate * (DRUM_FADE_MS if drum_led else SOFT_FADE_MS) / 1000.0)
    body = samples[start:end].copy()
    if fade < 2 or body.shape[0] <= fade * 2 or end + fade > samples.shape[0]:
        return None
    # Equal-power: the head fades in against the audio that follows the cut, so
    # end -> start is continuous when the body repeats.
    t = np.linspace(0.0, 1.0, fade, endpoint=False)[:, None]
    body[:fade] = body[:fade] * np.sin(t * np.pi / 2.0) + samples[end : end + fade] * np.cos(t * np.pi / 2.0)
    return body, start / rate, end / rate, bars, drum_led


def postprocess_bed(src_path: str, dest_path: str) -> dict:
    segment = AudioSegment.from_file(src_path)
    segment, _trimmed = trim_segment(segment)
    if len(segment) < 400:
        raise RuntimeError("bed is empty after silence trim")
    segment = segment.set_frame_rate(RATE).set_channels(2).set_sample_width(2)
    peak = float(1 << 15)
    samples = np.array(segment.get_array_of_samples(), dtype=np.float64).reshape(-1, 2) / peak
    samples = _normalize(samples, RATE)
    beats = _measure_beats(samples, RATE)
    loop = None
    downbeat_times: list = []
    measured_bpm = None
    if beats is not None:
        measured_bpm, frames, env = beats
        downbeats = _downbeat_frames(frames, env)
        downbeat_times = [round(float(f) * HOP / ANALYSIS_RATE, 3) for f in downbeats]
        loop = _bar_loop(samples, RATE, downbeats, env)
    if loop is not None:
        full = _limit_peak(samples)
        body, loop_start, loop_end, bars, drum_led = loop
        loop_audio = _limit_peak(body)
    else:
        # No usable bar grid: previous behaviour (40 ms seam), loop = full.
        full = _limit_peak(loop_seam(samples, RATE, SEAM_MS))
        loop_audio = full
        loop_start, loop_end, bars, drum_led = 0.0, full.shape[0] / RATE, 0, False
    out_dir = os.path.dirname(dest_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    full_path = os.path.join(out_dir, "bed_full.wav")
    loop_path = os.path.join(out_dir, "bed_loop.wav")
    _write(full_path, full, RATE)
    _write(loop_path, loop_audio, RATE)
    carved_path = os.path.join(out_dir, "bed_carved.wav")
    _write(carved_path, carve_for_voice(full, RATE), RATE)
    shutil.copyfile(full_path, dest_path)
    loudness = float(pyln.Meter(RATE).integrated_loudness(full))
    return {
        "bed_path": dest_path,
        "bed_full_path": full_path,
        "bed_loop_path": loop_path,
        "bed_carved_path": carved_path,
        "integrated_lufs": round(loudness, 3),
        "duration_sec": round(full.shape[0] / RATE, 3),
        "loop_duration_sec": round(loop_audio.shape[0] / RATE, 3),
        "loop_start_sec": round(loop_start, 3),
        "loop_end_sec": round(loop_end, 3),
        "loop_bars": bars,
        "loop_drum_led": drum_led,
        "loop_fallback": loop is None,
        "measured_bpm": round(measured_bpm, 2) if measured_bpm else None,
        "downbeat_times": downbeat_times,
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
