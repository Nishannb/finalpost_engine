"""Phase 4: paid-generation accounting and the production guard on the synthetic placeholder bed.

Offline and free: a fake LIVE transport (counts POSTs, writes nothing real), monkeypatched postprocess/QC, and failure injection on the spend log.
The conftest autouse fixture refuses RunwareTransport and points MUSIC_SPEND_LOG at tmp_path.

What is proven here:
  * the `requested` record is written (and fsynced) BEFORE the provider is called, and if it cannot be written NO paid call is made;
  * a failed `paid` record never discards the paid bed (the evidence is the requested line plus the `accounting` block returned to the server);
  * a failed download after payment is a PaidGenerationError carrying stage + cost (the server records it in its durable ledger);
  * a failed POST is a PaidGenerationError with an unknown cost (the request may have been charged);
  * the lifecycle is distinguishable in the log: requested -> paid -> downloaded (or post_failed / download_failed);
  * production never writes the synthetic dry-mode bed.
"""

import json
import os
import sys

import pytest

import music_specialist.agent as agent_mod
import music_specialist.__main__ as main_mod
from music_specialist.agent import AIMusicSpecialistAgent, PaidGenerationError
from music_specialist.spend import SpendLogError, append_spend, spend_log_path, spend_log_writable

PASS_QC = {"silence_sec": 0.0, "true_peak_dbfs": -1.5, "bpm_error_ratio": 0.0, "seam_db": 1.0, "vocal_score": 0.1, "passed": True}


class FakeLive:
    live = True

    def __init__(self, cost=0.0075, post_error=None, download_error=None):
        self.posts = []
        self.downloads = []
        self.last_cost = cost
        self._post_error = post_error
        self._download_error = download_error

    def post(self, task, label):
        self.posts.append(label)
        if self._post_error:
            raise self._post_error
        return f"https://fake.invalid/{label}/{len(self.posts)}"

    def download(self, url, dest):
        self.downloads.append(url)
        if self._download_error:
            raise self._download_error
        with open(dest, "wb") as handle:
            handle.write(b"x")
        return dest


def _patch_audio(monkeypatch):
    monkeypatch.setattr(agent_mod, "postprocess_bed", lambda raw, bed: {"bed_full_path": bed, "bed_loop_path": bed, "measured_bpm": 80.0, "loop_fallback": True, "integrated_lufs": -16.0})
    monkeypatch.setattr(agent_mod, "qc_bed", lambda **kwargs: dict(PASS_QC))
    monkeypatch.setattr(agent_mod, "trim_leading_silence", lambda src, dest: dest)


def _job(**extra):
    job = {"emotional_tone": "calm", "canvas_sec": 20, "video_id": "video-1", "include_sfx": False, "max_usd": 0.02}
    job.update(extra)
    return job


def _states():
    path = spend_log_path()
    if not path.exists():
        return []
    return [line.split("state=")[1].split()[0] for line in path.read_text().splitlines() if "label=bgm" in line]


# ---- lifecycle on the happy path ------------------------------------------------------------------------------------------------------------------------


