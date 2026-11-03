"""Real-tensor proof that RVM recurrent-state inference works. No mocks of the model, no skips.

Run (from finalpost_engine/subjectmatte):
    PYTHONDONTWRITEBYTECODE=1 .venv-rvm/bin/python -m pytest -s -p no:cacheprovider human_matting/tests/test_rvm_recurrent.py

Two local clips, each read at most MAX_FRAMES frames, one frame at a time (never the whole file):
  * SAMPLE  captionkit_tmp/samples/sample.mp4  - the director-specified clip. It is a synthetic colour gradient with NO
            person, so RVM's alpha is exactly 0 everywhere and cannot reveal temporal state. On it we assert the
            same properties at the level that is observable: the four recurrent tensors and RVM's own foreground.
  * PERSON  remotion/public/hi.mp4              - a real talking-head clip. The alpha-level assertions (3, 4) run here,
            guarded by a precondition that alpha is non-degenerate so they cannot pass vacuously.
Missing weights / clips, or too few decoded frames, FAIL (they are never skipped).
"""
from __future__ import annotations

import os
import sys
import time
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
from human_matting.model.rvm_inference import RvmSession, auto_downsample_ratio  # noqa: E402

_ENGINE = _SUBJECTMATTE.parent
SAMPLE = _ENGINE / "captionkit_tmp" / "samples" / "sample.mp4"
PERSON = _ENGINE / "remotion" / "public" / "hi.mp4"
WEIGHTS = rvm_loader.DEFAULT_WEIGHTS_PATH
MAX_FRAMES = 24
CARRIED_FRAME_INDEX = 8  # "a frame after the first", late enough for the state to have evolved
REPLAY_FRAMES = 2
REPLAY_ATOL = 1e-4  # same weights, same input, same device: reset must reproduce the first run


def iter_frames(video: Path, limit: int):
    """Yield RGB uint8 HxWx3 frames one at a time."""
    cap = cv2.VideoCapture(str(video))
    assert cap.isOpened(), f"cannot open {video}"
    try:
        for _ in range(limit):
            ok, bgr = cap.read()
            if not ok:
                return
            yield cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    finally:
        cap.release()


def _clone_state(session: RvmSession):
    return tuple(None if r is None else r.detach().clone() for r in session.recurrent_state)


def stream(model, video: Path, label: str) -> dict:
    """One 'video' through a fresh session: reset, then MAX_FRAMES sequential frames. Keeps only what the tests need."""
    assert video.is_file(), f"{label} clip missing: {video}"
    session = RvmSession(model)
    session.reset()
    out = dict(label=label, video=video, session=session, state_after_reset=session.recurrent_state, per_frame_ms=[], alphas={}, fgrs={})
    wall_start = time.perf_counter()
    n = 0
    for idx, frame in enumerate(iter_frames(video, MAX_FRAMES)):
        n += 1
        if idx == 0:
            out["first_frame"] = frame
        if idx == CARRIED_FRAME_INDEX:
            out["carried_frame"] = frame
        fgr, pha = session.infer_frame(frame)
        out["per_frame_ms"].append(session.last_frame_ms)
        if idx < REPLAY_FRAMES:
            out["alphas"][idx] = pha
            out["fgrs"][idx] = fgr
        if idx == 1:
            out["state_after_two"] = _clone_state(session)
        if idx == CARRIED_FRAME_INDEX:
            out["carried_alpha"], out["carried_fgr"], out["carried_state"] = pha, fgr, _clone_state(session)
    out["wall_s"] = time.perf_counter() - wall_start
    out["frames"] = n
    assert n == MAX_FRAMES, f"{label}: only {n} frames decoded, expected {MAX_FRAMES}; inference did not run on enough frames"
    return out


def fresh_single_frame(model, frame: np.ndarray):
    """The SAME frame pushed through a brand-new session right after reset(): empty recurrent state."""
    s = RvmSession(model)
    s.reset()
    fgr, pha = s.infer_frame(frame)
    return fgr, pha, _clone_state(s)


def _max_state_diff(a, b) -> float:
    return max(float((x - y).abs().max()) for x, y in zip(a, b))


@pytest.fixture(scope="module")
def loaded():
    assert WEIGHTS.is_file(), f"weights missing: {WEIGHTS} (download the official rvm_mobilenetv3.pth)"
    device = rvm_loader.resolve_device()  # honours RVM_DEVICE, default auto
    rvm_loader.reset_model_cache()
    # Test 1 evidence: count real torch.load calls (the only place the weight file is read).
    with mock.patch.object(torch, "load", wraps=torch.load) as load_spy:
        model_a = rvm_loader.get_model(WEIGHTS, device)
        model_b = rvm_loader.get_model(WEIGHTS, device)
        weight_reads = load_spy.call_count
    return dict(device=device, model_a=model_a, model_b=model_b, weight_reads=weight_reads)


