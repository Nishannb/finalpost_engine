import {describe, expect, it} from 'vitest';

import {schedulePolishSfxHits} from '../../lib/polishSfx.ts';
import {sfxEnabled} from './flags.ts';
import {collectVisualCuts, mergeHits, type MergeHit} from './mergeHits.ts';

const h = (at: number, priority: MergeHit['priority'], extra: Partial<MergeHit> = {}): MergeHit => ({
  at,
  kind: 'pop',
  priority,
  ...extra,
});

describe('mergeHits', () => {
  it('merges polish hits with fake agent hits that carry src', () => {
    const {hits} = schedulePolishSfxHits({
      graphics: [{start: 1, end: 3.4, placementMode: 'full_screen'}],
      transitions: [{at: 6, keyword: 'whip blur'}],
    });
    const polish: MergeHit[] = hits.map(hit => ({...hit, priority: 'kinetic' as const}));
    const agent: MergeHit[] = [
      h(1.1, 'cut', {src: '/prefetch/j/a.wav'}),
      h(9, 'ambience', {src: '/prefetch/j/b.wav'}),
    ];
    const out = mergeHits({hits: [...polish, ...agent], wordOnsetsSec: []});
    expect(out.find(x => x.src === '/prefetch/j/a.wav')).toBeUndefined();
    expect(out.find(x => x.src === '/prefetch/j/b.wav')?.at).toBe(9);
    expect(out.some(x => x.at === 1 && x.priority === 'kinetic')).toBe(true);
  });

  it('keeps the higher priority within 250 ms regardless of order', () => {
    const out = mergeHits({hits: [h(2.0, 'cut'), h(2.1, 'caption')], wordOnsetsSec: []});
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe('caption');
    const out2 = mergeHits({hits: [h(2.0, 'kinetic'), h(2.1, 'cut')], wordOnsetsSec: []});
    expect(out2[0].priority).toBe('kinetic');
  });

  it('keeps the earlier of equal priority', () => {
    const out = mergeHits({hits: [h(3.1, 'cut'), h(3.0, 'cut')], wordOnsetsSec: []});
    expect(out.map(x => x.at)).toEqual([3.0]);
  });

  it('drops invalid hits', () => {
    const out = mergeHits({hits: [h(-1, 'cut'), h(NaN, 'cut'), h(Infinity, 'cut')], wordOnsetsSec: []});
    expect(out).toEqual([]);
  });

  it('masks hits just after a word onset, keeps later and exact', () => {
    expect(mergeHits({hits: [h(1.05, 'cut')], wordOnsetsSec: [1]})).toEqual([]);
    expect(mergeHits({hits: [h(1.2, 'cut')], wordOnsetsSec: [1]})).toHaveLength(1);
    expect(mergeHits({hits: [h(1, 'cut')], wordOnsetsSec: [1]})).toHaveLength(1);
  });

  it('snaps to the beat grid within 60 ms only', () => {
    const snapped = mergeHits({hits: [h(0.52, 'cut')], wordOnsetsSec: [], bpm: 120, downbeatsSec: [0, 2]});
    expect(snapped[0].at).toBeCloseTo(0.5, 6);
    const far = mergeHits({hits: [h(0.7, 'cut')], wordOnsetsSec: [], bpm: 120, downbeatsSec: [0, 2]});
    expect(far[0].at).toBe(0.7);
    const nobpm = mergeHits({hits: [h(0.52, 'cut')], wordOnsetsSec: [], downbeatsSec: [0, 2]});
    expect(nobpm[0].at).toBe(0.52);
  });

  it('never exceeds 12', () => {
    const many = Array.from({length: 40}, (_, i) => h(i, 'cut'));
    expect(mergeHits({hits: many, wordOnsetsSec: []}).length).toBe(12);
  });

  it('SFX stays off by default and schedulePolishSfxHits is independent', () => {
    expect(sfxEnabled({})).toBe(false);
    const {hits} = schedulePolishSfxHits({graphics: [{start: 0, end: 2.4, placementMode: 'full_screen'}]});
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(x => !('priority' in x))).toBe(true);
  });
});

describe('collectVisualCuts', () => {
  it('maps kinds and spreads caption words to at most 24', () => {
    const words = Array.from({length: 100}, (_, i) => ({start: i * 0.1}));
    const cuts = collectVisualCuts({
      captionWords: words,
      kineticPlates: [{start: 1.5}],
      motionEntrances: [{start: 2}],
      recipePeaks: [{at: 3}],
      ambience: [{at: 4}],
    });
    expect(cuts.filter(c => c.kind === 'caption_pop')).toHaveLength(24);
    expect(cuts.find(c => c.kind === 'kinetic_plate')?.at_ms).toBe(1500);
    expect(cuts.find(c => c.kind === 'ambience')?.at_ms).toBe(4000);
    expect(collectVisualCuts({captionWords: [{start: 0.0004}]})).toEqual([{at_ms: 0, kind: 'caption_pop'}]);
  });
});
