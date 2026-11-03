import os
import subprocess
import sys

import numpy as np
import pytest
import pyloudnorm as pyln

from music_specialist import AIMusicSpecialistAgent
from music_specialist.__main__ import live_allowed
from music_specialist.models import BGM_COST_USD, PROMPT_VERSION
from music_specialist.prompts import cache_key, derive_seed, resolve_mood
from music_specialist.runware import RunwareTransport
from music_specialist.spend import append_spend, bgm_cap_cost
from music_specialist.vo_lufs import TALKING_OFFSETS_LU, duck_gain_db, speech_gated_lufs

RATE = 48000


def test_cost_constant_is_observed_run():
    assert BGM_COST_USD == 0.0075


def test_seed_stable_per_video_mood_and_in_range():
    a = derive_seed("vid-a", "high-energy", PROMPT_VERSION)
    assert a == derive_seed("vid-a", "high-energy", PROMPT_VERSION)
    assert 0 <= a <= 2147483647
    assert a != derive_seed("vid-b", "high-energy", PROMPT_VERSION)
    assert a != derive_seed("vid-a", "calm", PROMPT_VERSION)
    assert a != derive_seed("vid-a", "high-energy", PROMPT_VERSION + 1)


def test_cache_key_follows_video_id(tmp_path):
    agent = AIMusicSpecialistAgent()
    run = lambda vid: agent.run({"video_id": vid, "emotional_tone": "hype", "include_sfx": False}, str(tmp_path), mode="plan")
    assert run("vid-a")["cache_key"] == run("vid-a")["cache_key"]
    assert run("vid-a")["cache_key"] != run("vid-b")["cache_key"]
    assert run("vid-a")["seed"] == derive_seed("vid-a", resolve_mood("hype").name, PROMPT_VERSION)
    spec = resolve_mood("hype")
    assert run("vid-a")["cache_key"] == cache_key(spec, run("vid-a")["seed"])


def test_live_refused_without_pipeline_token():
    assert live_allowed("dry", {}) and live_allowed("plan", {})
    assert not live_allowed("live", {})
    assert not live_allowed("live", {"MUSIC_SPECIALIST_CALLER": "shell"})
    assert live_allowed("live", {"MUSIC_SPECIALIST_CALLER": "pipeline"})


def test_cli_live_exits_nonzero_without_token():
    env = {k: v for k, v in os.environ.items() if k not in ("MUSIC_SPECIALIST_CALLER", "RUNWARE_API_KEY")}
    proc = subprocess.run([sys.executable, "-m", "music_specialist", "--mode", "live"], input="{}",
                          capture_output=True, text=True, env=env, timeout=30)
    assert proc.returncode == 3
    assert "MUSIC_SPECIALIST_CALLER" in proc.stderr


def test_runware_transport_cannot_be_built_in_tests():
    with pytest.raises(RuntimeError):
        RunwareTransport(api_key="x")


def test_cap_uses_max_of_constant_and_last_logged_cost(tmp_path):
    assert bgm_cap_cost() == BGM_COST_USD
    append_spend(video_id="v", cache_key="k", seed=1, cost=0.0123, duration_sec=60)
    assert bgm_cap_cost() == 0.0123
    append_spend(video_id="v", cache_key="k", seed=1, cost=0.001, duration_sec=60)
    assert bgm_cap_cost() == BGM_COST_USD


def _voice(lufs, seconds=6.0):
    rng = np.random.default_rng(3)
    t = np.arange(int(seconds * RATE)) / RATE
    sig = sum(np.sin(2 * np.pi * f * t) for f in (180, 420, 900, 1800)) * (1 + 0.5 * np.sin(2 * np.pi * 4 * t))
    sig = sig + 0.05 * rng.standard_normal(len(t))
    sig = sig / np.max(np.abs(sig)) * 0.5
    return sig * 10 ** ((lufs - pyln.Meter(RATE).integrated_loudness(sig)) / 20)


def _bed(lufs, seconds=6.0):
    t = np.arange(int(seconds * RATE)) / RATE
    sig = 0.3 * np.sin(2 * np.pi * 110 * t) + 0.2 * np.sin(2 * np.pi * 330 * t + 1) + 0.1 * np.sin(2 * np.pi * 1200 * t)
    return sig * 10 ** ((lufs - pyln.Meter(RATE).integrated_loudness(sig)) / 20)


@pytest.mark.parametrize("vo_target", [-16.0, -20.0, -24.0])
def test_bed_sits_under_the_measured_voice(vo_target):
    voice = _voice(vo_target)
    bed = _bed(-16.0)
    meter = pyln.Meter(RATE)
    vo = speech_gated_lufs(voice, RATE, [(0.0, 6.0)])
    assert abs(vo - vo_target) < 0.5
    bed_lufs = float(meter.integrated_loudness(bed))
    for name, want in (("speech", 18.0), ("pause", 9.0)):
        gain = duck_gain_db(vo, bed_lufs, TALKING_OFFSETS_LU[name])
        gained = bed * 10 ** (gain / 20)
        gap = vo - float(meter.integrated_loudness(gained))
        assert abs(gap - want) <= 1.0, (vo_target, name, gap)


def test_gain_clamps():
    assert duck_gain_db(-16, -16, 5) == 0.0
    assert duck_gain_db(-60, -16, -18) == -40.0


def test_gated_measure_ignores_silence():
    voice = _voice(-20.0, 4.0)
    padded = np.concatenate([np.zeros(RATE * 3), voice, np.zeros(RATE * 3)])
    assert abs(speech_gated_lufs(padded, RATE, [(3.0, 7.0)]) - (-20.0)) < 0.5
    assert speech_gated_lufs(padded, RATE, []) is None
