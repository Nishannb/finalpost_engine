from __future__ import annotations

import math
from typing import Any, Dict, List

from .models import (BGM_COST_USD, BGM_DURATION_SEC, BGM_MODEL, MAX_CANVAS_SEC,
                     SFX_COST_USD, SfxEvent, TranscriptSegment)

# Debug export of the legacy brief (−22 under speech, −12 in pauses).
# The renderer uses server/src/stages/music/duckEnvelope.ts, not this map.
SPEECH_DB = -22
GAP_DB = -12
MIN_GAP_MS = 200


def build_ducking(segments: List[TranscriptSegment], canvas_sec: float) -> List[Dict[str, Any]]:
    end = int(round(canvas_sec * 1000))
    wins: List[Dict[str, Any]] = []
    cur = 0
    for s in sorted(segments, key=lambda s: s.start_ms):
        a, b = max(0, s.start_ms), min(end, s.end_ms)
        if b <= a:
            continue
        a = max(a, cur)
        if a - cur >= MIN_GAP_MS:
            wins.append({"start_ms": cur, "end_ms": a, "gain_db": GAP_DB})
        if b > a:
            wins.append({"start_ms": a, "end_ms": b, "gain_db": SPEECH_DB})
        cur = max(cur, b)
    if end - cur >= MIN_GAP_MS or not wins:
        if end > cur:
            wins.append({"start_ms": cur, "end_ms": end, "gain_db": GAP_DB})
    merged: List[Dict[str, Any]] = []
    for w in wins:
        if merged and merged[-1]["gain_db"] == w["gain_db"] and merged[-1]["end_ms"] >= w["start_ms"]:
            merged[-1]["end_ms"] = max(merged[-1]["end_ms"], w["end_ms"])
        else:
            merged.append(dict(w))
    return merged


def build_schema(segments: List[TranscriptSegment], canvas_sec: float, bgm_prompt: str,
                 sfx: List[SfxEvent], ffmpeg_argv: List[str], bgm_path: str = "") -> Dict[str, Any]:
    canvas = min(float(canvas_sec), MAX_CANVAS_SEC)
    sfx_cost = round(len(sfx) * SFX_COST_USD, 6)
    return {
        "version": "1",
        "canvas_sec": canvas,
        "layers": {
            "dialogue": {"preserved": True, "segments": [s.to_dict() for s in segments]},
            "bgm": {
                "model": BGM_MODEL,
                "prompt": bgm_prompt,
                "source_duration_sec": BGM_DURATION_SEC,
                "asset_path": bgm_path,
                "loop": {"stream_loop": -1, "trim_to_sec": canvas,
                         "loop_count": math.ceil(canvas / BGM_DURATION_SEC)},
                "ducking": build_ducking(segments, canvas),
            },
            "sfx": [e.to_dict() for e in sfx],
        },
        "cost_usd": {"bgm": BGM_COST_USD, "sfx": sfx_cost, "total": round(BGM_COST_USD + sfx_cost, 6)},
        "ffmpeg_argv": ffmpeg_argv,
    }
