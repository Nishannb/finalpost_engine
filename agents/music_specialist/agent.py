from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from .ffmpeg_cmd import build_ffmpeg_argv
from .models import BGM_DURATION_SEC, MAX_SFX, MIN_SFX_GAP_MS, PROMPT_VERSION, SFX_COST_USD, MusicPayload, SfxEvent
from .postprocess import POSTPROCESS_VERSION, postprocess_bed, write_click_bed
from .prompts import LYRICS, NEGATIVE_PROMPT, cache_key, caption_for, derive_seed, lyrics_for_arc, resolve_mood, spec_for_brief
from .qc import qc_bed
from .runware import DryRunTransport, bgm_task, classify_sfx, sfx_task
from .spend import SpendLogError, append_spend, bgm_cap_cost, spend_log_writable
from .silence_trimmer import trim_leading_silence
from .timeline import build_schema


_log = logging.getLogger("music_specialist")


def _run_qc(metrics: Dict[str, Any], requested_bpm: float) -> Dict[str, Any]:
    try:
        return qc_bed(bed_full_path=metrics["bed_full_path"], bed_loop_path=metrics["bed_loop_path"],
                      measured_bpm=metrics.get("measured_bpm"), requested_bpm=requested_bpm,
                      loop_fallback=bool(metrics.get("loop_fallback")))
    except Exception as exc:  # QC must never take the process down
        _log.warning("music.qc_error %s", type(exc).__name__)
        return {"silence_sec": None, "true_peak_dbfs": None, "bpm_error_ratio": None, "seam_db": None,
                "vocal_score": None, "passed": False}


class PaidGenerationError(RuntimeError):
    """A paid request was (or may have been) made but no usable bed came back. Carries what the server must record in its durable ledger:
    `stage` is where it failed (post: outcome unknown, the request may or may not have been charged; download: charged, bed lost), `cost` the measured cost when known."""

    def __init__(self, stage: str, cost: Optional[float], message: str, accounting: Dict[str, Any]) -> None:
        super().__init__(message)
        self.stage = stage
        self.cost = cost
        self.accounting = accounting


def qc_retry_allowed(payload: Any) -> bool:
    """Phase 1.7.3: a failed QC may trigger a second paid BGM generation ONLY when the job explicitly opts in with the JSON boolean
    `allow_qc_retry: true`. Missing, false, null, 1, "true" or any other value means no retry. The production server never opts in."""
    return isinstance(payload, dict) and payload.get("allow_qc_retry") is True


