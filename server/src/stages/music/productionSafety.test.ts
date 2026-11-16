/**
 * Phase 4: BGM production safety.
 *
 *  A. Production never attaches (or uploads) the synthetic dry-mode placeholder bed. A live request that cannot go live (no API key) and an explicit dry setting
 *     both end in an existing pool bed (same style, then same family) or no bed, with the reason explicit in the logs and in the plan (provenance). Development
 *     and tests keep the dry behaviour.
 *  B. Paid-generation accounting: a broken spend log is detected BEFORE the ledger is claimed (nothing spent, the video's one attempt not consumed); a paid
 *     request without a bed is recorded in the durable ledger with its stage and cost; a failed `paid` spend line never discards a paid bed; a consumed video
 *     is never paid for twice.
 *
 * Everything is injected: no Python, no network, no R2, no provider. The real gate functions (resolveMusicMode, buildSpawnSpec, isProductionEnv, resolveMusicLedgerStore)
 * and the real failOpen / ledger code run on explicit env objects.
 */
import {EventEmitter} from 'node:events';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {MusicResult} from './schema.ts';

type Log = {level: string; obj: Record<string, unknown>; msg: string};
type Pools = Record<string, Array<Record<string, unknown>>>;

const bed = (style: string, family: string, n = 1) => ({cache_key: `${style}-bed-${n}`.padEnd(20, 'x'), url: `https://media.example.invalid/pool/${style}-${n}.wav`, bpm: 82, style, family});

async function load(pools: Pools = {}) {
  vi.resetModules();
  const logs: Log[] = [];
  vi.doMock('../../storage/r2.ts', () => ({r2Configured: () => true, r2LedgerClient: () => null, sourceObjectExists: async () => false, uploadPublicFile: async () => { throw new Error('the test must never upload'); }}));
  vi.doMock('../../lib/logger.ts', () => {
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => void logs.push({level: 'info', obj, msg}),
      warn: (obj: Record<string, unknown>, msg: string) => void logs.push({level: 'warn', obj, msg}),
      error: (obj: Record<string, unknown>, msg: string) => void logs.push({level: 'error', obj, msg}),
      debug: () => undefined,
    };
    return {stageLogger: () => logger, logger};
  });
  // Only the pool reader is faked (real failOpen / pickNearestBpm / poolPlan run on it); everything else in uploadBed stays real.
  vi.doMock('./uploadBed.ts', async importOriginal => ({...(await importOriginal<typeof import('./uploadBed.ts')>()), readPool: async (mood: string) => (pools[mood] ?? []) as never}));
  const music = await import('./musicSpecialist.ts');
  const flags = await import('./flags.ts');
  const ledger = await import('./generationLedger.ts');
  return {music, flags, ledger, logs};
}
type H = Awaited<ReturnType<typeof load>>;

const PLAN = {cache_key: 'a'.repeat(64), seed: 11, bpm: 80, key: 'D minor', mood: 'calm', prompt_version: 4, estimated_cost_usd: 0.0075, mode: 'plan'} as MusicResult;
const BRIEF = {style: 'lofi-chill', family: 'calm', bpm: 82, key: 'D minor', arc: 'steady'};
const memoryStore = (opts: {failReplace?: boolean} = {}) => {
  const objects = new Map<string, string>();
  return {
    objects,
    name: 'memory',
    atomicCreateVerified: true,
    createIfAbsent: async (key: string, body: string) => (objects.has(key) ? ('exists' as const) : (objects.set(key, body), 'created' as const)),
    read: async (key: string) => objects.get(key) ?? null,
    replace: async (key: string, body: string) => {
      if (opts.failReplace) throw Object.assign(new Error('socket hang up'), {name: 'TimeoutError'});
      objects.set(key, body);
    },
  };
};

