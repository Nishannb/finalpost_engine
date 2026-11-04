import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {PassThrough} from 'node:stream';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {pickNearestBpm, placementPoolFields, type PoolBed} from './uploadBed.ts';

const bed = (name: string, bpm: number | undefined, extra: Partial<PoolBed> = {}): PoolBed => ({
  cache_key: name.repeat(64).slice(0, 64),
  url: `https://media.kinmel.shop/music/beds/${name}/bed.wav`,
  ...(bpm !== undefined ? {bpm} : {}),
  ...extra,
});

describe('pickNearestBpm', () => {
  it('takes the bed whose tempo is nearest the brief', () => {
    const beds = [bed('a', 72), bed('b', 88), bed('c', 104)];
    expect(pickNearestBpm('v', beds, 86)!.cache_key[0]).toBe('b');
    expect(pickNearestBpm('v', beds, 60)!.cache_key[0]).toBe('a');
    expect(pickNearestBpm('v', beds, 200)!.cache_key[0]).toBe('c');
  });
  it('breaks a tie with the video hash: stable per video, and both beds get picked across videos', () => {
    const beds = [bed('a', 80), bed('b', 96)]; // both 8 away from 88
    const pick = (video: string) => pickNearestBpm(video, beds, 88)!.cache_key[0];
    expect(pick('video-1')).toBe(pick('video-1'));
    expect(new Set(Array.from({length: 30}, (_, i) => pick(`video-${i}`)))).toEqual(new Set(['a', 'b']));
  });
  it('beds with no tempo lose to a bed with one, and an empty pool is null', () => {
    expect(pickNearestBpm('v', [bed('a', undefined), bed('b', 120)], 70)!.cache_key[0]).toBe('b');
    expect(pickNearestBpm('v', [bed('a', undefined)], 70)!.cache_key[0]).toBe('a');
    expect(pickNearestBpm('v', [], 70)).toBeNull();
  });
});

describe('placementPoolFields', () => {
  it('keeps the measured fields that are present and drops the rest', () => {
    expect(placementPoolFields({style: 'lofi-chill', family: 'calm', arc: 'build', measured_bpm: 79.9, downbeat_times: [0.5, 2.5], energy_map: [0.1, 0.9], lift_sec: 2.5, lift_bar: 1, bar_sec: 2, loop_duration_sec: 30, loop_bars: 16, junk: 1})).toEqual({
      style: 'lofi-chill', family: 'calm', arc: 'build', measured_bpm: 79.9, downbeat_times: [0.5, 2.5], energy_map: [0.1, 0.9], lift_sec: 2.5, lift_bar: 1, bar_sec: 2, loop_duration_sec: 30, loop_bars: 16,
    });
    expect(placementPoolFields({})).toEqual({}); // an older bed
    expect(placementPoolFields({downbeat_times: 'x', lift_sec: null})).toEqual({lift_sec: null});
  });
});

