/**
 * Durable completion-callback outbox: a pending callback survives an engine restart and resumes; a crash between "Flask accepted" and "engine recorded it" replays safely; exhausted events
 * stay visible and can be re-driven; callbacks never start a render. The runner and stores are real; analysis / render / the plan check / presign are mocked; the Creators API is a fake
 * that deduplicates by event id the way Flask does (the real Flask is exercised in v1CallbackOutbox.test.ts).
 * "Restart" = stop every delivery loop, reset the module graph (a fresh in-memory KV, no timers, no in-flight state) and re-open the same durable job file.
 */
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  startAnalysis: vi.fn(),
  startRender: vi.fn(),
  base: 5, // CALLBACK_BACKOFF_BASE_MS
  max: 5,
  key: 'engine-key',
}));
const flask = {mode: 'up' as 'up' | 'down' | 'unauthorized' | 'accept_then_hang', events: new Map<string, number>(), pushes: 0, requests: [] as Array<Record<string, unknown>>};
const dbFile = {path: ''};

vi.mock('../config/env.ts', async importOriginal => {
  const actual = (await importOriginal()) as {env: Record<string, unknown>};
  Object.assign(actual.env, {REDIS_URL: '', CREATOR_API_URL: 'http://creators.test', ENGINE_API_KEY: mocks.key, CALLBACK_MAX_ATTEMPTS: mocks.max, CALLBACK_BACKOFF_BASE_MS: mocks.base, CALLBACK_BACKOFF_MAX_MS: 30000, CALLBACK_TIMEOUT_MS: 2000, NODE_ENV: 'test'});
  return actual;
});
vi.mock('../lib/entitlement.ts', () => ({checkFullEditForWorker: async () => 'allow'}));
vi.mock('../pipeline/analysisRunner.ts', () => ({startAnalysis: (...a: unknown[]) => mocks.startAnalysis(...a)}));
vi.mock('../pipeline/renderRunner.ts', () => ({
  startRender: (...a: unknown[]) => mocks.startRender(...a),
  loadRenderJob: async (id: string) => ({renderJobId: id, status: 'done', progress: 1, outputUrl: 'https://cdn/out.mp4', outputDurationSec: 19}),
  refreshRenderJob: async (job: unknown) => job,
}));
vi.mock('../storage/r2.ts', () => ({presignSourceVideo: async () => ({key: 'k', publicUrl: 'https://cdn/src.mp4', uploadUrl: 'https://up'}), sourceObjectExists: async () => true}));

const realFetch = globalThis.fetch;
function installFlask() {
  vi.stubGlobal('fetch', async (_url: string, init: {body: string; headers: Record<string, string>}) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    flask.requests.push(body);
    if (flask.mode === 'down') return new Response('unavailable', {status: 503});
    if (flask.mode === 'unauthorized' || init.headers['x-engine-key'] !== 'engine-key') return new Response('{"code":"unauthorized"}', {status: 401});
    const duplicate = flask.events.has(String(body.eventId));
    if (!duplicate) { flask.events.set(String(body.eventId), 1); flask.pushes += 1; }
    if (flask.mode === 'accept_then_hang') return new Promise<Response>(() => {}); // Flask recorded the event; the engine never hears back (it "crashed")
    return new Response(JSON.stringify({ok: true, accepted: true, duplicate, push: {status: 'sent'}}), {status: 200});
  });
}

