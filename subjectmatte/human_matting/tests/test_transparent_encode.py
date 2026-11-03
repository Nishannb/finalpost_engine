"""Phase 3: prove the transparent VP9 WebM is real, from ffprobe/ffmpeg output on the DECODED file.

Run (from finalpost_engine/subjectmatte):
    PYTHONDONTWRITEBYTECODE=1 .venv-rvm/bin/python -m pytest -s -p no:cacheprovider human_matting/tests/test_transparent_encode.py

Input: remotion/public/hi.mp4, first 48 frames only, quality="high". Missing ffmpeg/ffprobe/libvpx-vp9 FAILS (no skips).

How alpha is evidenced (stated in the output): ffmpeg's native `vp9` decoder ignores WebM alpha, so pix_fmt
yuva420p and the alpha plane are read with the `libvpx-vp9` DECODER; the container's `alpha_mode=1` tag is
reported as supporting evidence. The verdict rests on the decoded alpha plane (test 5), not on the tag.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from unittest import mock

import cv2
import numpy as np
import pytest
import torch

_SUBJECTMATTE = Path(__file__).resolve().parents[2]
if str(_SUBJECTMATTE) not in sys.path:
    sys.path.insert(0, str(_SUBJECTMATTE))

from human_matting.model import rvm_loader  # noqa: E402
from human_matting.processing import video_encoder as encoder_mod  # noqa: E402
from human_matting.processing.video_decoder import VideoDecoder  # noqa: E402
from human_matting.processing.video_encoder import EncoderError, TransparentWebmEncoder  # noqa: E402
from human_matting.services import matting_service  # noqa: E402
from human_matting.services.matting_service import process_video  # noqa: E402

INPUT = _SUBJECTMATTE.parent / "remotion" / "public" / "hi.mp4"
OUT_DIR = _SUBJECTMATTE / "out" / "phase3"
OUT_WEBM = OUT_DIR / "hi-first48.webm"
FRAMES = 48
W, H, FPS = 720, 1280, 25
CHECK_FRAMES = (0, 24)
MAGENTA = np.array([255.0, 0.0, 255.0], dtype=np.float32)
SHOT_INDEX = 24


# --- tool helpers (real ffprobe / ffmpeg) -----------------------------------------------------------------
def _tool(name: str) -> str:
    path = shutil.which(name)
    assert path, f"{name} is required for this test and was not found on PATH"
    return path


def ffprobe_json(path: Path, *args: str) -> dict:
    out = subprocess.run(
        [_tool("ffprobe"), "-v", "error", *args, "-of", "json", str(path)], capture_output=True, text=True, check=True
    ).stdout
    return json.loads(out)


def decode_rgba(path: Path):
    """Decode the WebM with the libvpx-vp9 decoder (the one that reads alpha) to raw RGBA, streaming one frame at a time."""
    cmd = [
        _tool("ffmpeg"), "-v", "error", "-c:v", "libvpx-vp9", "-i", str(path),
        "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size = W * H * 4
    try:
        while True:
            buf = bytearray()
            while len(buf) < size:
                chunk = proc.stdout.read(size - len(buf))
                if not chunk:
                    break
                buf += chunk
            if len(buf) == 0:
                break
            assert len(buf) == size, "decoder produced a truncated frame"
            yield np.frombuffer(bytes(buf), dtype=np.uint8).reshape(H, W, 4)
    finally:
        proc.stdout.close()
        err = proc.stderr.read().decode("utf-8", "replace")
        code = proc.wait()
        assert code == 0, f"ffmpeg decode failed ({code}): {err[-300:]}"


def composite_on_magenta(rgba: np.ndarray):
    a = rgba[:, :, 3].astype(np.float32) / 255.0
    rgb = rgba[:, :, :3].astype(np.float32)
    comp = rgb * a[:, :, None] + MAGENTA * (1.0 - a[:, :, None])
    return a, comp


# --- fixtures -------------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def encoded():
    assert INPUT.is_file(), f"input missing: {INPUT}"
    assert rvm_loader.DEFAULT_WEIGHTS_PATH.is_file(), "RVM weights missing"
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)  # only our own previous inspection output
    OUT_DIR.mkdir(parents=True)
    rvm_loader.reset_model_cache()
    with mock.patch.object(torch, "load", wraps=torch.load) as spy:
        result = process_video(INPUT, quality="high", max_frames=FRAMES, output_path=OUT_WEBM)
        first_run_loads = spy.call_count
    return {"result": result, "first_run_loads": first_run_loads}


@pytest.fixture(scope="module")
def decoded(encoded):
    """Decode the WebM back to RGBA once; keep only the frames we inspect."""
    count, kept = 0, {}
    for i, frame in enumerate(decode_rgba(OUT_WEBM)):
        count += 1
        if i in CHECK_FRAMES:
            kept[i] = frame.copy()
    return {"count": count, "frames": kept}


# --- 1: container, codec, pixel format ------------------------------------------------------------------
def test_1_output_is_webm_vp9_yuva420p(encoded):
    assert OUT_WEBM.is_file() and OUT_WEBM.stat().st_size > 0
    assert OUT_WEBM.suffix == ".webm"
    head = OUT_WEBM.read_bytes()[:64]
    assert head[:4] == b"\x1a\x45\xdf\xa3" and b"webm" in head, "not an EBML file with DocType webm"
    native = ffprobe_json(OUT_WEBM, "-show_entries", "format=format_name:stream=codec_name,pix_fmt")
    assert "webm" in native["format"]["format_name"]
    assert native["streams"][0]["codec_name"] == "vp9"
    with_alpha_decoder = ffprobe_json(OUT_WEBM, "-c:v", "libvpx-vp9", "-show_entries", "stream=codec_name,pix_fmt")
    assert with_alpha_decoder["streams"][0]["pix_fmt"] == "yuva420p", with_alpha_decoder
    print(
        f"\n[1] format={native['format']['format_name']} codec={native['streams'][0]['codec_name']} "
        f"pix_fmt(libvpx-vp9 decoder)={with_alpha_decoder['streams'][0]['pix_fmt']} "
        f"(native vp9 decoder reports {native['streams'][0]['pix_fmt']!r} because it ignores WebM alpha)"
    )


# --- 2: alpha evidence -----------------------------------------------------------------------------------
def test_2_alpha_evidence(decoded):
    tags = ffprobe_json(OUT_WEBM, "-show_entries", "stream_tags=alpha_mode")["streams"][0].get("tags", {})
    tag_ok = str(tags.get("alpha_mode") or tags.get("ALPHA_MODE") or "") == "1"
    plane_ok = all(
        decoded["frames"][i][:, :, 3].min() < 13 and decoded["frames"][i][:, :, 3].max() > 242 for i in CHECK_FRAMES
    )
    print(f"\n[2] evidence: container tag alpha_mode={tags.get('alpha_mode')!r} (present={tag_ok}); decoded alpha plane has a real range={plane_ok}")
    # The tag may be absent, but then the decoded alpha plane must carry the proof. Both missing fails.
    assert tag_ok or plane_ok, "no alpha evidence: neither the alpha_mode tag nor a decoded alpha plane"
    assert plane_ok, "decoded alpha plane is missing or flat"


# --- 3 + 4: count, size, rate, no audio -------------------------------------------------------------------
def test_3_frames_size_rate(encoded, decoded):
    assert decoded["count"] == FRAMES, f"decoded {decoded['count']} frames, expected {FRAMES}"
    info = ffprobe_json(
        OUT_WEBM, "-count_packets", "-show_entries",
        "stream=width,height,r_frame_rate,avg_frame_rate,nb_read_packets:format=duration",
    )
    s = info["streams"][0]
    assert (s["width"], s["height"]) == (W, H)
    assert s["r_frame_rate"] == "25/1" and s["avg_frame_rate"] == "25/1"
    assert int(s["nb_read_packets"]) == FRAMES
    assert abs(float(info["format"]["duration"]) - FRAMES / FPS) < 0.02
    r = encoded["result"]
    assert (r["width"], r["height"], r["fps"], r["frames_encoded"]) == (W, H, 25.0, FRAMES)
    assert r["truncated"] is True and r["source_frame_count"] == 1218  # we did NOT process the whole video
    print(
        f"\n[3] decoded_frames={decoded['count']} size={s['width']}x{s['height']} r_frame_rate={s['r_frame_rate']} "
        f"packets={s['nb_read_packets']} duration={info['format']['duration']}s"
    )


def test_4_no_audio_stream_and_metadata(encoded):
    info = ffprobe_json(OUT_WEBM, "-show_entries", "stream=codec_type:format_tags")
    kinds = [s["codec_type"] for s in info["streams"]]
    assert kinds == ["video"], f"unexpected streams {kinds}"
    tags = {k.lower(): v for k, v in info["format"].get("tags", {}).items()}
    assert "audio stays on the source asset" in tags.get("finalpost_audio_policy", "")
    assert "audio stays on the source asset" in encoded["result"]["audio_policy"]
    print(f"\n[4] streams={kinds} container audio-policy tag={tags.get('finalpost_audio_policy')!r}")


# --- 5: decoded alpha is a real matte; composite over magenta ---------------------------------------------
def test_5_decoded_alpha_and_magenta_composite(encoded, decoded):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Inspection PNGs: ONLY frame 24. The composite comes from the DECODED webm.
    src_frame = None
    with VideoDecoder(INPUT) as dec:
        for i, f in enumerate(dec.frames(SHOT_INDEX + 1)):
            if i == SHOT_INDEX:
                src_frame = f
    assert src_frame is not None
    a24, comp24 = composite_on_magenta(decoded["frames"][SHOT_INDEX])
    cv2.imwrite(str(OUT_DIR / "frame-24-input.png"), src_frame)
    cv2.imwrite(str(OUT_DIR / "frame-24-alpha.png"), decoded["frames"][SHOT_INDEX][:, :, 3])
    cv2.imwrite(str(OUT_DIR / "frame-24-on-magenta.png"), cv2.cvtColor(np.clip(np.rint(comp24), 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))

    for idx in CHECK_FRAMES:
        a, comp = composite_on_magenta(decoded["frames"][idx])
        low, high = a < 0.05, a > 0.95
        near0, near1 = float((a <= 0.05).mean()), float((a >= 0.95).mean())
        assert near0 > 0.01 and near1 > 0.01, f"frame {idx}: alpha is not a real matte (near0={near0:.3f}, near1={near1:.3f})"
        dist_low = np.abs(comp[low] - MAGENTA).max(axis=1)
        assert dist_low.max() <= 13.0, f"frame {idx}: transparent pixels not magenta (max channel dist {dist_low.max():.1f})"
        # opaque pixels must not be magenta: count those within 40/255 per channel of (255, 0, 255)
        near_mag = (np.abs(comp[high] - MAGENTA) <= 40.0).all(axis=1)
        frac_magenta = float(near_mag.mean())
        assert frac_magenta < 0.005, f"frame {idx}: {frac_magenta:.2%} of opaque pixels look magenta"
        print(
            f"\n[5] frame {idx}: alpha<=0.05: {near0:.1%}  alpha>=0.95: {near1:.1%}  transparent->magenta max dist {dist_low.max():.2f}/255  "
            f"opaque pixels near magenta: {frac_magenta:.4%}"
        )
    print(f"[5] decoded alpha VERIFIED via libvpx-vp9 decode. Composite: {OUT_DIR / 'frame-24-on-magenta.png'}")


# --- 6: weights not reloaded -------------------------------------------------------------------------------
def test_6_second_run_does_not_reload_weights(encoded, tmp_path):
    assert encoded["first_run_loads"] == 1, "first process_video should have read the weight file exactly once"
    model_before = rvm_loader.get_model(rvm_loader.DEFAULT_WEIGHTS_PATH, rvm_loader.resolve_device())
    with mock.patch.object(torch, "load", wraps=torch.load) as spy:
        second = process_video(INPUT, quality="fast", max_frames=8, output_path=tmp_path / "second.webm")
        loads = spy.call_count
    model_after = rvm_loader.get_model(rvm_loader.DEFAULT_WEIGHTS_PATH, rvm_loader.resolve_device())
    assert loads == 0, f"second process_video reloaded weights ({loads} torch.load calls)"
    assert model_before is model_after
    assert second["frames_encoded"] == 8 and second["quality"] == "fast"
    # Per-call weight facts come from the run itself.
    assert second["weights_sha256"] == encoded["result"]["weights_sha256"]
    print(f"\n[6] first run torch.load calls={encoded['first_run_loads']}, second run={loads}; same module object={model_before is model_after}")


# --- 7: temp-file cleanup ----------------------------------------------------------------------------------
def test_7a_no_leftovers_after_successful_runs(encoded, tmp_path):
    names = sorted(p.name for p in OUT_DIR.iterdir())
    assert not [n for n in names if "partial" in n], names
    assert OUT_WEBM.is_file()  # the output itself is kept
    process_video(INPUT, quality="fast", max_frames=4, output_path=tmp_path / "x.webm")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["x.webm"]


def test_7b_killed_encoder_standalone_leaves_nothing(tmp_path):
    out = tmp_path / "killed.webm"
    frame = np.zeros((64, 64, 4), dtype=np.uint8)
    with pytest.raises(EncoderError):
        with TransparentWebmEncoder(out, 64, 64, 25.0, quality="fast") as enc:
            enc.write(frame)
            enc.write(frame)
            enc._proc.kill()
            enc._proc.wait()
            for _ in range(10):
                enc.write(frame)
    assert list(tmp_path.iterdir()) == [], "killed encoder left files behind"


def test_7c_killed_encoder_through_service_leaves_nothing(encoded, tmp_path):
    original = encoder_mod.TransparentWebmEncoder.write

    def killing_write(self, rgba):
        if self.frames_written == 2:
            self._proc.kill()
            self._proc.wait()
        return original(self, rgba)

    out = tmp_path / "killed-service.webm"
    with mock.patch.object(encoder_mod.TransparentWebmEncoder, "write", killing_write):
        with pytest.raises(EncoderError):
            process_video(INPUT, quality="fast", max_frames=10, output_path=out)
    assert list(tmp_path.iterdir()) == [], "service left files after the encoder was killed"


def test_7d_inference_failure_leaves_nothing(encoded, tmp_path):
    from human_matting.model.rvm_inference import RvmSession

    real = RvmSession.infer_frame
    calls = {"n": 0}

    def flaky(self, frame):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("simulated inference crash")
        return real(self, frame)

    with mock.patch.object(RvmSession, "infer_frame", flaky):
        with pytest.raises(RuntimeError, match="simulated inference crash"):
            process_video(INPUT, quality="fast", max_frames=10, output_path=tmp_path / "crash.webm")
    assert list(tmp_path.iterdir()) == []


# --- contract guards ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("fmt", ["prores", "png_sequence", "webm", "Transparent"])
def test_unsupported_output_format_raises(fmt):
    with pytest.raises(ValueError):
        process_video(INPUT, output_format=fmt, max_frames=1)


def test_quality_presets_both_keep_alpha_and_high_is_slower():
    def cmd(q):
        return TransparentWebmEncoder(Path("/tmp/never-written.webm"), 64, 64, 25.0, quality=q).command()

    high, fast = cmd("high"), cmd("fast")
    for c in (high, fast):
        assert c[c.index("-auto-alt-ref") + 1] == "0"
        assert c[c.index("-pix_fmt", c.index("libvpx-vp9")) + 1] == "yuva420p"
        assert "-an" in c and "libvpx-vp9" in c
    assert high[high.index("-deadline") + 1] == "good" and fast[fast.index("-deadline") + 1] == "realtime"
    assert int(high[high.index("-cpu-used") + 1]) < int(fast[fast.index("-cpu-used") + 1])  # lower cpu-used = slower


def test_report_run_facts(encoded):
    r = encoded["result"]
    assert r["frames_encoded"] == FRAMES and r["elapsed_sec"] > 0 and r["ms_per_frame"] > 0
    assert r["device"].split(":")[0] == rvm_loader.resolve_device().type
    assert r["weights_sha256"] == "3c7c1d92033f7c38d6577c481d13a195d7d80a159b960f4f3119ac7b534cf4f8"
    print(
        "\n[run] " + json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()}, indent=1)
    )
