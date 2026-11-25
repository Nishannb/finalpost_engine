# RVM / Subject Stage: phased completion plan

Status file for the talking-head cutout + matte-aware graphics effort. Update the status line of each phase as work lands.
Written 2026-11-21. Scope: `finalpost_engine-production/` only.

## North star
1. Cut out the talking head reliably (provided cutout / chroma when keyable / RVM alpha WebM).
2. Layer motion graphics (Subject Stage S1-S5, plates, cards, accents, PiP-like insets, optional kinetic-behind-subject) with full awareness of the silhouette, speaker box and matte coverage. Fail closed when the matte is unusable (never half-on ghosting).

## Product decisions (from the owner)
- **Subject Stage is its own edit option, separate from Kinetic Typography.** A creator can pick Kinetic Typography only, or pick Subject Stage for the "full edit". They are never merged (one pipeline owns a job: `lib/editingPipeline.ts`).
- Production host has **no GPU for now**. RVM runs on CPU: Subject Stage is limited to clips of <= 45 s (`SUBJECT_STAGE_MATTE.cpuMaxVideoSec`) until a GPU host (`RVM_DEVICE=cuda`) exists. The engine must skip cleanly (`polish_subject_stage:skipped:cpu_over_45s`), never half-run.
- **No deploys, no server changes, no flag enablement on any server** as part of this effort. New flags default OFF.
- No paid API calls, no R2 writes, no Lambda. Local tests only.

## Status

| Phase | Name | Status |
|---|---|---|
| P0 | Truth map + telemetry/cache correctness | Done (code). Droplet checklist is a human step. |
| P1 | Cutout quality bar | Done (metrics + tests). Real-clip fixture run is a human step (needs footage + RVM weights). |
| P2 | Matte availability + gate reliability | Done (confidence feed, provided-cutout verification). Measuring gate refusal rates on real clips is a human step. |
| P3 | Host RVM readiness | Done (preflight script + `docs/RVM_HOST.md`). Nothing run on a server. |
| P4 | Subject Stage product path + picker option | Done behind `SUBJECT_STAGE_PICKER` (default OFF). Staging/canary rollout is a human step. |
| P5 | Graphics / PiP awareness | Done for the provided-cutout matte grid. Further S5/PiP polish needs rendered proofs. |
| P6 | Kinetic-behind-subject lane | Verified only (ownership tests pass); no code change; flag stays OFF. |
| P7 | Optimize | Cache fingerprint strengthened. Perf measurement and Lambda alpha deferred (need real host / approval). |
| P8 | Ship checklist | Done (section below). |

## Known findings that shape the work
1. `SCRIPT_VERSION = 'rvm-1'` (`server/src/media/personMatte.ts`) was not bumped after the alpha-refinement fix, so pre-fix cached mattes keep being served.
2. Subject Stage does not call `decideMatteGate`; it has its own gate. The "compositor is never looser than planning" rule needs a stage-specific check.
3. `decideMatteGate` accepts `confidence`, but no caller supplies one, so `low_confidence` is dead.
4. (Corrected during P0) `matte_gate:*` warnings ARE emitted on polish: `mvpLike` = mvp or polish (`analyzeVideo.ts:393`). No telemetry fix needed.
5. Provided cutouts have no quality check; RVM has `matteQualityGate`, chroma has `chromaSanity`.
6. `RVM_DEVICE=auto` is treated as CPU by the stage, so whole-run RVM is <= 45 s unless the device is explicit `mps` / `cuda`.
7. The RVM slot is in-process only; the cache fingerprint is size + first/last MiB; the cache dir defaults to the OS temp dir.
8. `subject_stage` is engine-only (not in `EDIT_STYLE_IDS`, so not in the picker catalog) and unavailable by default.

## P0: Truth map and cheap correctness
- **Goal / exit:** cache keys change when the matte algorithm changes; a droplet checklist exists for the human to run (read-only).
- **Work:** bump `SCRIPT_VERSION` to `rvm-2`; write the droplet checklist (below).
- **Verify:** `personMatte.test.ts`, `matteGate`-related tests, server `tsc --noEmit`.
- **Droplet checklist (run by a human, read-only):** resolved values (not secrets) of `V1_KINETIC_RELEASE`, `V1_KINETIC_ACCESS`, `POLISH_SUBJECT_STAGE`, `POLISH_KINETIC_ENGINE_MATTE`, `POLISH_KINETIC_ENGINE`, `RVM_PYTHON` (resolves?), `RVM_DEVICE`, `RVM_WEIGHTS_PATH` (file exists?), `MATTING_*`, `PERSON_MATTE_*`; `ffmpeg -encoders | grep libvpx-vp9`; one 10 s matting job; grep recent job warnings for `matte_gate:`, `person_matte:`, `polish_subject_stage:`, `subject_stage:matte:`, `speaker_cutout_`.

