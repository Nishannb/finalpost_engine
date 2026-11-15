/**
 * Edit-style registry: the single source of truth for the "Choose a style" picker.
 *
 * Pure (no env import, no I/O): callers pass configuration in, so the HTTP layer, the edit runner and tests all
 * resolve a style the same way. The app renders from GET /v1/edit-styles (which serializes this registry), so a
 * style can be made available or reordered with a server config change, without an app release.
 *
 * A style decides the job `mode` the existing runner already understands, and (Phase 2) the per-job pipeline flags and Gemini cap
 * (lib/styleRun.ts). Styles that need those flags (`needsEngineFlags`) run as their `degradesTo` style while the engine kill switch
 * EDIT_STYLES_ENGINE_FLAGS is off, and the job records that as `degraded` (docs/ENGINE_STYLE_INTEGRATION.md).
 *
 * Faceless Documentary and Newsroom are deliberately NOT in this registry: they are not exposed in v1.
 */

import type {EffectiveFlags} from './effectiveFlags.ts';

export const EDIT_STYLE_IDS = ['basic_captions', 'ai_clean_cut', 'kinetic_typography', 'explainer'] as const;
/**
 * Phase 5.23: styles a job may request that are NOT in the picker catalog (GET /v1/edit-styles is built from EDIT_STYLE_IDS only, so the app's picker is
 * unchanged). `subject_stage` selects the Subject Stage editing pipeline (lib/editingPipeline.ts). It is unavailable by default: it can only be started
 * when the server lists it in EDIT_STYLES_AVAILABLE.
 */
export const ENGINE_ONLY_STYLE_IDS = ['subject_stage'] as const;
export const REQUESTABLE_STYLE_IDS = [...EDIT_STYLE_IDS, ...ENGINE_ONLY_STYLE_IDS] as const;
export type EditStyleId = (typeof REQUESTABLE_STYLE_IDS)[number];
/**
 * Phase 5.23: request aliases. The engine-level pipeline names may be sent as the `style`: `kinetic_v2` IS the `kinetic_typography` style (one style, one
 * pipeline, one cache key). `subject_stage` is already a style id. Nothing else is aliased.
 */
export const STYLE_ALIASES: Readonly<Record<string, EditStyleId>> = {kinetic_v2: 'kinetic_typography'};
export type EditStyleTier = 'free' | 'pro';
/** The existing `CaptionsEditJob.mode` values a style can run as. */
export type EditStyleJobMode = 'basic_captions' | 'full_edit';

export type EditStyleDefinition = {
  id: EditStyleId;
  name: string;
  description: string;
  tier: EditStyleTier;
  /** Default availability; `EDIT_STYLES_AVAILABLE` (server env) overrides it without a code change. */
  available: boolean;
  sortOrder: number;
  /** Key of the preview video the app bundles (assets/edit-style-previews/<key>.mp4). Swapping the file swaps the preview. */
  previewAsset: string;
  /** The job mode existing consumers (runner, durable store, push routing) see. */
  mode: EditStyleJobMode;
  /** True when the style is produced by per-job pipeline flags (lib/styleRun.ts); with EDIT_STYLES_ENGINE_FLAGS off it runs as `degradesTo`. */
  needsEngineFlags: boolean;
  degradesTo?: EditStyleId;
  /**
   * Hard per-job cap on Gemini HTTP attempts (retries and model fallbacks included). Never uncapped. 0 = no Gemini request at all. When the cap is
   * reached, the stage that asked uses its own fallback and the job continues (`gemini_cap_reached:<stage>`).
   */
  geminiMaxRequests: number;
  /**
   * Whether the style needs a person matte (RVM) to count as honoured. `optional`: without one the style still counts as honoured (front-only
   * Kinetic) and the job records a non-degrading note `matte_unavailable:<why>` in `styleNotes`. `required`: no matte = degraded. Absent = not used.
   */
  matte?: 'optional' | 'required';
  /**
   * Output settings this style fixes whatever the server env says, so a style looks the same on every server (lib/styleRun.ts applies them on top of
   * the env defaults; the style's own essentials, e.g. Kinetic-Led on, win over them). Speech-cut tuning and deployment settings stay on env.
   */
  pins?: Partial<EffectiveFlags>;
  /** Phase 5.23: the editing pipeline this style selects (lib/editingPipeline.ts). Absent = no editing pipeline (the style's own lanes only). */
  pipeline?: 'kinetic_v2' | 'subject_stage';
  /**
   * V1 release mode (env V1_KINETIC_RELEASE): the style must be produced by its own pipeline or the job fails (retryable `kinetic_unavailable`); it never degrades to `degradesTo`.
   * Ignored while the release switch is off, so the Phase 1 / Phase 2 behaviour is exactly what it was.
   */
  failClosed?: boolean;
};

