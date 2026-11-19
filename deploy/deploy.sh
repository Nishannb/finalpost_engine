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

detect_route() {
  if [[ -n "$FORCE_ROUTE" ]]; then
    echo "$FORCE_ROUTE"
    return
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl cat kinmel-video-engine >/dev/null 2>&1; then
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
  echo "ERROR: neither systemd unit kinmel-video-engine nor Docker is available." >&2
  exit 1
}

ROUTE="$(detect_route)"
echo "==> Route: $ROUTE"

if [[ "$BUILD" -eq 1 ]]; then
  if [[ "$ROUTE" == "docker" ]]; then
    echo "==> Building Docker image kinmel-video-engine:$GIT_SHA"
    docker tag kinmel-video-engine "kinmel-video-engine:previous" 2>/dev/null || true
    docker build -t "kinmel-video-engine:$GIT_SHA" -t kinmel-video-engine:latest -t kinmel-video-engine .
  else
    echo "==> npm install"
    npm install
    echo "==> npm run build --workspace=server"
    npm run build --workspace=server
  fi
else
  echo "==> Skipping build (--no-build)"
fi

restart_systemd() {
  if ! systemctl cat kinmel-video-engine >/dev/null 2>&1; then
    echo "ERROR: systemd unit kinmel-video-engine not found." >&2
    echo "Install /etc/systemd/system/kinmel-video-engine.service (WorkingDirectory=$ROOT) first." >&2
    exit 1
  fi
  echo "==> systemctl restart kinmel-video-engine"
  sudo systemctl restart kinmel-video-engine
  sudo systemctl --no-pager --full status kinmel-video-engine || true
}

restart_docker() {
  echo "==> Recreating container kinmel-video-engine"
  docker rm -f kinmel-video-engine 2>/dev/null || true
  docker run -d --name kinmel-video-engine \
    --env-file "$ROOT/.env" \
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
      journalctl -u kinmel-video-engine -n 80 --no-pager >&2 || true
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
