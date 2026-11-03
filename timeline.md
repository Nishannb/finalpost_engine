# FinalPost Engine: Knowledge Graph and Timeline (through Phase 18)

Handoff document for another coding agent. Repo: `/Users/nishanbaral/Desktop/apps/finalpost_engine` (server in `server/`, Remotion renderer in `remotion/`). Branch `main`, nothing committed from this work (large uncommitted working tree; see `git status`).

## 0. Standing rules (apply to every phase unless the user lifts them)
- No Gemini/Anthropic/Claude/OpenAI or any paid model API calls. Tests mock HTTP (`lib/http.ts` `requestJson`).
- No model-backed edits or repairs on real videos.
- No deployment, commit, push, or production infra changes.
- Preserve all uncommitted work and all earlier phase artifacts (`remotion/out/phase*-audit/`).
- Never overwrite frozen baselines/goldens (`server/src/eval/baselines/*.manifest.json`, planner goldens, fixtures). Add new tests/fixtures instead.
- New behaviour goes behind flags, default off / default = old behaviour.
- Each phase ends with "stop and wait for explicit authorization". Do not start the next phase on your own.
- Report pre-existing failures accurately; do not claim fixes you did not make.
- Use absolute paths; BSD `sed -i` needs a suffix (use python for edits); zsh doesn't word-split `$var`; `tsc` excludes only `*.test.ts`, so non-test files must not import from `remotion/`.

## 1. System map (nodes)
- **Pipeline** (`server/src/pipeline/analyzeVideo.ts`): builds the blueprint from director output, B-roll, layout, zooms, finalizeEdits.
- **v1 visual Director**: `stages/broll/geminiDirector.ts` (`planVisualDirection`, `callGemini`, text-only), `brollPlanner.ts` (`planBRoll`), `editorialGate.ts`, `ensureRequestedEdits.ts`, `insetRevealPlanner.ts`, `motionGraphicsPlan.ts`, `speechAlign.ts`.
- **v2 Director** (`stages/directorV2/`): `perception.ts` -> `storyAnalyst.ts` -> `creativeDirector.ts` -> `compiler.ts` (`compileCreativePlan`) + assembler legality (`lib/assembler/`: `legality.ts`, `sanity.ts`, `manifests.ts`, `types.ts`). Also `visualContext.ts`, `storyboardPlan.ts`, `occupancyContract.ts`, `schemas.ts`, `types.ts`, `runDirectorV2.ts`, `geminiClient.ts`.
- **Layout**: `stages/layout/layoutCritique.ts`, `occupancy.ts`; `lib/depthOverlay.ts` (`speakerVisibleRanges`).
- **Edit bookkeeping**: `lib/editLedger.ts`, `reasonRegistry.ts`, `editDiagnostics.ts`, `editConflicts.ts` (conflict validator), `layoutPriority.ts`, `transitionPlan.ts`, `editToolkits.ts`, `finalizeEdits`.
- **Filters**: `stages/filters/autoZoom.ts` (`resolveDirectedZooms`).
- **Renderer** (`remotion/src/`): `ShortVideo.tsx`, `Root.tsx`, `blueprintSchema.ts`, `components/*` (VideoTrack, ZoomFrame, TransitionTrack, SlideshowPlate, SemanticEmphasisTrack), `lib/timeline.ts`. Hook title renders only when `blueprint.hookTitle` is truthy.
- **Config / flags** (`server/src/config/env.ts`): `GENERATED_TRANSITIONS_ENABLED`, `VISUAL_CONTEXT_V2`, `DIRECTOR_V2`, `NORTH_STAR`, `MOTION_GRAPHICS_ENABLED` (all false), `PIPELINE_MODE` lean, plus Phase 18 `HOOK_TITLE_POLICY` (`placeholder` | `optional`, default `placeholder`) and `OCCUPANCY_CONTEXT_V2` (false).
- **Offline eval harness** (`server/src/eval/`): 8 saved v1 Gemini responses over 2 clips (fixtures with provenance), planner goldens, frame-time pin, prompt-lint pin, frozen `baselines/{legacy,experimental}.manifest.json`, `baseline.ts` verifiers, `replayCore.ts`, `invariants.ts` (M1-M9), `runManifest.ts` (+tests), `capabilityAudit.test.ts`, `noopClassification.test.ts`, `hookImpact.test.ts`. Coverage honestly labelled `saved_response_replay` (not end-to-end).
- **Scripts**: `npm run -s eval:replay`, `npm run -s eval:baseline` (keeps existing manifests unless `EVAL_BASELINE_OVERWRITE=1`).

## 2. Timeline of phases (edges: what led to what)
- **Phases 10, 10A, 10B**: Diagnosed the "editorial intelligence gap"; made capabilities deterministic, honest and auditable; produced validation props and renders (`remotion/out/phase10b-validation/`, incl. `props/s0_baseline.json`, `public/`).
- **Phases 11-14**: Capability audit, no-op classification, edit ledger and reason registry, evaluation rubric/plan (`phase14-audit/{EVALUATION_RUBRIC,EVALUATION_PLAN,code-state-at-audit.json}`).
- **Phase 15**: Corpus inventory/gaps, reviewer guide, proposed occupancy wording (`phase15-audit/`).
- **Phase 16**: Visual-context work: output->source time mapping (half-open segments), coverage = pictures shown only (`FOCUS_EVIDENCE_PAD_SEC=1`), default path decodes stills at mapped source time with an 8-image budget, labels from `framesSentToDirector`, occupancy measurement fields (`occupancyMeasurements`, `occupancyMeasured`, `measuredOccupancy`), NOTE line + measured-span sentence (`phase16-audit/`).
- **Phase 17**: Fixed `speakerVisibleRanges` (no slices or `source==='fallback'` => unknown, not visible); wrote hook-title implementation proposal, run-manifest spec, human-review pilot plan (`phase17-audit/{REPORT,HOOK_TITLE_IMPLEMENTATION_PROPOSAL,RUN_MANIFEST_SPEC,HUMAN_REVIEW_PILOT}.md`); added unwired `stages/broll/hookTitlePolicy.ts` spec module + tests, `eval/hookImpact.test.ts`.
- **Phase 18 (latest, complete)**: user approved both decisions; implemented behind flags (below), validator extended, pilot plan updated, regression run, report written. Stopped awaiting authorization.

