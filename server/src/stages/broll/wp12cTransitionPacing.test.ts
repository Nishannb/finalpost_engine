/**
 * WP12C: procedural transitions (hard cut, flash, whip blur, B&W grade flip), the Director style vocabulary, the framed-window pacing beat and the pacing planner. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {mediaContainerSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {drawableTransitions, transitionIsDrawable} from '../../../../remotion/src/lib/timeline.ts';
import {PROCEDURAL_KEYWORDS, proceduralLayer, proceduralStyleOf, type ProceduralStyle} from '../../../../remotion/src/lib/proceduralTransition.ts';
import type {TransitionClip, WordToken} from '../../types/blueprint.ts';
import {EDIT_LOOKS} from '../directorV2/editLooks.ts';
import {POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import type {VisualDirection} from './geminiDirector.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {faceStretches, maxFramedWindows, maxPacingTransitions, MAX_FACE_STRETCH_SEC, planPacing} from './pacing.ts';
import {applyPolishDensityFill} from './polishDensityFill.ts';
import {FRAMED_WINDOW_HINT, isProceduralKeyword, mergeDirectedTransitions, PROCEDURAL_TRANSITION_KEYWORDS, TRANSITION_KEYWORDS} from './transitionPlan.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const STYLES = Object.keys(PROCEDURAL_KEYWORDS) as ProceduralStyle[];

describe('WP12C 1) procedural transitions', () => {
  it('the renderer keywords and the server vocabulary are the same five strings', () => {
    expect([...PROCEDURAL_TRANSITION_KEYWORDS].sort()).toEqual(Object.values(PROCEDURAL_KEYWORDS).sort());
    for (const keyword of PROCEDURAL_TRANSITION_KEYWORDS) expect(proceduralStyleOf(keyword), keyword).not.toBeNull();
    expect(proceduralStyleOf('Whip_Blur')).toBe('whip_blur'); // case / separator tolerant
    expect(proceduralStyleOf('light leak overlay')).toBeNull();
    expect(proceduralStyleOf(undefined)).toBeNull();
    for (const keyword of TRANSITION_KEYWORDS) expect(isProceduralKeyword(keyword)).toBe(false); // the default rotation stays stock-style
  });
  it('frame math: hard cut paints nothing; flashes peak mid-window and are clear at the ends; whip blur is strongest mid-cut and sweeps across; the B&W grade ramps in, holds and ramps out', () => {
    expect(proceduralLayer('hard_cut', 3, 10)).toEqual({kind: 'none'});
    for (const style of ['flash_white', 'flash_black'] as const) {
      const opacities = Array.from({length: 12}, (_, frame) => (proceduralLayer(style, frame, 12) as {opacity: number}).opacity);
      expect(opacities[0]).toBe(0);
      expect(opacities[11]).toBe(0);
      expect(Math.max(...opacities)).toBeGreaterThan(0.85);
      expect((proceduralLayer(style, 4, 12) as {color: string}).color).toBe(style === 'flash_white' ? '#FFFFFF' : '#000000');
    }
    const blur = Array.from({length: 12}, (_, frame) => (proceduralLayer('whip_blur', frame, 12) as {blurPx: number}).blurPx);
    expect(blur[0]).toBe(0);
    expect(Math.max(...blur)).toBeGreaterThan(20);
    expect(blur.indexOf(Math.max(...blur))).toBeGreaterThanOrEqual(4);
    expect(blur.indexOf(Math.max(...blur))).toBeLessThanOrEqual(6);
    const first = proceduralLayer('whip_blur', 0, 12) as {streakX: number};
    const last = proceduralLayer('whip_blur', 11, 12) as {streakX: number};
    expect(last.streakX).toBeGreaterThan(first.streakX);
    const gray = Array.from({length: 20}, (_, frame) => (proceduralLayer('grade_bw_hold', frame, 20) as {grayscale: number}).grayscale);
    expect(gray[0]).toBe(0);
    expect(gray[10]).toBe(1); // held
    expect(gray[19]).toBe(0); // restored
    expect(gray.slice(5, 15).every(value => value === 1)).toBe(true);
  });
  it('a procedural keyword is drawable with NO asset and NO renderGenerated flag; an engine keyword without either is not', () => {
    const base = {at: 5, duration: 0.4, assetUrl: ''};
    for (const style of STYLES) expect(transitionIsDrawable({...base, keyword: PROCEDURAL_KEYWORDS[style]}), style).toBe(true);
    expect(transitionIsDrawable({...base, keyword: 'film burn'})).toBe(false);
    expect(transitionIsDrawable({...base, keyword: 'film burn', renderGenerated: true})).toBe(true);
    const drawn = drawableTransitions([{...base, keyword: 'whip blur'}, {...base, at: 9, keyword: 'film burn'}, {...base, at: 12, keyword: 'flash white'}], 30, 900);
    expect(drawn.map(item => item.clip.keyword)).toEqual(['whip blur', 'flash white']);
  });
  it('TransitionTrack draws procedural styles from the keyword alone (no asset, no network) and keeps the stock / gradient paths', () => {
    const source = read('../../../../remotion/src/components/TransitionTrack.tsx');
    expect(source).toContain('proceduralStyleOf(clip.keyword)');
    expect(source).toContain('<ProceduralTake');
    expect(source).toContain("layer.kind === 'none') return null");
    for (const needle of ['backdropFilter', 'grayscale(', 'blur(']) expect(source).toContain(needle);
    expect(source).toContain('OffthreadVideo'); // stock path unchanged
    expect(source).toContain('linear-gradient(115deg'); // the legacy gradient fallback unchanged
    for (const word of ['fetch(', 'http://', 'https://']) expect(source).not.toContain(word);
  });
});

describe('WP12C 2) Director style vocabulary', () => {
  const merge = (style: string | undefined) =>
    mergeDirectedTransitions({engine: [], directed: [{start: 5, end: 5.4, ...(style ? {style} : {})}], outputDurationSec: 30});
  it.each([
    ['whip pan', 'whip blur'],
    ['swish', 'whip blur'],
    ['hard cut', 'hard cut'],
    ['jump cut', 'hard cut'],
    ['black and white', 'grade bw hold'],
    ['B&W flip', 'grade bw hold'],
    ['monochrome', 'grade bw hold'],
    ['white flash', 'flash white'],
    ['flash', 'flash white'],
    ['dip to black', 'flash black'],
    ['flash to black', 'flash black'],
  ])('"%s" -> %s (procedural: rendered with no asset, so renderGenerated is set)', (style, keyword) => {
    const clip = merge(style).transitions[0]!;
    expect(clip.keyword).toBe(keyword);
    expect(clip.assetUrl).toBe('');
    expect(clip.renderGenerated).toBe(true);
    expect(transitionIsDrawable(clip)).toBe(true);
  });
  it('existing stock hints still work and are not procedural; unrecognised styles fall back to the default keyword as before', () => {
    expect(merge('light leak').transitions[0]).toMatchObject({keyword: 'light leak overlay'});
    expect(merge('light leak').transitions[0]!.renderGenerated).toBeUndefined();
    expect(merge('paper wipe').transitions[0]).toMatchObject({keyword: 'paper wipe'});
    const unknown = merge('kaleidoscope');
    expect(TRANSITION_KEYWORDS).toContain(unknown.transitions[0]!.keyword);
    expect(unknown.directed[0]!.note).toMatch(/not_recognised/);
    expect(TRANSITION_KEYWORDS).toContain(merge(undefined).transitions[0]!.keyword);
  });
  it('"frame" / "window" asks for a framed talking-head beat: recorded as framedWindow, no transition clip', () => {
    for (const style of ['frame', 'framed window', 'picture in picture']) {
      const result = merge(style);
      expect(result.transitions, style).toEqual([]);
      expect(result.directed[0]!.framedWindow).toEqual({start: 5, end: 5.4});
    }
    expect(FRAMED_WINDOW_HINT.test('whip')).toBe(false);
  });
  it('a Director procedural transition supersedes an engine transition at the same cut (merge rules unchanged)', () => {
    const engine: TransitionClip = {at: 5.1, duration: 0.5, keyword: 'film burn', assetUrl: 'https://x/y.mp4', blend: 'screen', provider: 'pexels', providerId: 1, width: 1, height: 1, credit: '', creditUrl: ''};
    const result = mergeDirectedTransitions({engine: [engine], directed: [{start: 5, end: 5.4, style: 'whip'}], outputDurationSec: 30});
    expect(result.transitions.map(clip => clip.keyword)).toEqual(['whip blur']);
    expect(result.superseded.length).toBe(1);
  });
  it('the procedural keywords survive the stages that drop asset-less transitions (they carry renderGenerated)', () => {
    expect(read('../render/prefetchAssets.ts')).toContain('clip.renderGenerated === true');
    expect(read('../../pipeline/finalizeEdits.ts')).toContain('transition.renderGenerated');
  });
});

describe('WP12C 3) pacing planner', () => {
  it('faceStretches finds the gaps over the limit, edge to edge, ignoring the clip edges', () => {
    expect(faceStretches([{start: 8, end: 11}], 20)).toEqual([{start: 1, end: 8}, {start: 11, end: 19}]);
    expect(faceStretches([{start: 8, end: 13}], 20)).toEqual([{start: 1, end: 8}]);
    expect(faceStretches([{start: 3, end: 6}, {start: 9, end: 12}, {start: 15, end: 18}], 20)).toEqual([]);
    expect(faceStretches([], 40)).toEqual([{start: 1, end: 39}]);
    expect(MAX_FACE_STRETCH_SEC).toBe(6);
  });
  it('a long stretch gets a framed window first, then procedural transitions, within the caps and spacing; sentence starts only', () => {
    const sentenceStarts = Array.from({length: 18}, (_, index) => 2 + index * 3.5);
    const plan = planPacing({durationSec: 62, beats: [{start: 2, end: 5}], sentenceStarts, framedAllowed: true, transitionAllowed: true});
    expect(plan.framed.length).toBeGreaterThanOrEqual(1);
    expect(plan.framed.length).toBeLessThanOrEqual(maxFramedWindows(62));
    expect(plan.transitions.length).toBeLessThanOrEqual(maxPacingTransitions(62));
    for (const framed of plan.framed) {
      expect(framed.end - framed.start).toBeGreaterThanOrEqual(1.5);
      expect(framed.end - framed.start).toBeLessThanOrEqual(3);
      expect(sentenceStarts).toContain(framed.start);
    }
    for (const transition of plan.transitions) expect(sentenceStarts).toContain(transition.start);
    const all = [...plan.framed, ...plan.transitions].sort((a, b) => a.start - b.start);
    for (let i = 1; i < all.length; i += 1) expect(all[i]!.start - all[i - 1]!.start).toBeGreaterThanOrEqual(4);
    const longest = (spans: Array<{start: number; end: number}>) => Math.max(0, ...faceStretches(spans, 62).map(stretch => stretch.end - stretch.start));
    expect(longest([...plan.framed, ...plan.transitions, {start: 2, end: 5}])).toBeLessThan(longest([{start: 2, end: 5}]));
  });
  it('framed windows not allowed (look without media containers): transitions only; neither allowed: nothing; short clips: nothing', () => {
    const starts = Array.from({length: 12}, (_, index) => 2 + index * 3.5);
    const transitionsOnly = planPacing({durationSec: 45, beats: [], sentenceStarts: starts, framedAllowed: false, transitionAllowed: true});
    expect(transitionsOnly.framed).toEqual([]);
    expect(transitionsOnly.transitions.length).toBeGreaterThan(0);
    expect(planPacing({durationSec: 45, beats: [], sentenceStarts: starts, framedAllowed: false, transitionAllowed: false})).toEqual({framed: [], grades: [], transitions: []});
    expect(planPacing({durationSec: 8, beats: [], sentenceStarts: [2, 5], framedAllowed: true, transitionAllowed: true}).framed).toEqual([]);
  });
  it('pure: no env, logger, network or file access in pacing.ts', () => {
    expect(read('./pacing.ts')).not.toMatch(/process\.env|fetch\(|readFileSync|logger|anthropic/i);
  });
});

describe('WP12C 4) framed-window beat on the explain path', () => {
  const SENTENCES = Array.from({length: 15}, (_, index) => `Sentence number ${index + 1} talks about something different and interesting here.`);
  const WORDS: WordToken[] = SENTENCES.flatMap((sentence, index) => {
    const tokens = sentence.split(' ');
    const slot = 3.5 / tokens.length;
    return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
  });
  const DURATION = 60;
  const LEAN = new Set<string>(POLISH_LEAN_EDITS);
  const direction = (): VisualDirection => ({
    hookTitle: 'Ship faster', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [], caption: {} as never, suggestedLutIds: [], preferredLutId: '',
    zooms: [{timestamp: 6, durationSec: 2.5}], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [], estimatedCostUsd: 0, source: 'gemini',
  });
  const run = (lookId: string, over: Record<string, unknown> = {}) => {
    const look = EDIT_LOOKS.find(entry => entry.id === lookId)!;
    const enforced = applyEditLookToDirection(direction(), look, {matteUsable: false}).direction;
    return {enforced, result: applyPolishDensityFill({direction: enforced, look, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, cutawayResolvable: false, explainPlates: true, coveredBy: [], ...over})};
  };
  it('a look that allows media containers gets a framed window (blur_self rounded window, 1.5-3 s) without any stock B-roll, with polish_pace:framed_window:<n>; no text is added', () => {
    const {enforced, result} = run('explainer_cutaway');
    const framed = result.direction.mediaContainers.filter(item => item.canvasStyle === 'blur_self');
    expect(framed.length).toBeGreaterThanOrEqual(1);
    expect(framed.length).toBeLessThanOrEqual(maxFramedWindows(DURATION));
    for (const item of framed) {
      expect(item.mode).toBe('rounded_window');
      expect(item.end - item.start).toBeGreaterThanOrEqual(1.5);
      expect(item.end - item.start).toBeLessThanOrEqual(3);
    }
    expect(result.warnings).toContain(`polish_pace:framed_window:${framed.length}`);
    expect(result.direction.motionGraphics).toEqual(enforced.motionGraphics);
    expect(result.direction.semanticEmphasis).toEqual(enforced.semanticEmphasis);
    expect(result.direction.moments.filter(moment => moment.overlayText)).toEqual(enforced.moments.filter(moment => moment.overlayText));
  });
  it('a look without media containers still gets a pacing reset: a procedural transition and / or (WP13B) a grade flip; every transition is a procedural keyword through the Director-transition path', () => {
    const {result} = run('talking_head');
    expect(result.direction.mediaContainers.filter(item => item.canvasStyle === 'blur_self')).toEqual([]);
    const transitions = result.direction.transitions ?? [];
    const grades = result.direction.gradeBeats ?? [];
    expect(transitions.length + grades.length).toBeGreaterThanOrEqual(1);
    if (transitions.length > 0) expect(result.warnings).toContain(`polish_pace:transition:${transitions.length}`);
    if (grades.length > 0) expect(result.warnings).toContain(`polish_pace:grade_bw:${grades.length}`);
    const merged = mergeDirectedTransitions({engine: [], directed: transitions, outputDurationSec: DURATION});
    for (const clip of merged.transitions) expect(isProceduralKeyword(clip.keyword)).toBe(true);
  });
  it('capped (no spam), explain-only and switchable; short clips and the minimal look get none', () => {
    const {result} = run('explainer_cutaway');
    expect((result.direction.transitions ?? []).length).toBeLessThanOrEqual(maxPacingTransitions(DURATION));
    const off = run('explainer_cutaway', {pacing: false}).result;
    expect(off.direction.mediaContainers.filter(item => item.canvasStyle === 'blur_self')).toEqual([]);
    expect(off.warnings.some(warning => warning.startsWith('polish_pace:'))).toBe(false);
    const standard = run('explainer_cutaway', {explainPlates: false}).result;
    expect(standard.warnings.some(warning => warning.startsWith('polish_pace:'))).toBe(false);
    expect(run('minimal_captions').result.warnings.some(warning => warning.startsWith('polish_pace:'))).toBe(false);
  });
  it('framed windows reach the renderer: schema field with a solid default, and the track paints the blurred copy', () => {
    expect(mediaContainerSchema.parse({start: 1, end: 3}).canvasStyle).toBe('solid');
    expect(mediaContainerSchema.parse({start: 1, end: 3, canvasStyle: 'blur_self'}).canvasStyle).toBe('blur_self');
    const track = read('../../../../remotion/src/components/MediaContainerTrack.tsx');
    expect(track).toContain("container.canvasStyle === 'blur_self'");
    expect(track).toContain('blur(34px)');
  });
});
