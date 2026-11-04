"""Synthetic bed with a KNOWN lift, for the offline personalisation proof. Local only; never touches Runware.

  python -m music_specialist.scripts.proof_bed --bpm 128 --lift-bar 6 --bars 30 --out-dir /path/to/dir

A quiet pad with soft beat clicks for `lift-bar` bars, then a loud tone with a kick on every beat. The raw file is run through the real
postprocess (so bed_full.wav, bed_loop.wav, bed_carved.wav and the measured downbeats / energy map / lift all come from the production code)
and the postprocess result is printed as JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import wave

import numpy as np

from music_specialist.postprocess import RATE, postprocess_bed


def synthetic_raw(bpm: int, lift_bar: int, bars: int) -> np.ndarray:
    bar_sec = 4 * 60.0 / bpm
    beat = 60.0 / bpm
    n = int(bars * bar_sec * RATE)
    t = np.arange(n) / RATE
    out = 0.02 * np.sin(2 * np.pi * 220 * t)
    lift_t = lift_bar * bar_sec
    click_n = int(0.03 * RATE)
    click = np.sin(2 * np.pi * 1000 * np.arange(click_n) / RATE) * np.linspace(1, 0, click_n)
    for k in range(int(bars * 4)):
        start = k * beat
        i = int(start * RATE)
        if i >= n:
            break
        amp = 0.9 if start >= lift_t else 0.6
        m = min(click_n, n - i)
        out[i:i + m] += amp * click[:m]
    loud = t >= lift_t
    out[loud] += 0.25 * np.sin(2 * np.pi * 330 * t[loud])
    return out


def write_wav(path: str, mono: np.ndarray) -> None:
    pcm = (np.clip(np.stack([mono, mono], axis=1), -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bpm", type=int, required=True)
    parser.add_argument("--lift-bar", type=int, required=True)
    parser.add_argument("--bars", type=int, required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    raw = os.path.join(args.out_dir, "raw.wav")
    write_wav(raw, synthetic_raw(args.bpm, args.lift_bar, args.bars))
    result = postprocess_bed(raw, os.path.join(args.out_dir, "bed.wav"))
    os.remove(raw)
    json.dump(result, open(os.path.join(args.out_dir, "meta.json"), "w"))
    print(json.dumps({k: v for k, v in result.items() if k not in ("downbeat_times", "energy_map")}))


if __name__ == "__main__":
    main()