describe('fallback tiers and pool-first (fake pool, never R2)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock('../../storage/r2.ts');
    vi.doUnmock('../../lib/logger.ts');
  });

  /** pools: name -> beds. Everything that reads a pool goes through this fake fetch; R2 is never written. */
  async function load(pools: Record<string, PoolBed[]>) {
    vi.resetModules();
    const warns: Array<{obj: Record<string, unknown>; msg: string}> = [];
    const infos: Array<{obj: Record<string, unknown>; msg: string}> = [];
    vi.doMock('../../storage/r2.ts', () => ({r2Configured: () => true, sourceObjectExists: async () => false, uploadPublicFile: async () => { throw new Error('the test must never upload'); }}));
    vi.doMock('../../lib/logger.ts', () => ({
      stageLogger: () => ({
        info: (obj: Record<string, unknown>, msg: string) => void infos.push({obj, msg}),
        warn: (obj: Record<string, unknown>, msg: string) => void warns.push({obj, msg}),
        error: () => undefined,
        debug: () => undefined,
      }),
      logger: {info: () => undefined, warn: () => undefined, error: () => undefined},
    }));
    vi.stubGlobal('fetch', async (url: string) => {
      const match = /music\/beds\/pool\/([a-z0-9-]+)\.json/.exec(String(url));
      const beds = match ? pools[match[1]!] : undefined;
      return beds ? {ok: true, json: async () => ({beds})} : {ok: false, json: async () => ({})};
    });
    const mod = await import('./musicSpecialist.ts');
    return {mod, warns, infos};
  }
  const brief = {style: 'lofi-chill', family: 'calm', bpm: 80, key: 'D minor', arc: 'steady'} as const;

  it('tier 1: the same style, nearest tempo', async () => {
    const {mod, warns} = await load({'lofi-chill': [bed('a', 72), bed('b', 84)], calm: [bed('z', 80)]});
    const plan = await mod.failOpen('lofi-chill', 'timeout', 'v', brief);
    expect(plan).toMatchObject({fallbackTier: 'style', fallbackReason: 'timeout', fromPool: true});
    expect(plan!.cacheKey[0]).toBe('b');
    expect(warns.find(item => item.msg === 'music.fallback')!.obj).toMatchObject({reason: 'timeout', tier: 'style'});
  });

  it('tier 2: no bed of that style, so the same family (the family pool and the other styles in it), nearest tempo', async () => {
    const {mod, warns} = await load({'lofi-chill': [], calm: [bed('s', 64, {style: undefined})], 'soft-acoustic': [bed('t', 78, {style: 'soft-acoustic'})]});
    const plan = await mod.failOpen('lofi-chill', 'cost_cap', 'v', brief);
    expect(plan).toMatchObject({fallbackTier: 'family', fallbackReason: 'cost_cap'});
    expect(plan!.cacheKey[0]).toBe('t'); // 78 is nearer 80 than 64
    expect(plan!.style).toBe('soft-acoustic');
    expect(warns.find(item => item.msg === 'music.fallback')!.obj).toMatchObject({reason: 'cost_cap', tier: 'family', family: 'calm'});
  });

  it('the salvaged bed in the high-energy family pool is the family fallback for a high-energy style', async () => {
    const salvaged = bed('s', 128, {full_url: 'https://media.kinmel.shop/s/bed_full.wav'});
    const {mod} = await load({'upbeat-pop': [], 'driving-electronic': [], 'high-energy': [salvaged]});
    const plan = await mod.failOpen('upbeat-pop', 'upload', 'v', {...brief, style: 'upbeat-pop', family: 'high-energy', bpm: 112});
    expect(plan).toMatchObject({fallbackTier: 'family', cacheKey: salvaged.cache_key, fullUrl: salvaged.full_url});
  });

  it('tier 3: nothing anywhere means no bed', async () => {
    const {mod, warns} = await load({});
    expect(await mod.failOpen('lofi-chill', 'spawn', 'v', brief)).toBeNull();
    expect(warns.find(item => item.msg === 'music.fallback')!.obj).toMatchObject({reason: 'spawn', tier: 'none'});
  });

  it('without a brief the fallback is the family pool as before', async () => {
    const {mod} = await load({calm: [bed('a', 70)]});
    expect(await mod.failOpen('calm', 'timeout', 'v')).toMatchObject({fallbackTier: 'style', cacheKey: 'a'.repeat(64)});
  });

  it('pool-first: a style pool with beds is a $0 hit on the nearest tempo, with the measured placement meta attached', async () => {
    const withMeta = bed('b', 84, {downbeat_times: [0.5, 2.5, 4.5], energy_map: [0.1, 0.2, 0.9], lift_sec: 4.5, lift_bar: 2, bar_sec: 2, duration_sec: 50});
    const {mod, infos} = await load({'lofi-chill': [bed('a', 72), withMeta]});
    // Hermetic: the engine .env is loaded with override and may set any of these.
    vi.stubEnv('MUSIC_SPECIALIST', 'dry');
    vi.stubEnv('POLISH_MUSIC_BED_URL', '');
    vi.stubEnv('MUSIC_BED_FRESH', '0');
    vi.stubEnv('MUSIC_BED_SOURCE', 'auto');
    const plan = await mod.startMusicPlan({transcript_segments: [], visual_cuts: [], emotional_tone: 'calm', canvas_sec: 20, video_id: 'v', brief});
    vi.unstubAllEnvs();
    expect(plan).toMatchObject({fromPool: true, costUsd: 0, cacheKey: withMeta.cache_key});
    expect(plan!.placement).toMatchObject({downbeatTimes: [0.5, 2.5, 4.5], liftSec: 4.5, fullDurationSec: 50, hasLoop: false});
    expect(infos.find(item => item.msg === 'music.pool_hit')!.obj).toMatchObject({mood: 'lofi-chill', bedBpm: 84, wantedBpm: 80, cost_usd: 0});
  });
});

