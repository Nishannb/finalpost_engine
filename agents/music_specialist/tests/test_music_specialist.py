from pydub import AudioSegment
from pydub.generators import Sine

from music_specialist import AIMusicSpecialistAgent
from music_specialist.ffmpeg_cmd import build_ffmpeg_argv
from music_specialist.models import SfxEvent, TranscriptSegment
from music_specialist.prompts import build_bgm_prompt
from music_specialist.runware import bgm_task, classify_sfx, sfx_task
from music_specialist.silence_trimmer import trim_segment
from music_specialist.timeline import build_ducking


def test_bgm_payload():
    from music_specialist.prompts import LYRICS, NEGATIVE_PROMPT, resolve_mood

    spec = resolve_mood("high-energy")
    t = bgm_task(build_bgm_prompt("high-energy"), seed=7, bpm=spec.bpm, key_scale=spec.key)
    assert t["model"] == "runware:ace-step@v1.5-base"
    assert t["duration"] == 60 and t["steps"] == 100
    assert t["outputFormat"] == "WAV" and t["CFGScale"] == 10 and t["seed"] == 7
    assert t["negativePrompt"] == NEGATIVE_PROMPT and t["CFGScale"] > 1
    assert len(t["settings"]["lyrics"]) >= 10 and t["settings"]["lyrics"] == LYRICS
    assert "no vocals" in t["positivePrompt"] and "seamless loop" not in t["positivePrompt"]
    tags = build_bgm_prompt("weird unknown").split(", ")
    assert 8 <= len(tags) <= 12


def test_sfx_models():
    assert sfx_task(*classify_sfx("zoom"))["model"] == "mirelo:1@1"
    t = sfx_task(*classify_sfx("room ambience"))
    assert t["model"] == "bytedance:seed-audio@1.0" and "steps" not in t


def test_ducking():
    d = build_ducking([TranscriptSegment("hi", 1000, 2000)], 4)
    assert d == [{"start_ms": 0, "end_ms": 1000, "gain_db": -12},
                 {"start_ms": 1000, "end_ms": 2000, "gain_db": -22},
                 {"start_ms": 2000, "end_ms": 4000, "gain_db": -12}]


def test_argv():
    ev = [SfxEvent("a", "m", "whoosh", 1500, "p", "a.wav")]
    argv = build_ffmpeg_argv("d.wav", "b.mp3", ev, 30, "o.wav")
    assert argv[argv.index("-stream_loop") + 1] == "-1"
    assert any("adelay=1500|1500" in a for a in argv)
    assert any("amix=inputs=3" in a for a in argv)
    assert "-t" in argv


def test_trim():
    seg = AudioSegment.silent(500) + Sine(440).to_audio_segment(300).apply_gain(-3)
    out, ms = trim_segment(seg)
    assert 450 <= ms <= 500 and len(out) < len(seg)
    assert out[:10].max > 0


import json
from pathlib import Path

import numpy as np

from music_specialist.postprocess import loop_seam
from music_specialist.prompts import cache_key, resolve_mood
from music_specialist.runware import DryRunTransport


class Fake(DryRunTransport):
    def __init__(self):
        super().__init__()
        self.network = 0


def test_dry_run():
    fake = Fake()
    schema = AIMusicSpecialistAgent(fake).run(
        {"transcript_segments": [{"text": "x", "start_ms": 0, "end_ms": 500}],
         "visual_cuts": [{"at_ms": 1000, "kind": "zoom"}, {"at_ms": 1100}],
         "canvas_sec": 500}, "/tmp/ms_unused")
    assert fake.network == 0
    assert schema["canvas_sec"] == 180 and schema["layers"]["bgm"]["loop"]["loop_count"] == 3
    assert len(schema["layers"]["sfx"]) == 1
    assert schema["cost_breakdown"]["total"] == 0.008
    assert schema["cost_usd"] == 0
    assert abs(schema["integrated_lufs"] + 16) <= 0.5
    assert AIMusicSpecialistAgent().run({}, "/tmp/ms_unused")["version"] == "1"


def test_cache_key_stable_and_sensitive():
    spec = resolve_mood("calm")
    assert cache_key(spec, 3) == cache_key(spec, 3)
    assert cache_key(spec, 3) != cache_key(spec, 4)
    assert cache_key(spec, 3) != cache_key(resolve_mood("tense"), 3)


def test_seam_jump():
    rate = 48000
    n = rate
    tone = np.sin(2 * np.pi * 110 * np.arange(n) / rate)
    samples = np.stack([tone, tone], axis=1)
    out = loop_seam(samples, rate, 40)
    jump = float(np.max(np.abs(out[0] - out[-1])))
    deltas = np.abs(np.diff(out[:, 0]))
    assert jump <= float(np.median(deltas)) * 3 + 1e-9


def test_plan_fixture():
    schema = AIMusicSpecialistAgent().run(
        {"emotional_tone": "nostalgic storytelling", "canvas_sec": 30,
         "include_sfx": False, "seed": 1},
        "/tmp/ms_plan", mode="plan")
    assert schema["mode"] == "plan" and schema["seed"] == 1
    assert len(schema["lyrics"]) >= 10
    path = Path(__file__).parent / "fixtures" / "music_schema.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(schema, indent=2) + "\n")
