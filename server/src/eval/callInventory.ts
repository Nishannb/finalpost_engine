/**
 * Inventory of every place the server can make an outbound request, and which of those can be model-backed.
 * Offline documentation-as-data: built from reading the code and from fetch-level counting tests (callInventory.test.ts). No
 * request is made to build or check it. A guard test fails if a source file gains a network call that is not listed here.
 *
 * "HTTP attempts" counts requests that actually leave the process, including retries INSIDE `requestWithRetry` (which a
 * `requestJson` mock would hide) and the model-fallback loops in callDirectorModel / planVisualDirection.
 * Run-level totals are NOT given as one number: several stages scale with the content (moments, candidate assets, graphics) or are
 * only reached under conditions that depend on model output.
 */

export type Provider = 'gemini' | 'groq' | 'anthropic' | 'openrouter' | 'stock' | 'internal';
export type Countability =
  | 'counted_by_test'              // a fetch-level test in callInventory.test.ts reproduces the stated attempts
  | 'counted_by_code_reading'      // bounded by constants visible in the code, not reproduced by a test
  | 'content_dependent'            // the number of logical calls scales with the video / model output
  | 'sdk_internal';                // retries happen inside a vendor SDK whose behaviour is read from its source, not tested

export type CallSite = {
  id: string;
  /** Path relative to server/src. */
  file: string;
  provider: Provider;
  modelBacked: boolean;
  /** When this runs, in words. */
  trigger: string;
  /** Flags / inputs that switch it on or off. */
  flags: string[];
  /** Logical model calls each time the trigger holds. */
  logicalCalls: string;
  /** HTTP attempts per logical call under the DEFAULT configuration (GEMINI_MODEL = gemini-3.6-flash). null = not bounded by a constant. */
  maxHttpAttemptsPerLogicalCall: number | null;
  /** Why that bound, and what changes it. */
  attemptsBasis: string;
  /** Repair, retry or model-fallback loops that add requests beyond the logical call. */
  extraRequestPaths: string;
  /** Behaviour when the call is unavailable or fails. */
  fallback: string;
  consumes: string;
  produces: string;
  countability: Countability;
};

const GEMINI_FALLBACK_NOTE = 'callDirectorModel tries [GEMINI_MODEL, gemini-3.6-flash, gemini-3.7-flash] de-duplicated (2 models by default, 3 for any other GEMINI_MODEL), each with retries:1 (2 attempts on a 5xx or network error). The FIRST timeout switches every remaining attempt to no-extended-thinking, so a timeout costs one extra request on the first model only. Measured by fetch-level tests: all-5xx 4 (3 models: 6); all-timeouts 3 (3 models: 4); worst case timeout-then-5xx 5 (3 models: 7); an empty reply 2 (3 models: 3).';

