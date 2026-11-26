# 2026-11-26 (4): uploaded-asset reuse, photo cropping, readable captions, one font

Spend: none. Uncommitted. Needs the engine deploy AND `npm run remotion:deploy` (renderer changes).

- **Assets used once:** the WP20 filler lane put bound `broll_clip` uploads first without checking `usedUrls`, so a clip played for its ask and again as filler. Now every source must be unused. A final guard (`stages/broll/userAssetOnce.ts useEachUserAssetOnce`) keeps only the first placement of each creator URL (`polish_assets:duplicate_use_removed:N`).
- **Photos whole and behind the presenter (Kinetic):** the asset step hardcoded 1080x1080 cards (person / screenshot = top-right card over the face).
    - Now every photo is a `cutaway` with `backdrop: true`. `VisualOverlayTrack` draws the photo with contain (never cropped) in the upper frame over a blurred fill of itself.
    - The windows are added to the Kinetic `subjectForeground` spans, so the person matte (drawn above overlays) stands in front. The foreground is now kept whenever uploads were bound, even with no behind-text event.
    - Without a matte it is an uncropped cutaway (`polish_assets:backdrop_no_matte`). Non-Kinetic placement is unchanged.
- **Readable captions (caption lane):** lines revealed word by word and were cut when the next line's word began, so a line's last word showed for about one word's length (8 frames; 3 with long caps words that split one per row).
    - A lane unit now appears whole, stays up about 1 s or until 2 rows / 6 words, and a short closing unit joins the previous one. Touching coverage ranges merge, so there is no 1-word 8-frame lane beat.
    - Measured on a 0.3 s/word script: minimum on-screen 17 frames (was 8).
    - Lane beats also get at least 0.75 s after the last word starts, when the next beat allows.
- **One font per edit:** `voice.ts oneFace` sets every role in the preset's face (no preset: Anton, caps). The Match Cut carries `font` (new optional `matchCutProps.font`; absent = the old per-scene typefaces, byte for byte) and its keyword line uses the edit face. The keyword was hardcoded `poppins`, likely the "one word in a different font".
- **Counter:** a too-long context keeps the words next to the number (never scattered content words, whose middle gap sent the whole beat to the lane), and "0 to 10k" counts as shown by the counter.
- **Known limitation:** about 270 wpm synthetic speech still fails the Composer (V2 fallback), as before these changes.
- **Tests:** kinetic 212, pipeline, the broll asset suites and the full-edit lifecycle pass (the `mattingRunner` baseline is the only failure). Engine and remotion tsc are clean.

# 2026-11-26 (3): speaker cutout on a Modal GPU; droplet was never updated

Spend: none. Modal was not called or deployed; `modal` was only pip-installed in the scratchpad to import-check the app.

