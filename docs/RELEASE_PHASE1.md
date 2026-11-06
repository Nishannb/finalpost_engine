# Edit styles, Phase 1: end-to-end release guide (Flask → engine → app)

Phase 1 = the "Choose a style" picker. **Basic Captions** (free) and **AI Clean Cut** (Pro) work; **Kinetic Typography** and
**Explainer** show "Coming soon". The engine does not read the style yet (Phase 2, `feat/edit-styles-engine`, is NOT part of this
release): a styled job runs exactly like its mode (`basic_captions` / `full_edit`).

| Project | Folder | Branch to ship | Commit at writing |
|---|---|---|---|
| Flask (Creators API, `api.kinmel.shop`) | `~/Desktop/apps/creators_kinmel/server` (own git repo, `Nishannb/kinmel-server`) | `feat/edit-styles` | `0ef608f` |
| Engine (`engine.kinmel.shop`) | `~/Desktop/apps/finalpost_engine-edit-styles` | `feat/edit-styles` | see `git log -1` |
| App | `~/Desktop/apps/kinmel-edit-styles` | `feat/edit-styles` | `80eb9b5` |

Deploy order: **A pre-flight → B Flask (only if needed) → C engine (switch off, then on) → D app → E smoke tests.** F is rollback.
Values in `<angle brackets>` are yours to fill in. Never paste a key into a shell history on a shared machine; the commands below read
keys from the `.env` files instead.

---

## A. Pre-flight (read-only; changes nothing)

### A1. Does production Flask serve `/creator/internal/entitlement`?

On the **engine droplet** (it holds the engine key):
```bash
cd <ENGINE_DIR>                       # see A3; the old docs say /opt/kinmel/ai-video-engine
KEY=$(grep '^ENGINE_API_KEY=' .env | cut -d= -f2-)
curl -s -w '\nHTTP %{http_code}\n' -H "x-engine-key: $KEY" \
  "https://api.kinmel.shop/creator/internal/entitlement?userId=<a free test creator's auth user id>"
unset KEY
```
| Answer | Meaning | Next |
|---|---|---|
| `200` + `{"ok": true, "plan": "free", "verified": true, ...}` | Flask has the route and the keys match | skip B |
| `200` with `"verified": false` and `"source": "revenuecat_unconfigured"` | route exists, `REVENUECAT_SECRET_API_KEY` missing on Flask | B2 (env only), `./deploy/deploy.sh --no-build`, re-check |
| `200` with `"source": "revenuecat_error"` | RevenueCat unreachable or the key is wrong | check the key, re-check |
| `401` | route exists, but `ENGINE_API_KEY` differs between Flask and engine | B2: make them equal (A2) |
| `404` | route not deployed | do B |

Repeat with a **Pro** creator's user id: expect `"plan": "pro"` (or `"pro_plus"`), `"verified": true`.

### A2. Do the two `ENGINE_API_KEY`s match? (compares hashes, never prints the key)
```bash
# on the engine droplet
grep '^ENGINE_API_KEY=' <ENGINE_DIR>/.env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12
# on the Flask VPS
grep '^ENGINE_API_KEY=' /opt/kinmel-server/.env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12
```
The two 12-character prints must be identical.

### A3. Engine droplet: how it runs, and `PRODUCT_EDIT_PROFILE`
```bash
systemctl is-active kinmel-video-engine 2>/dev/null; docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null
ls -d /opt/kinmel/ai-video-engine /opt/kinmel/finalpost_engine 2>/dev/null      # find <ENGINE_DIR>
cd <ENGINE_DIR>
grep -E '^(PRODUCT_EDIT_PROFILE|ENTITLEMENT_ENFORCEMENT|CREATOR_API_URL|ENGINE_API_KEY|SUPABASE_URL|EDIT_STYLES[A-Z_]*)=' .env | sed 's/=.*/=<set>/'
grep '^PRODUCT_EDIT_PROFILE=' .env || echo "PRODUCT_EDIT_PROFILE unset (= cuts)"
```
**`PRODUCT_EDIT_PROFILE` must be unset, empty or `cuts`.** In Phase 1, AI Clean Cut runs whatever this says (the lock to `cuts` is in
Phase 2). If it is `polish` or `mvp`, stop and decide before shipping.
`CREATOR_API_URL` and `ENGINE_API_KEY` must be `<set>`; `ENTITLEMENT_ENFORCEMENT` absent or `1`.

