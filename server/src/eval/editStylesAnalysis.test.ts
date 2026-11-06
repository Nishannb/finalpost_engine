/**
 * Phase 2, Checkpoint 2: edit styles inside `startAnalysis` (the real runner, the real memory store, the real Gemini budget). `analyzeVideo` is a stand-in
 * that records the input it was given and the Gemini budget in force, and can simulate stages asking Gemini (through the real `reserveGeminiAttempt`
 * chokepoint) and falling back on a refusal, as the real stages do. No network, no model call.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  calls: [] as Array<{input: Record<string, unknown>; budget: unknown}>,
  /** What the stand-in does inside the job's budget scope. Returns the blueprint warnings. */
  behave: (async () => []) as (input: Record<string, unknown>) => Promise<string[]>,
  matteConfigured: false,
}));

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  state.env = {...actual.env, REDIS_URL: '', GEMINI_EDIT_MAX_REQUESTS: 0, PRODUCT_EDIT_PROFILE: 'cuts', EDIT_STYLES_ENGINE_FLAGS: true, CLAUDE_EDIT_BUDGET_USD: 5};
  return {...actual, env: state.env};
});
vi.mock('../stages/render/renderBudget.ts', () => ({assertAnalysisAllowed: async () => {}, recordAnalysis: async () => {}}));
vi.mock('../media/personMatte.ts', () => ({subjectMatteConfigured: () => state.matteConfigured}));
vi.mock('../pipeline/analyzeVideo.ts', async () => {
  const budget = await import('../lib/geminiEditBudget.ts');
  return {
    analyzeVideo: async (input: Record<string, unknown>) => {
      const scope = budget.currentGeminiBudget();
      state.calls.push({input, budget: scope ? scope.report() : null});
      const warnings = await state.behave(input);
      return {blueprintId: `bp_${state.calls.length}`, createdAt: new Date().toISOString(), stats: {warnings}, captionWords: [], outputDurationSec: 10};
    },
  };
});

import {effectiveFlagsFromEnv} from '../lib/effectiveFlags.ts';
import {GEMINI_HOST, reserveGeminiAttempt} from '../lib/geminiEditBudget.ts';
import {EDIT_STYLE_IDS, type EditStyleId} from '../lib/editStyles.ts';
import {startAnalysis} from '../pipeline/analysisRunner.ts';
import {loadAnalysisJob} from '../store/engineStore.ts';
import type {AnalysisJob} from '../types/blueprint.ts';
import type {EffectiveFlagsEnv} from '../lib/effectiveFlags.ts';

const GEMINI = `https://${GEMINI_HOST}/v1beta/models/m:generateContent`;
let n = 0;
const video = () => `https://cdn.test/v${(n += 1)}.mp4`;

async function finished(job: AnalysisJob): Promise<AnalysisJob> {
  let current: AnalysisJob | null = job;
  await vi.waitFor(
    async () => {
      current = await loadAnalysisJob(job.analysisJobId);
      expect(['done', 'failed']).toContain(current?.status);
    },
    {timeout: 3000, interval: 5},
  );
  return current!;
}

const analyze = (style: EditStyleId | undefined, videoUrl = video(), extra: Record<string, unknown> = {}) =>
  startAnalysis({userId: 'u1', videoUrl, languageCode: 'en' as never, useCache: true, ...(style ? {style} : {}), ...(style === 'basic_captions' ? {basicCaptions: true} : {}), ...extra});

/** A stage asking Gemini `times` times through the real chokepoint and falling back on a refusal (what every real stage's catch does). */
function stage(label: string, times = 1): {sent: number; refused: number} {
  let sent = 0;
  let refused = 0;
  for (let i = 0; i < times; i += 1) {
    try {
      reserveGeminiAttempt(GEMINI, label, 'internal');
      sent += 1;
    } catch {
      refused += 1;
    }
  }
  return {sent, refused};
}

const SERVER_WIDE_ON = {POLISH_FACELESS_DOC: true, POLISH_NEWSROOM_MG: true, POLISH_SUBJECT_STAGE: true, POLISH_RISO_TEMPLATES: true, MOTION_GRAPHICS_ENABLED: true, POLISH_KINETIC_LED: true};
const RESET = {POLISH_FACELESS_DOC: false, POLISH_NEWSROOM_MG: false, POLISH_SUBJECT_STAGE: false, POLISH_RISO_TEMPLATES: false, MOTION_GRAPHICS_ENABLED: false, POLISH_KINETIC_LED: false};

beforeEach(() => {
  state.calls = [];
  state.behave = async () => [];
  state.matteConfigured = false;
  Object.assign(state.env, RESET, {GEMINI_EDIT_MAX_REQUESTS: 0, PRODUCT_EDIT_PROFILE: 'cuts', EDIT_STYLES_ENGINE_FLAGS: true, CLAUDE_EDIT_BUDGET_USD: 5});
});