@pytest.fixture(scope="module")
def sample(loaded):
    return stream(loaded["model_a"], SAMPLE, "sample (gradient, no person)")


@pytest.fixture(scope="module")
def person(loaded):
    return stream(loaded["model_a"], PERSON, "person (talking head)")


# --- 1 ---------------------------------------------------------------------------------------------------
def test_1_model_loaded_once(loaded):
    assert loaded["model_a"] is loaded["model_b"], "second get_model() returned a different module object"
    assert loaded["weight_reads"] == 1, f"weight file was read {loaded['weight_reads']} times, expected 1"
    assert rvm_loader.get_model(WEIGHTS, loaded["device"]) is loaded["model_a"]  # still the cached object


# --- 2 ---------------------------------------------------------------------------------------------------
def test_2_state_empty_after_reset_populated_after_two_frames(sample):
    assert all(r is None for r in sample["state_after_reset"]), "recurrent state not empty after reset()"
    assert len(sample["state_after_two"]) == 4
    for i, r in enumerate(sample["state_after_two"]):
        assert isinstance(r, torch.Tensor) and r.numel() > 0, f"recurrent state r{i + 1} not populated after two frames"
        assert torch.isfinite(r).all(), f"recurrent state r{i + 1} has non-finite values"
    assert sample["session"].has_state


# --- 3 ---------------------------------------------------------------------------------------------------
def test_3a_state_matters_sample_recurrent_tensors_and_foreground(loaded, sample):
    """sample.mp4 has no person, so alpha is flat 0 either way; state shows up in the recurrent tensors and fgr."""
    fgr_f, pha_f, state_f = fresh_single_frame(loaded["model_a"], sample["carried_frame"])
    state_diff = _max_state_diff(sample["carried_state"], state_f)
    fgr_diff = int(np.abs(sample["carried_fgr"].astype(np.int16) - fgr_f.astype(np.int16)).max())
    print(
        f"\n[temporal/sample] frame {CARRIED_FRAME_INDEX}: recurrent max|carried-fresh|={state_diff:.4f}, "
        f"fgr max|diff|={fgr_diff}/255, alpha max (carried,fresh)=({sample['carried_alpha'].max():.4f}, {pha_f.max():.4f}) "
        "[alpha is 0 on a clip with no person, so it cannot show state]"
    )
    assert state_diff > 1e-3, "recurrent tensors with carried state equal those after reset: state is not being carried"
    assert fgr_diff > 0, "foreground with carried state is identical to foreground after reset"


def test_3b_state_matters_person_alpha(loaded, person):
    """The alpha-level assertion. Same frame, carried state vs state right after reset(): must NOT be identical."""
    carried_alpha = person["carried_alpha"]
    assert float(carried_alpha.max()) > 0.9 and float(carried_alpha.mean()) > 0.01, (
        "precondition failed: the person clip produced a degenerate alpha, this test would be vacuous"
    )
    _, fresh_alpha, _ = fresh_single_frame(loaded["model_a"], person["carried_frame"])
    diff = np.abs(carried_alpha - fresh_alpha)
    print(
        f"\n[temporal/person] frame {CARRIED_FRAME_INDEX}: carried-vs-reset alpha max|diff|={diff.max():.4f} "
        f"mean|diff|={diff.mean():.6f} (mean alpha carried={carried_alpha.mean():.4f}, fresh={fresh_alpha.mean():.4f})"
    )
    assert not np.array_equal(carried_alpha, fresh_alpha), "alpha with carried state is bit-identical to alpha after reset: state is not being used"
    assert diff.max() > 1e-4, f"carried and fresh alpha differ only by float noise (max {diff.max():.3e}): state is not being used"


# --- 4 ---------------------------------------------------------------------------------------------------
def _replay(model, video: Path):
    """Reset, replay from frame 0, return (alphas, fgrs, state after frame 2) for REPLAY_FRAMES frames."""
    s = RvmSession(model)
    s.reset()
    assert not s.has_state
    alphas, fgrs = {}, {}
    for idx, frame in enumerate(iter_frames(video, REPLAY_FRAMES)):
        fgrs[idx], alphas[idx] = s.infer_frame(frame)
    return alphas, fgrs, _clone_state(s)


