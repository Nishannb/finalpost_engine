/**
 * WP12D: polish explain schedules local SFX hits (whoosh/hit/pop) aligned to plates and transitions.
 * Music beds are not implemented (need stock). Offline.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  SFX_MAX_HITS,
  SFX_MIN_SPACING_SEC,
  schedulePolishSfxHits,
} from '../../lib/polishSfx.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const analyzeSrc = readFileSync(path.resolve(here, '../../pipeline/analyzeVideo.ts'), 'utf8');
const sfxTrackSrc = readFileSync(path.resolve(here, '../../../../remotion/src/components/SfxTrack.tsx'), 'utf8');

describe('WP12D 1) schedulePolishSfxHits', () => {
  it('places a hit on full_screen OpenPlate-style graphic and a whoosh on whip transition', () => {
    const {hits, added} = schedulePolishSfxHits({
      graphics: [{start: 0, end: 2.4, placementMode: 'full_screen'}],
      transitions: [{at: 6.0, keyword: 'whip blur'}],
    });
    expect(added).toBeGreaterThanOrEqual(2);
    expect(hits.some(hit => hit.kind === 'hit' && hit.at === 0 && hit.reason?.includes('full_screen'))).toBe(true);
    expect(hits.some(hit => hit.kind === 'whoosh' && hit.at === 6)).toBe(true);
  });

  it('places a softer pop on split_screen and framed window', () => {
    const {hits} = schedulePolishSfxHits({
      graphics: [{start: 4, end: 7, placementMode: 'split_screen'}],
      framedWindows: [{start: 12}],
    });
    expect(hits.find(hit => hit.at === 4)?.kind).toBe('pop');
    expect(hits.find(hit => hit.at === 12)?.kind).toBe('pop');
  });

  it('ignores overlay-only graphics (no face-leave beat)', () => {
    const {hits, added} = schedulePolishSfxHits({
      graphics: [{start: 1, end: 3, placementMode: 'overlay'}],
    });
    expect(added).toBe(0);
    expect(hits).toEqual([]);
  });

  it('enforces spacing and max hits', () => {
    const {hits} = schedulePolishSfxHits({
      graphics: [
        {start: 0, end: 1, placementMode: 'full_screen'},
        {start: 0.3, end: 1.3, placementMode: 'full_screen'},
        {start: 1.0, end: 2, placementMode: 'split_screen'},
      ],
      transitions: Array.from({length: 12}, (_, index) => ({at: index * 0.5, keyword: 'whip blur'})),
      maxHits: SFX_MAX_HITS,
      minSpacingSec: SFX_MIN_SPACING_SEC,
    });
    expect(hits.length).toBeLessThanOrEqual(SFX_MAX_HITS);
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i]!.at - hits[i - 1]!.at).toBeGreaterThanOrEqual(SFX_MIN_SPACING_SEC - 1e-9);
    }
  });

  it('merges with existing hits without inventing musicMood', () => {
    const {hits} = schedulePolishSfxHits({
      existing: [{at: 0.5, kind: 'pop', reason: 'prior'}],
      graphics: [{start: 3, end: 5, placementMode: 'full_screen'}],
    });
    expect(hits.some(hit => hit.at === 0.5 && hit.kind === 'pop')).toBe(true);
    expect(hits.some(hit => hit.at === 3 && hit.kind === 'hit')).toBe(true);
    expect(JSON.stringify(hits)).not.toMatch(/musicMood/);
  });

  it('hard cut maps to hit; flash to whoosh', () => {
    const {hits} = schedulePolishSfxHits({
      transitions: [
        {at: 2, keyword: 'hard cut'},
        {at: 5, keyword: 'flash white'},
      ],
    });
    expect(hits.find(hit => hit.at === 2)?.kind).toBe('hit');
    expect(hits.find(hit => hit.at === 5)?.kind).toBe('whoosh');
  });
});

describe('WP12D 2) wiring pins', () => {
  it('analyzeVideo schedules polish SFX and warns polish_sfx:hits without setting musicMood', () => {
    expect(analyzeSrc).toContain('schedulePolishSfxHits');
    expect(analyzeSrc).toContain('polish_sfx:hits:');
    // Scheduling hits never sets a musicMood: the hits block only carries an existing one forward (the bed block sets it, for a bed that exists).
    expect(analyzeSrc).toContain('hits: scheduled.hits,');
    expect(analyzeSrc).toContain('...(audioDesign?.musicMood ? {musicMood: audioDesign.musicMood} : {}),');
  });

  it('SfxTrack only knows whoosh/hit/pop local wavs; ShortVideo consumes audioDesign.hits', () => {
    expect(sfxTrackSrc).toContain("whoosh: 'sfx/whoosh.wav'");
    expect(sfxTrackSrc).toContain("hit: 'sfx/hit.wav'");
    expect(sfxTrackSrc).toContain("pop: 'sfx/pop.wav'");
    const shortVideo = readFileSync(path.resolve(here, '../../../../remotion/src/ShortVideo.tsx'), 'utf8');
    expect(shortVideo).toContain('SfxTrack hits={blueprint.audioDesign?.hits}');
  });
});