class AIMusicSpecialistAgent:
    def __init__(self, transport: Optional[Any] = None) -> None:
        self.transport = transport if transport is not None else DryRunTransport()

    def _paid_bgm_request(self, *, caption: str, seed: int, spec: Any, lyrics: Any, key: str, video_id: str, raw_path: str,
                          accounting: Dict[str, Any]) -> Optional[float]:
        """One paid BGM request with a durable lifecycle record in the spend log.

        1. `requested` is appended (and fsynced) BEFORE the provider is called. If that fails, SpendLogError propagates and NO paid call is made:
           no spend without a durable record.
        2. The paid call. 3. `paid` (with the measured cost). If this append fails the paid bed is NOT discarded: the `requested` line already shows the
           request, the failure is reported in `accounting` (the server writes it to its durable R2 ledger) and logged to stderr (which alone is not durable).
        4. The download, then `downloaded`. A failed download raises PaidGenerationError (the server records a paid request without a bed).
        """
        common = {"video_id": video_id, "cache_key": key, "seed": seed, "duration_sec": BGM_DURATION_SEC}
        append_spend(cost=None, state="requested", **common)
        accounting["requested_logged"] = True
        try:
            url = self.transport.post(bgm_task(caption, seed=seed, bpm=spec.bpm, key_scale=spec.key, lyrics=lyrics), "bgm")
        except Exception as exc:
            self._best_effort_spend(accounting, "post_failed", None, common)
            raise PaidGenerationError("post", None, f"paid request failed before a bed was returned: {type(exc).__name__}", accounting) from exc
        cost = getattr(self.transport, "last_cost", None)
        try:
            append_spend(cost=cost, state="paid", **common)
            accounting["paid_logged"] = True
        except SpendLogError as exc:
            accounting["paid_logged"] = False
            accounting["errors"].append(str(exc))
            _log.error("music.spend_paid_record_failed %s (stderr is not durable; the requested line and the server ledger carry the evidence)", exc)
        try:
            self.transport.download(url, raw_path)
        except Exception as exc:
            self._best_effort_spend(accounting, "download_failed", cost, common)
            raise PaidGenerationError("download", cost, f"paid bed download failed: {type(exc).__name__}", accounting) from exc
        self._best_effort_spend(accounting, "downloaded", cost, common)
        return cost

    @staticmethod
    def _best_effort_spend(accounting: Dict[str, Any], state: str, cost: Optional[float], common: Dict[str, Any]) -> None:
        try:
            append_spend(cost=cost, state=state, **common)
            accounting[f"{state}_logged"] = True
        except SpendLogError as exc:
            accounting[f"{state}_logged"] = False
            accounting["errors"].append(str(exc))
            _log.error("music.spend_%s_record_failed %s", state, exc)

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
        allow_qc_retry = qc_retry_allowed(payload)
        # Personalised: the server sends a brief (style, tempo, key, arc) built from this video. Without one, or with an unknown style, the family mood is used as before.
        brief = raw.get("brief") if isinstance(payload, dict) and isinstance(raw.get("brief"), dict) else None
        spec = spec_for_brief(brief) if brief else None
        arc = (str(brief.get("arc")) if brief and brief.get("arc") else None) if spec else None
        spec = spec or resolve_mood(plan.emotional_tone)
        lyrics = lyrics_for_arc(arc)
        video_id = str(raw.get("video_id") or "") if isinstance(payload, dict) else ""
        if isinstance(payload, dict) and raw.get("seed") is not None:
            seed = int(raw["seed"])
        else:
            seed = derive_seed(video_id, spec.name, PROMPT_VERSION)
        if mode == "live" and not video_id:
            raise RuntimeError("live mode needs a stable video_id (seed is derived from it)")
        caption = caption_for(spec)
        key = cache_key(spec, seed, arc)
        requested_cuts = self.select_cuts(plan.visual_cuts) if include_sfx else []
        # SFX-1: live SFX generation is refused. The server never uses this agent's SFX (only its bed), and the SFX models/prices are not
        # verified, so a live run must not pay for them. Plan and dry runs keep their placeholder SFX (no network, no cost).
        sfx_refused = len(requested_cuts) if mode == "live" else 0
        cuts = [] if mode == "live" else requested_cuts
        estimate = round(bgm_cap_cost() + len(cuts) * SFX_COST_USD, 6)
        base = {
            "cache_key": key,
            "seed": seed,
            "bpm": spec.bpm,
            "key": spec.key,
            "mood": spec.name,
            "style": spec.name if arc is not None else None,
            "family": spec.pool_family,
            "arc": arc,
            "caption": caption,
            "negative_prompt": NEGATIVE_PROMPT,
            "lyrics": lyrics,
            "prompt_version": PROMPT_VERSION,
            "postprocess_version": POSTPROCESS_VERSION,
            "estimated_cost_usd": estimate,
        }
        if mode == "plan":
            writable, why = spend_log_writable()
            return {**base, "mode": "plan", "cost_usd": 0, "spend_log_ok": writable, **({"spend_log_error": why} if why else {})}
        if estimate > max_usd:
            raise RuntimeError(f"music cost cap exceeded ({estimate} > {max_usd})")

        os.makedirs(workdir, exist_ok=True)
        live = mode == "live"
        if live and not getattr(self.transport, "live", False):
            raise RuntimeError("live mode requires a live Runware transport")
        raw_path = os.path.join(workdir, "bgm_raw.wav")
        accounting: Dict[str, Any] = {"requested_logged": None, "paid_logged": None, "downloaded_logged": None, "errors": []}
        if live:
            self._paid_bgm_request(caption=caption, seed=seed, spec=spec, lyrics=lyrics, key=key, video_id=video_id, raw_path=raw_path,
                                   accounting=accounting)
        else:
            # The synthetic placeholder bed (a 220 Hz tone plus a 1 kHz click on every beat) is a development and test fixture. Production must never attach it.
            if os.environ.get("NODE_ENV", "").strip().lower() == "production":
                raise RuntimeError("dry mode refuses to write the synthetic placeholder bed in production")
            write_click_bed(raw_path, spec.bpm)
        bed_path = os.path.join(workdir, "bed.wav")
        metrics = postprocess_bed(raw_path, bed_path)
        qc = _run_qc(metrics, spec.bpm)
        qc_retried = False
        if live and not qc["passed"] and allow_qc_retry:
            # Explicitly authorised legacy retry only (Phase 1.7.3): same seed, bed only, and only if a second bed fits the existing cap.
            first_cost = float(getattr(self.transport, "last_cost", None) or bgm_cap_cost())
            if first_cost + bgm_cap_cost() <= max_usd:
                qc_retried = True
                self._paid_bgm_request(caption=caption, seed=seed, spec=spec, lyrics=lyrics, key=key, video_id=video_id, raw_path=raw_path,
                                       accounting=accounting)
                metrics = postprocess_bed(raw_path, bed_path)
                qc = _run_qc(metrics, spec.bpm)
        if sfx_refused:
            _log.warning("music.sfx_live_refused %d", sfx_refused)
        _log.info("music.qc_vocal_score %s", qc["vocal_score"])
        _log.info("music.qc_speech_band %s", metrics.get("qc_speech_band"))

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
        schema.update({
            "qc_silence_sec": qc["silence_sec"], "qc_true_peak_dbfs": qc["true_peak_dbfs"],
            "qc_bpm_error_ratio": qc["bpm_error_ratio"], "qc_seam_db": qc["seam_db"],
            "qc_vocal_score": qc["vocal_score"], "qc_passed": qc["passed"],
            "qc_retried": qc_retried, "qc_retry_allowed": allow_qc_retry, "qc": qc,
            "sfx_generation": "refused_live_disabled" if sfx_refused else ("not_requested" if not requested_cuts else "dry_placeholders"),
            "sfx_refused": sfx_refused,
        })
        schema["mode"] = mode
        schema["paid"] = live
        schema["accounting"] = accounting
        schema["cost_usd"] = measured
        return schema
