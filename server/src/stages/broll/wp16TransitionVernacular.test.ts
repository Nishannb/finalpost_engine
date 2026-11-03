/**
 * WP16: transition vernacular density: a bigger procedural catalog, a density floor for polish, labeled-asset-aware placement, and SFX for the new styles. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {DIP_COLOR, PROCEDURAL_KEYWORDS, proceduralLayer, proceduralStyleOf, type ProceduralStyle} from '../../../../remotion/src/lib/proceduralTransition.ts';
import {drawableTransitions, transitionIsDrawable} from '../../../../remotion/src/lib/timeline.ts';
import {schedulePolishSfxHits} from '../../lib/polishSfx.ts';
import {
  densityTransitionClip,
  ensurePolishTransitionDensity,
  minProceduralTransitions,
  POLISH_TRANSITION_MIN_GAP_SEC,
  sentenceStartsOf,
} from './transitionDensity.ts';
import {maxPacingTransitions, PACING_TRANSITION_STYLES} from './pacing.ts';
import {CUT_TRANSITION_ROTATION, isProceduralKeyword, mergeDirectedTransitions, POLISH_TRANSITION_ROTATION, PROCEDURAL_TRANSITION_KEYWORDS, TRANSITION_KEYWORDS} from './transitionPlan.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const STYLES = Object.keys(PROCEDURAL_KEYWORDS) as ProceduralStyle[];
const NEW_STYLES = ['whip_blur_left', 'whip_blur_right', 'smash_zoom', 'dip_color', 'blur_dissolve'] as const;

describe('WP16 1) catalog parity and frame math', () => {
  it('the renderer keywords equal the server list (sorted), 10 styles, and the new ones are drawable with no asset and no flag', () => {
    expect(Object.values(PROCEDURAL_KEYWORDS).sort()).toEqual([...PROCEDURAL_TRANSITION_KEYWORDS].sort());
    expect(STYLES.length).toBe(10);
    for (const style of NEW_STYLES) {
      expect(proceduralStyleOf(PROCEDURAL_KEYWORDS[style]), style).toBe(style);
      expect(transitionIsDrawable({at: 5, duration: 0.4, assetUrl: '', keyword: PROCEDURAL_KEYWORDS[style]}), style).toBe(true);
    }
    expect(drawableTransitions([{at: 2, duration: 0.4, assetUrl: '', keyword: 'smash zoom'}, {at: 6, duration: 0.4, assetUrl: '', keyword: 'dip color'}], 30, 900).length).toBe(2);
    for (const keyword of PROCEDURAL_TRANSITION_KEYWORDS) expect(TRANSITION_KEYWORDS as readonly string[]).not.toContain(keyword);
  });
  it('hard_cut still paints nothing', () => {
    expect(proceduralLayer('hard_cut', 3, 12)).toEqual({kind: 'none'});
  });
  it.each(NEW_STYLES.map(style => [style] as const))('%s: clear at both ends, strongest mid-window, deterministic', style => {
    const frames = 14;
    const layers = Array.from({length: frames}, (_, frame) => proceduralLayer(style, frame, frames));
    const strength = (layer: ReturnType<typeof proceduralLayer>): number => {
      switch (layer.kind) {
        case 'flash':
          return layer.opacity;
        case 'whip':
          return layer.blurPx;
        case 'smash':
          return layer.blurPx + layer.edgeOpacity * 20;
        case 'dissolve':
          return layer.blurPx + layer.veilOpacity * 20;
        default:
          return 0;
      }
    };
    expect(strength(layers[0]!)).toBe(0);
    expect(strength(layers[frames - 1]!)).toBe(0);
    const peak = Math.max(...layers.map(strength));
    expect(peak).toBeGreaterThan(0.5);
    expect(layers.findIndex(layer => strength(layer) === peak)).toBeGreaterThanOrEqual(3);
    expect(layers.findIndex(layer => strength(layer) === peak)).toBeLessThanOrEqual(8);
    expect(proceduralLayer(style, 5, frames)).toEqual(layers[5]);
  });
  it('whip left and right sweep in opposite directions; whip_blur keeps its original left-to-right sweep', () => {
    const at = (style: ProceduralStyle, frame: number) => proceduralLayer(style, frame, 14) as {kind: 'whip'; streakX: number; direction: number};
    expect(at('whip_blur_right', 1).direction).toBe(1);
    expect(at('whip_blur_left', 1).direction).toBe(-1);
    expect(at('whip_blur_right', 12).streakX).toBeGreaterThan(at('whip_blur_right', 1).streakX);
    expect(at('whip_blur_left', 12).streakX).toBeLessThan(at('whip_blur_left', 1).streakX);
    expect(at('whip_blur', 12).streakX).toBe(at('whip_blur_right', 12).streakX);
    expect(at('whip_blur_left', 5).streakX).toBe(-at('whip_blur_right', 5).streakX);
  });
  it('smash_zoom swells a ring and an edge blowout; dip_color is a warm orange flash (not blue-green); blur_dissolve is a blur with a light veil', () => {
    const smash = proceduralLayer('smash_zoom', 7, 14) as {kind: 'smash'; ringScale: number; edgeOpacity: number; blurPx: number};
    expect(smash.kind).toBe('smash');
    expect(smash.ringScale).toBeGreaterThan(1.3);
    expect(smash.edgeOpacity).toBeGreaterThan(0.7);
    const dip = proceduralLayer('dip_color', 5, 14) as {kind: 'flash'; color: string; opacity: number};
    expect(dip.color).toBe(DIP_COLOR);
    expect(dip.color.toUpperCase()).not.toMatch(/^#00E5FF|^#22D3EE/);
    expect(dip.opacity).toBeGreaterThan(0.7);
    const dissolve = proceduralLayer('blur_dissolve', 7, 14) as {kind: 'dissolve'; blurPx: number; veilOpacity: number};
    expect(dissolve.blurPx).toBeGreaterThan(12);
    expect(dissolve.veilOpacity).toBeGreaterThan(0.1);
    expect(dissolve.veilOpacity).toBeLessThan(0.3); // a veil, not a card
  });
  it('TransitionTrack paints every new branch from the keyword alone (no network, no asset)', () => {
    const source = read('../../../../remotion/src/components/TransitionTrack.tsx');
    for (const needle of ["layer.kind === 'smash'", "layer.kind === 'dissolve'", 'layer.direction === 1 ? 90 : 270', 'radial-gradient(ellipse', 'backdropFilter', 'proceduralStyleOf(clip.keyword)']) expect(source, needle).toContain(needle);
    for (const word of ['fetch(', 'http://', 'https://']) expect(source).not.toContain(word);
  });
});

describe('WP16 2) Director hints', () => {
  const keywordOf = (style: string) => mergeDirectedTransitions({engine: [], directed: [{start: 5, end: 5.4, style}], outputDurationSec: 30}).transitions[0]?.keyword;
  it.each([
    ['smash zoom', 'smash zoom'],
    ['zoom cut', 'smash zoom'],
    ['punch in', 'smash zoom'],
    ['whip left', 'whip blur left'],
    ['swish to the left', 'whip blur left'],
    ['whip right', 'whip blur right'],
    ['pan right', 'whip blur right'],
    ['dip to color', 'dip color'],
    ['color flash', 'dip color'],
    ['orange flash', 'dip color'],
    ['blur dissolve', 'blur dissolve'],
    ['lens blur', 'blur dissolve'],
    ['soft dissolve', 'blur dissolve'],
  ])('"%s" -> %s', (style, keyword) => {
    expect(keywordOf(style)).toBe(keyword);
  });
  it('the existing hints are unchanged: whip, flash, dip to black, hard cut, black and white, stock leaks', () => {
    expect(keywordOf('whip')).toBe('whip blur');
    expect(keywordOf('white flash')).toBe('flash white');
    expect(keywordOf('dip to black')).toBe('flash black');
    expect(keywordOf('hard cut')).toBe('hard cut');
    expect(keywordOf('smash cut')).toBe('hard cut');
    expect(keywordOf('black and white')).toBe('grade bw hold');
    expect(keywordOf('light leak')).toBe('light leak overlay');
  });
  it('new procedural clips carry renderGenerated so asset-less stages keep them', () => {
    for (const style of ['smash zoom', 'dip to color', 'blur dissolve', 'whip left']) {
      const clip = mergeDirectedTransitions({engine: [], directed: [{start: 5, end: 5.4, style}], outputDurationSec: 30}).transitions[0]!;
      expect(clip.renderGenerated, style).toBe(true);
      expect(isProceduralKeyword(clip.keyword)).toBe(true);
    }
  });
});

describe('WP16 3) density contract', () => {
  const starts = Array.from({length: 24}, (_, index) => 1.5 + index * 1.2);
  const gapsOf = (times: number[]) => [...times].sort((a, b) => a - b).slice(1).map((time, index) => time - [...times].sort((a, b) => a - b)[index]!);
  it('floor numbers: about one per 2.5 s (WP22; was 3.5 s), at least 2, at most 18, none under 8 s', () => {
    expect(minProceduralTransitions(30)).toBe(12);
    expect(minProceduralTransitions(30)).toBeGreaterThanOrEqual(10);
    expect(minProceduralTransitions(30)).toBeLessThanOrEqual(13);
    expect(minProceduralTransitions(10)).toBe(4);
    expect(minProceduralTransitions(60)).toBe(18);
    expect(minProceduralTransitions(200)).toBe(18);
    expect(minProceduralTransitions(7)).toBe(0);
    expect(minProceduralTransitions(Number.NaN)).toBe(0);
    expect(maxPacingTransitions(40)).toBe(6);
    expect(maxPacingTransitions(100)).toBe(8);
  });
  it('a 30 s clip with 2 transitions is filled to the floor: spaced >= 0.9 s, inside the edges, rotated (no neighbour repeats a kind), all procedural', () => {
    const existing = [{at: 8, keyword: 'whip blur'}, {at: 21, keyword: 'hard cut'}];
    const result = ensurePolishTransitionDensity({durationSec: 30, existing, sentenceStarts: starts});
    expect(result.target).toBe(12);
    expect(result.total).toBe(12);
    expect(result.added.length).toBe(10);
    const all = [...existing.map(item => ({at: item.at, keyword: item.keyword})), ...result.added].sort((a, b) => a.at - b.at);
    for (const gap of gapsOf(all.map(item => item.at))) expect(gap).toBeGreaterThanOrEqual(POLISH_TRANSITION_MIN_GAP_SEC - 1e-9);
    for (const item of result.added) {
      expect(item.at).toBeGreaterThanOrEqual(1);
      expect(item.at).toBeLessThanOrEqual(29);
      expect(isProceduralKeyword(item.keyword)).toBe(true);
    }
    for (let i = 1; i < all.length; i += 1) expect(all[i]!.keyword, `${all[i - 1]!.at}->${all[i]!.at}`).not.toBe(all[i - 1]!.keyword);
    expect(new Set(result.added.map(item => item.keyword)).size).toBeGreaterThanOrEqual(4); // rotated, not one kind
  });
  it('nothing is added when the floor is already met, for short clips, or with no usable anchor; the existing list is never changed', () => {
    const rich = Array.from({length: 12}, (_, index) => ({at: 2 + index * 2.4, keyword: 'whip blur'}));
    expect(ensurePolishTransitionDensity({durationSec: 30, existing: rich, sentenceStarts: starts}).added).toEqual([]);
    expect(ensurePolishTransitionDensity({durationSec: 6, existing: [], sentenceStarts: [1, 3]}).added).toEqual([]);
    // WP22: with no anchor at all the floor is met by gap-fill transitions instead of nothing
    expect(ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: []}).added.every(item => item.anchor === 'gap_fill')).toBe(true);
    expect(rich.length).toBe(12);
  });
  it('never stacks within the minimum gap, even when the only anchors are crowded', () => {
    const crowded = [4, 4.3, 4.6, 12, 12.2, 20, 20.5, 27];
    const result = ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: crowded});
    const times = result.added.map(item => item.at);
    for (const gap of gapsOf(times)) expect(gap).toBeGreaterThanOrEqual(POLISH_TRANSITION_MIN_GAP_SEC);
    // WP22: gap-fill transitions top up the floor between the crowded anchors, still never inside the minimum gap
  });
  it('labeled-asset slots: a transition lands ON a slot boundary (its start / end) before any sentence start, and a time strictly inside a slot is only a last resort', () => {
    const slots = [{start: 10, end: 16}, {start: 21.3, end: 26}];
    const result = ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: starts, assetSlotWindows: slots, target: 4});
    const onBoundary = result.added.filter(item => item.anchor === 'asset_boundary');
    expect(onBoundary.length).toBeGreaterThanOrEqual(2);
    for (const item of onBoundary) expect([10, 16, 21.3, 26]).toContain(item.at);
    const inside = result.added.filter(item => slots.some(slot => item.at > slot.start + 0.35 && item.at < slot.end - 0.35));
    expect(inside).toEqual([]);
    expect(result.added[0]!.anchor === 'asset_boundary' || result.added.some(item => item.anchor === 'asset_boundary')).toBe(true);
  });
  it('mid-slot anchors are used only when nothing else fits', () => {
    const slots = [{start: 2, end: 28}];
    const result = ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: starts, assetSlotWindows: slots, target: 6});
    expect(result.added.filter(item => item.anchor === 'mid_slot').length).toBeGreaterThan(0);
    expect(result.added.filter(item => item.anchor === 'asset_boundary').length).toBeGreaterThanOrEqual(1);
  });
  it('existing media cuts are preferred over plain sentence starts; avoid windows (zoom punch-ins) are respected', () => {
    const cuts = [7.1, 14.2, 22.3];
    const result = ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: starts, cutTimes: cuts, avoidWindows: [{start: 14, end: 15}], target: 4});
    expect(result.added.filter(item => item.anchor === 'cut').length).toBeGreaterThanOrEqual(2);
    expect(result.added.some(item => item.at >= 14 && item.at < 15)).toBe(false);
  });
  it('deterministic, and the clips are valid TransitionClips (procedural, renderGenerated, duration inside the engine bounds)', () => {
    const a = ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: starts});
    expect(ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: starts})).toEqual(a);
    for (const [index, item] of a.added.entries()) {
      const clip = densityTransitionClip(item, index);
      expect(clip).toMatchObject({assetUrl: '', renderGenerated: true, provider: 'generated'});
      expect(clip.duration).toBeGreaterThanOrEqual(0.2);
      expect(clip.duration).toBeLessThanOrEqual(0.8);
      expect(transitionIsDrawable(clip)).toBe(true);
    }
  });
  it('sentenceStartsOf finds the first word and every word after a sentence end or a 0.8 s pause', () => {
    const words = [
      {text: 'One', start: 0, end: 0.3},
      {text: 'two.', start: 0.3, end: 0.6},
      {text: 'Three', start: 0.7, end: 1},
      {text: 'four', start: 2, end: 2.3},
    ];
    expect(sentenceStartsOf(words)).toEqual([0, 0.7, 2]);
  });
  it('the rotations: cut and polish rotations are the same expanded procedural list; pacing uses the new kinds too', () => {
    expect([...POLISH_TRANSITION_ROTATION]).toEqual([...CUT_TRANSITION_ROTATION]);
    for (const keyword of POLISH_TRANSITION_ROTATION) expect(isProceduralKeyword(keyword), keyword).toBe(true);
    expect(new Set(POLISH_TRANSITION_ROTATION).size).toBeGreaterThanOrEqual(7);
    for (const keyword of ['smash zoom', 'whip blur left', 'dip color', 'blur dissolve']) expect(PACING_TRANSITION_STYLES as readonly string[]).toContain(keyword);
  });
  it('wiring pins: analyzeVideo fills the floor on polish with the slot windows, the media cuts and the zoom windows, and warns polish_pace:transitions:<n>; the labeled-asset brief is untouched', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    for (const needle of ['ensurePolishTransitionDensity({', 'assetSlotWindows: (assetBrief?.slots ?? []).map(slot => ({start: slot.startSec, end: slot.endSec}))', 'avoidWindows: zoomTriggers.map', '`polish_pace:transitions:${density.added.length}`']) expect(analyze, needle).toContain(needle);
    const brief = read('./labeledAssetBrief.ts');
    expect(brief).toContain('export function buildLabeledAssetBrief');
    expect(brief).not.toContain('transition');
    expect(read('./transitionDensity.ts')).not.toMatch(/process\.env|fetch\(|readFileSync|logger|anthropic|assetUrl: 'http/i);
  });
});

describe('WP16 4) SFX for the new styles', () => {
  const sfx = (keyword: string) => schedulePolishSfxHits({transitions: [{at: 5, keyword}]}).hits;
  it.each([
    ['whip blur left', 'whoosh'],
    ['whip blur right', 'whoosh'],
    ['whip blur', 'whoosh'],
    ['dip color', 'whoosh'],
    ['blur dissolve', 'whoosh'],
    ['flash white', 'whoosh'],
    ['smash zoom', 'hit'],
    ['hard cut', 'hit'],
  ])('%s -> %s', (keyword, kind) => {
    const hits = sfx(keyword);
    expect(hits.length, keyword).toBe(1);
    expect(hits[0]!.kind).toBe(kind);
    expect(hits[0]!.at).toBe(5);
  });
  it('a dense transition list is still capped and spaced (no machine-gun), deterministic, and sets no musicMood', () => {
    const transitions = Array.from({length: 14}, (_, index) => ({at: 1 + index * 0.9, keyword: POLISH_TRANSITION_ROTATION[index % POLISH_TRANSITION_ROTATION.length]!}));
    const { hits } = schedulePolishSfxHits({transitions});
    expect(hits.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < hits.length; i += 1) expect(hits[i]!.at - hits[i - 1]!.at).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(schedulePolishSfxHits({transitions}).hits).toEqual(hits);
    expect(read('../../lib/polishSfx.ts')).not.toContain('musicMood:');
  });
  it('stock keywords still get no SFX', () => {
    expect(sfx('light leak overlay')).toEqual([]);
  });
});
