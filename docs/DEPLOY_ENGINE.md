# Deploying the engine (engine.kinmel.shop)

This replaces the stale `ai-video-engine/` instructions in the app repo (`docs/ai-video-engine-prod-deploy.md`,
`docs/ai-video-engine-standalone-droplet.md`). The engine now lives in this repo, `finalpost_engine`
(`git@github.com:Nishannb/finalpost_engine.git`), not in `ai-video-engine/` and not in `Nishannb/AI-Video-editor-engine`.

## How it is deployed today

There is **no CI and no automated deploy** for the engine: no GitHub workflow, `fly.toml`, `render.yaml` or compose file.
Production is a DigitalOcean droplet behind nginx (`engine.kinmel.shop` → `127.0.0.1:8090`), and the code reaches it by
**`rsync` from the local folder on the laptop**, not from git. Evidence: production has run code that was never committed
(the entitlement check, `full_edit` durable jobs, `basic_captions`), which only an rsync of the working folder ships.

Consequences:

- **What is on the laptop's disk is what ships**, including uncommitted and untracked files. Commit before you deploy
  if you want to be able to tell later what is running.
- `captionkit_tmp/` runtime files (`captionkit.py`, `presets.json`, `fonts/` with their licences) are committed; `previews/`,
  `samples/` and `gallery.html` are generated and gitignored (exclude them from the sync, below).
- rsync's `--exclude .env` does not cover other `.env.*` files (for example a `.env.parked-for-tests` left by a test run): exclude
  `.env.*` too, and check `git status` before syncing.

Things to confirm on the droplet before relying on this page (not verifiable from the repo):

- the target directory (older docs used `/opt/kinmel/ai-video-engine/`);
- whether the service runs under systemd (`kinmel-video-engine.service`) or Docker;
- that the droplet's `.env` has the production values listed in `.env.production.example`.

## Route 1: rsync + systemd (what the old docs describe)

From the laptop, sync **from this repo's folder** (today: `~/Desktop/apps/creators_kinmel/finalpost_engine/`, or a
worktree you deploy from, such as `~/Desktop/apps/finalpost_engine-edit-styles/`):

```bash
rsync -avz --delete \
  --exclude .git --exclude node_modules --exclude '**/node_modules' --exclude '**/dist' \
  --exclude .env --exclude '.env.*' --exclude logs --exclude out --exclude remotion/out \
  --exclude remotion/public/_proof-beds --exclude '**/.venv*' --exclude '**/__pycache__' --exclude '**/.pytest_cache' \
  --exclude subjectmatte/weights \
  --exclude captionkit_tmp/previews --exclude captionkit_tmp/samples --exclude captionkit_tmp/gallery.html \
  ./ USER@DROPLET:/opt/kinmel/ai-video-engine/
```

- `--exclude .env` keeps the droplet's own production `.env`; never sync the laptop's `.env`.
- `--delete` removes files that no longer exist locally; drop it for the first sync if unsure.
- RVM weights and the RVM virtualenv are provisioned on the host, not synced (see the Dockerfile comment).

On the droplet:

```bash
cd /opt/kinmel/ai-video-engine
npm install
npm run build --workspace=server
sudo systemctl restart kinmel-video-engine
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8090/capabilities   # expect "renderMode": "lambda"
```

## Route 2: the Dockerfile

The `Dockerfile` builds from the **local build context**, so it ships whatever is in the folder (same caveat as above).
It contains only the server, CaptionKit, the RVM code and the music specialist; Remotion is deployed separately to Lambda.
`.dockerignore` keeps `.env`, `node_modules`, `dist` and `remotion/` out of the image.

```bash
cd /opt/kinmel/ai-video-engine        # after the rsync above, or build locally and ship the image
docker build -t kinmel-video-engine .
docker run -d --name kinmel-video-engine \
  --env-file .env \
  -p 127.0.0.1:8090:8090 \
  --tmpfs /tmp \
  --restart unless-stopped \
  kinmel-video-engine
```

The container runs as uid 10001, listens on 8090 and has a `/health` healthcheck.

## Feature switches to set on deploy

- `EDIT_STYLES_ENABLED` (default **off**): the style picker. Off = `GET /v1/edit-styles` answers 404 and `style` is ignored,
  so the app uses its bundled manifest and the old mode-only request. Turn it on after this build is live.
- `EDIT_STYLES_AVAILABLE` / `EDIT_STYLES_ORDER`: make a style available or reorder styles without an app release.
- `ENTITLEMENT_ENFORCEMENT` must stay on in production (`CREATOR_API_URL` + `ENGINE_API_KEY` set).

## Rollback

Keep the previous folder (or image tag) next to the new one; rollback is syncing / running the previous one and restarting.
With rsync there is no history on the droplet, so tag what you deployed: `git tag deploy-YYYYMMDD` on the commit you synced.