### A4. Flask VPS state
```bash
cd /opt/kinmel-server
git status --short | head; git log -1 --oneline; git branch --show-current
docker compose ps
```
Write down the commit (`git log -1`): it is the Flask rollback target. If `git status` shows modified files, the VPS was deployed by
copying files, not by git: stop and compare (`git diff --stat`) before B, because a checkout would collide with them.

### A5. Droplet resources (for template publishing, option A; record for later, not needed for Phase 1)
On the engine droplet:
```bash
nproc; lscpu | grep -E 'Model name|^CPU\(s\)'
free -h; swapon --show
df -h / /var/lib/docker 2>/dev/null; docker system df 2>/dev/null
uptime
ps -o rss=,cmd= -C node | sort -rn | head -5
docker stats --no-stream 2>/dev/null
journalctl -k --since "30 days ago" | grep -ci 'out of memory'
```
Option A stays if RAM >= 4 GB (or 2-4 GB with a 2 GB swap file and >= 500 MB free during a Kinetic run), >= 2 vCPU, >= 5 GB free disk,
and no OOM kills. Switch to B if RAM < 2 GB, idle free RAM < 1 GB, 1 vCPU, < 3 GB disk, or past OOM kills.

---

## B. Flask deploy (only if A1 says so)

### B1. How Flask is deployed today
`server/deploy/PRODUCTION_READINESS.md` and `server/deploy/deploy.sh`: the repo is a git clone at **`/opt/kinmel-server`** on the Flask VPS;
`git pull` then `./deploy/deploy.sh` builds the Docker image (`docker compose build`), tags it `kinmel-api:<sha>` / `kinmel-api:previous`,
restarts the stack (`api` = `gunicorn main:app` on 127.0.0.1:8080, plus `worker`, `dm_worker`, `sweeper`, `redis`) and waits for
`/ready`. The creator routes are registered in `main.py` (`app.register_blueprint(creator_bp)`).

Ship from git, branch **`feat/edit-styles`** (pushed: `creator_main.py`, `creator/entitlement.py`, `creator/push_notify.py`,
`creator/store.py`, `.env.example`, tests). `requirements.txt` already pins `cryptography==44.0.0`, which `push_notify.py` imports.

Contents: `GET /creator/internal/entitlement` (engine key; plan from the Nepal-verified flag, then RevenueCat), FCM HTTP v1 push
(edit-done notifications), `PATCH /creator/thumbnail-theme`, push-token `tokenType`. Tests: 34 passed locally (entitlement 16, push 18).

### B2. Env vars (Flask `.env` on the VPS)

