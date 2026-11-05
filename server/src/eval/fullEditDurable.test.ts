/**
 * Durable storage, restart recovery, leases and idempotency of full edits. The real engineStore, KV and
 * runner run against an in-memory durable table (same contract as public.creator_edit_jobs); only the
 * analysis, render, Creators-API notifier and R2 layers are mocked. No network, no model call.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  startAnalysis: vi.fn(),
  startRender: vi.fn(),
  loadRenderJob: vi.fn(),
  notify: vi.fn(),
  verdict: {value: 'allow' as 'allow' | 'deny' | 'unavailable'},
  analysis: new Map<string, unknown>(),
}));

vi.mock('../pipeline/analysisRunner.ts', () => ({startAnalysis: (...a: unknown[]) => mocks.startAnalysis(...a)}));
vi.mock('../pipeline/renderRunner.ts', () => ({
  startRender: (...a: unknown[]) => mocks.startRender(...a),
  loadRenderJob: (...a: unknown[]) => mocks.loadRenderJob(...a),
  refreshRenderJob: async (job: unknown) => job,
}));
vi.mock('../http/notifyCreator.ts', () => ({notifyCreatorEditDone: (...a: unknown[]) => mocks.notify(...a)}));
vi.mock('../pipeline/captionKitBurn.ts', () => ({burnCaptionKitVideo: vi.fn()}));
vi.mock('../storage/r2.ts', () => ({
  presignSourceVideo: async () => ({key: 'k', publicUrl: 'https://cdn/src.mp4', uploadUrl: 'https://up'}),
  sourceObjectExists: async () => true,
}));
vi.mock('../lib/entitlement.ts', () => ({checkFullEditForWorker: async () => mocks.verdict.value}));
// analysis jobs live in the store too; keep the real store but serve analysis ids from the test.
vi.mock('../store/engineStore.ts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {...actual, loadAnalysisJob: async (id: string) => structuredClone(mocks.analysis.get(id) ?? null)};
});

import {
  createCaptionsEditJob,
  loadCaptionsEditJob,
  markCaptionsSourceUploaded,
  recoverFullEditJobs,
  retryFullEdit,
  submitFullEditAssets,
} from '../pipeline/captionsEditRunner.ts';
import {getKv} from '../store/kv.ts';
import {saveCaptionsEditJob, loadBlueprint, saveBlueprint} from '../store/engineStore.ts';
import {
  createMemoryJobStore,
  createPostgrestJobStore,
  setDurableJobStoreForTests,
} from '../store/durableJobs.ts';
import type {CaptionsEditJob} from '../types/blueprint.ts';

const DAY = 86_400_000;
let clock = Date.now();
let table: ReturnType<typeof createMemoryJobStore>;

const SLOT = {id: 'slot_1', kind: 'logo', label: 'Your logo', status: 'needed', required: false, reason: 'x'};
const bp = (id: string, slots: unknown[]) => ({
  blueprintId: id,
  outputDurationSec: 20,
  captionWords: [],
  captionDirection: {bottomFrac: 0.2},
  assetBrief: {version: 1, outputDurationSec: 20, slots},
});

async function expireKv(editJobId: string) {
  const kv = await getKv();
  await kv.del(`engine:edit:${editJobId}`); // what the 24h TTL (or a restart) does
}

async function idle(job: CaptionsEditJob, ms: number) {
  const aged = {...job, updatedAt: new Date(Date.now() - ms).toISOString()};
  await saveCaptionsEditJob(aged);
  return aged;
}

async function start(userId = 'u1') {
  const {job} = await createCaptionsEditJob({
    userId,
    contentType: 'video/mp4',
    languageCode: 'en' as never,
    captionTemplate: 'karaoke' as never,
    mode: 'full_edit',
  });
  return job.editJobId;
}

async function settled(editJobId: string, ...statuses: string[]) {
  await vi.waitFor(
    async () => {
      expect(statuses).toContain((await loadCaptionsEditJob(editJobId))!.status);
    },
    {timeout: 4000, interval: 15},
  );
  return (await loadCaptionsEditJob(editJobId))!;
}

const sent = () => mocks.notify.mock.calls.map(call => call[0] as Record<string, unknown>);

beforeEach(() => {
  clock = Date.now();
  table = createMemoryJobStore(() => clock);
  setDurableJobStoreForTests(table);
  mocks.analysis.clear();
  mocks.verdict.value = 'allow';
  vi.clearAllMocks();
  let n = 0;
  mocks.startAnalysis.mockImplementation(async () => ({analysisJobId: `an_${(n += 1)}`}));
  mocks.startRender.mockImplementation(async () => ({renderJobId: `r_${mocks.startRender.mock.calls.length}`}));
  mocks.loadRenderJob.mockImplementation(async (id: string) => ({renderJobId: id, status: 'done', progress: 1, outputUrl: 'https://cdn/out.mp4', outputDurationSec: 19}));
});
afterEach(() => setDurableJobStoreForTests(undefined));

async function gated(userId = 'u1') {
  mocks.analysis.set('an_1', {analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: bp('bp1', [SLOT])});
  const id = await start(userId);
  await markCaptionsSourceUploaded(id, userId);
  await settled(id, 'awaiting_assets');
  return id;
}

describe('durable persistence: the table, not the 24h KV, is the source of truth', () => {
  it('writes the whole job through on every save and keeps the fields a creator needs on return', async () => {
    const id = await gated();
    const row = (await table.get(id))!;
    expect(row.job).toMatchObject({
      editJobId: id,
      userId: 'u1',
      mode: 'full_edit',
      status: 'awaiting_assets',
      blueprintId: 'bp1',
      sourcePublicUrl: 'https://cdn/src.mp4',
    });
    expect(row.job.assetBrief?.slots).toHaveLength(1);
    expect(row.job.createdAt).toBeTruthy();
    expect(row.job.updatedAt).toBeTruthy();
    expect(row.blueprint).toMatchObject({blueprintId: 'bp1'}); // the plan is snapshotted next to the job
  });

  it('an awaiting_assets job survives the KV entry expiring and the engine restarting, days later', async () => {
    const id = await gated();
    await expireKv(id);
    clock += 5 * DAY; // the creator comes back several days later

    const job = await loadCaptionsEditJob(id);
    expect(job).toMatchObject({status: 'awaiting_assets', blueprintId: 'bp1', userId: 'u1'});
    expect(job!.assetBrief?.slots).toHaveLength(1);

    // KV was rehydrated, so the next read is the fast path again.
    const kv = await getKv();
    expect(await kv.get(`engine:edit:${id}`)).not.toBeNull();
  });

  it('after days, answering the gate still renders: the plan comes back from the durable snapshot', async () => {
    const id = await gated();
    await expireKv(id);
    expect(await loadBlueprint('bp1')).toBeNull(); // not in KV
    clock += 6 * DAY;

    await submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true});
    const done = await settled(id, 'done');
    expect(done.outputUrl).toBe('https://cdn/out.mp4');
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
    expect(mocks.startRender.mock.calls[0]![0]).toMatchObject({blueprintId: 'bp1', userId: 'u1'});
  });

  it('captions jobs are untouched: they are never written to the durable table', async () => {
    // This job's analysis never completes, so its background worker cannot leak into other tests.
    mocks.startAnalysis.mockImplementationOnce(async () => ({analysisJobId: 'never-completes'}));
    const {job} = await createCaptionsEditJob({
      userId: 'u1',
      contentType: 'video/mp4',
      languageCode: 'en' as never,
      captionTemplate: 'karaoke' as never,
      mode: 'basic_captions',
    });
    expect(await table.get(job.editJobId)).toBeNull();
    expect((await loadCaptionsEditJob(job.editJobId))!.mode).toBe('basic_captions');
    // A captions job is KV-only: nothing for the durable table to hand back even if KV forgot it.
    expect(await table.get(job.editJobId)).toBeNull();
  });

  it('without a durable store (local dev) full edits still work from KV', async () => {
    setDurableJobStoreForTests(null);
    const plan = bp('bpx', []);
    mocks.analysis.set('an_1', {analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: plan});
    await saveBlueprint(plan as never, 'fp-local'); // what the real analysis runner does
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    expect((await settled(id, 'done')).outputUrl).toBe('https://cdn/out.mp4');
  });
});

describe('retention', () => {
  it('keeps an awaiting job for days, expires it after the inactivity window, and deletes finished jobs much later', async () => {
    const id = await gated();
    // 5 days: untouched
    clock += 5 * DAY;
    expect(await table.purge()).toEqual({expired: 0, deleted: 0});
    expect((await table.get(id))!.job.status).toBe('awaiting_assets');

    // past the 30-day inactivity window: marked expired, not deleted
    clock += 30 * DAY;
    expect((await table.purge()).expired).toBe(1);
    const expired = (await table.get(id))!.job;
    expect(expired).toMatchObject({status: 'failed', errorCode: 'expired'});

    // finished jobs are deleted 90 days after they last changed
    clock += 100 * DAY;
    expect((await table.purge()).deleted).toBe(1);
    expect(await table.get(id)).toBeNull();
  });
});

describe('recovery after a restart', () => {
  async function stalledRender(userId = 'u1') {
    mocks.analysis.set('an_1', {analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: bp('bp2', [])});
    mocks.loadRenderJob.mockImplementation(async (id: string) => ({renderJobId: id, status: 'rendering', progress: 0.5}));
    const id = await start(userId);
    await markCaptionsSourceUploaded(id, userId);
    await vi.waitFor(async () => expect((await loadCaptionsEditJob(id))!.renderJobId).toBeTruthy(), {timeout: 4000, interval: 15});
    return id;
  }

  it('a worker that died mid-render is recovered from the table: it waits on the stored render, never starts another, and notifies once', async () => {
    const id = await stalledRender();
    const renders = mocks.startRender.mock.calls.length;
    // The engine "restarts": the in-process worker is gone, the KV is empty, the job is old.
    const stored = (await table.get(id))!.job;
    await expireKv(id);
    await table.upsert({...stored, status: 'rendering', updatedAt: new Date(Date.now() - 10 * 60_000).toISOString()});
    await table.releaseLease(id, 'engine-test'); // the dead worker's lease has long expired
    table.rows.get(id)!.leaseUntil = 0 as never;
    table.rows.get(id)!.leaseOwner = null as never;
    mocks.loadRenderJob.mockImplementation(async (rid: string) => ({renderJobId: rid, status: 'done', progress: 1, outputUrl: 'https://cdn/out.mp4', outputDurationSec: 19}));

    // (the earlier in-process poller is still looping in this test process; recovery must still be safe)
    await recoverFullEditJobs();
    const done = await settled(id, 'done');
    expect(done.outputUrl).toBe('https://cdn/out.mp4');
    expect(mocks.startRender.mock.calls.length).toBe(renders); // no second render
    expect(sent().filter(n => n.type === 'edit_done')).toHaveLength(1);
  });

  it('two recovery scans at once run the job once', async () => {
    const id = await stalledRender();
    const stored = (await table.get(id))!.job;
    await table.upsert({...stored, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString()});
    table.rows.get(id)!.leaseUntil = 0 as never;
    table.rows.get(id)!.leaseOwner = null as never;
    mocks.loadRenderJob.mockImplementation(async (rid: string) => ({renderJobId: rid, status: 'done', progress: 1, outputUrl: 'https://cdn/out.mp4'}));

    await Promise.all([recoverFullEditJobs(), recoverFullEditJobs(), recoverFullEditJobs()]);
    await settled(id, 'done');
    expect(mocks.startRender.mock.calls.length).toBe(1);
    expect(sent().filter(n => n.type === 'edit_done')).toHaveLength(1);
  });

  it('a job whose lease another worker holds is left alone', async () => {
    const id = await stalledRender();
    const stored = (await table.get(id))!.job;
    await table.upsert({...stored, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString()});
    table.rows.get(id)!.leaseUntil = 0 as never; // the in-test poller's lease, released
    table.rows.get(id)!.leaseOwner = null as never;
    expect(await table.claimLease(id, 'other-instance', 10 * 60_000)).toBe(true);
    expect(await table.claimLease(id, 'second-instance', 10 * 60_000)).toBe(false); // the lease is exclusive
    expect(await table.listRecoverable({idleMs: 120_000, limit: 10})).toEqual([]);
    expect(await recoverFullEditJobs()).toBe(0);
  });

  it('a job still waiting for its upload when the engine restarted is picked up again, without the phone or the app', async () => {
    mocks.analysis.set('an_1', {analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: bp('bp7', [])});
    const id = await start(); // created; the source has already landed in R2 (the mocked HEAD check says so)
    const created = (await table.get(id))!.job;
    // The "restart": drop the in-process poller's effect by re-creating the persisted state as it was, and age it.
    await expireKv(id);
    await table.upsert({...created, status: 'awaiting_upload', updatedAt: new Date(Date.now() - 10 * 60_000).toISOString()});
    table.rows.get(id)!.leaseUntil = 0 as never;
    table.rows.get(id)!.leaseOwner = null as never;
    expect(await table.listRecoverable({idleMs: 120_000, limit: 10})).toContain(id);

    await recoverFullEditJobs();
    const done = await settled(id, 'done');
    expect(done.outputUrl).toBe('https://cdn/out.mp4');
    expect(mocks.startAnalysis).toHaveBeenCalledTimes(1);
  });

  it('recent activity is never recovered (the live worker is still making progress)', async () => {
    const id = await stalledRender();
    expect(await table.listRecoverable({idleMs: 120_000, limit: 10})).not.toContain(id);
  });

  it('awaiting_assets is NEVER auto-resumed or auto-skipped, however old', async () => {
    const id = await gated();
    clock += 20 * DAY;
    const stored = (await table.get(id))!.job;
    await table.upsert({...stored, updatedAt: new Date(clock - 20 * DAY).toISOString()});
    expect(await table.listRecoverable({idleMs: 120_000, limit: 10})).toEqual([]);
    expect(await recoverFullEditJobs()).toBe(0);
    const job = (await loadCaptionsEditJob(id))!;
    expect(job.status).toBe('awaiting_assets');
    expect(job.labeledAssetBindings).toBeUndefined();
    expect(mocks.startRender).not.toHaveBeenCalled();
  });

  it('done and failed jobs are never picked up', async () => {
    const id = await gated();
    await submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true});
    await settled(id, 'done');
    expect(await table.listRecoverable({idleMs: 0, limit: 10})).toEqual([]);
    expect(await table.claimLease(id, 'anyone', 1000)).toBe(false);
  });

  it('after the creator answered but before the engine acted, recovery acts on the answer (it does not reuse the old plan or ask again)', async () => {
    const id = await gated();
    const stored = (await table.get(id))!.job;
    // answered with an uploaded asset, then the engine died before it started the new analysis
    await table.upsert({
      ...stored,
      status: 'analyzing',
      labeledAssetBindings: [{slotId: 'slot_1', status: 'uploaded', assetUrl: 'https://cdn/logo.png', kind: 'logo'}],
      assetsAnalysisStarted: false,
      updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    await expireKv(id);
    mocks.analysis.set('an_2', {analysisJobId: 'an_2', status: 'done', progress: 1, blueprint: bp('bp3', [{...SLOT, status: 'uploaded'}])});

    await recoverFullEditJobs();
    const done = await settled(id, 'done');
    expect(mocks.startAnalysis).toHaveBeenCalledTimes(2); // the original + exactly one with the bindings
    expect(mocks.startAnalysis.mock.calls[1]![0]).toMatchObject({useCache: false, labeledAssetBindings: expect.any(Array)});
    expect(done.blueprintId).toBe('bp3');
    expect(done.assetsAnalysisStarted).toBe(true);
  });
});

describe('terminal states and duplicates', () => {
  it('a finished job cannot be moved back to rendering by a stale worker', async () => {
    const id = await gated();
    await submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true});
    const done = await settled(id, 'done');
    await saveCaptionsEditJob({...done, status: 'rendering'});
    expect((await loadCaptionsEditJob(id))!.status).toBe('done');
    expect(sent().filter(n => n.type === 'edit_done')).toHaveLength(1);
  });

  it('only an explicit retry can reopen a failed job, and it resumes without a duplicate analysis', async () => {
    mocks.analysis.set('an_1', {analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: bp('bp9', [])});
    mocks.loadRenderJob.mockImplementationOnce(async (rid: string) => ({renderJobId: rid, status: 'failed', progress: 0.2, errorMessage: 'OOM'}));
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    await settled(id, 'failed');
    await saveCaptionsEditJob({...(await loadCaptionsEditJob(id))!, status: 'rendering'}); // not a retry: ignored
    expect((await loadCaptionsEditJob(id))!.status).toBe('failed');

    await retryFullEdit({editJobId: id, userId: 'u1'});
    await settled(id, 'done');
    expect(mocks.startAnalysis).toHaveBeenCalledTimes(1);
    expect(sent().map(n => n.type)).toEqual(['edit_failed', 'edit_done']);
  });

  it('duplicate answers to the gate render once and notify once', async () => {
    const id = await gated();
    await Promise.all(Array.from({length: 4}, () => submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true})));
    await settled(id, 'done');
    expect(mocks.startRender).toHaveBeenCalledTimes(1);
    expect(sent().filter(n => n.type === 'assets_needed')).toHaveLength(1);
    expect(sent().filter(n => n.type === 'edit_done')).toHaveLength(1);
  });
});

describe('the plan is checked again before paid work', () => {
  it("a creator who is no longer Pro when the render would start gets a failed job, no render and one edit_failed push", async () => {
    const id = await gated();
    mocks.verdict.value = 'deny'; // the subscription lapsed while the job waited for assets
    await submitFullEditAssets({editJobId: id, userId: 'u1', skipAll: true});
    const job = await settled(id, 'failed');
    expect(job.errorCode).toBe('pro_required');
    expect(mocks.startRender).not.toHaveBeenCalled();
    expect(sent().filter(n => n.type === 'edit_failed')).toHaveLength(1);
  });

  it('an unverifiable plan fails the job as retryable instead of guessing', async () => {
    mocks.verdict.value = 'unavailable';
    mocks.analysis.set('an_1', {analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: bp('bp1', [])});
    const id = await start();
    await markCaptionsSourceUploaded(id, 'u1');
    const job = await settled(id, 'failed');
    expect(job.errorCode).toBe('entitlement_unavailable');
    expect(mocks.startAnalysis).not.toHaveBeenCalled();
  });
});

describe('PostgREST client (the table behind the interface)', () => {
  type Call = {url: string; init: RequestInit};
  const make = (respond: (call: Call) => unknown) => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const call = {url, init};
      calls.push(call);
      return new Response(JSON.stringify(respond(call)), {status: 200});
    }) as unknown as typeof fetch;
    return {calls, store: createPostgrestJobStore({url: 'https://proj.supabase.co/', serviceKey: 'service-key'}, fetchImpl)};
  };
  const job = {editJobId: 'ed_1', userId: 'u1', status: 'awaiting_assets', mode: 'full_edit', sourcePublicUrl: 'https://cdn/src.mp4', blueprintId: 'bp1', createdAt: 'a', updatedAt: 'b'} as unknown as CaptionsEditJob;

  it('upserts the row with the service key only', async () => {
    const {calls, store} = make(() => []);
    await store.upsert(job, {blueprintId: 'bp1'});
    expect(calls[0]!.url).toBe('https://proj.supabase.co/rest/v1/creator_edit_jobs?on_conflict=edit_job_id');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.apikey).toBe('service-key');
    expect(headers.Prefer).toContain('merge-duplicates');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({edit_job_id: 'ed_1', user_id: 'u1', mode: 'full_edit', status: 'awaiting_assets', blueprint_id: 'bp1', input_video_url: 'https://cdn/src.mp4'});
    expect(body.blueprint).toEqual({blueprintId: 'bp1'});
    expect(body).not.toHaveProperty('lease_owner'); // an upsert never clobbers the lease
  });

  it('claims a lease with one conditional UPDATE and reports whether it won', async () => {
    const won = make(() => [{edit_job_id: 'ed_1'}]);
    expect(await won.store.claimLease('ed_1', 'me', 60_000)).toBe(true);
    const url = decodeURIComponent(won.calls[0]!.url);
    expect(won.calls[0]!.init.method).toBe('PATCH');
    expect(url).toContain('edit_job_id=eq.ed_1');
    expect(url).toContain('or=(lease_until.is.null,lease_until.lt.');
    expect(url).toContain('lease_owner.eq.me');
    expect(url).toContain('status=not.in.(done,failed)');
    const lost = make(() => []);
    expect(await lost.store.claimLease('ed_1', 'me', 60_000)).toBe(false);
  });

  it('lists recoverable jobs by status, idle time and free lease (never awaiting_assets)', async () => {
    const {calls, store} = make(() => [{edit_job_id: 'ed_2'}]);
    expect(await store.listRecoverable({idleMs: 120_000, limit: 5})).toEqual(['ed_2']);
    const url = decodeURIComponent(calls[0]!.url);
    expect(url).toContain('status=in.(awaiting_upload,analyzing,rendering)');
    expect(url).not.toContain('awaiting_assets');
    expect(url).toContain('limit=5');
  });

  it('reads a job and the retention sweep calls the database function', async () => {
    const read = make(() => [{job, blueprint: {blueprintId: 'bp1'}}]);
    expect((await read.store.get('ed_1'))!.job.editJobId).toBe('ed_1');
    const purge = make(() => ({expired: 2, deleted: 3}));
    expect(await purge.store.purge()).toEqual({expired: 2, deleted: 3});
    expect(purge.calls[0]!.url).toContain('/rpc/purge_creator_edit_jobs');
  });

  it('surfaces a failing database (the caller decides; KV still has the job)', async () => {
    const store = createPostgrestJobStore({url: 'https://p.co', serviceKey: 'k'}, (async () => new Response('boom', {status: 500})) as never);
    await expect(store.upsert(job)).rejects.toThrow(/failed \(500\)/);
  });
});
