# Engine deploy (same shape as Flask `kinmel-server`)

| | Flask API | Video engine |
|---|---|---|
| Repo | `kinmel-server` | `finalpost_engine` (`Nishannb/finalpost_engine`) |
| On droplet | `/opt/kinmel-server` | usually `/opt/finalpost/ai-video-engine` (confirm on host) |
| Ship code | `git push` → `git pull` | same |
| Restart | `./deploy/deploy.sh` | `./deploy/deploy.sh` |
| Secrets | droplet `.env` (never committed) | same |

Remotion Lambda site deploys are still from a **laptop** with AWS keys (`npm run remotion:deploy`). The droplet script only ships the Node API.

## Everyday deploy

### Laptop

```bash
cd ~/Desktop/apps/finalpost/finalpost_engine-production
git status
# commit your engine changes
git push origin main   # or your release branch
```

### Droplet

```bash
ssh <user>@<engine-droplet>
cd /opt/finalpost/ai-video-engine   # or whatever ENGINE_DIR is

./deploy/backup.sh                  # optional but recommended
git pull --ff-only
./deploy/deploy.sh
```

One-liner equivalent:

```bash
cd /opt/finalpost/ai-video-engine && ./deploy/backup.sh && ./deploy/deploy.sh --pull
```

Health checks are built in (`/health`, prints `/capabilities`).

## First time: turn the rsync tree into a git checkout

Production used to be filled by `rsync` (often **without** `.git`). Convert once:

```bash
# On the droplet — paths are examples; confirm ENGINE_DIR first
ENGINE_DIR=/opt/finalpost/ai-video-engine
cd "$(dirname "$ENGINE_DIR")"
STAMP=$(date +%Y%m%d-%H%M)
sudo cp -a "$(basename "$ENGINE_DIR")" "$(basename "$ENGINE_DIR").pre-git-$STAMP"

# Keep production .env aside
cp "$ENGINE_DIR/.env" "/tmp/engine.env.$STAMP"
chmod 600 "/tmp/engine.env.$STAMP"

# Fresh clone next to the old tree
git clone https://github.com/Nishannb/finalpost_engine.git "ai-video-engine.git-$STAMP"
# Private repo SSH alternative:
# git clone git@github.com:Nishannb/finalpost_engine.git "ai-video-engine.git-$STAMP"

# Swap into place
sudo mv "$(basename "$ENGINE_DIR")" "$(basename "$ENGINE_DIR").rsync-legacy-$STAMP"
sudo mv "ai-video-engine.git-$STAMP" "$(basename "$ENGINE_DIR")"
cp "/tmp/engine.env.$STAMP" "$ENGINE_DIR/.env"
chmod 600 "$ENGINE_DIR/.env"

cd "$ENGINE_DIR"
# Point systemd WorkingDirectory / EnvironmentFile at this path if needed, then:
./deploy/deploy.sh
```

If the unit file still points at `/opt/kinmel/ai-video-engine`, either keep deploying there or update the unit + nginx assumptions to `/opt/finalpost/ai-video-engine`.

## Rollback

```bash
cd /opt/finalpost/ai-video-engine
PREV=$(cat .deploy-previous-sha)
git checkout "$PREV"
./deploy/deploy.sh
# later: git checkout main && git pull && ./deploy/deploy.sh
```

Docker route also tags `kinmel-video-engine:previous` on each build.

## Flags

| Flag | Meaning |
|---|---|
| `--pull` | `git pull --ff-only` before install/build |
| `--no-build` | restart only (env / unit change) |
| `--systemd` | force systemd restart |
| `--docker` | force image rebuild + container recreate |

## What this does not do

- Does not sync laptop `.env` (droplet `.env` stays authoritative)
- Does not deploy Remotion Lambda / the Remotion site
- Does not deploy Flask (`api.kinmel.shop`) — that remains `/opt/kinmel-server` + `./deploy/deploy.sh`
