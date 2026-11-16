"""Phase 1.7.3: a failed BGM QC never triggers a second paid generation unless the job explicitly opts in (`allow_qc_retry: true`).

Offline: a fake LIVE transport (counts POSTs, writes nothing real) and monkeypatched postprocess/QC, so no audio stack, no network and no provider.
The conftest autouse fixture refuses RunwareTransport and points MUSIC_SPEND_LOG at tmp_path.
Plain functions taking (tmp_path, monkeypatch): pytest runs them; they import nothing from pytest, so a stdlib harness can run them too.
"""

import json

import music_specialist.agent as agent_mod
from music_specialist.agent import AIMusicSpecialistAgent, qc_retry_allowed

FIRST_QC = {"silence_sec": 9.0, "true_peak_dbfs": -1.2, "bpm_error_ratio": 0.31, "seam_db": 7.5, "vocal_score": 0.8, "passed": False}
PASS_QC = {"silence_sec": 0.0, "true_peak_dbfs": -1.5, "bpm_error_ratio": 0.0, "seam_db": 1.0, "vocal_score": 0.1, "passed": True}


class FakeLiveTransport:
    """Looks live to the agent; records every POST; downloads write a placeholder file."""

    live = True

    def __init__(self, cost=0.0075):
        self.posts = []
        self.last_cost = cost

    def post(self, task, label):
        self.posts.append((label, task.get("model")))
        return f"https://fake.invalid/{label}/{len(self.posts)}"

    def download(self, url, dest):
        with open(dest, "wb") as handle:
            handle.write(url.encode())
        return dest

    def bgm_posts(self):
        return [p for p in self.posts if p[0] == "bgm"]


def _patch_audio(monkeypatch, qc_results):
    """postprocess_bed returns metrics naming the raw file it was given (so the test can tell which download was kept); QC answers in order."""
    calls = {"postprocess": [], "qc": 0}

    def fake_postprocess(raw_path, bed_path):
        with open(raw_path, "rb") as handle:
            source = handle.read().decode()
        calls["postprocess"].append(source)
        return {"bed_full_path": bed_path, "bed_loop_path": bed_path, "measured_bpm": 80.0, "loop_fallback": True, "integrated_lufs": -16.0,
                "source_url": source}

    def fake_qc(**kwargs):
        result = qc_results[min(calls["qc"], len(qc_results) - 1)]
        calls["qc"] += 1
        return dict(result)

    monkeypatch.setattr(agent_mod, "postprocess_bed", fake_postprocess)
    monkeypatch.setattr(agent_mod, "qc_bed", fake_qc)
    monkeypatch.setattr(agent_mod, "trim_leading_silence", lambda src, dest: dest)
    return calls


def _job(**extra):
    job = {"emotional_tone": "calm", "canvas_sec": 20, "video_id": "video-1", "include_sfx": False, "max_usd": 0.02}
    job.update(extra)
    return job


def test_failed_qc_without_opt_in_makes_exactly_one_bgm_request(tmp_path, monkeypatch):
    calls = _patch_audio(monkeypatch, [FIRST_QC])
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert len(fake.bgm_posts()) == 1
    assert calls["qc"] == 1 and len(calls["postprocess"]) == 1
    assert out["qc_passed"] is False and out["qc_retried"] is False and out["qc_retry_allowed"] is False


def test_failed_qc_with_explicit_false_makes_exactly_one_bgm_request(tmp_path, monkeypatch):
    _patch_audio(monkeypatch, [FIRST_QC])
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run(_job(allow_qc_retry=False), str(tmp_path), mode="live")
    assert len(fake.bgm_posts()) == 1
    assert out["qc_retried"] is False


def test_malformed_or_truthy_non_boolean_values_never_enable_the_retry(tmp_path, monkeypatch):
    for index, value in enumerate((None, 1, 0, "true", "True", "yes", 1.0, [True], {"allow": True})):
        _patch_audio(monkeypatch, [FIRST_QC])
        fake = FakeLiveTransport()
        out = AIMusicSpecialistAgent(fake).run(_job(allow_qc_retry=value), str(tmp_path / f"w{index}"), mode="live")
        assert len(fake.bgm_posts()) == 1, value
        assert out["qc_retried"] is False and out["qc_retry_allowed"] is False, value
    assert qc_retry_allowed({"allow_qc_retry": True}) is True
    assert qc_retry_allowed(json.loads('{"allow_qc_retry": true}')) is True
    for payload in ({}, {"allow_qc_retry": "true"}, {"allow_qc_retry": 1}, None, "allow_qc_retry", [("allow_qc_retry", True)]):
        assert qc_retry_allowed(payload) is False, payload


