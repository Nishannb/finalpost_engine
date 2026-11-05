# Edit styles: engine integration contract (Phase 1 → Phase 2)

Internal contract inside `finalpost_engine/server`, between the **HTTP layer / edit runner** (Phase 1, done) and the
**analysis pipeline** (`startAnalysis` / `analyzeVideo`, Phase 2, to do). Phase 1 shipped the picker, the catalog, validation,
entitlements and a pass-through `style` field. The pipeline does not read the style yet: until Phase 2 lands, every styled job
runs exactly like its `mode` does today, and a style the pipeline cannot produce is marked `degraded` on the job.

Source of truth for styles: `server/src/lib/editStyles.ts` (registry, pure). Tests: `src/lib/editStyles.test.ts`,
`src/eval/editStylesRoutes.test.ts`, `src/eval/editStylesRunner.test.ts`.

## 0. The four styles

| id | tier | job `mode` | engine support (Phase 1) | registry `available` |
|---|---|---|---|---|
| `basic_captions` | free | `basic_captions` | native | true |
| `ai_clean_cut` | pro | `full_edit` | native (today's `full_edit` = the `cuts` profile, see §3) | true |
| `kinetic_typography` | pro | `full_edit` | **pending**, degrades to `ai_clean_cut` | **false** |
| `explainer` | pro | `full_edit` | **pending**, degrades to `ai_clean_cut` | **false** |

Faceless Documentary (skill A) and Newsroom (skill D) are not in the registry and must stay unreachable from a styled request.

## 1. What carries `style` into the pipeline (exact fields)

```
App ──POST /v1/edits/captions {mode?, style?}──▶ editRoutes.ts
      resolveRequestedStyle(style, config)        → {style, tier, mode, degraded?} | null | error
      mode := resolved.mode ?? request.mode        (style WINS over mode)
      createCaptionsEditJob({... mode, style, degraded})
            │
            ▼  CaptionsEditJob { mode, style?, degraded? }   (KV + durable store; the durable row keeps the whole job JSON)
captionsEditRunner.ts
      runCaptionsPipeline / runFullEditPipeline / resumeFullEditAfterAssets
      startAnalysis({ ...existing fields, style: job.style })     ◀── THE field Phase 2 reads
            │
            ▼  analysisRunner.ts startAnalysis(input.style)
      Phase 1: recorded on AnalysisJob.style only. NOT passed to analyzeVideo, NOT in the cache fingerprint.
      Phase 2: resolve EffectiveFlags HERE (next to normalizeEditProfile), pass them to analyzeVideo, add styleKey to the fingerprint.
```

Types (`server/src/types/blueprint.ts`, `server/src/lib/editStyles.ts`):

```ts
type EditStyleId = 'basic_captions' | 'ai_clean_cut' | 'kinetic_typography' | 'explainer';
type EditStyleDegradation = {reason: 'engine_style_pending'; appliedAs: EditStyleId};

// CaptionsEditJob (edit job record, returned by GET /v1/edits/:id)
style?: EditStyleId;                 // absent = mode-only job (older app, or EDIT_STYLES_ENABLED=0)
degraded?: EditStyleDegradation;     // present only with `style`

// startAnalysis input (analysisRunner.ts)
style?: EditStyleId;                 // carried untouched from the edit job

// AnalysisJob (GET /v1/analyze/:id)
style?: EditStyleId;                 // recorded only in Phase 1
```

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
   Today it answers `409 style_unavailable`. If forced available with `EDIT_STYLES_AVAILABLE`, the job is
   `{mode:"full_edit", style:"kinetic_typography", degraded:{reason:"engine_style_pending", appliedAs:"ai_clean_cut"}}`
   and the analysis is identical to `ai_clean_cut`.
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
- Report it on the **AnalysisJob**, and the runner copies it to the edit job:
  ```ts
  // AnalysisJob (new in Phase 2)
  styleApplied?: EditStyleId;        // what the pipeline actually produced (== style when fully honoured)
  styleWarnings?: string[];          // e.g. 'style_fallback:kinetic_front_only:no_matte', 'style_fallback:explainer_layout_a_only'
  // CaptionsEditJob.degraded: the runner sets {reason:'engine_style_fallback', appliedAs: styleApplied} when styleApplied !== style,
  // and clears the Phase 1 'engine_style_pending' value once the registry marks the style native.
  ```
  (`EditStyleDegradation.reason` then gains `'engine_style_fallback'`.)
- Blueprint: unchanged shape. Old blueprints must render exactly as before.
- Errors: the existing `EngineError` codes. A style must not introduce a new terminal failure mode.

## 3. Expected behaviour per style (from the discovery)

| style | profile | stages | flags (per job, never server-wide) | renderer | LLM |
|---|---|---|---|---|---|
| basic_captions | `legacy` via the existing `basicCaptions` path | transcription + captions only | none; `withNoGemini` | CaptionKit (ffmpeg/libass) when `captionPreset`, else Remotion captions | none (Groq ASR only) |
| ai_clean_cut | **`cuts`, pinned by the style** | Stage A: denoise, AI keep-plan, retakes, forced trim + captions | visuals forced off | Remotion, `trimEnabled` | Gemini keep-plan (1 call) |
| kinetic_typography | `polish` | Stage A + Director (whole-video) | `kineticLed`, `motionTemplates`, `motionGraphicsRequested` with the **library-only** Claude bound; skill `default` | Remotion | Gemini (keep-plan, story, creative (+repair), occupancy, content profile, motion director); **Claude: none** |
| explainer | `polish` | Stage A + Director | `explainerSkill`, `motionTemplates` (explainer allowlist); `motionGraphicsRequested` needed for the template stage | Remotion | as kinetic; Claude: none |

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

## 4. Engine-side requirements for Phase 2

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
7. When a style is produced natively, flip its registry entry to `engineSupport: 'native'` (that stops the route from writing
   `engine_style_pending`), and only then add it to `EDIT_STYLES_AVAILABLE`.

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
- Phase 2 must add its own switch (for example `EDIT_STYLES_ENGINE_FLAGS`, default off). Off = styled jobs run as their
  `degradesTo` (Phase 1 behaviour), so the per-style flag resolution can be turned off without hiding the picker.
- App: none needed. It follows the engine (404 → fallback); a picker regression is fixed by turning the engine switch off.

Order for Phase 2: deploy the engine with `EDIT_STYLES_ENGINE_FLAGS=0`, then turn it on, verify, flip `engineSupport` for the style,
then add it to `EDIT_STYLES_AVAILABLE`. No app release is needed to expose Kinetic or Explainer.

## 6. Integration checklist (both sides, before prod)

- [ ] Mode-only requests from the current store app: all four modes behave as before (`editStylesRoutes.test.ts`, mode-only case).
- [ ] New app vs an engine with `EDIT_STYLES_ENABLED=0`: the picker shows the bundled manifest, the request has no `style`, and the edit completes.
- [ ] `GET /v1/edit-styles`: free → Pro locked; Pro / Pro Plus → none locked; Creators API down → 200 with Pro locked.
- [ ] Free + `ai_clean_cut` → 403 `pro_required`; the app shows the paywall from the locked card instead of sending it.
- [ ] `kinetic_typography` / `explainer` → 409 `style_unavailable` while unavailable; the cards say "Coming soon".
- [ ] `basic_captions` styled job: CaptionKit output, zero Gemini requests (`withNoGemini`), free watermark still burned by the app.
- [ ] `ai_clean_cut` styled job: the cuts profile (keep-plan applied, no visual stages), `trimEnabled` render.
- [ ] Phase 2: unstyled job blueprint and cache key identical to before (golden test), styled keys differ per style.
- [ ] Phase 2: two concurrent analyses with different styles do not leak flags into each other.
- [ ] Phase 2: Documentary / Newsroom env flags on + a styled request: neither lane runs.
- [ ] Phase 2: kinetic with no RVM: completes front-only, with `styleWarnings` and `degraded` set; never fails.
- [ ] Phase 2: explainer layouts are visibly mounted in a real Remotion render (not only planned).
- [ ] Job status (`GET /v1/edits/:id`) shows `style` and `degraded`; the durable store round-trips them (whole-job JSON column).

## 7. Open questions for the engine (Phase 2)

1. **Kinetic-Led QA state.** `POLISH_KINETIC_LED` is default off and labelled experimental; `KINETIC_LED_CONFIG.enabled` is
   `false`. The style bible it cites (`remotion/out/phase36-readiness/KINETIC_LED_STYLE_BIBLE.md`) is not in the repo or the local
   checkout. Is it QA-paused, and what is the bar for shipping it as a product style?
2. **Explainer render mount.** The `POLISH_EXPLAINER_SKILL` comment says WP40 is "planning + warnings only; layouts not yet mounted in
   the production render (WP41 …)", but `analyzeVideo.ts` builds an `explainerMount` layout track. Confirm with a real render.
3. **RVM in production.** Is the RVM venv and weights provisioned on the droplet? Without it Kinetic is always front-only.
4. **Clean Cut profile pinning.** Confirm that `ai_clean_cut` should be `cuts` even if `PRODUCT_EDIT_PROFILE` changes.
5. **Cost.** Polish styles run about 5–7 Gemini calls plus longer renders. Set `GEMINI_EDIT_MAX_REQUESTS` before exposing them.
6. **`captionkit_tmp/` is untracked** but the Basic Captions path and the Dockerfile need it (`docs/DEPLOY_ENGINE.md`). Commit
   `captionkit.py`, `presets.json` and `fonts/`.
