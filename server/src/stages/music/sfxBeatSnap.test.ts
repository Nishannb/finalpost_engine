import {describe, expect, it} from 'vitest';

import type {SfxEntry} from '../../lib/sfxCatalog.ts';
import {applyCatalogToHits} from '../../lib/sfxCatalog.ts';
import type {PolishSfxHit} from '../../lib/polishSfx.ts';
import {SFX_SNAP_WINDOW_SEC, snapHitsToBeats} from './sfxBeatSnap.ts';

const beatsSec = Array.from({length: 80}, (_, i) => i * 0.5);
const barLinesSec = Array.from({length: 20}, (_, i) => i * 2);
const hit = (at: number, reason = 'transition_whip pan'): PolishSfxHit => ({at, kind: 'whoosh', volume: 0.12, reason});
const base = {beatsSec, barLinesSec, wordOnsetsSec: [] as number[], durationSec: 40};
const entry = (fileName: string, cues: SfxEntry['tobeused']): SfxEntry => ({fileName, duration: 0.3, tobeused: cues, gainDb: 0});

describe('snapping', () => {
  it('moves a hit to the nearest beat within 60 ms and leaves one that is farther', () => {
    const out = snapHitsToBeats([hit(3.04), hit(8.07), hit(12.5)], base);
    expect(out.hits.map(item => item.at)).toEqual([3, 8.07, 12.5]);
    expect(out.stats).toMatchObject({input: 3, snapped: 1, dropped: 0});
    expect(out.hits[0]!.reason).toBe('transition_whip pan|beat');
    expect(SFX_SNAP_WINDOW_SEC).toBe(0.06);
  });

  it('without beats (no placement) nothing is snapped and the hits are unchanged', () => {
    const hits = [hit(3.04), hit(8.5)];
    const out = snapHitsToBeats(hits, {...base, beatsSec: []});
    expect(out.hits).toEqual(hits);
    expect(out.stats).toMatchObject({snapped: 0, dropped: 0, hookAdded: false, ctaAdded: false});
  });
});

describe('the word mask always wins over snapping', () => {
  it('keeps the unsnapped time when the snapped time would cover a word', () => {
    // beat at 3.0, a word starts at 2.95: the beat is 50 ms after the onset (masked), the hit at 3.04 is 90 ms after it (also masked) -> use a hit the mask allows
    const out = snapHitsToBeats([hit(3.05)], {...base, wordOnsetsSec: [2.9]}); // beat 3.0 is 100 ms after 2.9: masked; 3.05 is 150 ms after: fine
    expect(out.hits.map(item => item.at)).toEqual([3.05]);
    expect(out.stats.snapped).toBe(0);
  });
  it('drops a hit when neither the snapped nor the unsnapped time is allowed', () => {
    const out = snapHitsToBeats([hit(3.04)], {...base, wordOnsetsSec: [2.95]}); // 3.0 is 50 ms after, 3.04 is 90 ms after
    expect(out.hits).toEqual([]);
    expect(out.stats.dropped).toBe(1);
  });
  it('snaps normally when the snapped time is clear of every word', () => {
    expect(snapHitsToBeats([hit(3.04)], {...base, wordOnsetsSec: [1, 2.5]}).hits[0]!.at).toBe(3);
  });
  it('a hit before an onset is fine: the mask is only the 120 ms after it', () => {
    expect(snapHitsToBeats([hit(3.0)], {...base, wordOnsetsSec: [3.05]}).hits).toHaveLength(1);
  });
});

describe('spacing and cap hold after snapping', () => {
  it('reverts a snap that would break the 0.8 s spacing, and drops one that cannot be placed', () => {
    // 2.97 would snap to the beat at 3.0, but that leaves 0.78 s to the next hit at 3.78 (they were 0.81 s apart): the snap is skipped, neither hit is lost
    const out = snapHitsToBeats([hit(2.97), hit(3.78)], base);
    expect(out.hits.map(item => item.at)).toEqual([2.97, 3.78]);
    expect(out.stats).toMatchObject({snapped: 0, dropped: 0});
    // two hits 0.8 s apart whose snaps would end up 0.7 s apart: the second keeps its own time
    const close = snapHitsToBeats([hit(3.04), hit(3.84)], {...base, beatsSec: [3.0, 3.8, 3.7]});
    expect(close.hits.map(item => item.at).every((at, i, all) => i === 0 || at - all[i - 1]! >= 0.8 - 1e-9)).toBe(true);
  });
  it('never returns more than the cap', () => {
    const many = Array.from({length: 20}, (_, i) => hit(1 + i * 0.9));
    expect(snapHitsToBeats(many, {...base, durationSec: 60, beatsSec: []}).hits.length).toBeLessThanOrEqual(8);
  });
});

describe('catalog hook and cta', () => {
  const catalog = [entry('hook.wav', ['hook']), entry('cta.wav', ['cta']), entry('cut.wav', ['cut'])];
  it('with a hook entry a hit plays on frame 0; with a cta entry, on the nearest bar line to the CTA time', () => {
    const out = snapHitsToBeats([hit(8)], {...base, catalog, ctaAtSec: 33.4});
    expect(out.stats).toMatchObject({hookAdded: true, ctaAdded: true});
    expect(out.hits.map(item => [item.at, item.reason])).toEqual([[0, 'sfx_hook'], [8, 'transition_whip pan'], [34, 'sfx_cta']]);
    const applied = applyCatalogToHits(out.hits, {entries: catalog, videoId: 'v', voLufs: -20});
    expect(applied.hits[0]).toMatchObject({src: 'staticFile:sfx-library/hook.wav'});
    expect(applied.hits[2]).toMatchObject({src: 'staticFile:sfx-library/cta.wav'});
  });
  it('an empty catalog, or one with neither cue, adds nothing: the hits are unchanged', () => {
    const hits = [hit(8), hit(20)];
    expect(snapHitsToBeats(hits, {...base, catalog: [], ctaAtSec: 30}).hits).toEqual(hits);
    expect(snapHitsToBeats(hits, {...base, catalog: [entry('c.wav', ['cut'])], ctaAtSec: 30}).stats).toMatchObject({hookAdded: false, ctaAdded: false});
  });
  it('no cta without a known CTA time', () => {
    expect(snapHitsToBeats([], {...base, catalog, ctaAtSec: null}).stats).toMatchObject({hookAdded: true, ctaAdded: false});
  });
  it('the cta goes through the mask: a word starting just before the bar line blocks it', () => {
    const out = snapHitsToBeats([], {...base, catalog: [entry('cta.wav', ['cta'])], ctaAtSec: 30.2, wordOnsetsSec: [29.95]}); // bar line 30 is 50 ms after an onset
    expect(out.stats.ctaAdded).toBe(false);
    expect(out.hits).toEqual([]);
  });
  it('hook and cta take slots first: they stay when the cap is reached, and the later hits give way', () => {
    const many = Array.from({length: 12}, (_, i) => hit(2 + i * 1));
    const out = snapHitsToBeats(many, {...base, catalog, ctaAtSec: 20});
    expect(out.hits.length).toBeLessThanOrEqual(8);
    expect(out.hits.some(item => item.reason === 'sfx_hook')).toBe(true);
    expect(out.hits.some(item => item.reason === 'sfx_cta')).toBe(true);
  });
  it('the hook still respects spacing: a hit within 0.8 s of frame 0 gives way to it', () => {
    const out = snapHitsToBeats([hit(0.5)], {...base, catalog: [entry('h.wav', ['hook'])]});
    expect(out.hits.map(item => item.at)).toEqual([0]);
    expect(out.stats.dropped).toBe(1);
  });
});