## 3. Phase 18 details (current state)
### Hook title: `HOOK_TITLE_POLICY`
- Default `placeholder`: identical to old behaviour, including `WATCH THIS` fallback (v1 parser turned any missing title into it).
- `optional`: missing/null/empty/whitespace title => no hook element; no `WATCH THIS`, no transcript fallback; real titles render normally.
- Wired through: `geminiDirector.ts` (`cleanHookTitle`, `hookTitleIsOptional()`, parser, merge, fallback, schema `required` list), `motionGraphicsPlan.ts` (empty plan instead of placeholder), `sanity.ts` (`hook_missing` warning suppressed under optional), `brollPlanner.ts` (hook window 0 when no title), `layoutCritique.ts` (`hookIsDrawn`, hook anchor skipped when title explicitly empty; `analyzeVideo` passes `hookTitle`). Conflict validator, ledger, blueprint (`hookTitle` default '') and renderer already tolerated empty.
- Renderer evidence: `remotion/out/phase18-audit/stills/` + `props/`; optional/empty-title renders are pixel-identical to the no-hook baseline.

### Occupancy: `OCCUPANCY_CONTEXT_V2` (default false)
- On: occupancy block distinguishes detected measurements, estimated geometry (derived face box), fallback default boxes, repeated values (not independent), exact measured span, unobserved ranges; replaces "treat as visible unless cropped/tiny"; unknown stays unknown.
- Touches only the occupancy text: `layout/occupancy.ts` (`describeOccupancyForDirector(occupancy, context?)`, `occupancyBoxLinesV2`), `directorV2/perception.ts` (`formatOccupancyContextV2`, `unobservedRanges`, `occupancyMeasured`), `creativeDirector.ts` (`confirmedVisibilityText`), `occupancyContract.ts`, `types.ts`, `occupancyAtSec` plumbing (`brollPlanner` -> `planVisualDirection`). Image budget, frame sampling, system instruction, generationConfig unchanged.

### Run-manifest validator (`server/src/eval/runManifest.ts`)
- `REQUIRED_FLAGS`: HOOK_TITLE_POLICY, OCCUPANCY_CONTEXT_V2, VISUAL_CONTEXT_V2, GENERATED_TRANSITIONS_ENABLED, DIRECTOR_V2, NORTH_STAR (omission => missing/invalid).
- Outputs need `kind`, `path`, `sha256` (value or explicit unknown); unknown hash or no outputs => not comparable.
- `compareManifests(a, b, declaredVariables)` returns verdict (`comparable | not_comparable | repeat`), per-field `fields` status (`known_match | known_mismatch | unknown | missing`), `differing`, `reasons`. Undeclared differences => not_comparable. Offline only, separate from production.

### Phase 18 tests / results
- Server `vitest`: 76 files, 794 passed, 1 failed. New: `stages/broll/hookTitleFlag.test.ts` (25), `stages/directorV2/occupancyContextFlag.test.ts` (18), extended `eval/runManifest.test.ts` (68 in file).
- Pre-existing failures (not ours): `lib/assembler/assembler.test.ts` "detects historical north-star dump defects" (missing `director-dump-northstar/04-blueprint-applied.json`); Remotion `src/Root.tsx(44,26)` TS7031.
- Server `tsc` clean; `eval:replay` 188 passed; `eval:baseline` kept existing manifests.

### Phase 18 artifacts
- `remotion/out/phase18-audit/REPORT.md`, `HUMAN_REVIEW_PILOT_UPDATE.md`, `props/`, `stills/`.

## 4. Human-review pilot (planned, NOT run)
- Four kinds of difference reviewers must separate: title-policy, occupancy-interpretation, editing-decision (ledger diff), renderer/technical (same blueprint hash, different pixels).
- Six historical renders = rubric practice only, never a controlled comparison or evidence of improvement (no manifests, provenance unknown).
- A controlled pilot requires validating, `comparable` run manifests from a separately authorised run; prefer one declared variable per comparison.

## 5. Remaining blockers / open items
- No controlled evaluation exists; needs separate user authorization for manifested runs and the pilot.
- Replay coverage is saved-response, not end-to-end.
- Two pre-existing failures remain unfixed (out of scope unless the user asks).
- Flags are off by default; enabling them by default is a user decision.

## 6. How to continue
1. Read this file, then `remotion/out/phase18-audit/REPORT.md` and `plan.md` (repo root; motion-worker plan).
2. Do not start model-backed runs, pilot, or flag-default changes without explicit user authorization.
3. For verification use: `cd server && npx vitest run`, `npx tsc --noEmit -p .`, `cd ../remotion && npx tsc --noEmit -p .`, `npm run -s eval:replay`, `npm run -s eval:baseline`.
4. Expected baseline: 794/795 passing server tests (1 known failure) and the single known Remotion TS error.