| Variable | Required | Value |
|---|---|---|
| `ENGINE_API_KEY` | yes | the SAME value as the engine droplet's (A2) |
| `REVENUECAT_SECRET_API_KEY` | yes | RevenueCat **secret** REST key (`sk_...`), never the public SDK key. Without it Pro is never verified (paid edits refused) |
| `REVENUECAT_PRO_ENTITLEMENT_ID` | yes | `finalpost_pro` (default; must match the app's entitlement id) |
| `REVENUECAT_PRO_PLUS_ENTITLEMENT_ID` | optional | your Pro Plus entitlement id, or unset (Pro Plus then not granted by purchase) |
| `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_PATH` | for Android pushes | the Firebase service-account JSON (or base64 of it), or a path to it on the VPS (keep it out of git; `keys/` is gitignored) |
| `FIREBASE_PROJECT_ID` | with FCM | `finalpost-208b4` |
| Supabase settings | already set | used for the Nepal-verified lookup |

### B3. Back up, deploy, smoke test
```bash
ssh <deploy-user>@<flask-vps>
cd /opt/kinmel-server
./deploy/backup.sh                                   # .env, sessions DB, Redis, nginx + TLS -> ~/kinmel-backups/<stamp>
git rev-parse HEAD > ~/flask-rollback-sha.txt        # rollback target
docker tag "$(docker compose images -q api | head -1)" kinmel-api:pre-phase1
# edit .env for B2 (keep a copy: cp .env ~/flask-env-pre-phase1)
git fetch origin
git checkout feat/edit-styles                        # stop if git refuses (local changes): see A4
./deploy/deploy.sh                                   # builds, restarts, waits for /ready
curl -fsS http://127.0.0.1:8080/health
```
Smoke test: repeat A1 for one **free** and one **Pro** creator: `200`, `plan` `free` / `pro`, `verified: true`. Then
`docker compose logs --tail=50 api` shows no import errors.

---

## C. Engine deploy

### C1. Back up the droplet's current engine
```bash
cd <ENGINE_DIR>/..
STAMP=$(date +%Y%m%d-%H%M)
sudo tar --exclude='*/node_modules' --exclude='*/.venv*' --exclude='*/out' --exclude='*/logs' \
  -czf ~/engine-backup-$STAMP.tgz "$(basename <ENGINE_DIR>)"     # code + .env, small
sudo cp -a <ENGINE_DIR> <ENGINE_DIR>.pre-phase1-$STAMP           # full copy incl. node_modules and dist: instant rollback
docker tag kinmel-video-engine kinmel-video-engine:pre-phase1 2>/dev/null || true   # Docker route only
```

### C2. What will this deploy change? (dry run from the laptop)
On the laptop, in `~/Desktop/apps/finalpost_engine-edit-styles`, on `feat/edit-styles`:
```bash
git status --short     # only untracked captionkit_tmp/{make_previews.py,service,tools,.DS_Store}; NO .env.* file other than the examples
EXCLUDES=(--exclude .git --exclude node_modules --exclude '**/node_modules' --exclude '**/dist'
  --exclude .env --exclude '.env.*' --exclude logs --exclude out --exclude remotion/out
  --exclude remotion/public/_proof-beds --exclude '**/.venv*' --exclude '**/__pycache__' --exclude '**/.pytest_cache'
  --exclude subjectmatte/weights
  --exclude captionkit_tmp/previews --exclude captionkit_tmp/samples --exclude captionkit_tmp/gallery.html)
rsync -avzn --delete "${EXCLUDES[@]}" ./ <user>@<engine-droplet>:<ENGINE_DIR>/ | tee ~/engine-rsync-preview.txt | tail -5
grep -c '^deleting ' ~/engine-rsync-preview.txt
```
Read the `deleting` lines: anything there that the droplet needs (for example files someone added only on the droplet) must be
copied into the laptop folder first.

**Does this ship the BGM (`bgm-phase-2`) or Phase 1.1 polish code to production for the first time?** On the droplet:
```bash
cd <ENGINE_DIR>
for f in \
  server/src/lib/entitlement.ts \
  server/src/stages/broll/kineticLedConfig.ts \
  server/src/stages/broll/explainerMount.ts \
  server/src/stages/music/contentMoodMap.json \
  server/src/stages/music/carvedMix.ts \
  server/src/stages/music/lambdaMaster.ts \
  server/src/stages/music/briefRules.json \
  server/src/stages/music/bedLoudness.ts ; do
  [ -e "$f" ] && echo "present  $f" || echo "MISSING  $f"; done
```
| File | Introduced by |
|---|---|
| `lib/entitlement.ts` | the newest pre-Phase-1 work (entitlements, durable jobs); present = the droplet was synced recently |
| `stages/broll/kineticLedConfig.ts`, `explainerMount.ts` | Phase 1.1 polish (`54f7e9d phase 1.1 checkpoint`) |
| `stages/music/contentMoodMap.json` | first BGM commit |
| `stages/music/carvedMix.ts` | BGM phase 1 (carved bed under the voice) |
| `stages/music/lambdaMaster.ts` | BGM phase 2.4 (mastering Lambda renders, voice-first defaults) |
| `stages/music/briefRules.json` | BGM phase 3 (music brief, styles, placement) |
| `stages/music/bedLoudness.ts` | BGM phase 3.1 (loudness-aware ducking), the newest |

Any `MISSING` = that code reaches production for the first time with this deploy.

### C3. Deploy with the picker switch OFF
```bash
# laptop
rsync -avz --delete "${EXCLUDES[@]}" ./ <user>@<engine-droplet>:<ENGINE_DIR>/
git tag deploy-$(date +%Y%m%d) && git push origin deploy-$(date +%Y%m%d)

# droplet (systemd route; Docker route: docker build -t kinmel-video-engine . && restart the container, see DEPLOY_ENGINE.md)
cd <ENGINE_DIR>
grep -E '^EDIT_STYLES' .env || echo "no EDIT_STYLES vars (switch off)"
npm install
npm run build --workspace=server
sudo systemctl restart kinmel-video-engine
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8090/capabilities          # renderMode: lambda
curl -s -o /dev/null -w '%{http_code}\n' https://engine.kinmel.shop/v1/edit-styles   # 401 (no token) or 404: picker off
```

### C4. If C2 showed any `MISSING` music / polish file: listen before going on
With the CURRENT store app, on production, as test creators:
1. One **Basic Captions** edit (free account).
2. One **AI Clean Cut** / full AI edit (Pro account).

Listen on headphones and on the phone speaker:
- [ ] the voice is clear and in front for the whole clip (no pumping, no dips at sentence ends);
- [ ] music (if any) sits under the voice, starts and ends cleanly;
- [ ] SFX (if any) are not louder than the voice and not on top of words;
- [ ] no clicks at cut points, no silence where speech was, A/V in sync at the end.

Compare with an edit of the same clip made before the deploy if you have one. If something is wrong, roll back the engine code (F2)
before turning anything on.

### C5. Turn the picker on
Add to the droplet's `.env`:

| Variable | Value |
|---|---|
| `EDIT_STYLES_ENABLED` | `1` |
| `EDIT_STYLES_AVAILABLE` | `basic_captions,ai_clean_cut` |
| `EDIT_STYLES_ORDER` | unset |
| `EDIT_STYLES_ENGINE_FLAGS` | absent (Phase 2 only) |
| `ENTITLEMENT_ENFORCEMENT` | `1` or unset (default on) |
| `CREATOR_API_URL` / `ENGINE_API_KEY` | already set (A3) |
| `PRODUCT_EDIT_PROFILE` | unset or `cuts` (A3) |

```bash
sudo systemctl restart kinmel-video-engine
curl -s -H "Authorization: Bearer <free test creator access token>" https://engine.kinmel.shop/v1/edit-styles \
  | jq '{plan, planVerified, styles: [.styles[] | {id, available, locked}]}'
```
Expect `plan: "free"`, `planVerified: true`, `basic_captions` unlocked, the other three locked, `kinetic_typography` and `explainer`
`available: false`. With a Pro token: nothing locked. The current store app is unaffected (it never sends `style`).

---

## D. App

### D1. Preview videos

Files (bundled with `require()`, so they ship inside the app; replace in place, same names):
```
assets/edit-style-previews/basic_captions.mp4
assets/edit-style-previews/ai_clean_cut.mp4
assets/edit-style-previews/kinetic_typography.mp4
assets/edit-style-previews/explainer.mp4
```
They play **muted, looping, `resizeMode="cover"`** in half-screen-width 9:16 cards, under the card's own badge, name, description and
"Coming soon" text. Target format: **540x960, H.264 (Main), yuv420p, 30 fps, 5-8 s, no audio track, `+faststart`, <= 400 KB each**
(the placeholders are 1080x1920 with audio at ~600 KB; smaller is better for the app size). Pick a stretch with the captions clearly
visible and nothing important in the bottom third (the card text covers it).

**Basic Captions** (the production path burns CaptionKit captions on the uncut video). In `~/Desktop/apps/finalpost_engine-edit-styles`:
```bash
CLIP=~/path/to/your-clip.mp4                          # 20-60 s, vertical
# 1) word timestamps (one Groq call, ~$0.001; the key comes from your local .env)
ffmpeg -y -i "$CLIP" -vn -ac 1 -ar 16000 -c:a libopus -b:a 32k /tmp/preview-audio.ogg
GROQ_API_KEY=$(grep '^GROQ_API_KEY=' .env | cut -d= -f2-)
curl -s https://api.groq.com/openai/v1/audio/transcriptions -H "Authorization: Bearer $GROQ_API_KEY" \
  -F file=@/tmp/preview-audio.ogg -F model=whisper-large-v3-turbo -F response_format=verbose_json \
  -F 'timestamp_granularities[]=word' > /tmp/preview-words.json
unset GROQ_API_KEY
jq '.words | length' /tmp/preview-words.json          # > 0
# 2) burn with the same renderer production uses (pick the preset your app shows first, e.g. punchline)
python3 captionkit_tmp/captionkit.py list | head
python3 captionkit_tmp/captionkit.py render --video "$CLIP" --transcript /tmp/preview-words.json --preset punchline --out /tmp/basic-full.mp4
# 3) cut a loop (adjust -ss to a good moment)
ffmpeg -y -ss 3 -t 7 -i /tmp/basic-full.mp4 -vf "scale=540:960:flags=lanczos,fps=30" -an \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 28 -preset slow -movflags +faststart \
  ~/Desktop/apps/kinmel-edit-styles/assets/edit-style-previews/basic_captions.mp4
```

**AI Clean Cut** (the production `full_edit` path on the `cuts` profile, rendered locally with Remotion; no Lambda). Paid calls: one Groq
transcription and 1-3 Gemini keep-plan calls. `config/env.ts` loads `.env` with override, so set these **in `.env`** (then put them back):
`PRODUCT_EDIT_PROFILE=cuts`, `MUSIC_SPECIALIST=off`, `LOCAL_RENDER_SKIP_R2=1`, `GEMINI_EDIT_MAX_REQUESTS=3`.
```bash
cd server
npm run first-video -- "$CLIP" auto --captions=karaoke     # prints the output path ("Done. Edited video: ...")
cd ..
ffmpeg -y -ss 2 -t 7 -i <printed render path> -vf "scale=540:960:flags=lanczos,fps=30" -an \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 28 -preset slow -movflags +faststart \
  ~/Desktop/apps/kinmel-edit-styles/assets/edit-style-previews/ai_clean_cut.mp4
```
(Choose a stretch that contains a cut, so the preview shows the jump.)

**Kinetic Typography / Explainer** ("Coming soon"): a quiet, textless dark loop (the card already prints the name and "Coming soon"):
```bash
for id in kinetic_typography explainer; do
  ffmpeg -y -f lavfi -i "gradients=s=540x960:c0=0x1E293B:c1=0x0B1120:x0=0:y0=0:x1=540:y1=960:speed=0.008:r=30:d=6" -an \
    -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 30 -preset slow -movflags +faststart \
    ~/Desktop/apps/kinmel-edit-styles/assets/edit-style-previews/$id.mp4
done
```
(About 20 KB each. Tested on this Mac's ffmpeg.)

Check all four: `for f in assets/edit-style-previews/*.mp4; do ffprobe -v error -show_entries format=duration,size:stream=width,height,codec_name -of compact "$f"; done`.
Commit them on the app branch: `git commit -o assets/edit-style-previews -m "Edit styles: real previews"`.

### D2. Versions
- Android `android/app/build.gradle`: `versionCode 17 -> 18`, `versionName "1.0.5" -> "1.0.6"`.
- iOS (Xcode, target `kinmel`, or `ios/kinmel.xcodeproj/project.pbxproj`): `MARKETING_VERSION 1.0.4 -> ` the next number above what is
  live on the App Store (1.0.6 keeps the platforms aligned), `CURRENT_PROJECT_VERSION 13 -> 14`.

### D3. Build (in `~/Desktop/apps/kinmel-edit-styles`)
```bash
npm ci
npx jest                       # expected: the same 2 failing suites as before (subtitleTypes, App.test); the edit-style tests pass
npx tsc --noEmit | grep -c 'error TS'      # expected 64 (unchanged baseline)
# Android (signed with android/keystore.properties -> app/kinmel-upload.keystore, present, gitignored)
cd android && ./gradlew clean bundleProductionRelease && cd ..
ls -la android/app/build/outputs/bundle/productionRelease/app-production-release.aab
# iOS (ios/kinmel/GoogleService-Info.plist present, gitignored)
cd ios && pod install && cd ..
open ios/kinmel.xcworkspace   # scheme kinmel, Any iOS Device, Product > Archive
```
Release builds talk to `https://engine.kinmel.shop` (`KINMEL_ENV = prod` outside `__DEV__`).

### D4. On-device test against production (before store submission)
- Android: upload the `.aab` to the Play Console **internal testing** track and install it from there (or
  `npx react-native run-android --mode=productionRelease --appId=com.kinmel.kinmelcreator` on a cabled device).
- iOS: upload the archive to App Store Connect and install from **TestFlight**.
- Run section E on both builds (the engine switch is already on from C5).

### D5. Store submission
- Play Console: promote the tested build from internal testing to production, ideally as a **staged rollout** (for example 20 %).
- App Store Connect: submit the TestFlight build for review; release manually after approval.
- Release notes: "Choose a style: Basic Captions and AI Clean Cut. More styles coming soon."

---

## E. Smoke tests (production)

Test accounts: one **free** creator, one **Pro** creator (a sandbox purchase, or an account already Pro).

**Free creator, new app**
- [ ] Gallery -> pick a video -> the style picker opens with previews playing.
- [ ] Basic Captions selectable; AI Clean Cut locked (PRO badge + lock); Kinetic and Explainer "Coming soon" (not selectable).
- [ ] Tap AI Clean Cut -> paywall opens (cancel).
- [ ] Basic Captions -> caption style -> the edit finishes with captions and the free watermark.
- [ ] `GET /v1/edits/<editJobId>` shows `mode: "basic_captions"`, `style: "basic_captions"`.

**Pro creator, new app**
- [ ] Basic Captions and AI Clean Cut selectable; Kinetic and Explainer "Coming soon".
- [ ] AI Clean Cut -> the edit finishes: silences / fillers / retakes removed, captions, no B-roll or graphics; job `mode: "full_edit"`,
      `style: "ai_clean_cut"`; the done push notification arrives.
- [ ] (sandbox purchase) right after buying Pro, reopening the picker shows Clean Cut unlocked (no one-minute wait).

**Old app version (current store build, no picker)**
- [ ] Free: Basic Captions works. Pro: the full AI edit works (mode-only requests, no `style`).

**API checks** (tokens = the creators' Supabase access tokens):
```bash
E=https://engine.kinmel.shop/v1/edits/captions
BODY='{"contentType":"video/mp4","extension":".mp4","languageCode":"auto"'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $E -H "Authorization: Bearer <pro token>"  -H 'Content-Type: application/json' -d "$BODY,\"style\":\"kinetic_typography\"}"   # 409
curl -s -o /dev/null -w '%{http_code}\n' -X POST $E -H "Authorization: Bearer <pro token>"  -H 'Content-Type: application/json' -d "$BODY,\"style\":\"nope\"}"                 # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $E -H "Authorization: Bearer <free token>" -H 'Content-Type: application/json' -d "$BODY,\"style\":\"ai_clean_cut\"}"         # 403
```
(The 409 / 400 / 403 answers create no job. A `202` means a job was created and is waiting for an upload; it expires on its own.)

---

## F. Rollback

| What | When | How |
|---|---|---|
| **Engine switch** | picker misbehaves | droplet `.env`: `EDIT_STYLES_ENABLED=0` (or remove it), `sudo systemctl restart kinmel-video-engine`. The new app falls back to its bundled style list and the old mode-only requests; nothing else changes. |
| **Engine code** | C4 sounds wrong, or anything breaks after C3 | `sudo systemctl stop kinmel-video-engine; sudo mv <ENGINE_DIR> <ENGINE_DIR>.failed-$(date +%H%M); sudo mv <ENGINE_DIR>.pre-phase1-<STAMP> <ENGINE_DIR>; sudo systemctl start kinmel-video-engine; curl -fsS http://127.0.0.1:8090/health`. (From the tarball instead: `sudo tar -xzf ~/engine-backup-<STAMP>.tgz -C <ENGINE_DIR>/..`, then `npm install && npm run build --workspace=server` and restart.) Docker route: run `kinmel-video-engine:pre-phase1`. |
| **Flask** | B3 smoke test fails, or errors after | `cd /opt/kinmel-server && git checkout $(cat ~/flask-rollback-sha.txt) && cp ~/flask-env-pre-phase1 .env && ./deploy/deploy.sh`. Note: the documented `docker tag kinmel-api:previous ...` rollback does not switch the running container (the compose file builds `api` and names no image), so roll back by commit. Data restore if ever needed: `~/kinmel-backups/<stamp>/` from `backup.sh`. |
| **App** | a bad build | Play: halt the staged rollout and ship a fixed build (a version cannot be downgraded). App Store: remove the version from sale or expedite a fix. Meanwhile set `EDIT_STYLES_ENABLED=0` (engine switch): the new app keeps working with its bundled list. |

Rollback order if everything must go: engine switch off -> engine code -> Flask (only if the entitlement route itself is the problem;
the old engine does not depend on the new Flask route except for the Pro `full_edit` check it already used).
