#!/usr/bin/env bash
# FinalPost video engine — lightweight backup before a deploy (run on the droplet).
#
# Usage:
#   ./deploy/backup.sh
#
# Saves:
#   - .env (secrets)
#   - current git SHA
#   - a code tarball (no node_modules / .venv / logs / out)
#
# Cron example (optional, daily 03:30 UTC):
#   30 3 * * * /opt/finalpost/ai-video-engine/deploy/backup.sh >> /var/log/finalpost-engine-backup.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/finalpost-engine-backups}"
DEST="$BACKUP_ROOT/$STAMP"

mkdir -p "$DEST"

echo "==> Engine backup $STAMP → $DEST"

if [[ -f .env ]]; then
  cp -a .env "$DEST/.env"
  chmod 600 "$DEST/.env"
fi

if [[ -d .git ]]; then
  git rev-parse HEAD > "$DEST/git-sha.txt" 2>/dev/null || echo unknown > "$DEST/git-sha.txt"
  git status --short > "$DEST/git-status.txt" 2>/dev/null || true
fi

if [[ -f .deploy-running-sha ]]; then
  cp -a .deploy-running-sha "$DEST/deploy-running-sha"
fi

tar --exclude='./node_modules' \
  --exclude='./server/node_modules' \
  --exclude='./remotion/node_modules' \
  --exclude='./.venv*' \
  --exclude='./subjectmatte/.venv-rvm' \
  --exclude='./subjectmatte/weights' \
  --exclude='./subjectmatte/out' \
  --exclude='./agents/.venv' \
  --exclude='./logs' \
  --exclude='./out' \
  --exclude='./remotion/out' \
  --exclude='./.cache' \
  --exclude='./.git' \
  -czf "$DEST/engine-code.tar.gz" \
  -C "$ROOT" .

# Prune backups older than 14 days
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

echo "==> Backup complete: $DEST"
ls -lah "$DEST"