describe('the brief reaches the Python specialist', () => {
  it('spawnMusic sends brief in the stdin payload; no brief, no key', async () => {
    const {spawnMusic} = await import('./musicSpecialist.ts');
    const result = JSON.stringify({cache_key: 'k'.repeat(32), seed: 1, bpm: 80, key: 'D minor', prompt_version: 4, mood: 'lofi-chill', style: 'lofi-chill', family: 'calm', arc: 'steady', downbeat_times: [0.5, 2.5], energy_map: [0.1, 0.9], lift_sec: 2.5, lift_bar: 1, bar_sec: 2, measured_bpm: 79.9});
    const run = async (payload: Parameters<typeof spawnMusic>[1]) => {
      let sent = '';
      const spawnImpl = (() => {
        const child = new EventEmitter() as EventEmitter & {stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void};
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new PassThrough();
        child.kill = () => undefined;
        child.stdin.on('data', chunk => (sent += chunk.toString()));
        child.stdin.on('end', () => {
          child.stdout.end(result);
          setImmediate(() => child.emit('close', 0));
        });
        return child;
      }) as never;
      const parsed = await spawnMusic('plan', payload, {spawnImpl, env: {}});
      return {sent: JSON.parse(sent) as Record<string, unknown>, parsed};
    };
    const base = {transcript_segments: [], visual_cuts: [], emotional_tone: 'calm', canvas_sec: 20, video_id: 'v'};
    const withBrief = await run({...base, brief: {style: 'lofi-chill', family: 'calm', bpm: 80, key: 'D minor', arc: 'steady'}});
    expect(withBrief.sent.brief).toEqual({style: 'lofi-chill', family: 'calm', bpm: 80, key: 'D minor', arc: 'steady'});
    expect(withBrief.parsed).toMatchObject({style: 'lofi-chill', arc: 'steady', downbeat_times: [0.5, 2.5], lift_sec: 2.5});
    expect((await run(base)).sent).not.toHaveProperty('brief');
  });

  it('runDirectorV2 builds the brief and passes it to the music job only behind MUSIC_PERSONALIZE', () => {
    const source = readFileSync(new URL('../directorV2/runDirectorV2.ts', import.meta.url), 'utf8');
    expect(source).toContain('input.editLooks && input.videoId && personalizeEnabled()');
    expect(source).toContain("...(musicBrief ? {brief: {style: musicBrief.style, family: musicBrief.family, bpm: musicBrief.bpm, key: musicBrief.key, arc: musicBrief.arc}} : {}),");
    expect(source).toContain("'music.brief'");
  });
});

describe('pool growth is keyed by style (fake R2)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock('../../storage/r2.ts');
  });
  async function upload(existing: PoolBed[]) {
    vi.resetModules();
    const uploads: Array<{key: string; body: string}> = [];
    vi.doMock('../../storage/r2.ts', () => ({
      r2Configured: () => true,
      sourceObjectExists: async () => false,
      uploadPublicFile: async (filePath: string, key: string) => {
        uploads.push({key, body: key.endsWith('.json') ? readFileSync(filePath, 'utf8') : ''});
        return {publicUrl: `https://fake-r2.test/${key}`, key};
      },
    }));
    vi.stubGlobal('fetch', async (url: string) => (String(url).includes('music/beds/pool/lofi-chill') ? {ok: true, json: async () => ({beds: existing})} : {ok: false, json: async () => ({})}));
    const {uploadBedDetailed} = await import('./uploadBed.ts');
    await uploadBedDetailed({
      filePath: '/nonexistent/bed.wav', cacheKey: 'n'.repeat(64), mood: 'lofi-chill', dry: false,
      meta: {bpm: 80, qc_passed: true, duration_sec: 50, style: 'lofi-chill', family: 'calm', arc: 'steady', downbeat_times: [0.5, 2.5], energy_map: [0.2, 0.8], lift_sec: 2.5, lift_bar: 1, bar_sec: 2},
    });
    return uploads;
  }
  it('appends to the style pool with the measured placement fields, until the pool is full', async () => {
    const uploads = await upload([bed('a', 72)]);
    const pool = uploads.find(item => item.key === 'music/beds/pool/lofi-chill.json');
    expect(pool).toBeDefined();
    const beds = JSON.parse(pool!.body).beds as PoolBed[];
    expect(beds.map(item => item.cache_key[0])).toEqual(['a', 'n']);
    expect(beds[1]).toMatchObject({style: 'lofi-chill', family: 'calm', arc: 'steady', downbeat_times: [0.5, 2.5], energy_map: [0.2, 0.8], lift_sec: 2.5, bar_sec: 2});
    expect(uploads.every(item => item.key.startsWith('music/beds/'))).toBe(true);
  });
  it('a full style pool stops growing; the bed for that video is still stored for this video', async () => {
    const uploads = await upload([bed('a', 70), bed('b', 76), bed('c', 82)]);
    expect(uploads.some(item => item.key.includes('pool/'))).toBe(false);
    expect(uploads.some(item => item.key.endsWith('/bed.wav'))).toBe(true);
  });
});
