# Deploy sheet: all 4 edit styles (Flask, then engine)

Run in order. `<...>` = fill in. Paste the output of every `# CHECK` line back.

## 0. Droplet check (engine droplet, read-only)
```bash
nproc; free -h; swapon --show; df -h /; uptime                       # CHECK
journalctl -k --since "30 days ago" | grep -ci 'out of memory'       # CHECK (expect 0)
systemctl is-active kinmel-video-engine 2>/dev/null; docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null   # CHECK: systemd or docker
ls -d /opt/kinmel/ai-video-engine /opt/kinmel/finalpost_engine 2>/dev/null                                   # CHECK: <ENGINE_DIR>
grep -E '^(PRODUCT_EDIT_PROFILE|EDIT_STYLES[A-Z_]*|GEMINI_EDIT_MAX_REQUESTS|CLAUDE_EDIT_BUDGET_USD)=' <ENGINE_DIR>/.env   # CHECK
```
Need: RAM >= 2 GB (>= 4 GB comfortable) and no OOM kills, >= 2 vCPU, >= 5 GB free disk. Less RAM: add swap first
(`sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`).

## 1. Flask (api.kinmel.shop, /opt/kinmel-server)
```bash
# CHECK first: does prod already have the route? (run on the ENGINE droplet)
KEY=$(grep '^ENGINE_API_KEY=' <ENGINE_DIR>/.env | cut -d= -f2-); curl -s -w '\nHTTP %{http_code}\n' -H "x-engine-key: $KEY" "https://api.kinmel.shop/creator/internal/entitlement?userId=<free user id>"; unset KEY
# 200 + "verified": true  -> skip to 2.   404 -> deploy below.   401 -> ENGINE_API_KEY differs: set Flask's to the engine's value, then redeploy.
```
Deploy (on the Flask VPS):
```bash
cd /opt/kinmel-server
./deploy/backup.sh
git rev-parse HEAD > ~/flask-rollback-sha.txt; cp .env ~/flask-env-pre-styles
git status --short                                   # CHECK: must be empty (else stop and paste it)
# .env: ENGINE_API_KEY=<same as engine>  REVENUECAT_SECRET_API_KEY=sk_...  REVENUECAT_PRO_ENTITLEMENT_ID=finalpost_pro
#       (optional) REVENUECAT_PRO_PLUS_ENTITLEMENT_ID=...  FCM_SERVICE_ACCOUNT_PATH=/opt/kinmel-server/keys/fcm.json  FIREBASE_PROJECT_ID=finalpost-208b4
git fetch origin && git checkout feat/edit-styles
./deploy/deploy.sh                                   # CHECK: ends with "Deploy complete"
curl -fsS http://127.0.0.1:8080/health               # CHECK
```
Health: re-run the entitlement curl for a free and a Pro user -> `200`, `"plan": "free"` / `"pro"`, `"verified": true`.
Rollback: `cd /opt/kinmel-server && git checkout $(cat ~/flask-rollback-sha.txt) && cp ~/flask-env-pre-styles .env && ./deploy/deploy.sh`

## 2. Engine (engine.kinmel.shop, <ENGINE_DIR>)

### 2a. Backup (droplet)
```bash
cd <ENGINE_DIR>/.. && STAMP=$(date +%Y%m%d-%H%M)
sudo cp -a <ENGINE_DIR> <ENGINE_DIR>.pre-styles-$STAMP && echo $STAMP > ~/engine-rollback-stamp.txt
docker tag kinmel-video-engine kinmel-video-engine:pre-styles 2>/dev/null || true
```

### 2b. Sync (laptop, ~/Desktop/apps/finalpost_engine-edit-styles on feat/edit-styles)
```bash
git status --short          # CHECK: only untracked captionkit_tmp extras; no .env.* besides the examples
EXCLUDES=(--exclude .git --exclude node_modules --exclude '**/node_modules' --exclude '**/dist' --exclude .env --exclude '.env.*'
  --exclude logs --exclude out --exclude remotion/out --exclude remotion/public/_proof-beds --exclude '**/.venv*' --exclude '**/__pycache__'
  --exclude '**/.pytest_cache' --exclude subjectmatte/weights --exclude captionkit_tmp/previews --exclude captionkit_tmp/samples --exclude captionkit_tmp/gallery.html)
rsync -avzn --delete "${EXCLUDES[@]}" ./ <user>@178.128.148.154:<ENGINE_DIR>/ | grep '^deleting' | head -30   # CHECK (dry run)
rsync -avz  --delete "${EXCLUDES[@]}" ./ <user>@178.128.148.154:<ENGINE_DIR>/
```

### 2c. Env (droplet `<ENGINE_DIR>/.env`)
```
EDIT_STYLES_ENABLED=1
EDIT_STYLES_ENGINE_FLAGS=1
EDIT_STYLES_AVAILABLE=
PRODUCT_EDIT_PROFILE=cuts          # or unset; styles pin their own profile, this only affects old app versions
```
Remove any `GEMINI_EDIT_MAX_REQUESTS` below 12 (it would tighten the Kinetic / Explainer caps), or leave it unset.

### 2d. Build + browser + restart (droplet)
systemd route:
```bash
cd <ENGINE_DIR>
sudo apt-get update && sudo apt-get install -y libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 \
  libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 fonts-liberation
npm install
npm run build --workspace=server
(cd remotion && npx remotion browser ensure)          # CHECK: "Browser ready" (downloads chrome-headless-shell once)
sudo chown -R $(stat -c %U server):$(stat -c %G server) node_modules   # the service user must read the browser
sudo systemctl restart kinmel-video-engine
```
Docker route:
```bash
cd <ENGINE_DIR> && docker build -t kinmel-video-engine . && docker rm -f kinmel-video-engine && \
docker run -d --name kinmel-video-engine --env-file .env -p 127.0.0.1:8090:8090 --tmpfs /tmp --restart unless-stopped kinmel-video-engine
```

### 2e. Lambda site (laptop, uses the laptop .env AWS keys; same site name, so REMOTION_SERVE_URL does not change)
```bash
cd ~/Desktop/apps/finalpost_engine-edit-styles && npm run deploy --workspace=remotion     # CHECK: prints the serve URL
```
Compare the printed URL with the droplet's `REMOTION_SERVE_URL`; they must be equal.

### 2f. Health (droplet)
```bash
curl -fsS http://127.0.0.1:8090/health                # CHECK
curl -fsS http://127.0.0.1:8090/capabilities          # CHECK: "renderMode": "lambda"
curl -s -H "Authorization: Bearer <pro token>" https://engine.kinmel.shop/v1/edit-styles | jq '[.styles[] | {id, available, locked}]'   # CHECK: 4 styles, all available, none locked
journalctl -u kinmel-video-engine -n 50 --no-pager    # CHECK (or: docker logs --tail 50 kinmel-video-engine)
```

### Rollback (engine)
```bash
# switch only (picker problems): set EDIT_STYLES_ENABLED=0 (or EDIT_STYLES_ENGINE_FLAGS=0: styles run as Clean Cut) and restart
STAMP=$(cat ~/engine-rollback-stamp.txt); sudo systemctl stop kinmel-video-engine
sudo mv <ENGINE_DIR> <ENGINE_DIR>.failed-$(date +%H%M) && sudo mv <ENGINE_DIR>.pre-styles-$STAMP <ENGINE_DIR>
sudo systemctl start kinmel-video-engine && curl -fsS http://127.0.0.1:8090/health
# Docker: docker rm -f kinmel-video-engine && docker run -d ... kinmel-video-engine:pre-styles
```
