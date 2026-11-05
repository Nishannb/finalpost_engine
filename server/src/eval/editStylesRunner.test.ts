/**
 * Edit styles inside the edit runner (Phase 1 boundary): the job record keeps `style` / `degraded`, the style id is carried
 * to startAnalysis untouched, and a Pro style is re-checked against the plan right before work starts.
 * Store, analysis, render and R2 are mocked: no network, no model call, no render.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const db = vi.hoisted(() => ({jobs: new Map<string, unknown>(), analysis: new Map<string, unknown>(), blueprints: new Map<string, unknown>()}));
const mocks = vi.hoisted(() => ({startAnalysis: vi.fn(), startRender: vi.fn(), verdict: vi.fn()}));

vi.mock('../store/engineStore.ts', () => ({
  loadCaptionsEditJob: async (id: string) => structuredClone(db.jobs.get(id) ?? null),
  saveCaptionsEditJob: async (job: {editJobId: string}) => {
    db.jobs.set(job.editJobId, structuredClone(job));
  },
  loadAnalysisJob: async (id: string) => structuredClone(db.analysis.get(id) ?? null),
  loadBlueprint: async (id: string) => structuredClone(db.blueprints.get(id) ?? null),
  saveBlueprint: async () => undefined,
  grantBlueprintAccess: async () => undefined,
  saveDurableBlueprint: async () => undefined,
  loadDurableBlueprint: async () => null,
}));
vi.mock('../lib/entitlement.ts', () => ({checkFullEditForWorker: (...a: unknown[]) => mocks.verdict(...a)}));
vi.mock('../pipeline/analysisRunner.ts', () => ({startAnalysis: (...a: unknown[]) => mocks.startAnalysis(...a)}));
vi.mock('../pipeline/renderRunner.ts', () => ({
  startRender: (...a: unknown[]) => mocks.startRender(...a),
  loadRenderJob: async (id: string) => ({renderJobId: id, status: 'done', progress: 1, outputUrl: 'https://cdn/out.mp4', outputDurationSec: 9}),
  refreshRenderJob: async (job: unknown) => job,
}));
vi.mock('../http/notifyCreator.ts', () => ({notifyCreatorEditDone: async () => undefined}));
vi.mock('../pipeline/captionKitBurn.ts', () => ({burnCaptionKitVideo: async () => ({outputUrl: 'https://cdn/burned.mp4'})}));
vi.mock('../storage/r2.ts', () => ({
  presignSourceVideo: async () => ({key: 'k', publicUrl: 'https://cdn/src.mp4', uploadUrl: 'https://up'}),
  sourceObjectExists: async () => true,
}));

import {createCaptionsEditJob, loadCaptionsEditJob, markCaptionsSourceUploaded} from '../pipeline/captionsEditRunner.ts';

const BP = {blueprintId: 'bp1', outputDurationSec: 9, captionWords: [{text: 'hi', start: 0, end: 0.4}], captionDirection: {bottomFrac: 0.2}, assetBrief: {version: 1, outputDurationSec: 9, slots: []}};

async function settled(editJobId: string, ...statuses: string[]) {
  await vi.waitFor(
    async () => {
      expect(statuses).toContain((await loadCaptionsEditJob(editJobId))!.status);
    },
    {timeout: 4000, interval: 15},
  );
  return (await loadCaptionsEditJob(editJobId))!;
}

beforeEach(() => {
  db.jobs.clear();
  db.analysis.clear();
  db.blueprints.clear();
  vi.clearAllMocks();
  mocks.verdict.mockResolvedValue('allow');
  mocks.startAnalysis.mockImplementation(async () => {
    const analysisJobId = `an_${mocks.startAnalysis.mock.calls.length}`;
    db.analysis.set(analysisJobId, {analysisJobId, status: 'done', progress: 1, blueprint: BP});
    db.blueprints.set('bp1', BP);
    return {analysisJobId};
  });
  mocks.startRender.mockImplementation(async () => ({renderJobId: 'r_1'}));
});

const create = (extra: Record<string, unknown>) =>
  createCaptionsEditJob({userId: 'u1', contentType: 'video/mp4', languageCode: 'en' as never, captionTemplate: 'karaoke' as never, ...extra} as never);

describe('edit runner: style on the job record and into the analysis', () => {
  it('a styled full edit keeps style + degraded on the job and carries the style to startAnalysis untouched', async () => {
    const degraded = {reason: 'engine_style_pending', appliedAs: 'ai_clean_cut'} as const;
    const {job} = await create({mode: 'full_edit', style: 'kinetic_typography', degraded, fullEdit: {renderFlags: {brollEnabled: true, zoomEnabled: true, trimEnabled: true}}});
    expect(job).toEqual(expect.objectContaining({mode: 'full_edit', style: 'kinetic_typography', degraded}));
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    const done = await settled(job.editJobId, 'done', 'failed');
    expect(done.status).toBe('done');
    expect(done).toEqual(expect.objectContaining({style: 'kinetic_typography', degraded}));
    expect(mocks.startAnalysis).toHaveBeenCalledWith(expect.objectContaining({style: 'kinetic_typography'}));
    expect(mocks.verdict).toHaveBeenCalled(); // full_edit re-checks the plan before paid work
  });

  it('Basic Captions keeps the lean path: basicCaptions analysis with the style carried, no plan check', async () => {
    const {job} = await create({mode: 'basic_captions', style: 'basic_captions', captionPreset: undefined});
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    await vi.waitFor(() => expect(mocks.startAnalysis).toHaveBeenCalled(), {timeout: 4000, interval: 15});
    expect(mocks.startAnalysis).toHaveBeenCalledWith(expect.objectContaining({basicCaptions: true, style: 'basic_captions'}));
    expect(mocks.verdict).not.toHaveBeenCalled();
  });

  it('a mode-only job (older app) has no style and passes none to the analysis', async () => {
    const {job} = await create({mode: 'basic_captions'});
    expect(job).not.toHaveProperty('style');
    expect(job).not.toHaveProperty('degraded');
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    await vi.waitFor(() => expect(mocks.startAnalysis).toHaveBeenCalled(), {timeout: 4000, interval: 15});
    expect(mocks.startAnalysis.mock.calls[0][0]).not.toHaveProperty('style');
  });

  it('degraded is never stored without a style', async () => {
    const {job} = await create({mode: 'full_edit', degraded: {reason: 'engine_style_pending', appliedAs: 'ai_clean_cut'}});
    expect(job).not.toHaveProperty('degraded');
  });

  it('a Pro style is refused in the worker when the plan is no longer Pro (fails before any analysis)', async () => {
    mocks.verdict.mockResolvedValue('deny');
    const {job} = await create({mode: 'full_edit', style: 'ai_clean_cut', fullEdit: {renderFlags: {brollEnabled: true, zoomEnabled: true, trimEnabled: true}}});
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    const failed = await settled(job.editJobId, 'failed');
    expect(failed.errorCode).toBe('pro_required');
    expect(mocks.startAnalysis).not.toHaveBeenCalled();
  });

  it('a Pro style that maps to a non-full_edit mode is still re-checked in the worker', async () => {
    mocks.verdict.mockResolvedValue('unavailable');
    const {job} = await create({mode: 'captions', style: 'ai_clean_cut'});
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    const failed = await settled(job.editJobId, 'failed');
    expect(failed.errorCode).toBe('entitlement_unavailable');
    expect(mocks.startAnalysis).not.toHaveBeenCalled();
  });
});
