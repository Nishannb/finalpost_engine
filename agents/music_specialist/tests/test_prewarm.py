import os
import subprocess
import sys
from pathlib import Path

import pytest

from music_specialist.scripts.prewarm_pool import MOODS, plan_prewarm

AGENTS_DIR = Path(__file__).resolve().parents[2]


def _run(args, tmp_path):
    env = {k: v for k, v in os.environ.items()
           if k not in ("MUSIC_SPECIALIST_CALLER", "MUSIC_SPECIALIST", "MUSIC_PREWARM_LIVE", "MUSIC_BED_FRESH")}
    env["MUSIC_SPEND_LOG"] = str(tmp_path / "spend.log")
    env["PYTHONPATH"] = str(AGENTS_DIR)
    return subprocess.run(
        [sys.executable, "-m", "music_specialist.scripts.prewarm_pool", *args],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60,
    )


def _no_spend(tmp_path):
    log = tmp_path / "spend.log"
    return (not log.exists()) or log.read_text() == ""


def test_plan_math():
    plan = plan_prewarm({"high-energy": 1}, 3, 0.0075)
    assert plan["calls"] == 14
    assert plan["cost_usd"] == pytest.approx(0.1050)
    assert plan["per_mood"]["high-energy"] == 2
    assert all(plan["per_mood"][m] == 3 for m in MOODS if m != "high-energy")


def test_plan_never_negative():
    assert plan_prewarm({"calm": 9}, 3, 0.0075)["per_mood"]["calm"] == 0
    assert plan_prewarm({}, 0, 0.0075)["calls"] == 0


def test_plan_cli(tmp_path):
    res = _run(["--plan", "--counts", "high-energy=1", "--pool-size", "3"], tmp_path)
    assert res.returncode == 0, res.stderr
    assert "calls=14" in res.stdout
    assert "cost_usd=0.1050" in res.stdout
    assert _no_spend(tmp_path)


def test_confirm_spend_without_tty_refused(tmp_path):
    res = _run(["--confirm-spend", "--counts", "high-energy=1", "--pool-size", "3"], tmp_path)
    assert res.returncode == 2
    assert "prewarm_refused" in res.stderr
    assert _no_spend(tmp_path)


def test_confirm_spend_without_caller_refused(tmp_path):
    res = _run(["--confirm-spend"], tmp_path)
    assert res.returncode == 2
    assert "prewarm_refused caller" in res.stderr
    assert _no_spend(tmp_path)
