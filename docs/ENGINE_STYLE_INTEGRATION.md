# Edit styles: engine integration contract (Phase 1 → Phase 2)

Internal contract inside `finalpost_engine/server`, between the **HTTP layer / edit runner** (Phase 1) and the
**analysis pipeline** (`startAnalysis` / `analyzeVideo`, Phase 2). Phase 1 shipped the picker, the catalog, validation,
entitlements and a pass-through `style` field. Phase 2 (Checkpoints 1 and 2, branch `feat/edit-styles-engine`) resolves each style
into per-job pipeline flags and a Gemini cap, behind the engine kill switch `EDIT_STYLES_ENGINE_FLAGS` (default **off** = Phase 1
behaviour). Kinetic and Explainer stay `available: false` until the paid verification (Checkpoint 3) passes.

Source of truth for styles: `server/src/lib/editStyles.ts` (registry, pure) and `server/src/lib/styleRun.ts` (style -> per-job run,
pure). Tests: `src/lib/editStyles.test.ts`, `src/lib/styleRun.test.ts`, `src/eval/editStylesRoutes.test.ts`,
`src/eval/editStylesRunner.test.ts`, `src/eval/editStylesAnalysis.test.ts`, and the real-pipeline
`src/eval/editStylesPipeline.test.ts` (explicit step, `PARITY_TESTS=1`, like `effectiveFlagsParity.test.ts`).

## 0. The four styles

| id | tier | job `mode` | needs engine flags | Gemini cap | registry `available` |
|---|---|---|---|---|---|
| `basic_captions` | free | `basic_captions` | no | 0 | true |
| `ai_clean_cut` | pro | `full_edit` | no (flags off: the server profile, see §3) | 3 | true |
| `kinetic_typography` | pro | `full_edit` | **yes**; flags off = runs as `ai_clean_cut` | 12 | **false** |
| `explainer` | pro | `full_edit` | **yes**; flags off = runs as `ai_clean_cut` | 12 | **false** |

Faceless Documentary (skill A) and Newsroom (skill D) are not in the registry and must stay unreachable from a styled request.

## 1. What carries `style` into the pipeline (exact fields)

```
App ──POST /v1/edits/captions {mode?, style?}──▶ editRoutes.ts
      resolveRequestedStyle(style, config)        → {style, tier, mode, degraded, degradedReasons} | null | error
      mode := resolved.mode ?? request.mode        (style WINS over mode)
      createCaptionsEditJob({... mode, style, degraded, degradedReasons})
            │
            ▼  CaptionsEditJob { mode, style?, degraded?, degradedReasons? }   (KV + durable store; the durable row keeps the whole job JSON)
captionsEditRunner.ts
      runCaptionsPipeline / runFullEditPipeline / resumeFullEditAfterAssets
      startAnalysis({ ...existing fields, style: job.style })
            │
            ▼  analysisRunner.ts startAnalysis(input.style)
      resolveStyleRun(style, EDIT_STYLES_ENGINE_FLAGS, env)  → {profile, flags: EffectiveFlags, geminiMaxRequests, geminiPlan, styleKey}
      analyzeVideo({... editProfile: run.profile, effectiveFlags: run.flags})   inside   withGeminiBudget(style cap)
      fingerprint += styleKey ('' with the flags off or no style)
      on done: AnalysisJob {styleApplied, degraded, degradedReasons} = styleOutcome(blueprint warnings, cap refusals, RVM present?)
            │
            ▼  waitForAnalysis copies degraded / degradedReasons onto the CaptionsEditJob (a re-analysis after the asset gate replaces them)
```

Types (`server/src/types/blueprint.ts`, `server/src/lib/editStyles.ts`):

