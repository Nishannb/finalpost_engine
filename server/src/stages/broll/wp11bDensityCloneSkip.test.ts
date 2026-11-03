/**
 * WP11B: density-fill / engagement text chips never clone the captions on the explain path, and the caption mute covers every remaining text-carrying overlay. Offline: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionMuteRanges} from '../../lib/captionMute.ts';
import type {WordToken} from '../../types/blueprint.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {meetsEngagementBar, uncoveredEngagementWindows} from './engagementCadence.ts';
import type {VisualDirection} from './geminiDirector.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {applyPolishDensityFill} from './polishDensityFill.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SENTENCES = [
  'Most teams choose between speed and quality every single week.',
  'Here is the thing nobody tells you about shipping software quickly.',
  'Small habits compound into something very large over time.',
  'Pick one metric and protect it from everything else around you.',
  'Never confuse being busy with making real progress forward.',
  'Clarity beats effort when the goal is unclear to everyone.',
  'Write the plan down and share it with your whole team.',
  'Then keep the standard high and ship it anyway today.',
  'Start building something real with these tools right now.',
];
const WORDS: WordToken[] = SENTENCES.flatMap((sentence, index) => {
  const tokens = sentence.split(' ');
  const slot = 3.5 / tokens.length;
  return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
});
const DURATION = 36;
const LEAN = new Set<string>(POLISH_LEAN_EDITS);
const direction = (over: Partial<VisualDirection> = {}): VisualDirection => ({
  hookTitle: 'Ship faster', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [],
  caption: {} as never, suggestedLutIds: [], preferredLutId: '',
  zooms: [{timestamp: 6, durationSec: 2.5}, {timestamp: 15, durationSec: 2.5}, {timestamp: 27, durationSec: 2.5}], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [],
  estimatedCostUsd: 0, source: 'gemini', ...over,
});
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const enforced = applyEditLookToDirection(direction(), remapped, {matteUsable: false}).direction;
const fill = (over: Partial<Parameters<typeof applyPolishDensityFill>[0]> = {}) => applyPolishDensityFill({direction: enforced, look: remapped, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, cutawayResolvable: false, ...over});
const spokenText = (text: string) => text.length > 0 && SENTENCES.join(' ').toLowerCase().includes(text.toLowerCase());
const textsOf = (d: VisualDirection) => [...d.motionGraphics.map(item => item.text), ...d.semanticEmphasis.map(item => item.text), ...d.moments.map(item => item.overlayText)].filter(Boolean);
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};

describe('WP11B 1) the explain-path fill places no caption-clone text', () => {
  it('legacy behaviour (opt-in) really does place spoken-phrase chips: that is the clone being removed', () => {
    const legacy = fill({explainPlates: true, sectionMarkers: true, allowCaptionClones: true});
    const placed = textsOf(legacy.direction).filter(spokenText);
    expect(placed.length).toBeGreaterThan(0);
  });
  it('default explain path: no kinetic text, emphasis, card/lockup chip or section marker is added; the pre-existing direction text is untouched', () => {
    const result = fill({explainPlates: true, sectionMarkers: true});
    expect(result.direction.motionGraphics).toEqual(enforced.motionGraphics);
    expect(result.direction.semanticEmphasis).toEqual(enforced.semanticEmphasis);
    expect(result.direction.moments).toEqual(enforced.moments);
    expect(result.added.section_markers).toBeUndefined();
    expect(result.warnings.some(warning => /^motion_graphic:caption_clone_skipped:density:\d+$/.test(warning))).toBe(true);
  });
  it('the engagement bar passes through plate anchors of the speaker\'s own words, with no chips (split plates on every probed look that allows them)', () => {
    const result = fill({explainPlates: true});
    const planned = result.plateAnchors.map(anchor => anchor.startSec);
    expect(result.plateAnchors.length).toBeGreaterThan(0);
    for (const anchor of result.plateAnchors) expect(spokenText(anchor.text)).toBe(true);
    expect(uncoveredEngagementWindows(result.direction, DURATION, planned)).toEqual([]);
    expect(meetsEngagementBar(result.direction, DURATION, planned)).toBe(true);
    expect(textsOf(result.direction)).toEqual(textsOf(enforced));
  });
  it('anchors are delivered by the seeder as split-screen plates of the speaker\'s words (mute covers them as split_screen)', () => {
    const result = fill({explainPlates: true});
    const seeded = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true, plateAnchors: result.plateAnchors});
    for (const anchor of result.plateAnchors) {
      const hit = seeded.director.graphics.find(graphic => Math.abs(graphic.start - anchor.startSec) <= 0.5);
      expect(hit, anchor.text).toBeDefined();
      expect(['split_screen', 'full_screen']).toContain(hit!.brief.placement);
      expect(resolveLibraryGraphic({goal: hit!.brief.goal, visualDescription: hit!.brief.visualDescription, placement: hit!.brief.placement, content: hit!.brief.content})?.compositionId).toBe('QuoteCallout');
    }
  });
  it('off the explain path nothing changes: chips are still filled', () => {
    const standard = fill({});
    expect(standard.warnings.some(warning => warning.includes('caption_clone_skipped'))).toBe(false);
  });
  it('source pins: the gate is `noClones` and the opt-in is explicit', () => {
    const source = read('./polishDensityFill.ts');
    expect(source).toContain('const noClones = Boolean(input.explainPlates) && !input.allowCaptionClones;');
    expect(source).toContain('caption_clone_skipped:density:');
    expect(read('./brollPlanner.ts')).not.toContain('allowCaptionClones');
  });
});

describe('WP11B 2) the caption mute covers every text-carrying overlay', () => {
  const words = [
    {text: 'transform', start: 4, end: 4.4},
    {text: 'your', start: 4.4, end: 4.6},
    {text: 'job', start: 4.6, end: 5},
    {text: 'today', start: 12, end: 12.4},
  ];
  it('a kinetic-text / emphasis / chip overlay that repeats the spoken words mutes the captions for its window', () => {
    const ranges = captionMuteRanges({graphics: [], contentById: new Map(), captionWords: words, textItems: [{start: 4, end: 6.6, text: 'transform your job'}]});
    expect(ranges).toEqual([{startSec: 4, endSec: 6.6}]);
  });
  it('text that shares no spoken word leaves the captions alone; empty text is ignored', () => {
    expect(captionMuteRanges({graphics: [], contentById: new Map(), captionWords: words, textItems: [{start: 4, end: 6, text: 'unrelated banner'}, {start: 4, end: 6, text: '  '}]})).toEqual([]);
  });
  it('windows from graphics and text items merge into one count', () => {
    const ranges = captionMuteRanges({
      graphics: [{id: 'g', start: 0, end: 2.4, placement: {mode: 'full_screen'}}],
      contentById: new Map(),
      captionWords: words,
      textItems: [{start: 4, end: 6.6, text: 'transform your job'}, {start: 6.62, end: 8, text: 'your job'}],
    });
    expect(ranges.length).toBe(2);
  });
  it('wiring pins: analyzeVideo feeds kinetic text, emphasis and overlay text; the count warning stays', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('textItems: [');
    expect(analyze).toContain('broll.motionGraphics');
    expect(analyze).toContain('broll.semanticEmphasis');
    expect(analyze).toContain('item.overlayText');
    expect(analyze).toContain('polish_captions:muted_for_graphics:${muteRanges.length}');
  });
});
