/**
 * Phase 2, Checkpoint 2 (pure): what each edit style resolves to (profile, EffectiveFlags, Gemini cap / plan, cache-key fragment), the engine kill
 * switch, and the degraded outcome. No env import, no I/O.
 */
import {describe, expect, it} from 'vitest';

import {EDIT_STYLE_IDS, EDIT_STYLES, resolveRequestedStyle, type EditStyleId} from './editStyles.ts';
import {effectiveFlagsFromEnv, type EffectiveFlagsEnv} from './effectiveFlags.ts';
import {CUTS_BUDGET_PLAN, POLISH_BUDGET_PLAN, STYLED_POLISH_BUDGET_PLAN, createGeminiEditBudget} from './geminiEditBudget.ts';
import {geminiStageName, resolveStyleRun, styleGeminiCap, styleOutcome, type StyleRun} from './styleRun.ts';

/** Every env flag ON (the worst case for leaks: Documentary, Newsroom, Subject Stage and the visual backends all enabled server-wide). */
const ALL_ON: EffectiveFlagsEnv = {
  MOTION_GRAPHICS_ENABLED: true, POLISH_DEFAULT_EDITS: 'all', POLISH_FACELESS_DOC: true, POLISH_NEWSROOM_MG: true, POLISH_EXPLAINER_SKILL: true, POLISH_TEXTUAL_MG: true,
  POLISH_MOTION_TEMPLATES: true, POLISH_KINETIC_LED: true, POLISH_SUBJECT_STAGE: true, POLISH_VO_CUT_GRAMMAR: true, POLISH_BARE_CAPTIONS: true, POLISH_ACCUMULATE_CAPTIONS: true,
  POLISH_IMPACT_FX: true, POLISH_TH_SKILL_A_TOOLS: true, POLISH_EDITORIAL_STILLS_ENABLED: true, POLISH_RISO_TEMPLATES: true, POLISH_COLLAGE_BROLL: true, POLISH_ANIDOODLE: true,
};
const ALL_OFF = Object.fromEntries(Object.entries(ALL_ON).map(([key, value]) => [key, typeof value === 'boolean' ? false : 'lean'])) as EffectiveFlagsEnv;

const run = (style: EditStyleId, env: EffectiveFlagsEnv = ALL_ON, extra: Partial<Parameters<typeof resolveStyleRun>[0]> = {}) =>
  resolveStyleRun({style, engineFlags: true, envProfile: 'polish', env, envGeminiMaxRequests: 0, ...extra});

describe('style -> EffectiveFlags (engine flags on)', () => {
  it('every style pins Documentary, Newsroom, the Subject Stage and the visual backends off, whatever the env says', () => {
    for (const env of [ALL_ON, ALL_OFF]) {
      for (const style of EDIT_STYLE_IDS) {
        const {flags} = run(style, env);
        expect({style, ...flags}).toMatchObject({style, facelessDoc: false, newsroomMg: false, subjectStage: false, risoTemplates: false, collageBroll: false, anidoodle: false});
      }
    }
  });

  it('basic_captions: legacy, no graphics, no lanes', () => {
    const r = run('basic_captions');
    expect(r.profile).toBe('legacy');
    expect(r.flags).toMatchObject({profile: 'legacy', motionGraphics: false, explainerSkill: false, kineticLed: false, motionTemplates: false, textualMg: false});
  });

  it('ai_clean_cut: pinned to cuts whatever PRODUCT_EDIT_PROFILE is, every visual switch off', () => {
    for (const envProfile of ['legacy', 'mvp', 'cuts', 'polish'] as const) {
      const r = run('ai_clean_cut', ALL_ON, {envProfile});
      expect(r.profile).toBe('cuts');
      expect(r.flags).toMatchObject({profile: 'cuts', motionGraphics: false, libraryOnlyGraphics: false, explainerSkill: false, kineticLed: false, motionTemplates: false, textualMg: false});
    }
  });

  it('kinetic_typography: polish + Kinetic-Led + motion templates + library-only motion graphics, nothing else in the lane', () => {
    for (const env of [ALL_ON, ALL_OFF]) {
      const r = run('kinetic_typography', env, {envProfile: 'cuts'});
      expect(r.profile).toBe('polish');
      expect(r.flags).toMatchObject({profile: 'polish', motionGraphics: true, libraryOnlyGraphics: true, motionTemplates: true, kineticLed: true, explainerSkill: false, textualMg: false});
    }
  });

  it('explainer: polish + the explainer skill + motion templates + library-only motion graphics, no Kinetic-Led', () => {
    for (const env of [ALL_ON, ALL_OFF]) {
      const r = run('explainer', env, {envProfile: 'cuts'});
      expect(r.profile).toBe('polish');
      expect(r.flags).toMatchObject({profile: 'polish', motionGraphics: true, libraryOnlyGraphics: true, motionTemplates: true, explainerSkill: true, kineticLed: false, textualMg: false});
    }
  });

  it('the Skill A tools and the polish edit default still come from env (styles do not change classic polish craft)', () => {
    expect(run('kinetic_typography', ALL_ON).flags).toMatchObject({voCutGrammar: true, impactFx: true, polishDefaultEdits: 'all'});
    expect(run('kinetic_typography', ALL_OFF).flags).toMatchObject({voCutGrammar: false, impactFx: false, polishDefaultEdits: 'lean'});
  });

  it('a style never shares a cache-key fragment with another style or with an unstyled job', () => {
    const keys = EDIT_STYLE_IDS.map(style => run(style).styleKey);
    expect(new Set(keys).size).toBe(EDIT_STYLE_IDS.length);
    for (const key of keys) expect(key).toMatch(/^style:[a-z_]+:v\d+$/);
  });
});

