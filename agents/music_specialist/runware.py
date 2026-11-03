from __future__ import annotations

import json
import os
import time
import urllib.request
import uuid
from typing import Any, Callable, Dict, Optional

from .models import BGM_CFG, BGM_DURATION_SEC, BGM_MODEL, BGM_STEPS, MODEL_MIRELO, MODEL_SEED
from .prompts import LYRICS, NEGATIVE_PROMPT, TIME_SIGNATURE

ENDPOINT = "https://api.runware.ai/v1"

_AMBIENT = ("ambien", "environment", "foley", "vocal texture", "bed", "room tone", "atmos")
_DEFAULT_PROMPTS = {
    "whoosh": "short UI whoosh, no music, no vocals",
    "pop": "short UI pop click, no music, no vocals",
    "ambience": "subtle room ambience bed, no music, no vocals",
}


def bgm_task(prompt: str, *, seed: int, bpm: int, key_scale: str) -> Dict[str, Any]:
    if BGM_CFG <= 1:
        raise RuntimeError("negativePrompt requires CFGScale > 1")
    return {
        "taskType": "audioInference",
        "taskUUID": str(uuid.uuid4()),
        "model": BGM_MODEL,
        "positivePrompt": prompt,
        "negativePrompt": NEGATIVE_PROMPT,
        "duration": BGM_DURATION_SEC,
        "steps": BGM_STEPS,
        "CFGScale": BGM_CFG,
        "seed": int(seed),
        "outputFormat": "WAV",
        "outputType": "URL",
        "includeCost": True,
        "numberResults": 1,
        "deliveryMethod": "sync",
        "settings": {
            "bpm": int(bpm),
            "keyScale": key_scale,
            "timeSignature": TIME_SIGNATURE,
            "vocalLanguage": "unknown",
            "lyrics": LYRICS,
        },
    }


def classify_sfx(hint: str) -> tuple[str, str]:
    """Return (kind, model). Generic cuts are a short whoosh on mirelo."""
    h = (hint or "").lower()
    if any(k in h for k in _AMBIENT):
        return "ambience", MODEL_SEED
    if "pop" in h or "click" in h or "ui" in h.split() or "text" in h:
        return "pop", MODEL_MIRELO
    return "whoosh", MODEL_MIRELO


def sfx_task(kind: str, model: str) -> Dict[str, Any]:
    return {
        "taskType": "audioInference",
        "taskUUID": str(uuid.uuid4()),
        "model": model,
        "positivePrompt": _DEFAULT_PROMPTS.get(kind, _DEFAULT_PROMPTS["whoosh"]),
        "duration": 2,
        "outputType": "URL",
        "deliveryMethod": "sync",
    }


class DryRunTransport:
    """No network. The agent writes a synthetic WAV itself."""

    live = False

    def __init__(self) -> None:
        self.posts: list = []
        self.last_cost: Optional[float] = 0.0

    def post(self, task: Dict[str, Any], label: str) -> str:
        return "dry-run://bgm" if label == "bgm" else f"dry-run://sfx/{label}"

    def download(self, url: str, dest: str) -> str:
        return dest


class RunwareTransport:
    live = True

    def __init__(self, api_key: Optional[str] = None, opener: Optional[Callable] = None,
                 timeout_sec: float = 120.0) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get("RUNWARE_API_KEY", "")
        self._open = opener or urllib.request.urlopen
        self.timeout_sec = timeout_sec
        self.posts: list = []
        self.last_cost: Optional[float] = None

    def post(self, task: Dict[str, Any], label: str) -> str:
        del label
        if not self.api_key:
            raise RuntimeError("RUNWARE_API_KEY is not set")
        self.posts.append(task)
        item = self._item(self._request([task]))
        deadline = time.time() + self.timeout_sec
        delay = 1.5
        while item.get("status") == "processing" and not (item.get("audioURL") or item.get("audioUrl")):
            if time.time() >= deadline:
                raise RuntimeError("Runware audio task still processing at timeout")
            time.sleep(delay)
            delay = min(delay * 1.5, 8.0)
            item = self._item(self._request([{"taskType": "getResponse", "taskUUID": task["taskUUID"]}]))
        url = item.get("audioURL") or item.get("audioUrl")
        if not url:
            raise RuntimeError("Runware response had no audioURL")
        cost = item.get("cost")
        try:
            self.last_cost = float(cost) if cost is not None else self.last_cost
        except (TypeError, ValueError):
            pass
        return url

    def download(self, url: str, dest: str) -> str:
        with self._open(url, timeout=self.timeout_sec) as response, open(dest, "wb") as handle:
            handle.write(response.read())
        return dest

    def _request(self, tasks: list) -> Dict[str, Any]:
        req = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(tasks).encode(),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with self._open(req, timeout=min(self.timeout_sec, 120.0)) as response:
            body = json.loads(response.read().decode())
        if not isinstance(body, dict):
            raise RuntimeError("Runware response was not an object")
        return body

    @staticmethod
    def _item(body: Dict[str, Any]) -> Dict[str, Any]:
        errors = body.get("errors") or []
        if errors and not body.get("data"):
            code = errors[0].get("code") if isinstance(errors[0], dict) else "unknown"
            raise RuntimeError(f"Runware audioInference failed ({code})")
        data = body.get("data") or []
        if not data:
            raise RuntimeError("Runware response had no data")
        item = data[0]
        if item.get("status") == "error":
            raise RuntimeError("Runware audioInference failed (error)")
        return item
