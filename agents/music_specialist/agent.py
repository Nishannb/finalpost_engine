from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .ffmpeg_cmd import build_ffmpeg_argv
from .models import BGM_DURATION_SEC, MAX_SFX, MIN_SFX_GAP_MS, PROMPT_VERSION, SFX_COST_USD, MusicPayload, SfxEvent
from .postprocess import POSTPROCESS_VERSION, postprocess_bed, write_click_bed
from .prompts import LYRICS, NEGATIVE_PROMPT, cache_key, caption_for, derive_seed, resolve_mood
from .runware import DryRunTransport, bgm_task, classify_sfx, sfx_task
from .spend import append_spend, bgm_cap_cost
from .silence_trimmer import trim_leading_silence
from .timeline import build_schema


class AIMusicSpecialistAgent:
    def __init__(self, transport: Optional[Any] = None) -> None:
        self.transport = transport if transport is not None else DryRunTransport()

    @staticmethod
    def select_cuts(cuts) -> list:
        out: list = []
        for cut in sorted(cuts, key=lambda item: item.at_ms):
            if out and cut.at_ms - out[-1].at_ms < MIN_SFX_GAP_MS:
                continue
            out.append(cut)
            if len(out) == MAX_SFX:
                break
        return out

    def run(self, payload: Dict[str, Any] | MusicPayload, workdir: str, mode: Optional[str] = None) -> Dict[str, Any]:
        raw = payload if isinstance(payload, dict) else {}
        plan = payload if isinstance(payload, MusicPayload) else MusicPayload.from_dict(raw if isinstance(payload, dict) else {})
        mode = mode or (str(raw.get("mode")) if isinstance(payload, dict) and raw.get("mode") else "dry")
        if mode not in ("plan", "dry", "live"):
            raise RuntimeError(f"unknown music mode: {mode}")
        include_sfx = True if not isinstance(payload, dict) else bool(raw.get("include_sfx", True))
        max_usd = float(raw.get("max_usd", 0.02)) if isinstance(payload, dict) else 0.02
        spec = resolve_mood(plan.emotional_tone)
        video_id = str(raw.get("video_id") or "") if isinstance(payload, dict) else ""
        if isinstance(payload, dict) and raw.get("seed") is not None:
            seed = int(raw["seed"])
        else:
            seed = derive_seed(video_id, spec.name, PROMPT_VERSION)
        if mode == "live" and not video_id:
            raise RuntimeError("live mode needs a stable video_id (seed is derived from it)")
        caption = caption_for(spec)
        key = cache_key(spec, seed)
        cuts = self.select_cuts(plan.visual_cuts) if include_sfx else []
        estimate = round(bgm_cap_cost() + len(cuts) * SFX_COST_USD, 6)
        base = {
            "cache_key": key,
            "seed": seed,
            "bpm": spec.bpm,
            "key": spec.key,
            "mood": spec.name,
            "caption": caption,
            "negative_prompt": NEGATIVE_PROMPT,
            "lyrics": LYRICS,
            "prompt_version": PROMPT_VERSION,
            "postprocess_version": POSTPROCESS_VERSION,
            "estimated_cost_usd": estimate,
        }
        if mode == "plan":
            return {**base, "mode": "plan", "cost_usd": 0}
        if estimate > max_usd:
            raise RuntimeError(f"music cost cap exceeded ({estimate} > {max_usd})")

        os.makedirs(workdir, exist_ok=True)
        live = mode == "live"
        if live and not getattr(self.transport, "live", False):
            raise RuntimeError("live mode requires a live Runware transport")
        raw_path = os.path.join(workdir, "bgm_raw.wav")
        if live:
            url = self.transport.post(bgm_task(caption, seed=seed, bpm=spec.bpm, key_scale=spec.key), "bgm")
            append_spend(video_id=video_id, cache_key=key, seed=seed,
                         cost=getattr(self.transport, "last_cost", None), duration_sec=BGM_DURATION_SEC)
            self.transport.download(url, raw_path)
        else:
            write_click_bed(raw_path, spec.bpm)
        bed_path = os.path.join(workdir, "bed.wav")
        metrics = postprocess_bed(raw_path, bed_path)

        events: List[SfxEvent] = []
        for index, cut in enumerate(cuts):
            kind, model = classify_sfx(cut.kind)
            task = sfx_task(kind, model)
            sid = f"sfx{index}"
            path = f"dry-run://sfx/{sid}"
            if live:
                url = self.transport.post(task, sid)
                append_spend(video_id=video_id, cache_key=key, seed=seed, label="sfx",
                             cost=getattr(self.transport, "last_cost", None), duration_sec=2)
                downloaded = self.transport.download(url, os.path.join(workdir, f"{sid}_raw.mp3"))
                path = os.path.join(workdir, f"{sid}.wav")
                trim_leading_silence(downloaded, path)
            events.append(SfxEvent(sid, model, kind, cut.at_ms, task["positivePrompt"], path))

        measured = float(getattr(self.transport, "last_cost", 0.0) or 0.0)
        argv = build_ffmpeg_argv(
            os.path.join(workdir, "dialogue.wav"), bed_path, events,
            min(plan.canvas_sec, 180.0), os.path.join(workdir, "mixed.wav"),
        )
        schema = build_schema(plan.transcript_segments, plan.canvas_sec, caption, events, argv, bed_path)
        schema["cost_breakdown"] = schema.pop("cost_usd")
        schema.update(base)
        schema.update(metrics)
        schema["mode"] = mode
        schema["cost_usd"] = measured
        return schema