describe('requests with no style are unchanged', () => {
  it('env profile, env flags, no budget when the env sets none, no style fields on the job', async () => {
    Object.assign(state.env, SERVER_WIDE_ON, {PRODUCT_EDIT_PROFILE: 'polish'});
    const done = await finished(await analyze(undefined));
    expect(done.status).toBe('done');
    const {input, budget} = state.calls[0]!;
    expect(input.editProfile).toBe('polish');
    expect(input.effectiveFlags).toEqual(effectiveFlagsFromEnv(state.env as unknown as EffectiveFlagsEnv, 'polish'));
    expect(budget).toBeNull();
    for (const key of ['style', 'styleApplied', 'degraded', 'degradedReasons']) expect(done).not.toHaveProperty(key);
  });
  it('with an env cap, the env budget exactly as before (the profile plan)', async () => {
    Object.assign(state.env, {GEMINI_EDIT_MAX_REQUESTS: 8, PRODUCT_EDIT_PROFILE: 'polish'});
    await finished(await analyze(undefined));
    expect(state.calls[0]!.budget).toMatchObject({maxRequests: 8, reservedAtStart: {keep_plan: 1, director_story: 1, director_creative: 1, motion_director: 1, occupancy: 1, content_profile: 1}});
  });
});

describe('each style resolves its own flags and Gemini cap (engine flags on, every risky env flag ON server-wide)', () => {
  beforeEach(() => Object.assign(state.env, SERVER_WIDE_ON, {PRODUCT_EDIT_PROFILE: 'polish'}));

  it('basic_captions: legacy, zero Gemini budget', async () => {
    const done = await finished(await analyze('basic_captions'));
    const {input, budget} = state.calls[0]!;
    expect(input).toMatchObject({editProfile: 'legacy', basicCaptions: true});
    expect(budget).toMatchObject({maxRequests: 0});
    expect(done).toMatchObject({style: 'basic_captions', styleApplied: 'basic_captions', degraded: false, degradedReasons: []});
  });

  it('ai_clean_cut: pinned to cuts on a polish server; cap 3 with the keep plan reserved; no lanes', async () => {
    const done = await finished(await analyze('ai_clean_cut'));
    const {input, budget} = state.calls[0]!;
    expect(input.editProfile).toBe('cuts');
    expect(input.effectiveFlags).toMatchObject({profile: 'cuts', motionGraphics: false, facelessDoc: false, newsroomMg: false, kineticLed: false, explainerSkill: false, motionTemplates: false});
    expect(budget).toMatchObject({maxRequests: 3, reservedAtStart: {keep_plan: 1}, poolAtStart: 2});
    expect(done).toMatchObject({editProfile: 'cuts', style: 'ai_clean_cut', degraded: false});
  });

  it('kinetic_typography: polish, Kinetic-Led + templates + library-only graphics; Documentary / Newsroom / Subject Stage off; cap 12', async () => {
    Object.assign(state.env, {PRODUCT_EDIT_PROFILE: 'cuts'});
    state.matteConfigured = true;
    await finished(await analyze('kinetic_typography'));
    const {input, budget} = state.calls[0]!;
    expect(input.editProfile).toBe('polish');
    expect(input.effectiveFlags).toMatchObject({
      profile: 'polish', motionGraphics: true, libraryOnlyGraphics: true, kineticLed: true, motionTemplates: true, explainerSkill: false,
      facelessDoc: false, newsroomMg: false, subjectStage: false, risoTemplates: false,
    });
    expect(budget).toMatchObject({maxRequests: 12, poolAtStart: 6});
  });

  it('explainer: polish, explainer skill + templates + library-only graphics, no Kinetic-Led; cap 12', async () => {
    await finished(await analyze('explainer'));
    const {input, budget} = state.calls[0]!;
    expect(input.effectiveFlags).toMatchObject({profile: 'polish', motionGraphics: true, libraryOnlyGraphics: true, explainerSkill: true, motionTemplates: true, kineticLed: false, facelessDoc: false, newsroomMg: false});
    expect(budget).toMatchObject({maxRequests: 12});
  });

  it('a positive env cap can tighten a style cap, never loosen it', async () => {
    Object.assign(state.env, {GEMINI_EDIT_MAX_REQUESTS: 5});
    await finished(await analyze('explainer'));
    Object.assign(state.env, {GEMINI_EDIT_MAX_REQUESTS: 50});
    await finished(await analyze('explainer'));
    expect(state.calls.map(call => (call.budget as {maxRequests: number}).maxRequests)).toEqual([5, 12]);
  });
});

