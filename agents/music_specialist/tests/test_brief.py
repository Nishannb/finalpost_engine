"""Personalised music: styles, arcs and the cache key all come from briefRules.json (the file the server reads too)."""

from __future__ import annotations

import json
import re

import pytest

from music_specialist.agent import AIMusicSpecialistAgent
from music_specialist.models import PROMPT_VERSION
from music_specialist.prompts import (
    BRIEF_RULES_PATH, MAX_CAPTION_TAGS, MOODS, brief_rules, cache_key, caption_for, derive_seed, lyrics_for_arc, spec_for_brief,
)
from music_specialist.runware import bgm_task

FORBIDDEN = re.compile(r"\b(lead|solo|vocal|vocals|singing|choir|rap|arpeggio)\b", re.I)


def _brief(**over):
    base = {"style": "upbeat-pop", "bpm": 112, "key": "G major", "arc": "build"}
    base.update(over)
    return base


def test_prompt_version_is_4():
    assert PROMPT_VERSION == 4


def test_rules_file_is_the_one_the_server_reads():
    assert BRIEF_RULES_PATH.as_posix().endswith("server/src/stages/music/briefRules.json")
    rules = json.loads(BRIEF_RULES_PATH.read_text(encoding="utf-8"))
    assert len(rules["styles"]) == 10
    assert set(rules["families"]) == set(MOODS)  # the 5 legacy families stay the pool fallbacks


@pytest.mark.parametrize("style", sorted(brief_rules()["styles"]))
def test_every_style_is_voice_first_and_within_the_tag_budget(style):
    rule = brief_rules()["styles"][style]
    spec = spec_for_brief(_brief(style=style, bpm=rule["bpmRange"][0]))
    tags = caption_for(spec).split(", ")
    assert len(tags) <= MAX_CAPTION_TAGS == 12
    assert "no lead melody" in tags and "no vocals" in tags and "background underscore" in tags
    assert not FORBIDDEN.search(", ".join(t for t in tags if t != "no lead melody" and t != "no vocals"))
    assert spec.pool_family == rule["family"]
    assert rule["bpmRange"][0] % 4 == 0 and rule["bpmRange"][1] % 4 == 0


def test_unknown_style_returns_none_so_the_caller_falls_back_to_the_family_mood():
    assert spec_for_brief({"style": "nope"}) is None
    assert spec_for_brief({}) is None


def test_bpm_is_clamped_to_the_style_range_and_snapped_to_4():
    lo, hi = brief_rules()["styles"]["upbeat-pop"]["bpmRange"]
    assert spec_for_brief(_brief(bpm=40)).bpm == lo
    assert spec_for_brief(_brief(bpm=999)).bpm == hi
    assert spec_for_brief(_brief(bpm=111)).bpm == 112
    assert spec_for_brief(_brief(bpm="x")).bpm % 4 == 0


def test_arc_lyrics_are_the_section_tags_and_at_least_10_chars():
    assert lyrics_for_arc("hook-then-steady") == "[intro]\n\n[drop]\n\n[inst]"
    assert lyrics_for_arc("build") == "[intro]\n\n[build-up]\n\n[drop]\n\n[inst]"
    assert lyrics_for_arc("steady") == "[intro]\n\n[inst]\n\n[inst]"
    assert lyrics_for_arc(None) == lyrics_for_arc("nonsense")  # legacy value
    for arc in ("hook-then-steady", "build", "steady", None):
        assert len(lyrics_for_arc(arc)) >= 10
    task = bgm_task("p", seed=1, bpm=112, key_scale="G major", lyrics=lyrics_for_arc("build"))
    assert task["settings"]["lyrics"] == "[intro]\n\n[build-up]\n\n[drop]\n\n[inst]"
    assert bgm_task("p", seed=1, bpm=112, key_scale="G major")["settings"]["lyrics"] == lyrics_for_arc(None)


def test_cache_key_changes_with_style_bpm_key_arc_and_seed_but_not_with_anything_else():
    seed = derive_seed("vid", "upbeat-pop", PROMPT_VERSION)
    base = spec_for_brief(_brief())
    k = cache_key(base, seed, "build")
    assert cache_key(base, seed, "build") == k  # re-rendering the same video is a cache hit
    assert cache_key(spec_for_brief(_brief(style="driving-electronic", bpm=116)), seed, "build") != k
    assert cache_key(spec_for_brief(_brief(bpm=116)), seed, "build") != k
    assert cache_key(spec_for_brief(_brief(key="D major")), seed, "build") != k
    assert cache_key(base, seed, "steady") != k
    assert cache_key(base, seed + 1, "build") != k
    assert derive_seed("vid", "upbeat-pop", 4) == derive_seed("vid", "upbeat-pop", 4)
    assert derive_seed("vid-a", "upbeat-pop", 4) != derive_seed("vid-b", "upbeat-pop", 4)


def test_plan_with_a_brief_uses_its_style_tempo_key_and_arc(tmp_path):
    out = AIMusicSpecialistAgent().run(
        {"video_id": "v1", "emotional_tone": "calm", "canvas_sec": 20, "transcript_segments": [], "visual_cuts": [],
         "brief": _brief(style="lofi-chill", bpm=76, key="D minor", arc="hook-then-steady")},
        str(tmp_path), "plan",
    )
    assert (out["mood"], out["style"], out["family"], out["arc"]) == ("lofi-chill", "lofi-chill", "calm", "hook-then-steady")
    assert (out["bpm"], out["key"]) == (76, "D minor")
    assert out["lyrics"] == "[intro]\n\n[drop]\n\n[inst]"
    assert "lo-fi hip hop" in out["caption"] and "76 bpm" in out["caption"]
    assert out["prompt_version"] == 4


def test_plan_without_a_brief_is_the_family_mood_as_before(tmp_path):
    out = AIMusicSpecialistAgent().run(
        {"video_id": "v1", "emotional_tone": "calm", "canvas_sec": 20, "transcript_segments": [], "visual_cuts": []}, str(tmp_path), "plan",
    )
    assert (out["mood"], out["family"], out["style"], out["arc"]) == ("calm", "calm", None, None)
    assert out["bpm"] == MOODS["calm"].bpm
    assert out["lyrics"] == lyrics_for_arc(None)


def test_unknown_style_in_a_brief_falls_back_to_the_family_mood(tmp_path):
    out = AIMusicSpecialistAgent().run(
        {"video_id": "v1", "emotional_tone": "tense", "canvas_sec": 20, "transcript_segments": [], "visual_cuts": [], "brief": {"style": "nope", "bpm": 100}},
        str(tmp_path), "plan",
    )
    assert out["mood"] == "tense" and out["arc"] is None