function harness(h: H, env: NodeJS.ProcessEnv, opts: {store?: ReturnType<typeof memoryStore> | null; plan?: Partial<MusicResult>; live?: () => Promise<MusicResult>} = {}) {
  const calls = {spawn: [] as string[], upload: 0, spool: 0};
  const store = opts.store === undefined ? memoryStore() : opts.store;
  const deps = {
    decide: () => h.flags.resolveMusicMode(env),
    spawnModeFor: (mode: 'plan' | 'dry' | 'live') => h.flags.buildSpawnSpec(mode, env).mode,
    isProduction: () => h.flags.isProductionEnv(env),
    ledger: () => store as never,
    spawn: async (requested: 'plan' | 'dry' | 'live') => {
      calls.spawn.push(requested);
      if (requested === 'plan') return {...PLAN, ...(opts.plan ?? {})} as MusicResult;
      if (opts.live) return opts.live();
      return {...PLAN, mode: requested, bed_path: '/tmp/fake/bed.wav', cost_usd: requested === 'live' ? 0.0075 : 0, qc_passed: true} as MusicResult;
    },
    findUploadedBed: async () => null,
    readBedMeta: async () => ({}),
    uploadBedDetailed: async (input: {cacheKey: string; dry: boolean}) => {
      calls.upload += 1;
      return {url: `https://media.example.invalid/music/beds/${input.dry ? 'dry/' : ''}${input.cacheKey}/bed.wav`};
    },
    writeSpool: async () => void (calls.spool += 1),
    removeSpool: async () => undefined,
    flushSpool: async () => 0,
    now: () => '2026-11-16T00:00:00.000Z',
  };
  const run = (videoId = 'video-1') => h.music.runMusicPlanWith({transcript_segments: [], visual_cuts: [], emotional_tone: 'calm', canvas_sec: 30, video_id: videoId, brief: BRIEF} as never, deps as never);
  return {calls, store, run};
}

const PROD = {NODE_ENV: 'production'};
const DEV = {NODE_ENV: 'development'};
const KEY = {RUNWARE_API_KEY: 'placeholder-not-a-key'};
const logOf = (h: H, msg: string) => h.logs.filter(entry => entry.msg === msg);

beforeEach(() => {
  vi.stubEnv('POLISH_MUSIC_BED_URL', '');
  vi.stubEnv('MUSIC_BED_FRESH', '0');
  vi.stubEnv('MUSIC_BED_SOURCE', 'auto');
  vi.stubEnv('MUSIC_SPECIALIST_MAX_USD', '0.02');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('../../storage/r2.ts');
  vi.doUnmock('../../lib/logger.ts');
  vi.doUnmock('./uploadBed.ts');
});

