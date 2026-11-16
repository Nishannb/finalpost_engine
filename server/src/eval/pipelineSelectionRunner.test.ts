/**
 * Phase 5.23: the editing-pipeline selection through the REAL job runner (`startAnalysis`, the real memory store and style resolution). `analyzeVideo` is a stand-in that records
 * its input (same harness as editStylesAnalysis.test.ts). No network, no model call.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  calls: [] as Array<Record<string, unknown>>,
  warnings: [] as string[],
}));

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  state.env = {...actual.env, REDIS_URL: '', GEMINI_EDIT_MAX_REQUESTS: 0, PRODUCT_EDIT_PROFILE: 'polish', EDIT_STYLES_ENGINE_FLAGS: true, CLAUDE_EDIT_BUDGET_USD: 0};
  return {...actual, env: state.env};
});
vi.mock('../stages/render/renderBudget.ts', () => ({assertAnalysisAllowed: async () => {}, recordAnalysis: async () => {}}));
vi.mock('../media/personMatte.ts', () => ({subjectMatteConfigured: () => true}));
vi.mock('../pipeline/analyzeVideo.ts', () => ({
  analyzeVideo: async (input: Record<string, unknown>) => {
    state.calls.push(input);
    return {blueprintId: `bp_${state.calls.length}`, createdAt: new Date().toISOString(), stats: {warnings: state.warnings}, captionWords: [], outputDurationSec: 10};
  },
}));

import {startAnalysis} from '../pipeline/analysisRunner.ts';
import {loadAnalysisJob} from '../store/engineStore.ts';
import type {AnalysisJob} from '../types/blueprint.ts';
import type {EditStyleId} from '../lib/editStyles.ts';

let n = 0;
async function run(style: EditStyleId | undefined): Promise<{input: Record<string, unknown>; job: AnalysisJob}> {
  const job = await startAnalysis({userId: 'u1', videoUrl: `https://cdn.test/p523-${(n += 1)}.mp4`, languageCode: 'en' as never, useCache: false, ...(style ? {style} : {})});
  let current: AnalysisJob | null = job;
  await vi.waitFor(async () => {
    current = await loadAnalysisJob(job.analysisJobId);
    expect(['done', 'failed']).toContain(current?.status);
  }, {timeout: 3000, interval: 5});
  return {input: state.calls[state.calls.length - 1]!, job: current!};
}

beforeEach(() => {
  state.calls = [];
  state.warnings = [];
  // every pipeline flag ON server-wide: the selection, not the env, must decide
  Object.assign(state.env, {POLISH_KINETIC_ENGINE: true, POLISH_KINETIC_LED: true, POLISH_SUBJECT_STAGE: true, POLISH_MOTION_TEMPLATES: true, MOTION_GRAPHICS_ENABLED: true});
});

describe('the selected pipeline reaches analyzeVideo (every pipeline flag on server-wide)', () => {
  it('kinetic_typography (alias kinetic_v2): editingPipeline kinetic_v2, Subject Stage off in the job flags', async () => {
    const {input, job} = await run('kinetic_typography');
    expect(input.editingPipeline).toBe('kinetic_v2');
    expect(input.effectiveFlags).toMatchObject({kineticLed: true, kineticEngine: true, subjectStage: false});
    expect(job).toMatchObject({style: 'kinetic_typography', styleApplied: 'kinetic_typography'});
  });
  it('subject_stage: editingPipeline subject_stage; the Kinetic V2 engine and Kinetic-Led are off in the job flags; a stage that ran is honoured', async () => {
    state.warnings = ['editing_pipeline:subject_stage:selected', 'polish_subject_stage:on'];
    const {input, job} = await run('subject_stage');
    expect(input.editingPipeline).toBe('subject_stage');
    expect(input.editProfile).toBe('polish');
    expect(input.effectiveFlags).toMatchObject({subjectStage: true, kineticEngine: false, kineticLed: false, motionTemplates: false, motionGraphics: false});
    expect(job).toMatchObject({style: 'subject_stage', styleApplied: 'subject_stage', degraded: false});
  });
  it('subject_stage whose stage was skipped: degraded with the reason (never a silent fall-through to another pipeline)', async () => {
    state.warnings = ['editing_pipeline:subject_stage:selected', 'polish_subject_stage:skipped:matte_unavailable'];
    const {job} = await run('subject_stage');
    expect(job).toMatchObject({degraded: true, degradedReasons: ['subject_stage_skipped:matte_unavailable']});
  });
  it('a style without a pipeline passes "none"; no style passes nothing (the env path, unchanged)', async () => {
    expect((await run('explainer')).input.editingPipeline).toBe('none');
    const {input} = await run(undefined);
    expect(input).not.toHaveProperty('editingPipeline');
  });
});