def test_explicit_true_keeps_the_legacy_retry_within_the_cap(tmp_path, monkeypatch):
    calls = _patch_audio(monkeypatch, [FIRST_QC, PASS_QC])
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run(_job(allow_qc_retry=True), str(tmp_path), mode="live")
    assert len(fake.bgm_posts()) == 2
    assert out["qc_retried"] is True and out["qc_passed"] is True and out["qc_retry_allowed"] is True
    assert calls["postprocess"] == ["https://fake.invalid/bgm/1", "https://fake.invalid/bgm/2"]


def test_explicit_true_still_respects_the_cost_cap(tmp_path, monkeypatch):
    _patch_audio(monkeypatch, [FIRST_QC])
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run(_job(allow_qc_retry=True, max_usd=0.01), str(tmp_path), mode="live")
    assert len(fake.bgm_posts()) == 1  # 0.0075 + 0.0075 > 0.01
    assert out["qc_retried"] is False


def test_successful_qc_makes_one_request_with_or_without_opt_in(tmp_path, monkeypatch):
    for allow in (None, False, True):
        _patch_audio(monkeypatch, [PASS_QC])
        fake = FakeLiveTransport()
        job = _job() if allow is None else _job(allow_qc_retry=allow)
        out = AIMusicSpecialistAgent(fake).run(job, str(tmp_path / str(allow)), mode="live")
        assert len(fake.bgm_posts()) == 1
        assert out["qc_passed"] is True and out["qc_retried"] is False


def test_failed_qc_returns_the_first_asset_and_its_diagnostics(tmp_path, monkeypatch):
    calls = _patch_audio(monkeypatch, [FIRST_QC])
    fake = FakeLiveTransport()
    out = AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert out["source_url"] == "https://fake.invalid/bgm/1" and calls["postprocess"] == ["https://fake.invalid/bgm/1"]
    assert out["bed_full_path"].endswith("bed.wav")
    assert out["qc"] == FIRST_QC
    assert (out["qc_silence_sec"], out["qc_true_peak_dbfs"], out["qc_bpm_error_ratio"], out["qc_seam_db"], out["qc_vocal_score"]) == (9.0, -1.2, 0.31, 7.5, 0.8)
    assert out["mode"] == "live"
    # one paid BGM call: one `requested` and one `paid` line (each request also logs `downloaded`; a request is counted by its `paid` line)
    with open(_spend_log(), encoding="utf-8") as handle:
        lines = [line for line in handle.read().splitlines() if "label=bgm" in line]
    assert len([line for line in lines if "state=requested" in line]) == 1
    assert len([line for line in lines if "state=paid" in line]) == 1


def _spend_log():
    import os

    return os.environ["MUSIC_SPEND_LOG"]


def test_sfx_jobs_cannot_enable_the_bgm_retry(tmp_path, monkeypatch):
    _patch_audio(monkeypatch, [FIRST_QC])
    fake = FakeLiveTransport(cost=0.0005)
    job = _job(include_sfx=True, visual_cuts=[{"at_ms": 1000, "kind": "zoom"}, {"at_ms": 4000, "kind": "cut"}, {"at_ms": 8000}])
    out = AIMusicSpecialistAgent(fake).run(job, str(tmp_path), mode="live")
    assert len(fake.bgm_posts()) == 1
    assert [p for p in fake.posts if p[0] != "bgm"] == []  # SFX-1: live SFX generation is refused (no SFX request at all)
    assert out["sfx_generation"] == "refused_live_disabled" and out["sfx_refused"] == 3
    assert out["qc_retried"] is False


def test_cost_cap_and_sfx_budget_are_still_enforced_before_any_request(tmp_path, monkeypatch):
    # SFX-1: live SFX are refused, so they no longer count toward the live estimate; the BGM cap still refuses before any request.
    _patch_audio(monkeypatch, [FIRST_QC])
    fake = FakeLiveTransport()
    cuts = [{"at_ms": 1000 * (i + 1)} for i in range(12)]
    try:
        AIMusicSpecialistAgent(fake).run(_job(include_sfx=True, visual_cuts=cuts, max_usd=0.007, allow_qc_retry=True), str(tmp_path), mode="live")
        raised = False
    except RuntimeError as exc:
        raised = "music cost cap exceeded" in str(exc)
    assert raised and fake.posts == []