/**
 * Baseline pins for the polish styles (Checkpoint 3 verification baseline; tune per style after the renders). Each value is today's env default.
 */
export const POLISH_STYLE_PINS: Partial<EffectiveFlags> = {
  polishDefaultEdits: 'lean',
  voCutGrammar: true,
  bareCaptions: true,
  accumulateCaptions: true,
  impactFx: true,
  thSkillATools: true,
  editorialStills: true,
  northStar: false,
  directorV2: false,
  visualContextV2: false,
  occupancyContextV2: false,
  contentProfile: true,
  hookTitlePolicy: 'placeholder',
  hookDurationSec: 3,
  zoomScale: 1.25,
  zoomMaxDurationSec: 6,
  cutawayScheduling: 'legacy',
  generatedTransitions: false,
  klipyOverlays: false,
  forceSpeakerCutout: false,
  deliveryLlmEmphasis: false,
};

export const EDIT_STYLES: Readonly<Record<EditStyleId, EditStyleDefinition>> = {
  basic_captions: {
    id: 'basic_captions',
    name: 'Basic Captions',
    description: 'Accurate captions timed to your voice. No cuts.',
    tier: 'free',
    available: true,
    sortOrder: 10,
    previewAsset: 'basic_captions',
    mode: 'basic_captions',
    needsEngineFlags: false,
    geminiMaxRequests: 0, // Groq ASR only; the job also runs inside withNoGemini
  },
  ai_clean_cut: {
    id: 'ai_clean_cut',
    name: 'AI Clean Cut',
    description: 'Removes silences, filler words and retakes, then adds captions.',
    tier: 'pro',
    available: true,
    sortOrder: 20,
    previewAsset: 'ai_clean_cut',
    mode: 'full_edit',
    needsEngineFlags: false,
    geminiMaxRequests: 3, // the keep-plan call plus its retries
  },
  kinetic_typography: {
    id: 'kinetic_typography',
    name: 'Kinetic Typography',
    description: 'Clean cuts plus bold animated type on your key lines.',
    tier: 'pro',
    available: true,
    sortOrder: 30,
    previewAsset: 'kinetic_typography',
    mode: 'full_edit',
    needsEngineFlags: true,
    degradesTo: 'ai_clean_cut',
    geminiMaxRequests: 12, // the polish plan reserves 6 (keep plan, story, creative, motion director, occupancy, content profile); the rest covers perception, repairs, retries
    matte: 'optional', // front-only kinetic type is the shipped baseline while RVM is not on the server
    // type-led: no editorial stock stills (verification render: a still search pulled a copyrighted character into the opening and a template)
    pins: {...POLISH_STYLE_PINS, editorialStills: false},
    pipeline: 'kinetic_v2',
    failClosed: true,
  },
  explainer: {
    id: 'explainer',
    name: 'Explainer',
    description: 'Clean cuts plus diagrams and cutaways for talking-head explainers.',
    tier: 'pro',
    available: true,
    sortOrder: 40,
    previewAsset: 'explainer',
    mode: 'full_edit',
    needsEngineFlags: true,
    degradesTo: 'ai_clean_cut',
    geminiMaxRequests: 12, // the polish plan reserves 6 (keep plan, story, creative, motion director, occupancy, content profile); the rest covers perception, repairs, retries
    pins: POLISH_STYLE_PINS,
  },
  subject_stage: {
    id: 'subject_stage',
    name: 'Subject Stage',
    description: 'You stay in front while plates, quote cards and keyword accents are staged behind you.',
    tier: 'pro',
    // Phase 5.23: engine-only and OFF by default (not in the picker; EDIT_STYLES_AVAILABLE must list it to start a job)
    available: false,
    sortOrder: 50,
    previewAsset: 'subject_stage',
    mode: 'full_edit',
    needsEngineFlags: true,
    degradesTo: 'ai_clean_cut',
    geminiMaxRequests: 12, // the polish plan's reserved stages; the Subject Stage planner itself is deterministic (no model call)
    matte: 'required', // the style is the person cut out over a stage: without a whole-run matte it does not run (degraded, never half-on)
    pins: {...POLISH_STYLE_PINS, editorialStills: false},
    pipeline: 'subject_stage',
  },
};

