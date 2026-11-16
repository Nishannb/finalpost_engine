# BGM release checklist

For the human. Nothing here has been run for you: every paid or deploy step is yours. Policy: [VOICE_FIRST.md](VOICE_FIRST.md). Last updated 2026-11-16 (Phase 4 safety fixes; supersedes the Phase 2.4 text).

> **Status: NOT production-verified.** BGM is implemented and was proven in local, free renders (video frames identical to the previous renderer; final mix −13.9 LUFS on a stored bed). No personalized bed has been generated and listened to from a production-configured engine, and no Lambda render has been checked. **Do not describe BGM as production-ready until the one-edit listening test in §3 passes on a real edit.** Open gaps are listed in §7.

## 0. Five different outcomes (they are not the same thing)

"BGM works" can mean any of these. Only the second one is the personalized BGM the product promises. Check which one you got in `music.summary` (§3).

| Outcome | What the edit gets | Needs | Cost | `music.summary` shows |
|---|---|---|---|---|
| **A. Pool-bed playback** | A bed that was generated earlier, picked from the R2 pool of the video's style (`music/beds/pool/<style>.json`). Not made for this video. | `MUSIC_SPECIALIST=live` (or `dry`), R2 configured with a public https `R2_PUBLIC_BASE_URL`, a non-empty pool for the style (or its family), and the Python environment in §1 (the voice loudness is measured in Python; if it fails the bed is **muted**, never guessed). | $0 | `source: pool` |
| **B. Personalized generated BGM** | A bed generated for this video from its own brief, then added to the pool. | Everything in A **plus** `MUSIC_SPECIALIST=live` exactly, `RUNWARE_API_KEY`, `MUSIC_BED_FRESH=1`, **`MUSIC_GENERATION_LEDGER=r2`** with real R2 credentials (not `STORAGE_BACKEND=local`), and a writable `MUSIC_SPEND_LOG`. | about $0.0075 per video, capped at `MUSIC_SPECIALIST_MAX_USD` (default 0.02); at most **one** paid attempt per video id, ever | `source: generated`, `costUsd` > 0, `fallbackTier: null`, `fallbackReason: null` |
| **C. Pool fallback after a failed generation** | A pool bed (same style, else same family). **This is a fallback, not personalized BGM, and not a success for the verification test.** | Happens when B fails (no ledger, no key, timeout, cost cap, QC, upload failure). | $0 (a paid call that already ran is still spent) | `source: pool` with `fallbackReason` and `fallbackTier` set |
| **D. Dry mode (development only)** | In development and tests: pool beds play, and if the pool is empty the specialist writes a 60 s **synthetic click bed** (220 Hz tone plus a 1 kHz click on every beat), uploads it under `music/beds/dry/…` and attaches it marked `source: generated`, cost 0. That is a test tone, never music. **In production (`NODE_ENV=production`) it is blocked**: nothing is spawned, generated, spooled or uploaded; the edit gets an eligible existing pool bed (same style, then same family, nearest tempo) or no bed. | `MUSIC_SPECIALIST=dry`, `MUSIC_SPECIALIST=1` without `MUSIC_SPECIALIST_LIVE=1`, or `MUSIC_SPECIALIST=live` with no `RUNWARE_API_KEY` (a downgrade). | $0 | Production: `music.mode_downgraded` (reason `no_api_key`), `music.dry_blocked_in_production`, `music.fallback`; a pool bed carries `fallbackReason` `live_unavailable_no_api_key` (downgrade) or `dry_mode_in_production` (explicit dry) with `fallbackTier`. Development: `costUsd: 0`, `source: generated` |
| **E. Off** | No bed at all, **including no pool beds**. | `MUSIC_SPECIALIST` unset or `off` (the default). | $0 | no `music.summary` bed |

Outcome D no longer reaches a production edit (the placeholder is refused in the engine and again in the Python agent), but it still means **live generation is not working**: a `music.dry_blocked_in_production` line in the production log is a configuration error to fix (usually a missing `RUNWARE_API_KEY`), not a normal state.

Free Basic Captions never get a bed (that path does not run the music stage). The bed belongs to the Pro edit (`polish` profile, including the Kinetic style).

## 1. Production environment

Set these on the engine host. Never commit values. The defaults in the last column apply when a variable is unset. Names only here; values go in the host's `.env`.

