#!/usr/bin/env bash
# One-time (safe to re-run) setup of the background-music specialist on a systemd droplet. The Docker image builds this itself (Dockerfile);
# on the systemd route the engine looks for agents/.venv and, without it, runs the system python3, which lacks the audio libraries.
#
#   ./deploy/setup-music.sh
#
# It only installs the Python environment and prints the .env lines. It never edits .env and never calls Runware.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/agents"
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg is required"; exit 1; }
python3 -m venv --help >/dev/null 2>&1 || sudo apt-get install -y python3-venv
[[ -x .venv/bin/python ]] || python3 -m venv .venv
.venv/bin/pip install --no-cache-dir --upgrade pip
.venv/bin/pip install --no-cache-dir pydub pyloudnorm numpy scipy librosa
.venv/bin/python -c "import pydub, pyloudnorm, numpy, scipy, librosa; print('music specialist deps OK')"
[[ -n "${QUIET:-}" ]] && exit 0
cat <<EOT

==> Done. To turn background music on, add to $ROOT/.env (then ./deploy/deploy.sh --no-build):

MUSIC_SPECIALIST=live
RUNWARE_API_KEY=<your Runware key>      # secret; generated beds cost about \$0.01 each, at most one paid bed per video
MUSIC_SPECIALIST_MAX_USD=0.02            # hard cap per generation (the engine default)

Without MUSIC_SPECIALIST the music step is OFF (every edit: no_bed). With it but no key, only the free pool beds are used.
EOT
