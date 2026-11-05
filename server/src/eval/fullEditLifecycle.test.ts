/**
 * Durable Pro full edit (mode `full_edit`): awaiting_upload → analyzing → awaiting_assets → rendering → done | failed.
 * Store, analysis, render and the Creators-API notifier are mocked: no network, no model call, no render.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const db = vi.hoisted(() => ({
  jobs: new Map<string, unknown>(),
  blueprints: new Map<string, unknown>(),
  analysis: new Map<string, unknown>(),
}));
const mocks = vi.hoisted(() => ({
  startAnalysis: vi.fn(),
  startRender: vi.fn(),
  loadRenderJob: vi.fn(),
  notify: vi.fn(),
  saveBlueprint: vi.fn(),
  burn: vi.fn(),
}));

vi.mock('../store/engineStore.ts', () => ({
  loadCaptionsEditJob: async (id: string) => structuredClone(db.jobs.get(id) ?? null),
  saveCaptionsEditJob: async (job: {editJobId: string}) => {
    db.jobs.set(job.editJobId, structuredClone(job));
  },
  loadAnalysisJob: async (id: string) => structuredClone(db.analysis.get(id) ?? null),
  loadBlueprint: async (id: string) => structuredClone(db.blueprints.get(id) ?? null),
  saveBlueprint: async (...args: unknown[]) => mocks.saveBlueprint(...args),
  saveDurableBlueprint: async () => undefined,
  loadDurableBlueprint: async () => null,
}));
vi.mock('../lib/entitlement.ts', () => ({checkFullEditForWorker: async () => 'allow'}));
vi.mock('../pipeline/analysisRunner.ts', () => ({startAnalysis: (...a: unknown[]) => mocks.startAnalysis(...a)}));
vi.mock('../pipeline/renderRunner.ts', () => ({
  startRender: (...a: unknown[]) => mocks.startRender(...a),
  loadRenderJob: (...a: unknown[]) => mocks.loadRenderJob(...a),
  refreshRenderJob: async (job: unknown) => job,
}));
vi.mock('../http/notifyCreator.ts', () => ({notifyCreatorEditDone: (...a: unknown[]) => mocks.notify(...a)}));
vi.mock('../pipeline/captionKitBurn.ts', () => ({burnCaptionKitVideo: (...a: unknown[]) => mocks.burn(...a)}));
vi.mock('../storage/r2.ts', () => ({
  presignSourceVideo: async () => ({key: 'k', publicUrl: 'https://cdn/src.mp4', uploadUrl: 'https://up'}),
  sourceObjectExists: async () => true,
}));

import {
  createCaptionsEditJob,
  loadCaptionsEditJob,
  markCaptionsSourceUploaded,
  retryFullEdit,
  submitFullEditAssets,
} from '../pipeline/captionsEditRunner.ts';

const SLOT = {id: 'slot_1', kind: 'logo', label: 'Your logo', status: 'needed', required: false, reason: 'x'};

function blueprint(id: string, slots: unknown[]) {
  return {
    blueprintId: id,
    outputDurationSec: 20,
    captionWords: [],
    captionDirection: {bottomFrac: 0.2},
    assetBrief: {version: 1, outputDurationSec: 20, slots},
  };
}

function analysisDone(analysisJobId: string, bp: unknown) {
  db.analysis.set(analysisJobId, {analysisJobId, status: 'done', progress: 1, blueprint: bp});
}

async function start(userId = 'u1') {
  const {job} = await createCaptionsEditJob({
    userId,
    contentType: 'video/mp4',
    languageCode: 'en' as never,
    captionTemplate: 'karaoke' as never,
    mode: 'full_edit',
    fullEdit: {renderFlags: {brollEnabled: true, zoomEnabled: true, trimEnabled: true}},
  });
  return job.editJobId;
}

async function settled(editJobId: string, ...statuses: string[]) {
  await vi.waitFor(
    async () => {
      const job = (await loadCaptionsEditJob(editJobId))!;
      expect(statuses).toContain(job.status);
    },
    {timeout: 4000, interval: 15},
  );
  return (await loadCaptionsEditJob(editJobId))!;
}

const sent = () => mocks.notify.mock.calls.map(call => call[0] as Record<string, unknown>);

beforeEach(() => {
  db.jobs.clear();
  db.blueprints.clear();
  db.analysis.clear();
  vi.clearAllMocks();
  mocks.startAnalysis.mockImplementation(async () => ({analysisJobId: `an_${mocks.startAnalysis.mock.calls.length}`}));
  mocks.startRender.mockImplementation(async () => ({renderJobId: `r_${mocks.startRender.mock.calls.length}`}));
  mocks.loadRenderJob.mockImplementation(async (id: string) => ({
    renderJobId: id,
    status: 'done',
    progress: 1,
    outputUrl: 'https://cdn/out.mp4',
    outputDurationSec: 19,
  }));
});

describe('full edit: analysis with asset slots stops at the server-owned gate', () => {
  it('persists the blueprint and brief, enters awaiting_assets and sends exactly one assets_needed push', async () => {
    const bp = blueprint('bp1', [SLOT]);
    db.blueprints.set('bp1', bp);
    analysisDone('an_1', bp);
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');

    const job = await settled(id, 'awaiting_assets');
    expect(job.blueprintId).toBe('bp1');
    expect(job.assetBrief?.slots).toHaveLength(1);
    expect(mocks.startRender).not.toHaveBeenCalled();
    expect(sent()).toEqual([
      expect.objectContaining({type: 'assets_needed', status: 'awaiting_assets', editJobId: id, blueprintId: 'bp1', userId: 'u1'}),
    ]);

    // a status read / resume never re-sends it
    await markCaptionsSourceUploaded(id, 'u1');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(sent().filter(n => n.type === 'assets_needed')).toHaveLength(1);
  });

  it('no slots: renders straight away and sends only edit_done', async () => {
    const bp = blueprint('bp2', []);
    db.blueprints.set('bp2', bp);
    analysisDone('an_1', bp);
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');

    const job = await settled(id, 'done');
    expect(job.outputUrl).toBe('https://cdn/out.mp4');
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([
      expect.objectContaining({type: 'edit_done', status: 'done', outputUrl: 'https://cdn/out.mp4', blueprintId: 'bp2'}),
    ]);
  });
});

describe('full edit: answering the gate', () => {
  async function gated() {
    const bp = blueprint('bp1', [SLOT]);
    db.blueprints.set('bp1', bp);
    analysisDone('an_1', bp);
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    await settled(id, 'awaiting_assets');
    return id;
  }

  it('skip: persists the bindings, resumes the render without re-analyzing, notifies edit_done once', async () => {
    const id = await gated();
    await submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true});
    const job = await settled(id, 'done');

    expect(job.labeledAssetBindings).toEqual([{slotId: 'slot_1', status: 'skipped'}]);
    expect(mocks.startAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlueprint).toHaveBeenCalledTimes(1); // bindings persisted on the blueprint
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
    expect(sent().map(n => n.type)).toEqual(['assets_needed', 'edit_done']);
  });

  it('uploaded assets: analyzes again with the bindings (no cache), then renders', async () => {
    const id = await gated();
    const bp2 = blueprint('bp2', [{...SLOT, status: 'uploaded'}]);
    db.blueprints.set('bp2', bp2);
    analysisDone('an_2', bp2);
    const bindings = [{slotId: 'slot_1', status: 'uploaded' as const, assetUrl: 'https://cdn/logo.png', kind: 'logo' as const}];
    await submitFullEditAssets({editJobId: id, userId: 'u1', bindings});
    const job = await settled(id, 'done');

    expect(mocks.startAnalysis).toHaveBeenCalledTimes(2);
    const second = mocks.startAnalysis.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.useCache).toBe(false);
    expect(second.labeledAssetBindings).toEqual(bindings);
    expect(second.userBrollUrls).toContain('https://cdn/logo.png');
    expect(job.blueprintId).toBe('bp2');
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
  });

  it('duplicate submissions render once', async () => {
    const id = await gated();
    await Promise.all([
      submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true}),
      submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true}),
      submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true}),
    ]);
    await settled(id, 'done');
    await submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true}); // after done: a no-op
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
    expect(sent().filter(n => n.type === 'edit_done')).toHaveLength(1);
  });

  it("another creator can't touch the job", async () => {
    const id = await gated();
    await expect(submitFullEditAssets({editJobId: id, userId: 'intruder', skipAll: true})).rejects.toMatchObject({code: 'not_found'});
    await expect(retryFullEdit({editJobId: id, userId: 'intruder'})).rejects.toMatchObject({code: 'not_found'});
    expect((await loadCaptionsEditJob(id))!.status).toBe('awaiting_assets');
  });
});

describe('full edit: failure and retry', () => {
  it('a failed analysis becomes failed with one edit_failed push', async () => {
    mocks.startAnalysis.mockImplementation(async () => ({analysisJobId: 'an_bad'}));
    db.analysis.set('an_bad', {analysisJobId: 'an_bad', status: 'failed', progress: 0.3, errorCode: 'analysis_failed', errorMessage: 'No speech'});
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    const job = await settled(id, 'failed');

    expect(job.errorMessage).toBe('No speech');
    expect(sent()).toEqual([expect.objectContaining({type: 'edit_failed', status: 'failed', editJobId: id})]);
  });

  it('a transient start error is retried once and does not fail the job', async () => {
    const bp = blueprint('bp1', []);
    db.blueprints.set('bp1', bp);
    analysisDone('an_ok', bp);
    mocks.startAnalysis
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockImplementation(async () => ({analysisJobId: 'an_ok'}));
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    await settled(id, 'done');
    expect(sent().map(n => n.type)).toEqual(['edit_done']);
  });

  it('retry after a failed render re-renders from the saved plan and can notify again', async () => {
    const bp = blueprint('bp1', []);
    db.blueprints.set('bp1', bp);
    analysisDone('an_1', bp);
    mocks.loadRenderJob.mockImplementationOnce(async (renderJobId: string) => ({
      renderJobId,
      status: 'failed',
      progress: 0.2,
      errorCode: 'render_failed',
      errorMessage: 'Out of memory',
    }));
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    const failed = await settled(id, 'failed');
    expect(failed.blueprintId).toBe('bp1');

    await retryFullEdit({editJobId: id, userId: 'u1'});
    const done = await settled(id, 'done');
    expect(done.outputUrl).toBe('https://cdn/out.mp4');
    expect(mocks.startAnalysis).toHaveBeenCalledTimes(1); // resumed from the render, not re-analyzed
    expect(sent().map(n => n.type)).toEqual(['edit_failed', 'edit_done']);
  });

  it('retry is idempotent for a job that is not failed', async () => {
    const bp = blueprint('bp1', []);
    db.blueprints.set('bp1', bp);
    analysisDone('an_1', bp);
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    await settled(id, 'done');
    const job = await retryFullEdit({editJobId: id, userId: 'u1'});
    expect(job.status).toBe('done');
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
  });
});

describe('captions jobs keep their behavior (regression)', () => {
  it('a failed captions job notifies exactly as before: no type, status failed', async () => {
    mocks.startAnalysis.mockImplementation(async () => ({analysisJobId: 'an_bad'}));
    db.analysis.set('an_bad', {analysisJobId: 'an_bad', status: 'failed', progress: 0.3, errorMessage: 'No speech'});
    const {job} = await createCaptionsEditJob({
      userId: 'u1',
      contentType: 'video/mp4',
      languageCode: 'en' as never,
      captionTemplate: 'karaoke' as never,
      mode: 'captions',
    });
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    await settled(job.editJobId, 'failed');
    expect(sent()).toEqual([{userId: 'u1', editJobId: job.editJobId, status: 'failed', errorMessage: 'No speech'}]);
    expect(sent()[0]).not.toHaveProperty('type');
  });

  it('a done captions job notifies with no type and the output url', async () => {
    const bp = blueprint('bpc', []);
    db.blueprints.set('bpc', bp);
    analysisDone('an_1', bp);
    const {job} = await createCaptionsEditJob({
      userId: 'u1',
      contentType: 'video/mp4',
      languageCode: 'en' as never,
      captionTemplate: 'karaoke' as never,
      mode: 'basic_captions',
    });
    await markCaptionsSourceUploaded(job.editJobId, 'u1');
    await settled(job.editJobId, 'done');
    expect(sent()).toEqual([{userId: 'u1', editJobId: job.editJobId, status: 'done', outputUrl: 'https://cdn/out.mp4'}]);
  });

  it('asset submission is refused for a captions job', async () => {
    const {job} = await createCaptionsEditJob({
      userId: 'u1',
      contentType: 'video/mp4',
      languageCode: 'en' as never,
      captionTemplate: 'karaoke' as never,
      mode: 'captions',
    });
    await expect(submitFullEditAssets({editJobId: job.editJobId, userId: 'u1', skipAll: true})).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
});
