/**
 * WP8X: lean polish prefers real cutaways / fullscreen beats over text chips, and the cadence respects library covers. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {EDIT_LOOKS, remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {polishRequestedEdits, POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {applyPolishDensityFill, MIN_BEAT_GAP_SEC} from './polishDensityFill.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {engagementWindows, isTextChipCadenceOnly, libraryCoverStarts, meetsEngagementBar, uncoveredEngagementWindows, visualBeatTimes} from './engagementCadence.ts';
import type {VisualDirection} from './geminiDirector.ts';
import type {WordToken} from '../../types/blueprint.ts';

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
const norm = (text: string) => text.replace(/[.,]/g, '').toLowerCase();
const spoken = ` ${WORDS.map(word => norm(word.text)).join(' ')} `;
const LEAN = new Set<string>(POLISH_LEAN_EDITS);

const direction = (over: Partial<VisualDirection> = {}): VisualDirection => ({
  hookTitle: 'Ship faster', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [],
  caption: {} as never, suggestedLutIds: [], preferredLutId: '',
  zooms: [], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [],
  estimatedCostUsd: 0, source: 'gemini', ...over,
});
const thin = (): VisualDirection => direction({
  zooms: [{timestamp: 6, durationSec: 2.5}, {timestamp: 15, durationSec: 2.5}, {timestamp: 27, durationSec: 2.5}],
  moments: [{timestamp: 20, searchKeyword: 'x', media: 'text', layout: 'lockup', anchor: 'top_right', overlayText: 'Never confuse being busy', textStyle: 'stack', accentColor: '#fff'} as never],
});
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const enforced = applyEditLookToDirection(thin(), remapped, {matteUsable: false}).direction;
const fill = (over: Partial<Parameters<typeof applyPolishDensityFill>[0]> = {}) => applyPolishDensityFill({direction: enforced, look: remapped, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, ...over});

describe('WP8X lean toolkit includes cutaway', () => {
  it('POLISH_LEAN_EDITS lists cutaway and keeps card / lockup as fallbacks; the default polish list carries it', () => {
    expect(POLISH_LEAN_EDITS).toContain('cutaway');
    expect(POLISH_LEAN_EDITS).toEqual(expect.arrayContaining(['card', 'lockup']));
    expect(polishRequestedEdits(undefined)).toContain('cutaway');
    expect(polishRequestedEdits(['captions'])).toContain('cutaway');
    expect(polishRequestedEdits(['zoom'])).toEqual(['zoom']);
  });
});

describe('WP8X Gate-6 shaped fixture on the LEAN list', () => {
  const result = fill();
  const moments = result.direction.moments;
  it('emits at least one cutaway moment (not only chips) and the windows stay covered', () => {
    expect(moments.filter(moment => moment.layout === 'cutaway').length).toBeGreaterThanOrEqual(1);
    expect(uncoveredEngagementWindows(result.direction, DURATION)).toEqual([]);
    expect(meetsEngagementBar(result.direction, DURATION)).toBe(true);
    expect(isTextChipCadenceOnly(result.direction)).toBe(false);
  });
  it('cutaway comes first: every uncovered window gets a cutaway until the look cap, cards only after', () => {
    const cutaways = moments.filter(moment => moment.layout === 'cutaway');
    expect(cutaways.length).toBeLessThanOrEqual(remapped.maxGraphics);
    expect(moments.filter(moment => moment.layout === 'chip' && moment.media === 'text').length).toBeLessThanOrEqual(cutaways.length + 2);
    expect(result.warnings.some(warning => warning.startsWith('polish_density_fill:cadence_cutaway:'))).toBe(true);
  });
  it('copy and queries stay spoken words', () => {
    for (const moment of moments.filter(entry => entry.layout === 'cutaway')) {
      expect(moment.overlayText).toBe('');
      for (const query of moment.queries ?? []) for (const token of query.split(' ')) expect(spoken).toContain(` ${norm(token)} `);
    }
    for (const moment of moments.filter(entry => entry.layout === 'chip')) expect(spoken).toContain(` ${norm(moment.overlayText)} `);
  });
  it('a cutaway that cannot resolve (creator B-roll only, none supplied) falls back to cards: chips alone fail the engaging bar', () => {
    const chips = fill({cutawayResolvable: false});
    expect(chips.direction.moments.some(moment => moment.layout === 'cutaway')).toBe(false);
    expect(uncoveredEngagementWindows(chips.direction, DURATION)).toEqual([]); // WP8W window math is unchanged
    expect(isTextChipCadenceOnly(chips.direction)).toBe(true);
    expect(meetsEngagementBar(chips.direction, DURATION)).toBe(false);
  });
});

describe('WP8X library covers are respected', () => {
  it('a predicted full-screen seed covers its window: no cutaway or card is added there', () => {
    const covered = [engagementWindows(DURATION)[0]!.start + 4, engagementWindows(DURATION)[3]!.start + 3];
    const result = fill({coveredBy: covered});
    const added = result.direction.moments.filter(moment => moment.timestamp !== 20);
    // The cadence cover leaves a covered window alone, and no text beat sits within MIN_BEAT_GAP_SEC of a seed start.
    for (const moment of added) {
      expect(covered.some(time => Math.abs(time - moment.timestamp) < MIN_BEAT_GAP_SEC)).toBe(false);
      expect(moment.timestamp >= 0 && moment.timestamp < 8 && moment.layout === 'cutaway').toBe(false);
      expect(moment.timestamp >= 24 && moment.timestamp < 32 && moment.layout === 'cutaway').toBe(false);
    }
    expect(uncoveredEngagementWindows(result.direction, DURATION, covered)).toEqual([]);
  });
  it('libraryCoverStarts keeps full-screen seeds, topic pills and (WP9A) known leave-the-face compositions, and drops unknown overlays', () => {
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: 'explainer_cutaway'});
    const starts = libraryCoverStarts(seed, WORDS);
    expect(starts.length).toBeGreaterThan(0);
    const synthetic = libraryCoverStarts({raw: {graphics: [{id: 'a', anchorWordIndex: 0, placement: 'overlay'}, {id: 'b', anchorWordIndex: 5, placement: 'overlay'}, {id: 'c', anchorWordIndex: 9, placement: 'full_screen'}]}, compositions: {a: 'BigKineticHeadline', b: 'TopicPills', c: 'VsClaim'}}, WORDS);
    expect(synthetic).toEqual([WORDS[0]!.start, WORDS[5]!.start, WORDS[9]!.start]); // WP9A: BigKineticHeadline is a leave-the-face composition even as an overlay
    expect(libraryCoverStarts({raw: {graphics: [{id: 'l', anchorWordIndex: 2, placement: 'overlay'}]}, compositions: {l: 'BrandLockupBar'}}, WORDS)).toEqual([]);
  });
  it('seeds alone can meet the bar when no cutaway resolves: visual beats count library covers', () => {
    const starts = libraryCoverStarts(seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: 'explainer_cutaway'}), WORDS);
    expect(visualBeatTimes(direction(), starts).length).toBeGreaterThan(0);
    const chips = fill({cutawayResolvable: false, coveredBy: starts});
    expect(isTextChipCadenceOnly(chips.direction, starts)).toBe(false);
    expect(uncoveredEngagementWindows(chips.direction, DURATION, starts)).toEqual([]);
  });
});

describe('WP8X guards unchanged', () => {
  it('a usable matte keeps talking_head (no remap); minimal_captions stays sparse', () => {
    expect(remapLookForUnusableMatte(resolveEditLook('talking_head'), true).resolution.look.id).toBe('talking_head');
    expect(applyPolishDensityFill({direction: thin(), look: EDIT_LOOKS.find(entry => entry.id === 'minimal_captions')!, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, cutawayResolvable: true}).added).toEqual({});
  });
  it('source pins: planner wiring, no clip / content-type branching', () => {
    const planner = read('./brollPlanner.ts');
    expect(planner).toContain('coveredBy: predicted');
    expect(planner).toContain('cutawayResolvable: userBrollAssets.length > 0 || !input.userBrollOnly');
    expect(read('../../pipeline/analyzeVideo.ts')).toContain('expectLibraryGraphics: polishPath && motionGraphicsRequested');
    for (const file of ['./engagementCadence.ts', './polishDensityFill.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'/i);
  });
});
