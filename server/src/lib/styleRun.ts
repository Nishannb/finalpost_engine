/**
 * Phase 2: what an edit style means for ONE analysis job. Pure (env values are passed in), resolved once in `startAnalysis`.
 *
 *   resolveStyleRun   style -> the profile, EffectiveFlags, Gemini cap + budget plan and cache-key fragment this job runs with
 *   styleOutcome      after the run: did the pipeline fully honour the style? (`degraded` + reasons, never silent)
 *
 * Requests with no style never come here (startAnalysis keeps its env-derived flags, cache key and Gemini budget byte for byte).
 * With the engine kill switch EDIT_STYLES_ENGINE_FLAGS off, a styled job is resolved as in Phase 1 (env flags, env Gemini cap, no style in the
 * cache key; Kinetic / Explainer run as AI Clean Cut and say so with `engine_flags_off`). AI Clean Cut is the `cuts` profile in BOTH modes.
 *
 * Styled jobs, whatever the env says: Faceless Documentary and Newsroom are pinned OFF (not exposed), the Subject Stage is off (it would make
 * Kinetic-Led yield), the WP53 visual backends are off, and motion graphics are LIBRARY ONLY (no Claude call).
 */
import {ENGINE_FLAGS_OFF_REASON, EDIT_STYLES, type EditStyleId, type EditStyleOutcome} from './editStyles.ts';
import {effectiveFlagsFromEnv, type EffectiveFlags, type EffectiveFlagsEnv} from './effectiveFlags.ts';
import {CUTS_BUDGET_PLAN, STYLED_POLISH_BUDGET_PLAN, type BudgetPlan} from './geminiEditBudget.ts';
import type {ProductEditProfile} from './productEditProfile.ts';
import type {EditingPipelineSelection} from './editingPipeline.ts';

export type StyleRun = {
  style: EditStyleId;
  /** Whether the engine flags were applied (EDIT_STYLES_ENGINE_FLAGS at resolve time). */
  engineFlags: boolean;
  /** The style the pipeline is asked to produce (== style, or its `degradesTo` with the engine flags off). */
  styleApplied: EditStyleId;
  profile: ProductEditProfile;
  flags: EffectiveFlags;
  /** The per-job Gemini attempt cap, or undefined = the env cap (engine flags off: Phase 1 behaviour). */
  geminiMaxRequests?: number;
  geminiPlan?: BudgetPlan;
  /** Cache-key fragment: '' with the engine flags off (keys exactly as in Phase 1), else the style and a version of its flag set. */
  styleKey: string;
  /** Reasons already known before the run (the engine flags are off). */
  plannedReasons: string[];
  /** Phase 5.23: the editing pipeline of the APPLIED style ('none' when it has none, e.g. a style that degraded to AI Clean Cut). Authoritative in analyzeVideo. */
  pipeline: EditingPipelineSelection;
};

/** Bump when a style's flag set changes, so a cached blueprint of the old mapping is never served for the new one. */
export const STYLE_FLAGS_VERSION = 'v3'; // v2: registry pins (POLISH_STYLE_PINS); v3: Kinetic without editorial stills

/** Lanes and toolkits no styled job may run, whatever the env says. */
const STYLED_PINS = {
  facelessDoc: false,
  newsroomMg: false,
  subjectStage: false,
  risoTemplates: false,
  collageBroll: false,
  anidoodle: false,
} as const satisfies Partial<EffectiveFlags>;