/** A durable job table that survives "restarts": the memory store, mirrored to a JSON file. */
async function openDurableStore() {
  const {createMemoryJobStore, setDurableJobStoreForTests} = await import('../store/durableJobs.ts');
  const store = createMemoryJobStore();
  if (existsSync(dbFile.path)) for (const [id, row] of JSON.parse(readFileSync(dbFile.path, 'utf8'))) (store.rows as Map<string, unknown>).set(id, row);
  const upsert = store.upsert.bind(store);
  const wrapped = {...store, async upsert(job: never, bp?: unknown) { await upsert(job, bp); writeFileSync(dbFile.path, JSON.stringify([...(store.rows as Map<string, unknown>)])); }};
  setDurableJobStoreForTests(wrapped as never);
  return wrapped;
}
async function boot() {
  const {env} = await import('../config/env.ts'); // the module graph is fresh after a restart: apply this test's settings to it
  Object.assign(env as unknown as Record<string, unknown>, {REDIS_URL: '', CREATOR_API_URL: 'http://creators.test', ENGINE_API_KEY: mocks.key, CALLBACK_MAX_ATTEMPTS: mocks.max, CALLBACK_BACKOFF_BASE_MS: mocks.base, CALLBACK_BACKOFF_MAX_MS: 30000, CALLBACK_TIMEOUT_MS: 2000});
  await openDurableStore();
  const runner = await import('../pipeline/captionsEditRunner.ts');
  const notifier = await import('../http/notifyCreator.ts');
  const kv = await import('../store/engineStore.ts');
  return {runner, notifier, kv};
}
async function restart() {
  (await import('../http/notifyCreator.ts')).stopCallbackDelivery(); // the old process is gone: nothing more is sent from it
  vi.resetModules();
  installFlask();
  return boot();
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(10); } throw new Error('condition not met'); }

/** Runs one Pro job to its end (render mocked) and returns its id. */
async function completeJob(runner: typeof import('../pipeline/captionsEditRunner.ts'), kv: typeof import('../store/engineStore.ts'), opts: {renderOk: boolean}) {
  const bp = {blueprintId: 'bp', outputDurationSec: 19, captionWords: [], captionDirection: {bottomFrac: 0.2}, assetBrief: {version: 1, outputDurationSec: 19, slots: []}};
  await kv.saveBlueprint(bp as never, 'fp-' + Math.random());
  mocks.startAnalysis.mockImplementation(async () => ({analysisJobId: 'an_1'}));
  await kv.saveAnalysisJob?.({analysisJobId: 'an_1', status: 'done', progress: 1, blueprint: bp} as never).catch?.(() => {});
  const {job} = await runner.createCaptionsEditJob({userId: 'u1', contentType: 'video/mp4', languageCode: 'en' as never, captionTemplate: 'basic' as never, mode: 'full_edit', fullEdit: {renderFlags: {brollEnabled: true, zoomEnabled: true, trimEnabled: true}}});
  await runner.markCaptionsSourceUploaded(job.editJobId, 'u1');
  await until(async () => { const j = await runner.loadCaptionsEditJob(job.editJobId); return !!j && ['done', 'failed'].includes(j.status); }, 8000);
  return job.editJobId;
}

beforeEach(() => {
  dbFile.path = join(mkdtempSync(join(tmpdir(), 'outbox-')), 'jobs.json');
  Object.assign(flask, {mode: 'up', events: new Map(), pushes: 0, requests: []});
  Object.assign(mocks, {base: 5, max: 5, key: 'engine-key'});
  mocks.startAnalysis.mockReset(); mocks.startRender.mockReset();
  mocks.startRender.mockImplementation(async () => ({renderJobId: 'r_1'}));
  vi.resetModules();
  installFlask();
});
afterEach(async () => { (await import('../http/notifyCreator.ts')).stopCallbackDelivery(); vi.unstubAllGlobals(); globalThis.fetch = realFetch; rmSync(dbFile.path, {force: true}); });