- **Droplet state (from the owner's deploy log):** HEAD was `38cf553` (19 Nov). `a277c75` (the Composer and the B-roll gate) never ran in production. The `ec1d050` pull aborted on a local edit to `captionkit_tmp/captionkit.py` (probably the same one-line centre offset committed in `a3760bb`).
- **CPU RVM measured:** one M1 core takes 160-190 s for a 10 s 1080x1920 clip (inference ~513 ms/frame). Max-side 640 takes 135 s. The foreground compose is cheap (11 s per 10 s on one thread).
- **Modal worker:**
    - `subjectmatte/modal_app.py` runs the same `human_matting.cli` on a T4 behind bearer-token auth.
    - The flag allow-list is in `subjectmatte/modal_args.py`; its test is `subjectmatte/test_modal_args.py`.
- **Engine:**
    - `media/remoteRvm.ts` is a drop-in `RunPython`: it uploads the working clip to R2, POSTs the flags, and writes the WebM and report.
    - `media/personMatte.ts` uses it when `RVM_REMOTE_URL` and `RVM_REMOTE_TOKEN` are set. Cache, slot, timeout and quality gate are unchanged.
    - New env vars in `config/env.ts`. Inventory entries added for the kinetic director transport and the remote matte.
- **Tests:** media 22/22 (4 new). Pipeline, kinetic and media: 392/393 (`mattingRunner` baseline). Python allow-list 8/8. tsc clean. The call-inventory staleness test is still a baseline failure (9 unlisted files, down from 10; `tempFiles.ts` stale).

# 2026-11-26 (2): AI B-roll opportunities; why phone Kinetic sat in the lower half

Spend: none. No paid calls (the model call is stubbed in tests), no R2, no deploy. Uncommitted.

- **AI B-roll detector:** new `stages/broll/brollOpportunities.ts`.
    - One Gemini call (label `Gemini broll opportunities`, same transport as the kinetic director) reads the whole transcript and points at word indices. Every timestamp comes from the real words.
    - Fixed rules then drop: low confidence, talking-head moments, the first 1 s, repeated entities, moments closer than 2.5 s (except within one continuity group), more than about 1 per 7 s (at most 6), and B-roll covering more than 35% of the video.
    - Uploadable treatments (entity, footage, product, screen) become the asset asks. Infographic, conceptual and kinetic-type picks stay in `blueprint.brollOpportunities`.
    - An empty answer means no asks. If the call fails, the keyword asks run as before.
    - Pinned on for Kinetic Typography (`brollOpportunitiesAi`, env `POLISH_BROLL_OPPORTUNITIES_AI` default off, style key gains `b`).
    - The post-upload re-analysis reuses the asks the creator answered (`priorAssetBrief`), so there is no second call and bindings match.
    - 11 new tests. Updated `lib/v1Release.test.ts` (style-key suffix).
- **Gemini budget:** one extra call per Kinetic edit (the last local run used 10 of 12). On refusal it falls back to the keyword asks.
- **Lower-half Kinetic (reproduced offline, no model):** the Composer harness ran on the aicut words with no matte, like the droplet (no RVM). With a typical head-and-torso speaker box, 20 of 22 blocks landed in the lower half.
    - `kit.ts zonesFor` only offers a `top` zone when there is at least 0.085 H between the Shorts safe top (0.13 H) and the face. Without a matte nothing can go behind the head, so every composition falls to chest / below / low.
    - The approved local edit had the RVM matte.
    - Options need an owner decision: RVM is postponed from V1. The layout was not changed.
- **Tools:** `server/src/scripts/inspectEditJobs.ts` is a read-only script for the droplet. It prints each recent full edit's style, B-roll asks and pipeline diagnostics.
- **Baselines unchanged:** `mattingRunner` (no RVM venv), the call-inventory staleness test (10 unlisted files, 1 new: the inspector), and older WP suites under `stages/broll` and `lib/assembler`. Those suites test code untouched since HEAD.

# 2026-11-26: phone edit had no Kinetic V2 and no B-roll asks

Spend: none (no paid calls, no R2, no deploy). Uncommitted.

- **Correction (droplet .env checked by the owner):** the droplet HAS `EDIT_STYLES_ENABLED`, `V1_KINETIC_RELEASE`, `V1_KINETIC_ACCESS=entitlement` and `POLISH_KINETIC_COMPOSER` set, so this was NOT the cause of the phone edit. It is still a real hole (closed below).
- **Hole (code-proven):** `resolveRequestedStyle` returns null when the style catalog is off (`EDIT_STYLES_ENABLED` and `V1_KINETIC_RELEASE` both unset). A Kinetic request then ran as a plain `full_edit` on `PRODUCT_EDIT_PROFILE`: no Kinetic V2, no Composer, and no Kinetic B-roll brief. None of these keys are in `.env.production.example`.
- **Fix:** `http/routes/editRoutes.ts` now refuses `kinetic_typography` with 503 `kinetic_unavailable` when styles are off, and logs it. `editStylesRoutes.test.ts` was updated; 75/75 route tests pass and tsc is clean. The Kinetic keys are documented (commented out) in `.env.production.example`.
- **Needs a human:** set `V1_KINETIC_ACCESS=entitlement`, `V1_KINETIC_RELEASE=1` and `POLISH_KINETIC_COMPOSER=1` on the droplet, then deploy.
- **App (creators_kinmel):** the Edit Completed sheet was replaced by a 2 s top banner, so the preview plays and the continue button works. The X and download buttons share one anchor. The asset gate is now a list of tags: tap to upload, X to drop.

# 2026-11-25 (night) — aicut.mp4 review fixes + paid Kinetic run

Owner-approved paid run (runner `server/src/scripts/kineticRun.ts`). Changes are uncommitted.

## Spend
Run aicut-20261125-174812: 10 Gemini calls (est. $0.0026), Groq transcript cached, one Runware bed $0.009 (failed QC on the loop seam alone, not used). Spend log: `out/kinetic-v2/aicut-20261125-174812/music/spend.log`. No Claude, no Lambda, no R2 writes.

## Fixed
- Slanted rows touching (COMPLETELY / DIFFERENT): rows are spaced on their projected (turned) edges (`slant.ts spaceRows`), new verifier rule `slant-row-gap`.
- Missing words (first 3 words, "know about it"): composer splits a beat whose lead-in / tail a designed composition cannot draw into a caption-lane beat; new rule `word-coverage` (an edit with an unshown word fails closed). Result 71/71 (was 65/71).
- Lane handover collision (one-frame overlap), takeover-spacing counted a slanted card's own rows, repair re-solve could repeat a neighbour's composition, slant history recorded the asked (not drawn) yaw.
- Director (same single call, now memoised across re-solves) suggests text-behind beats and at most one Match Cut; `matchCut.ts directorMatchCut` keeps the structural rules (a setup with no reveal after it is refused). Decisions are logged as `kinetic_composer:match_cut:*` / `behind:ai:*`.
- Matte rejected for a sub-frame empty tail keep segment (`autoTrim.ts`, `kineticMatteStage.ts`): behind text now runs (2 behind beats in the new edit).
- AI colours on for the Pro style (`styleRun.ts kineticAiPalette`). Takes effect only where the Composer runs.
- Music: `publicUrlForKey` follows local storage (dev); a bed failing ONLY the loop seam is used without its loop when it is longer than the video (never pooled). Local bed URLs allowed only with STORAGE_BACKEND=local.

## Tests
kinetic + filters + pipeline + lib vitest: all pass except known baseline (mattingRunner needs the RVM venv; assembler missing north-star fixture; layout determinism flake under load, passes alone). Music vitest 319/319, music pytest 92 passed. Server tsc clean.

## Needs a human decision
- Production does not list `POLISH_KINETIC_COMPOSER` in its env template: without it Pro edits use the plain V2 engine (no Composer, no AI colours, no AI behind / match cut).
- Text-behind needs RVM on the server (not provisioned).
- BGM for aicut.mp4 needs one more Runware generation (~$0.009) and clearing this video's local ledger record.

# 2026-11-24 (afternoon) — Composer: one slant per frame, AI-chosen colours

Changes are uncommitted. No paid calls (local compose and render only). `spend.log` does not exist in this checkout.

## Slant
- Cause: in the "AND THIRD / THEY ARE OFFERING / EXCLUSIVE HELP" frame the chip was flat, the plain words were turned as one block about its centre, so each row leaned at a different angle.
- Fix: new `composer/slant.ts`.
  - A beat with a chip or highlighter is entirely flat.
  - A slanted multi-row block is split into rows, each turned about its own centre with the same yaw and pitch.
  - New verifier rules: `slant-rows` and `slant-mixed`.
  - `listItem` was removed from the slantable set, and the motion gate now counts only the treatments that can slant.
- Local proof: the paid run's transcript and cuts recomposed without Gemini and rendered, at `out/renders/slant-fix-2026-11-24/live-slant.composer.mp4`. It shows 0 violations, and the "third" beat is flat.

## Colour
- Before this change, colours were not decided by AI. They came from the selected caption preset (Punchline is white with a yellow accent, and `#FFD400` is the fallback accent).
- New flag `POLISH_KINETIC_AI_PALETTE`, default off. With it on, the Director picks a curated palette using the footage colour. It is in the same Gemini call, with no extra calls.

## Tests
- `vitest src/stages/kinetic`: 202/202 pass, including 4 new tests.
- `src/lib`: passes except the existing `assembler.test.ts` failure, caused by the missing fixture `director-dump-northstar/04-blueprint-applied.json`.
- Server `tsc`: clean.

## Needs a decision
- Should the AI palette be on by default for Pro? It overrides the preset's colours, and the V1 rule says the preset sets the identity.

# 2026-11-24 — Full-pipeline Kinetic run: pre-flight fixes (paid run not yet re-run)

Branch: `main`. Changes are uncommitted.

## Spend so far
One live attempt: 1 Groq call and 10 Gemini calls, about $0.005–0.01. It failed closed at the end with `v1_release_off`. No Claude, Runware, R2 or Lambda.

## Fixed before the next paid run
The runner is a scratchpad script modelled on `styleVerify.ts`:
- It forces safe settings after the `.env` loads (it loads with override): `STORAGE_BACKEND=local`, R2/Claude/Runware keys blank, `MUSIC_SPECIALIST=off`, no Lambda, Gemini cap 12.
- A fetch guard allows only Gemini, Groq and this machine.

What changed:
1. `V1_KINETIC_RELEASE=1` for the run. Without it the style ran the old polish path, not Kinetic V2 or the Composer.
2. `footageKind: 'camera'` plus a caption preset (Punchline), as the app sends. Without `camera` the engine refuses at the end.
3. The input `ai-render-….MP4` is an earlier render with burned-in captions. The clean original `Downloads/r.mp4` is used instead.
4. **Engine fix (`compositions.ts`).** A highlighter or list chip drew before its word arrived (an empty yellow box for about 0.2 s). It now starts at the word's built entry. New test added.
5. **Transcript cache.** The rehearsal's local transcript was removed from `kinmel-asr-cache`, so the live run calls Groq.

## Free rehearsal (dummy keys, Gemini answered locally, transcript from local whisper)
- The full pipeline completed and rendered: Kinetic V2 and the Composer ran (variety 81, 0 overlapping words, every box draws with its word).
- Rehearsal output: `out/renders/full-pipeline-2026-11-24/rehearsal/edit.mp4`.

## Tests
`vitest src/stages/kinetic`: 198 of 198 pass. Server `tsc`: clean.

## Live paid run (done, 13:39)
- **Calls:** 1 Groq call and 11 Gemini calls (cap 12). The engine estimates $0.00528. Nothing else was called.
- **Cleanup:** AI cleanup took the clip from 43.3 s to 40.3 s.
- **Matte:** the RVM matte was ready (area 0.359), with 3 behind-the-speaker moments ("BETTER", "EASIER" and one more).
- **Composer:** variety 75, 6 distinct treatments. It used the deterministic direction because the Gemini Kinetic Director call hit the cap. No Match Cut was planned.
- **Remaining defect:** a 1-frame overlap of "way" with "best" in `b4` (`markerHighlight`, plain event against backed event). Not fixed yet.
- **Output:** `out/renders/full-pipeline-2026-11-24/live/edit.mp4`.

# 2026-11-23 — Composer: no overlapping words, uniform callout boxes, no underlines

Branch: `main`. Changes are uncommitted. Spend: none: no paid calls, no R2, no render. `agents/music_specialist/spend.log` does not exist in this checkout.

## Overlapping words (user screenshots: "findsensekes", "yousomeoneith", "BECATHREEF THE")
- **Cause.** A regression from the earlier "settle before exit" change: a short-lived word was pulled to enter early, before the previous caption line or swap unit had left. Words also slid or dropped across neighbours that were already on screen.
- **Fix (`kit.ts`).**
  - A replacing word enters only after its predecessors' exit has ended.
  - Exits are never pushed late.
  - Side entries come from the clear side, or travel only as far as the gap; rise and drop stop short of the next row.
  - Split plain and backed events see each other's words.
- **New verifier rule** `word-collision` (`verify.ts`).
- **Proof.** An independent frame-by-frame check, across all events, of the 5 corpus specs:

  | | Overlapping word-frames |
  |---|---|
  | Old review specs | 459 |
  | Specs after the fix | 0 |

## Uneven boxes ("YOUR" and "LOSSES" in different boxes)
`calloutBar` now draws one bar per visual row (grouped by overlap, not by exact centre), with one shared height and padding, and every word at one size.

## Underline removed
- Removed from `lineWipe` and `ctaCard`.
- `shapeEl` no longer accepts `'underline'`; the renderer still draws it for old specs.
- The Director prompt text was updated.

## Tests
- `vitest src/stages/kinetic`: 197 of 197 pass, including 2 new tests (no underlines with uniform bars; no collisions plus the rule firing on a forced overlap).
- Server `tsc --noEmit`: clean.
- Not re-rendered, by request.

# 2026-11-23 — Composer: perspective slant and behind-the-speaker via RVM

Branch: `main`. Changes are uncommitted. Spend: none.
- RVM was installed in the session scratchpad only: torch from PyPI, plus the official `rvm_mobilenetv3.pth` from the RVM project's GitHub release (sha256 `3c7c1d92…cf4f8`).
- Nothing was added to the repo or the `.env` files.
- `POLISH_KINETIC_COMPOSER` and `POLISH_KINETIC_ENGINE_MATTE` stay off.

## Slant
- The in-plane rotation is replaced by perspective yaw: rotateY 20–40° by tone, sometimes with rotateX pitch, at a perspective of 950 px.
- The projected block is fitted inside its free region: the yaw is trimmed if needed, then the block slides a few pixels.
- Words on flat backings stay flat. In a list item, the item words slant while the chip stays flat.

## Behind the speaker
- The composer takes the RVM matte and places giant-word or hero-stack moments behind the head (intensity 0.6 or more, at most one every 6 s). Each word slides down onto the real head, measured on the matte, until 8–26% of it is covered.
- Lead-in words stay in front.
- Punch-ins are off when a matte is used.
- `--matte` in the corpus CLI runs the production `prepareKineticMatte` stage, and the render layers the person foreground over the text.

## Corpus
| Clip | Matte | Behind moments |
|---|---|---|
| Kensington | Yes, area 0.36 | 3 |
| Overtrading | Yes, area 0.46 | 2 |
| Relationship | Yes, area 0.57 | 0 (the speaker fills more than 55% of the frame, so it is refused by rule) |
| Three things | No: off-by-one frame (CLI bug, fixed) | — |
| Thought of the day | No: off-by-one frame (CLI bug, fixed) | — |

- The render was stopped by the system (low memory) after 2 of 5 MP4s.
- The metric bug that counted `.b` backed events as repeats is fixed.

## Tests
- Composer vitest: 19 of 19 passed.
- Server `tsc`: clean.

# 2026-11-22 (later) — Kinetic Composer craft fixes and motion variety

Branch: `main`. Changes are uncommitted. Spend: none. There were no Gemini, Claude, Lambda or R2 calls, and `spend.log` is absent. `POLISH_KINETIC_COMPOSER` stays off.

## Fixes

- **Backed text** (chips, highlighters, callout bars, question cards, takeover cards):
  - Each backed word is split into its own event with no outline, no glow and no push. A new verifier rule, `backed-stroke`, enforces this.
  - Padding is at least 0.34× the font size vertically and 0.24–0.30× horizontally, with wider row and word gaps.
  - Colours come from curated pairs (`BACKED_PAIRS`). Mid-tone preset accents, such as salmon, are refused.
- **Contrast:** the strike line is removed. The old word dims and leaves about 0.35 s after the new word lands.
- **Motion:**
  - A new optional `RenderEvent.rotateDeg` gives an in-plane angle (both schema copies updated; the Remotion `KineticEventView` applies it only when present).
  - Type and its shapes turn about one pivot. The angle is trimmed until the rotated group stays in its free region; new verifier rules `rotated-safe-rect` and `rotated-face-keepout` check it.
  - New `slide` and `slideOut` motions. Entry and exit sides are separate. Supporting words use their own motion pool per tone.
  - A motion gate requires at least 5 entries, 3 exits, 2 side flips and 2 angled treatments. It re-plans with another seed up to twice, then fails closed to V2.
- **Behind the speaker:** with a matte, a high-impact giant word can sit behind the speaker's head (at most one every 8 s), and the existing occlusion verifier judges it. A refused placement goes back to the front. Without a matte, which is V1 today and every local review, nothing is drawn behind.

## Results (5 clips)

| Measure | Range across the 5 clips |
|---|---|
| Distinct entries | 8–10 |
| Distinct exits | 4–5 |
| Side flips | 11–16 |
| Angled treatments | 4–9 |
| Variety score | 79–82 |

Behind: 0 on every clip, because there is no matte.

## Tests

- Composer vitest: 19 of 19 passed.
- Kinetic plus pipeline and flag suites: 275 passed.
- Server `tsc` and Remotion `tsc`: clean.

## Outputs

- MP4s overwrite `out/renders/composer-review/*.composer.mp4`.
- Proof stills are in `out/renders/composer-review/proof/<clip>/`.

# 2026-11-22 — Kinetic Composer (varied kinetic typography engine, P0–P10)

Branch: `main`. HEAD is `a3760bb1fa914624b275cd87fe78c40a9b3be9f4`. Changes are uncommitted. Nothing was pushed, merged or deployed.

## Spend proof

- `agents/music_specialist/spend.log` was absent at the start and absent at the end.
- No Runware, Gemini, Groq, Claude, Lambda, R2, `first-video` or `analyzeVideo` run.
- Transcripts for the corpus came from local faster-whisper (base.en, CPU) installed in the session scratchpad, which is free.
- Renders used local Remotion only.

## What was built

Kinetic Composer is a beat-driven planning layer inside the Kinetic V2 engine, behind `POLISH_KINETIC_COMPOSER` (default **OFF**). Full description is in `server/src/stages/kinetic/composer/README.md`.

| Phase | What was built |
|---|---|
| P0 | Variety metrics (`metrics.ts`) and a corpus harness (`cli.ts`) running on 5 real clips. |
| P1 | Optional `RenderSpec.scene` and `RenderEvent.composition` fields (both schema copies kept identical), plus the Remotion `SceneLayer.tsx` for plates, shapes and counters. |
| P2 | Beat analysis (`beats.ts`). |
| P3 | 14 compositions plus the reduced-take ladder. |
| P4 | Beat punch-ins solved against the zoomed face; a punch-in that displaces its beat is removed and the edit re-solved. |
| P5 | Typography voice: preset identity plus companion faces. |
| P6 | Edit direction (deterministic, with one optional Director call) and the variety controller. |
| P7 | Caption lane. |
| P8 | Composer guardrails (`verify.ts`) on top of `verifyRenderSpec`, with a repair loop. |
| P9 | Flag, `kineticEngineStage` composer path with V2 fallback, `analyzeVideo` zoom handoff, cache key suffix `c`, B-roll split also drops scene elements. |
| P10 | Corpus specs, stills and MP4 renders in `out/renders/composer-review/`. |

## Results (same clips, same speaker box, deterministic, no Director)

| Clip | Composer score | V2 baseline score | Designed time (composer / baseline) | Distinct treatments (composer / baseline) |
|---|---|---|---|---|
| Kensington | 75 | 25 | 55% / 22% | 8 / 2 |
| Relationship | 77 | 19 | 55% / 24% | 7 / 1 |
| Three things | 78 | 20 | 59% / 23% | 7 / 1 |
| Thought of the day | 84 | 23 | 63% / 33% | 8 / 1 |
| Overtrading | 73 | 24 | 53% / 24% | 7 / 2 |

- Pairwise sameness across videos: 0.78 for the composer, 0.87 for the V2 baseline (designed treatments only).
- All 15 treatments appear across the corpus. The composer has 0 back-to-back repeats; the baseline has 9–13 per clip.
- The baseline's most-used treatment covers 86–100% of its lockups; the composer's covers 18–33%.

## Tests

- Composer vitest: 14 of 14 passed.
- `src/stages/kinetic`, including the composer: 190 passed (final run).
- `src/stages/kinetic` together with v1Release, styleRun, effectiveFlags and editStyles: 235 passed (run before the last composer fixes).
- Pipeline and eval set (effectiveFlagsParity, phase523, finalizeEdits, editStyles pipeline and runner, kineticIdentity, fullEditLifecycle, wp57, editExecutionContracts, kineticAccess, capabilityAudit, recoverySwitch): all passed after one pin update. The pin was for the `muteRanges` line changed by the earlier Kinetic + B-roll task, a pin I had missed then.
- `src/stages/broll`: 36 failures, the same count as the earlier baseline (missing proof artifacts and source pins).
- Server `tsc` and Remotion `tsc`: clean.
- Pytest was not run, because `agents/.venv` does not exist.

## Needs a human decision

- Turning `POLISH_KINETIC_COMPOSER` on for V1 Kinetic.
- One live test with the Director on real clips. This is a paid Gemini call, one per edit, the same as V2 today.

# 2026-11-18 — Kinetic entitlement access

Branch: `main`. HEAD is still `9cf6c65431d115e10faa1e934cd9867ce26e1c2b`. Changes are uncommitted. Not pushed, merged or deployed.

## Spend proof

`agents/music_specialist/spend.log` was absent at the start and absent at the end. No Runware, LLM, Lambda, `first-video`, R2, or deploy.

## Task

Production Kinetic access no longer depends on a UUID allowlist.

- `V1_KINETIC_ACCESS=entitlement` is accepted in production. `V1_KINETIC_ALLOWED_USER_IDS` is ignored in that mode.
- Create, retry, asset submit, the catalog, and the Kinetic worker admit a subscription only when the Creators API returns `verified: true`, `plan` `pro` or `pro_plus`, and `source: "revenuecat"`.
- `source: "nepal_verified"` is refused. A verified `free` plan (how Flask reports expired and cancelled entitlements) is `pro_required`. A failed lookup is `entitlement_unavailable`.
- `allowlist` and the production refusal of `all` are unchanged. Allowlist still uses the broader Pro check, so a listed Nepal-verified account is still admitted there.

Files: `server/src/lib/kineticAccess.ts`, `server/src/lib/entitlement.ts`, `server/src/http/routes/editRoutes.ts`, `server/src/config/env.ts`, `.env.production.example`, and the two kinetic access tests.

## Tests

- Kinetic unit + HTTP, V1 gate, entitlement enforcement, music/sfx/renderBlueprint vitest: 250 passed, 1 skipped.
- Server `tsc --noEmit`: clean.
- Remotion `tsc --noEmit`: clean.
- Pytest was not run. `agents/.venv` does not exist, and this change does not touch the music specialist.

## Production env

`V1_KINETIC_RELEASE=1`, `V1_KINETIC_ACCESS=entitlement`, `ENTITLEMENT_ENFORCEMENT=1`, with `CREATOR_API_URL` and `ENGINE_API_KEY` set. Leave `V1_KINETIC_ALLOWED_USER_IDS` unset. Do not set `V1_KINETIC_ACCESS=all`.

## Needs a human

Commit is not created. A Nepal-verified account who also pays is refused, because Flask returns `source: "nepal_verified"` and does not call RevenueCat. The engine cannot see that purchase until the Creators API stops short-circuiting.

# Phase 3.1

Branch: `bgm-phase-2`. Not pushed, merged or deployed. Date: 2026-11-04. Policy: [docs/audio/VOICE_FIRST.md](docs/audio/VOICE_FIRST.md) (the "Loudness-aware ducking" section is new).

## 1. Spend proof

- `agents/music_specialist/spend.log`: absent at the start, absent at the end. Unchanged. No Runware, LLM, Lambda, `first-video` or deploy.
- **No renders.** Free disk was 10 GB (under your 15 GB limit) at the start and at the end, so I implemented and unit-tested only. **Step 5 (the 15 s on/off proof re-run) was skipped for that reason.** The numbers below come from the unit-test model, not from a render.

## 2. What changed

The duck now holds the voice-first gaps for whatever part of the bed is playing instead of assuming the bed sits at −16 LUFS everywhere.

1. **`postprocess.py` (version 5).** Short-term LUFS **per bar**, aligned to the downbeats, for `bed_full`, `bed_carved` and `bed_loop`: `loudness_map`, `carved_loudness_map`, `loop_loudness_map` (and `loop_lufs`) in `meta.json`. It rides into the plan and the pool entry like the energy map. A silent or too-short bar reads −70, never −inf. A bed without the maps behaves exactly as before.
2. **Envelope, server and Remotion together** (`duckEnvelope.ts` in both; parity checked at every 1/120 s). A new optional `bedLoudness` track on the duck. `duckDbAt` is now `duckBaseDbAt` (the static curve, unchanged) plus a correction, clamped to [−40, 0]:
   - correction = (assumed −16 LUFS) − (bed loudness at that moment), **never more than +6 dB**. That is the same as gain = (voice + offset) − bed loudness. It applies to the `talking` preset only.
   - `bedLoudness.ts` builds the track after placement: the bed position playing at each moment (the full bed from the start offset, then the loop body from the hand-off), the carved twin under speech mixed with the renderer's own crossfade weights, **smoothed over about one bar** and limited to **0.4 dB per frame at 30 fps** (so the correction never jumps).
   - Attack, hold, release and look-ahead are unchanged (a test compares the static curve with and without a track).
   - `MusicBedTrack` now reads the static curve for the carved crossfade, so the correction moves the level and not the mix. For an old envelope that is identical.
3. **`VOICE_FIRST.md`** and `BGM_RELEASE.md` updated: "placement never changes gains" is now "gains are computed from the measured loudness of the bed section actually playing".
4. **`music.summary`** gains `loudnessAware` and `loudnessCorrectionDb {minDb, maxDb}`.
5. **Scope note.** The track is built for **every generated bed that has a map, whether or not it was placed** (so also with `MUSIC_PERSONALIZE=0`: the bed plays from 0 with the legacy loop hand-off). I read "expect on and off both near 18" as meaning that. It means `MUSIC_PERSONALIZE=0` is no longer byte-identical to Phase 2.4 for a bed made after this change. Say if you want it gated on the flag.
6. `makePersonalizeProof.ts` builds the track for both the "on" and "off" blueprints, ready for the 15 s re-run.

## 3. Tests and checks

- **Old beds unchanged:** an inline snapshot of `duckDbAt` at 22 times, taken from the code *before* this change, still matches to 6 decimals for an envelope with no track; a bed without a map gets no track; other presets ignore a track.
- **Synthetic bed, quiet first 8 bars then a loud section:** for **every** placement offset (20 downbeats) the speech gap is 18 ± 1 LU and the settled pause gap 9 ± 1 LU. A companion test shows the old static duck drifts outside that band for the same offsets (so the test can fail).
- Also covered: the +6 dB boost cap (a near-silent intro stays quieter than target, never louder), the [−40, 0] clamp, the 0.4 dB/frame slew across a 12 LU step, smoothing over about a bar, loop hand-off, carved twin under speech and full bed in pauses, the log range, `render-blueprint`-style no-placement playback, and the wiring order in `analyzeVideo`.
- pytest: 67 to **70** (the per-bar map matches a direct measurement of each bar; silence and short chunks; the three maps in `postprocess_bed`). Server music/lib/scripts/directorV2 suites plus the three `analyzeVideo`-pinning eval/broll tests: 640 passed, 1 failed (`assembler audit (Gabby)`, which also fails on `main`). Server `tsc` clean. Remotion `tsc`: only the 3 known errors. I did not re-run the full 7-chunk suite for this change; the only non-music file I touched is `analyzeVideo.ts`, and the tests that pin its source pass.
- Commits: `fe90c42` (the feature), `621fe17` (independent of the flag, proof generator).

## 4. Numbers (unit-test model, NOT a render)

Mean gap over all speech moments and all settled pause moments, across the 20 possible start offsets, synthetic bed (quiet first 8 bars, loud after, per-bar LUFS as postprocess would measure them):

| bed contrast | static duck: speech / pause | **loudness-aware: speech / pause** |
|---|---|---|
| −19.5 to −13.5 LUFS (6 LU) | 15.5..16.3 / 6.5..7.3 | **18.0..18.0 / 9.0..9.1** |
| −21 to −12 LUFS (9 LU) | 14.0..14.9 / 5.0..5.9 | **17.9..18.0 / 8.9..9.1** |

So the model holds 18 and 9 for any offset, where the static duck was 2 to 4 LU too close to the voice. Real renders also carry the Remotion 1/97 volume step and the −20.13 versus −20 voice measurement (about 0.4 LU together, seen in every earlier phase), so expect a render to read about 17.5 rather than 18.0.

## 5. Limits and decisions

- The +6 dB cap is deliberate (you asked for it): a bed whose quiet section is more than 6 LU under its average stays a little under target there, on the quiet side.
- Beds made before this change have no map and keep the static gains (`loudnessAware: false`). The salvaged high-energy bed has none; it needs reprocessing to gain one (a pool backfill writes to R2, which I do not do).
- The 15 s on/off proof re-run is still open: with at least 15 GB free, run `node --experimental-strip-types src/scripts/makePersonalizeProof.ts --write` in `server`, then `render-blueprint out/fixtures/personalize/punchy-15s/{off,on}.json --master 1 --measure 1` one at a time, and compare with `out/proof/phase3/results.json` (the pre-3.1 numbers: speech 22.0 off, 17.7 on). Expect both near 18 (about 17.5 after the render effects above).

# Phase 3

Branch: `bgm-phase-2` (Phase 3 was not split onto its own branch). Not pushed, merged or deployed. Date: 2026-11-04. Human checklist: [docs/audio/BGM_RELEASE.md](docs/audio/BGM_RELEASE.md). Policy: [docs/audio/VOICE_FIRST.md](docs/audio/VOICE_FIRST.md).

## 1. Spend proof, and what the resume did

- `agents/music_specialist/spend.log`: absent at the start of Phase 3, absent after the crash, absent at the end. Unchanged. Runware calls 0, LLM calls 0, Lambda renders 0, R2 writes 0, no `first-video`, no deploy.
- Resume: all Phase 3 work was already committed (`10a8016` is the head, working tree clean). I redid nothing.
- **No render was run in the resume.** Free disk was 11–13 GB, under your 15 GB limit, so I would not have rendered anyway. It was not needed: the six proof renders had finished and logged their numbers before the crash (the second launch, after the `.env` fix). I recorded them in `out/proof/phase3/results.json`, kept one MP4 per video (the "on" version) in `out/proof/phase3/listen/`, and deleted the other proof MP4s. The test chunks ran one at a time with 2 workers, nothing else running.
- Spend: the crash did not touch `spend.log`.

## 2. Per task

| Task | Status | Commit |
|---|---|---|
| 1. MusicBrief (`musicBrief.ts`, `briefRules.json`) | done | `6ec6d6f` |
| 2. 10 styles, matrix mood x type, `PROMPT_VERSION` 4 | done | `6ec6d6f` |
| 3. Tempo from speech pace, key from `hash(videoId)` | done | `6ec6d6f` |
| 4. Arc request (lyrics tags) and measured energy map and lift | done | `6ec6d6f`, lift refinement in `10a8016` |
| 5. Placement (`placement.ts`, `intensity.ts`, `MusicBedTrack`) | done | `128b3c6` |
| 6. SFX on the beat behind the word mask, catalog hook/CTA | done | `128b3c6` |
| 7. Pool and generation per brief, style then family fallback | done | `b3319f3` |
| 8. `music.summary`, offline proof, docs, `render-blueprint` fix | done | `10a8016` |

- **Brief** is built where the music job starts (inside `runDirectorV2`, because music runs in parallel with the director). Real cuts and zooms do not exist yet at that point, so sentence starts stand in for the cut rate there; placement later uses the real events. No extra LLM call.
- **Styles:** the 10 suggested ones, unchanged. I kept your table because it covers all 5 families and every visual mood x content type maps to a style (a test fails on any gap). The mapping gives each mood three slots (softer, balanced, livelier) picked by content type, for example `warm_intimate` x `personal_story` is `warm-keys`, and `bold_energetic` x `motivational` is `driving-electronic`. Every style has 12 tags or fewer, including `no lead melody` and `no vocals`.
- **Build emit:** `briefRules.json` is imported (not read with `fs`). I built the server with `tsc` into a scratch folder and confirmed the JSON is emitted and a brief builds from `dist`. The Dockerfile copies it for Python.
- **Tests added:** pytest 44 to 67. Server tests +89 (brief, placement, intensity, SFX snapping, pool and fallback tiers, summary, proof script, `render-blueprint` env order). Parity: `placementGain.ts` is the only Remotion-side logic; it is a pure file and a test checks it stays between 0 and 1. The envelope is unchanged when placement is on (a test compares `duckDbAt` at 120 Hz).
- **Checks at the head:** pytest 67 passed; server `tsc` clean; Remotion `tsc` only the 3 known errors; music/lib/scripts/directorV2 suites pass except the assembler test that also fails on `main`.

## 3. The `.env` override bug (found in Phase 3, fixed)

- **Bug:** `config/env.ts` loads the engine `.env` with `override: true` when `localRender` is imported. `render-blueprint` set its flags before that import, so a `MUSIC_*` value in `.env` silently replaced `--measure`, `--master` and `--carved`. The first six proof renders had no measurement for that reason (`.env` has `MUSIC_MIX_MEASURE`, edited at 13:40:30).
- **Fix:** `applyRenderEnv` now runs after the imports. A test pins both the behaviour and the order.
- **Check against your real `.env`** (booleans only, no values printed): old order, `--measure 1` loses (`measureFlagWins: false`); fixed order, all four flags win (`out/proof/phase3/flags_override_check.jsonl`). `LOCAL_RENDER_SKIP_R2` is not in your `.env`, so no proof render was ever uploaded.

## 4. Were Phases 2.1–2.4 affected? No.

The `.env` was last edited at **13:40:30**. All ten measured proof renders of Phases 2.1–2.4 ran between 10:47 and 13:21, before that. In each of them the flags demonstrably took effect: the measurement ran at all, master 0 gave −22 LUFS and master 1 gave −13.9, carved 0 and 1 gave speech gaps 17.3 and 18.7, release 450 and 300 gave different settled-pause numbers. So the numbers in the Phase 2.1–2.4 reports stand and no re-measure was needed. (What I cannot see is the earlier contents of `.env`; the evidence above does not depend on it.)

## 5. Proof table (free, local; `render-blueprint --master 1 --measure 1`)

Three synthetic edits, each as an "on" blueprint (what analyze saves with `MUSIC_PERSONALIZE=1`) and an "off" one (`0`, Phase 2.4). Same words, same source, same duck envelope and the **same bed audio**, so the difference is placement only. Intended gaps 18 (speech) / 9 (pause).

| video | mode | speech gap | settled pause gap (n) | windows within 6 LU of the voice | closest window | final LUFS | true peak |
|---|---|---|---|---|---|---|---|
| 15 s fast | off | 22.0 | none (0) | 0 | 17.11 | −13.9 | −3.6 |
| 15 s fast | **on** | **17.7** | none (0) | 0 | 16.92 | −13.9 | −3.8 |
| 40 s normal | off | 18.0 | none (0) | 0 | 16.98 | −14.0 | −3.9 |
| 40 s normal | **on** | **17.2** | none (0) | 0 | 17.05 | −14.0 | −3.8 |
| 90 s slow | off | 17.7 | 9.0 (12) | 0 | 17.05 | −14.1 | −3.6 |
| 90 s slow | **on** | **17.4** | **8.7** (12) | 0 | 17.03 | −14.0 | −3.6 |

Settled pause gap is "none" on the first two because their pauses (0.65 s, 0.8 s) are too short to settle (that is by design, see Phase 2.2).

| video | brief | offset | lift on video vs hook | on a downbeat | ending | score | SFX scheduled / snapped / dropped |
|---|---|---|---|---|---|---|---|
| 15 s | `driving-electronic` 128 bpm A minor, `hook-then-steady`, 213 wpm, high | 7.988 s | 3.29 s vs 2.5 s (1.7 beats) | yes | button at 15.0 s | 0.70 | 5 / 0 / 0 |
| 40 s | `corporate-light` 104 bpm G major, `build`, 152 wpm, medium | 9.822 s | 1.72 s vs 2.5 s (1.4 beats) | yes | button at 39.36 s | 0.75 | 6 / 0 / 0 |
| 90 s | `lofi-chill` 72 bpm G minor, `steady`, 111 wpm, low | 10.844 s | 2.51 s vs 2.5 s (0.01 beats) | yes | hold and fade to 90 s (last bar line over 1.5 s early) | 0.75 | 5 / 1 / 0 (2 more removed by the word mask at scheduling) |

**Rendered-stem check** (a bed-only render of the 15 s "on" edit, no ducking): the lift lands at **3.30 s** on the video against 3.291 s from placement, the music is silent after the end time and audible before it. So the start offset is applied correctly by Remotion.

### The criterion "on must be no worse than off" is NOT met numerically — decision for you

"On" has a smaller speech gap than "off" in all three (by 4.3, 0.8 and 0.3 LU) and a smaller settled pause gap in the 90 s (by 0.3 LU). I did not hide this. What I think is happening, and what it does and does not mean:
- The duck gain assumes the bed sits at its integrated −16 LUFS everywhere. A real bed is not flat: the part that plays under the speech differs from the average. Placement changes which part plays, so the gap moves with it.
- "Off" for the 15 s edit is 22 only because its first 11 s play the synthetic bed's quiet intro pad. That is luck, not a target. Against the **intended 18**, "on" is 0.3, 0.8 and 0.6 LU short, which is the same 0.5 LU shortfall found in Phases 2.3 and 2.4 (Remotion's 1/97 volume step and the voice measuring slightly under the assumed −20). Nothing is near the voice: the closest window is 16.9 LU under it, and none comes within 6 LU.
- Per the Phase 3 spec, placement never changes a gain, so I did not add a fix. The real gap is that the envelope does not know the bed's loudness where it plays. A bed with a loud lift section placed so the lift lands under early speech could sit closer to the voice than the average suggests.
- **Options:** (a) accept it (all gaps 17.2–17.7, closest window 16.9); (b) build the duck from the bed's measured per-bar loudness at the chosen offset (postprocess would emit a per-bar LUFS map; the envelope would use it instead of the −16 assumption). (b) makes the gap track 18 whatever the placement, and "on" could still read lower than a lucky "off", but it removes the hole. It changes how the envelope is built, so I stopped for your call.

