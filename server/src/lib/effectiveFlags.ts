/**
 * EffectiveFlags: every per-job switch the analysis pipeline reads, resolved ONCE per job and passed down.
 *
 * Why: analyses run concurrently in one process (analysisRunner MAX_CONCURRENT_ANALYSES), so a per-request choice (an edit style) can never be
 * expressed by mutating `env`. The pipeline reads these values from its input instead of the global env; env only provides the defaults.
 *
 * Checkpoint 1 (no behaviour change): `effectiveFlagsFromEnv` reproduces exactly what the pipeline used to read from env, and a job with no
 * explicit flags gets those. Styles (Checkpoint 2) build their own EffectiveFlags on top of these defaults.
 *
 * Pure: the env values are passed in (no config import), like productEditProfile.ts.
 */
import {AsyncLocalStorage} from 'node:async_hooks';

import type {ProductEditProfile} from './productEditProfile.ts';

export type EffectiveFlags = {
  /** The product edit profile this job runs (legacy | mvp | cuts | polish). */
  profile: ProductEditProfile;
  /** MOTION_GRAPHICS_ENABLED: generated / library motion graphics requested for this job (the motion stage, and everything that needs it). */
  motionGraphics: boolean;
  /**
   * Motion graphics from the LIBRARY only: the Claude generator is never called for this job, whatever the Claude budget env says (a miss is dropped).
   * No env equivalent: false from env (today's behaviour); edit styles set it (lib/styleRun.ts).
   */
  libraryOnlyGraphics: boolean;
  /** POLISH_DEFAULT_EDITS: what an omitted edit list means on polish. */
  polishDefaultEdits: 'lean' | 'all';
  /** L1 skill lane switches (resolvePolishSkill priority: faceless > newsroom > explainer > default). */
  facelessDoc: boolean;
  newsroomMg: boolean;
  explainerSkill: boolean;
  /** Overlays / toolkits inside the active lane. */
  textualMg: boolean;
  motionTemplates: boolean;
  kineticLed: boolean;
  subjectStage: boolean;
  /** Skill A tools (classic talking-head polish). */
  voCutGrammar: boolean;
  bareCaptions: boolean;
  accumulateCaptions: boolean;
  impactFx: boolean;
  thSkillATools: boolean;
  editorialStills: boolean;
  /** WP53 visual backends. */
  risoTemplates: boolean;
  collageBroll: boolean;
  anidoodle: boolean;
  /** Director / planning settings (the env values are the defaults; styles pin them, lib/editStyles.ts `pins`). */
  northStar: boolean;
  directorV2: boolean;
  visualContextV2: boolean;
  occupancyContextV2: boolean;
  contentProfile: boolean;
  hookTitlePolicy: 'placeholder' | 'optional';
  hookDurationSec: number;
  zoomScale: number;
  zoomMaxDurationSec: number;
  cutawayScheduling: 'legacy' | 'beat_preserving';
  generatedTransitions: boolean;
  klipyOverlays: boolean;
  forceSpeakerCutout: boolean;
  deliveryLlmEmphasis: boolean;
};

/** The env fields EffectiveFlags defaults come from (a structural subset of config/env.ts `env`). */
export type EffectiveFlagsEnv = {
  MOTION_GRAPHICS_ENABLED: boolean;
  POLISH_DEFAULT_EDITS: 'lean' | 'all';
  POLISH_FACELESS_DOC: boolean;
  POLISH_NEWSROOM_MG: boolean;
  POLISH_EXPLAINER_SKILL: boolean;
  POLISH_TEXTUAL_MG: boolean;
  POLISH_MOTION_TEMPLATES: boolean;
  POLISH_KINETIC_LED: boolean;
  POLISH_SUBJECT_STAGE: boolean;
  POLISH_VO_CUT_GRAMMAR: boolean;
  POLISH_BARE_CAPTIONS: boolean;
  POLISH_ACCUMULATE_CAPTIONS: boolean;
  POLISH_IMPACT_FX: boolean;
  POLISH_TH_SKILL_A_TOOLS: boolean;
  POLISH_EDITORIAL_STILLS_ENABLED: boolean;
  POLISH_RISO_TEMPLATES: boolean;
  POLISH_COLLAGE_BROLL: boolean;
  POLISH_ANIDOODLE: boolean;
  NORTH_STAR: boolean;
  DIRECTOR_V2: boolean;
  VISUAL_CONTEXT_V2: boolean;
  OCCUPANCY_CONTEXT_V2: boolean;
  CONTENT_PROFILE_ENABLED: boolean;
  HOOK_TITLE_POLICY: 'placeholder' | 'optional';
  HOOK_DURATION_SEC: number;
  ZOOM_SCALE: number;
  ZOOM_MAX_DURATION_SEC: number;
  CUTAWAY_SCHEDULING: 'legacy' | 'beat_preserving';
  GENERATED_TRANSITIONS_ENABLED: boolean;
  KLIPY_OVERLAYS_ENABLED: boolean;
  FORCE_SPEAKER_CUTOUT: boolean;
  DELIVERY_LLM_EMPHASIS: boolean;
};