export const CALL_INVENTORY: CallSite[] = [
  {
    id: 'asr_groq', file: 'stages/transcribe/groqTranscribe.ts', provider: 'groq', modelBacked: true,
    trigger: 'Start of every analyzeVideo run (speech-to-text of the extracted audio).', flags: ['GROQ_API_KEY'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 2, attemptsBasis: 'requestJson retries:1 => at most 2 attempts',
    extraRequestPaths: 'none in this stage', fallback: 'None: a missing key or a failed call fails the job (not_configured / upstream error).',
    consumes: 'extracted speech audio', produces: 'words, transcript, detected language', countability: 'counted_by_code_reading',
  },
  {
    id: 'cuts_ai_keep_plan', file: 'stages/filters/cutsAiKeepPlan.ts', provider: 'gemini', modelBacked: true,
    trigger: 'editProfile=cuts or polish with CUTS_AI_KEEP_PLAN on (default) and GEMINI_API_KEY set: one text-only call per analyze job. No audio, no video, no visual model.', flags: ['CUTS_AI_KEEP_PLAN', 'cuts or polish profile', 'GEMINI_API_KEY'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 2, attemptsBasis: 'requestJson retries:1, no model-fallback loop',
    extraRequestPaths: 'none (the helper catches every failure and returns no plan)', fallback: 'Deterministic transcript-retake path (WP7G) and a cuts_ai_keep_plan_skipped:<reason> warning.',
    consumes: 'numbered transcript segments with source seconds', produces: 'keep ranges (source seconds) that become trim exclusions after guards', countability: 'counted_by_code_reading',
  },
  {
    id: 'romanize_captions', file: 'stages/broll/romanizeCaptions.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Only when the transcript needs romanization or Hinglish recovery (needsRomanization / needsHinglishRecovery); skipped for ordinary English.', flags: ['GEMINI_API_KEY', 'language of the video'],
    logicalCalls: '0, 1 or 2 (Hinglish recovery, then a romanization map of up to 220 unique tokens)', maxHttpAttemptsPerLogicalCall: 2, attemptsBasis: 'requestJson retries:1 on each',
    extraRequestPaths: 'a second call (the map) can follow a recovery whose token count does not match', fallback: 'ASCII-fold of the caption words (deterministic).',
    consumes: 'caption words, transcript, language', produces: 'caption word texts', countability: 'counted_by_code_reading',
  },
  {
    id: 'content_profile', file: 'stages/contentProfile/contentProfile.ts', provider: 'gemini', modelBacked: true,
    trigger: 'CONTENT_PROFILE_ENABLED and (visual edits on or motion graphics on), with a non-empty transcript.', flags: ['CONTENT_PROFILE_ENABLED', 'visual edits', 'MOTION_GRAPHICS_ENABLED', 'GEMINI_API_KEY'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'model fallback and timeout retry inside callDirectorModel', fallback: 'Returns null; callers behave as if no profile existed.',
    consumes: 'transcript, duration, language', produces: 'content profile (density, policy, caps)', countability: 'counted_by_test',
  },
  {
    id: 'delivery_director', file: 'stages/audio/deliveryPlanner.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Delivery shaping allowed and (explicitly requested or DELIVERY_SHAPING_AUTO) and (explicit or mean monotony >= 0.62); directDeliveryShaping additionally needs Director v2.', flags: ['DELIVERY_SHAPING_AUTO', 'DIRECTOR_V2', 'explicit delivery request'],
    logicalCalls: 'up to 2 (a 2-attempt loop, each a full callDirectorModel call) in directDeliveryShaping, plus 1 emphasis-marker call (llmEmphasisMarks) when planDeliveryShaping is given useLlmEmphasis', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'attempt loop (2) multiplies the model-fallback paths', fallback: 'Deterministic acoustic planning without the model decision.',
    consumes: 'timestamped words, acoustic sentence features, loudness', produces: 'delivery shaping decision / emphasis marks', countability: 'counted_by_code_reading',
  },
  {
    id: 'user_asset_describe', file: 'stages/broll/userBrollDescribe.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Once per distinct user B-roll URL (at most MAX_USER_BROLL = 12), on the non-BROLL-disabled path.', flags: ['userBrollUrls input', 'GEMINI_API_KEY'],
    logicalCalls: '1 per user asset (vision)', maxHttpAttemptsPerLogicalCall: 2, attemptsBasis: 'requestJson retries:1',
    extraRequestPaths: 'none', fallback: 'The asset is skipped (warning user_broll_describe_failed when none described).',
    consumes: 'frames of each user asset', produces: 'asset descriptions used for matching', countability: 'content_dependent',
  },
  {
    id: 'occupancy_primary', file: 'stages/layout/occupancy.ts', provider: 'gemini', modelBacked: true,
    trigger: 'analyzeVideo, BROLL path: one frame near 28% of the clip (measureOccupancy -> detectSpeakerFromStill).', flags: ['GEMINI_API_KEY', 'BROLL enabled'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 2, attemptsBasis: 'requestJson retries:1',
    extraRequestPaths: 'none', fallback: 'A conservative DEFAULT speaker box with source "fallback" (this is what makes live occupancy non-reproducible).',
    consumes: 'one decoded still', produces: 'primary speaker box (vision | fallback)', countability: 'counted_by_test',
  },
  {
    id: 'occupancy_slices', file: 'stages/directorV2/perception.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Director v2 perception pack: extra occupancy frames. Default path with a placed primary: 2; without one: 3. VISUAL_CONTEXT_V2: 2, plus 1 if the primary is not placed.', flags: ['DIRECTOR_V2 or NORTH_STAR', 'VISUAL_CONTEXT_V2'],
    logicalCalls: '2 or 3 per v2 run (same detector as occupancy_primary, via measureOccupancyAt)', maxHttpAttemptsPerLogicalCall: 2, attemptsBasis: 'requestJson retries:1 per detection',
    extraRequestPaths: 'none', fallback: 'Default speaker box with source "fallback" per failed frame.',
    consumes: 'decoded stills at mapped source times', produces: 'occupancyMeasured / dense occupancySlices', countability: 'counted_by_test',
  },
  {
    id: 'v1_director', file: 'stages/broll/geminiDirector.ts', provider: 'gemini', modelBacked: true,
    trigger: 'planBRoll on the v1 path (not DIRECTOR_V2 / NORTH_STAR) when a Director is configured.', flags: ['GEMINI_API_KEY', 'DIRECTOR_V2', 'NORTH_STAR'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 4,
    attemptsBasis: 'planVisualDirection loops models [GEMINI_MODEL, gemini-3.6-flash, gemini-3.7-flash] de-duplicated; callGemini uses retries:1. Default config: 2 models x 2 attempts = 4. A non-default GEMINI_MODEL: 3 x 2 = 6. (No timeout-specific retry here, unlike callDirectorModel.)',
    extraRequestPaths: 'an unparsable reply moves to the next model without retrying the first. HOOK_TITLE_POLICY=optional adds a path: a parseable reply with no moments AND no title is rejected as an "empty brief" and the next model is tried (under the default placeholder policy the title is never empty, so that guard cannot fire).', fallback: 'fallbackVisualDirection (deterministic, transcript-derived).',
    consumes: 'transcript, occupancy block, requested edits, content-profile and visual-context blocks', produces: 'hook title/style, moments, zooms, captions, overlays', countability: 'counted_by_test',
  },
  {
    id: 'v2_story_analyst', file: 'stages/directorV2/storyAnalyst.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Director v2: one story-analysis call; a second repair call only if beat coverage fails validation.', flags: ['DIRECTOR_V2 or NORTH_STAR'],
    logicalCalls: '1, or 2 when the first reply fails beat-coverage validation', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'repair call (+1 logical call)', fallback: 'sentenceBeats(pack) after a failed repair (deterministic); a thrown call fails v2 and the planner falls back to the v1/fallback direction.',
    consumes: 'perception pack (transcript, frames, occupancy)', produces: 'story analysis (beats)', countability: 'counted_by_code_reading',
  },
  {
    id: 'v2_creative_director', file: 'stages/directorV2/creativeDirector.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Director v2: one creative-design call.', flags: ['DIRECTOR_V2 or NORTH_STAR'],
    logicalCalls: '1', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'see v2_repair', fallback: 'None inside the stage; failure drops to the v1/fallback direction.',
    consumes: 'perception pack, story analysis', produces: 'creative plan (elements)', countability: 'counted_by_code_reading',
  },
  {
    id: 'v2_repair', file: 'stages/directorV2/compiler.ts', provider: 'gemini', modelBacked: true,
    trigger: 'compileCreativePlan: the assembler refused at least one element, repair is not disabled, and a story exists. Exactly one repair pass (passes <= 2).', flags: ['noRepair option'],
    logicalCalls: '0 or 1 per compile (repairEdit)', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'none (no loop; verified in compiler.ts)', fallback: 'The refusals stand and the elements are dropped (never filled back).',
    consumes: 'previous plan, refusals', produces: 'repaired creative plan', countability: 'counted_by_code_reading',
  },
  {
    id: 'northstar_semantic_gate', file: 'stages/northStar/semanticAssetGate.ts', provider: 'gemini', modelBacked: true,
    trigger: 'NORTH_STAR stock selection: once per stock query that returns candidates, until one asset is accepted.', flags: ['NORTH_STAR'],
    logicalCalls: 'one per query tried, per B-roll moment (no constant bound)', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'a rejected candidate set moves to the next query, which calls again', fallback: 'First candidate is used (deterministic).',
    consumes: 'up to 4 candidate frames, spoken beat, intent', produces: 'chosen stock asset', countability: 'content_dependent',
  },
  {
    id: 'northstar_proxy_critic', file: 'stages/northStar/proxyCritic.ts', provider: 'gemini', modelBacked: true,
    trigger: 'NORTH_STAR: one composite critique of the finished plan.', flags: ['NORTH_STAR'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'the critique runs once; its patches are suggestions only', fallback: 'No critique (warning only).',
    consumes: 'source frames, planned elements', produces: 'notes (never applied)', countability: 'counted_by_code_reading',
  },
  {
    id: 'layout_vision_critique', file: 'stages/layout/layoutCritique.ts', provider: 'gemini', modelBacked: true,
    trigger: 'analyzeVideo, BROLL path, after the geometric pass, when GEMINI_API_KEY is set.', flags: ['GEMINI_API_KEY', 'BROLL enabled'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 1, attemptsBasis: 'requestJson retries:0',
    extraRequestPaths: 'none', fallback: 'Geometric-only layout (source "geometric").',
    consumes: 'one still + layout summary (no hook_anchor when the hook is absent)', produces: 'anchor / container patches', countability: 'counted_by_test',
  },
  {
    id: 'motion_director', file: 'stages/motionDirector/motionDirector.ts', provider: 'gemini', modelBacked: true,
    trigger: 'MOTION_GRAPHICS_ENABLED (or generatedGraphicsEnabled input): briefs over the finished edit.', flags: ['MOTION_GRAPHICS_ENABLED'],
    logicalCalls: '1 per run', maxHttpAttemptsPerLogicalCall: 5, attemptsBasis: GEMINI_FALLBACK_NOTE,
    extraRequestPaths: 'none', fallback: 'No generated graphics.',
    consumes: 'transcript, words, existing edit occupancy', produces: 'graphic briefs (capped by duration and content profile)', countability: 'counted_by_code_reading',
  },
  {
    id: 'motion_worker_claude', file: 'motionWorker/worker.ts', provider: 'anthropic', modelBacked: true,
    trigger: 'One graphic per Director brief; each runs generate -> validate -> up to MAX_REPAIR_ATTEMPTS repairs. Graphics per run <= min(6, one per ~8 s, content-profile cap); 3 run concurrently.', flags: ['MOTION_GRAPHICS_ENABLED', 'ANTHROPIC credentials', 'MOTION_WORKER_MODEL'],
    logicalCalls: '1 to 3 per graphic (1 + MAX_REPAIR_ATTEMPTS = 3); a refusal stops at 1', maxHttpAttemptsPerLogicalCall: 3,
    attemptsBasis: 'The Anthropic SDK client is created with default maxRetries = 2 (read from the installed SDK), so each logical call can make up to 3 HTTP attempts. Not tested: it happens inside the vendor SDK.',
    extraRequestPaths: 'repair loop (counted by test with an injected generator); SDK retries (not testable here)', fallback: 'The graphic is dropped (MotionWorkerError); the rest of the edit is unaffected.',
    consumes: 'brief, system prompt, previous source + validation report on repairs', produces: 'validated graphic module', countability: 'sdk_internal',
  },
  {
    id: 'stock_search', file: 'stages/broll/pexelsClient.ts', provider: 'stock', modelBacked: false,
    trigger: 'Every stock B-roll / photo query (Pexels, then Pixabay).', flags: ['PEXELS / PIXABAY keys'],
    logicalCalls: 'one per query (content-dependent)', maxHttpAttemptsPerLogicalCall: 3, attemptsBasis: 'requestJson retries:2',
    extraRequestPaths: 'second provider and further queries on a miss', fallback: 'No asset.',
    consumes: 'search keyword', produces: 'candidate stock assets', countability: 'content_dependent',
  },
  {
    id: 'stock_search_pixabay', file: 'stages/broll/pixabayClient.ts', provider: 'stock', modelBacked: false,
    trigger: 'Fallback provider for stock queries.', flags: ['PIXABAY key'],
    logicalCalls: 'one per query (content-dependent)', maxHttpAttemptsPerLogicalCall: 3, attemptsBasis: 'requestJson retries:2',
    extraRequestPaths: 'none', fallback: 'No asset.', consumes: 'search keyword', produces: 'candidate stock assets', countability: 'content_dependent',
  },
  {
    id: 'job_notify_and_auth', file: 'http/notifyCreator.ts', provider: 'internal', modelBacked: false,
    trigger: 'Job lifecycle webhooks and auth checks.', flags: [], logicalCalls: 'per job event', maxHttpAttemptsPerLogicalCall: null,
    attemptsBasis: 'plain fetch; not model-backed', extraRequestPaths: 'none', fallback: 'Logged.', consumes: 'job state', produces: 'notification', countability: 'content_dependent',
  },
  {
    id: 'auth', file: 'http/auth.ts', provider: 'internal', modelBacked: false,
    trigger: 'Request authentication.', flags: [], logicalCalls: 'per request', maxHttpAttemptsPerLogicalCall: null,
    attemptsBasis: 'not model-backed', extraRequestPaths: 'none', fallback: 'Reject.', consumes: 'credentials', produces: 'decision', countability: 'content_dependent',
  },
  {
    id: 'temp_files', file: 'lib/tempFiles.ts', provider: 'internal', modelBacked: false,
    trigger: 'downloadToFile: source video, user assets and render prefetch (stages/render/prefetchAssets.ts) download to a temporary file.', flags: [], logicalCalls: 'per download', maxHttpAttemptsPerLogicalCall: null,
    attemptsBasis: 'not model-backed', extraRequestPaths: 'none', fallback: 'Error.', consumes: 'URL', produces: 'local file', countability: 'content_dependent',
  },
  // Separate product flows that are NOT part of an edit run (template extraction / design); listed so the inventory is complete.
  {
    id: 'template_style_extract', file: 'stages/templates/extractStyle.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Template-style extraction endpoint (not analyzeVideo).', flags: ['template extraction request'], logicalCalls: '1 per extraction (+ ASR via Groq)', maxHttpAttemptsPerLogicalCall: 2,
    attemptsBasis: 'requestJson retries:1', extraRequestPaths: 'none', fallback: 'Error to the caller.', consumes: 'reference video frames and audio', produces: 'style template', countability: 'counted_by_code_reading',
  },
  {
    id: 'template_caption_style_extract', file: 'stages/templates/extractCaptionStyle.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Caption-style extraction endpoint (not analyzeVideo).', flags: ['template extraction request'], logicalCalls: '1 per extraction (+ ASR via Groq)', maxHttpAttemptsPerLogicalCall: 2,
    attemptsBasis: 'requestJson retries:1', extraRequestPaths: 'none', fallback: 'Error to the caller.', consumes: 'reference frames', produces: 'caption style', countability: 'counted_by_code_reading',
  },
  {
    id: 'template_designer', file: 'stages/templateDesigner/designer.ts', provider: 'gemini', modelBacked: true,
    trigger: 'Template design endpoint (not analyzeVideo).', flags: ['template design request'], logicalCalls: '1 per design', maxHttpAttemptsPerLogicalCall: 2,
    attemptsBasis: 'requestJson retries:1', extraRequestPaths: 'none', fallback: 'Error to the caller.', consumes: 'template brief', produces: 'template design', countability: 'counted_by_code_reading',
  },
  {
    id: 'seedance_edit', file: 'stages/templates/seedanceEdit.ts', provider: 'openrouter', modelBacked: true,
    trigger: 'Seedance video-edit endpoint (not analyzeVideo): submit, poll, download.', flags: ['seedance request'], logicalCalls: '1 submit + repeated polls + 1 download', maxHttpAttemptsPerLogicalCall: null,
    attemptsBasis: 'submit retries:1 (images: 0), poll retries:1 per poll; the number of polls is not bounded by a constant', extraRequestPaths: 'polling loop', fallback: 'Error to the caller.', consumes: 'video + prompt', produces: 'edited video', countability: 'content_dependent',
  },
  {
    id: 'motion_worker_script', file: 'scripts/mgE2E.ts', provider: 'anthropic', modelBacked: true,
    trigger: 'Developer scripts only (mgE2E / mgRepairDemo / mgWorker); never reached by a job.', flags: ['manual script'], logicalCalls: 'per script run', maxHttpAttemptsPerLogicalCall: null,
    attemptsBasis: 'manual', extraRequestPaths: 'none', fallback: 'n/a', consumes: 'fixtures', produces: 'demo output', countability: 'content_dependent',
  },
];

/** Files that make outbound requests but are not worth a row of their own because they are covered by another entry or are transport. */
export const TRANSPORT_AND_COVERED_FILES = [
  'lib/http.ts',                         // the transport itself (requestWithRetry / requestJson)
  'stages/directorV2/geminiClient.ts',   // callDirectorModel: counted by test, used by the v2 / profile / motion / delivery entries
  'storage/r2.ts',                       // object storage via SDK, not matched by the patterns below
  'lib/spendGuard.ts',                   // opt-in experiment wrapper around fetch: forwards or refuses, never originates a request
];

export const modelBackedEntries = () => CALL_INVENTORY.filter(entry => entry.modelBacked);
