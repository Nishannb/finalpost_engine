"""Check a rendered bed-only stem (MusicMixProbe, no ducking) against the placement that was asked for. Offline.

  python -m music_specialist.scripts.probe_check <stem.wav> <plan.json> <beat_sec>

plan.json is the proof's plan.json. Prints JSON: the first beat time (the offset should land a downbeat on frame 0), the measured lift time on the video
(compare with placement.liftAtVideoSec) and whether the music is silent after endSec.
"""

from __future__ import annotations

import json
import sys

import numpy as np

from music_specialist.vo_lufs import read_audio


def analyze(samples: np.ndarray, rate: int, placement: dict, beat_sec: float) -> dict:
    mono = samples.mean(axis=1) if samples.ndim > 1 else samples
    win = int(0.05 * rate)
    rms = np.array([np.sqrt(np.mean(mono[i:i + win] ** 2)) for i in range(0, len(mono) - win, win)])
    times = np.arange(len(rms)) * 0.05
    # first beat: the first window whose rms is well above the pad (a click or kick starts a beat)
    pad = float(np.median(rms[: max(5, int(1.0 / 0.05))]))
    first_beat = float(times[np.argmax(rms > max(pad * 2.5, 0.01))])
    # lift: first time the 0.5 s moving rms goes past halfway between the early and late levels
    smooth = np.convolve(rms, np.ones(10) / 10, mode="same")
    end_sec = float(placement["endSec"])
    body = smooth[(times > 0.3) & (times < end_sec - 0.6)]
    lo, hi = float(np.percentile(body, 10)), float(np.percentile(body, 90))
    above = np.nonzero((smooth > (lo + hi) / 2) & (times > 0.3))[0]
    lift = float(times[above[0]]) if above.size else None
    after = mono[int(min(len(mono) - 1, (end_sec + 0.05) * rate)):]
    before = mono[int(max(0, (end_sec - 0.6) * rate)): int(max(1, (end_sec - 0.25) * rate))]
    return {
        "first_beat_sec": round(first_beat, 3),
        "lift_on_video_sec": round(lift, 3) if lift is not None else None,
        "expected_lift_sec": placement.get("liftAtVideoSec"),
        "silent_after_end": bool(after.size == 0 or float(np.max(np.abs(after))) < 0.003),
        "audible_before_end": bool(before.size and float(np.max(np.abs(before))) > 0.003),
        "duration_sec": round(len(mono) / rate, 3),
    }


def main() -> None:
    samples, rate = read_audio(sys.argv[1])
    plan = json.load(open(sys.argv[2]))
    json.dump(analyze(samples, rate, plan["placement"], float(sys.argv[3])), sys.stdout)


if __name__ == "__main__":
    main()