describe('per-style Gemini cap (never uncapped)', () => {
  it('registry values 0 / 3 / 12 / 12', () => {
    expect(EDIT_STYLE_IDS.map(id => [id, EDIT_STYLES[id].geminiMaxRequests])).toEqual([
      ['basic_captions', 0], ['ai_clean_cut', 3], ['kinetic_typography', 12], ['explainer', 12],
    ]);
  });
  it('unset env (0) = the style cap; a positive env cap can only tighten it; a style is never unbounded', () => {
    expect(styleGeminiCap('kinetic_typography', 0)).toBe(12);
    expect(styleGeminiCap('kinetic_typography', 8)).toBe(8);
    expect(styleGeminiCap('kinetic_typography', 40)).toBe(12);
    expect(styleGeminiCap('ai_clean_cut', -1)).toBe(3);
    for (const style of EDIT_STYLE_IDS) expect(run(style).geminiMaxRequests).toBe(EDIT_STYLES[style].geminiMaxRequests);
  });
  it('polish styles use the polish priority order (occupancy may use the pool); Clean Cut reserves its slot for the keep plan', () => {
    expect(run('kinetic_typography').geminiPlan).toBe(STYLED_POLISH_BUDGET_PLAN);
    expect(run('explainer').geminiPlan).toBe(STYLED_POLISH_BUDGET_PLAN);
    expect(STYLED_POLISH_BUDGET_PLAN.order).toEqual(POLISH_BUDGET_PLAN.order);
    expect(STYLED_POLISH_BUDGET_PLAN.noPool).toBeUndefined();
    expect(POLISH_BUDGET_PLAN.noPool).toEqual(['occupancy']); // the env path is unchanged
    const styled = createGeminiEditBudget(12, {plan: STYLED_POLISH_BUDGET_PLAN});
    expect([1, 2, 3].map(() => styled.reserve('Gemini speaker occupancy').ok)).toEqual([true, true, true]);
    expect(run('ai_clean_cut').geminiPlan).toBe(CUTS_BUDGET_PLAN);
    const budget = createGeminiEditBudget(3, {plan: CUTS_BUDGET_PLAN});
    expect(budget.reserve('cuts ai keep plan').ok).toBe(true);
    expect(budget.report().reservedAtStart).toEqual({keep_plan: 1});
  });
});

describe('the engine kill switch (EDIT_STYLES_ENGINE_FLAGS off): exactly the Phase 1 behaviour', () => {
  const off = (style: EditStyleId, envProfile: 'cuts' | 'polish' = 'cuts') => resolveStyleRun({style, engineFlags: false, envProfile, env: ALL_ON, envGeminiMaxRequests: 0});
  it('env flags, env Gemini cap, no style in the cache key; Clean Cut (and what falls back to it) is cuts even on a polish server', () => {
    for (const envProfile of ['cuts', 'polish'] as const) {
      for (const style of EDIT_STYLE_IDS) {
        const r = off(style, envProfile);
        const expected = style === 'basic_captions' ? envProfile : 'cuts';
        expect({style, profile: r.profile}).toEqual({style, profile: expected});
        expect(r.flags).toEqual(effectiveFlagsFromEnv(ALL_ON, expected));
        expect(r.geminiMaxRequests).toBeUndefined();
        expect(r.styleKey).toBe('');
      }
    }
  });
  it('Kinetic / Explainer run as AI Clean Cut, degraded `engine_flags_off`; Basic and (on a cuts server) Clean Cut are honoured', () => {
    expect(off('kinetic_typography')).toMatchObject({styleApplied: 'ai_clean_cut', plannedReasons: ['engine_flags_off']});
    expect(off('explainer')).toMatchObject({styleApplied: 'ai_clean_cut', plannedReasons: ['engine_flags_off']});
    expect(off('basic_captions')).toMatchObject({styleApplied: 'basic_captions', plannedReasons: []});
    expect(off('ai_clean_cut')).toMatchObject({styleApplied: 'ai_clean_cut', plannedReasons: []});
    expect(off('ai_clean_cut', 'polish')).toMatchObject({profile: 'cuts', plannedReasons: []}); // locked: a polish server still gives a Clean Cut
  });
  it('the route marks the request the same way', () => {
    const config = {enabled: true, availableOverride: 'basic_captions,ai_clean_cut,kinetic_typography,explainer', orderOverride: ''};
    expect(resolveRequestedStyle('kinetic_typography', {...config, engineFlags: false})).toMatchObject({degraded: true, degradedReasons: ['engine_flags_off']});
    expect(resolveRequestedStyle('kinetic_typography', {...config, engineFlags: true})).toMatchObject({degraded: false, degradedReasons: []});
    expect(resolveRequestedStyle('ai_clean_cut', {...config, engineFlags: false})).toMatchObject({degraded: false, degradedReasons: []});
  });
});

