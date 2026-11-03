import json
import re

from music_specialist.prompts import CONTENT_MOOD_MAP_PATH, MOODS, resolve_mood

ROOT = CONTENT_MOOD_MAP_PATH.parents[4]
SRC = (ROOT / "server" / "src" / "stages" / "contentProfile" / "contentProfile.ts").read_text()


def visual_moods():
    block = re.search(r"VISUAL_MOODS = \[(.*?)\] as const", SRC, re.S).group(1)
    return re.findall(r"'([a-z_]+)'", block)


def test_every_visual_mood_is_mapped():
    data = json.loads(CONTENT_MOOD_MAP_PATH.read_text())
    moods = visual_moods()
    assert len(moods) == 8
    for m in moods:
        assert m in data and data[m] in MOODS


def test_tech_sharp_is_high_energy():
    assert resolve_mood("tech_sharp").name == "high-energy"


def test_keyword_buckets_and_unmapped(caplog):
    assert resolve_mood("hype").name == "high-energy"
    with caplog.at_level("WARNING"):
        assert resolve_mood("neutral talking-head").name == "neutral"
        assert "mood_unmapped" not in caplog.text
        assert resolve_mood("zzz").name == "neutral"
        assert "mood_unmapped" in caplog.text
