"""Phase B1: RVM time ranges. Real inference on hi.mp4, small windows only (<= 62 frames per run); temp outputs are deleted.

Run (from finalpost_engine/subjectmatte):
    PYTHONDONTWRITEBYTECODE=1 .venv-rvm/bin/python -m pytest -s -p no:cacheprovider human_matting/tests/test_rvm_ranges.py

Layout of the main run (hi.mp4 is 25 fps, so frame i is at t = i/25 and a frame is matted when a-0.05 <= t <= b+0.05):
    range A = 0.5-1.5  -> frames 12..38   (27 frames)
    range B = 2.0-2.4  -> frames 49..61   (13 frames)
    everything else is written fully transparent; the run is capped at 62 frames.
Reset / determinism is checked on RVM's RAW alpha (a spy on infer_frame), because a lossy WebM cannot distinguish carried from reset state.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import mock

import numpy as np
import pytest

_SUBJECTMATTE = Path(__file__).resolve().parents[2]
if str(_SUBJECTMATTE) not in sys.path:
    sys.path.insert(0, str(_SUBJECTMATTE))

from human_matting.model.rvm_inference import RvmSession  # noqa: E402
from human_matting.services.matting_service import parse_ranges, process_video  # noqa: E402

VIDEO = _SUBJECTMATTE.parent / "remotion" / "public" / "hi.mp4"
W, H, FPS = 720, 1280, 25
MAX_FRAMES = 62
RANGE_A = (0.5, 1.5)
RANGE_B = (2.0, 2.4)
IN_A = range(12, 39)
IN_B = range(49, 62)
OUTSIDE = [0, 5, 11, 39, 44, 48]
INSIDE_SAMPLE = [12, 25, 38, 49, 55, 61]


def decode_alpha(path: Path, wanted: set, w: int = W, h: int = H) -> dict:
    """Decode with libvpx-vp9 (the decoder that reads WebM alpha), streaming; keep only the alpha planes of `wanted` frame indices. Returns (planes, total_frames)."""
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", str(path), "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    size, planes, i = w * h * 4, {}, 0
    try:
        while True:
            buf = bytearray()
            while len(buf) < size:
                chunk = proc.stdout.read(size - len(buf))
                if not chunk:
                    break
                buf += chunk
            if not buf:
                break
            assert len(buf) == size, "truncated decoded frame"
            if i in wanted:
                planes[i] = np.frombuffer(bytes(buf), dtype=np.uint8).reshape(h, w, 4)[:, :, 3].copy()
            i += 1
    finally:
        proc.stdout.close()
        err = proc.stderr.read().decode("utf-8", "replace")
        assert proc.wait() == 0, err[-300:]
    return {"planes": planes, "total": i}


class Run:
    """One process_video call with a spy on RvmSession. Counts inferred frames and reset() calls, and keeps the RAW alpha of the inferred frames
    whose position in call order is in `keep` (a few frames only: full alpha planes are 3.7 MB each)."""

    def __init__(self, tmp: Path, name: str, keep=(), **kwargs):
        self.alphas, self.reset_calls, self.infer_count = {}, 0, 0
        real_infer, real_reset = RvmSession.infer_frame, RvmSession.reset
        run, keep = self, set(keep)

        def infer(session, frame):
            fgr, pha = real_infer(session, frame)
            if run.infer_count in keep:
                run.alphas[run.infer_count] = pha.copy()
            run.infer_count += 1
            return fgr, pha

        def reset(session):
            run.reset_calls += 1
            return real_reset(session)

        self.out = tmp / f"{name}.webm"
        with mock.patch.object(RvmSession, "infer_frame", infer), mock.patch.object(RvmSession, "reset", reset):
            self.result = process_video(VIDEO, quality="fast", output_path=self.out, **kwargs)


def frame_indices(ranges, fps=FPS, limit=MAX_FRAMES):
    return [i for i in range(limit) if any(a - 0.05 <= i / fps <= b + 0.05 for a, b in ranges)]


@pytest.fixture(scope="module")
def workdir():
    d = Path(tempfile.mkdtemp(prefix="rvm-ranges-test-"))
    yield d
    shutil.rmtree(d, ignore_errors=True)  # temp outputs are always deleted


@pytest.fixture(scope="module")
def main_run(workdir):
    assert VIDEO.is_file(), f"missing {VIDEO}"
    n_a = len(IN_A)
    return Run(workdir, "ab", keep={n_a, n_a + 6}, ranges=[RANGE_A, RANGE_B], max_frames=MAX_FRAMES)


def test_parse_ranges():
    assert parse_ranges(None) is None and parse_ranges("") is None and parse_ranges("  ") is None
    assert parse_ranges("3.2-6.0, 12-15.5") == [(3.2, 6.0), (12.0, 15.5)]
    for bad in ["5-3", "5", "a-b", "-1-2", "3-3"]:
        with pytest.raises(ValueError):
            parse_ranges(bad)


def test_service_rejects_bad_arguments():
    for bad in [dict(ranges=[]), dict(ranges=[(2, 1)]), dict(ranges=[(-1, 1)]), dict(max_side=10), dict(max_side=0)]:
        with pytest.raises(ValueError):
            process_video(VIDEO, output_path="/tmp/never.webm", **bad)


def test_output_keeps_source_timeline_and_alpha(main_run):
    r = main_run.result
    assert (r["width"], r["height"], r["fps"]) == (W, H, 25.0)
    assert r["frames_encoded"] == r["frames"] == MAX_FRAMES  # every frame is written, in order: same frame count / duration as the source segment
    assert r["duration_sec"] == pytest.approx(MAX_FRAMES / FPS)
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-c:v", "libvpx-vp9", "-select_streams", "v:0", "-count_packets",
         "-show_entries", "stream=codec_name,pix_fmt,nb_read_packets:stream_tags=alpha_mode", "-of", "json", str(main_run.out)],
        capture_output=True, text=True, check=True).stdout)["streams"][0]
    assert (probe["codec_name"], probe["pix_fmt"]) == ("vp9", "yuva420p")
    assert probe["tags"].get("alpha_mode", probe["tags"].get("ALPHA_MODE")) == "1"
    assert int(probe["nb_read_packets"]) == MAX_FRAMES


def test_alpha_is_zero_outside_and_real_inside(main_run):
    dec = decode_alpha(main_run.out, set(OUTSIDE) | set(INSIDE_SAMPLE))
    assert dec["total"] == MAX_FRAMES
    for i in OUTSIDE:
        peak = int(dec["planes"][i].max())
        # blank frames are exact zeros going in; VP9 inter-prediction can leak a few levels into the frame right after a range
        assert peak <= 16, f"frame {i} (outside every range) has alpha up to {peak}/255"
    for i in INSIDE_SAMPLE:
        a = dec["planes"][i]
        assert a.max() >= 240, f"frame {i} (inside a range) has no opaque pixels"
        assert (a >= 242).mean() > 0.05 and (a <= 13).mean() > 0.05, f"frame {i}: alpha is not a real matte"
    print(f"\n[alpha] outside frames {OUTSIDE}: max alpha {[int(dec['planes'][i].max()) for i in OUTSIDE]}; "
          f"inside frames {INSIDE_SAMPLE}: opaque share {[round(float((dec['planes'][i] >= 242).mean()), 2) for i in INSIDE_SAMPLE]}")


def test_report_fields_for_the_quality_gate(main_run):
    r = main_run.result
    expected = len(frame_indices([RANGE_A, RANGE_B]))
    assert expected == len(IN_A) + len(IN_B) == 40
    assert r["segmented_frames"] == expected  # inference ran on exactly the in-range frames
    assert main_run.infer_count == expected  # the spy saw exactly the in-range frames: nothing outside a range was inferred
    assert r["detected_ratio"] >= 0.95 and r["mean_area"] > 0.15
    box = r["box"]
    assert box and 0 <= box["x"] < 1 and 0 <= box["y"] < 1 and box["w"] > 0.3 and box["h"] > 0.5 and box["x"] + box["w"] <= 1.01
    assert r["model"] == "rvm_mobilenetv3"
    assert r["ranges"] == [[0.5, 1.5], [2.0, 2.4]]
    assert r["device"] and r["seconds"] > 0 and r["downsample_ratio"] == pytest.approx(0.4)
    print(f"\n[report] device={r['device']} segmented={r['segmented_frames']}/{r['frames']} detected_ratio={r['detected_ratio']} mean_area={r['mean_area']} box={box} seconds={r['seconds']}")


def test_state_resets_at_each_range_start(main_run, workdir):
    # reset is called once at the start of the video + once at the start of EACH range; never per frame
    assert main_run.reset_calls == 3, f"reset called {main_run.reset_calls} times, expected 1 + 2 ranges"
    # replay determinism WITHIN a range: range B alone (fresh state at its start) must reproduce range B of the two-range run exactly
    only_b = Run(workdir, "b_only", keep={0, 6}, ranges=[RANGE_B], max_frames=MAX_FRAMES)
    n_a = len(IN_A)
    b_first_two_range = main_run.alphas[n_a]          # first inferred frame of range B in the A+B run (state was reset at the gap)
    b_first_fresh = only_b.alphas[0]
    d0 = float(np.abs(b_first_two_range - b_first_fresh).max())
    d_later = float(np.abs(main_run.alphas[n_a + 6] - only_b.alphas[6]).max())
    print(f"\n[reset] range B first frame vs fresh-start run: max|diff|={d0:.3e}; 7th frame: {d_later:.3e}")
    assert d0 <= 1e-4 and d_later <= 1e-4, "range B in the A+B run differs from a fresh run of range B: state leaked across the gap"
    # sensitivity control: WITHOUT a gap the state is carried and the SAME frame differs
    # in this run frame 49 is preceded by 12 inferred frames with no gap; its position in the call order:
    pos = frame_indices([(1.5, 2.4)]).index(49)
    carried = Run(workdir, "carried", keep={pos}, ranges=[(1.5, 2.4)], max_frames=MAX_FRAMES)
    d_carried = float(np.abs(carried.alphas[pos] - only_b.alphas[0]).max())
    print(f"[reset] control (state carried, no gap): max|diff|={d_carried:.3e}")
    assert d_carried > 1e-3, "control failed: carried state produced the same alpha as a fresh start, so this test could not detect a leak"
    assert carried.reset_calls == 2  # video start + the single range


def test_full_video_path_without_ranges_is_unchanged(workdir):
    run = Run(workdir, "full8", max_frames=8)
    r = run.result
    assert run.reset_calls == 1, "without ranges the state is reset once per video, never per frame"
    assert run.infer_count == 8
    assert r["segmented_frames"] == r["frames"] == 8 and r["ranges"] is None
    dec = decode_alpha(run.out, set(range(8)))
    assert all(dec["planes"][i].max() >= 240 for i in range(8))


def test_max_side_caps_the_longest_side_keeping_aspect(workdir):
    run = Run(workdir, "small", ranges=[(0.5, 0.7)], max_frames=20, max_side=640)
    r = run.result
    assert (r["width"], r["height"]) == (360, 640)
    dec = decode_alpha(run.out, {0, 14}, 360, 640)
    assert dec["planes"][0].max() <= 4 and dec["planes"][14].max() >= 240
    assert r["segmented_frames"] == len(frame_indices([(0.5, 0.7)], limit=20))


def test_cli_with_ranges_writes_the_report(workdir):
    out, res = workdir / "cli.webm", workdir / "cli.json"
    proc = subprocess.run(
        [sys.executable, "-m", "human_matting.cli", str(VIDEO), str(out), str(res), "--quality", "fast", "--ranges", "0.5-0.7", "--max-side", "640", "--max-frames", "16"],
        cwd=_SUBJECTMATTE, capture_output=True, text=True,
        env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1"},
    )
    assert proc.returncode == 0, proc.stderr[-400:]
    report = json.loads(res.read_text())
    assert report["ok"] is True and report["model"] == "rvm_mobilenetv3" and report["ranges"] == [[0.5, 0.7]]
    assert (report["width"], report["height"], report["frames"]) == (360, 640, 16)
    assert all(k in report for k in ("segmented_frames", "detected_ratio", "mean_area", "box", "seconds", "fps", "device"))
    assert any(line.startswith("PROGRESS ") for line in proc.stdout.splitlines())
    bad = subprocess.run([sys.executable, "-m", "human_matting.cli", str(VIDEO), str(out), str(res), "--ranges", "5-3"], cwd=_SUBJECTMATTE, capture_output=True, text=True)
    assert bad.returncode == 2
