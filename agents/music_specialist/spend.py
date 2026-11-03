"""Append-only spend log for real Runware calls. Never contains the API key."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import BGM_COST_USD


def spend_log_path() -> Path:
    override = os.environ.get("MUSIC_SPEND_LOG")
    return Path(override) if override else Path(__file__).resolve().parent / "spend.log"


def append_spend(*, video_id: str, cache_key: str, seed: int, cost: Optional[float], duration_sec: float,
                 label: str = "bgm") -> None:
    line = " ".join([
        datetime.now(timezone.utc).isoformat(timespec="seconds"),
        f"video={video_id or '-'}",
        f"label={label}",
        f"cache_key={cache_key}",
        f"seed={int(seed)}",
        f"includeCost={'' if cost is None else cost}",
        f"duration={duration_sec}",
    ])
    path = spend_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def last_logged_cost(label: str = "bgm") -> float:
    """Most recent bgm includeCost in the log, or 0.0 when there is none."""
    path = spend_log_path()
    if not path.exists():
        return 0.0
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        fields = dict(part.split("=", 1) for part in line.split() if "=" in part)
        if fields.get("label") != label:
            continue
        try:
            return float(fields["includeCost"])
        except (KeyError, ValueError):
            continue
    return 0.0


def bgm_cap_cost() -> float:
    return max(BGM_COST_USD, last_logged_cost("bgm"))
