#!/usr/bin/env bash
# FinalPost video engine — production deploy (run on the droplet after git pull).
#
# Mirrors kinmel-server's ./deploy/deploy.sh shape:
#   laptop:  git push
#   droplet: git pull && ./deploy/deploy.sh
#
# Usage:
#   ./deploy/deploy.sh
#   ./deploy/deploy.sh --pull          # git pull --ff-only, then deploy
#   ./deploy/deploy.sh --no-build      # restart / recreate only (env change)
#   ./deploy/deploy.sh --systemd       # force systemd route
#   ./deploy/deploy.sh --docker        # force Docker route
#
# Does not touch .env. Remotion Lambda site deploys separately from a laptop
# with AWS keys: npm run remotion:deploy

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PULL=0
BUILD=1
FORCE_ROUTE=""

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) PULL=1 ;;
    --no-build) BUILD=0 ;;
    --systemd) FORCE_ROUTE=systemd ;;
    --docker) FORCE_ROUTE=docker ;;
    -h|--help) usage 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage 1
      ;;
  esac
  shift
done

echo "==> Engine deploy in $ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.production.example → .env on the droplet and fill secrets." >&2
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "ERROR: $ROOT is not a git checkout." >&2
  echo "Convert the rsync tree first (see deploy/README.md), or clone Nishannb/finalpost_engine here." >&2
  exit 1
fi

if [[ "$PULL" -eq 1 ]]; then
  echo "==> git pull --ff-only"
  git pull --ff-only
fi

GIT_SHA="$(git rev-parse --short HEAD)"
# Remember the SHA that was running before this deploy (for rollback docs).
if [[ -f .deploy-running-sha ]]; then
  cp .deploy-running-sha .deploy-previous-sha
elif [[ ! -f .deploy-previous-sha ]]; then
  echo "$GIT_SHA" > .deploy-previous-sha
fi
echo "$GIT_SHA" > .deploy-running-sha

echo "==> Deploying git sha=$GIT_SHA (previous=$(cat .deploy-previous-sha))"

# Production unit on the engine droplet is `finalpost-engine.service`.
# Older docs used `kinmel-video-engine`; keep both for detect/restart.
SYSTEMD_UNITS=(finalpost-engine kinmel-video-engine)

detect_systemd_unit() {
  local unit
  for unit in "${SYSTEMD_UNITS[@]}"; do
    if command -v systemctl >/dev/null 2>&1 && systemctl cat "$unit" >/dev/null 2>&1; then
      echo "$unit"
      return 0
    fi
  done
  return 1
}

detect_route() {
  if [[ -n "$FORCE_ROUTE" ]]; then
    echo "$FORCE_ROUTE"
    return
  fi
  if detect_systemd_unit >/dev/null; then
    echo systemd
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'kinmel-video-engine'; then
    echo docker
    return
  fi
  if command -v systemctl >/dev/null 2>&1; then
    echo systemd
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    echo docker
    return
  fi
  echo "ERROR: neither systemd unit (finalpost-engine / kinmel-video-engine) nor Docker is available." >&2
  exit 1
}

ROUTE="$(detect_route)"
echo "==> Route: $ROUTE"

# CaptionKit (Get Captions) runs on the host Python and needs fontTools + PIL.
ensure_captionkit_deps() {
  local py="${CAPTIONKIT_PYTHON:-}"
  if [[ -z "$py" && -f .env ]]; then
    py="$(grep -E '^CAPTIONKIT_PYTHON=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  fi
  py="${py:-python3}"
  if "$py" -c 'import fontTools, PIL' >/dev/null 2>&1; then
    echo "==> CaptionKit deps OK (fontTools, PIL via $py)"
    return 0
  fi
  local cmd="apt-get install -y python3-fonttools python3-pil"
  echo "==> CaptionKit deps missing for $py; installing"
  if [[ "$(id -u)" -eq 0 ]]; then
    apt-get update -y && apt-get install -y python3-fonttools python3-pil || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y python3-fonttools python3-pil || true
  fi
  if ! "$py" -c 'import fontTools, PIL' >/dev/null 2>&1; then
    echo "ERROR: CaptionKit needs fontTools + PIL for $py. Run: sudo $cmd" >&2
    echo "(If CAPTIONKIT_PYTHON points at a venv: $py -m pip install fonttools pillow)" >&2
    exit 1
  fi
}