describe('A. production never attaches the synthetic dry-mode bed', () => {
  it('mode decision: a live request without a key is a dry downgrade with an explicit reason; production is detected', async () => {
    const h = await load();
    expect(h.flags.resolveMusicMode({...PROD, MUSIC_SPECIALIST: 'live'})).toMatchObject({mode: 'dry', downgraded: true, downgradeReason: 'no_api_key'});
    expect(h.flags.resolveMusicMode({...PROD, MUSIC_SPECIALIST: 'live', ...KEY})).toMatchObject({mode: 'live', downgraded: false});
    expect(h.flags.resolveMusicMode({MUSIC_SPECIALIST: 'live', VITEST: '1', ...KEY})).toMatchObject({mode: 'dry', downgraded: true, downgradeReason: 'test_env'});
    expect(h.flags.resolveMusicMode({...PROD, MUSIC_SPECIALIST: 'dry'})).toMatchObject({mode: 'dry', downgraded: false});
    expect(h.flags.isProductionEnv({NODE_ENV: 'production'})).toBe(true);
    expect(h.flags.isProductionEnv({NODE_ENV: ' Production '})).toBe(true);
    expect(h.flags.isProductionEnv({NODE_ENV: 'development'})).toBe(false);
    expect(h.flags.isProductionEnv({NODE_ENV: 'test'})).toBe(false);
    expect(h.flags.isProductionEnv({})).toBe(false);
  });

  it('production, live requested, NO API KEY, EMPTY pool: nothing is spawned, generated or uploaded; no bed; the reason is in the logs', async () => {
    const h = await load({});
    const t = harness(h, {...PROD, MUSIC_SPECIALIST: 'live'});
    expect(await t.run()).toBeNull();
    expect(t.calls).toEqual({spawn: [], upload: 0, spool: 0});
    expect(logOf(h, 'music.mode_downgraded')[0]!.obj).toMatchObject({from: 'live', to: 'dry', reason: 'no_api_key', production: true});
    expect(logOf(h, 'music.dry_blocked_in_production')[0]!.obj).toMatchObject({reason: 'live_unavailable_no_api_key', requested: 'live'});
    expect(logOf(h, 'music.fallback')[0]!.obj).toMatchObject({reason: 'live_unavailable_no_api_key', tier: 'none'});
  });

  it('production, live requested, no key, pool bed of the SAME STYLE available: that bed is used, marked as a fallback with the reason (provenance), never generated', async () => {
    const h = await load({'lofi-chill': [bed('lofi-chill', 'calm')]});
    const t = harness(h, {...PROD, MUSIC_SPECIALIST: 'live'});
    const plan = await t.run();
    expect(plan).toMatchObject({url: 'https://media.example.invalid/pool/lofi-chill-1.wav', fromPool: true, costUsd: 0, fallbackReason: 'live_unavailable_no_api_key', fallbackTier: 'style'});
    expect(t.calls).toEqual({spawn: [], upload: 0, spool: 0});
    expect(logOf(h, 'music.fallback')[0]!.obj).toMatchObject({reason: 'live_unavailable_no_api_key', tier: 'style'});
  });

  it('production, no key, only a pool bed of the same FAMILY: the family tier is used', async () => {
    const h = await load({'soft-acoustic': [bed('soft-acoustic', 'calm')]});
    const t = harness(h, {...PROD, MUSIC_SPECIALIST: 'live'});
    expect(await t.run()).toMatchObject({url: 'https://media.example.invalid/pool/soft-acoustic-1.wav', fallbackReason: 'live_unavailable_no_api_key', fallbackTier: 'family'});
    expect(t.calls.spawn).toEqual([]);
  });

  it('production, a pool bed of an unrelated family is NOT eligible: no bed', async () => {
    const h = await load({'driving-electronic': [bed('driving-electronic', 'high-energy')]});
    const t = harness(h, {...PROD, MUSIC_SPECIALIST: 'live'});
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual([]);
  });

  it.each([
    ['explicit dry', {MUSIC_SPECIALIST: 'dry'}],
    ['legacy =1 without MUSIC_SPECIALIST_LIVE', {MUSIC_SPECIALIST: '1'}],
    ['explicit dry with MUSIC_BED_FRESH=1 (fresh used to bypass the pool and go straight to the placeholder)', {MUSIC_SPECIALIST: 'dry', MUSIC_BED_FRESH: '1'}],
  ])('production, %s: blocked with reason dry_mode_in_production; a pool bed or nothing', async (_name, extra) => {
    for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
    const empty = await load({});
    const noBed = harness(empty, {...PROD, ...extra});
    expect(await noBed.run()).toBeNull();
    expect(noBed.calls).toEqual({spawn: [], upload: 0, spool: 0});
    expect(logOf(empty, 'music.dry_blocked_in_production')[0]!.obj).toMatchObject({reason: 'dry_mode_in_production'});
    expect(logOf(empty, 'music.mode_downgraded')).toEqual([]); // an explicit dry setting is not a downgrade
    const pooled = await load({'lofi-chill': [bed('lofi-chill', 'calm')]});
    const withBed = harness(pooled, {...PROD, ...extra});
    expect(await withBed.run()).toMatchObject({fromPool: true, fallbackReason: 'dry_mode_in_production', fallbackTier: 'style'});
    expect(withBed.calls.spawn).toEqual([]);
  });

  it('development, live requested without a key: the free dry run is unchanged (placeholder allowed), nothing about production is logged', async () => {
    const h = await load({});
    const t = harness(h, {...DEV, MUSIC_SPECIALIST: 'live'});
    const plan = await t.run();
    expect(t.calls.spawn).toEqual(['plan', 'dry']);
    expect(t.calls.upload).toBe(1);
    expect(plan?.url).toContain('/dry/'); // under the separate dry prefix
    expect(logOf(h, 'music.dry_blocked_in_production')).toEqual([]);
    expect(logOf(h, 'music.mode_downgraded')[0]!.obj).toMatchObject({reason: 'no_api_key', production: false});
  });

  it('development, explicit dry: unchanged', async () => {
    const h = await load({});
    const t = harness(h, {...DEV, MUSIC_SPECIALIST: 'dry'});
    await t.run();
    expect(t.calls.spawn).toEqual(['plan', 'dry']);
  });

  it('production with a key and the ledger: the live path is NOT blocked', async () => {
    const h = await load({});
    const t = harness(h, {...PROD, MUSIC_SPECIALIST: 'live', ...KEY});
    const plan = await t.run();
    expect(t.calls.spawn).toEqual(['plan', 'live']);
    expect(plan).toMatchObject({costUsd: 0.0075, source: 'generated'});
    expect(logOf(h, 'music.dry_blocked_in_production')).toEqual([]);
  });

  it('specialist off in production: unchanged (no bed, no spawn)', async () => {
    const h = await load({'lofi-chill': [bed('lofi-chill', 'calm')]});
    const t = harness(h, {...PROD});
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual([]);
  });
});