| Variable | Set to | Why |
|---|---|---|
| `MUSIC_SPECIALIST` | `live` | Turns the specialist on. Anything else is outcome D or E (§0). `live` without a key becomes dry (logged as `music.mode_downgraded`; in production then blocked, §0). A mood whose pool already has a bed never calls Runware. |
| `RUNWARE_API_KEY` | your key | Required for outcome B. Without it `live` becomes `dry`, which production blocks (§0). |
| `MUSIC_GENERATION_LEDGER` | `r2` | **Required for outcome B.** The per-video ledger (`music/ledger/<videoId>.json`, create-if-absent) is what limits paid generation to one attempt per video. Unset, or R2 not configured, means no verified store: live generation **fails closed** (`music.ledger_unavailable`) and the edit gets a pool bed (outcome C). It is not mentioned in older versions of this checklist. |
| `STORAGE_BACKEND` | `r2` (default) | The ledger and the pool need real R2. `local` has no conditional create. |
| `POLISH_MUSIC_BED_URL` | **empty** | A licensed URL here wins over any generated or pool bed and the specialist is skipped. Leave it empty. |
| `MUSIC_BED_SOURCE` | `auto` (default) | `licensed`, `generated` or `off` change which source wins; `off` and `licensed` skip the specialist. |
| `MUSIC_BED_FRESH` | **`1`** | Generate a bed for every new edit from its own brief. Re-rendering the same video is a $0 cache hit. With `0` the pooled bed of the video's style is reused for $0 (outcome A). |
| `MUSIC_SPECIALIST_MAX_USD` | `0.02` (default) | Cost cap per generation (~$0.0075 per bed). Above it the edit falls back to the pool or to no bed. This is a per-call cap, not a daily or monthly cap. |
| `MUSIC_SPECIALIST_TIMEOUT_MS` | `45000` (default) | How long an edit waits for a bed. The generation is not killed; a late bed lands in the pool for the next edit. |
| `MUSIC_PERSONALIZE` | `1` (default) | Per-video brief, bed made for it, placement on the video, SFX on the beat. New edits only. `0` = the Phase 2.4 behaviour. |
| `MUSIC_BED_POOL_SIZE` | `3` (default) | The most beds one **style** pool holds. Nothing is ever removed. |
| `MUSIC_BED_POLICY` | unset (= `voice_first_v2`) | New generated beds sit **24 / 15 / 10 LU** under the measured voice (speech / pause / open). `v1` restores 18 / 9 / 4. The new levels have **not** been approved by ear yet (see §7). |
| `MUSIC_DUCK_PRESET` | `talking` (default) | Voice-relative ducking. The offsets come from the policy above. |
| `MUSIC_DUCK_RELEASE_MS` | `300` (default) | Lets short pauses settle. Plus a one-frame attack look-ahead (33 ms), stored on each new blueprint. |
| `MUSIC_CARVED_TWIN` | `1` (default) | Carved bed under speech. `0` = off. |
| `MUSIC_MASTER_PASS` | `1` (default) | Two-pass loudnorm on the finished MP4, on local **and** Lambda renders. `0` = off. Targets −14 LUFS integrated and **−1.5 dBTP**, so the delivered file stays at or below the −1 dBTP ceiling (the AAC re-encode adds about 0.1 dB; the old −1 dBTP target measured −0.9). Verified locally only (§7). |
| `MUSIC_SPEND_LOG` | a path on a **persistent, writable** volume | The specialist's durable local spend log (see "Spend accounting" below). The default is `agents/music_specialist/spend.log`, inside the code directory: on a read-only image or a tmpfs it is lost or unwritable. If the log cannot be written, **no paid request is made** (the plan step reports it and the edit uses a pool bed; the ledger is not claimed). Use a path the engine user can write. |
| `MUSIC_MIX_MEASURE` | unset | Local-only (it costs an extra render). Never on Lambda. |
| `OUTPUT_FPS_MODE` | `fixed30` | Approved initial production setting (see below). |

Also required: R2 credentials and `R2_PUBLIC_BASE_URL` set to a public **https** host. Bed URLs must be public https; the engine drops the bed and logs `music.bed_url_not_public` if any is not. The same R2 is used for the pool, the ledger and the mastered Lambda copy.