```ts
type EditStyleId = 'basic_captions' | 'ai_clean_cut' | 'kinetic_typography' | 'explainer';

// CaptionsEditJob (edit job record, returned by GET /v1/edits/:id)
style?: EditStyleId;                 // absent = mode-only job (older app, or EDIT_STYLES_ENABLED=0)
degraded?: boolean;                  // with `style` only: false = fully honoured; true only on a real fallback
degradedReasons?: string[];          // with `style` only: [] when honoured

// startAnalysis input (analysisRunner.ts)
style?: EditStyleId;                 // carried from the edit job

// AnalysisJob (GET /v1/analyze/:id), all absent for unstyled jobs
style?: EditStyleId;
styleApplied?: EditStyleId;          // == style, or its degradesTo with the engine flags off
degraded?: boolean;
degradedReasons?: string[];
```

`degradedReasons` values (the full list is the `EditStyleOutcome` comment in `lib/editStyles.ts`): `engine_flags_off`,
`kinetic_front_only:<no_matte|matte skip reason>`, `kinetic_type_failed`, `kinetic_type_unpublished`, `explainer_layout_a_only`,
`motion_stage_off`, `motion_templates_failed`, `motion_templates_unpublished`, `gemini_cap_reached:<stage>`.

### Example requests (HTTP) and the analysis call the runner makes today

All four with `EDIT_STYLES_ENABLED=1`. Common body: `{"contentType":"video/mp4","extension":".mp4","languageCode":"auto"}`.

1. **basic_captions** (free):
   ```json
   {"mode":"basic_captions","style":"basic_captions","captionPreset":"big-talk"}
   ```
   Job: `{mode:"basic_captions", style:"basic_captions"}`.
   `startAnalysis({..., basicCaptions:true, requestedEdits:["captions"], captionPreset:"big-talk", style:"basic_captions"})`. Render: CaptionKit burn.