describe('the engine kill switch off: Phase 1 behaviour', () => {
  it('Kinetic runs on the env profile and env flags with the env budget, degraded engine_flags_off', async () => {
    Object.assign(state.env, {EDIT_STYLES_ENGINE_FLAGS: false, PRODUCT_EDIT_PROFILE: 'cuts', POLISH_FACELESS_DOC: true});
    const done = await finished(await analyze('kinetic_typography'));
    const {input, budget} = state.calls[0]!;
    expect(input.editProfile).toBe('cuts');
    expect(input.effectiveFlags).toEqual(effectiveFlagsFromEnv(state.env as unknown as EffectiveFlagsEnv, 'cuts'));
    expect(budget).toBeNull();
    expect(done).toMatchObject({style: 'kinetic_typography', styleApplied: 'ai_clean_cut', degraded: true, degradedReasons: ['engine_flags_off']});
  });
});

describe('hitting the Gemini cap mid-run never fails the job', () => {
  it('today: a refusal is thrown to the stage before any request leaves; the stage falls back and the job completes. Styled jobs report which stage', async () => {
    // 14 attempts against a cap of 12: the 6 reserved stages get theirs, the pool (6) takes the first 6 others, then the rest are refused.
    state.behave = async () => {
      for (const label of ['cuts ai keep plan', 'Director v2 story analyst', 'Director v2 creative director', 'motion graphics director', 'Gemini speaker occupancy', 'content profile']) stage(label);
      stage('asset describe', 6);
      const late = stage('Director v2 creative director', 2); // a repair after the pool is empty: refused, the stage keeps its first answer
      expect(late).toEqual({sent: 0, refused: 2});
      return ['polish_kinetic_led:on', 'kinetic_type:foreground:1_spans'];
    };
    const done = await finished(await analyze('kinetic_typography'));
    expect(done.status).toBe('done');
    expect(done).toMatchObject({degraded: true, degradedReasons: ['gemini_cap_reached:director_creative']});
  });

  it('a cache hit reports what the run that made the blueprint reported (the refusals are stored beside it)', async () => {
    const url = video();
    state.behave = async () => {
      stage('cuts ai keep plan', 5); // cap 3: 2 refused
      return [];
    };
    const first = await finished(await analyze('ai_clean_cut', url));
    expect(first.degradedReasons).toEqual(['gemini_cap_reached:keep_plan']);
    const second = await finished(await analyze('ai_clean_cut', url));
    expect(second.cached).toBe(true);
    expect(state.calls).toHaveLength(1);
    expect(second).toMatchObject({style: 'ai_clean_cut', degraded: true, degradedReasons: ['gemini_cap_reached:keep_plan']});
  });

  it('Kinetic with no matte backend (no RVM) completes front-only, degraded with a reason', async () => {
    state.matteConfigured = false;
    state.behave = async () => ['polish_kinetic_led:on'];
    const done = await finished(await analyze('kinetic_typography'));
    expect(done).toMatchObject({status: 'done', degraded: true, degradedReasons: ['kinetic_front_only:no_matte']});
  });
});

describe('cache keys and isolation', () => {
  it('each style has its own key, distinct from the unstyled key; the same style hits its own entry', async () => {
    const url = video();
    for (const style of [undefined, ...EDIT_STYLE_IDS]) await finished(await analyze(style, url));
    expect(state.calls).toHaveLength(1 + EDIT_STYLE_IDS.length); // no cross-style hit
    for (const style of [undefined, ...EDIT_STYLE_IDS]) expect((await finished(await analyze(style, url))).cached).toBe(true);
    expect(state.calls).toHaveLength(1 + EDIT_STYLE_IDS.length);
  });

  it('engine flags off: a styled job shares the Phase 1 key (style not in the key)', async () => {
    Object.assign(state.env, {EDIT_STYLES_ENGINE_FLAGS: false});
    const url = video();
    await finished(await analyze('ai_clean_cut', url));
    const hit = await finished(await analyze(undefined, url));
    expect(hit.cached).toBe(true);
  });

  it('two concurrent styled analyses each get their own flags and budget', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    state.behave = async input => {
      await gate; // both are inside their scopes at the same time
      const flags = input.effectiveFlags as {kineticLed: boolean; explainerSkill: boolean};
      stage(flags.kineticLed ? 'Director v2 story analyst' : 'content profile', 20);
      return flags.kineticLed ? ['polish_kinetic_led:on', 'kinetic_type:foreground:1_spans'] : [];
    };
    const [kinetic, explainer] = await Promise.all([analyze('kinetic_typography'), analyze('explainer')]);
    await vi.waitFor(() => expect(state.calls).toHaveLength(2));
    release();
    const [k, e] = await Promise.all([finished(kinetic), finished(explainer)]);
    const byStyle = Object.fromEntries(state.calls.map(call => [(call.input.effectiveFlags as {kineticLed: boolean}).kineticLed ? 'kinetic' : 'explainer', call.input]));
    expect(byStyle.kinetic!.effectiveFlags).toMatchObject({kineticLed: true, explainerSkill: false});
    expect(byStyle.explainer!.effectiveFlags).toMatchObject({kineticLed: false, explainerSkill: true});
    expect(k.degradedReasons).toEqual(['gemini_cap_reached:director_story']);
    expect(e.degradedReasons).toEqual(['gemini_cap_reached:content_profile']);
  });
});
