"""
FinalPost speaker cutout (Robust Video Matting) on a Modal GPU.

The engine droplet has no GPU: RVM on CPU is ~0.5 s per 1080x1920 frame (measured 2026-11-26), so a 30 s clip blows the
900 s matting timeout. This worker runs the SAME code (human_matting.cli, the same flags) on a T4 and returns the
same two artefacts the local process writes: the VP9 yuva420p WebM and the result JSON. The engine side is
server/src/media/remoteRvm.ts; everything after it (cache, quality gate, foreground compose) is unchanged.

Contract (POST /matte, JSON):
    {"video_url": "https://...mp4", "args": ["--quality", "high", "--ranges", "0-12.5", "--alpha-only", ...]}
    Authorization: Bearer <RVM_WORKER_TOKEN>
  200 -> body = the WebM bytes, header X-Matting-Result = base64(result JSON)
  4xx -> bad request / auth; 422 -> the tool failed (body = last stderr line); 504 -> tool timeout

Deploy (from this repo, with the weights file on your laptop):
    pip install modal && modal setup
    modal secret create finalpost-rvm RVM_WORKER_TOKEN=<long random string>
    RVM_WEIGHTS_LOCAL=/path/to/rvm_mobilenetv3.pth modal deploy subjectmatte/modal_app.py
The printed URL (…modal.run) + /matte goes to the engine env as RVM_REMOTE_URL, the token as RVM_REMOTE_TOKEN.

Costs: billed per GPU-second while a request runs (plus a short idle window). The container scales to zero.
"""

from __future__ import annotations

import base64
import hmac
import os
import subprocess
import tempfile
from pathlib import Path

import modal

from modal_args import validate_args

HERE = Path(__file__).resolve().parent
WEIGHTS_LOCAL = Path(os.environ.get("RVM_WEIGHTS_LOCAL", HERE / "weights" / "rvm_mobilenetv3.pth")).expanduser()
REMOTE_ROOT = "/root/subjectmatte"

MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024  # a 2-minute 4K phone clip fits; anything bigger is refused
TOOL_TIMEOUT_SEC = 840  # under the engine's MATTING_TIMEOUT_SEC (900)

if modal.is_local() and not WEIGHTS_LOCAL.is_file():
    raise SystemExit(f"RVM weights not found at {WEIGHTS_LOCAL}; set RVM_WEIGHTS_LOCAL to rvm_mobilenetv3.pth")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")  # Debian's ffmpeg has libvpx-vp9 (alpha WebM)
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "numpy==1.26.4",
        "opencv-python-headless==4.10.0.84",
        "fastapi[standard]==0.115.6",
        "requests==2.32.3",
    )
    .env({"RVM_DEVICE": "cuda", "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"})
    .add_local_dir(HERE / "human_matting", f"{REMOTE_ROOT}/human_matting", ignore=["**/__pycache__", "**/tests"])
    .add_local_dir(HERE / "vendor", f"{REMOTE_ROOT}/vendor", ignore=["**/__pycache__"])
    .add_local_file(WEIGHTS_LOCAL, f"{REMOTE_ROOT}/weights/rvm_mobilenetv3.pth")
    .add_local_python_source("modal_args")
)

app = modal.App("finalpost-rvm")


@app.function(
    image=image,
    gpu="T4",
    timeout=900,
    scaledown_window=60,
    max_containers=4,
    secrets=[modal.Secret.from_name("finalpost-rvm")],
)
@modal.asgi_app()
def web():
    import requests
    from fastapi import FastAPI, Header, HTTPException, Request
    from fastapi.responses import Response

    api = FastAPI()

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/matte")
    async def matte(request: Request, authorization: str = Header(default="")):
        token = os.environ.get("RVM_WORKER_TOKEN", "")
        given = authorization[7:] if authorization.startswith("Bearer ") else ""
        if not token or not hmac.compare_digest(given, token):
            raise HTTPException(status_code=401, detail="unauthorized")
        body = await request.json()
        url = body.get("video_url") if isinstance(body, dict) else None
        if not isinstance(url, str) or not url.startswith("https://"):
            raise HTTPException(status_code=400, detail="video_url must be https")
        try:
            flags = validate_args(body.get("args", []))
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))

        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "input.mp4"
            out = Path(tmp) / "matte.webm"
            report = Path(tmp) / "result.json"
            with requests.get(url, stream=True, timeout=(10, 120), allow_redirects=False) as r:
                if r.status_code != 200:
                    raise HTTPException(status_code=400, detail=f"download failed: HTTP {r.status_code}")
                size = 0
                with open(src, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        size += len(chunk)
                        if size > MAX_DOWNLOAD_BYTES:
                            raise HTTPException(status_code=413, detail="video too large")
                        fh.write(chunk)
            try:
                run = subprocess.run(
                    ["python", "-m", "human_matting.cli", str(src), str(out), str(report), *flags],
                    cwd=REMOTE_ROOT, capture_output=True, text=True, timeout=TOOL_TIMEOUT_SEC,
                )
            except subprocess.TimeoutExpired:
                raise HTTPException(status_code=504, detail="matting timed out")
            if run.returncode != 0 or not out.is_file() or not report.is_file():
                last = (run.stderr.strip().splitlines() or [""])[-1][:300]
                return Response(content=f"exit {run.returncode}: {last}", status_code=422, media_type="text/plain")
            result = base64.b64encode(report.read_bytes()).decode("ascii")
            return Response(content=out.read_bytes(), media_type="video/webm", headers={"X-Matting-Result": result})

    return api
