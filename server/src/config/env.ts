/**
 * Typed environment for the video engine.
 *
 * Parsed once at import time so a misconfigured deploy fails at boot instead of
 * halfway through a paid pipeline run. Stage-specific credentials are optional
 * here — each stage reports `not_configured` so the app can degrade gracefully.
 */

import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import dotenv from 'dotenv';
import {z} from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [
  // Reuse shared infrastructure credentials (R2, local AI keys) from the
  // existing Kinmel server during development. The engine's own .env is loaded
  // last and therefore remains the explicit override.
  path.resolve(here, '../../../../server/.env'),
  path.resolve(here, '../../../.env'),
  path.resolve(here, '../../.env'),
]) {
  if (existsSync(candidate)) {
    dotenv.config({path: candidate, quiet: true, override: true});
  }
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform(raw => {
      if (raw === undefined || raw.trim() === '') {
        return fallback;
      }
      return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
    });

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform(raw => {
      const parsed = Number(raw);
      return raw === undefined || raw.trim() === '' || !Number.isFinite(parsed)
        ? fallback
        : parsed;
    });

const str = (fallback = '') =>
  z
    .string()
    .optional()
    .transform(raw => (raw ?? fallback).trim());

const schema = z.object({
  NODE_ENV: str('development'),
  PORT: num(8090),
  LOG_LEVEL: str('info'),

  ENGINE_API_KEY: str(),
  /**
   * Creators Flask API origin. Used to ask the API to send a remote push when
   * a captions edit finishes (user may have left the app).
   * Example: https://api.kinmel.shop
   */
  CREATOR_API_URL: str(),
  /** Pro features (full edit and the other paid pipelines) require a server-verified Pro / Pro Plus plan. Set to 0 only for local development. */
  ENTITLEMENT_ENFORCEMENT: bool(true),
  /**
   * Edit-style picker (lib/editStyles.ts). Kill switch, default OFF: the `style` field of POST /v1/edits/captions is ignored and
   * GET /v1/edit-styles answers 404, so the app falls back to its bundled manifest and the old mode-only request. 1 = styles on.
   */
  EDIT_STYLES_ENABLED: bool(false),
  /** Comma list of style ids that may be started (e.g. `basic_captions,ai_clean_cut,kinetic_typography`). Empty = the registry defaults. */
  EDIT_STYLES_AVAILABLE: str(),
  /** Comma list of style ids in display order. Empty = the registry order. */
  EDIT_STYLES_ORDER: str(),
  /**
   * Phase 2 engine kill switch, default OFF: styled jobs run exactly as in Phase 1 (their mode on PRODUCT_EDIT_PROFILE; Kinetic / Explainer as AI Clean Cut,
   * marked degraded `engine_flags_off`). 1 = each style resolves its own per-job flags and Gemini cap (lib/styleRun.ts). Requests with no style are unaffected either way.
   */
  EDIT_STYLES_ENGINE_FLAGS: bool(false),
  /**
   * Creators Supabase project URL — required in production for ES256/RS256
   * access tokens (JWKS at `/auth/v1/.well-known/jwks.json`).
   * Example: https://mmyprzatmrfdtodsqaia.supabase.co
   */
  SUPABASE_URL: str(),
  /**
   * Public anon key — used as Auth API `apikey` for `/auth/v1/user` fallback
   * when JWKS verification fails. Safe to ship (same as the mobile app).
   */
  SUPABASE_ANON_KEY: str(),
  /** Legacy HS256 JWT secret (optional fallback if tokens still use HS256). */
  SUPABASE_JWT_SECRET: str(),
  /** Server-only key for the durable full-edit job table (public.creator_edit_jobs). Never sent to a client. */
  SUPABASE_SERVICE_ROLE_KEY: str(),
  /** Retention: a job with no activity for this long is marked failed ('expired'). */
  EDIT_JOB_INACTIVE_DAYS: num(30),
  /** Retention: finished (done / failed) jobs are deleted this many days after they last changed. */
  EDIT_JOB_TERMINAL_DAYS: num(90),
  DEV_AUTH_BYPASS: bool(true),

  R2_ACCOUNT_ID: str(),
  R2_ACCESS_KEY_ID: str(),
  R2_SECRET_ACCESS_KEY: str(),
  R2_BUCKET_NAME: str(),
  R2_PUBLIC_BASE_URL: str(),
  /**
   * Public base URL of THIS engine (phone uses it to download local-fallback
   * renders when R2 upload fails). Example: http://192.168.1.35:8090
   */
  ENGINE_PUBLIC_BASE_URL: str(),

  GROQ_API_KEY: str(),
  GROQ_MODEL: str('whisper-large-v3-turbo'),
  GROQ_MAX_UPLOAD_MB: num(24),
  FFMPEG_PATH: str('ffmpeg'),
  FFPROBE_PATH: str('ffprobe'),

  SILENCE_THRESHOLD_SEC: num(0.4),
  SILENCE_PADDING_SEC: num(0.08),
  /** Local energy VAD refines ASR word bounds and gates silence cuts. Off = legacy ASR-gap cutter. */
  VAD_ENABLED: bool(true),
  /** Local rules/acoustics may select delivery shaping when no CLI allowlist is supplied. */
  DELIVERY_SHAPING_AUTO: bool(true),
  /** Optional transcript-only LLM emphasis marks. Rules + acoustics remain the fallback. */
  DELIVERY_LLM_EMPHASIS: bool(false),
  ZOOM_SCALE: num(1.25),
  ZOOM_MAX_DURATION_SEC: num(6),

  GEMINI_API_KEY: str(),
  GEMINI_MODEL: str('gemini-3.6-flash'),
  /**
   * Medium model for AI Template Designer (reference → EditSpec).
   * Keep this cheaper than any “pro” director model until benchmark says otherwise.
   */
  GEMINI_TEMPLATE_DESIGNER_MODEL: str('gemini-3.6-flash'),
  TEMPLATE_DESIGNER_FRAME_INTERVAL_SEC: num(1),
  TEMPLATE_DESIGNER_MAX_FRAMES: num(24),
  PEXELS_API_KEY: str(),
  PIXABAY_API_KEY: str(),
  /**
   * WP15: KLIPY Partner Panel app key (`{app_key}` in https://api.klipy.com/api/v1/{app_key}/…).
   * Used for contextual GIF/sticker overlays on polish. Server-side bake may need KLIPY written approval (ToS).
   */
  KLIPY_APP_KEY: str(),
  /** WP52: default OFF (test2 live: unrelated stickers over stills). When true and KLIPY_APP_KEY is set, polish edits schedule contextual GIF/sticker overlays. */
  KLIPY_OVERLAYS_ENABLED: bool(false),
  /** Soft cap on KLIPY HTTP searches per analyze job (test keys are ~100/hour). */
  KLIPY_MAX_SEARCHES_PER_EDIT: num(8),
  /**
   * WP27: optional licensed music bed URL for polish edits (HTTPS). Empty = no bed (SFX-only).
   * Ducking under speech is on by default when a URL is set.
   */
  POLISH_MUSIC_BED_URL: str(''),
  /**
   * WP30: when true (default) and a stock library (PEXELS_API_KEY / PIXABAY_API_KEY) is configured, polish fills an open the labeled assets left bare with an editorial ImageRun of stock photos
   * (still_push_in / card_tilt_in / orbit_drift). Set 0 to keep polish stock-free.
   */
  POLISH_EDITORIAL_STILLS_ENABLED: bool(true),
  /**
   * WP31: when true (default) the polish profile never ships glossy-pill karaoke: plate-style caption templates (moving-pill, box, grape, ...) are replaced by the bare `karaoke` type and the
   * look's stroke + soft-shadow type contract is applied on every polish edit (not only explain edits without creator B-roll). Set 0 to restore the old polish caption behaviour. Other profiles are unaffected.
   */
  POLISH_BARE_CAPTIONS: bool(true),
  /**
   * WP33: when true (default) the polish profile plans the Metromedia VO cut grammar from the transcript (1-3 word caption groups -> cut times, ~0.85 s mean shot, holds only on money / CTA, a chapter card every
   * 15-25 s), feeds the cut times to the transition density as preferred anchors, biases the transition picker to hard cuts (~85 %), and asks the library seed for the chapter cards. Set 0 to restore the old
   * polish pacing. Other profiles are unaffected.
   */
  POLISH_VO_CUT_GRAMMAR: bool(true),
  /**
   * WP34: when true (default) the polish profile draws captions in the Metromedia ACCUMULATE grammar (word_by_word_accumulate): words build up in spoken order with a 4-frame blur-fade, the line hard-clears on
   * the cut that starts the next group (the WP33 cut plan is the clock), <= 4 words, ~7 % of the frame height, centred at y 46 %, sentence case, white, soft shadow, no pill. Needs POLISH_VO_CUT_GRAMMAR (the cuts);
   * never over a CaptionKit preset, a designed caption style guide or a caller-named template. Set 0 to keep the WP31/32 bare karaoke captions. Other profiles are unaffected.
   */
  POLISH_ACCUMULATE_CAPTIONS: bool(true),
  /**
   * WP35: the Metromedia IMPACT FX on polish edits: an overexpose flash (1-2 frames) on the hook word / a major reveal, a saturation glow pop (2-4 frames) on a name reveal, a 1.10 punch-in over 7 frames on money
   * holds, and a hard black-and-white flip on emotional / past shots (~15 % of the runtime). Needs POLISH_VO_CUT_GRAMMAR (the cuts / holds are the clock). Set 0 to draw none. Other profiles are unaffected.
   */
  POLISH_IMPACT_FX: bool(true),
  /**
   * WP36: the FACELESS DOCUMENTARY lane (Metromedia: no on-camera speaker, ~100 % B-roll). The one explicit switch (default OFF, so talking-head polish is unchanged until it is deliberately unpaused): with it on, polish
   * plans one literal stock still per WP33 cut-plan shot (hard cuts, slow 1.00 -> 1.04 push-in by default, fast 1.08 on money / hook (WP39), ~15 % framed fly-out cards) over the whole runtime instead of the WP30 open / mid montage; the talking head stays under it
   * (never the visible world), chapter cards keep their span, and the WP34 captions + WP35 FX paint over it. Needs POLISH_VO_CUT_GRAMMAR, the motion stage and a stock key (PEXELS_API_KEY / PIXABAY_API_KEY).
   * Warning: polish_pace:faceless_coverage:<pct>. Other profiles are unaffected.
   */
  POLISH_FACELESS_DOC: bool(false),
  /**
   * WP40: Skill B, the EXPLAINER lane (talking head + diagrams: layouts A full speaker / B split b-roll over speaker / C white dot-grid diagram / D dark cutaway; medium pace ~3.5-4 s median, hard cuts). Default OFF.
   * Mutually exclusive with POLISH_FACELESS_DOC: if both are on, FACELESS WINS and the explainer is skipped (warning polish_pace:explainer_skipped:faceless_wins). WP40 is planning + warnings only (polish_pace:explainer_cuts:<n>);
   * the layouts are proved offline (npm run preview:wp40) and are not yet mounted in the production render (WP41 adds chunk-swap captions + lime wipe). Other profiles are unaffected.
   */
  POLISH_EXPLAINER_SKILL: bool(false),
  /**
   * WP44: Skill D, NEWSROOM motion-graphics explainer (B/W + signal red, GFX/CARD/HOST/EXPERT, host ~13%). Default OFF.
   * Mutually exclusive with faceless / explainer (resolvePolishSkill: faceless > newsroom_mg > explainer). Grammar: newsroom-mg-grammar.yaml.
   */
  POLISH_NEWSROOM_MG: bool(false),
  /**
   * WP43: Skill C, TEXTUAL motion graphics (Jitter-class hero/emphasis type plates — elastic snap, trail, scramble, smear, mask reveal, counter — over media). Default OFF.
   * Distinct from Skill A accumulate / Skill B chunk-swap captions. Planner: textualMgPlanner; comps: TextualMgPlate. Mute captions while a plate owns words. Other profiles unaffected.
   */
  POLISH_TEXTUAL_MG: bool(false),
  /**
   * WP45: Layer-2 motion-template toolkit (CLIP_01..04: grid mosaic morph, slit carousel, bento camera wall, stacked card deck). NOT a skill: sparse toolkit moves inside the ACTIVE polish skill, gated by that skill's
   * template allowlist (motionTemplateCatalog). Opaque full-bleed, silent (no SFX), mutes captions while on screen. Default OFF (0 = nothing runs).
   */
  POLISH_MOTION_TEMPLATES: bool(false),
  /**
   * WP57: Kinetic-Led experimental edit. Typography is the spine (~1 beat / 3.5s, style bible).
   * Default OFF — existing polish is unchanged. Requires the motion-template / craft path (POLISH_MOTION_TEMPLATES).
   */
  POLISH_KINETIC_LED: bool(false),
  /**
   * SUBJECT STAGE edit style (style_id subject_stage): the RVM speaker is a fixed identity layer and all editing happens on stages BEHIND her (full plate / opaque card / ghost scroll / neutral accents) or, once,
   * in FRONT of her (S5). Default OFF — existing polish is unchanged. Only on PRODUCT_EDIT_PROFILE=polish with the motion-graphics path, like POLISH_KINETIC_LED. Needs a usable RVM matte over the whole run
   * (mps / cuda, or CPU for <= 45 s of video); without one the style stays off (fail closed). When on it wins over POLISH_KINETIC_LED and is disabled under the faceless / explainer / newsroom skills.
   * Phase 2 only adds the flag, the blueprint contract and the Remotion shells; analyze does not read it yet.
   */
  POLISH_SUBJECT_STAGE: bool(false),
  /**
   * Robust Video Matting (RVM) is the ONLY person matte (MediaPipe is retired). It serves (1) the explicit transparent talking-head job (POST /v1/matting/jobs) and (2) the person matte behind
   * KINETIC_TYPE_STORYTELLING environmental typography (text BEHIND the presenter) in analyze, which needs POLISH_MOTION_TEMPLATES. A chroma-key cutout stays the fast path when the backdrop is keyable.
   * RVM_PYTHON empty = use subjectmatte/.venv-rvm/bin/python when it exists (else the matte reports not_configured and analyze keeps the headroom layout). RVM_DEVICE: auto | cuda | mps | cpu (passed to the python process).
   * Production needs the RVM venv + weights provisioned on the host (the Docker image does not ship them).
   */
  RVM_PYTHON: str(),
  RVM_DEVICE: str('auto'),
  MATTING_MAX_CONCURRENT: num(1),
  MATTING_MAX_DURATION_SEC: num(90),
  MATTING_MAX_DIMENSION: num(1920),
  MATTING_TIMEOUT_SEC: num(900),
  /**
   * Analyze-side person matte (kinetic subject path, media/personMatte.ts). The matte covers ONLY the planned hero windows and is cached by source + ranges under PERSON_MATTE_CACHE_DIR (default <tmp>/finalpost-subject-matte,
   * evicted oldest-first above PERSON_MATTE_CACHE_MAX_MB). It waits up to PERSON_MATTE_MAX_WAIT_SEC for the shared RVM slot, then skips with reason `busy` (analyze never hangs behind a matting job).
   * PERSON_MATTE_MAX_SIDE caps the longest side of the matte frames (aspect kept; 0 = source size): the person layer is drawn over the footage, so a low cap shows as a soft person. PERSON_MATTE_QUALITY: fast | high.
   */
  PERSON_MATTE_CACHE_DIR: str(),
  PERSON_MATTE_CACHE_MAX_MB: num(1024),
  PERSON_MATTE_MAX_WAIT_SEC: num(120),
  PERSON_MATTE_MAX_SIDE: num(1280),
  PERSON_MATTE_QUALITY: str('high'),
  /**
   * WP53: visual backends INSIDE the existing toolkits (never new edit-toolkit ids / L1 skills). Each flag defaults OFF = analyze identical to before.
   * POLISH_RISO_TEMPLATES: clip_27..32 (eian-riso-broll chrome render; native fallback when unavailable). POLISH_COLLAGE_BROLL: clip_33 (gbro i2v; deferred spec only in analyze, no Gemini call).
   * POLISH_ANIDOODLE: clip_34 (needs ANIDOODLE_ENGINE_ROOT, else skipped). Roots: absolute paths, empty = vendor/<name> (anidoodle has no vendor fallback).
   * GEMINI_API_KEY is needed only when a collage job really renders (COLLAGE_RENDER=1); analyze never requires it.
   */
  POLISH_RISO_TEMPLATES: bool(false),
  POLISH_COLLAGE_BROLL: bool(false),
  POLISH_ANIDOODLE: bool(false),
  EIAN_RISO_ROOT: str(''),
  ANIDOODLE_ENGINE_ROOT: str(''),
  COLLAGE_BROLL_ROOT: str(''),
  /**
   * WP38: CLASSIC talking-head polish (neither POLISH_FACELESS_DOC nor POLISH_EXPLAINER_SKILL on) composes the Skill A tools around the face: the WP33 cut plan + WP34 accumulate captions + WP35 impact FX (each keeps its own flag)
   * and the WP30 / WP37 editorial stills. This switch ONLY (a) moves the accumulate line to the face-safe band (y ~58 % instead of 46 %) and (b) tightens the still caps so the face stays on screen >= 70 % of the runtime
   * (<= 1 open run + <= 2 mid runs, 3-4 stills each, <= 25 % of the runtime), plus the `polish_th_skill_a:*` summary warnings. Default ON. 0 = the pre-WP38 polish exactly. Never turns faceless 100 % or the explainer on.
   */
  POLISH_TH_SKILL_A_TOOLS: bool(true),
  /** OpenRouter key — template apply uses Seedance 2.0 Mini video generation. */
  OPENROUTER_API_KEY: str(),
  OPENROUTER_SEEDANCE_MODEL: str('bytedance/seedance-2.0-mini'),
  BROLL_MOMENT_COUNT: num(5),
  BROLL_CLIP_DURATION_SEC: num(3.4),
  BROLL_ENABLED: bool(true),
  /** Draw the engine's/Director's asset-less transitions as a generated light sweep. Off: they are planned but not drawn (legacy). */
  GENERATED_TRANSITIONS_ENABLED: bool(false),
  /**
   * Visual context (experimental, off): sample frames across the whole timeline from the correct source time, tell the
   * Director which spans it did not see, and only accept a zoom `focus` backed by an observation. Changes what the
   * existing v2 calls are sent (more spread frames + a coverage note), so it stays off until reviewed.
   */
  VISUAL_CONTEXT_V2: bool(false),
  /**
   * lean (default): captions + auto-trim + auto-zoom + hook title.
   * Visual toolkits stay in the repo and turn back on with `--edits=` / `--full-edits`.
   * full: every toolkit available when `--edits` is omitted.
   */
  PIPELINE_MODE: str('lean').transform(raw =>
    raw.trim().toLowerCase() === 'full' ? 'full' : 'lean',
  ),
  /**
   * WP8I: what the polish profile edits when no edits were named (HTTP request or CLI). `lean` (default): captions + zoom + hook title, kinetic text, lockup, card, bubble, emphasis, counter
   * (lib/editToolkits.ts POLISH_LEAN_EDITS: no stock B-roll search). `all`: every toolkit (creator B-roll stays user-only on polish). Only read on the polish profile.
   */
  POLISH_DEFAULT_EDITS: str('lean').transform(raw => (raw.trim().toLowerCase() === 'all' ? 'all' : 'lean')),
  HOOK_DURATION_SEC: num(3),
  /**
   * What a missing hook title means. `placeholder` (default, today's behaviour): the v1 parser substitutes "WATCH THIS".
   * `optional`: no title means NO hook-title element — nothing is substituted, derived from the transcript, or recorded as rendered.
   */
  HOOK_TITLE_POLICY: str('placeholder').transform(raw => (raw.trim().toLowerCase() === 'optional' ? 'optional' : 'placeholder') as 'placeholder' | 'optional'),
  /**
   * Occupancy context contract (experimental, off). On: the occupancy text given to the Director separates detected
   * measurements, estimated geometry, default boxes and unobserved time, and never tells it to assume visibility.
   * Off: the existing text, unchanged.
   */
  OCCUPANCY_CONTEXT_V2: bool(false),
  /**
   * How resolved cutaways are scheduled against each other and against their asset's length.
   * `legacy` (default, today's behaviour): a cutaway that starts within 1.5 s of the previous one is dropped; a cutaway's length is the
   * speech window whatever the asset's length is (a shorter asset loops, a longer one is cut off).
   * `beat_preserving`: see stages/broll/cutawaySchedule.ts. A close cutaway is delayed (not dropped) when it still fits, a clip never plays
   * past its asset's last frame, and a slightly longer asset may finish; every adjustment is recorded. Off by default because the frozen
   * planner goldens encode the legacy drops; turning it on by default is a decision for the owner.
   */
  CUTAWAY_SCHEDULING: str('legacy').transform(raw => (raw.trim().toLowerCase() === 'beat_preserving' ? 'beat_preserving' : 'legacy') as 'legacy' | 'beat_preserving'),
  /** Force a speaker-over-B-roll cutout so the feature can be tested. */
  FORCE_SPEAKER_CUTOUT: bool(false),
  /** Free multi-stage director (perception + story + creative + compiler). */
  DIRECTOR_V2: bool(false),
  /**
   * Opt-in north-star edit: Director v2 + plate contrast + thesis tokens +
   * stock rerank + proxy critic + SFX. Off by default so the current pipeline
   * is unchanged unless `--north-star` / NORTH_STAR=1 is set.
   */
  NORTH_STAR: bool(false),
  /**
   * Generated motion graphics: Gemini directs briefs over the finished edit and
   * the Claude worker implements them (needs ANTHROPIC_API_KEY). Off by default:
   * with it off, analysis and output are exactly as before.
   */
  MOTION_GRAPHICS_ENABLED: bool(false),
  /**
   * Classify the content (relationship advice, tutorial, sales pitch, …) before
   * planning edits, so the directors and the graphics theme fit the video.
   * One cheap Gemini call; on failure the directors run as before.
   */
  CONTENT_PROFILE_ENABLED: bool(true),

  /**
   * WP1/WP7C: the product editing profile. The default is `cuts` (cuts-first); the exact values `legacy` and `mvp` opt out to the older behaviours; `polish` (WP8A) is an opt-in that runs the cuts speech path THEN the mvp visual editor; any other value resolves to `cuts` and the callers warn. See lib/productEditProfile.ts.
   */
  PRODUCT_EDIT_PROFILE: str('cuts'),
  /** WP7A: background-noise reduction on the talking-head audio, ONLY on the `cuts` and `polish` profiles (stages/audio/noiseFilter.ts). Set false to cut without denoising. */
  CUTS_DENOISE_ENABLED: bool(true),
  /** WP7G: write a replayable JSON dump of the cuts decisions (words, exclusions, counts, caption texts) under remotion/out/cuts-debug. Always on for the `cuts` profile; this forces it for other profiles. */
  CUTS_DEBUG: bool(false),
  /** WP7I: on the `cuts` profile, ONE text-model call (stages/filters/cutsAiKeepPlan.ts) decides which transcript ranges stay. Falls back to the deterministic retake path on any failure. Needs GEMINI_API_KEY; counts toward GEMINI_EDIT_MAX_REQUESTS. No visual model is involved. */
  CUTS_AI_KEEP_PLAN: bool(true),
  /** WP7A: afftdn noise reduction in dB (clamped 4..30). Gentle by default: a strong value makes speech sound watery. */
  CUTS_DENOISE_NR_DB: num(12),
  /** WP7A: high-pass cutoff in Hz for rumble / hum (clamped 40..200). */
  CUTS_DENOISE_HIGHPASS_HZ: num(80),
  /**
   * WP1: hard per-edit bound on estimated Claude spend (USD), enforced by lib/productClaudeBudget.ts. No default value on purpose: a price assumption is a deployment decision.
   * 0/unset: legacy keeps today's unbounded behaviour; under PRODUCT_EDIT_PROFILE=mvp generated graphics are then switched off (fail closed). Negative: graphics off.
   */
  CLAUDE_EDIT_BUDGET_USD: num(0),
  /** WP1: max Claude requests per edit (generation + repairs). 0/unset: derived from the graphics cap x attempts. */
  CLAUDE_EDIT_MAX_REQUESTS: num(0),
  /** WP1: per-call output-token ceiling under the bound (at least 4000; otherwise 12000). */
  CLAUDE_EDIT_MAX_TOKENS: num(0),
  /**
   * WP2: exact hostnames (comma separated) that URL ingest may fetch although they are loopback/private. Default empty = every internal address is refused.
   * Only for a deployment that must fetch from one named internal host; never put a cloud-metadata address here.
   */
  INGEST_ALLOWED_PRIVATE_HOSTS: str(),
  /**
   * WP3C: per-edit cap on Gemini HTTP attempts in one analyze job (Director and its model fallbacks, asset descriptions, content profile, occupancy, motion Director, retries).
   * 0/unset: no cap (today's behaviour). Positive: that many attempts, then no further Gemini request is sent and each stage uses its existing fallback. Negative or NaN: fails
   * closed (no Gemini request at all). Server environment only; no HTTP field can set it. There is deliberately no dollar cap: see lib/geminiEditBudget.ts.
   */
  GEMINI_EDIT_MAX_REQUESTS: num(0),

  REMOTION_AWS_REGION: str('us-east-1'),
  REMOTION_FUNCTION_NAME: str(),
  REMOTION_SERVE_URL: str(),
  REMOTION_COMPOSITION_ID: str('ShortVideo'),
  REMOTION_LAMBDA_MEMORY_MB: num(3009),
  REMOTION_LAMBDA_DISK_MB: num(10240),
  REMOTION_LAMBDA_TIMEOUT_SEC: num(240),
  REMOTION_FRAMES_PER_LAMBDA: num(120),
  REMOTION_S3_OUTPUT_BUCKET: str(),

  MAX_ANALYSES_PER_USER_MONTH: num(250),
  MAX_RENDER_MINUTES_PER_USER_MONTH: num(90),
  MAX_SOURCE_DURATION_SEC: num(300),

  REDIS_URL: str(),
  BLUEPRINT_TTL_SEC: num(604800),
});

export const env = schema.parse(process.env);

export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';

/** Output canvas is fixed 9:16 short-form; fps drives every frame conversion. */
export const OUTPUT_FPS = 30;
export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
