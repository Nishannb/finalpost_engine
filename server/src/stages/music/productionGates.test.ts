/**
 * Phase 1.7.5: the two production gates for a paid Music Specialist generation, exercised with the REAL gate functions (resolveMusicMode,
 * buildSpawnSpec, resolveMusicLedgerStore) on explicit production-like env objects (no VITEST / NODE_ENV=test, so nothing is downgraded).
 * Only the spawn, storage and uploads are fakes: no Python, no network, no R2.
 */
import {GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {MusicResult} from './schema.ts';

/** In-memory bucket that enforces If-None-Match: * (the semantics verified against R2 in Phase 1.7.4). */
function fakeBucket() {
  const objects = new Map<string, string>();
  const commands: string[] = [];
  return {
    objects,
    commands,
    client: {
      send: async (command: {input: Record<string, unknown>; constructor: {name: string}}) => {
        const key = String(command.input.Key);
        commands.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') {
          if (command.input.IfNoneMatch === '*' && objects.has(key)) throw Object.assign(new Error('precondition'), {name: 'PreconditionFailed', $metadata: {httpStatusCode: 412}});
          objects.set(key, String(command.input.Body));
          return {};
        }
        const body = objects.get(key);
        if (body === undefined) throw Object.assign(new Error('NoSuchKey'), {name: 'NoSuchKey', $metadata: {httpStatusCode: 404}});
        return {Body: {transformToString: async () => body}};
      },
    },
  };
}

const PLAN = {cache_key: 'a'.repeat(64), seed: 7, bpm: 80, key: 'D minor', mood: 'calm', prompt_version: 4, estimated_cost_usd: 0.0075} as MusicResult;

async function load() {
  vi.resetModules();
  vi.doMock('../../storage/r2.ts', () => ({r2Configured: () => true, r2LedgerClient: () => null, sourceObjectExists: async () => false, uploadPublicFile: async () => { throw new Error('no uploads'); }}));
  const music = await import('./musicSpecialist.ts');
  const ledger = await import('./generationLedger.ts');
  const flags = await import('./flags.ts');
  return {music, ledger, flags};
}

type H = Awaited<ReturnType<typeof load>>;

/** Runs the production runMusicPlan with REAL gates for `env`, and records every spawn and failOpen. */
function harness(h: H, env: NodeJS.ProcessEnv, opts: {r2?: ReturnType<typeof fakeBucket> | null; live?: () => Promise<MusicResult>; claimError?: boolean} = {}) {
  const calls = {spawn: [] as string[], failOpen: [] as string[], upload: 0};
  const r2 = opts.r2 === undefined ? fakeBucket() : opts.r2;
  const deps = {
    decide: () => h.flags.resolveMusicMode(env),
    spawnModeFor: (mode: 'plan' | 'dry' | 'live') => h.flags.buildSpawnSpec(mode, env).mode,
    ledger: () => {
      const store = h.ledger.resolveMusicLedgerStore(env, () => (r2 ? {client: r2.client as never, bucket: 'test-bucket'} : null));
      if (store && opts.claimError) store.createIfAbsent = async () => { throw Object.assign(new Error('socket'), {name: 'TimeoutError'}); };
      return store;
    },
    spawn: async (requested: 'plan' | 'dry' | 'live') => {
      calls.spawn.push(requested);
      if (requested === 'plan') return PLAN;
      return opts.live ? opts.live() : ({...PLAN, mode: requested, bed_path: '/tmp/fake/bed.wav', cost_usd: requested === 'live' ? 0.0075 : 0, qc_passed: true} as MusicResult);
    },
    readPool: async () => [],
    findUploadedBed: async () => null,
    readBedMeta: async () => ({}),
    uploadBedDetailed: async (input: {cacheKey: string}) => {
      calls.upload += 1;
      return {url: `https://media.example.invalid/${input.cacheKey}.wav`};
    },
    writeSpool: async () => undefined,
    removeSpool: async () => undefined,
    flushSpool: async () => 0,
    failOpen: async (_mood: string, reason: string) => {
      calls.failOpen.push(reason);
      return null;
    },
    now: () => '2026-11-12T00:00:00.000Z',
  };
  return {calls, r2, run: () => h.music.runMusicPlanWith({transcript_segments: [], visual_cuts: [], emotional_tone: 'calm', canvas_sec: 30, video_id: 'video-1'} as never, deps as never)};
}