## P1: Cutout quality bar
- **Goal / exit:** a scripted, thresholded definition of "clean enough" (fringe luminance on white/dark composites, edge-band flicker, core hole fraction, face-box alpha) with unit tests on synthetic alphas; fixture list for real clips.
- **Work:** `subjectmatte/human_matting/processing/matte_metrics.py` + tests; document fixture clip categories.
- **Risks:** real-clip tuning needs footage + RVM weights, which are not available locally. The metrics and thresholds ship; the real-clip run is a human step.
- **Verify:** pytest in `subjectmatte/human_matting/tests`.

## P2: Matte availability and gate reliability
- **Goal / exit:** gate refusals have distinct reasons; `confidence` is real; provided cutouts are sanity-checked; Subject Stage matte acceptance is never looser than the planning gate.
- **Work:** `matteGate.ts` confidence feed from the RVM report; provided-cutout sanity (`providedCutout.ts`); stage-vs-gate consistency test.
- **Verify:** unit tests for `matteGate`, `providedCutout`, `personMatteStage`, `subjectStageStage`.

## P3: Host RVM readiness
- **Goal / exit:** a provisioning script + doc (venv, weights outside the image, persistent cache dir) and a read-only preflight command that reports RVM readiness and the CPU cap. Nothing is run on a server.
- **Work:** `scripts/rvm-preflight` + `docs/RVM_HOST.md`.
- **Verify:** run the preflight locally (expected: not_configured here).

## P4: Subject Stage product path (separate option from Kinetic)
- **Goal / exit:** Subject Stage can appear in the style picker catalog as its own Pro "full edit" option, only when a new flag is ON (default OFF) and the style is available; Kinetic Typography is unchanged and selectable on its own; selection makes Subject Stage own the job; V1 release gate lets it through only when explicitly enabled; no silent fallback to another pipeline (fails explicitly).
- **Work:** `editStyles.ts` catalog gating, env flag, entitlement check, tests for catalog/availability/ownership/V1 gate.
- **Rollout (human-driven, not done here):** staging -> proof -> canary user allowlist -> prod, with rollback = flag off.
- **Verify:** `editStyles`, `phase523PipelineOwnership`, `subjectStageStage` tests; server `tsc`.

## P5: Graphics / PiP awareness
- **Goal / exit:** front elements never touch protected cells; a provided cutout is decoded for a matte grid instead of falling back to the speaker box where possible; S5 limits hold.
- **Work:** `stageProtection.ts` / `subjectStageStage.ts` review and tests.
- **Verify:** `planSubjectStage.test.ts`, `subjectStage.test.ts`, golden JSON unchanged unless intended.

## P6: Kinetic-behind-subject lane
- **Goal / exit:** `POLISH_KINETIC_ENGINE_MATTE` stays OFF and keeps ownership rules; shared matte cache means a Subject Stage + Kinetic job never pays RVM twice.
- **Verify:** `phase523PipelineOwnership.test.ts`, kinetic matte tests.

## P7: Optimize (after correctness)
- **Goal / exit:** stronger cache fingerprint, cache-hit/matte-seconds telemetry; output unchanged.
- **Out of scope here:** Lambda alpha proofs (need approval), cross-process slot (only if more than one worker is run).

## P8: Ship checklist
- **Goal / exit:** env matrix per environment, monitoring warnings, rollback runbook, app-side handoff notes (Remove BG -> `subjectCutoutUrl` -> Apply Edit). Doc only.

## Non-goals
Enabling flags on any server; making Subject Stage the default; replacing Kinetic Typography; pose/hand detection; new layout solver; deleting RVM / Subject Stage / Kinetic V2 code; Android/app work; Lambda alpha rendering; any paid API call or R2 write.

## P8: Ship checklist (doc only)