function styledFlags(style: EditStyleId, env: EffectiveFlagsEnv, release = false): {profile: ProductEditProfile; flags: EffectiveFlags} {
  switch (style) {
    case 'basic_captions':
      // The basic-captions path (analysisRunner + analyzeVideo) forces legacy, captions only, withNoGemini; the flags are irrelevant but pinned for clarity.
      return {profile: 'legacy', flags: {...effectiveFlagsFromEnv(env, 'legacy'), ...STYLED_PINS, motionGraphics: false, explainerSkill: false, kineticLed: false, motionTemplates: false, textualMg: false}};
    case 'ai_clean_cut':
      // Pinned to `cuts` (never PRODUCT_EDIT_PROFILE): Stage A + captions, every visual stage off.
      return {profile: 'cuts', flags: {...effectiveFlagsFromEnv(env, 'cuts'), ...STYLED_PINS, motionGraphics: false, explainerSkill: false, kineticLed: false, motionTemplates: false, textualMg: false}};
    case 'kinetic_typography':
      // Polish + Kinetic-Led. Kinetic type is planned by the motion-template stage, which only runs inside the motion stage: graphics on, library only.
      return {
        profile: 'polish',
        flags: {
          ...effectiveFlagsFromEnv(env, 'polish'), ...EDIT_STYLES[style].pins, ...STYLED_PINS, motionGraphics: true, libraryOnlyGraphics: true, motionTemplates: true, kineticLed: true, explainerSkill: false, textualMg: false,
          // V1 release: the style IS the Kinetic V2 pipeline (never the env-gated template path under a Kinetic label), with the Match Cut shutter treatment. RVM / Subject Stage are not touched: the matte, 3D and Subject Stage flags keep their env values (default off).
          ...(release ? {kineticEngine: true, matchCutShutter: true} : {}),
        },
      };
    case 'explainer':
      // Polish + the explainer skill (B) + motion templates (explainer allowlist). Same motion-stage requirement: graphics on, library only.
      return {
        profile: 'polish',
        flags: {...effectiveFlagsFromEnv(env, 'polish'), ...EDIT_STYLES[style].pins, ...STYLED_PINS, motionGraphics: true, libraryOnlyGraphics: true, motionTemplates: true, explainerSkill: true, kineticLed: false, textualMg: false},
      };
    case 'subject_stage':
      // Phase 5.23: the Subject Stage pipeline. Polish (cuts, grade, audio) with every OTHER text / graphics lane off: no Kinetic (V2 engine or template), no motion graphics or
      // templates, no explainer / textual MG. The stage itself is ON for this job whatever POLISH_SUBJECT_STAGE says (the selection is authoritative, not the env flag).
      return {
        profile: 'polish',
        flags: {
          ...effectiveFlagsFromEnv(env, 'polish'), ...EDIT_STYLES[style].pins, ...STYLED_PINS,
          subjectStage: true, kineticEngine: false, kineticLed: false, motionGraphics: false, libraryOnlyGraphics: true, motionTemplates: false, explainerSkill: false, textualMg: false,
        },
      };
  }
}

/** The style's cap, or the env cap when that is positive and lower (a server operator can always tighten, never loosen). */
export function styleGeminiCap(style: EditStyleId, envMaxRequests: number): number {
  const cap = EDIT_STYLES[style].geminiMaxRequests;
  return Number.isFinite(envMaxRequests) && envMaxRequests > 0 ? Math.min(cap, Math.floor(envMaxRequests)) : cap;
}

