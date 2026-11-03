/**
 * WP20: the filler clip lane (1-3 s cutaways of the creator's own videos). Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {engagementWindows, overlayCoverStarts, uncoveredEngagementWindows} from './engagementCadence.ts';
import {FILLER_MAX_SEC, FILLER_MIN_SEC, fillerCap, fillerCenterWord, fillerWarnings, planFillerClipLane, type FillerSource} from './fillerClipLane.ts';
import type {VisualDirection} from './geminiDirector.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const video = (n: number): FillerSource => ({url: `https://cdn.example.com/clip${n}.mp4`, mediaKind: 'video', userAssetId: `ub_${n}`, label: `clip ${n}`});
const still: FillerSource = {url: 'https://cdn.example.com/a.png', mediaKind: 'image', userAssetId: 'ub_9'};
const direction = (): VisualDirection => ({
  hookTitle: 'x', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [], caption: {} as never, suggestedLutIds: [], preferredLutId: '',
  zooms: [], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [], estimatedCostUsd: 0, source: 'gemini',
});
const words = [
  {text: 'Our', start: 9.2, end: 9.4}, {text: 'customers', start: 9.5, end: 10.1}, {text: 'love', start: 10.2, end: 10.4}, {text: 'it', start: 10.5, end: 10.6},
];
const base = {outputDurationSec: 40, coveredStarts: [] as number[], blockedRanges: [] as Array<{start: number; end: number}>};

describe('WP20 1) planner', () => {
  it('a bound broll_clip becomes a 1-3 s cutaway of the user video in an uncovered window', () => {
    const plan = planFillerClipLane({...base, sources: [video(1)]});
    expect(plan.overlays.length).toBeGreaterThanOrEqual(1);
    for (const overlay of plan.overlays) {
      expect(overlay.layout).toBe('cutaway');
      expect(overlay.mediaKind).toBe('video');
      expect(overlay.provider).toBe('user');
      expect(overlay.assetUrl).toBe('https://cdn.example.com/clip1.mp4');
      expect(overlay.userBrollId).toBe('ub_1');
      expect(overlay.end - overlay.start).toBeGreaterThanOrEqual(FILLER_MIN_SEC);
      expect(overlay.end - overlay.start).toBeLessThanOrEqual(FILLER_MAX_SEC);
      expect(overlay.overlayText).toBe('');
    }
    expect(plan.coverStarts).toEqual(plan.overlays.map(o => o.start));
    expect(fillerWarnings(plan)).toEqual([`polish_pace:fillers:${plan.overlays.length}`]);
  });
  it('places nothing without a video upload (stills and no sources are ignored)', () => {
    expect(planFillerClipLane({...base, sources: []}).overlays).toHaveLength(0);
    expect(planFillerClipLane({...base, sources: [still]}).overlays).toHaveLength(0);
    expect(fillerWarnings({overlays: []})).toEqual([]);
  });
  it('is capped at floor(duration / 10), one per window, none under 10 s', () => {
    expect(fillerCap(9)).toBe(0);
    expect(fillerCap(40)).toBe(4);
    const plan = planFillerClipLane({...base, outputDurationSec: 60, sources: [video(1), video(2)]});
    expect(plan.overlays.length).toBeLessThanOrEqual(6);
    expect(planFillerClipLane({...base, outputDurationSec: 9, sources: [video(1)]}).overlays).toHaveLength(0);
    const cap2 = planFillerClipLane({...base, outputDurationSec: 20, sources: [video(1)]});
    expect(cap2.overlays.length).toBeLessThanOrEqual(2);
  });
  it('skips windows a strong beat already covers and never overlaps full-screen beats', () => {
    const windows = engagementWindows(40);
    const covered = windows.slice(0, 3).map(w => w.start + 1);
    const plan = planFillerClipLane({...base, sources: [video(1)], coveredStarts: covered, blockedRanges: [{start: 32, end: 40}]});
    for (const overlay of plan.overlays) {
      expect(overlay.start).toBeGreaterThanOrEqual(24);
      expect(overlay.end).toBeLessThanOrEqual(32);
    }
  });
  it('shifts inside a window to dodge a block; falls back to a PiP (still_push_in) when a cutaway cannot sit', () => {
    const shifted = planFillerClipLane({...base, outputDurationSec: 16, sources: [video(1)], coveredStarts: [9], blockedRanges: [{start: 1, end: 2.5}]});
    expect(shifted.overlays[0]!.start).toBeGreaterThanOrEqual(2.5);
    const pip = planFillerClipLane({...base, outputDurationSec: 16, sources: [video(1)], coveredStarts: [9], overlayRanges: [{start: 0, end: 8}], pipBlockedRanges: []});
    expect(pip.overlays[0]!.layout).toBe('pip');
    expect(pip.overlays[0]!.recipeId).toBe('still_push_in');
  });
  it('rotates through the sources (labeled clips first, in the order given)', () => {
    const plan = planFillerClipLane({...base, outputDurationSec: 40, sources: [video(1), video(2)]});
    expect(plan.overlays.map(o => o.userBrollId).slice(0, 2)).toEqual(['ub_1', 'ub_2']);
  });
  it('centre word: one verbatim content word of the window, as a centred kinetic graphic; none when nothing fits or when switched off', () => {
    expect(fillerCenterWord(words, {start: 9, end: 11})).toBe('customers');
    expect(fillerCenterWord(words, {start: 0, end: 5})).toBe('');
    const plan = planFillerClipLane({...base, outputDurationSec: 16, sources: [video(1)], coveredStarts: [1], words});
    expect(plan.overlays).toHaveLength(1);
    expect(plan.motionGraphics).toHaveLength(1);
    expect(plan.motionGraphics[0]!.text).toBe('customers');
    expect(plan.motionGraphics[0]!.anchor).toBe('center');
    expect(plan.overlays[0]!.overlayText).toBe('');
    expect(planFillerClipLane({...base, outputDurationSec: 16, sources: [video(1)], coveredStarts: [1], words, centerWord: false}).motionGraphics).toHaveLength(0);
  });
});

describe('WP20 2) engagement coverage', () => {
  it('fillers cover windows the direction leaves bare', () => {
    const before = uncoveredEngagementWindows(direction(), 40);
    const plan = planFillerClipLane({...base, sources: [video(1)]});
    const after = uncoveredEngagementWindows(direction(), 40, overlayCoverStarts(plan.overlays));
    expect(before.length).toBe(5);
    expect(after.length).toBeLessThan(before.length);
  });
  it('overlayCoverStarts counts cutaways / pips / cards, not chips or banners', () => {
    expect(overlayCoverStarts([{start: 1, layout: 'cutaway'}, {start: 2, layout: 'pip'}, {start: 3, layout: 'chip'}, {start: 4, layout: 'banner'}, {start: 5, layout: 'card'}])).toEqual([1, 2, 5]);
  });
});

describe('WP20 3) analyze wiring', () => {
  const analyze = strip(read('../../pipeline/analyzeVideo.ts'));
  it('the lane runs after the labeled-asset / ImageRun block, before prefer-media and the WP16 density block, from user videos only', () => {
    const hook = analyze.indexOf('planFillerClipLane(');
    expect(hook).toBeGreaterThan(analyze.indexOf('publishImageRuns('));
    expect(hook).toBeLessThan(analyze.indexOf('textOnlyOpensWithMediaAvailable('));
    expect(hook).toBeLessThan(analyze.indexOf('ensurePolishTransitionDensity('));
    expect(analyze).toMatch(/boundVideoIds\.has\(item\.userAssetId\)/);
    expect(analyze).toMatch(/fillerWarnings\(filler\)/);
  });
  it('no web or stock source: the lane module imports no client', () => {
    const lane = strip(read('./fillerClipLane.ts'));
    expect(lane).not.toMatch(/pexels|pixabay|klipy|fetch\(|axios|http\.get/i);
  });
});