### Env matrix (names only; values live on the host)
| Var | Local/dev | Staging | Prod (today) |
|---|---|---|---|
| `SUBJECT_STAGE_PICKER` | 0 | 1 (allowlisted testers) | **0** until sign-off |
| `POLISH_SUBJECT_STAGE` | 0 | 0 (a SELECTED style turns the stage on per job; the global flag is only for unstyled jobs) | 0 |
| `POLISH_KINETIC_ENGINE_MATTE` | 0 | 0 | 0 |
| `RVM_PYTHON`, `RVM_WEIGHTS_PATH` | optional | set (docs/RVM_HOST.md) | set only after staging proof |
| `RVM_DEVICE` | cpu/mps | cpu | cpu (cuda on a GPU host) |
| `PERSON_MATTE_CACHE_DIR` | default | persistent dir | persistent dir |
| `V1_KINETIC_RELEASE` / `V1_KINETIC_ACCESS` | unchanged | unchanged | unchanged (Kinetic stays as is) |

### Monitor (job warnings)
`polish_subject_stage:on | skipped:<reason> | off`, `subject_stage:matte:{provided,provided_verified,provided_unverified,provided_rejected:<r>,chroma,rvm}`, `person_matte:skipped:<reason>` (busy, timeout, not_configured, low_quality:...), `person_matte:rvm:cache|run`, `matte_gate:ok|unusable:<reason>`, `editing_pipeline:subject_stage:selected`, and the job's `degradedReasons` (`subject_stage_skipped:<reason>`).
Watch: `cpu_over_45s` share (tells you when a GPU host is worth it), `provided_rejected` (the app's Remove Background output is bad), `busy` (RVM slot contention), `no_matte_backend` (RVM not provisioned).

### Rollout (human-driven; nothing here was run)
1. Provision a **staging** host (docs/RVM_HOST.md); `node scripts/rvm-preflight.mjs` must exit 0.
2. Staging: `SUBJECT_STAGE_PICKER=1`; run the P1 fixture clips through real jobs; record warnings; render-check z-order (person over plate, S5 over person, no half-on frames) with `remotion/scripts/subject-stage-proof.mjs`.
3. Canary: a small tester allowlist on prod with `SUBJECT_STAGE_PICKER=1` (needs the app build that shows the option; the catalog is server-driven).
4. Rollback: set `SUBJECT_STAGE_PICKER=0` and restart. The option disappears from the catalog and new requests get `style_unavailable`; Kinetic Typography and Basic Captions are unaffected. In-flight Subject Stage jobs finish or degrade with a recorded reason.

### App handoff (not audited here; verify in the app repo)
- Remove Background -> its matting job `outputUrl` -> Apply Edit sends it as `subjectCutoutUrl`. The engine now downloads it (public hosts only, 200 MB ceiling) and rejects an empty/opaque/tiny asset (`provided_rejected`, style skipped, never half-on).
- The app must render Subject Stage as a separate option from Kinetic Typography (server catalog entry `subject_stage`, tier Pro) and show `degraded` / `degradedReasons` honestly.

### Open items needing a human or approval
- Droplet truth map (P0 checklist) and the real-clip quality run (P1).
- Product decision: when the stage cannot run (no RVM, clip > 45 s on CPU), the job currently **completes degraded** as a plain polish edit with `subject_stage_skipped:<reason>`. If you would rather it **fail explicitly** (like Kinetic under V1), that is a small follow-up; say so.
- GPU host decision once `cpu_over_45s` rates justify it.
- Lambda alpha proof and any paid-model call: need approval.

## Implementation log
- 2026-11-21/22 P0: `SCRIPT_VERSION` rvm-1 -> rvm-2 (`media/personMatte.ts`). Corrected finding 4 (polish already emits `matte_gate:*`).
- P1: `subjectmatte/human_matting/processing/matte_metrics.py` + `tests/test_matte_metrics.py` (8 tests, numpy only; run with a direct runner because pytest is not installed locally).
- P2: `matteConfidence` (`lib/matteGate.ts`) fed to the final gate through `PersonMatteOutcome.confidence`; `providedVerify` in `runSubjectStage` (download via `downloadToFile`, `chromaSanity`, skip on reject), wired in `analyzeVideo.ts`; tests in `lib/matteGate.test.ts`, `pipeline/subjectStageStage.test.ts`.
- P3: `scripts/rvm-preflight.mjs` (read-only), `docs/RVM_HOST.md`.
- P4: `SUBJECT_STAGE_PICKER` (default OFF) in `config/env.ts`, `lib/editStyles.ts` (catalog + availability + V1 gate), `http/routes/editRoutes.ts`, `.env.production.example`; tests in `lib/editStyles.test.ts`.
- P5: verified provided cutout now yields a real matte grid for speaker protection (test added).
- P7: cache fingerprint adds a middle MiB (`media/personMatte.ts`; no dedicated test).
- Not committed, not deployed, no flags enabled anywhere, no paid calls, no R2 writes.