/** Exactly what the pipeline read from env before EffectiveFlags existed, for the given profile. */
export function effectiveFlagsFromEnv(env: EffectiveFlagsEnv, profile: ProductEditProfile): EffectiveFlags {
  return {
    profile,
    motionGraphics: Boolean(env.MOTION_GRAPHICS_ENABLED),
    libraryOnlyGraphics: false,
    polishDefaultEdits: env.POLISH_DEFAULT_EDITS === 'all' ? 'all' : 'lean',
    facelessDoc: Boolean(env.POLISH_FACELESS_DOC),
    newsroomMg: Boolean(env.POLISH_NEWSROOM_MG),
    explainerSkill: Boolean(env.POLISH_EXPLAINER_SKILL),
    textualMg: Boolean(env.POLISH_TEXTUAL_MG),
    motionTemplates: Boolean(env.POLISH_MOTION_TEMPLATES),
    kineticLed: Boolean(env.POLISH_KINETIC_LED),
    subjectStage: Boolean(env.POLISH_SUBJECT_STAGE),
    voCutGrammar: Boolean(env.POLISH_VO_CUT_GRAMMAR),
    bareCaptions: Boolean(env.POLISH_BARE_CAPTIONS),
    accumulateCaptions: Boolean(env.POLISH_ACCUMULATE_CAPTIONS),
    impactFx: Boolean(env.POLISH_IMPACT_FX),
    thSkillATools: Boolean(env.POLISH_TH_SKILL_A_TOOLS),
    editorialStills: Boolean(env.POLISH_EDITORIAL_STILLS_ENABLED),
    risoTemplates: Boolean(env.POLISH_RISO_TEMPLATES),
    collageBroll: Boolean(env.POLISH_COLLAGE_BROLL),
    anidoodle: Boolean(env.POLISH_ANIDOODLE),
    // read exactly as the call sites did (raw values, so `!== false`-style checks keep their meaning)
    northStar: env.NORTH_STAR,
    directorV2: env.DIRECTOR_V2,
    visualContextV2: env.VISUAL_CONTEXT_V2,
    occupancyContextV2: env.OCCUPANCY_CONTEXT_V2,
    contentProfile: env.CONTENT_PROFILE_ENABLED,
    hookTitlePolicy: env.HOOK_TITLE_POLICY,
    hookDurationSec: env.HOOK_DURATION_SEC,
    zoomScale: env.ZOOM_SCALE,
    zoomMaxDurationSec: env.ZOOM_MAX_DURATION_SEC,
    cutawayScheduling: env.CUTAWAY_SCHEDULING,
    generatedTransitions: env.GENERATED_TRANSITIONS_ENABLED,
    klipyOverlays: env.KLIPY_OVERLAYS_ENABLED,
    forceSpeakerCutout: env.FORCE_SPEAKER_CUTOUT,
    deliveryLlmEmphasis: env.DELIVERY_LLM_EMPHASIS,
  };
}

/**
 * The job's flags for code BELOW analyzeVideo (stages that read a setting deep inside their own helpers). analyzeVideo runs its whole body inside
 * `withJobFlags`; outside a job (tests calling a stage directly, scripts) `jobFlag` returns the env value exactly as before. Per async context, so
 * concurrent analyses never see each other's flags; nothing is mutated.
 */

const jobScope = new AsyncLocalStorage<EffectiveFlags>();

export function withJobFlags<T>(flags: EffectiveFlags, fn: () => Promise<T>): Promise<T> {
  return jobScope.run(flags, fn);
}

export function currentJobFlags(): EffectiveFlags | undefined {
  return jobScope.getStore();
}

/** A per-job setting: the running job's value, else the env fallback the caller passes (its old read, unchanged). */
export function jobFlag<K extends keyof EffectiveFlags>(key: K, envFallback: EffectiveFlags[K]): EffectiveFlags[K] {
  const flags = jobScope.getStore();
  return flags ? flags[key] : envFallback;
}