Other limits seen in the proof: with the offset restricted to downbeats, the lift can only land within about half a bar of the hook (1.4 to 1.7 beats for the 15 s and 40 s edits; ±1 beat only when the grid happens to fit, as in the 90 s). The beat tracker's resolution is about 23 ms, so frame 0 can be that far from the true beat (the first beat in the stem check was about 19 ms off). The proof beds are synthetic; a real bed's measured downbeat phase can also be a beat off.

## 6. Tests

| Chunk | Passed | Failed | Skipped |
|---|---|---|---|
| eval 1/3 | 844 | 20 | 2 |
| eval 2/3 | 625 | 15 | 8 |
| eval 3/3 | 699 | 26 | 24 |
| broll 1/2 | 732 | 14 | 1 |
| broll 2/2 | 981 | 22 | 9 |
| lib, filters, pipeline, media, http, scripts, motionWorker | 655 | 1 | 0 |
| music, directorV2, kinetic, motionDirector, northStar, subjectStage, layout, templateDesigner, contentProfile, color, audio, transcribe, templates, render | 814 | 0 | 0 |
| **Total** | **5,350** | **98** | **44** |

Phase 2.4 baseline: 5,261 passed, 98 failed, 44 skipped. So **+89 passed (the new tests), 0 more failures.** I rebuilt the baseline by running the 49 failing files at the Phase 2.4 commit (`99420c1`) in a throwaway worktree: **the same 90 failing test names (98 tests) fail there. New failures: none. Fixed: none.** No failing file is in the music, SFX, placement, brief or `render-blueprint` areas. Same causes as in Phase 2.4 (missing gitignored fixtures and artifacts, stale call-inventory checks from earlier phases, caption/layout tests), and `src/lib/assembler/assembler.test.ts` also fails on `main`.