2. **ai_clean_cut** (Pro):
   ```json
   {"mode":"full_edit","style":"ai_clean_cut","captionTemplate":"basic",
    "fullEdit":{"renderFlags":{"brollEnabled":true,"zoomEnabled":true,"trimEnabled":true}}}
   ```
   Job: `{mode:"full_edit", style:"ai_clean_cut"}`.
   `startAnalysis({..., style:"ai_clean_cut"})` (no profile override: the server's `PRODUCT_EDIT_PROFILE`, default `cuts`).
3. **kinetic_typography** (Pro, only once made available):
   ```json
   {"mode":"full_edit","style":"kinetic_typography","fullEdit":{...}}
   ```
   Today it answers `409 style_unavailable`. If made available with `EDIT_STYLES_AVAILABLE`:
   - `EDIT_STYLES_ENGINE_FLAGS=0`: the job is `{style:"kinetic_typography", degraded:true, degradedReasons:["engine_flags_off"]}` and the
     analysis is the Phase 1 one (the server profile, env flags).
   - `EDIT_STYLES_ENGINE_FLAGS=1`: polish + Kinetic-Led (see §3), `degraded:false` unless a real fallback happened.
4. **explainer** (Pro, only once made available): the same as kinetic, with `style:"explainer"`.

Errors the route returns: `400 bad_request` (unknown style), `409 style_unavailable`, `403 pro_required` (free plan + Pro style,
whatever `mode` says), `503 entitlement_unavailable` (plan unverifiable; fail closed). The worker re-checks the plan before
paid work and fails the job with the same codes.

## 2. What the pipeline must return (Phase 2)

- **Never fail a styled job just because a style feature is unavailable.** Fall back inside the style and say so.
  - Kinetic, RVM matte unavailable (busy / not configured / over budget): plan kinetic type in FRONT of the speaker
    (front-only; never over the face). Add a warning.
  - Kinetic, motion stage refused (no library hit): keep the cuts + captions. Add a warning.
  - Explainer layouts unmountable: talking-head layout A only. Add a warning.
- Report it on the **AnalysisJob** (`styleApplied`, `degraded`, `degradedReasons`, §1); the runner copies `degraded` / `degradedReasons` to
  the edit job. The reasons are derived from the blueprint warnings (strings pinned by the stage tests) and the Gemini budget's per-label
  refusals (`lib/styleRun.ts styleOutcome`). Cap refusals exist only in the run, so they are stored beside the blueprint
  (`engine:blueprint-style-reasons:<id>`) and a cache hit reports them too.
- **Gemini cap reached mid-run** (what happens today, unchanged): `requestWithRetry` asks the budget before EVERY attempt; a refusal throws
  a `GeminiBudgetError` carrying the stage's own failure code before anything is sent, so the stage's existing catch / fallback runs
  (keep plan -> deterministic retakes, Director -> fallback plan, occupancy -> fallback box, motion Director -> no graphics, ...) and the
  job continues. What already ran is kept. Styled jobs add `gemini_cap_reached:<stage>`. Verified for every style with caps of 1-3 in
  `editStylesPipeline.test.ts`: every job completed.
- Blueprint: unchanged shape. Old blueprints must render exactly as before.
- Errors: the existing `EngineError` codes. A style must not introduce a new terminal failure mode.

## 3. Expected behaviour per style (from the discovery)

| style | profile | stages | flags (per job, never server-wide) | renderer | LLM |
|---|---|---|---|---|---|
| basic_captions | `legacy` via the existing `basicCaptions` path | transcription + captions only | none; `withNoGemini` | CaptionKit (ffmpeg/libass) when `captionPreset`, else Remotion captions | none (Groq ASR only) |
| ai_clean_cut | **`cuts`, pinned by the style** | Stage A: denoise, AI keep-plan, retakes, forced trim + captions | visuals forced off | Remotion, `trimEnabled` | Gemini keep-plan (1 call) |
| kinetic_typography | `polish` | Stage A + Director (whole-video) | `kineticLed`, `motionTemplates`, `motionGraphicsRequested` with the **library-only** Claude bound; skill `default` | Remotion | Gemini (keep-plan, story, creative (+repair), occupancy, content profile, motion director); **Claude: none** |
| explainer | `polish` | Stage A + Director | `explainerSkill`, `motionTemplates` (explainer allowlist), `motionGraphicsRequested` **library-only** (the template stage needs the motion stage) | Remotion | as kinetic; Claude: none |

Notes:

- **Pin `cuts` for ai_clean_cut.** Today `full_edit` runs `PRODUCT_EDIT_PROFILE` (default `cuts`). If production ever sets `polish`,
  "AI Clean Cut" silently becomes a polish edit. A styled job must not depend on that env var.
- **Kinetic-Led needs the motion stage.** `motion` is non-null only when `motionGraphicsOn` (`analyzeVideo.ts`, the motion stage), so
  kinetic type, Skill C and the L2 templates all need graphics requested for THIS job. Use `generatedGraphicsEnabled` /
  `EffectiveFlags.motionGraphicsRequested`, never `MOTION_GRAPHICS_ENABLED`. On polish with no Claude budget this resolves to
  `library_only` (no Claude call).
- Kinetic-Led needs RVM for the behind-subject beats (`KINETIC_MATTE_BUDGET_CPU_SEC` 20 s; 45 s on mps / cuda). The Docker image
  does not ship the RVM venv or weights: they must be provisioned on the host, or kinetic always takes the front-only fallback.
- Explainer: `resolvePolishSkill` priority is faceless > newsroom > explainer. A styled explainer request must pin faceless and
  newsroom off so the explainer lane always wins.

## 4. Engine-side requirements for Phase 2 (all done on `feat/edit-styles-engine`)

Implementation notes:
- Every styled job (flags on) pins Faceless Documentary, Newsroom, the Subject Stage (it would make Kinetic-Led yield) and the WP53 visual
  backends off, whatever the env says. Skill A tools and `POLISH_DEFAULT_EDITS` still come from env.
- "Library only" is `EffectiveFlags.libraryOnlyGraphics`: `analyzeVideo` disables the Claude bound (`claude_graphics_disabled:library_only_style`)
  whatever `CLAUDE_EDIT_BUDGET_USD` says, so the motion stage runs for library hits only. Verified with a Claude budget AND a key set: no
  request to any non-Groq / non-Gemini host.
- Gemini plans: Clean Cut reserves its slot for the keep plan (`CUTS_BUDGET_PLAN`; the default plan would reserve Director slots cuts never
  uses). Polish styles use the polish priority order without the WP8G occupancy one-attempt limit (`STYLED_POLISH_BUDGET_PLAN`). A positive
  `GEMINI_EDIT_MAX_REQUESTS` can only tighten a style cap.
- `styleKey` = `style:<id>:v1`; bump `STYLE_FLAGS_VERSION` in `lib/styleRun.ts` when a style's flag set changes.
- `gemini_edit_budget_unconfigured` is no longer reported for a job that runs inside a budget (a style's cap); unchanged otherwise.

Original requirements:

1. **Resolve once per job.** In `startAnalysis`, next to `normalizeEditProfile`, compute
   `EffectiveFlags = resolveEffectiveFlags(style, envDefaults)` and pass it in the `analyzeVideo` input. **No `env` mutation**:
   two analyses run concurrently (`MAX_CONCURRENT_ANALYSES = 2`) in one process.
   ```ts
   type EffectiveFlags = {
     profile: ProductEditProfile;
     facelessDoc: boolean; newsroomMg: boolean;   // pinned false whenever a style is set
     explainerSkill: boolean; textualMg: boolean; kineticLed: boolean;
     motionTemplates: boolean; motionGraphicsRequested: boolean;
   };
   ```
2. **Env only as defaults.** Replace the global `env.POLISH_*` / `env.MOTION_GRAPHICS_ENABLED` reads in `analyzeVideo.ts` (27 sites:
   the skill resolution, kinetic offer, craft / textual / template stages, subject-stage yield) with `input.effectiveFlags`.
   When `style` is absent, `EffectiveFlags` must equal today's env values exactly, so unstyled jobs are byte-for-byte unchanged.
3. **Documentary and Newsroom pinned off for styled requests**, whatever the env says. Their code paths stay intact for unstyled
   env-driven runs.
4. **Style in the cache fingerprint.** Add `styleKey` to `fingerprintSource` (empty when there is no style, so every existing key is
   unchanged), and put the profile from `EffectiveFlags` into `editProfileKey`. Phase 1 deliberately leaves the style out: a styled job
   runs like its mode today, so a cache hit across styles is correct now and wrong after Phase 2.
5. **Gemini budget plan from the resolved profile** (`geminiBudgetPlanFor(effectiveFlags.profile)`), not from the env profile.
6. **Requests with no style are unchanged**: same profile, flags, cache keys and outputs.
7. ~~`engineSupport`~~ replaced by `needsEngineFlags` + `EDIT_STYLES_ENGINE_FLAGS`: with the flags on, the style is produced natively and
   the route writes `degraded:false`. Add it to `EDIT_STYLES_AVAILABLE` only after Checkpoint 3.

## 5. Versioning and rollout (app and engine deploy separately)

| app | engine | behaviour |
|---|---|---|
| new | old (no catalog) | `GET /v1/edit-styles` → 404. The app uses its bundled manifest and sends the **mode-only** request (no `style`; `lib/editStyleCatalog.ts`). Even if `style` were sent, the old `createSchema` (a non-strict `z.object`) strips unknown keys. |
| new | new, `EDIT_STYLES_ENABLED=0` | identical to the row above (the catalog answers 404, and `style` is ignored). |
| new | new, `EDIT_STYLES_ENABLED=1` | server catalog; `style` sent and validated; job records `style` / `degraded`. |
| old | new | no `style` field: the mode-only path is unchanged (tested). |

Kill switches:
- Engine: `EDIT_STYLES_ENABLED` (default **off**). Off restores the pre-picker behaviour for every app version.
- Engine: `EDIT_STYLES_AVAILABLE` / `EDIT_STYLES_ORDER` change availability and order without a release.
- Engine: `EDIT_STYLES_ENGINE_FLAGS` (Phase 2, default **off**). Off = styled jobs run exactly as in Phase 1 (the server profile and env
  flags and Gemini cap, no style in the cache key; Kinetic / Explainer as `ai_clean_cut`, `degraded` with `engine_flags_off`), so the
  per-style resolution can be turned off without hiding the picker. Requests with no style are unaffected either way.
- App: none needed. It follows the engine (404 → fallback); a picker regression is fixed by turning the engine switch off.

Order for Phase 2: deploy the engine with `EDIT_STYLES_ENGINE_FLAGS=0`, then turn it on, verify (Checkpoint 3), then add the style to
`EDIT_STYLES_AVAILABLE`. No app release is needed to expose Kinetic or Explainer (the app's `degraded` type change is not read by any UI).

## 6. Integration checklist (both sides, before prod)

- [ ] Mode-only requests from the current store app: all four modes behave as before (`editStylesRoutes.test.ts`, mode-only case).
- [ ] New app vs an engine with `EDIT_STYLES_ENABLED=0`: the picker shows the bundled manifest, the request has no `style`, and the edit completes.
- [ ] `GET /v1/edit-styles`: free → Pro locked; Pro / Pro Plus → none locked; Creators API down → 200 with Pro locked.
- [ ] Free + `ai_clean_cut` → 403 `pro_required`; the app shows the paywall from the locked card instead of sending it.
- [ ] `kinetic_typography` / `explainer` → 409 `style_unavailable` while unavailable; the cards say "Coming soon".
- [ ] `basic_captions` styled job: CaptionKit output, zero Gemini requests (`withNoGemini`), free watermark still burned by the app.
- [ ] `ai_clean_cut` styled job: the cuts profile (keep-plan applied, no visual stages), `trimEnabled` render.
- [x] Phase 2: unstyled job blueprint identical to before (`effectiveFlagsParity`, 23 combos); unstyled cache key unchanged (styleKey empty);
      styled keys differ per style (`editStylesAnalysis`).
- [x] Phase 2: two concurrent analyses with different styles do not leak flags or budgets into each other.
- [x] Phase 2: Documentary / Newsroom env flags on + a styled request: neither lane runs (`editStylesPipeline`, with a control run).
- [x] Phase 2: kinetic with no RVM: completes front-only, `degraded: true` with `kinetic_front_only:no_matte`; never fails (offline).
- [ ] Phase 2: kinetic beats and explainer templates PUBLISH (offline they cannot: no Remotion runtime check / R2; the outcome reports
      `kinetic_type_unpublished` / `motion_templates_unpublished`) and explainer layouts are visibly mounted in a real render (Checkpoint 3).
- [ ] Job status (`GET /v1/edits/:id`) shows `style` and `degraded`; the durable store round-trips them (whole-job JSON column).

## 7. Open questions for the engine (Phase 2)

1. **Kinetic-Led QA state.** `POLISH_KINETIC_LED` is default off and labelled experimental; `KINETIC_LED_CONFIG.enabled` is
   `false`. The style bible it cites (`remotion/out/phase36-readiness/KINETIC_LED_STYLE_BIBLE.md`) is not in the repo or the local
   checkout. Is it QA-paused, and what is the bar for shipping it as a product style?
2. **Explainer render mount.** The `POLISH_EXPLAINER_SKILL` comment says WP40 is "planning + warnings only; layouts not yet mounted in
   the production render (WP41 …)", but `analyzeVideo.ts` builds an `explainerMount` layout track. Confirm with a real render.
3. **RVM in production.** Is the RVM venv and weights provisioned on the droplet? Without it Kinetic is always front-only.
4. **Clean Cut profile pinning.** Confirm that `ai_clean_cut` should be `cuts` even if `PRODUCT_EDIT_PROFILE` changes.
5. **Cost.** Polish styles ran 9 Gemini attempts in the stubbed pipeline (keep plan 1, occupancy 3, story 1 + repair 1, creative 1, layout
   critique 1, motion Director 1); each style is capped in the registry (§0). Real counts are a Checkpoint 3 measurement.
6. ~~`captionkit_tmp/` is untracked~~ Done: `captionkit.py`, `presets.json`, `fonts/` and the font licences are committed.