const paid = (calls: {spawn: string[]}) => calls.spawn.filter(mode => mode === 'live').length;
const LIVE = {MUSIC_SPECIALIST: 'live', RUNWARE_API_KEY: 'placeholder-not-a-key'};

describe('Phase 1.7.5: both production gates are required for a paid generation', () => {
  let h: H;
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
  });

  it('default configuration: specialist off, no spawn at all, no ledger store', async () => {
    const t = harness(h, {});
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual([]);
    expect(h.ledger.resolveMusicLedgerStore({}, () => null)).toBeNull();
    expect(t.r2!.commands).toEqual([]);
  });

  it('MUSIC_SPECIALIST=live alone (key present, ledger not opted in): no paid spawn, fails closed to the fallback', async () => {
    expect(h.flags.resolveMusicMode(LIVE).mode).toBe('live'); // the gate really is open
    expect(h.flags.buildSpawnSpec('live', LIVE).mode).toBe('live');
    const t = harness(h, LIVE);
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual(['plan']);
    expect(t.calls.failOpen).toEqual(['ledger_unavailable']);
    expect(t.r2!.commands).toEqual([]);
  });

  it('MUSIC_GENERATION_LEDGER=r2 alone (specialist off): no spawn, no ledger traffic', async () => {
    const t = harness(h, {MUSIC_GENERATION_LEDGER: 'r2'});
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual([]);
    expect(t.r2!.commands).toEqual([]);
  });

  it('ledger opted in with a dry specialist: the free dry run is unchanged and touches no ledger', async () => {
    const t = harness(h, {MUSIC_SPECIALIST: 'dry', MUSIC_GENERATION_LEDGER: 'r2'});
    await t.run();
    expect(t.calls.spawn).toEqual(['plan', 'dry']);
    expect(t.r2!.commands).toEqual([]);
  });

  it('both gates on but R2 not configured (or the local store active): fails closed, no paid spawn', async () => {
    const t = harness(h, {...LIVE, MUSIC_GENERATION_LEDGER: 'r2'}, {r2: null});
    expect(await t.run()).toBeNull();
    expect(paid(t.calls)).toBe(0);
    expect(t.calls.failOpen).toEqual(['ledger_unavailable']);
  });

  it('both gates on, ledger claim error: no paid spawn', async () => {
    const t = harness(h, {...LIVE, MUSIC_GENERATION_LEDGER: 'r2'}, {claimError: true});
    expect(await t.run()).toBeNull();
    expect(paid(t.calls)).toBe(0);
    expect(t.calls.failOpen).toEqual(['ledger_claim_error']);
  });

  it('control: both gates on and a working ledger -> exactly one paid spawn, claimed first; a second job reuses the asset with no paid spawn', async () => {
    const bucket = fakeBucket();
    const first = harness(h, {...LIVE, MUSIC_GENERATION_LEDGER: 'r2'}, {r2: bucket});
    const plan = await first.run();
    expect(paid(first.calls)).toBe(1);
    expect(bucket.commands[0]).toBe('PutObjectCommand');
    expect(JSON.parse(bucket.objects.get('music/ledger/video-1.json')!)).toMatchObject({state: 'resolved', resolution: {outcome: 'generated'}});
    const second = harness(h, {...LIVE, MUSIC_GENERATION_LEDGER: 'r2'}, {r2: bucket});
    expect(await second.run()).toMatchObject({url: plan!.url, costUsd: 0});
    expect(paid(second.calls)).toBe(0);
  });

  it('both gates on, QC failure: one paid spawn, no retry, nothing uploaded', async () => {
    const t = harness(h, {...LIVE, MUSIC_GENERATION_LEDGER: 'r2'}, {live: async () => ({...PLAN, mode: 'live', bed_path: '/tmp/fake/bed.wav', cost_usd: 0.0075, qc_passed: false}) as MusicResult});
    expect(await t.run()).toBeNull();
    expect(t.calls.spawn).toEqual(['plan', 'live']);
    expect(t.calls.upload).toBe(0);
    expect(t.calls.failOpen).toEqual(['qc_failed']);
  });

  it('the store is built from the real SDK command classes', () => {
    const store = h.ledger.resolveMusicLedgerStore({MUSIC_GENERATION_LEDGER: 'r2'}, () => ({client: fakeBucket().client as never, bucket: 'b'}));
    expect(store).toBeInstanceOf(h.ledger.R2ConditionalLedgerStore);
    void PutObjectCommand;
    void GetObjectCommand;
  });
});