export function isEditStyleId(value: unknown): value is EditStyleId {
  return typeof value === 'string' && (REQUESTABLE_STYLE_IDS as readonly string[]).includes(value);
}

/** Config the server reads from env (passed in; this module never imports env). */
export type EditStyleConfig = {
  /** EDIT_STYLES_ENABLED: off = `style` is ignored everywhere and the catalog route 404s (old mode-only behaviour). */
  enabled: boolean;
  /** EDIT_STYLES_AVAILABLE: comma list of style ids that are available. Empty = registry defaults. */
  availableOverride: string;
  /** EDIT_STYLES_ORDER: comma list of style ids in display order. Ids not listed keep registry order after the listed ones. Empty = registry order. */
  orderOverride: string;
  /** EDIT_STYLES_ENGINE_FLAGS: off = styles run exactly as in Phase 1 (their mode on the server profile; `needsEngineFlags` styles as `degradesTo`). Default off. */
  engineFlags?: boolean;
};

const csv = (raw: string) =>
  raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

/** Whether a style can be started right now (registry default, or the env override when it is set). */
export function isStyleAvailable(id: EditStyleId, config: Pick<EditStyleConfig, 'availableOverride'>): boolean {
  const override = csv(config.availableOverride);
  return override.length > 0 ? override.includes(id) : EDIT_STYLES[id].available;
}

export type EditStyleCatalogEntry = {
  id: EditStyleId;
  name: string;
  description: string;
  tier: EditStyleTier;
  available: boolean;
  sortOrder: number;
  previewAsset: string;
  /** True when the current creator's plan does not include this style (fail closed: an unverifiable plan locks Pro). */
  locked: boolean;
};

/** The catalog the app renders, sorted, with each style's lock state for one creator. */
export function buildEditStyleCatalog(input: {config: Pick<EditStyleConfig, 'availableOverride' | 'orderOverride'>; hasPro: boolean}): EditStyleCatalogEntry[] {
  const order = csv(input.config.orderOverride).filter(isEditStyleId);
  const rank = (id: EditStyleId) => {
    const index = order.indexOf(id);
    return index >= 0 ? index : order.length + EDIT_STYLES[id].sortOrder;
  };
  return EDIT_STYLE_IDS.map(id => EDIT_STYLES[id])
    .slice()
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((style, index) => ({
      id: style.id,
      name: style.name,
      description: style.description,
      tier: style.tier,
      available: isStyleAvailable(style.id, input.config),
      sortOrder: (index + 1) * 10,
      previewAsset: style.previewAsset,
      locked: style.tier === 'pro' && !input.hasPro,
    }));
}

/**
 * Why a job does not fully look like the style the creator picked. `degraded` is false when the style was fully honoured and true only on a real
 * fallback; the reasons say which (never silent). Known reasons:
 *   engine_flags_off                  EDIT_STYLES_ENGINE_FLAGS is off: the style ran as its `degradesTo` (Phase 1 behaviour)
 *   kinetic_front_only:<why>          a `matte: 'required'` Kinetic style without a person matte: type in front of the speaker only (why: no_matte, or the skip reason).
 *                                     With `matte: 'optional'` (the v1 Kinetic) this is NOT a degradation: it is recorded as the note `matte_unavailable:<why>`.
 *   kinetic_type_failed               the kinetic type stage failed; the edit keeps its cuts and captions
 *   kinetic_type_unpublished          kinetic beats were planned but none could be published (validation / runtime check / upload)
 *   motion_templates_unpublished      motion-template beats were planned but none could be published
 *   explainer_layout_a_only           no explainer layout could be mounted: talking-head layout A only
 *   motion_stage_off                  the motion stage did not run, so no motion templates
 *   motion_templates_failed           the motion template stage failed; nothing from it was placed
 *   gemini_cap_reached:<stage>        the style's Gemini cap refused that stage; it used its own fallback
 */
export type EditStyleOutcome = {
  degraded: boolean;
  degradedReasons: string[];
  /** Non-degrading facts about how the style was produced (e.g. `matte_unavailable:no_matte` for front-only Kinetic). */
  styleNotes: string[];
};

export const ENGINE_FLAGS_OFF_REASON = 'engine_flags_off';