def test_a_successful_paid_run_logs_requested_then_paid_then_downloaded(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    fake = FakeLive()
    out = AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert _states() == ["requested", "paid", "downloaded"]
    assert out["paid"] is True and out["accounting"] == {"requested_logged": True, "paid_logged": True, "downloaded_logged": True, "errors": []}
    # the requested line carries no cost (nothing is known yet); the paid line carries the measured cost; only `paid` lines are summed
    lines = spend_log_path().read_text().splitlines()
    assert "includeCost=" in lines[0] and "includeCost=0.0075" in lines[1]


def test_the_requested_record_is_written_before_the_provider_is_called(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    seen = {}

    class Probe(FakeLive):
        def post(self, task, label):
            seen["states_at_post"] = _states()
            return super().post(task, label)

    AIMusicSpecialistAgent(Probe()).run(_job(), str(tmp_path), mode="live")
    assert seen["states_at_post"] == ["requested"]


def test_every_record_is_fsynced(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    synced = []
    real = os.fsync
    monkeypatch.setattr(os, "fsync", lambda fd: (synced.append(fd), real(fd))[1])
    AIMusicSpecialistAgent(FakeLive()).run(_job(), str(tmp_path), mode="live")
    assert len(synced) == 3  # requested, paid, downloaded


# ---- failure injection ---------------------------------------------------------------------------------------------------------------------------------


def test_if_the_requested_record_cannot_be_written_no_paid_call_is_made(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    monkeypatch.setenv("MUSIC_SPEND_LOG", str(tmp_path / "ro" / "sub" / "spend.log"))
    (tmp_path / "ro").mkdir()
    os.chmod(tmp_path / "ro", 0o555)
    try:
        fake = FakeLive()
        with pytest.raises(SpendLogError):
            AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path / "work"), mode="live")
        assert fake.posts == [] and fake.downloads == []  # no spend without a durable record
    finally:
        os.chmod(tmp_path / "ro", 0o755)


def test_if_the_paid_record_fails_the_paid_bed_is_kept_and_the_failure_is_reported(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    real = append_spend

    def flaky(**kwargs):
        if kwargs.get("state") == "paid":
            raise SpendLogError("spend log append failed (OSError)")
        return real(**kwargs)

    monkeypatch.setattr(agent_mod, "append_spend", flaky)
    fake = FakeLive()
    out = AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert fake.posts == ["bgm"] and len(fake.downloads) == 1 and out["bed_full_path"].endswith("bed.wav")  # the paid asset is not discarded
    assert out["cost_usd"] == 0.0075  # the measured cost still reaches the server, which writes it to its durable ledger
    assert out["accounting"]["paid_logged"] is False and out["accounting"]["errors"] == ["spend log append failed (OSError)"]
    assert out["accounting"]["requested_logged"] is True  # the write-ahead record exists
    assert _states() == ["requested", "downloaded"]  # evidence of the request survives locally; `paid` is the missing line


def test_a_failed_download_after_payment_is_a_paid_failure_with_the_cost(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    fake = FakeLive(download_error=OSError("disk full"))
    with pytest.raises(PaidGenerationError) as caught:
        AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert caught.value.stage == "download" and caught.value.cost == 0.0075
    assert _states() == ["requested", "paid", "download_failed"]
    assert caught.value.accounting["requested_logged"] is True and caught.value.accounting["paid_logged"] is True


def test_a_failed_post_is_a_paid_failure_with_an_unknown_cost(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    fake = FakeLive(post_error=TimeoutError("provider timeout"))
    with pytest.raises(PaidGenerationError) as caught:
        AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert caught.value.stage == "post" and caught.value.cost is None  # the request may or may not have been charged
    assert _states() == ["requested", "post_failed"]


def test_no_second_paid_request_inside_one_run_after_a_failure(tmp_path, monkeypatch):
    """The agent itself never retries a paid request (the server's ledger is what blocks a second run for the same video)."""
    _patch_audio(monkeypatch)
    fake = FakeLive(download_error=OSError("x"))
    with pytest.raises(PaidGenerationError):
        AIMusicSpecialistAgent(fake).run(_job(), str(tmp_path), mode="live")
    assert fake.posts == ["bgm"]


def test_a_failed_trailing_record_is_reported_but_does_not_fail_the_run(tmp_path, monkeypatch):
    _patch_audio(monkeypatch)
    real = append_spend

    def flaky(**kwargs):
        if kwargs.get("state") == "downloaded":
            raise SpendLogError("spend log append failed (OSError)")
        return real(**kwargs)

    monkeypatch.setattr(agent_mod, "append_spend", flaky)
    out = AIMusicSpecialistAgent(FakeLive()).run(_job(), str(tmp_path), mode="live")
    assert out["accounting"]["downloaded_logged"] is False and out["accounting"]["paid_logged"] is True
    assert _states() == ["requested", "paid"]


# ---- the pre-flight the server uses before it claims the ledger ----------------------------------------------------------------------------------------


def test_plan_mode_reports_whether_the_spend_log_is_writable_without_touching_it(tmp_path, monkeypatch):
    target = tmp_path / "spend.log"
    monkeypatch.setenv("MUSIC_SPEND_LOG", str(target))
    out = AIMusicSpecialistAgent().run(_job(), str(tmp_path), mode="plan")
    assert out["spend_log_ok"] is True and not target.exists()  # os.access only: nothing created, nothing written
    (tmp_path / "ro").mkdir()
    os.chmod(tmp_path / "ro", 0o555)
    try:
        monkeypatch.setenv("MUSIC_SPEND_LOG", str(tmp_path / "ro" / "spend.log"))
        ok, why = spend_log_writable()
        out = AIMusicSpecialistAgent().run(_job(), str(tmp_path), mode="plan")
        assert ok is False and why and out["spend_log_ok"] is False and out["spend_log_error"]
    finally:
        os.chmod(tmp_path / "ro", 0o755)


# ---- the machine-readable failure line the server parses ----------------------------------------------------------------------------------------------


def test_main_prints_one_parseable_line_for_a_paid_failure(monkeypatch, capsys):
    class Boom:
        def __init__(self, transport):
            pass

        def run(self, payload, workdir, mode):
            raise PaidGenerationError("download", 0.0075, "paid bed download failed: OSError", {"requested_logged": True, "paid_logged": True, "errors": []})

    monkeypatch.setattr(main_mod, "AIMusicSpecialistAgent", Boom)
    monkeypatch.setattr(sys, "argv", ["music_specialist", "--mode", "dry"])
    monkeypatch.setattr(sys, "stdin", __import__("io").StringIO("{}"))
    with pytest.raises(SystemExit) as caught:
        main_mod.main()
    assert caught.value.code == 1
    err = capsys.readouterr().err
    line = [l for l in err.splitlines() if l.startswith("MUSIC_PAID_FAILURE ")][0]
    assert json.loads(line.split(" ", 1)[1]) == {"stage": "download", "cost_usd": 0.0075, "accounting": {"requested_logged": True, "paid_logged": True, "errors": []}}


# ---- production never writes the synthetic placeholder bed -------------------------------------------------------------------------------------------


def test_dry_mode_in_production_refuses_to_write_the_placeholder_bed(tmp_path, monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    written = []
    monkeypatch.setattr(agent_mod, "write_click_bed", lambda path, bpm: written.append(path))
    with pytest.raises(RuntimeError, match="refuses to write the synthetic placeholder bed in production"):
        AIMusicSpecialistAgent().run(_job(), str(tmp_path), mode="dry")
    assert written == []


def test_dry_mode_outside_production_still_writes_the_placeholder_bed(tmp_path, monkeypatch):
    for value in (None, "development", "test"):
        if value is None:
            monkeypatch.delenv("NODE_ENV", raising=False)
        else:
            monkeypatch.setenv("NODE_ENV", value)
        _patch_audio(monkeypatch)
        out = AIMusicSpecialistAgent().run(_job(), str(tmp_path / (value or "unset")), mode="dry")
        assert out["mode"] == "dry" and out["paid"] is False and os.path.exists(os.path.join(str(tmp_path / (value or "unset")), "bgm_raw.wav"))


def test_plan_mode_is_unaffected_by_production(tmp_path, monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    out = AIMusicSpecialistAgent().run(_job(), str(tmp_path), mode="plan")
    assert out["mode"] == "plan" and out["cost_usd"] == 0