## 7. Needs a human decision

- The "on no worse than off" question in section 5: accept, or build the duck from per-bar bed loudness (my recommendation if you want the voice-first guarantee to hold for any bed).
- Whether a lift landing up to about 1.7 beats from the hook is good enough (the downbeat-only rule; allowing beat-level offsets would tighten it but frame 0 would no longer be a downbeat).
- Carried over from Phase 2.4: the pool-size rule is a **cap on appending** (a style with a bed still pool-hits at $0; `MUSIC_BED_FRESH=1` is what generates per video). The Docker image change is still unbuilt.
- `.env` now holds production values. With the fix the CLI flags win over it. Note `CLAUDE.md` forbids me from running anything with `MUSIC_BED_FRESH=1`, `MUSIC_SPECIALIST=live` or `first-video`; those are yours.

## 8. Your steps

1. In the production environment set `MUSIC_BED_FRESH=1` (and `MUSIC_SPECIALIST=live`, `MUSIC_PERSONALIZE=1` is already the default). Each new edit then generates one bed (about $0.0075), re-rendering the same video is a $0 cache hit, and each style's pool grows up to `MUSIC_BED_POOL_SIZE`.
2. Rebuild the engine image (`docker build -t kinmel-engine .`) and run the import check from `BGM_RELEASE.md` section 1 (librosa, pyloudnorm, pydub, scipy). The image must contain `briefRules.json`; the Dockerfile copies it. This is still unbuilt.
3. Redeploy the Remotion site: `npm run remotion:deploy`. Placed beds use new `MusicBedTrack` code that exists only on a redeployed site.
4. One real edit from your terminal, on a short video first: `MUSIC_BED_FRESH=1 MUSIC_SPECIALIST=live npm run first-video -- /path/to/talking-head.mp4`. Then `grep music.summary logs/engine.log | tail -1`.
5. In `music.summary` check: `source` `generated`, `costUsd` about `0.0075`; `style`, `bpm` (a multiple of 4), `key`, `arc` and `speechWpm` that fit the video (`hook-then-steady` under 25 s, `build` to 60 s, else `steady`); `startsOnDownbeat: true`; `startOffsetSec` a real number; `liftAtVideoSec` within about half a bar of `hookAtSec` (or `null` if the bed never lifts); `placementScore` between 0 and 1; `endType` `button` or `hold-fade`; `fallbackTier` and `fallbackReason` `null`; `finalLufs` about −14. Also `music.brief`, `music.placement` and `sfx.beat_snap`. Then `agents/music_specialist/spend.log` should have exactly one new line.
6. By ear: the voice is always clearly on top; the music starts on a beat with the picture and steps up near the hook; it ends on a bar line (or fades over the last 400 ms) with no long silent tail; no click at the loop on a long video; no SFX lands on the start of a word; sound effects land on the beat.
7. Tuning, no code change: `server/src/stages/music/briefRules.json` (see VOICE_FIRST.md), and the A/B commands in `BGM_RELEASE.md` section 4.

# Phase 2.4

Branch: `bgm-phase-2`. Not pushed, merged or deployed. Date: 2026-11-04. Human checklist: [docs/audio/BGM_RELEASE.md](docs/audio/BGM_RELEASE.md).

## 1. Spend proof

- `agents/music_specialist/spend.log`: absent at the start, absent at the end (0 lines, unchanged).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0. No deploy. R2 writes: 0 (the full test run had every API, R2 and AWS key blanked; the pool and upload tests use a fake R2).
- Renders: two local `render-blueprint` burns and one local bed-stem probe, all free.

## 2. Decisions applied

1. `CLAUDE.md` committed (`19820af`).
2. Folder stays `remotion/public/sfx-library/`. `VOICE_FIRST.md`, its README and this report all name that path.
3. high-energy stays at 120 bpm.
4. Word mask on built-in hits, at scheduling time only: `schedulePolishSfxHits({wordOnsetsSec})` drops a hit within 120 ms after an onset, before cap and spacing. Saved blueprints are never rescheduled (a test asserts `render-blueprint` has no path to the scheduler, and that stored hits pass through unchanged). Tests cover both cases.
5. One-frame attack look-ahead: new optional `leadSec` (33.3 ms) on the envelope. Both envelope files changed together, the parity test is green at every 1/120 s, and an envelope with no `leadSec` evaluates exactly as before.
6. Defaults, each with its env override: `talking` preset (−18 / −9 / −4), release 300 ms (`MUSIC_DUCK_RELEASE_MS`), carved on (`MUSIC_CARVED_TWIN=0` turns it off), master pass on, pool size 3. `.env.example` and `VOICE_FIRST.md` match. These affect **new** blueprints only; a `render-blueprint` rebuild keeps the timing the blueprint was saved with unless a flag overrides it (new `--lead-ms` flag).

