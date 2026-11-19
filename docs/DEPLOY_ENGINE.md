# Deploying the engine (engine.kinmel.shop)

This replaces the stale `ai-video-engine/` instructions in the app repo (`docs/ai-video-engine-prod-deploy.md`,
`docs/ai-video-engine-standalone-droplet.md`). The engine lives in this repo, `finalpost_engine`
(`git@github.com:Nishannb/finalpost_engine.git`).

## How it is deployed (preferred)

Same shape as Flask (`kinmel-server`):

1. **Laptop:** commit + `git push` to GitHub.
2. **Droplet:** `git pull` then `./deploy/deploy.sh`.

Scripts live in [`deploy/`](../deploy/README.md):

| Script | Role |
|---|---|
| `deploy/deploy.sh` | install/build (or Docker image), restart systemd/Docker, health-check |
| `deploy/backup.sh` | snapshot `.env` + code tarball before a risky deploy |

```bash
# laptop
cd ~/Desktop/apps/finalpost/finalpost_engine-production
git push origin main

# droplet
ssh user@DROPLET
cd /opt/finalpost/ai-video-engine   # confirm path on the host
./deploy/backup.sh                 # optional
git pull --ff-only
./deploy/deploy.sh
# or: ./deploy/deploy.sh --pull
```

- Droplet `.env` is never overwritten by git (it is gitignored).
- Confirm on the host: directory (`/opt/finalpost/ai-video-engine` vs older `/opt/kinmel/ai-video-engine`), and route (`kinmel-video-engine.service` vs Docker).
- Remotion composition / site changes still need a **laptop** `npm run remotion:deploy` (AWS keys). The droplet script only ships the Node API.

### First-time conversion from rsync

If the droplet tree was filled by rsync and has no `.git`, convert once — see [`deploy/README.md`](../deploy/README.md).

### Rollback

```bash
cd /opt/finalpost/ai-video-engine
git checkout "$(cat .deploy-previous-sha)"
./deploy/deploy.sh
```

## Feature switches to set on deploy

- `EDIT_STYLES_ENABLED` (default **off**): the style picker. Off = `GET /v1/edit-styles` answers 404 and `style` is ignored,
  so the app uses its bundled manifest and the old mode-only request. Turn it on after this build is live.
- `EDIT_STYLES_AVAILABLE` / `EDIT_STYLES_ORDER`: make a style available or reorder styles without an app release.
- `ENTITLEMENT_ENFORCEMENT` must stay on in production (`CREATOR_API_URL` + `ENGINE_API_KEY` set).

## Legacy Route A: rsync + systemd

Prefer git + `./deploy/deploy.sh` above. Keep this only if the droplet is not yet a git checkout.

From the laptop:

```bash
rsync -avz --delete \
  --exclude .git --exclude node_modules --exclude '**/node_modules' --exclude '**/dist' \
  --exclude .env --exclude '.env.*' --exclude logs --exclude out --exclude remotion/out \
  --exclude remotion/public/_proof-beds --exclude '**/.venv*' --exclude '**/__pycache__' --exclude '**/.pytest_cache' \
  --exclude subjectmatte/weights \
  --exclude captionkit_tmp/previews --exclude captionkit_tmp/samples --exclude captionkit_tmp/gallery.html \
  ./ USER@DROPLET:/opt/finalpost/ai-video-engine/
```

Then on the droplet: `./deploy/deploy.sh` (if scripts are present) or manually `npm install && npm run build --workspace=server && sudo systemctl restart kinmel-video-engine`.

## Legacy Route B: Dockerfile only

```bash
cd /opt/finalpost/ai-video-engine
./deploy/deploy.sh --docker
```

Or manually:

```bash
docker build -t kinmel-video-engine .
docker rm -f kinmel-video-engine
docker run -d --name kinmel-video-engine \
  --env-file .env \
  -p 127.0.0.1:8090:8090 \
  --tmpfs /tmp \
  --restart unless-stopped \
  kinmel-video-engine
```
