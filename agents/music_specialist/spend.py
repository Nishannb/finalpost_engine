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


class SpendLogError(RuntimeError):
    """The spend log could not be written. Raised BEFORE a paid request (nothing was spent), reported (not raised) after one."""


def spend_log_writable() -> tuple[bool, Optional[str]]:
    """Cheap pre-flight for the server: can a line be appended? Does not create or modify the file (os.access only)."""
    path = spend_log_path()
    target = path if path.exists() else path.parent
    while not target.exists() and target != target.parent:
        target = target.parent
    try:
        return (True, None) if os.access(target, os.W_OK) else (False, "not_writable")
    except OSError as exc:
        return False, type(exc).__name__


def append_spend(*, video_id: str, cache_key: str, seed: int, cost: Optional[float], duration_sec: float,
                 label: str = "bgm", state: str = "paid") -> None:
    """Durably appends one line (O_APPEND, then fsync). `state` separates the lifecycle of one paid request:
    requested (written BEFORE the provider is called), paid (the provider answered; carries the cost), downloaded (the bed file is on disk),
    download_failed / post_failed (the request was made, no usable bed). Sum cost over state=paid lines only. Raises SpendLogError on any I/O failure."""
    line = " ".join([
        datetime.now(timezone.utc).isoformat(timespec="seconds"),
        f"video={video_id or '-'}",
        f"label={label}",
        f"state={state}",
        f"cache_key={cache_key}",
        f"seed={int(seed)}",
        f"includeCost={'' if cost is None else cost}",
        f"duration={duration_sec}",
    ])
    path = spend_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o640)
        try:
            os.write(fd, (line + "\n").encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError as exc:
        raise SpendLogError(f"spend log append failed ({type(exc).__name__})") from exc


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
