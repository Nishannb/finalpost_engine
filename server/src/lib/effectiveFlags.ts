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
import type {ProductEditProfile} from './productEditProfile.ts';

export type EffectiveFlags = {
  /** The product edit profile this job runs (legacy | mvp | cuts | polish). */
  profile: ProductEditProfile;
  /** MOTION_GRAPHICS_ENABLED: generated / library motion graphics requested for this job (the motion stage, and everything that needs it). */
  motionGraphics: boolean;
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
};

/** Exactly what the pipeline read from env before EffectiveFlags existed, for the given profile. */
export function effectiveFlagsFromEnv(env: EffectiveFlagsEnv, profile: ProductEditProfile): EffectiveFlags {
  return {
    profile,
    motionGraphics: Boolean(env.MOTION_GRAPHICS_ENABLED),
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
  };
}