**Frame rate (`OUTPUT_FPS_MODE=fixed30`).** Approved for the initial production configuration. It makes every edit render at 30 fps (the behaviour before frame-rate matching existed; a 24 fps source is resampled to 30). The code default is `source`, which keeps ordinary source rates (24, 23.976, 25, 29.97) and converts 15, 50, 60 or unknown rates to 30. Local renders were checked at 23.972 and 30 fps, but a fractional-rate **Lambda** render has not been, so the first production release uses `fixed30`. BGM timing is kept in seconds, so it follows either setting. Setting this is the operator's change to the host `.env`; nothing in the repo applies it.

### Python environment (needed for A, B and C)

The engine spawns `python -m music_specialist` from `agents/` and measures the creator's voice loudness with it, for every edit that gets a bed. Dependencies: `pydub`, `pyloudnorm`, `numpy`, `scipy`, `librosa` (the image installs them into `/app/agents/.venv`, which the engine prefers). On a plain systemd host you must create `agents/.venv` yourself. If the voice measurement fails the bed is muted (`music.bed_muted_fail_safe`), so a missing environment shows up as "no music", not as an error.

### What the production image needs (Phase 2.4 findings and fix)

- `contentMoodMap.json` was read with `fs` from beside the compiled file, but `tsc` does not copy JSON. It is now imported, so the build emits it. Verified with a real `tsc` build.
- The `Dockerfile` copies `agents/music_specialist`, the mood map and `briefRules.json`, builds `/app/agents/.venv`, and makes `agents/music_specialist` writable for the default `spend.log`. **This Dockerfile change has not been built.** Before deploying: `docker build -t kinmel-engine .` and then `docker run --rm kinmel-engine /app/agents/.venv/bin/python -c "import librosa, pyloudnorm, pydub, scipy"`. The venv pulls librosa and numba, which makes the image larger. (Docker is only relevant if the engine runs under Docker; the VPS runtime is to be confirmed on the server.)
- ffmpeg is already in the image, and the Lambda master pass needs it.

### Spend accounting (what is recorded, where, and what is not guaranteed)

One paid request has a lifecycle, recorded in two places:

| Stage | Spend log (`MUSIC_SPEND_LOG`, local file, `fsync`ed) | Ledger (`music/ledger/<videoId>.json` in R2) | Log line |
|---|---|---|---|
| Claim (before anything is spent) | | `claimed` (atomic create-if-absent; the video is consumed from here on) | |
| Paid request about to be made | `state=requested` (no cost yet), written **before** the provider is called; if it cannot be written, **no paid call is made** | | |
| Provider answered | `state=paid` with the measured cost (sum cost over `state=paid` lines only) | | |
| Bed file downloaded | `state=downloaded` | | |
| Bed uploaded and recorded | | `resolved`, outcome `generated`, `costUsd` | `music.generated` |
| Bed on the edit's blueprint | | | `music.bed_attached` (`source`, `cacheKey`, `costUsd`, `fallbackReason`/`fallbackTier`) and `musicProvenance` |
| Failures | `state=post_failed` (request made, cost unknown: it may have been charged) or `state=download_failed` (charged, bed lost) | `resolved`, outcome `failed`, reason `paid_post_failed` / `paid_download_failed`, `costUsd` when known | `music.paid_request_without_bed` (error) |

Guarantees: a second paid generation for the same video id is never made (the ledger is create-if-absent and never reset); a failed `paid` spend line never discards a paid bed (the ledger resolves `generated` with reason `spend_log_paid_append_failed` and the cost, and `music.spend_accounting_degraded` is logged at error level); an unwritable spend log is caught before the ledger is claimed (`music.spend_log_unavailable`), so it neither spends nor consumes the video.

Limits, stated plainly: the spend log is one local file. `fsync` protects against a process crash, not against losing the disk or the container's volume, which is why the R2 ledger holds the cost and outcome as well. A message on stderr is **not** durable and is never relied on for accounting. If the ledger cannot be resolved (`music.ledger_resolve_failed`) the record stays `claimed`: the video is still consumed, but the outcome and cost then exist only in the log and the spend log. There is no daily or monthly spend cap, only the per-generation cap `MUSIC_SPECIALIST_MAX_USD`. A stronger design (a spend table in the existing Supabase project written before the request) would need a new table and migration and was deliberately not added.

## 2. Lambda requirements

Pro renders go to Remotion Lambda. For BGM on Lambda:

1. **Redeploy the Remotion site** (AWS; needs your approval) so the look-ahead envelope, carved-twin playback and the `leadSec` / `durationSec` fields reach Lambda. The repo's command is `npm run remotion:deploy`, which runs `remotion lambda sites create src/index.ts --site-name=kinmel-video-engine --region=us-east-1` (using `../.env`). The site name is fixed, so `REMOTION_SERVE_URL` should keep the same value; confirm after deploying. The Lambda function itself does not need redeploying unless the Remotion version changed. Until you redeploy, a Lambda render uses the old site: no look-ahead and the old envelope. Blueprints written by the new engine still render (new fields are optional), they just sound like before.
2. **The engine host masters the Lambda output**, not Lambda. After the Lambda render is verified, `masterLambdaOutput` downloads the MP4, runs the two-pass loudnorm with ffmpeg on the **engine host**, and uploads a new object `ai-video/render/<date>/<renderJobId>-mastered.mp4`. That needs ffmpeg on the engine host and R2 write access. **If mastering fails, the unmastered Lambda file is served** and the job carries the warning `music:master_not_applied` (log: `music.master_pass_failed`). The render does not fail.
3. **Audio latency.** Remotion's local output carries its audio late by 2048 samples (42.7 ms at 48 kHz); local renders correct it (`correctRemotionAudioLatency`). **The Lambda path is not corrected and was never measured.** Measure it with the click-track method in `remotionAudioSync.render.test.ts` on the first Lambda render (§3 step 5) before assuming it is the same.
4. Generated beds must be public https URLs (Lambda cannot read local files); otherwise the bed is dropped (`music.bed_url_not_public`).

## 3. One-edit verification (the listening test)

Do this once, on one real talking-head video, before announcing. It is the only step that can cost money.

1. Confirm the environment in §1 for outcome B (in particular `MUSIC_GENERATION_LEDGER=r2`, a writable `MUSIC_SPEND_LOG`, and a key). Run one edit from your own terminal:

   ```
   MUSIC_SPECIALIST=live npm run first-video -- /path/to/talking-head.mp4
   ```

   With `MUSIC_BED_FRESH=1` this generates one bed for this video (one Runware call). Use a short video first.
2. Find the line in `logs/engine.log`: `grep music.summary logs/engine.log | tail -1`. Also search the log for `music.mode_downgraded`, `music.dry_blocked_in_production`, `music.ledger_unavailable`, `music.spend_log_unavailable`, `music.paid_request_without_bed`, `music.spend_accounting_degraded`, `music.fallback` and `music.bed_muted_fail_safe`: **none of them may appear** for this edit. `music.bed_attached` must appear once.

   | Field | Expect |
   |---|---|
   | `source` | `generated`, with `costUsd` ≈ `0.0075` (outcome B). `pool` means outcome A or C: for this test that is **not a pass**. |
   | `fallbackTier` / `fallbackReason` | `null` / `null`. Anything else is outcome C (a pool bed standing in for a failed generation). |
   | `style` / `family` / `bpm` / `key` / `arc` / `speechWpm` | The brief: a style that fits the video, a tempo near the pace of the speech (a multiple of 4), `hook-then-steady` under 25 s, `build` to 60 s, else `steady`. `bedStyle` equals `style` for a fresh bed. |
   | `measuredLiftSec` / `liftAtVideoSec` / `hookAtSec` | Where the bed lifts, and where that lands on the video. `liftAtVideoSec` should be within about half a bar of `hookAtSec`. `null` when the bed has no lift. |
   | `startOffsetSec` / `startsOnDownbeat` / `placementScore` / `endType` | A real offset, `true`, a score between 0 and 1, and `button` or `hold-fade`. |
   | `loudnessAware` / `loudnessCorrectionDb` | `true` for a bed made after Phase 3.1; the dB the duck added, about -6 to +6. `false` for an older pool bed. |
   | `sfxSnapped` / `sfxDropped` | How many hits moved to a beat and how many the mask or spacing removed. |
   | `voLufs` | A real number, not `-20` exactly. |
   | `intendedSpeechGapLu` / `intendedPauseGapLu` | Expected `24` / `15` for a new edit under the default policy (`18` / `9` with `MUSIC_BED_POLICY=v1` or for a blueprint stored before that policy). |
   | `carvedApplied` / `masterApplied` | `true` / `true` |
   | `finalLufs` / `finalTruePeak` | ≈ `−14` / at or under `−1`. A local proof measured −13.9 / −0.9 (§7). |
   | `sfxHits` | Built-in hits are expected; `catalog` is `0`. |
