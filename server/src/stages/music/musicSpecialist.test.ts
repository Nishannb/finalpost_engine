import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {VISUAL_MOODS} from '../contentProfile/contentProfile.ts';
import {buildSpawnSpec, bedFresh, isTestEnv, loadContentMoodMap, resolveMoodPool, resolveMusicMode} from './flags.ts';
import {mapWordsToSource} from './measureVoLufs.ts';
import {awaitMusicPlan, planMusicForDirector, spawnMusic, type MusicPlan} from './musicSpecialist.ts';
import {pickPoolBed, poolObjectKey} from './uploadBed.ts';

describe('planMusicForDirector', () => {
  it('returns null without spawning when MUSIC_SPECIALIST is unset', async () => {
    delete process.env.MUSIC_SPECIALIST;
    expect(await planMusicForDirector({})).toBeNull();
  });
});

describe('spawn spec (no real process)', () => {
  it('forces live → dry under vitest or NODE_ENV=test, even with MUSIC_SPECIALIST=live', () => {
    for (const env of [{VITEST: 'true'}, {NODE_ENV: 'test'}]) {
      const spec = buildSpawnSpec('live', {...env, MUSIC_SPECIALIST: 'live', RUNWARE_API_KEY: 'k'});
      expect(spec.mode).toBe('dry');
      expect(spec.forced).toBe(true);
      expect(spec.args).toEqual(['-m', 'music_specialist', '--mode', 'dry']);
      expect(spec.env.MUSIC_SPECIALIST_CALLER).toBeUndefined();
      expect(resolveMusicMode({...env, MUSIC_SPECIALIST: 'live', RUNWARE_API_KEY: 'k'}).mode).toBe('dry');
    }
    expect(isTestEnv(process.env)).toBe(true);
    expect(buildSpawnSpec('live').mode).toBe('dry');
  });

  it('sets the pipeline token only on a real live child', () => {
    const live = buildSpawnSpec('live', {RUNWARE_API_KEY: 'k'});
    expect(live.mode).toBe('live');
    expect(live.env.MUSIC_SPECIALIST_CALLER).toBe('pipeline');
    const plan = buildSpawnSpec('plan', {MUSIC_SPECIALIST_CALLER: 'pipeline'});
    expect(plan.env.MUSIC_SPECIALIST_CALLER).toBeUndefined();
    expect(buildSpawnSpec('dry', {}).args).toEqual(['-m', 'music_specialist', '--mode', 'dry']);
  });
});

describe('mood pool', () => {
  it('every VisualMood is in contentMoodMap.json; tech_sharp is high-energy', () => {
    const map = loadContentMoodMap();
    for (const mood of VISUAL_MOODS) expect(map[mood], mood).toBeTruthy();
    expect(resolveMoodPool('tech_sharp', {})).toBe('high-energy');
    expect(resolveMoodPool('dark_cinematic', {})).toBe('tense');
    expect(resolveMoodPool('clean_light', {})).toBe('neutral');
  });

  it('maps tones to the MoodSpec name; MUSIC_BED_MOOD overrides the map', () => {
    expect(resolveMoodPool('high-energy', {})).toBe('high-energy');
    expect(resolveMoodPool('Energetic and punchy', {})).toBe('high-energy');
    expect(resolveMoodPool('neutral talking-head', {})).toBe('neutral');
    expect(resolveMoodPool('zzz', {})).toBe('neutral');
    expect(resolveMoodPool('tech_sharp', {MUSIC_BED_MOOD: 'calm'})).toBe('calm');
    expect(resolveMoodPool('tech_sharp', {MUSIC_BED_MOOD: 'bogus'})).toBe('high-energy');
    expect(poolObjectKey('high-energy')).toBe('music/beds/pool/high-energy.json');
    expect(poolObjectKey('high-energy', true)).toBe('music/beds/pool/dry-high-energy.json');
  });

  it('picks the same bed for the same video id and spreads across ids', () => {
    const beds = ['a', 'b', 'c', 'd'];
    expect(pickPoolBed('vid-1', beds)).toBe(pickPoolBed('vid-1', beds));
    expect(pickPoolBed('vid-1', [])).toBeNull();
    expect(pickPoolBed('x', ['only'])).toBe('only');
    const picks = new Set(Array.from({length: 40}, (_, i) => pickPoolBed(`vid-${i}`, beds)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('MUSIC_BED_FRESH=1 is the only fresh switch', () => {
    expect(bedFresh({})).toBe(false);
    expect(bedFresh({MUSIC_BED_FRESH: '1'})).toBe(true);
  });
});

describe('resolver timeout vs. kill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const plan = (over: Partial<MusicPlan> = {}): MusicPlan => ({
    cacheKey: 'k'.repeat(20), seed: 1, bpm: 128, musicalKey: 'A minor', mood: 'high-energy', url: 'https://cdn.example/bed.wav',
    costUsd: 0.0075, estimatedCostUsd: 0.0075, promptVersion: 2, source: 'generated', ...over,
  });

  it('stops waiting at the timeout and continues with no bed, without cancelling the work', async () => {
    let finish!: (value: MusicPlan | null) => void;
    const pending = new Promise<MusicPlan | null>(resolve => { finish = resolve; });
    const waiting = awaitMusicPlan(pending, 45000);
    await vi.advanceTimersByTimeAsync(45001);
    expect(await waiting).toBeNull();
    finish(plan()); // child finishes later: the promise is still live, nothing was torn down
    await expect(pending).resolves.toMatchObject({url: 'https://cdn.example/bed.wav'});
  });

  it('returns the plan when it arrives in time', async () => {
    const pending = Promise.resolve(plan());
    const waiting = awaitMusicPlan(pending, 45000);
    await vi.advanceTimersByTimeAsync(10);
    expect((await waiting)?.bpm).toBe(128);
  });

  it('spawn: the resolver timeout does not kill the child; only the hard ceiling does', async () => {
    const kill = vi.fn();
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: {end: vi.fn()},
      kill,
    });
    const spawnImpl = vi.fn(() => child) as never;
    const done = spawnMusic('dry', {transcript_segments: [], visual_cuts: [], emotional_tone: 'x', canvas_sec: 5}, {spawnImpl, hardKillMs: 300000, env: {VITEST: '1'}});
    done.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(45001 + 60000);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300000);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    await expect(done).rejects.toThrow(/exited null/);
  });
});

describe('vo intervals', () => {
  it('maps output-time words onto the kept source audio', () => {
    const segments = [
      {sourceStart: 2, sourceEnd: 4, outputStart: 0},
      {sourceStart: 10, sourceEnd: 12, outputStart: 2},
    ];
    expect(mapWordsToSource([{start: 0.5, end: 1}, {start: 2.5, end: 3}, {start: 9, end: 9.5}], segments)).toEqual([[2.5, 3], [10.5, 11]]);
  });
});