export function resolveStyleRun(input: {
  style: EditStyleId;
  engineFlags: boolean;
  envProfile: ProductEditProfile;
  env: EffectiveFlagsEnv;
  envGeminiMaxRequests: number;
  /** V1_KINETIC_RELEASE: see config/env.ts. Absent / false = the behaviour of every earlier phase. */
  release?: boolean;
}): StyleRun {
  const def = EDIT_STYLES[input.style];
  if (!input.engineFlags) {
    // Phase 1 behaviour (env flags, env Gemini cap, no style in the key), except that AI Clean Cut is ALWAYS the `cuts` profile, whatever
    // PRODUCT_EDIT_PROFILE says: also when Kinetic / Explainer fall back to it. Basic Captions keeps its own legacy path (analysisRunner).
    const appliedAs = def.needsEngineFlags ? def.degradesTo ?? 'ai_clean_cut' : input.style;
    const profile: ProductEditProfile = appliedAs === 'ai_clean_cut' ? 'cuts' : input.envProfile;
    return {
      style: input.style,
      engineFlags: false,
      styleApplied: appliedAs,
      profile,
      flags: effectiveFlagsFromEnv(input.env, profile),
      styleKey: '',
      plannedReasons: def.needsEngineFlags ? [ENGINE_FLAGS_OFF_REASON] : [],
      pipeline: EDIT_STYLES[appliedAs].pipeline ?? 'none',
    };
  }
  const release = Boolean(input.release);
  const {profile, flags} = styledFlags(input.style, input.env, release);
  return {
    style: input.style,
    engineFlags: true,
    styleApplied: input.style,
    profile,
    flags,
    geminiMaxRequests: styleGeminiCap(input.style, input.envGeminiMaxRequests),
    geminiPlan: profile === 'polish' ? STYLED_POLISH_BUDGET_PLAN : CUTS_BUDGET_PLAN,
    // Kinetic engine v2 changes the produced blueprint, so it must not share a cache key with the template path; with the flag off the key is exactly what it was.
    styleKey: `style:${input.style}:${STYLE_FLAGS_VERSION}${input.style === 'kinetic_typography' && flags.kineticEngine ? `:engine${flags.kineticEngineThreeD ? '3d' : ''}${flags.kineticEngineAdaptive ? 'a' : ''}${flags.kineticEngineMotion ? 'm' : ''}${flags.kineticEngineMatte ? 'r' : ''}${flags.matchCutShutter ? 's' : ''}` : ''}`,
    plannedReasons: [],
    pipeline: def.pipeline ?? 'none',
  };
}

/** A budget class name, or the call label as a short slug, for `gemini_cap_reached:<stage>`. */
export function geminiStageName(label: string, plan: BudgetPlan | undefined): string {
  const cls = plan && Object.prototype.hasOwnProperty.call(plan.labels, label) ? plan.labels[label]! : '';
  return cls || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'unknown';
}

/**
 * What the pipeline really produced for a styled job, from the blueprint warnings (the strings are pinned by the stage tests) plus the Gemini
 * refusals of this run. `degraded` is false when the style was fully honoured.
 */