describe('styleOutcome: degraded only on a real fallback', () => {
  const outcome = (style: EditStyleId, warnings: string[], extra: {refusedLabels?: string[]; matteConfigured?: boolean; runOverride?: StyleRun} = {}) =>
    styleOutcome({run: extra.runOverride ?? run(style), warnings, refusedLabels: extra.refusedLabels ?? [], matteConfigured: extra.matteConfigured ?? true});

  it('fully honoured: false, no reasons', () => {
    expect(outcome('ai_clean_cut', ['cuts_keep_plan:applied'])).toEqual({degraded: false, degradedReasons: []});
    expect(outcome('kinetic_typography', ['polish_kinetic_led:on', 'kinetic_type:matte:segmentation:12s:2_ranges:rvm', 'kinetic_type:foreground:2_spans'])).toEqual({degraded: false, degradedReasons: []});
    expect(outcome('explainer', ['polish_kinetic_led:off'])).toEqual({degraded: false, degradedReasons: []});
    // a matte backend exists but no beat wanted one: nothing fell back
    expect(outcome('kinetic_typography', ['polish_kinetic_led:on'], {matteConfigured: true})).toEqual({degraded: false, degradedReasons: []});
  });

  it('Kinetic with no matte backend (no RVM): front-only, degraded with a reason; a matte that was skipped names why', () => {
    expect(outcome('kinetic_typography', ['polish_kinetic_led:on'], {matteConfigured: false})).toEqual({degraded: true, degradedReasons: ['kinetic_front_only:no_matte']});
    expect(outcome('kinetic_typography', ['kinetic_type:matte:skipped:busy'])).toEqual({degraded: true, degradedReasons: ['kinetic_front_only:busy']});
    expect(outcome('kinetic_typography', ['kinetic_type:matte:skipped:upload_failed']).degradedReasons).toEqual(['kinetic_front_only:upload_failed']);
  });

  it('stage failures and skips', () => {
    expect(outcome('kinetic_typography', ['craft_templates:failed']).degradedReasons).toEqual(['kinetic_type_failed']);
    expect(outcome('kinetic_typography', ['craft_templates:beats:2', 'craft_templates:publish_failed:2']).degradedReasons).toEqual(['kinetic_type_unpublished']);
    expect(outcome('kinetic_typography', ['craft_templates:published:1', 'craft_templates:publish_failed:1', 'kinetic_type:foreground:1_spans']).degradedReasons).toEqual([]); // some reached the frame
    expect(outcome('explainer', ['polish_motion_templates:beats:1', 'polish_motion_templates:publish_failed:1']).degradedReasons).toEqual(['motion_templates_unpublished']);
    expect(outcome('explainer', ['polish_motion_templates:no_triggers']).degradedReasons).toEqual([]); // nothing to place is not a fallback
    expect(outcome('kinetic_typography', ['polish_motion_templates:skipped:no_motion']).degradedReasons).toEqual(['motion_stage_off']);
    expect(outcome('explainer', ['polish_motion_templates:failed']).degradedReasons).toEqual(['motion_templates_failed']);
    expect(outcome('explainer', ['polish_explainer_mounted:skipped:no_layouts']).degradedReasons).toEqual(['explainer_layout_a_only']);
  });

  it('Gemini cap refusals name the stage (budget class, else the call label as a slug)', () => {
    expect(outcome('explainer', [], {refusedLabels: ['Director v2 creative director', 'asset describe']}).degradedReasons).toEqual([
      'gemini_cap_reached:director_creative',
      'gemini_cap_reached:asset_describe',
    ]);
    expect(outcome('ai_clean_cut', [], {refusedLabels: ['cuts ai keep plan']}).degradedReasons).toEqual(['gemini_cap_reached:keep_plan']);
    expect(geminiStageName('Weird / Label!!', undefined)).toBe('weird_label');
  });

  it('engine flags off: only engine_flags_off (style-specific checks do not apply to a style that did not run)', () => {
    const offRun = resolveStyleRun({style: 'kinetic_typography', engineFlags: false, envProfile: 'cuts', env: ALL_ON, envGeminiMaxRequests: 0});
    expect(outcome('kinetic_typography', ['kinetic_type:matte:skipped:busy'], {runOverride: offRun, refusedLabels: ['content profile'], matteConfigured: false})).toEqual({
      degraded: true,
      degradedReasons: ['engine_flags_off'],
    });
  });
});