export type ResolvedEditStyle = EditStyleOutcome & {
  style: EditStyleId;
  tier: EditStyleTier;
  mode: EditStyleJobMode;
};

/**
 * Resolve the `style` field of an edit request. Returns null when there is no style to apply (the kill switch is off,
 * or the field is absent): the caller then keeps the request's `mode` exactly as before.
 * Throws a typed reason the route maps to an HTTP error: unknown id (400) or unavailable style (409).
 */
export function resolveRequestedStyle(raw: unknown, config: EditStyleConfig): ResolvedEditStyle | null | {error: 'unknown_style' | 'style_unavailable'; style: string} {
  if (!config.enabled || raw === undefined || raw === null || raw === '') {
    return null;
  }
  const id = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(STYLE_ALIASES, raw) ? STYLE_ALIASES[raw]! : raw;
  if (!isEditStyleId(id)) {
    return {error: 'unknown_style', style: String(raw).slice(0, 60)};
  }
  if (!isStyleAvailable(id, config)) {
    return {error: 'style_unavailable', style: id};
  }
  const def = EDIT_STYLES[id];
  // What is known at request time; the analysis replaces it with what the pipeline really produced (lib/styleRun.ts styleOutcome).
  const flagsOff = def.needsEngineFlags && !config.engineFlags;
  return {
    style: def.id,
    tier: def.tier,
    mode: def.mode,
    degraded: flagsOff,
    degradedReasons: flagsOff ? [ENGINE_FLAGS_OFF_REASON] : [],
    styleNotes: [],
  };
}

export function styleTier(id: EditStyleId | undefined): EditStyleTier | undefined {
  return id ? EDIT_STYLES[id]?.tier : undefined;
}

// ---------------------------------------------------------------------------------------------------------------- V1 release mode (env V1_KINETIC_RELEASE)

/** The only styles a V1 release exposes: Free = Basic Captions, Pro = Kinetic Typography (cleanup runs inside it). Every other style stays in the registry for later versions. */
export const V1_RELEASE_STYLES = ['basic_captions', 'kinetic_typography'] as const satisfies readonly EditStyleId[];

export type V1ReleaseViolation = {code: 'bad_request' | 'footage_unsupported' | 'kinetic_unavailable'; message: string; details: {reason: string}};

/**
 * V1 release gate for POST /v1/edits/captions, evaluated after the request's style was resolved. Pure. Null = the request may proceed.
 *   no style, mode other than basic_captions   style_required      (an older app, or a direct API call, must not reach any other pipeline through `mode`)
 *   kinetic_typography without camera footage  footage_unsupported (screen recordings carry app UI the engine cannot see; "unknown" is never assumed to be camera)
 *   kinetic_typography with engine flags off   kinetic_unavailable (it would otherwise run as AI Clean Cut: a different edit)
 * basic_captions (style or mode) is never blocked: the Free path is unchanged.
 */
export const V1_GATE_OFF_REASON = 'v1_release_off';

export function v1ReleaseViolation(input: {
  release: boolean;
  /** The resolved style, or null when the request carried none (or styles are off). */
  style: EditStyleId | null;
  mode: string | undefined;
  footageKind: string | null | undefined;
  engineFlags: boolean;
}): V1ReleaseViolation | null {
  // Gate OFF: Kinetic Typography is not offered at all. It would otherwise run as the older template path (a different edit reported as Kinetic), so it is refused up front, retryable once the gate is on.
  if (!input.release) {
    return input.style === 'kinetic_typography'
      ? {code: 'kinetic_unavailable', message: 'Kinetic Typography is not available right now. Please try again later.', details: {reason: V1_GATE_OFF_REASON}}
      : null;
  }
  if (input.style === null) {
    if (input.mode === 'basic_captions') return null;
    return {code: 'bad_request', message: 'Update FinalPost to continue: this edit needs the latest app version.', details: {reason: 'style_required'}};
  }
  if (input.style !== 'kinetic_typography') return null;
  if (input.footageKind !== 'camera') {
    return {code: 'footage_unsupported', message: 'This video cannot be edited in Kinetic Typography. Use a video recorded with your camera.', details: {reason: `footage_${input.footageKind ?? 'unknown'}`}};
  }
  if (!input.engineFlags) {
    return {code: 'kinetic_unavailable', message: 'Kinetic Typography is not available right now. Please try again later.', details: {reason: ENGINE_FLAGS_OFF_REASON}};
  }
  return null;
}
