#!/usr/bin/env bash
# One-time (and safe to re-run) setup of the speaker cutout (Robust Video Matting) on the engine droplet.
# Run ON THE DROPLET from the engine checkout, after the weights file has been copied to /opt/finalpost/rvm/:
#
#   ./deploy/setup-rvm.sh
#
# What it does:
#   - creates /opt/finalpost/rvm/venv with CPU-only torch (no CUDA download) + the matting requirements,
#     built with the SAME Python the engine runs (inside the Docker image on the Docker route, the host python3 on systemd);
#   - checks the weights file and that ffmpeg has libvpx-vp9 (the cutout is a VP9 video with alpha);
#   - prints the .env lines to add. It never edits .env, never downloads weights, never calls a paid API.
set -euo pipefail

RVM_DIR=/opt/finalpost/rvm
WEIGHTS="$RVM_DIR/rvm_mobilenetv3.pth"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQ="$ROOT/subjectmatte/requirements-rvm.txt"

sudo mkdir -p "$RVM_DIR/cache"
sudo chown -R "$(id -u):$(id -g)" "$RVM_DIR"

if [[ ! -f "$WEIGHTS" ]]; then
  echo "ERROR: $WEIGHTS is missing. Copy it from your laptop first, e.g.:" >&2
  echo "  scp subjectmatte/weights/rvm_mobilenetv3.pth root@<droplet>:$WEIGHTS" >&2
  exit 1
fi
echo "==> weights: $(du -h "$WEIGHTS" | cut -f1)  sha256 $(sha256sum "$WEIGHTS" | cut -c1-16)…"
cp "$REQ" "$RVM_DIR/requirements-rvm.txt"

# The install, as a script both routes can run.
cat > "$RVM_DIR/install.sh" <<'EOS'
set -euo pipefail
cd /opt/finalpost/rvm
[[ -x venv/bin/python ]] || python3 -m venv venv
venv/bin/pip install --no-cache-dir --upgrade pip
# CPU wheels only: the default Linux torch wheel pulls ~2.5 GB of CUDA libraries a CPU droplet cannot use.
venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision
venv/bin/pip install --no-cache-dir numpy opencv-python-headless
venv/bin/python -c "import torch, cv2, numpy; print('torch', torch.__version__, 'threads', torch.get_num_threads())"
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libvpx-vp9 && echo "ffmpeg libvpx-vp9: ok" || { echo "ERROR: ffmpeg has no libvpx-vp9"; exit 1; }
EOS

if command -v docker >/dev/null 2>&1 && docker image inspect kinmel-video-engine:latest >/dev/null 2>&1 \
   && docker ps -a --format '{{.Names}}' | grep -qx kinmel-video-engine; then
  echo "==> Docker route: building the venv with the image's python"
  docker run --rm -v "$RVM_DIR:$RVM_DIR" --entrypoint bash kinmel-video-engine:latest "$RVM_DIR/install.sh"
else
  echo "==> systemd route: building the venv with the host python"
  command -v ffmpeg >/dev/null || { echo "ERROR: install ffmpeg first (apt install ffmpeg)"; exit 1; }
  python3 -m venv --help >/dev/null 2>&1 || sudo apt-get install -y python3-venv
  bash "$RVM_DIR/install.sh"
fi

cat <<EOF

==> Done. Add these lines to $ROOT/.env (names only, none are secrets), then run ./deploy/deploy.sh --no-build:

POLISH_KINETIC_ENGINE_MATTE=1
RVM_PYTHON=$RVM_DIR/venv/bin/python
RVM_WEIGHTS_PATH=$WEIGHTS
RVM_DEVICE=cpu
PERSON_MATTE_CACHE_DIR=$RVM_DIR/cache
MATTING_MAX_CONCURRENT=1
MATTING_TIMEOUT_SEC=900

Check with:  node scripts/rvm-preflight.mjs   (exit 0 = ready)
EOF
