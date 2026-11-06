# Edit styles, Phase 1 release checklist (engine `feat/edit-styles`, app `feat/edit-styles`)

Phase 1 = the "Choose a style" picker. Basic Captions (free) and AI Clean Cut (Pro) are live; Kinetic Typography and Explainer show
"Coming soon". It ships WITHOUT `feat/edit-styles-engine` (Phase 2): the pipeline does not read the style; a styled job runs exactly like
its `mode` (`basic_captions` / `full_edit`).

Order: **engine first (switch off), then turn the switch on, then the app.** Every step is reversible by turning `EDIT_STYLES_ENABLED`
off again.

## 0. Before anything (read-only checks)

- [ ] Engine branch: `feat/edit-styles` at the commit you ship (`git -C ~/Desktop/apps/finalpost_engine-edit-styles log -1`). Tag it after
      the deploy: `git tag deploy-YYYYMMDD && git push origin deploy-YYYYMMDD`.
- [ ] The worktree is clean for shipping: `git status --short` shows only the untracked `captionkit_tmp/{make_previews.py,service,tools,.DS_Store}`
      (harmless) and NO `.env.parked-for-tests` or other `.env.*` file (rsync's `--exclude .env` does not cover them).
- [ ] What the droplet's `.env` says today (on the droplet: `grep -E '^(PRODUCT_EDIT_PROFILE|ENTITLEMENT_ENFORCEMENT|CREATOR_API_URL|ENGINE_API_KEY|SUPABASE_URL|EDIT_STYLES)' .env | sed 's/=.*/=<set>/'`
      prints names only): **`PRODUCT_EDIT_PROFILE` must be unset, empty or `cuts`.** In Phase 1, AI Clean Cut runs whatever this says (the
      lock to `cuts` is Phase 2). If it is `polish` or `mvp`, stop: Clean Cut would not be a clean cut.
- [ ] The Creators API answers the engine's plan lookup (it already backs the Pro `full_edit` check):
      `curl -s -o /dev/null -w '%{http_code}\n' -H "x-engine-key: $ENGINE_API_KEY" "https://api.kinmel.shop/creator/internal/entitlement?userId=<a test creator id>"` -> 200.
- [ ] Preview what the sync will change on the droplet (dry run, changes nothing):
      `rsync -avzn --delete <same excludes as §1> ./ USER@DROPLET:/opt/kinmel/ai-video-engine/ | less`.
      Expect the Phase 1 files plus whatever was not synced since the last deploy (the branch is your current engine checkout + Phase 1:
      checked, no source differences besides caches and CaptionKit extras).

## 1. Engine deploy (docs/DEPLOY_ENGINE.md, Route 1)

1. From `~/Desktop/apps/finalpost_engine-edit-styles` (on `feat/edit-styles`):
   ```bash
   rsync -avz --delete \
     --exclude .git --exclude node_modules --exclude '**/node_modules' --exclude '**/dist' \
     --exclude .env --exclude '.env.*' --exclude logs --exclude out --exclude remotion/out \
     --exclude remotion/public/_proof-beds --exclude '**/.venv*' --exclude '**/__pycache__' --exclude '**/.pytest_cache' \
     --exclude subjectmatte/weights \
     --exclude captionkit_tmp/previews --exclude captionkit_tmp/samples --exclude captionkit_tmp/gallery.html \
     ./ USER@DROPLET:/opt/kinmel/ai-video-engine/
   ```
   (`--exclude '.env.*'` also excludes `.env.example`, which the droplet does not need.)
2. On the droplet, with `EDIT_STYLES_ENABLED` still **absent / 0**:
   ```bash
   cd /opt/kinmel/ai-video-engine
   npm install
   npm run build --workspace=server
   sudo systemctl restart kinmel-video-engine      # or the Docker route in DEPLOY_ENGINE.md
   curl -fsS http://127.0.0.1:8090/health
   curl -fsS http://127.0.0.1:8090/capabilities    # renderMode: lambda
   curl -s -o /dev/null -w '%{http_code}\n' https://engine.kinmel.shop/v1/edit-styles   # 401 or 404: the route is off
   ```
3. The current store app keeps working (it sends no `style`): run one Basic Captions edit from it. This is the "new engine, switch off" row.

## 2. Turn the picker on (engine env)

Add to the droplet's `.env`:

| Variable | Value | Why |
|---|---|---|
| `EDIT_STYLES_ENABLED` | `1` | catalog + `style` field on |
| `EDIT_STYLES_AVAILABLE` | `basic_captions,ai_clean_cut` | explicit (the registry default is the same; explicit makes Kinetic / Explainer impossible to start by accident) |
| `EDIT_STYLES_ORDER` | (unset) | registry order |
| `EDIT_STYLES_ENGINE_FLAGS` | (absent) | Phase 2 only; this build does not read it |
| `ENTITLEMENT_ENFORCEMENT` | `1` (or unset: default on) | Pro styles are checked server-side |
| `CREATOR_API_URL`, `ENGINE_API_KEY` | already set | plan lookup; if missing, every Pro card shows locked (fail closed) |
| `PRODUCT_EDIT_PROFILE` | unset or `cuts` | see §0 |

Then `sudo systemctl restart kinmel-video-engine` and:
```bash
curl -s -H "Authorization: Bearer <a free test creator's token>" https://engine.kinmel.shop/v1/edit-styles | jq '.plan, [.styles[] | {id, available, locked}]'
```
Expect `plan: "free"`, `basic_captions` unlocked, the other three locked, `kinetic_typography` / `explainer` `available: false`.

## 3. App build (from `~/Desktop/apps/kinmel-edit-styles`, branch `feat/edit-styles`)

The repo has no fastlane / CI release lane; these are the manual steps.

1. `npm ci` (or `npm install`), `npx jest` (expect the same 2 failing suites as the base: `subtitleTypes`, `App.test`), `npx tsc --noEmit`
   (64 errors, the same as the base).
2. Bump versions: Android `android/app/build.gradle` `versionCode 17 -> 18`, `versionName 1.0.5 -> 1.0.6`; iOS `MARKETING_VERSION 1.0.4 -> 1.0.6`
   (or your next number) and `CURRENT_PROJECT_VERSION 13 -> 14` (Xcode target settings).
3. Placeholder previews: `assets/edit-style-previews/*.mp4` are copies of caption demos. Replace them with the real style previews
   before release if you have them (same file names).
4. Android: `cd android && ./gradlew bundleProductionRelease` -> `app/build/outputs/bundle/productionRelease/app-production-release.aab`
   (signed with `android/keystore.properties` -> `app/kinmel-upload.keystore`, both present in the worktree; gitignored).
5. iOS: `cd ios && pod install`, open `kinmel.xcworkspace`, scheme `kinmel`, Release, Product > Archive, upload to App Store Connect
   (`ios/kinmel/GoogleService-Info.plist` is present in the worktree; gitignored).
6. Release builds point at `https://engine.kinmel.shop` (`KINMEL_ENV = prod` when not `__DEV__`).

## 4. Smoke test on production

Free test creator (new app):
- [ ] Gallery -> pick a video -> the style picker opens; Basic Captions selectable, AI Clean Cut locked (Pro badge / lock), Kinetic and Explainer say "Coming soon" (coming soon wins over locked).
- [ ] Tap a locked Pro card -> paywall opens (do not buy).
- [ ] Basic Captions -> pick a caption style -> the edit completes with captions and the free watermark.
- [ ] Engine log / `GET /v1/edits/<id>`: `mode: basic_captions`, `style: basic_captions`, no Gemini request for the job.

Pro test creator (new app):
- [ ] Picker: Basic Captions and AI Clean Cut selectable; Kinetic / Explainer "Coming soon" (not selectable).
- [ ] AI Clean Cut -> the edit completes: silences / fillers / retakes cut, captions, no B-roll / graphics; job `mode: full_edit`, `style: ai_clean_cut`; analysis `editProfile: cuts`.
- [ ] (if you test a purchase on a sandbox account) after buying, reopen the picker: Clean Cut unlocks without waiting a minute (the `?refresh=1` path).

Old app version (current store build, no picker):
- [ ] Free: Basic Captions still works. Pro: the full AI edit still works (mode-only requests, no `style`).

API checks:
- [ ] `POST /v1/edits/captions` with `style: "kinetic_typography"` -> `409 style_unavailable`; with `style: "nope"` -> `400`; free user + `ai_clean_cut` -> `403 pro_required`.

## 5. Rollback

- Picker problem: set `EDIT_STYLES_ENABLED=0` and restart. The new app falls back to its bundled manifest and mode-only requests.
- Engine problem: re-sync the previous folder / tag and restart (DEPLOY_ENGINE.md, Rollback).
- No app rollback is needed for engine issues.