describe('callback outbox', () => {
  it('stages the complete event with the job and marks it pending; delivery on a healthy path ends delivered, marker cleared', async () => {
    const {runner, kv} = await boot();
    const id = await completeJob(runner, kv, {renderOk: true});
    await until(() => flask.pushes === 1);
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacksPending === false);
    const job = (await runner.loadCaptionsEditJob(id))!;
    expect(job.status).toBe('done');
    const rec = job.callbacks![`edit_done:${id}:0`]!;
    expect(rec).toMatchObject({status: 'delivered', attempts: 1, lastCode: 200, pushStatus: 'sent'});
    expect(rec.payload).toMatchObject({userId: 'u1', editJobId: id, status: 'done', type: 'edit_done', eventId: `edit_done:${id}:0`, outputUrl: 'https://cdn/out.mp4'});
    expect(JSON.stringify(rec)).not.toContain('engine-key');
  });

  it('a pending callback survives an engine restart: persisted with payload, attempts and next due time; resumed at boot and delivered; no render, no state change', async () => {
    mocks.base = 400; flask.mode = 'down';
    let {runner, kv} = await boot();
    const id = await completeJob(runner, kv, {renderOk: true});
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_done:${id}:0`]?.attempts === 1);
    (await import('../http/notifyCreator.ts')).stopCallbackDelivery(); // freeze the old process right after attempt 1 (its retry is only due in 400 ms)
    const before = (await runner.loadCaptionsEditJob(id))!;
    expect(before.callbacksPending).toBe(true);
    expect(before.callbacks![`edit_done:${id}:0`]).toMatchObject({status: 'pending', attempts: 1, lastCode: 503, payload: {editJobId: id}});
    expect(typeof before.callbacks![`edit_done:${id}:0`]!.nextAttemptAt).toBe('string');
    const renders = mocks.startRender.mock.calls.length; const analyses = mocks.startAnalysis.mock.calls.length;
    // --- restart (Flask is back) ---
    flask.mode = 'up';
    ({runner, kv} = await restart());
    expect(flask.pushes).toBe(0); // nothing is sent until the boot scan runs
    expect(await runner.recoverPendingCallbacks()).toBe(1);
    await until(() => flask.pushes === 1);
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacksPending === false);
    const after = (await runner.loadCaptionsEditJob(id))!;
    expect(after.callbacks![`edit_done:${id}:0`]).toMatchObject({status: 'delivered', attempts: 2, lastCode: 200});
    expect({status: after.status, outputUrl: after.outputUrl, retryCount: after.retryCount}).toEqual({status: 'done', outputUrl: before.outputUrl, retryCount: before.retryCount});
    expect(mocks.startRender.mock.calls.length).toBe(renders); expect(mocks.startAnalysis.mock.calls.length).toBe(analyses); // the resume started nothing
    expect(await runner.recoverPendingCallbacks()).toBe(0); // nothing left to resume
  });

  it('the attempt budget is counted across restarts (5 in total, not 5 per boot) and the event then stays visible as exhausted', async () => {
    mocks.base = 20; mocks.max = 5; flask.mode = 'down';
    let {runner, kv} = await boot();
    const id = await completeJob(runner, kv, {renderOk: true});
    await until(async () => ((await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_done:${id}:0`]?.attempts ?? 0) >= 2);
    ({runner, kv} = await restart()); flask.requests.length = 0; flask.mode = 'down';
    const done = (await runner.loadCaptionsEditJob(id))!.callbacks![`edit_done:${id}:0`]!.attempts;
    await runner.recoverPendingCallbacks();
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_done:${id}:0`]?.status === 'exhausted');
    const rec = (await runner.loadCaptionsEditJob(id))!.callbacks![`edit_done:${id}:0`]!;
    expect(rec.attempts).toBe(5);
    expect(flask.requests.length).toBe(5 - done); // only the remaining budget was used after the restart
    expect(rec).toMatchObject({status: 'exhausted', lastCode: 503});
    expect(rec.payload).toBeDefined(); // kept: visible and recoverable
    expect((await runner.loadCaptionsEditJob(id))!.callbacksPending).toBe(false);
    expect(await runner.recoverPendingCallbacks()).toBe(0); // the boot scan does not silently re-send exhausted events
    // --- operator re-drive once Flask is healthy ---
    flask.mode = 'up';
    expect(await runner.redeliverCallbacks(id)).toBe(1);
    await until(() => flask.pushes === 1);
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_done:${id}:0`]?.status === 'delivered');
    expect((await runner.loadCaptionsEditJob(id))!.callbacks![`edit_done:${id}:0`]).toMatchObject({status: 'delivered', cycles: 1, attempts: 1});
    expect(await runner.redeliverCallbacks(id)).toBe(0); // nothing left to re-drive
  });

  it('crash after Flask accepted the event but before the engine recorded it: the restart replays the same event id; Flask answers duplicate; one push in total', async () => {
    flask.mode = 'accept_then_hang';
    let {runner, kv} = await boot();
    const id = await completeJob(runner, kv, {renderOk: true});
    await until(() => flask.pushes === 1); // Flask recorded it and pushed; the engine's request never returned
    const crashed = (await runner.loadCaptionsEditJob(id))!;
    expect(crashed.callbacks![`edit_done:${id}:0`]).toMatchObject({status: 'pending', attempts: 0}); // the delivery was never recorded
    ({runner, kv} = await restart()); flask.mode = 'up';
    expect(await runner.recoverPendingCallbacks()).toBe(1);
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_done:${id}:0`]?.status === 'delivered');
    const rec = (await runner.loadCaptionsEditJob(id))!.callbacks![`edit_done:${id}:0`]!;
    expect(rec).toMatchObject({status: 'delivered', duplicate: true, pushStatus: 'sent'});
    expect(flask.pushes).toBe(1); // the replay created no second push
    expect(flask.requests.map(r => r.eventId)).toEqual([`edit_done:${id}:0`, `edit_done:${id}:0`]); // same event id both times
  });

  it('two concurrent resumes of one event send it once (in-flight guard); permanent rejection is persisted and is re-drivable after the cause is fixed', async () => {
    flask.mode = 'unauthorized';
    let {runner, kv} = await boot();
    const id = await completeJob(runner, kv, {renderOk: true});
    await until(async () => (await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_done:${id}:0`]?.status === 'rejected');
    expect(flask.requests).toHaveLength(1); // 401 is permanent: no retry
    expect((await runner.loadCaptionsEditJob(id))!.callbacksPending).toBe(false);
    ({runner, kv} = await restart()); flask.mode = 'up';
    expect(await runner.recoverPendingCallbacks()).toBe(0); // rejected is not auto-resumed
    expect(await runner.redeliverCallbacks(id)).toBe(1);
    await Promise.all([runner.redeliverCallbacks(id), runner.recoverPendingCallbacks()]); // nothing left to reopen / resume, and nothing sends twice
    await until(() => flask.pushes === 1);
    await wait(100);
    expect(flask.pushes).toBe(1);
    expect(flask.requests.length).toBe(2); // the 401, then the single re-drive
    expect((await runner.loadCaptionsEditJob(id))!.callbacks![`edit_done:${id}:0`]).toMatchObject({status: 'delivered', cycles: 1});
  });

  it('a failed job and a retry keep their event identities: failure is round 0, the retry is round 1 (a new event id), and both survive a restart', async () => {
    let renderCalls = 0; mocks.startRender.mockImplementation(async () => { renderCalls += 1; if (renderCalls <= 2) throw new Error('injected'); return {renderJobId: 'r_ok'}; }); // the runner retries a start error once, so two failures fail the job
    flask.mode = 'down'; mocks.base = 300;
    let {runner, kv} = await boot();
    const id = await completeJob(runner, kv, {renderOk: false});
    expect((await runner.loadCaptionsEditJob(id))!.status).toBe('failed');
    await until(async () => !!(await runner.loadCaptionsEditJob(id))?.callbacks?.[`edit_failed:${id}:0`]);
    ({runner, kv} = await restart()); flask.mode = 'up';
    await runner.recoverPendingCallbacks();
    await until(() => flask.events.has(`edit_failed:${id}:0`));
    await runner.retryFullEdit({editJobId: id, userId: 'u1'});
    await until(async () => (await runner.loadCaptionsEditJob(id))?.status === 'done');
    await until(() => flask.events.has(`edit_done:${id}:1`));
    expect([...flask.events.keys()].sort()).toEqual([`edit_done:${id}:1`, `edit_failed:${id}:0`]);
    expect(flask.pushes).toBe(2);
    expect((await runner.loadCaptionsEditJob(id))).toMatchObject({status: 'done', retryCount: 1});
  });
});