3. `MUSIC_SPEND_LOG` has exactly three new lines for this video (`requested`, `paid`, `downloaded`), and `music/ledger/<videoId>.json` exists in R2 in state `resolved` with outcome `generated` and the cost (outcome B only).
4. Open the file and listen:
   - the voice is always clearly on top;
   - the music is audible in the pauses, and drops before each phrase (not into it);
   - no click where the loop repeats (videos over about 58 s);
   - no sound effect lands on the start of a word;
   - the music starts on a beat with the picture, steps up near the hook and ends on a bar line (or fades over the last 400 ms), with no long silent tail;
   - **it is music, not a steady tone with clicks** (that would be outcome D).
5. Repeat once as a **Lambda** edit (after §2). The same `music.summary` appears with `where: "lambda"`, followed by `music.master_pass` with `where: "lambda"`. If you see `music.master_pass_failed`, the unmastered file was served and the job has the warning `music:master_not_applied`: not a pass. Check the speech-to-picture alignment of the Lambda file against the source (§2 item 3).
6. Only after steps 1–5 pass and you have listened, record the result here with the date. **Until then BGM is not production-verified.**

## 3b. Tuning the rules

`server/src/stages/music/briefRules.json` holds the styles, tempo ranges, keys, arc cut-offs, pace thresholds and the mood x type -> style matrix. See "Tuning `briefRules.json`" in [VOICE_FIRST.md](VOICE_FIRST.md). Edit, run the server tests, redeploy the server image (the Python side reads the same file from the image). Existing beds and blueprints are not changed.

## 4. Fine-tuning by ear

On the blueprint saved for that edit (`out/blueprints/…`). Each command writes `out/renders/…mp4`, free. Add `--measure 1` for numbers (`music.mix_measured`, including `bedOverVoiceWindows`). A saved generated-bed blueprint written before bed-loudness provenance was recorded is refused until you attest its measured loudness with `--bed-lufs <LUFS>`.

```
# speech offset
npm run render-blueprint -- <bp> --speech-offset -16
npm run render-blueprint -- <bp> --speech-offset -18
npm run render-blueprint -- <bp> --speech-offset -20

# carved twin
npm run render-blueprint -- <bp> --carved 0
npm run render-blueprint -- <bp> --carved 1

# release
npm run render-blueprint -- <bp> --release-ms 300
npm run render-blueprint -- <bp> --release-ms 450

# look-ahead (0 = the old curve)
npm run render-blueprint -- <bp> --lead-ms 0
npm run render-blueprint -- <bp> --lead-ms 33.3
```

A rebuild keeps the timing the blueprint was saved with unless a flag overrides it.

## 5. Roll back (no code change)

- `MUSIC_SPECIALIST=off`: no bed on new edits (pool beds stop too). Old behaviour.
- `MUSIC_MASTER_PASS=0`: no master pass, local or Lambda.
- `MUSIC_CARVED_TWIN=0`, `MUSIC_DUCK_RELEASE_MS=450`: carved off, the old release, for new edits.
- `MUSIC_BED_POLICY=v1`: the original 18 / 9 / 4 levels for new beds.
- Saved blueprints are never changed by any of these: they keep their stored envelope, bed URLs and hits.

## 6. Merge

1. Review the large `phase 1.1 checkpoint` commit (`54f7e9d`) on its own, first. It is not part of this feature's review.
2. Then review `bgm-phase-2` against `main`, and merge it. Nothing has been pushed, merged or deployed by the engine work.
3. Known failures that are not music: see the Phase 2.4 section of `MORNING_REPORT.md` for what fails on the branch and on `main`.

## 7. Known gaps before BGM can be called production-verified (2026-11-16)

Fixed and tested locally in Phase 4 (offline, no paid call, no Lambda): the production dry-mode guard (§0), spend accounting (§1 "Spend accounting"), and the −1.5 dBTP master target (§1). Still open:

