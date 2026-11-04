from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from dataclasses import dataclass

from .models import BGM_CFG, BGM_DURATION_SEC, BGM_MODEL, BGM_STEPS, PROMPT_VERSION

POSTPROCESS_VERSION = 1
LYRICS = "[intro]\n\n[inst]\n\n[inst]"
NEGATIVE_PROMPT = (
    "vocals, singing, voice, choir, lyrics, spoken word, rap, "
    "fade in, fade out, silence, applause, crowd noise, "
    "lead, solo, busy arpeggio, vocal chops, loud drums"
)
# Voice-first (docs/audio/VOICE_FIRST.md): every caption asks for a supportive underscore.
SUPPORT_TAGS = (
    "background underscore", "minimal", "sparse arrangement", "no lead melody", "supportive",
)
MAX_CAPTION_TAGS = 12
TIME_SIGNATURE = 4


@dataclass(frozen=True)
class MoodSpec:
    name: str
    genre: str
    mood_words: tuple[str, ...]
    instruments: tuple[str, ...]
    production: tuple[str, ...]
    bpm: int
    key: str


MOODS: dict[str, MoodSpec] = {
    "high-energy": MoodSpec(
        "high-energy", "synthwave", ("energetic", "driving"),
        ("analog bass synth", "drum machine"),
        ("hi-fi", "wide stereo"), 120, "A minor",
    ),
    "nostalgic": MoodSpec(
        "nostalgic", "lo-fi hip hop", ("warm", "nostalgic"),
        ("rhodes piano", "muted electric guitar"),
        ("warm analog", "tape saturation"), 84, "D major",
    ),
    "calm": MoodSpec(
        "calm", "ambient", ("calm", "soft"),
        ("felt piano", "soft synth pad"),
        ("hi-fi", "wide stereo"), 64, "C major",
    ),
    "tense": MoodSpec(
        "tense", "cinematic electronic", ("tense", "dark"),
        ("low string section", "synth pulse"),
        ("hi-fi", "dry mix"), 96, "D minor",
    ),
    "neutral": MoodSpec(
        "neutral", "light pop", ("neutral", "steady"),
        ("electric piano", "soft drum kit"),
        ("hi-fi", "clean mix"), 96, "G major",
    ),
}

_BUCKETS = (
    (("high-energy", "energetic", "hype", "upbeat"), "high-energy"),
    (("nostalgic", "warm", "sentimental"), "nostalgic"),
    (("calm", "relax", "chill", "soft"), "calm"),
    (("tense", "dark", "suspense", "dramatic"), "tense"),
    (("neutral",), "neutral"),
)


_log = logging.getLogger("music_specialist")
CONTENT_MOOD_MAP_PATH = (
    Path(__file__).resolve().parents[2] / "server" / "src" / "stages" / "music" / "contentMoodMap.json"
)
_content_mood_map: dict[str, str] | None = None


def content_mood_map() -> dict[str, str]:
    """VisualMood -> music mood, shared with server/src/stages/music/flags.ts."""
    global _content_mood_map
    if _content_mood_map is None:
        _content_mood_map = json.loads(CONTENT_MOOD_MAP_PATH.read_text(encoding="utf-8"))
    return _content_mood_map


def resolve_mood(tone: str) -> MoodSpec:
    text = (tone or "").strip().lower()
    mapped = content_mood_map().get(text)
    if mapped:
        return MOODS[mapped]
    for keys, name in _BUCKETS:
        if any(key in text for key in keys):
            return MOODS[name]
    if text:
        _log.warning("music.mood_unmapped tone=%r", tone)
    return MOODS["neutral"]


def derive_seed(video_id: str, mood_name: str, prompt_version: int = PROMPT_VERSION) -> int:
    """Stable Runware seed (0..2147483647) for one video + mood + prompt version."""
    raw = f"{video_id}|{mood_name}|{int(prompt_version)}".encode()
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big") % 2147483648


def caption_for(spec: MoodSpec) -> str:
    """At most MAX_CAPTION_TAGS tags. Highest priority first; production tags are the first dropped, then "instrumental"."""
    tags = [
        spec.genre, *spec.mood_words, *spec.instruments, *SUPPORT_TAGS,
        "no vocals", f"{spec.bpm} bpm", "instrumental", *spec.production,
    ]
    return ", ".join(tags[:MAX_CAPTION_TAGS])


def build_bgm_prompt(tone: str) -> str:
    return caption_for(resolve_mood(tone))


def cache_material(spec: MoodSpec, seed: int) -> dict:
    return {
        "model": BGM_MODEL,
        "prompt_version": PROMPT_VERSION,
        "caption": caption_for(spec),
        "negative_prompt": NEGATIVE_PROMPT,
        "lyrics": LYRICS,
        "bpm": spec.bpm,
        "key": spec.key,
        "time_signature": TIME_SIGNATURE,
        "steps": BGM_STEPS,
        "cfg": BGM_CFG,
        "seed": int(seed),
        "duration": BGM_DURATION_SEC,
        "postprocess_version": POSTPROCESS_VERSION,
    }


def cache_key(spec: MoodSpec, seed: int) -> str:
    raw = json.dumps(cache_material(spec, seed), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()