describe('B. paid-generation accounting', () => {
  const LIVE_PROD = {...PROD, MUSIC_SPECIALIST: 'live', ...KEY};
  const paidError = (stage: 'post' | 'download', costUsd: number | null) => Object.assign(new Error('music_specialist exited 1: paid music request failed'), {paid: {stage, costUsd, accounting: {requested_logged: true, paid_logged: stage === 'download', errors: []}}});
  const record = (t: ReturnType<typeof harness>, id = 'video-1') => JSON.parse(t.store!.objects.get(`music/ledger/${id}.json`)!);

  it('a spend log the agent cannot write is detected BEFORE the ledger is claimed: nothing spent, the video keeps its one attempt', async () => {
    const h = await load({});
    const t = harness(h, LIVE_PROD, {plan: {spend_log_ok: false, spend_log_error: 'not_writable'}});
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual(['plan']); // no live spawn
    expect(t.store!.objects.size).toBe(0); // no claim: the video can still be generated once the log is fixed
    expect(logOf(h, 'music.spend_log_unavailable')[0]!).toMatchObject({level: 'error', obj: {reason: 'not_writable'}});
    expect(logOf(h, 'music.fallback')[0]!.obj).toMatchObject({reason: 'spend_log_unavailable'});
  });

  it('a paid request whose DOWNLOAD failed is recorded in the durable ledger with its cost, loudly logged, and not retried', async () => {
    const h = await load({});
    const t = harness(h, LIVE_PROD, {live: async () => { throw paidError('download', 0.0075); }});
    expect(await t.run()).toBeNull();
    expect(record(t)).toMatchObject({state: 'resolved', resolution: {outcome: 'failed', reason: 'paid_download_failed', costUsd: 0.0075, asset: null}});
    expect(logOf(h, 'music.paid_request_without_bed')[0]!).toMatchObject({level: 'error', obj: {stage: 'download', cost_usd: 0.0075}});
    expect(logOf(h, 'music.fallback')[0]!.obj).toMatchObject({reason: 'paid_download_failed'});
  });

  it('a paid request whose POST failed is recorded with an UNKNOWN cost (it may have been charged)', async () => {
    const h = await load({});
    const t = harness(h, LIVE_PROD, {live: async () => { throw paidError('post', null); }});
    await t.run();
    expect(record(t).resolution).toMatchObject({outcome: 'failed', reason: 'paid_post_failed', costUsd: null});
  });

  it('retry behaviour: the consumed video is never paid for twice (a second edit of the same video makes no live spawn)', async () => {
    const h = await load({});
    const t = harness(h, LIVE_PROD, {live: async () => { throw paidError('download', 0.0075); }});
    await t.run();
    expect(t.calls.spawn.filter(mode => mode === 'live')).toHaveLength(1);
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn.filter(mode => mode === 'live')).toHaveLength(1); // still one
    expect(logOf(h, 'music.fallback').map(entry => entry.obj.reason)).toEqual(['paid_download_failed', 'already_generated']);
    // a DIFFERENT video is unaffected
    await t.run('video-2');
    expect(t.calls.spawn.filter(mode => mode === 'live')).toHaveLength(2);
  });

  it('a failed `paid` spend line does not discard the paid, downloaded bed: it is attached, and the durable ledger carries the cost and the reason', async () => {
    const h = await load({});
    const accounting = {requested_logged: true, paid_logged: false, downloaded_logged: true, errors: ['spend log append failed (OSError)']};
    const t = harness(h, LIVE_PROD, {live: async () => ({...PLAN, mode: 'live', bed_path: '/tmp/fake/bed.wav', cost_usd: 0.0075, qc_passed: true, paid: true, accounting}) as MusicResult});
    const plan = await t.run();
    expect(plan).toMatchObject({costUsd: 0.0075, source: 'generated', url: expect.stringContaining('/bed.wav')});
    expect(plan?.fallbackReason).toBeUndefined();
    expect(record(t).resolution).toMatchObject({outcome: 'generated', reason: 'spend_log_paid_append_failed', costUsd: 0.0075});
    expect(logOf(h, 'music.spend_accounting_degraded')[0]!).toMatchObject({level: 'error', obj: {cost_usd: 0.0075}});
  });

  it('a clean paid run resolves the ledger as generated with no accounting reason', async () => {
    const h = await load({});
    const accounting = {requested_logged: true, paid_logged: true, downloaded_logged: true, errors: []};
    const t = harness(h, LIVE_PROD, {live: async () => ({...PLAN, mode: 'live', bed_path: '/tmp/fake/bed.wav', cost_usd: 0.0075, qc_passed: true, paid: true, accounting}) as MusicResult});
    await t.run();
    expect(record(t).resolution).toMatchObject({outcome: 'generated', reason: null, costUsd: 0.0075});
    expect(logOf(h, 'music.spend_accounting_degraded')).toEqual([]);
  });

  it('the ledger cannot be RESOLVED after a successful paid generation: the bed is still attached, the record stays `claimed` (consumed), and the next edit of that video is not paid for again', async () => {
    const h = await load({});
    const accounting = {requested_logged: true, paid_logged: true, downloaded_logged: true, errors: []};
    const t = harness(h, LIVE_PROD, {store: memoryStore({failReplace: true}), live: async () => ({...PLAN, mode: 'live', bed_path: '/tmp/fake/bed.wav', cost_usd: 0.0075, qc_passed: true, paid: true, accounting}) as MusicResult});
    const first = await t.run();
    expect(first).toMatchObject({costUsd: 0.0075, source: 'generated'});
    expect(JSON.parse(t.store!.objects.get('music/ledger/video-1.json')!)).toMatchObject({state: 'claimed', resolution: null}); // the record never reached `resolved`
    expect(logOf(h, 'music.ledger_resolve_failed')[0]!).toMatchObject({level: 'warn', obj: {video_id: 'video-1'}});
    expect(await t.run()).toBeNull(); // consumed: no second paid generation (and no reuse either: the asset was never recorded)
    expect(t.calls.spawn.filter(mode => mode === 'live')).toHaveLength(1);
    expect(logOf(h, 'music.fallback').map(entry => entry.obj.reason)).toEqual(['already_generated']);
  });

  it('the ledger cannot be resolved after a PAID FAILURE: the failure is still logged loudly, the video stays consumed and no unsafe retry happens', async () => {
    const h = await load({});
    const t = harness(h, LIVE_PROD, {store: memoryStore({failReplace: true}), live: async () => { throw paidError('download', 0.0075); }});
    expect(await t.run()).toBeNull();
    expect(logOf(h, 'music.paid_request_without_bed')[0]!).toMatchObject({level: 'error', obj: {stage: 'download', cost_usd: 0.0075}}); // the evidence is in the log even though R2 refused the write
    expect(logOf(h, 'music.ledger_resolve_failed')).toHaveLength(1);
    expect(JSON.parse(t.store!.objects.get('music/ledger/video-1.json')!).state).toBe('claimed');
    await t.run();
    expect(t.calls.spawn.filter(mode => mode === 'live')).toHaveLength(1);
  });

  it('the generic spawn failures keep their old, unchanged reasons (no paid marker)', async () => {
    const h = await load({});
    const t = harness(h, LIVE_PROD, {live: async () => { throw new Error('music_specialist exited 1: boom'); }});
    await t.run();
    expect(record(t).resolution).toMatchObject({outcome: 'failed', reason: 'spawn', costUsd: null});
  });
});