# Background music (systemd route only; the Docker image builds /app/agents/.venv itself). Without agents/.venv the engine runs the
# system python3, which lacks the audio libraries: every edit then has no music (music.summary fallbackReason=no_bed). 2026-11-26.
ensure_music_deps() {
  local mode
  mode="$(grep -E '^MUSIC_SPECIALIST=' .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/#.*//' | tr -d '"' | tr -d "'" | xargs || true)"
  if [[ -z "$mode" || "$mode" == "off" || "$mode" == "0" ]]; then
    return 0
  fi
  if agents/.venv/bin/python -c 'import pydub, pyloudnorm, numpy, scipy, librosa' >/dev/null 2>&1; then
    echo "==> Music specialist deps OK (agents/.venv)"
    return 0
  fi
  echo "==> Music specialist deps missing; installing agents/.venv (one time, a few minutes)"
  ./deploy/setup-music.sh >/dev/null || { echo "ERROR: ./deploy/setup-music.sh failed; music stays off until it succeeds" >&2; return 0; }
  echo "==> Music specialist deps installed"
}

if [[ "$BUILD" -eq 1 ]]; then
  if [[ "$ROUTE" == "docker" ]]; then
    echo "==> Building Docker image kinmel-video-engine:$GIT_SHA"
    docker tag kinmel-video-engine "kinmel-video-engine:previous" 2>/dev/null || true
    docker build -t "kinmel-video-engine:$GIT_SHA" -t kinmel-video-engine:latest -t kinmel-video-engine .
  else
    ensure_captionkit_deps
    ensure_music_deps
    echo "==> npm install"
    npm install
    echo "==> npm run build --workspace=server"
    npm run build --workspace=server
  fi
else
  echo "==> Skipping build (--no-build)"
fi

restart_systemd() {
  local unit
  unit="$(detect_systemd_unit || true)"
  if [[ -z "$unit" ]]; then
    echo "ERROR: systemd unit finalpost-engine / kinmel-video-engine not found." >&2
    echo "Install /etc/systemd/system/finalpost-engine.service (WorkingDirectory=$ROOT) first." >&2
    exit 1
  fi
  echo "==> systemctl restart $unit"
  sudo systemctl restart "$unit"
  sudo systemctl --no-pager --full status "$unit" || true
  SYSTEMD_UNIT="$unit"
}

restart_docker() {
  echo "==> Recreating container kinmel-video-engine"
  docker rm -f kinmel-video-engine 2>/dev/null || true
  # Speaker cutout (RVM): the venv + weights live on the HOST under /opt/finalpost/rvm (deploy/setup-rvm.sh) so a rebuild never deletes them.
  # Mount them at the same path so RVM_PYTHON / RVM_WEIGHTS_PATH in .env work inside the container too.
  local rvm_mount=()
  if [[ -d /opt/finalpost/rvm ]]; then
    rvm_mount=(-v /opt/finalpost/rvm:/opt/finalpost/rvm)
  fi
  docker run -d --name kinmel-video-engine \
    --env-file "$ROOT/.env" \
    "${rvm_mount[@]}" \
    -p 127.0.0.1:8090:8090 \
    --tmpfs /tmp \
    --restart unless-stopped \
    kinmel-video-engine:latest
}

case "$ROUTE" in
  systemd) restart_systemd ;;
  docker) restart_docker ;;
  *)
    echo "ERROR: unknown route $ROUTE" >&2
    exit 1
    ;;
esac

echo "==> Waiting for /health on 127.0.0.1:8090 ..."
for i in $(seq 1 45); do
  if curl -sf http://127.0.0.1:8090/health >/dev/null 2>&1; then
    echo "==> Health OK"
    break
  fi
  if [[ "$i" -eq 45 ]]; then
    echo "ERROR: engine not healthy after deploy." >&2
    if [[ "$ROUTE" == "systemd" ]]; then
      journalctl -u "${SYSTEMD_UNIT:-$(detect_systemd_unit || echo finalpost-engine)}" -n 80 --no-pager >&2 || true
    else
      docker logs --tail 80 kinmel-video-engine >&2 || true
    fi
    echo "Rollback: git checkout $(cat .deploy-previous-sha) && ./deploy/deploy.sh" >&2
    exit 1
  fi
  sleep 2
done

if curl -sf http://127.0.0.1:8090/capabilities >/dev/null 2>&1; then
  CAPS="$(curl -sf http://127.0.0.1:8090/capabilities || true)"
  echo "==> /capabilities: $CAPS"
else
  echo "WARN: /capabilities not reachable (health passed)."
fi

echo "==> Deploy complete (engine@$GIT_SHA, route=$ROUTE)"
echo "    Remotion UI changes still need: npm run remotion:deploy  (from a laptop with AWS keys)"