## 3. Per task

### Task 1. Same audio on Lambda as on local
- Status: done in code; **the Docker image change is unbuilt** (see below). Commit `bc4bf5b`.
- **Master pass on Lambda:** `stages/music/lambdaMaster.ts`, called from `refreshRenderJob` after `verifyLambdaOutput` passes. Download, the same two-pass loudnorm, re-inspect the mastered file with the same judge, then upload to its own key `ai-video/render/<date>/<renderJobId>-mastered.mp4`. That URL becomes the job's `outputUrl`, which is what the app serves. The Lambda object is never overwritten. On any failure the verified Lambda URL is kept, `music.master_pass_failed` is logged and the job gets the warning `music:master_not_applied`. `MUSIC_MASTER_PASS=0` skips it. The mastering runs inside the poll that finds the render done (the existing in-flight guard makes concurrent polls report "still rendering"), so that one poll takes longer.
- **`music.mix_check`** still logs on Lambda completion, and `music.summary` now does too. `MUSIC_MIX_MEASURE` stays local-only.
- **Static files / deploy:** needs the site redeployed, not done. The repo command is `npm run remotion:deploy` (`remotion lambda sites create src/index.ts --site-name=kinmel-video-engine --region=us-east-1`). Until then a Lambda render uses the old site: no look-ahead, no catalog SFX.
- **Bed URLs:** `bedUrls.ts` checks that `musicUrl`, full, loop and carved are public https. `analyzeVideo` now drops the bed and logs `music.bed_url_not_public` if any is not. Tests fail if any of those is a local path, `file:`, `http:`, `dry-run:`, `staticFile:` or a private host; the saved proof blueprint's URLs pass.
- **Two production bugs found by the audit, both fixed:**
  1. `contentMoodMap.json` was read with `fs` from beside the compiled file, and `tsc` does not copy JSON. I built the server and confirmed `dist` had **no JSON**: in the production image the mood lookup would have thrown and the music plan would have failed open on every edit, silently. It is now imported with `with {type: 'json'}`; a real `tsc` build emits it and `resolveMoodPool('tech_sharp')` returns `high-energy` from `dist`.
  2. The `Dockerfile` shipped only `server/dist`: no `agents/`, no Python packages. Pool beds would still play (pure TypeScript), but an empty mood could not generate and the voice loudness would fall back to −20 LUFS. The Dockerfile now copies `agents/music_specialist` and the mood map, builds `/app/agents/.venv` (`pydub pyloudnorm numpy scipy librosa`) and makes the specialist folder writable for `spend.log`. **I did not build the image.** Build it and run the import check in `BGM_RELEASE.md` §1 before deploying.
- Not changed: `MUSIC_SPECIALIST` stays `off` by default, and Lambda still renders what the blueprint says.

### Task 2. Pool growth
- Status: done. Commit `bc4bf5b`. `MUSIC_BED_POOL_SIZE` (default 3) did not exist in code before; it does now.
- **How I read it, please confirm:** a mood with an empty pool generates once (~$0.0075) and the bed is appended; a mood with any bed still pool-hits at $0 (that is what makes high-energy $0 with the salvaged bed, as your §3 verification expects). The size is a **cap on appending**, not a reason to keep generating until 3. So pools grow past 1 only when generation runs anyway (for example `MUSIC_BED_FRESH=1`). If you want "keep generating until 3", that is a small change to the pool-hit condition, but it would make the next two high-energy edits cost money.
- A new bed is appended only if it passed QC (`qc_passed !== false`) and the pool is under its size; existing beds (the salvaged v2 bed included) are never removed or replaced, and an existing entry can still be patched when the pool is full. `music.pool_appended {mood, size}` logs on an append; `music.pool_not_appended` logs why not.
- Tests use a fake R2 (mocked module and `fetch`); the real pool is never read or written.

### Task 3. `music.summary`
- Status: done. Commit `bc4bf5b`. One line per render, local and Lambda: `source` (licensed / generated / pool / none), `mood`, `costUsd`, `voLufs`, `intendedSpeechGapLu`, `intendedPauseGapLu`, `carvedApplied`, `masterApplied`, `finalLufs`, `finalTruePeak` (from the master pass when it ran, else null), `sfxHits {catalog, builtIn}`, `fallbackReason`.
- How the bed was obtained is saved on the blueprint as `audioDesign.musicProvenance` at analyze time. A blueprint saved before this has none; the summary then infers the source from `musicSource` and reports cost 0.
- Limit: a total failure (`null` plan) reports `fallbackReason: "no_bed"`; the precise reason is still in the earlier `music.fallback` line. A pool bed used because generation failed carries the specific reason.

### Task 4. Tests
- Commit `8c96217`.
- **Stale pins updated to current intended behaviour:** `wp12dSfxHits` (the removed "musicMood intentionally omitted" comment; it now pins that the hits block only carries an existing `musicMood` forward), and two `renderRunner` source pins (`wp3eLambdaIntegrity`, `wp3fLambdaAudio`) that my Lambda master wiring legitimately changed. They keep the safety assertions: the master only takes `verifiedUrl`, re-inspects its own result, and the raw Lambda URL is never assigned.
- **Not music, left alone:** `wp17FlashCards` (caption mute window) and the rest below.
- **Full server suite, four chunks** (eval; broll; lib, filters, pipeline, media, http, scripts, motionWorker; everything else), API/R2/AWS keys blanked:

  | Chunk | Passed | Failed |
  |---|---|---|
  | `src/eval` | 2166 | 63 |
  | `src/stages/broll` | 1712 | 37 |
  | lib / filters / pipeline / media / http / scripts / motionWorker | 648 | 1 |
  | music, directorV2, kinetic, motionDirector, northStar, subjectStage, layout, templateDesigner, contentProfile, color, audio, transcribe, templates, render | 732 | 0 |
  | **Total before the pin fixes** | **5258** | **101** (44 skipped) |

  After the three pin fixes the failing files re-ran at **98 failed**, so the full suite is **5261 passed, 98 failed, 44 skipped**. pytest: 44 passed. Server `tsc`: clean. Remotion `tsc`: only the 3 known errors.
- **Where the 98 come from.** At the pre-2.4 `HEAD` the same files had 91 failing names; this phase added 2 (the pins above, now fixed) and fixed 1 (WP12D). None is new from this phase's music code. Most are environmental: 66 error lines are `ENOENT` for gitignored fixtures and artifacts (`remotion/out/...`, frozen baselines, recorded hashes) that are not on this machine, plus the call-inventory checks for files from earlier phases (`backfillSalvagedBed.ts` and others).
- **On `main`:** 51 of the 52 failing files do not exist on `main` (the `phase 1.1 checkpoint` commit added them), so they cannot fail there. The one that exists, `src/lib/assembler/assembler.test.ts` ("assembler audit (Gabby)"), **also fails on `main`**. I ran this in throwaway worktrees (since removed).

### Task 5. Checklist
- `docs/audio/BGM_RELEASE.md`, commit `724978e`: production env with each value, the deploy command, the one-edit verification with what `music.summary` should show, the A/B commands, rollback, and the merge steps (review `54f7e9d` separately first, then merge; I did not merge).

## 4. Synthetic proof after the look-ahead

Fixture is the old Phase 2.1 blueprint, rebuilt with release 300 ms and a 33.3 ms look-ahead; master and measure on. Intended gaps 18 / 9.

| carved | speech gap | settled pause gap | settled pauses | final LUFS | true peak | windows within 6 LU of the voice |
|---|---|---|---|---|---|---|
| 0 | **17.5** | 9.2 | 2 | −13.9 | −2.9 | 0 |
| 1 | **18.9** | 9.2 | 2 | −13.9 | −3.4 | 0 |

- Carved off: 17.3 → 17.5. Only about 0.2 of the 0.7 LU shortfall closed, so it is **not** about 18. The residual 0.5 is the part this phase cannot fix: Remotion's 1/97 volume step (about 0.28 dB at the −22 dB gain) plus the voice measuring −20.13 LUFS in the render against the −20 the envelope assumed (0.13), plus about 0.1 left from the attack still landing a little after the envelope. I did not tune the look-ahead past the one frame you chose.
- Carved on: 18.9, i.e. the carved bed sits about 1.4 LU further under the voice. That is on the safe side of the voice-first rule.
- `bedOverVoiceWindows` is 0 for both and the closest window is 17.3 LU under the voice, so `music.voice_fight` did not fire.

## 5. Needs a human decision or action

- Redeploy the Remotion site before the first Lambda edit (`npm run remotion:deploy`).
- Build the Docker image and run the import check before deploying; the Dockerfile change is untested.
- Mount persistent storage for `spend.log` (or set `MUSIC_SPEND_LOG`) in production, so paid calls can be audited.
- Confirm my reading of the pool-size rule (a cap on appending).
- The 98 failing tests need an owner; none is from this phase.

# Phase 2.3

Branch: `bgm-phase-2`. Not pushed. Date: 2026-11-04.

## 1. Spend proof

- `agents/music_specialist/spend.log`: absent at the start, absent at the end (0 lines, unchanged).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0. R2 writes: 0. No audio file was added, downloaded or generated. The existing pool bed was not touched. The only renders were one local Remotion probe (bed stem) for the shortfall investigation.

## 2. Per task

### 1. Voice-first policy
- Status: done. `docs/audio/VOICE_FIRST.md` (rules, the logs that prove them, a checklist for new audio features) and an "Audio policy" section in `CLAUDE.md`.
- `CLAUDE.md` is still **untracked** in git (it was before this task), so the edit is on disk but not committed. Decide whether to commit that file.
- Commit: `7d3d8f5` (doc, with tasks 2 and 3).