1. **Listening test not done** (§3), on local or Lambda. The new default levels (`voice_first_v2`) still await human approval by ear.
2. **Lambda audio latency is not corrected or measured** (§2 item 3). Local renders are corrected.
3. **The −1.5 dBTP target is verified on local renders only.** Local result on a stored bed: −14.0 LUFS and −1.4 dBTP (was −13.9 and −0.9). The Lambda master step runs the same function on the engine host but has not been exercised end to end.
4. **Pool contents are unknown.** The pools live in R2; whether a bed exists for each style is verifiable only on the server side. With an empty pool and no working generation an edit gets no music, and only logs say so.
5. **No app-visible signal** that an edit got a fallback (outcome C) or no bed; only logs and `musicProvenance` on the blueprint.
6. **Mastering failure is fail-open** (§2 item 2): the unmastered file is served with a job warning.
7. **Spend durability limits** (§1 "Spend accounting"): one local file plus the R2 ledger; no global spend cap. Reconciliation is manual (§8); there is no tool that lists open ledger records.

## 8. Reconciling a paid request whose outcome is not in the ledger

There is **no automated reconciler**. This is the manual procedure; it needs R2 read access, the engine log, the spend log and your Runware usage page. It never needs a code change, and it never deletes anything unless step 6 says so.

**When to run it.** Any of: a `music.ledger_resolve_failed` log line (the record stayed `claimed`); `music.paid_request_without_bed`; `music.spend_accounting_degraded`; a ledger object still `claimed` long after the hard-kill ceiling (`MUSIC_SPECIALIST_HARD_KILL_MS`) passed (the engine was killed mid-request); a spend-log `requested` line with no `paid`, `post_failed` or `download_failed` line after it. Also run it once a month for the invoice (step 7).

1. **Find the open records.** List the `music/ledger/` prefix in R2 and read each object. Open means `state: "claimed"` (no `resolution`). Each record holds `videoId`, `claim.claimedAt`, `claim.cacheKey` and `claim.estimatedCostUsd`. A `resolved` record is complete: stop.
2. **Collect the evidence for each open record.** In the spend log, every line with `video=<videoId>`; in the engine log, every line with that `video_id` (`music.generated`, `music.paid_request_without_bed`, `music.spend_accounting_degraded`, `music.ledger_resolve_failed`, `music.fallback`).
3. **Classify it.**

   | Spend log shows | Meaning | Cost to record |
   |---|---|---|
   | `requested` only | The engine died between the claim and the provider's answer, or the provider call is still unknown | Unknown: check the Runware usage page for that time. Record the amount shown, or "none" if nothing was billed. |
   | `requested`, `post_failed` | The provider call failed or timed out | Unknown (a timeout can still be billed): same check |
   | `requested`, `paid`, `download_failed` | Charged, bed lost | The `paid` line's `includeCost` |
   | `requested`, `paid` (no `downloaded`) | Charged, outcome of the download unknown | The `paid` line's `includeCost` |
   | `requested`, `downloaded` (no `paid`) | Charged, the paid line could not be written | Take the cost from the ledger resolution or the log (`music.spend_accounting_degraded`), else from the usage page |
   | `requested`, `paid`, `downloaded` | A complete paid request whose ledger write failed | The `paid` line's `includeCost` |

4. **Was a bed produced?** Check R2 for `music/beds/<cacheKey>/bed.wav` (the `cacheKey` is on the claim). A bed that was downloaded but could not be uploaded is kept in the engine's spool directory and is uploaded by the next music plan that runs on that host (`music.spool_flushed`): check the spool before concluding it is lost.
5. **Record the result.** Add the video id, class, amount and date to your own spend record (a spreadsheet is enough). Leave the ledger object as it is: `claimed` keeps the video consumed, which is the safe state. Only if the bed exists and you want it reused for that video, write a `resolved` record by hand with outcome `generated`, the `costUsd` and the asset URLs; the engine then serves that bed at no cost.
6. **Allowing one more paid attempt for a video (deliberate and rare).** No code path resets a ledger record. Only after step 3 shows **no charge** for that request, and with your explicit approval, delete that one ledger object in R2. This buys at most one more generation, capped by `MUSIC_SPECIALIST_MAX_USD`. Write down that you did it.
7. **Monthly check.** Sum `includeCost` over `state=paid` lines (never `requested` or `downloaded`, which repeat the same request) and compare with the Runware invoice. A difference is a request that was billed but never reached the `paid` line: find it in step 3.

What this cannot cover: a lost spend log and a lost ledger together (the Runware invoice is then the only record), and requests that were billed but never claimed (nothing in this design creates those).
