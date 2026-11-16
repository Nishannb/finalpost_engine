/**
 * Phase 1.7.2: production Music Specialist generation safety. Offline: a fake S3/R2 backend (in memory), fake spawns, fake uploads. The real
 * @aws-sdk/client-s3 command classes are constructed (to check the exact request shape) but never sent anywhere.
 */
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

import {GetObjectCommand, HeadObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {MusicResult} from './schema.ts';

type Log = {level: 'info' | 'warn'; obj: Record<string, unknown>; msg: string};

/** In-memory S3/R2 bucket. `honorIfNoneMatch` models a server that enforces `If-None-Match: *` atomically (check and write in one step). */
class FakeBucket {
  readonly objects = new Map<string, string>();
  readonly commands: Array<{name: string; key: string; ifNoneMatch?: string; writeId?: string}> = [];
  readonly metadata = new Map<string, Record<string, string>>();
  constructor(readonly opts: {honorIfNoneMatch: boolean; latencyMs?: () => number}) {}
  client() {
    return {
      send: async (command: {input: Record<string, unknown>; constructor: {name: string}}) => {
        const name = command.constructor.name;
        const key = String(command.input.Key);
        const meta = command.input.Metadata as Record<string, string> | undefined;
        this.commands.push({name, key, ...(command.input.IfNoneMatch ? {ifNoneMatch: String(command.input.IfNoneMatch)} : {}), ...(meta?.['write-id'] ? {writeId: meta['write-id']} : {})});
        await new Promise(resolve => setTimeout(resolve, this.opts.latencyMs?.() ?? 1));
        if (name === 'PutObjectCommand') {
          // Atomic on the server: no await between the check and the write.
          if (command.input.IfNoneMatch === '*' && this.opts.honorIfNoneMatch && this.objects.has(key)) throw Object.assign(new Error('At least one of the pre-conditions you specified did not hold'), {name: 'PreconditionFailed', $metadata: {httpStatusCode: 412}});
          this.objects.set(key, String(command.input.Body));
          if (meta) this.metadata.set(key, meta);
          return {};
        }
        if (name === 'GetObjectCommand') {
          const body = this.objects.get(key);
          if (body === undefined) throw Object.assign(new Error('NoSuchKey'), {name: 'NoSuchKey', $metadata: {httpStatusCode: 404}});
          return {Body: {transformToString: async () => body}};
        }
        throw new Error(`unexpected command ${name}`);
      },
    };
  }
}

const PLAN: MusicResult = {cache_key: 'a'.repeat(64), seed: 11, bpm: 80, key: 'D minor', mood: 'lofi-chill', prompt_version: 4, estimated_cost_usd: 0.0075, mode: 'plan'} as MusicResult;
const generatedResult = (over: Partial<MusicResult> = {}): MusicResult =>
  ({...PLAN, mode: 'live', cost_usd: 0.0075, bed_path: '/tmp/fake/bed.wav', duration_sec: 55, qc_passed: true, qc_retried: false, qc_vocal_score: 0.1, ...over}) as MusicResult;

async function load() {
  vi.resetModules();
  const logs: Log[] = [];
  vi.doMock('../../storage/r2.ts', () => ({r2Configured: () => true, r2LedgerClient: () => null, sourceObjectExists: async () => false, uploadPublicFile: async () => { throw new Error('the test must never upload'); }}));
  vi.doMock('../../lib/logger.ts', () => ({
    stageLogger: () => ({
      info: (obj: Record<string, unknown>, msg: string) => void logs.push({level: 'info', obj, msg}),
      warn: (obj: Record<string, unknown>, msg: string) => void logs.push({level: 'warn', obj, msg}),
      error: () => undefined,
      debug: () => undefined,
    }),
    logger: {info: () => undefined, warn: () => undefined, error: () => undefined},
  }));
  const music = await import('./musicSpecialist.ts');
  const ledger = await import('./generationLedger.ts');
  return {music, ledger, logs};
}

type Harness = Awaited<ReturnType<typeof load>>;

/** One application instance: its own store object over a (possibly shared) bucket, its own spawn and upload fakes. */
function instance(h: Harness, bucket: FakeBucket, opts: {plan?: Partial<MusicResult>; live?: () => Promise<MusicResult>; cached?: string | null; mode?: 'live' | 'dry'; fallback?: (reason: string) => unknown; ledgerOff?: boolean} = {}) {
  const store = new h.ledger.R2ConditionalLedgerStore({client: bucket.client(), bucket: 'test-bucket', PutObjectCommand: PutObjectCommand as never, GetObjectCommand: GetObjectCommand as never});
  const calls = {spawn: [] as string[], upload: 0, spool: 0, failOpen: [] as string[], ledgerAtLiveSpawn: [] as Array<string | undefined>};
  const deps = {
    decide: () => ({mode: opts.mode ?? 'live', requested: opts.mode ?? 'live', downgraded: false}) as never,
    spawnModeFor: () => opts.mode ?? 'live',
    spawn: async (requested: 'plan' | 'dry' | 'live') => {
      calls.spawn.push(requested);
      if (requested === 'plan') return {...PLAN, ...opts.plan} as MusicResult;
      calls.ledgerAtLiveSpawn.push(bucket.objects.get('music/ledger/video-1.json') ?? bucket.objects.get(`music/ledger/${'x'}.json`));
      return opts.live ? opts.live() : generatedResult({cache_key: (opts.plan?.cache_key as string) ?? PLAN.cache_key});
    },
    readPool: async () => [],
    findUploadedBed: async () => opts.cached ?? null,
    readBedMeta: async () => ({bpm: 80, key: 'D minor', seed: 11}),
    uploadBedDetailed: async (input: {cacheKey: string}) => {
      calls.upload += 1;
      return {url: `https://media.example.invalid/music/beds/${input.cacheKey}/bed.wav`, fullUrl: `https://media.example.invalid/music/beds/${input.cacheKey}/bed_full.wav`};
    },
    writeSpool: async () => {
      calls.spool += 1;
    },
    removeSpool: async () => undefined,
    flushSpool: async () => 0,
    failOpen: async (_mood: string, reason: string) => {
      calls.failOpen.push(reason);
      return (opts.fallback ? opts.fallback(reason) : null) as never;
    },
    ledger: () => (opts.ledgerOff ? null : store),
    now: () => '2026-11-12T00:00:00.000Z',
  };
  return {store, calls, run: (job: Record<string, unknown> = {}) => h.music.runMusicPlanWith({transcript_segments: [], visual_cuts: [], emotional_tone: 'calm', canvas_sec: 30, video_id: 'video-1', ...job} as never, deps as never)};
}

const KEY = 'music/ledger/video-1.json';
const liveSpawns = (calls: {spawn: string[]}) => calls.spawn.filter(mode => mode === 'live').length;

describe('Phase 1.7.2: production per-video generation ledger', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await load();
    vi.stubEnv('POLISH_MUSIC_BED_URL', '');
    vi.stubEnv('MUSIC_BED_FRESH', '0');
    vi.stubEnv('MUSIC_BED_SOURCE', 'auto');
    vi.stubEnv('MUSIC_SPECIALIST_MAX_USD', '0.02');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('../../storage/r2.ts');
    vi.doUnmock('../../lib/logger.ts');
  });

  it('production default: no verified store is wired, so a live generation fails closed (pool fallback, no paid spawn)', async () => {
    expect(h.ledger.resolveMusicLedgerStore({})).toBeNull();
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket, {ledgerOff: true});
    expect(await a.run()).toBeNull();
    expect(a.calls.spawn).toEqual(['plan']);
    expect(a.calls.failOpen).toEqual(['ledger_unavailable']);
    expect(h.logs.find(log => log.msg === 'music.ledger_unavailable')).toBeTruthy();
    expect(new h.ledger.R2ConditionalLedgerStore({client: bucket.client(), bucket: 'b', PutObjectCommand: PutObjectCommand as never, GetObjectCommand: GetObjectCommand as never}).atomicCreateVerified).toBe(false);
  });

  it('1 + 17. the first live generation claims music/ledger/<videoId>.json BEFORE the agent is spawned, then resolves it', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket);
    const plan = await a.run();
    expect(plan).toMatchObject({url: `https://media.example.invalid/music/beds/${PLAN.cache_key}/bed.wav`, costUsd: 0.0075});
    expect(a.calls.spawn).toEqual(['plan', 'live']);
    // At the moment the paid child was spawned the claim already existed.
    expect(JSON.parse(a.calls.ledgerAtLiveSpawn[0]!)).toMatchObject({state: 'claimed', videoId: 'video-1', claim: {cacheKey: PLAN.cache_key, seed: 11, claimedAt: '2026-11-12T00:00:00.000Z'}});
    expect([...bucket.objects.keys()].filter(key => key.startsWith('music/ledger/'))).toEqual([KEY]);
    expect(h.ledger.ledgerKeyFor('video-1')).toBe(KEY);
    const record = JSON.parse(bucket.objects.get(KEY)!);
    expect(record).toMatchObject({version: 1, kind: 'music_specialist_bgm', maxGenerations: 1, state: 'resolved', resolution: {outcome: 'generated', costUsd: 0.0075, asset: {cacheKey: PLAN.cache_key, url: plan!.url}}});
    expect(JSON.stringify(record)).not.toMatch(/secret|api[_-]?key|Bearer|RUNWARE/i);
  });

  it('17. ids that do not map to the approved key unchanged are refused (never rewritten into another key)', async () => {
    expect(() => h.ledger.ledgerKeyFor('a/b')).toThrow('ledger_invalid_video_id');
    expect(() => h.ledger.ledgerKeyFor('')).toThrow('ledger_invalid_video_id');
    const a = instance(h, new FakeBucket({honorIfNoneMatch: true}));
    expect(await a.run({video_id: '../escape'})).toBeNull();
    expect(a.calls.failOpen).toEqual(['ledger_invalid_video_id']);
    expect(liveSpawns(a.calls)).toBe(0);
  });

  it('2. two concurrent jobs for one video in one instance: one winner, one paid spawn', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true, latencyMs: () => 5});
    const a = instance(h, bucket);
    const results = await Promise.all([a.run(), a.run(), a.run()]);
    expect(liveSpawns(a.calls)).toBe(1);
    // Each loser either fell back (winner still in flight) or reused the winner's finished bed; none generated.
    const reused = h.logs.filter(log => log.msg === 'music.ledger_reuse').length;
    expect(a.calls.failOpen.every(reason => reason === 'already_generated')).toBe(true);
    expect(a.calls.failOpen.length + reused).toBe(2);
    expect(results.filter(plan => plan !== null).length).toBe(1 + reused);
  });

  it('3. independent application instances (separate store objects, same bucket) cannot both claim; random latencies', async () => {
    for (let round = 0; round < 20; round += 1) {
      const bucket = new FakeBucket({honorIfNoneMatch: true, latencyMs: () => Math.floor(Math.random() * 8)});
      const instances = Array.from({length: 5}, () => instance(h, bucket));
      await Promise.all(instances.map(i => i.run()));
      expect(instances.reduce((sum, i) => sum + liveSpawns(i.calls), 0)).toBe(1);
    }
  });

  it('3 (control). the guarantee rests on the server enforcing If-None-Match: a backend that ignores it admits several winners', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: false, latencyMs: () => 3});
    const instances = Array.from({length: 3}, () => instance(h, bucket));
    await Promise.all(instances.map(i => i.run()));
    expect(instances.reduce((sum, i) => sum + liveSpawns(i.calls), 0)).toBeGreaterThan(1);
  });

  it('18. the claim is one conditional PUT (If-None-Match: *), with no Get or Head before it', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket);
    await a.run();
    const ledgerCommands = bucket.commands.filter(command => command.key === KEY);
    expect(ledgerCommands[0]).toMatchObject({name: 'PutObjectCommand', key: KEY, ifNoneMatch: '*'});
    expect(ledgerCommands[0]!.writeId).toMatch(/^[0-9a-f-]{36}$/); // Phase 1.7.4: every claim carries a unique write-id
    expect(JSON.parse(bucket.objects.get(KEY)!).claim.writeId).toBe(ledgerCommands[0]!.writeId);
    expect(ledgerCommands.map(command => command.name)).toEqual(['PutObjectCommand', 'PutObjectCommand']); // claim, then resolve
    expect(ledgerCommands[1]!.ifNoneMatch).toBeUndefined();
    expect(bucket.commands.some(command => command.name === 'HeadObjectCommand')).toBe(false);
    void HeadObjectCommand;
  });

  it('4 + 12. a changed prompt (new cache key) or a lost cache object reuses the video\'s generated bed; no second paid spawn', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const first = instance(h, bucket);
    const original = await first.run();
    const changed = instance(h, bucket, {plan: {cache_key: 'b'.repeat(64), seed: 99}});
    const reused = await changed.run({brief: {style: 'upbeat-pop', family: 'high-energy', bpm: 112, key: 'G major', arc: 'build'}});
    expect(liveSpawns(changed.calls)).toBe(0);
    expect(reused).toMatchObject({url: original!.url, cacheKey: PLAN.cache_key, costUsd: 0});
    expect(h.logs.find(log => log.msg === 'music.ledger_reuse')!.obj).toMatchObject({video_id: 'video-1', cost_usd: 0});
    const sameButNoCache = instance(h, bucket);
    expect(await sameButNoCache.run()).toMatchObject({url: original!.url});
    expect(liveSpawns(sameButNoCache.calls)).toBe(0);
  });

  it('13. an existing cache hit returns the stored bed without touching the ledger or spawning a paid run', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket, {cached: 'https://media.example.invalid/cached.wav'});
    expect(await a.run()).toMatchObject({url: 'https://media.example.invalid/cached.wav'});
    expect(a.calls.spawn).toEqual(['plan']);
    expect(bucket.commands).toEqual([]);
  });

  it('5 + 6 + 8. QC failure: no retry, no further agent call, the rejected bed is not used, spooled, uploaded or pooled; no fallback means no music', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket, {live: async () => generatedResult({qc_passed: false, qc_vocal_score: 0.9, cost_usd: 0.0075})});
    expect(await a.run()).toBeNull();
    expect(a.calls.spawn).toEqual(['plan', 'live']);
    expect(a.calls.upload).toBe(0);
    expect(a.calls.spool).toBe(0);
    expect(a.calls.failOpen).toEqual(['qc_failed']);
    expect(h.logs.find(log => log.msg === 'music.qc_failed')!.obj).toMatchObject({video_id: 'video-1', cache_key: PLAN.cache_key, cost_usd: 0.0075, qc: {passed: false, vocalScore: 0.9}});
    expect(JSON.parse(bucket.objects.get(KEY)!)).toMatchObject({state: 'resolved', resolution: {outcome: 'qc_failed', costUsd: 0.0075, asset: null, qc: {passed: false}}});
    // the video stays consumed: a re-run with a different prompt does not generate again
    const again = instance(h, bucket, {plan: {cache_key: 'c'.repeat(64)}});
    expect(await again.run()).toBeNull();
    expect(liveSpawns(again.calls)).toBe(0);
    expect(again.calls.failOpen).toEqual(['already_generated']);
  });

  it('7. QC failure selects an eligible pool fallback', async () => {
    const pooled = {cacheKey: 'p'.repeat(64), url: 'https://media.example.invalid/pool.wav', fromPool: true, fallbackReason: 'qc_failed', fallbackTier: 'style'};
    const a = instance(h, new FakeBucket({honorIfNoneMatch: true}), {live: async () => generatedResult({qc_passed: false}), fallback: reason => (reason === 'qc_failed' ? pooled : null)});
    expect(await a.run()).toEqual(pooled);
    expect(a.calls.upload).toBe(0);
  });

  it('9. a failing fallback does not cause another paid generation (no throw escapes, no re-spawn)', async () => {
    const a = instance(h, new FakeBucket({honorIfNoneMatch: true}), {live: async () => generatedResult({qc_passed: false}), fallback: () => { throw new Error('pool read failed'); }});
    expect(await a.run()).toBeNull();
    expect(a.calls.spawn).toEqual(['plan', 'live']);
  });

  it('a Python-side QC retry, if the agent ever reports one, is surfaced as music.qc_retry_detected', async () => {
    const a = instance(h, new FakeBucket({honorIfNoneMatch: true}), {live: async () => generatedResult({qc_passed: true, qc_retried: true})});
    await a.run();
    expect(h.logs.find(log => log.msg === 'music.qc_retry_detected')).toBeTruthy();
  });

  it('10. a provider timeout (hard kill) leaves the video consumed', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket, {live: async () => { throw new Error('music_specialist exited null: '); }});
    expect(await a.run()).toBeNull();
    expect(a.calls.failOpen).toEqual(['timeout']);
    expect(JSON.parse(bucket.objects.get(KEY)!)).toMatchObject({state: 'resolved', resolution: {outcome: 'failed', reason: 'timeout', costUsd: null}});
    const again = instance(h, bucket);
    await again.run();
    expect(liveSpawns(again.calls)).toBe(0);
  });

  it('11. an interrupted job (claimed, never resolved) and an unwritable resolution both leave the video consumed', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const store = new h.ledger.R2ConditionalLedgerStore({client: bucket.client(), bucket: 'b', PutObjectCommand: PutObjectCommand as never, GetObjectCommand: GetObjectCommand as never});
    expect((await h.ledger.claimGeneration(store, {videoId: 'video-1', cacheKey: 'z'.repeat(64), seed: 1, promptVersion: 4, estimatedCostUsd: 0.0075, now: 'then'})).outcome).toBe('won');
    const a = instance(h, bucket);
    expect(await a.run()).toBeNull();
    expect(liveSpawns(a.calls)).toBe(0);
    expect(h.logs.find(log => log.msg === 'music.ledger_consumed')!.obj).toMatchObject({ledger: 'claimed'});

    const other = new FakeBucket({honorIfNoneMatch: true});
    const b = instance(h, other);
    let puts = 0;
    b.store.replace = async () => {
      puts += 1;
      throw Object.assign(new Error('network'), {name: 'TimeoutError'});
    };
    await b.run();
    expect(puts).toBe(1);
    expect(JSON.parse(other.objects.get(KEY)!).state).toBe('claimed');
    expect(h.logs.find(log => log.msg === 'music.ledger_resolve_failed')).toBeTruthy();
    const c = instance(h, other);
    await c.run();
    expect(liveSpawns(c.calls)).toBe(0);
  });

  it('an ambiguous claim (storage error) never generates', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket);
    a.store.createIfAbsent = async () => {
      throw Object.assign(new Error('socket hang up'), {name: 'TimeoutError'});
    };
    expect(await a.run()).toBeNull();
    expect(a.calls.failOpen).toEqual(['ledger_claim_error']);
    expect(liveSpawns(a.calls)).toBe(0);
  });

  it('14. the global cost cap still refuses before any claim; the agent payload keeps the global max_usd and the SFX flag', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket, {plan: {estimated_cost_usd: 0.03}});
    expect(await a.run()).toBeNull();
    expect(a.calls.failOpen).toEqual(['cost_cap']);
    expect(bucket.commands).toEqual([]);

    let sent: Record<string, unknown> = {};
    const spawnImpl = (() => {
      const child = new EventEmitter() as EventEmitter & {stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void};
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => undefined;
      let raw = '';
      child.stdin.on('data', chunk => (raw += String(chunk)));
      child.stdin.on('end', () => {
        sent = JSON.parse(raw);
        child.stdout.end(JSON.stringify(PLAN));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    }) as never;
    await h.music.spawnMusic('plan', {transcript_segments: [], visual_cuts: [{at_ms: 1000}], emotional_tone: 'calm', canvas_sec: 30, include_sfx: true, video_id: 'video-1'}, {spawnImpl, env: {}});
    expect(sent).toMatchObject({max_usd: 0.02, include_sfx: true});
  });

  it('16. dry mode is unchanged: no ledger traffic, the bed is uploaded as before, even when it failed QC', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const a = instance(h, bucket, {mode: 'dry', ledgerOff: true, live: async () => generatedResult({mode: 'dry', qc_passed: false, cost_usd: 0})});
    const plan = await a.run();
    expect(plan).toMatchObject({url: `https://media.example.invalid/music/beds/${PLAN.cache_key}/bed.wav`});
    expect(a.calls.spawn).toEqual(['plan', 'dry']);
    expect(a.calls.upload).toBe(1);
    expect(bucket.commands).toEqual([]);
  });

  it('different videos have independent records', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    for (const id of ['video-a', 'video-b']) {
      const i = instance(h, bucket);
      await i.run({video_id: id});
      expect(liveSpawns(i.calls)).toBe(1);
    }
    expect([...bucket.objects.keys()].sort()).toEqual(['music/ledger/video-a.json', 'music/ledger/video-b.json']);
  });

  // --- Phase 1.7.4 ---------------------------------------------------------------------------------------------------------------------
  it('1.7.4 wiring: the R2 store is used only with MUSIC_GENERATION_LEDGER=r2 and a real R2 client; the default stays fail-closed', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const fakeR2 = () => ({client: bucket.client() as never, bucket: 'test-bucket'});
    expect(h.ledger.resolveMusicLedgerStore({}, fakeR2)).toBeNull();
    expect(h.ledger.resolveMusicLedgerStore({MUSIC_GENERATION_LEDGER: 'yes'}, fakeR2)).toBeNull();
    expect(h.ledger.resolveMusicLedgerStore({MUSIC_GENERATION_LEDGER: 'r2'}, () => null)).toBeNull(); // R2 unconfigured or local store
    const store = h.ledger.resolveMusicLedgerStore({MUSIC_GENERATION_LEDGER: ' R2 '}, fakeR2);
    expect(store).toMatchObject({name: 'r2-conditional-put', atomicCreateVerified: true});
    // The wired store sends the real SDK commands: one conditional PutObject with a write-id, to the exact key, with no read before it.
    const claim = await h.ledger.claimGeneration(store!, {videoId: 'video-1', cacheKey: 'k'.repeat(64), seed: 1, promptVersion: 4, estimatedCostUsd: 0.0075, now: 'now'});
    expect(claim.outcome).toBe('won');
    expect(bucket.commands).toHaveLength(1);
    expect(bucket.commands[0]).toMatchObject({name: 'PutObjectCommand', key: 'music/ledger/video-1.json', ifNoneMatch: '*'});
    expect(bucket.commands[0]!.writeId).toBe(claim.outcome === 'won' ? claim.record.claim.writeId : 'x');
  });

  it('1.7.4 default configuration does not activate live generation (mode off, no ledger store)', async () => {
    const flags = await import('./flags.ts');
    expect(flags.resolveMusicMode({}).mode).toBe('off');
    expect(h.ledger.resolveMusicLedgerStore({})).toBeNull();
  });

  it('1.7.4 an SDK-retried PUT that had committed (412 on the retry) is recognised by its own write-id: the claim is won, once', async () => {
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    const inner = bucket.client();
    let first = true;
    const retryingClient = {
      send: async (command: {input: Record<string, unknown>; constructor: {name: string}}) => {
        if (first && command.constructor.name === 'PutObjectCommand') {
          first = false;
          await inner.send(command); // commits...
          return inner.send(command); // ...then the SDK's automatic retry of the "lost" response gets 412
        }
        return inner.send(command);
      },
    };
    const store = new h.ledger.R2ConditionalLedgerStore({client: retryingClient, bucket: 'b', PutObjectCommand: PutObjectCommand as never, GetObjectCommand: GetObjectCommand as never});
    const won = await h.ledger.claimGeneration(store, {videoId: 'video-1', cacheKey: 'k'.repeat(64), seed: 1, promptVersion: 4, estimatedCostUsd: 0.0075, now: 'now'});
    expect(won.outcome).toBe('won');
    // A genuinely different claimant still loses.
    const other = await h.ledger.claimGeneration(store, {videoId: 'video-1', cacheKey: 'z'.repeat(64), seed: 2, promptVersion: 4, estimatedCostUsd: 0.0075, now: 'later'});
    expect(other.outcome).toBe('lost');
  });

  it('1.7.4 409 (documented by R2 only as ObjectLockedByBucketPolicy) and auth or network errors fail closed, never generate', async () => {
    for (const error of [
      Object.assign(new Error('locked'), {name: 'ObjectLockedByBucketPolicy', $metadata: {httpStatusCode: 409}}),
      Object.assign(new Error('denied'), {name: 'AccessDenied', $metadata: {httpStatusCode: 403}}),
      Object.assign(new Error('socket'), {name: 'TimeoutError'}),
    ]) {
      const client = {send: async () => { throw error; }};
      const store = new h.ledger.R2ConditionalLedgerStore({client, bucket: 'b', PutObjectCommand: PutObjectCommand as never, GetObjectCommand: GetObjectCommand as never});
      await expect(store.createIfAbsent('music/ledger/video-1.json', '{}', 'w')).rejects.toBe(error);
      const bucket = new FakeBucket({honorIfNoneMatch: true});
      const a = instance(h, bucket);
      a.store.createIfAbsent = async () => { throw error; };
      expect(await a.run()).toBeNull();
      expect(a.calls.failOpen).toEqual(['ledger_claim_error']);
      expect(liveSpawns(a.calls)).toBe(0);
    }
  });

  it('1.7.4 a losing claimant falls back (no paid spawn) for claimed, failed, qc_failed, upload_failed and malformed records; reuses only generated', async () => {
    const base = {version: 1, kind: 'music_specialist_bgm', videoId: 'video-1', maxGenerations: 1, claim: {claimedAt: 't', instanceId: 'i', writeId: 'w', cacheKey: 'z'.repeat(64), seed: 1, promptVersion: 4, estimatedCostUsd: 0.0075}};
    const resolution = (outcome: string, asset: unknown = null) => ({resolvedAt: 't', outcome, reason: outcome, costUsd: 0.0075, qc: null, asset});
    const cases: Array<[string, string]> = [
      ['claimed', JSON.stringify({...base, state: 'claimed', resolution: null})],
      ['failed', JSON.stringify({...base, state: 'resolved', resolution: resolution('failed')})],
      ['qc_failed', JSON.stringify({...base, state: 'resolved', resolution: resolution('qc_failed')})],
      ['upload_failed', JSON.stringify({...base, state: 'resolved', resolution: resolution('upload_failed')})],
      ['malformed json', '{not json'],
      ['wrong schema', JSON.stringify({hello: 'world'})],
      ['generated without asset', JSON.stringify({...base, state: 'resolved', resolution: resolution('generated')})],
    ];
    for (const [label, body] of cases) {
      const bucket = new FakeBucket({honorIfNoneMatch: true});
      bucket.objects.set(KEY, body);
      const a = instance(h, bucket, {plan: {cache_key: 'c'.repeat(64)}});
      expect(await a.run(), label).toBeNull();
      expect(a.calls.failOpen, label).toEqual(['already_generated']);
      expect(liveSpawns(a.calls), label).toBe(0);
    }
    const bucket = new FakeBucket({honorIfNoneMatch: true});
    bucket.objects.set(KEY, JSON.stringify({...base, state: 'resolved', resolution: resolution('generated', {cacheKey: 'z'.repeat(64), url: 'https://media.example.invalid/z.wav'})}));
    const reuse = instance(h, bucket, {plan: {cache_key: 'c'.repeat(64)}});
    expect(await reuse.run()).toMatchObject({url: 'https://media.example.invalid/z.wav', cacheKey: 'z'.repeat(64), costUsd: 0});
    expect(liveSpawns(reuse.calls)).toBe(0);
  });
});