export function styleOutcome(input: {
  run: StyleRun;
  warnings: readonly string[];
  /** Call labels the Gemini budget refused in this run (empty on a cache hit: the stored reasons are used instead). */
  refusedLabels?: readonly string[];
  /** media/personMatte.ts subjectMatteConfigured(): a person-matte backend (RVM) exists on this host. */
  matteConfigured: boolean;
}): EditStyleOutcome {
  const reasons = [...input.run.plannedReasons];
  const notes: string[] = [];
  // a missing matte degrades only a style that requires one; for `optional` it is a note
  const matteGap = (why: string) => (EDIT_STYLES[input.run.style].matte === 'optional' ? notes.push(`matte_unavailable:${why}`) : reasons.push(`kinetic_front_only:${why}`));
  const has = (prefix: string) => input.warnings.some(warning => warning.startsWith(prefix));
  if (input.run.engineFlags) {
    const style = input.run.style;
    if (style === 'kinetic_typography' || style === 'explainer') {
      if (has('polish_motion_templates:skipped:no_motion')) reasons.push('motion_stage_off');
      if (has('polish_motion_templates:failed')) reasons.push('motion_templates_failed');
      // beats were planned but none could be published (validation / runtime check / upload): the frame shows none of them
      if (has('polish_motion_templates:publish_failed:') && !has('polish_motion_templates:published:')) reasons.push('motion_templates_unpublished');
    }
    if (style === 'kinetic_typography') {
      if (has('craft_templates:failed')) {
        reasons.push('kinetic_type_failed');
      } else if (!has('polish_motion_templates:skipped:no_motion')) {
        // kinetic beats were planned, none reached the frame
        if (has('craft_templates:publish_failed:') && !has('craft_templates:published:')) reasons.push('kinetic_type_unpublished');
      }
      if (!has('craft_templates:failed') && !has('polish_motion_templates:skipped:no_motion') && !has('kinetic_type:foreground:')) {
        // No beat was drawn behind the speaker. A fallback only when a matte was wanted and could not be made (skip reason), or no backend exists at all.
        const skipped = input.warnings.find(warning => warning.startsWith('kinetic_type:matte:skipped:'));
        if (skipped) matteGap(skipped.slice('kinetic_type:matte:skipped:'.length));
        else if (!input.matteConfigured && !has('kinetic_type:matte:segmentation')) matteGap('no_matte');
      }
    }
    if (style === 'explainer' && has('polish_explainer_mounted:skipped:no_layouts')) reasons.push('explainer_layout_a_only');
    if (style === 'subject_stage' && !has('polish_subject_stage:on')) {
      // the stage did not run (no matte, too long, empty plan ...): the job is a plain polish edit with its ordinary captions, and says so
      const skipped = input.warnings.find(warning => warning.startsWith('polish_subject_stage:skipped:'));
      reasons.push(`subject_stage_skipped:${skipped ? skipped.slice('polish_subject_stage:skipped:'.length) : 'not_run'}`);
    }
    // AI planning that did not happen is not a complete AI edit: the render can be technically fine while the editorial / typography plan was the deterministic fallback
    // (no provider key, a refused budget, a provider error). Distinct reasons so the app can tell "rendered" from "AI-planned".
    const editorial = input.warnings.find(warning => warning.startsWith('director_v2:fallback:'));
    if (editorial && (style === 'kinetic_typography' || style === 'explainer' || style === 'subject_stage')) reasons.push(`ai_director_fallback:${editorial.slice('director_v2:fallback:'.length)}`);
    const typography = input.warnings.find(warning => warning.startsWith('kinetic_engine_fallback_plan:'));
    if (typography && style === 'kinetic_typography') reasons.push(`kinetic_plan_fallback:${typography.slice('kinetic_engine_fallback_plan:'.length).split(':')[0]!.slice(0, 40)}`);
    for (const label of input.refusedLabels ?? []) reasons.push(`gemini_cap_reached:${geminiStageName(label, input.run.geminiPlan)}`);
  }
  const unique = [...new Set(reasons)];
  return {degraded: unique.length > 0, degradedReasons: unique, styleNotes: [...new Set(notes)]};
}

/**
 * V1 release mode, fail closed. A Kinetic Typography job (`failClosed` style) is only successful when the Kinetic V2 engine really wrote `blueprint.kinetic`.
 * Anything else (the engine skipped the footage, produced no spec, or errored inside) is a failed job with a retryable code, never a silently different edit.
 * Pure. Null = the style was produced. `detail` is for logs and the job record, not for the end user (the message is).
 */
export function kineticFailClosed(input: {
  release: boolean;
  run: Pick<StyleRun, 'style' | 'engineFlags'>;
  warnings: readonly string[];
  /** The blueprint carries `kinetic` (the V2 engine's spec). */
  hasKineticSpec: boolean;
}): {code: 'kinetic_unavailable' | 'footage_unsupported'; message: string; detail: string} | null {
  if (!EDIT_STYLES[input.run.style].failClosed) return null;
  // Gate OFF: a Kinetic job that reached analysis anyway (an old job, or the gate flipped after the request) is never run as another pipeline and reported as Kinetic.
  if (!input.release) return {code: 'kinetic_unavailable', message: 'Kinetic Typography is not available right now. Please try again later.', detail: 'v1_release_off'};
  if (input.hasKineticSpec && input.run.engineFlags) return null;
  const footage = input.warnings.find(warning => warning.startsWith('kinetic_engine:skipped_footage:'));
  if (footage) {
    return {code: 'footage_unsupported', message: 'This video cannot be edited in Kinetic Typography. Use a video recorded with your camera.', detail: footage};
  }
  const detail = !input.run.engineFlags
    ? ENGINE_FLAGS_OFF_REASON
    : input.warnings.find(warning => warning.startsWith('kinetic_engine') && /fail|error|skipped|no_spec/.test(warning)) ?? 'kinetic_engine:no_spec';
  return {code: 'kinetic_unavailable', message: 'We could not finish your Kinetic Typography edit. Please try again.', detail: detail.slice(0, 160)};
}