describe('B. the paid-failure line the agent prints', () => {
  it('parsePaidFailure reads the one machine-readable line and ignores anything malformed', async () => {
    const h = await load();
    const parse = h.music.parsePaidFailure;
    expect(parse('noise\nMUSIC_PAID_FAILURE {"stage":"download","cost_usd":0.0075,"accounting":{"paid_logged":true}}\nmore')).toEqual({stage: 'download', costUsd: 0.0075, accounting: {paid_logged: true}});
    expect(parse('MUSIC_PAID_FAILURE {"stage":"post","cost_usd":null,"accounting":{}}')).toEqual({stage: 'post', costUsd: null, accounting: {}});
    expect(parse('MUSIC_PAID_FAILURE {"stage":"qc","cost_usd":1}')).toBeNull();
    expect(parse('MUSIC_PAID_FAILURE {not json}')).toBeNull();
    expect(parse('MUSIC_PAID_FAILURE {"stage":"download","cost_usd":"free"}')).toEqual({stage: 'download', costUsd: null, accounting: {}});
    expect(parse('music_specialist exited 1')).toBeNull();
  });

  it('spawnMusic attaches the parsed paid failure to the rejection (the exit code stays non-zero)', async () => {
    const h = await load();
    const child = Object.assign(new EventEmitter(), {stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: {end: vi.fn()}, kill: vi.fn()});
    const done = h.music.spawnMusic('live', {transcript_segments: [], visual_cuts: [], emotional_tone: 'x', canvas_sec: 5} as never, {spawnImpl: (() => child) as never, hardKillMs: 300000, env: {NODE_ENV: 'production', RUNWARE_API_KEY: 'placeholder-not-a-key'}});
    child.stderr.emit('data', Buffer.from('MUSIC_PAID_FAILURE {"stage":"download","cost_usd":0.0075,"accounting":{"requested_logged":true}}\npaid music request failed at download: x\n'));
    child.emit('close', 1);
    await expect(done).rejects.toMatchObject({message: expect.stringMatching(/exited 1/), paid: {stage: 'download', costUsd: 0.0075}});
  });
});