### 2. Supportive music prompts
- Status: done. `PROMPT_VERSION` 3. Every caption now carries `background underscore, minimal, sparse arrangement, no lead melody, supportive`. The negative prompt gains `lead, solo, busy arpeggio, vocal chops, loud drums`.
- Every caption is exactly 12 tags. Adding 5 tags to the old 10–11 cannot fit in 12 by dropping only production tags, so the order of what is dropped is: all production tags, then `instrumental` (redundant with `no vocals`), and high-energy's third instrument `supersaw lead` (it contradicts "no lead melody"). `no vocals` and the `<bpm> bpm` tag stay.
- high-energy bpm 128 → **120** (÷4, still inside synthwave's range, calmer under a voice). Say if you would rather keep 128.
- New cache keys, as expected. The salvaged pool bed is untouched and stays in the pool.
- Files: `prompts.py`, `models.py`. Tests: existing suite passes unchanged.

### 3. Measuring "fighting the voice"
- Status: done. Commit `7d3d8f5`.
- `music.qc_speech_band`: `speech_band_stats()` in `postprocess.py` (energy share in 1–4 kHz, and spectral flux in that band: mean positive frame-to-frame rise over mean band level). Log only, never rejects. It is in the postprocess result, logged by the agent and the server, and written into the bed's `meta.json` (`qc_speech_band`) on the next generated bed. Existing pool beds get it when they are next processed; I did not rewrite the pool.
- `music.mix_measured` now has `bedOverVoiceWindows` (speech windows where voice − bed is under 6 LU), `minSpeechWindowGapLu`, `speechWindowsUnmeasured` (windows under 0.4 s have no loudness of their own and are counted apart, never as a pass), plus `intendedSpeechGapLu` and `speechGapShortfallLu`. `music.voice_fight` warns when the count is above 0.
- Files: `postprocess.py`, `agent.py`, `vo_lufs.py`, `schema.ts`, `musicSpecialist.ts`, `mixMeasure.ts`, tests.

### 4. The 0.7 LU speech shortfall (17.3 measured vs 18 intended)
- **Cause: not our envelope and not the measurement.** It is Remotion's volume handling. Rendering the bed-only probe locally and comparing it with the ideal gain, frame by frame:
  1. **Volume rounding.** `@remotion/renderer` rounds every volume to a multiple of 1/97 (`round-volume-to-avoid-stack-overflow.js`, to keep the ffmpeg expression shallow). The −22 dB speech gain is 0.0794. It becomes 8/97 = 0.0825 = −21.7 dB. That is a steady **+0.28 dB** across every speech window. It is bigger at lower gains (a −30 dB gain would round to 3/97).
  2. **Late attack.** The gain lands about one frame (33 ms) later than the envelope says. At the 0.5 s onset the envelope has −22 dB at frame 15 and the render plays −14.2 dB; at 3.9 s it plays −15.9 dB at frame 117. The first ~40 ms of each phrase has the bed up to 8 dB too loud. About **+0.3 dB** over the windows.
  3. **Voice side:** the VO measures −20.13 LUFS in the render against the −20 the envelope was built from: 0.13 LU.
  Together: 0.28 + 0.29 on the bed plus 0.13 on the voice, about 0.7.
- Fix: **none applied.** It is outside the envelope and the measurement, and I did not touch the −18 default. Nothing here lets the bed pass the voice. The numbers are now logged side by side (`intendedSpeechGapLu`, `speechGapLu`, `speechGapShortfallLu`) so it stays visible.
- Option if you want it closed: add a one-frame look-ahead to the attack (an optional field, old blueprints unchanged), and pick the speech gain from the 1/97 grid. Not done; it changes the envelope in two files and the parity tests.
- Remotion rounds the SFX volume the same way. A −30 dBFS hit (0.0316) lands on 3/97, so the "10 LU under the voice" is about ±1.5 dB. Fine for an "about" rule.

### 5. SFX library
- Status: done. Commit `73df0b5`.
- **Final path: `remotion/public/sfx-library/`** (see decision 1 below). It holds `README.md` and `sfxinfo.json` (`[]`) and no audio.
- Built-in wavs stay in `remotion/public/sfx/` (`SfxTrack.tsx` still points there).
- `npm run sfx:check` (root and `server`): read-only. Checks missing file, real duration against `duration` (50 ms), unknown `tobeused`, files with no entry, leading silence over 10 ms. Extra: warns when a file's peak is outside −3…0 dBFS, because the level logic assumes about −1. It prints suggestions and never edits. Exit 1 only on an error (missing or unreadable file, bad catalog).
- Engine startup runs the same check and logs `sfx.catalog_warning` (non-fatal). Missing folder or empty `[]` is silent.
- Wiring (`server/src/lib/sfxCatalog.ts`, called in `analyzeVideo.ts` after the bed block): only when the catalog has entries. For each hit `polishSfx` scheduled, it maps the hit to a cue, picks an entry deterministically from `hash(videoId + cue + time)`, and otherwise keeps today's built-in hit. Level: peak at `voLufs + SFX_VOICE_OFFSET_LU (−10) + gainDb`, never closer to the voice than −6 LU. A catalog hit within 120 ms after a word onset is dropped. It never adds a hit, so cap and spacing are unchanged. It logs `sfx.catalog_applied` with `maxPeakVsVoiceLu`, `maskedByWord`, `clamped`, and how many came from the catalog.
- Blueprint `hits[]` gained an optional `durationSec` (catalog hits only), so a longer file is not cut at 0.45 s. `polishSfx.ts` is untouched; `mergeHits` stays unwired; `MUSIC_SPECIALIST_SFX` stays off.
- Cues the engine fires today: `cut`, `transition`, `zoom_in`, `kinetic_plate`, `emphasis`. `hook`, `cta`, `ui`, `caption_pop`, `zoom_out`, `ambience` are accepted and checked but not scheduled by anything yet. Mapping is `cueForHit()`.
- Tests: `sfxCatalog.test.ts`, 20 tests. Parsing and the string-to-array rule; unknown cue is a warning; empty catalog gives the same hits (snapshot of the scheduler, deep-equal through `applyCatalogToHits`); a two-entry fixture with synthetic tones in a temp dir picks the right file, stable across runs and catalog order; the 120 ms mask and the −6 LU ceiling; `sfx:check` flags a missing file, a wrong duration and leading silence and leaves the files byte-identical; the real folder ships with no audio.

## 3. How to add a sound
1. Copy the wav/mp3/m4a into `remotion/public/sfx-library/` (starts at 0.0 s, peak about −1 dBFS) and add an entry to `sfxinfo.json` (`fileName`, `duration`, `tobeused`, optional `gainDb`).
2. Run `npm run sfx:check` and fix what it suggests. The README in that folder has the cue table.

## 4. Checks
- pytest `music_specialist/tests`: 44 passed. Server tsc: clean. Remotion tsc: only the 3 known errors.
- Server vitest (music, scripts, render, `sfxCatalog`, existing SFX suites): 235 passed, **2 failed, both pre-existing**. I reproduced both with my changes stashed:
  - `wp12dSfxHits.test.ts` "wiring pins": `analyzeVideo.ts` has not had the comment it searches for (`musicMood intentionally omitted` / `No music bed`) since at least `a064742`.
  - `wp17FlashCards.test.ts` "caption exclusivity" fails the same way before my changes.
  I did not fix them (out of scope); they need a look.
- I did not run the whole server suite (it exceeds the tool time limit); I ran the music, scripts, render, lib and SFX-related suites.

## 5. Needs a human decision
- **Folder name.** You asked for `SFX`. `remotion/public/sfx/` already exists, and on macOS `SFX` and `sfx` are the same folder while on Linux/Lambda they are not, so I asked and went with `remotion/public/sfx-library/` (your answer).
- **Word mask scope.** The 120 ms rule exists only in `mergeHits` (unwired); `polishSfx` never had it. Applying it to today's built-in hits would change old renders, so it applies to catalog hits only. Say if you want it on built-ins too.
- high-energy bpm 128 → 120, and the dropped caption tags (above).
- Whether to close the 0.7 LU shortfall with a one-frame look-ahead (above).
- Commit `CLAUDE.md`?
- The 2 failing pin tests.

## 6. `render-blueprint` A/B commands for your real edit
Use your saved blueprint for `<bp>`. Master pass is on by default; add `--measure 1` to log the numbers (`music.mix_measured`, including `bedOverVoiceWindows`, in `logs/engine.log`).

```
# speech offset
npm run render-blueprint -- <bp> --speech-offset -16
npm run render-blueprint -- <bp> --speech-offset -18
npm run render-blueprint -- <bp> --speech-offset -20

# carved twin
npm run render-blueprint -- <bp> --carved 0
npm run render-blueprint -- <bp> --carved 1

# release
npm run render-blueprint -- <bp> --release-ms 450
npm run render-blueprint -- <bp> --release-ms 300
```

# Phase 2.2

Branch: `bgm-phase-2`. Not pushed. Date: 2026-11-04.

## 1. Spend proof

- `agents/music_specialist/spend.log`: absent at the start, absent at the end (0 lines, unchanged).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0. R2 writes: 0. Only local Remotion, ffmpeg, Python and `render-blueprint` were run.

## 2. Per task

### 1. Honest pause measurement
- Status: done.
- `pauseGapLu` is now `pauseGapLuAll` (whole window) plus `pauseGapLuSettled` (only where the envelope has reached the pause gain: from `phrase.end + hold + release` to `next.start − attack`, 20 ms guard each side, at least 0.3 s). `settledPauseCount` and `settledPauseSec` are logged in `music.mix_measured`, along with a per-pause table (`pauses`).
- Files: `server/src/stages/music/mixMeasure.ts` (+ test), `agents/music_specialist/vo_lufs.py`, `tests/test_mix_measure.py`.
- Tests: synthetic 2 s pause with the real hold/release/attack: settled gap 9 ± 1 LU (passes); the whole-window gap reads higher, because the ramps run quieter than the pause gain.
- Gate: pyloudnorm needs at least 0.6 s of settled audio in total. Below that `pauseGapLuSettled` is `null` rather than a made-up number.
- **Found while doing this:** `MusicMixProbe` played the bare `musicUrl`, so it never played the loop or carved twin. The Phase 2.1 "carved changes nothing" reading came partly from that. The probe now takes the real bed fields (`bedSpec`: full, loop, carved, full duration, source). `MusicMixProbe.tsx` only; ShortVideo untouched.

### 2. Does the envelope do what the preset says
- Status: done. Defaults unchanged (hold 150 ms, release 450 ms).
- Added `--hold-ms` and `--release-ms` to `render-blueprint` (they rebuild the duck; the stored hold/release are what Remotion evaluates, so no Remotion change). Output file names now carry `-r<release>`.
- Fixture pauses (the 5 that qualify as pause windows, ≥ 0.6 s): 0.84, 0.64, 1.04, 0.74, 0.94 s.
  - release 450 / hold 150: **1 of 5 settles** (1.04 s, settled 0.32 s).
  - release 300 / hold 150: **2 of 5** (1.04 s, 0.94 s; 0.84 s settled total).
  - release 300 / hold 100: 3 of 5 (computed only, not rendered).
- The fixture's pauses are synthetic (0.6–1.0 s), so this tells you the mechanism, not your real edit. Almost every pause under about 1.0 s never reaches the pause gain at 450 ms release.
- **Proposed change (not applied): release 300 ms.** Hold stays 150 ms for now. Decide by ear with the A/B below.

### 3. Carved-twin decision
- Status: done. `carvedDecision(carved0, carved1)` in `mixMeasure.ts` (tested). Carved is allowed only when speech gap and settled pause gap are each within 1 LU of carved=0. It needs both numbers, so it is "not allowed" when the settled pause gap is missing.
- On the numbers below (release 300): speech +1.4 LU, settled pause 0.0 LU. The speech shift is outside 1 LU, so the rule says **not allowed**. That is a loudness check only: carved moves the speech-band balance, not just the level.
- `MUSIC_CARVED_TWIN` stays **off by default**. Decide by ear: `render-blueprint --carved 0|1`.

### 4. Master pass default
- Status: done. `masterPassEnabled` is on unless `MUSIC_MASTER_PASS=0`. `render-blueprint --master` now defaults to 1. `music.master_pass` (before/after LUFS and true peak) logs on every render; `music.master_pass_off` when it is off.
- Files: `flags.ts`, `masterPass.test.ts`, `localRender.ts`, `.env.example`.
- Old blueprints: the proof fixture is a Phase 2.1 blueprint with no hold/release fields. It renders unchanged apart from the mastered loudness (about −22 → −14 LUFS).

### 5. Re-run of the synthetic proof
All four renders: master on, measure on, same fixture, salvaged bed.

| carved | release | speech gap | pause gap (all) | pause gap (settled) | settled pauses | final LUFS | true peak | before master |
|---|---|---|---|---|---|---|---|---|
| 0 | 450 | 17.3 | 12.4 | null (0.32 s, too short to gate) | 1 | −13.9 | −2.7 | −22.0 / −11.1 |
| 0 | 300 | 17.3 | 11.3 | **9.1** | 2 (0.84 s) | −13.9 | −2.8 | −22.1 / −11.1 |
| 1 | 450 | 18.7 | 13.2 | null (0.32 s) | 1 | −13.9 | −3.1 | −21.9 / −11.1 |
| 1 | 300 | 18.7 | 11.8 | **9.1** | 2 (0.84 s) | −14.0 | −2.7 | −22.1 / −11.1 |

Reading: the 12.4 was the ramps, not the carved twin. At release 300 the settled gap is 9.1 against the intended 9. Speech gap is 17.3, not 18: there is a 0.7 LU shortfall in speech that I have not explained. The carved twin now shows up in the speech gap (+1.4 LU).

Commits: `6b7f1ff` (tasks 1–3), `4c1be67` (task 4). Task 5 and this report: the commit that follows.

## 3. Checks
- pytest `music_specialist/tests`: 42 passed. Server vitest (music, scripts, render): 131 passed. Server `tsc --noEmit`: clean. Remotion `tsc`: only the 3 known errors in `ShortVideo.tsx`.

## 4. Commands for your real edit (A/B by ear)
Use your saved blueprint path for `<bp>`. Each run writes `out/renders/…mp4`; master is on by default.

```
# speech offset
npm run render-blueprint -- <bp> --speech-offset -16
npm run render-blueprint -- <bp> --speech-offset -18
npm run render-blueprint -- <bp> --speech-offset -20

# carved twin
npm run render-blueprint -- <bp> --carved 0
npm run render-blueprint -- <bp> --carved 1

# release
npm run render-blueprint -- <bp> --release-ms 450
npm run render-blueprint -- <bp> --release-ms 300
```
Add `--measure 1` to any of them for the numbers (`music.mix_measured` in `logs/engine.log`). `--master 0` turns the master pass off.

## 5. Needs a human decision
- Release 450 vs 300 ms (proposed 300), by ear.
- Carved on or off, by ear. The loudness rule alone says no on the fixture because of the 1.4 LU speech shift.
- The 0.7 LU speech-gap shortfall (17.3 vs 18): not investigated; probably bed LUFS and the speech-window average, not the envelope.

# Phase 2.1

Branch: `bgm-phase-2`. Not pushed.

## 1. Spend proof

- `agents/music_specialist/spend.log` at the start of Phase 2.1: absent (0 lines).
- After A: absent (0 lines).
- After B: absent (0 lines).
- After C: absent (0 lines).
- After D: absent (0 lines).
- After E (end of Phase 2.1): absent (0 lines).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0.

## 2. Per task

### A. Trim trailing silence

- Status: done.
- Files: `silence_trimmer.py` (`trim_trailing_segment`), `postprocess.py` (`POSTPROCESS_VERSION` 3, 150 ms fade on `bed_full` only), `test_trailing_trim.py`, `test_loop.py` version pin, optional `trailing_trimmed_sec` on the music result schema.
- Tests: pytest 37 passed. Vitest 75 passed (`src/stages/music` plus wp27). Server tsc clean. Remotion tsc only the 3 known errors.
- Salvaged bed, reprocessed locally: `trailing_trimmed_sec` 3.25, `duration_sec` 56.68, measured bpm 129.2, 16-bar loop 29.094 s, −16.0 LUFS, `loop_fallback` false. The hand-off time is that 56.68 s, which is the end of the audible file.
- Listen files (gitignored): `remotion/out/music-loop/bed_full.wav`, `bed_loop.wav`, `bed_loop_x3.wav`, `bed_carved.wav`.
- Commit: `dc737d7`.

### B. QC gate

- Status: done. Vocal score is log-only. Live retry is implemented and was not run.
- Files: `qc.py`, `agent.py` (one live retry, dry never retries), `test_qc.py`, schema qc fields, `musicSpecialist.ts` logs `music.qc_vocal_score`.
- Tests: pytest 41 passed. Vitest 75 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- Salvaged bed after the v3 trim: `passed` true, silence 0.04 s, true peak −4.119 dBFS, bpm error 0.94%, seam 0.867 dB, vocal score 0.5956 (recorded, not a reject).
- Commit: `eafdbbc`.

### C. Wire loop and carved end to end

- Status: done. R2 backfill already applied for the salvaged bed (rule 3 only).
- Files: `uploadBed.ts` (`uploadBedDetailed`, `mergePoolEntry`, optional `full_url`/`loop_url`/`carved_url`), `musicSpecialist.ts` (`poolPlan` + generated upload paths), `toAudioDesign.ts` (`playbackFromPlan`), `analyzeVideo.ts` uses `playbackFromPlan`, `ShortVideo.tsx` passes `musicCarvedUrl` only (not lines 286/299/300), `schema.ts` bed paths, `poolPlayback.test.ts`, `backfillSalvagedBed.ts` (gated on `--write-r2`).
- Tests: pytest 41 passed. Vitest 84 passed (music + wp27). Server tsc clean. Remotion tsc only the 3 known errors.
- Old pool entries with only `url` keep single-file playback. Carved is only attached when `MUSIC_CARVED_TWIN=1`.
- Commit: `a064742`.

### D. Free re-renders (save + render-blueprint)

- Status: done.
- Files: `saveBlueprint.ts` (+ test), `renderBlueprint.ts` (+ test), `duckEnvelope.ts` (optional talking offset overrides), `analyzeVideo.ts` (save just before return), root and server `package.json` scripts, `.gitignore` for `out/blueprints/` and `out/renders/`.
- Tests: vitest renderBlueprint + saveBlueprint 18 passed; full music suite was 99 before the carved strip, then 18 again after. Server tsc clean. Remotion tsc only the 3 known errors. Pytest 41 passed.
- `render-blueprint` source ban: no analyzeVideo, Runware, Anthropic, Groq, Gemini, or Lambda strings. `--carved 0` strips `musicCarvedUrl`; `--carved 1` never invents a URL. Mix and master numbers stay in the engine log under the printed `renderJobId`.
- Commit: `ed9fe69` (path resolve follow-up included in the E commit).

### E. Synthetic proof renders

- Status: done. Zero spend. Fixture is a 12 s color video with band-limited noise "speech" bursts at −20 LUFS, not a re-analyze of `2.mp4`.
- Files: `makeProofFixture.ts` (+ test), `.gitignore` `out/fixtures/`, relative path resolve in `renderBlueprint.ts`.
- Tests: maker + render-blueprint + saveBlueprint vitest 22 passed. Server tsc clean. Spend log still absent.
- Four local `render-blueprint` burns with `--measure 1`. Salvaged bed URLs from the backfilled pool. Intended `music.mix_check` was speechGapLu 18 / pauseGapLu 9 on every run.
- `MusicMixProbe` only passes `musicUrl` into `MusicBedTrack`, so bed-stem `mix_measured` cannot see the carved twin. Final LUFS still barely moved between carved 0 and 1 (−22.0 vs −21.9 before master).
- `MUSIC_CARVED_TWIN` stays **default off**. Reason: measured pauseGapLu was 12.4 on carved=1 (and on carved=0), outside the 9 ± 1.5 LU band required to flip the default on. SpeechGapLu 17.3 was inside 18 ± 1.5.
- Commit: `a607609`.

## 3. R2 objects written

Allowed keys only (salvaged cache key `108abbca…`):

- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/bed_full.wav` (HEAD 200)
- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/bed_loop.wav` (HEAD 200)
- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/bed_carved.wav` (HEAD 200)
- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/meta.json` (`postprocess_version` 3, trim 3.25 s, QC scores, derived URLs; original licence kept)
- `music/beds/pool/high-energy.json` (same cache key patched with `full_url`/`loop_url`/`carved_url`, `duration_sec` 56.68)
- Backup: `music/beds/pool/high-energy.json.bak-2026-11-04` (HEAD 200) and local `remotion/out/music-loop/high-energy.json.bak-2026-11-04`

`bed.wav` was not rewritten. No other pool moods were touched.

## 4. Task E table

| carved | master | speechGapLu (intended → measured) | pauseGapLu (intended → measured) | final LUFS | true peak |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 18 → 17.3 | 9 → 12.4 | −22.0 | −11.1 |
| 1 | 0 | 18 → 17.3 | 9 → 12.4 | −21.9 | −11.1 |
| 0 | 1 | 18 → 17.3 | 9 → 12.4 | −13.9 (after master; before −22.0) | −2.7 |
| 1 | 1 | 18 → 17.3 | 9 → 12.4 | −13.9 (after master; before −21.9) | −3.1 |

`MUSIC_CARVED_TWIN` default: **off**. Pause gap stayed outside 9 ± 1.5 LU with carved on.

## 5. Listen list

v3 beds:

- `remotion/out/music-loop/bed_full.wav`
- `remotion/out/music-loop/bed_loop.wav`
- `remotion/out/music-loop/bed_loop_x3.wav`
- `remotion/out/music-loop/bed_carved.wav`

Proof renders:

- `out/renders/proof-synth-0001-talking-c0-m0-20261104T050033.mp4`
- `out/renders/proof-synth-0001-talking-c1-m0-20261104T050228.mp4`
- `out/renders/proof-synth-0001-talking-c0-m1-20261104T050406.mp4`
- `out/renders/proof-synth-0001-talking-c1-m1-20261104T050538.mp4`

Fixture: `out/fixtures/proof/blueprint.json`, `source.mp4`, `dialogue.wav`.

## 6. Commands for the human (do not run overnight)

One real polish edit. Analyze still uses Groq/Gemini as any normal edit does. The bed should pool-hit the salvaged high-energy entry (Runware $0) unless `MUSIC_BED_FRESH=1`. After it finishes, `out/blueprints/{videoId}.json` is written for free replays.

```
cd /Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine
MUSIC_SPECIALIST=live POLISH_MUSIC_BED_URL= PRODUCT_EDIT_PROFILE=polish \
  MUSIC_MIX_MEASURE=1 MUSIC_MASTER_PASS=1 \
  npm run first-video -- "/Users/nishanbaral/Downloads/2.mp4" auto
```

Look for `music.pool_hit` (cost 0). `music.generated` with a cost means a paid bed. Then A/B the saved blueprint by ear:

```
npm run render-blueprint -- out/blueprints/<videoId>.json --duck-preset talking --speech-offset -16 --measure 1 --master 1
npm run render-blueprint -- out/blueprints/<videoId>.json --duck-preset talking --speech-offset -18 --measure 1 --master 1
npm run render-blueprint -- out/blueprints/<videoId>.json --duck-preset talking --speech-offset -20 --measure 1 --master 1
```

Replace `<videoId>` with the 24-char id from `music.blueprint_saved` / the filename under `out/blueprints/`.

---

# BGM Phase 2 morning report

Branch: `bgm-phase-2`. Not pushed.

## 1. Spend proof

- `agents/music_specialist/spend.log` before the run: absent (0 lines).
- After T1: absent (0 lines).
- After T2: absent (0 lines).
- After T3: absent (0 lines).
- After T4 (reverted): absent (0 lines).
- After T5: absent (0 lines).
- After T6: absent (0 lines).
- After T7: absent (0 lines).
- After T8: absent (0 lines).
- After T9 and at the end of the run: absent (0 lines).
- Runware calls: 0. Lambda renders: 0. Gemini/Groq/Claude generation calls: 0.

## 2. Per task

### Checkpoint

- Status: done.
- Commit: `54f7e9de92a942e57871b17b3efd1fbf46d93f0d` `phase 1.1 checkpoint`.
- The working tree on `main` had never been committed past the early engine. This checkpoint is that whole source tree plus Phase 1.1, excluding `.env`, `agents/.venv`, `__pycache__`, and `captionkit_tmp`.
- Stash list was empty.

### T1. Content-mood map

- Status: done.
- Files: `server/src/stages/music/contentMoodMap.json`, `flags.ts`, `musicSpecialist.test.ts`, `agents/music_specialist/prompts.py`, `tests/test_content_mood_map.py`.
- Tests: pytest 24 passed; vitest 42 passed (musicBed, musicSpecialist, wp27); server tsc clean; Remotion tsc only the 3 known `ShortVideo.tsx` errors.
- `tech_sharp` now resolves to `high-energy` before the keyword buckets. An unknown tone logs `music.mood_unmapped` and becomes `neutral`. `neutral talking-head` does not log.
- Commit: `7cdd2c7c8466868e4a4a59d3e7f48f7095ca065f`.

### T2. Bed-only loudness check

- Status: done.
- Files: `mixMeasure.ts`, `mixMeasure.test.ts`, `flags.ts` (`mixMeasureEnabled`), `localRender.ts`, `MusicMixProbe.tsx`, `Root.tsx`, `vo_lufs.py` (`measure_mix`, stereo BS.1770), `test_mix_measure.py`, `.env.example` comment.
- Tests: pytest 25 passed. The salvaged bed measures −16.0 LUFS. Vitest 48 passed and both tsc checks were clean before the stereo-reader fix; that fix is Python-only and pytest covers it.
- `pauseGapLu` is voice-speech LUFS minus bed loudness inside pause windows, because the voice is silent in a pause. Same reference as `music.mix_check`.
- The optional 6 s Remotion `--codec=wav` probe was not rendered. The fixture applies the talking gains to the salvaged bed and measures those wavs.
- Commit: `4b64ac55cafef9e8647ea2b538f8ead374c0135a`.

### T3. Bar-aligned loop

- Status: done, with one wiring gap.
- Files: `postprocess.py` (POSTPROCESS_VERSION 2), `test_loop.py`, requirements (`librosa`), blueprint fields `musicFullUrl` / `musicLoopUrl` / `musicFullDurationSec`, `MusicBedTrack` split path, `ShortVideo.tsx` prop pass-through (not lines 286/299/300), `loopBed.ts`, `uploadBed` optional loop file.
- Tests: pytest 28 passed. Salvaged bed: measured bpm 129.2 (within 3% of 128), 16 bars, not drum-led (30 ms fade), loop 29.094 s, seam jump ≤ 1.5 dB. Vitest loopBed + musicBed 33 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- Gap: `MusicPlan.loopUrl` is never set, and `uploadBed` is not passed `loopFilePath`. A render therefore still uses the single file. The existing high-energy pool bed has no loop object. Recorded for the human. Not fixed overnight because connecting it is an upload-path change and this run must not write the pool.
- Listen files (gitignored, local): `remotion/out/music-loop/bed_full.wav`, `bed_loop.wav`, `bed_loop_x3.wav`.
- Commit: `4ea32fc74e470207000caa037183690b2630e16c`.

### T4. QC gate

- Status: blocked and reverted. Nothing from this task is in the tree.
- The salvaged bed's tail is a real 3.2 s run at about −67 dBFS, ending at 59.9 s (median level of the rest is about −19 dBFS). The silence check correctly fails that tail. Two retunes did not make the bed pass without ignoring a hole the spec calls a failure.
- Vocal fraction on that bed was 0.60, so the first constant (0.45) also flagged the synth bed. That part was raised to 0.72 and then reverted with the rest.
- Pytest was 31 passed and 1 failed (`test_smoke_bed_passes`) at revert time. Server tsc was not green yet on the first draft (`MusicMode` `'off'`). Those edits are gone.
- Human decision: trim the trailing near-silence before the gate, or exempt the tail, before turning a live retry on. Left off so a future live edit cannot reject the bed we already have.

### T5. VO-carved twin

- Status: done. Default off.
- Files: `postprocess.py` (`carve_for_voice`, writes `bed_carved.wav`), `test_carved.py`, `flags.ts` (`carvedTwinEnabled`), `carvedMix.ts` + vitest, `MusicBedTrack.tsx` (full and carved in sync on both the loop-split path and the single-file path), optional `musicCarvedUrl` on the server type and the Remotion zod schema, `.env.example` comment.
- Tests: pytest 30 passed (salvaged bed: below 150 Hz at least 6 dB down, 2.5–3.5 kHz within −3 dB ± 1.5). Vitest 51 passed (musicBed, musicSpecialist, loopBed, wp27, carvedMix). Server tsc clean. Remotion tsc only the 3 known `ShortVideo.tsx` errors.
- `MUSIC_CARVED_TWIN` defaults to off. T2 never measured a rendered mix, so there is no regression number to justify defaulting it on.
- Gap: nothing in the pipeline sets `musicCarvedUrl`, and `ShortVideo.tsx` does not pass it. Turning the flag on does not change a render until a later change copies `bed_carved.wav` onto the blueprint. Left that way so this run does not upload a new pool object. Old blueprints with no carved URL stay on the single file.
- Commit: `0d1526448704367652d038a3dd2eb01496c90337`.

### T6. Master pass

- Status: done. Default off.
- Files: `masterPass.ts`, `masterPass.test.ts`, `flags.ts` (`masterPassEnabled`), `localRender.ts` (after output validation, before `logMixCheck`), `.env.example` comment.
- Tests: vitest 56 passed, including a 2 s local lavfi MP4: after loudness within 1 LU of −14, true peak ≤ −0.5 dBFS, h264 video kept, aac audio. A bad file throws and the original bytes stay. Pytest 30 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- Failure logs `music.master_pass_failed` and the render continues with the unmastered file. Success logs `music.master_pass` with before and after LUFS and true peak.
- The existing voice-delivery loudnorm in `deliveryAcoustics.ts` was not changed.
- Commit: `715e561`.

### T7. SFX merge (stays off)

- Status: done. Not wired into the render. `MUSIC_SPECIALIST_SFX` stays off.
- Files: `mergeHits.ts`, `mergeHits.test.ts`, `runDirectorV2.ts` (caption-pop `visual_cuts` only), optional `src` on hits in the blueprint type, the Remotion zod schema, and `SfxTrack.tsx`.
- Tests: mergeHits vitest 9 passed inside a music run of 60 passed. Pytest 30 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- `mergeHits` is not called from analyze or the director. `schedulePolishSfxHits` is still the only writer of `audioDesign.hits`. A non-empty `src` on a hit plays that URL; hits without `src` still play the local whoosh/hit/pop wav.
- The music job now sends at most 24 `caption_pop` cuts. `include_sfx` is still false, and the seed does not read cuts, so the bed does not change. Kinetic plates, motion entrances, and recipe peaks are accepted by `collectVisualCuts` but are not known when music starts, so they are not sent.
- When a kinetic hit and a caption hit land within 250 ms, the kinetic one wins. The brief grouped them; a collision needed one winner.
- An older `wp12d` pin looks for a "musicMood intentionally omitted" comment in `analyzeVideo.ts`. That comment is already gone from Phase 1. T7 did not touch that file. Not treated as a T7 failure.
- Commit: `d2cdf8a`.

### T8. Pool prewarm (plan only)

- Status: done as a planner with hard gates. The live fill is not wired, on purpose.
- Files: `agents/music_specialist/scripts/prewarm_pool.py`, `scripts/__init__.py`, `tests/test_prewarm.py`.
- Tests: pytest 35 passed (5 of them are this script). Server tsc clean. A music vitest subset passed. Remotion tsc still the 3 known errors. `spend.log` still absent after the tests (pytest points `MUSIC_SPEND_LOG` at a temp file).
- `--plan` prints the call count and the cost from `BGM_COST_USD` ($0.0075) and exits 0 with no caller token and no TTY.
- `--confirm-spend` exits 2 unless `MUSIC_SPECIALIST_CALLER=pipeline`, stdin is a TTY, and the answer is exactly `y`. It prints the plan before those checks.
- After those gates, `run_live_fill` still raises before constructing `RunwareTransport` and before `append_spend`. A human who types `y` will not spend and will not fill the pool. Wiring it would also need an R2 upload, which this run must not perform.
- Commit: `9385a34`.

### T9. Late-upload spool

- Status: done. Tested with a fake uploader, not R2.
- Files: `spool.ts`, `spool.test.ts`, `musicSpecialist.ts` (flush at the start of `runMusicPlan`, copy into the spool before `uploadBed`, delete the entry only after upload succeeds), `.gitignore` line `agents/music_specialist/spool/`.
- Tests: spool tests passed inside a 57-test vitest run (spool, musicSpecialist, mergeHits, loopBed, musicBed). Pytest 35 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- A child that writes `bed.wav` and `meta.json` and is then SIGKILLed still leaves a complete entry. The next `flushSpool` uploads it and deletes it. A failed upload leaves its entry and does not block the next one. A half-written `.tmp-*` directory is ignored.
- Default directory is `agents/music_specialist/spool` unless `MUSIC_SPOOL_DIR` is set. Nothing was uploaded to R2.
- Commit: `44983c6`.

### T10. Proof render

- Status: skipped. Not run.
- `npm run first-video` renders with `renderLocally` (not Lambda), but it always calls `analyzeVideo` first. That path calls Groq and Gemini. Those are paid generation APIs, so the command was not started.
- There is no saved blueprint on disk to re-render locally. The only blueprint JSON in the repo is an old eval fixture, not the polish edit of `2.mp4`.
- The earlier dry pool-hit render, from before this run, is still the one to listen to: `https://media.kinmel.shop/ai-video/render/2026-11-03/first_bp_2753aa41d02f423c8e11.mp4`. Its log line was `music.pool_hit` for cache key `108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53`, video id `350490efc54c233ae72d8772`, `cost_usd` 0. It predates `music.mix_check` on the local path and predates `MUSIC_MASTER_PASS`, so it has neither measured gaps nor a −14 master.
- `music.python` lines in `logs/engine.log` from this run are vitest dry spawns, not a live specialist.

## 3. Flags

- `MUSIC_MIX_MEASURE`: default off. `1` renders bed-only and VO-only wavs after a local render and logs `music.mix_measured`. Off so normal renders do not pay the extra render.
- `MUSIC_CARVED_TWIN`: default off. `1` is the intended switch for playing `bed_carved.wav` under speech. Off because T2 has no rendered-mix measurement, and because the URL is not wired yet.
- `MUSIC_MASTER_PASS`: default off. `1` runs a local two-pass loudnorm (I=−14, TP=−1, LRA=11) on the finished MP4 audio and copies the video. Off so a normal render is not re-encoded.
- `MUSIC_SPOOL_DIR`: unset. The spool then lives in `agents/music_specialist/spool` (gitignored). Set it to put the durable copy somewhere else. The next pipeline run uploads whatever is still there.

## 4. Numbers from T2 and T10

- Fixture (salvaged bed + synthetic −20 LUFS voice, gains applied per region): full-file bed −16.0 LUFS. Speech gap and pause gap passed at 18 ± 1 and 9 ± 1. No final MP4 yet, so no final LUFS or true peak.
- T10 not run, so there is no measured mix of `2.mp4` and no mastered MP4. The T6 fixture (2 s sine, local ffmpeg) landed within 1 LU of −14 with true peak ≤ −0.5 dBFS. That is not the talking-head mix.

## 5. Listen list

- `remotion/out/music-loop/bed_full.wav`
- `remotion/out/music-loop/bed_loop.wav`
- `remotion/out/music-loop/bed_loop_x3.wav` (three loops, for the seam)
- `remotion/out/music-loop/bed_carved.wav` (high-pass ~200 Hz, −3 dB at 3 kHz, from the salvaged bed)


## 6. Decisions for the human

- `tech_sharp` → `high-energy`. The visual theme is sharp/tech, the brief asked for high-energy unless a better fit, and the only real bed is the 128 bpm A minor high-energy bed. Other visual moods: warm_intimate→nostalgic, calm_cool→calm, bold_energetic→high-energy, clean_light→neutral, dark_cinematic→tense, earthy_natural→calm, soft_pastel→calm.
- T10's `npm run first-video` calls Groq and Gemini before the local render. It was not run. No polish blueprint was saved on disk, so there was nothing local to re-render.
- `MUSIC_CARVED_TWIN` stays off. Playback code is in `MusicBedTrack`, but no blueprint gets `musicCarvedUrl` yet.
- On a 250 ms collision, a kinetic hit outranks a caption pop. The brief listed them as one group.
- The prewarm script does not generate. Saying `y` raises before any Runware call. The $0.105 figure is the plan for a future wired run, not a spend that happened.
- T10 was skipped because `first-video` analyzes with Groq and Gemini before the local render. No saved polish blueprint was on disk to render instead.
- QC (T4) stays off until the salvaged bed's 3.2 s near-silent tail is trimmed or exempted. A live retry would reject the only real bed.

## 7. Commands for the human (do not run overnight)

Live polish edit. `tech_sharp` maps to `high-energy`, so this should pool-hit the salvaged bed and log `music.pool_hit` with `cost_usd` 0. A `music.generated` line with a cost means a paid generation. Do not add `MUSIC_BED_FRESH=1`.

```
cd /Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine
MUSIC_SPECIALIST=live POLISH_MUSIC_BED_URL= PRODUCT_EDIT_PROFILE=polish \
  npm run first-video -- "/Users/nishanbaral/Downloads/2.mp4" auto
```

Pool plan. This does not spend. With pool size 3 and one high-energy bed already stored, and the other four moods empty, it prints `calls=14` and `cost_usd=0.1050` (14 × $0.0075).

```
cd /Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine/agents
./.venv/bin/python -m music_specialist.scripts.prewarm_pool --plan --counts high-energy=1 --pool-size 3
```

Do not run `--confirm-spend`. The live body is not connected to generation or to R2, so it cannot fill the pool.
