from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

BGM_MODEL = "runware:ace-step@v1.5-base"
BGM_DURATION_SEC = 60
BGM_STEPS = 100
BGM_CFG = 10
# Observed includeCost of the 2026-11-03 smoke (seed 1056912958, ~23 s wall clock, 60 s / 100 steps / WAV).
# It is one run, not a second measurement. Runware's docs estimated $0.0039 for that shape; billing follows compute time.
BGM_COST_USD = 0.0075
PROMPT_VERSION = 4
SFX_COST_USD = 0.0005
MAX_CANVAS_SEC = 180.0
MAX_SFX = 12
MIN_SFX_GAP_MS = 250
MODEL_MIRELO = "mirelo:1@1"
MODEL_SEED = "bytedance:seed-audio@1.0"


@dataclass
class TranscriptSegment:
    text: str
    start_ms: int
    end_ms: int

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TranscriptSegment":
        return cls(str(d.get("text", "")), int(d["start_ms"]), int(d["end_ms"]))

    def to_dict(self) -> Dict[str, Any]:
        return {"text": self.text, "start_ms": self.start_ms, "end_ms": self.end_ms}


@dataclass
class VisualCut:
    at_ms: int
    kind: str = ""  # free-form hint, e.g. "zoom", "ambience"

    @classmethod
    def from_value(cls, v: Any) -> "VisualCut":
        if isinstance(v, (int, float)):
            return cls(int(v))
        return cls(int(v.get("at_ms", v.get("ms", 0))), str(v.get("kind", "")))


@dataclass
class MusicPayload:
    transcript_segments: List[TranscriptSegment] = field(default_factory=list)
    visual_cuts: List[VisualCut] = field(default_factory=list)
    emotional_tone: str = "neutral talking-head"
    canvas_sec: float = 60.0

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "MusicPayload":
        canvas = min(float(d.get("canvas_sec", 60.0)), MAX_CANVAS_SEC)
        return cls(
            [TranscriptSegment.from_dict(s) for s in d.get("transcript_segments") or []],
            [VisualCut.from_value(c) for c in d.get("visual_cuts") or []],
            str(d.get("emotional_tone") or "neutral talking-head"),
            max(canvas, 0.0),
        )


@dataclass
class SfxEvent:
    id: str
    model: str
    kind: str
    anchor_ms: int
    prompt: str
    asset_path: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "model": self.model,
            "kind": self.kind,
            "anchor_ms": self.anchor_ms,
            "delay_ms": self.anchor_ms,  # trimmed asset starts at 0.0s
            "prompt": self.prompt,
            "asset_path": self.asset_path,
        }
