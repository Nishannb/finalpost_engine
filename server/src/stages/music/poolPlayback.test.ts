import {describe, expect, it} from 'vitest';

import {poolPlan} from './musicSpecialist.ts';
import {playbackFromPlan, toAudioDesign} from './toAudioDesign.ts';
import {mergePoolEntry, type PoolBed} from './uploadBed.ts';

const BASE = {cache_key: 'a'.repeat(64), url: 'https://r2.test/bed.wav'};

function design(bed: PoolBed, env: NodeJS.ProcessEnv) {
  const plan = poolPlan(bed, 'high-energy');
  return toAudioDesign({
    resolved: {url: plan.url as string, source: 'generated'},
    mood: 'high-energy',
    ...playbackFromPlan(plan, env),
  });
}

describe('pool bed playback', () => {
  it('old entry with only url keeps single-file playback', () => {
    const out = design(BASE, {MUSIC_CARVED_TWIN: '1'});
    expect(out.musicUrl).toBe(BASE.url);
    expect(out).not.toHaveProperty('musicLoopUrl');
    expect(out).not.toHaveProperty('musicFullUrl');
    expect(out).not.toHaveProperty('musicCarvedUrl');
  });

  it('loop_url plus duration_sec yields loop fields', () => {
    const out = design({...BASE, loop_url: 'https://r2.test/bed_loop.wav', duration_sec: 56.68}, {});
    expect(out.musicLoopUrl).toBe('https://r2.test/bed_loop.wav');
    expect(out.musicFullDurationSec).toBe(56.68);
    expect(out.musicFullUrl).toBe(BASE.url);
  });

  it('uses full_url when present', () => {
    const out = design({...BASE, full_url: 'https://r2.test/bed_full.wav', loop_url: 'https://r2.test/bed_loop.wav', duration_sec: 56.68}, {});
    expect(out.musicFullUrl).toBe('https://r2.test/bed_full.wav');
  });

  it('carved_url is used by default and dropped only when MUSIC_CARVED_TWIN=0', () => {
    const bed = {...BASE, loop_url: 'https://r2.test/bed_loop.wav', carved_url: 'https://r2.test/bed_carved.wav', duration_sec: 56.68};
    expect(design(bed, {MUSIC_CARVED_TWIN: '1'}).musicCarvedUrl).toBe('https://r2.test/bed_carved.wav');
    expect(design(bed, {}).musicCarvedUrl).toBe('https://r2.test/bed_carved.wav');
    expect(design(bed, {MUSIC_CARVED_TWIN: '0'})).not.toHaveProperty('musicCarvedUrl');
  });

  it('never sets musicCarvedUrl for a licensed bed', () => {
    const out = toAudioDesign({resolved: {url: 'https://l.test/a.mp3', source: 'licensed'}, carvedUrl: 'https://r2.test/bed_carved.wav'});
    expect(out).not.toHaveProperty('musicCarvedUrl');
  });

  it('loop_url without duration_sec gives no loop', () => {
    const out = design({...BASE, loop_url: 'https://r2.test/bed_loop.wav'}, {});
    expect(out).not.toHaveProperty('musicLoopUrl');
  });
});

describe('mergePoolEntry', () => {
  it('patches an existing entry in place and keeps its keys', () => {
    const original: PoolBed & {extra: string} = {...BASE, mood: 'high-energy', bpm: 120, extra: 'keep'};
    const out = mergePoolEntry([original], {...BASE, added_at: 'now'}, {loop_url: 'https://r2.test/bed_loop.wav', duration_sec: 56.68});
    expect(out.changed).toBe(true);
    expect(out.beds).toHaveLength(1);
    expect(out.beds[0]).toEqual({...original, loop_url: 'https://r2.test/bed_loop.wav', duration_sec: 56.68});
    expect(original).not.toHaveProperty('loop_url');
  });

  it('is a no-op for an existing key with an empty patch', () => {
    const out = mergePoolEntry([BASE], BASE, {duration_sec: undefined});
    expect(out.changed).toBe(false);
    expect(out.beds).toEqual([BASE]);
  });

  it('appends a new cache key', () => {
    const other = {cache_key: 'b'.repeat(64), url: 'https://r2.test/b.wav'};
    const out = mergePoolEntry([BASE], other);
    expect(out.beds).toHaveLength(2);
    expect(out.beds[1]).toEqual(other);
  });
});