def test_4a_reset_replays_sample_exactly(loaded, sample):
    session = sample["session"]
    session.reset()  # the same session object that just ran 24 frames: reset must make it a fresh video
    assert not session.has_state
    first_state = sample["state_after_two"]
    for idx, frame in enumerate(iter_frames(SAMPLE, REPLAY_FRAMES)):
        fgr, pha = session.infer_frame(frame)
        a_diff = float(np.abs(pha - sample["alphas"][idx]).max())
        f_diff = int(np.abs(fgr.astype(np.int16) - sample["fgrs"][idx].astype(np.int16)).max())
        print(f"\n[replay/sample] frame {idx}: alpha max|diff|={a_diff:.3e}, fgr max|diff|={f_diff}")
        assert a_diff <= REPLAY_ATOL and f_diff == 0
    state_diff = _max_state_diff(first_state, _clone_state(session))
    print(f"[replay/sample] recurrent state after frame 2: max|diff| vs first run={state_diff:.3e}")
    assert state_diff <= REPLAY_ATOL


def test_4b_reset_replays_person_alpha(loaded, person):
    assert float(person["alphas"][0].mean()) > 0.01, "precondition failed: frame-0 alpha is degenerate, replay check would be vacuous"
    alphas, _, _ = _replay(loaded["model_a"], PERSON)
    for idx in range(REPLAY_FRAMES):
        diff = float(np.abs(alphas[idx] - person["alphas"][idx]).max())
        print(f"\n[replay/person] frame {idx}: alpha max|diff| vs first video = {diff:.3e} (mean alpha {alphas[idx].mean():.4f})")
        assert diff <= REPLAY_ATOL, f"frame {idx} alpha after reset+replay differs from first run by {diff:.3e}"


# --- 5 ---------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("which", ["sample", "person"])
def test_5_output_shapes_and_types(request, which):
    run = request.getfixturevalue(which)
    frame = run["first_frame"]
    h, w = frame.shape[:2]
    fgr, pha = run["fgrs"][0], run["alphas"][0]
    assert fgr.shape == (h, w, 3) and fgr.dtype == np.uint8, f"foreground {fgr.shape} {fgr.dtype}"
    assert pha.shape == (h, w) and pha.ndim == 2 and pha.dtype == np.float32, f"alpha {pha.shape} {pha.dtype}"
    assert 0.0 <= float(pha.min()) and float(pha.max()) <= 1.0 and np.isfinite(pha).all()
    assert not np.array_equal(fgr, frame), "foreground is identical to the input frame (not RVM's fgr output)"
    # Aspect preserved + official auto ratio, held for the whole video.
    assert run["session"].downsample_ratio == pytest.approx(min(512 / max(h, w), 1))
    assert run["session"].frames_total >= MAX_FRAMES


# --- 6 ---------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("which", ["sample", "person"])
def test_6_report_device_and_timing(request, loaded, which):
    run = request.getfixturevalue(which)
    session, ms = run["session"], run["per_frame_ms"]
    assert run["frames"] == MAX_FRAMES and session.frames_total >= MAX_FRAMES
    # Where inference really ran: the model parameters AND the output tensors.
    assert session.device.type == loaded["device"].type
    assert session.last_output_device is not None and session.last_output_device.type == loaded["device"].type
    h, w = run["first_frame"].shape[:2]
    print(
        f"\n[rvm-report: {run['label']}]"
        f"\n  policy                : RVM_DEVICE={os.environ.get(rvm_loader.DEVICE_ENV, 'auto')}"
        f"\n  device actually used  : {session.device} (outputs on {session.last_output_device}); "
        f"cuda_available={torch.cuda.is_available()} mps_available={torch.backends.mps.is_available()}"
        f"\n  torch                 : {torch.__version__}"
        f"\n  frame size (HxW)      : {h}x{w}, downsample_ratio={session.downsample_ratio:.4f}"
        f"\n  frames processed      : {run['frames']}"
        f"\n  total wall time       : {run['wall_s']:.3f} s (includes first-call warm-up)"
        f"\n  ms/frame (all frames) : {run['wall_s'] * 1000.0 / run['frames']:.1f}"
        f"\n  first frame           : {ms[0]:.1f} ms (warm-up)"
        f"\n  ms/frame (frames 2-{run['frames']}) : mean {np.mean(ms[1:]):.1f}, median {np.median(ms[1:]):.1f}, max {np.max(ms[1:]):.1f}"
        "\n  note                  : per-frame inference latency measured on this machine; not a real-time claim."
    )
