"""SFX-1: the live Music Specialist never pays for SFX. The server never uses this agent's SFX output (only its bed), and the SFX models and prices are
unverified, so live runs refuse SFX generation explicitly; plan and dry runs keep their no-cost placeholders.

Offline: a fake LIVE transport counting POSTs and monkeypatched postprocess/QC (the conftest refuses the real transport and redirects MUSIC_SPEND_LOG).
"""

import os

import music_specialist.agent as agent_mod
from music_specialist.agent import AIMusicSpecialistAgent

PASS_QC = {"silence_sec": 0.0, "true_peak_dbfs": -1.5, "bpm_error_ratio": 0.0, "seam_db": 1.0, "vocal_score": 0.1, "passed": True}
CUTS = [{"at_ms": 1000, "kind": "zoom"}, {"at_ms": 4000, "kind": "room ambience"}, {"at_ms": 8000, "kind": "text pop"}]


class FakeLiveTransport:
    live = True

    def __init__(self):
        self.posts = []
        self.last_cost = 0.0075

    def post(self, task, label):
        self.posts.append((label, task.get("model")))
        return f"https://fake.invalid/{label}/{len(self.posts)}"

    def download(self, url, dest):
        with open(dest, "wb") as handle:
            handle.write(b"x")
        return dest


def _patch(monkeypatch):
    monkeypatch.setattr(agent_mod, "postprocess_bed", lambda raw, bed: {"bed_full_path": bed, "bed_loop_path": bed, "measured_bpm": 80.0, "loop_fallback": True})
    monkeypatch.setattr(agent_mod, "qc_bed", lambda **kw: dict(PASS_QC))
    monkeypatch.setattr(agent_mod, "trim_leading_silence", lambda src, dest: (_ for _ in ()).throw(AssertionError("no SFX may be downloaded")))


def _spend_lines(label, state="paid"):
    """Lines for one paid request's lifecycle state (requested -> paid -> downloaded). A request is counted once, by its `paid` line."""
    path = os.environ["MUSIC_SPEND_LOG"]
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [line for line in handle.read().splitlines() if f"label={label}" in line and f"state={state}" in line]


def test_live_with_sfx_requested_makes_no_sfx_request_even_with_the_server_flag_set(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSIC_SPECIALIST_SFX", "1")  # the server-side switch that makes the server ask for SFX
    _patch(monkeypatch)
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run({"emotional_tone": "calm", "canvas_sec": 20, "video_id": "v1", "include_sfx": True, "visual_cuts": CUTS},
                                           str(tmp_path), mode="live")
    assert [p[0] for p in fake.posts] == ["bgm"]  # only the bed
    assert out["sfx_generation"] == "refused_live_disabled" and out["sfx_refused"] == 3
    assert out["layers"]["sfx"] == []  # nothing reported as generated
    assert len(_spend_lines("bgm")) == 1 and _spend_lines("sfx") == []
    assert out["estimated_cost_usd"] == 0.0075  # refused SFX are not priced into the live run


def test_live_default_include_sfx_is_refused_too(tmp_path, monkeypatch):
    _patch(monkeypatch)
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run({"emotional_tone": "calm", "canvas_sec": 20, "video_id": "v2", "visual_cuts": CUTS}, str(tmp_path), mode="live")
    assert [p[0] for p in fake.posts] == ["bgm"]
    assert out["sfx_generation"] == "refused_live_disabled" and out["sfx_refused"] == 3


def test_live_without_cuts_reports_not_requested(tmp_path, monkeypatch):
    _patch(monkeypatch)
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run({"emotional_tone": "calm", "canvas_sec": 20, "video_id": "v3", "include_sfx": False, "visual_cuts": CUTS},
                                           str(tmp_path), mode="live")
    assert [p[0] for p in fake.posts] == ["bgm"]
    assert out["sfx_generation"] == "not_requested" and out["sfx_refused"] == 0


def test_dry_run_keeps_its_no_cost_sfx_placeholders(tmp_path):
    out = AIMusicSpecialistAgent().run({"emotional_tone": "calm", "canvas_sec": 20, "video_id": "v4", "include_sfx": True, "visual_cuts": CUTS},
                                       str(tmp_path), mode="dry")
    assert out["sfx_generation"] == "dry_placeholders" and out["sfx_refused"] == 0
    assert len(out["layers"]["sfx"]) == 3
    assert out["cost_usd"] == 0


def test_plan_estimate_is_unchanged(tmp_path):
    out = AIMusicSpecialistAgent().run({"emotional_tone": "calm", "canvas_sec": 20, "video_id": "v5", "include_sfx": True, "visual_cuts": CUTS},
                                       str(tmp_path), mode="plan")
    assert out["mode"] == "plan" and out["estimated_cost_usd"] == round(0.0075 + 3 * 0.0005, 6)
