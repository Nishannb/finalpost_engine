/**
 * WP22: beat density to Metromedia pace. The WP21 fixture is the regression bar. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {CLOUD_POP_SEC, RUN_MAX_STATIC_SEC, runCutTimes} from './labeledAssetPlacement.ts';
import {maxGapBetweenVisualBeats, planMetromediaOpenProof, type OpenProofFixture} from './metromediaOpenProof.ts';
import {ensurePolishTransitionDensity, FORCED_CUT_TOLERANCE_SEC, minProceduralTransitions, POLISH_TRANSITION_MIN_GAP_SEC, POLISH_TRANSITION_SEC_PER} from './transitionDensity.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp21-metromedia-open.json')) as OpenProofFixture;
const proof = planMetromediaOpenProof(fixture);

describe('WP22 1) density knobs', () => {
  it('one transition per 2.5 s: a 19 s open wants 8, floors and caps hold', () => {
    expect(POLISH_TRANSITION_SEC_PER).toBe(2.5);
    expect(minProceduralTransitions(19)).toBe(8);
    expect(minProceduralTransitions(30)).toBe(12);
    expect(minProceduralTransitions(120)).toBe(18);
    expect(minProceduralTransitions(7)).toBe(0);
    expect(POLISH_TRANSITION_MIN_GAP_SEC).toBeGreaterThanOrEqual(0.7);
    expect(POLISH_TRANSITION_MIN_GAP_SEC).toBeLessThanOrEqual(0.9);
  });
  it('transitions keep the minimum gap from each other', () => {
    const times = proof.transitions.filter(t => t.anchor !== 'forced_cut').map(t => t.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(POLISH_TRANSITION_MIN_GAP_SEC - 0.001);
  });
  it('a forced cut is added within 0.35 s of the flash end even above the floor; one already there is not doubled', () => {
    const forced = ensurePolishTransitionDensity({durationSec: 19, existing: [], sentenceStarts: [], forcedCuts: [5], target: 0});
    expect(forced.added).toHaveLength(1);
    expect(Math.abs(forced.added[0]!.at - 5)).toBeLessThanOrEqual(FORCED_CUT_TOLERANCE_SEC);
    expect(forced.added[0]!.anchor).toBe('forced_cut');
    const already = ensurePolishTransitionDensity({durationSec: 19, existing: [{at: 5.1, keyword: 'hard cut'}], sentenceStarts: [], forcedCuts: [5], target: 0});
    expect(already.added).toHaveLength(0);
  });
  it('gap-fill: with no anchors at all the floor is still met, spaced', () => {
    const result = ensurePolishTransitionDensity({durationSec: 19, existing: [], sentenceStarts: []});
    expect(result.total).toBe(8);
    expect(result.added.every(t => t.anchor === 'gap_fill')).toBe(true);
  });
});

describe('WP22 2) image run internal cuts', () => {
  it('a long logo cloud pops every 1.5 s (WP26; was 2.2 s); a short one does not; a sequence run cuts at every item boundary', () => {
    const items = [{src: 'a'}, {src: 'b'}];
    expect(runCutTimes({start: 2, end: 5.4, mode: 'logo_cloud', items})).toEqual([3.5]);
    expect(runCutTimes({start: 0, end: 6, mode: 'logo_cloud', items})).toEqual([1.5, 3, 4.5]);
    expect(runCutTimes({start: 2, end: 2 + RUN_MAX_STATIC_SEC, mode: 'logo_cloud', items})).toEqual([]);
    expect(runCutTimes({start: 0, end: 9, mode: 'logo_cloud', items})[0]).toBe(CLOUD_POP_SEC);
    expect(CLOUD_POP_SEC).toBe(1.5);
    expect(runCutTimes({start: 2, end: 5, mode: 'sequence', items: [{src: 'a'}, {src: 'b'}, {src: 'c'}]})).toEqual([3, 4]);
  });
  it('the composition repeats the hero pop at the same period', () => {
    const comp = strip(read('../../../../remotion/src/motion/compositions/ImageRun.tsx'));
    expect(comp).toMatch(/IMAGE_RUN_CLOUD_POP_SEC = 1\.5/);
    expect(comp).toMatch(/<CloudPop>/);
  });
});

describe('WP22 3) the WP21 proof bar', () => {
  it('max gap between visual-change times is at most 2.5 s', () => {
    expect(proof.maxGapSec).toBeLessThanOrEqual(2.5);
  });
  it('a transition follows the flash card within 0.35 s and the logo cloud pops mid-run with a transition', () => {
    const flashEnd = proof.flash!.end;
    expect(proof.transitions.some(t => t.at >= flashEnd && t.at - flashEnd <= FORCED_CUT_TOLERANCE_SEC)).toBe(true);
    const cut = proof.runs[0]!.cutAts[0]!;
    expect(proof.transitions.some(t => Math.abs(t.at - cut) <= FORCED_CUT_TOLERANCE_SEC)).toBe(true);
  });
  it('8 transitions with at least 4 distinct kinds; the WP21 grammar is intact', () => {
    expect(proof.transitions.length).toBeGreaterThanOrEqual(7);
    expect(new Set(proof.transitions.map(t => t.keyword)).size).toBeGreaterThanOrEqual(4);
    expect(proof.flash!.registryComposition).toBe('FlashCard');
    expect(proof.runs[0]!.mode).toBe('logo_cloud');
    expect(proof.fillers.overlays.length).toBeGreaterThanOrEqual(1);
  });
  it('maxGapBetweenVisualBeats is order- and duplicate-insensitive', () => {
    expect(maxGapBetweenVisualBeats([5, 1, 1, 3])).toBe(2);
    expect(maxGapBetweenVisualBeats([4])).toBe(0);
  });
  it('analyze passes the forced cuts (flash ends + logo-cloud pops) to the density helper', () => {
    const analyze = strip(read('../../pipeline/analyzeVideo.ts'));
    expect(analyze).toMatch(/forcedCuts: \[\.\.\.flashCardEnds, \.\.\.imageRunCuts\]/);
  });
});
