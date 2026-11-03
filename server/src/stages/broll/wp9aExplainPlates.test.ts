/**
 * WP9A: generated explain plates are the default cutaway substitute (no creator B-roll), and the engagement mixer rotates leave-the-face kinds. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {EDIT_LOOKS, remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {polishRequestedEdits, POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {explainPlateLimit, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {applyPolishDensityFill, MIN_BEAT_GAP_SEC} from './polishDensityFill.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {engagementWindows, isTextChipCadenceOnly, libraryCoverStarts, meetsEngagementBar, uncoveredEngagementWindows} from './engagementCadence.ts';
import {planEngagementBeats} from './engagementMixer.ts';
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


const plates = (explainPlates = true) => seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: remapped.id, explainPlates});
const covers = libraryCoverStarts(plates(), WORDS);

describe('WP9A explain plates replace chips when no creator B-roll resolves', () => {
  it('seed density: ~one plate per engage window, bounded by look cap and seed limit, varied compositions', () => {
    const seed = plates();
    expect(explainPlateLimit(DURATION)).toBe(4);
    expect(seed.limit).toBeLessThanOrEqual(remapped.maxGraphics);
    expect(seed.raw.graphics.length).toBeGreaterThanOrEqual(3);
    expect(seed.raw.graphics.length).toBeLessThanOrEqual(seed.limit);
    const windows = new Set(seed.raw.graphics.map(graphic => Math.floor(WORDS[graphic.anchorWordIndex]!.start / 8)));
    expect(windows.size).toBe(seed.raw.graphics.length); // at most one per window
    const comps = Object.values(seed.compositions);
    expect(new Set(comps).size).toBeGreaterThanOrEqual(2);
    // the standard (non-explain) seed is not denser than the explain one
    expect(plates(false).raw.graphics.length).toBeLessThanOrEqual(seed.raw.graphics.length);
  });
  it('talking_head -> matte-fail remap, lean list, no user B-roll: the bar passes through library plates, not cards', () => {
    expect(remapped.id).not.toBe('talking_head');
    const result = fill({cutawayResolvable: false, coveredBy: covers, explainPlates: true});
    expect(covers.length).toBeGreaterThanOrEqual(2);
    expect(result.direction.moments.some(moment => moment.layout === 'cutaway')).toBe(false);
    expect(uncoveredEngagementWindows(result.direction, DURATION, covers)).toEqual([]);
    expect(isTextChipCadenceOnly(result.direction, covers)).toBe(false);
    expect(meetsEngagementBar(result.direction, DURATION, covers)).toBe(true);
    // not card-only: the visual beats are the plates; no card was needed to cover a window
    expect(Object.keys(result.added).filter(key => key === 'cadence_card' || key === 'cadence_lockup')).toEqual([]);
  });
  it('without plates and off the explain path, windows fall back to cards (chips alone still fail the bar); the mixer reports them', () => {
    const result = fill({cutawayResolvable: false});
    expect(meetsEngagementBar(result.direction, DURATION)).toBe(false);
    expect(result.plateAnchors).toEqual([]);
    const plan = planEngagementBeats({durationSec: DURATION, look: remapped, words: WORDS, requested: LEAN, matteUsable: false, cutawayResolvable: false});
    expect(plan.warnings.some(warning => warning.startsWith('explain_plates:window_text_fallback:'))).toBe(true);
  });
  it('split-screen and kinetic-headline plates count as covers', () => {
    const seed = plates();
    expect(libraryCoverStarts(seed, WORDS).length).toBe(seed.raw.graphics.length);
    const split = libraryCoverStarts({raw: {graphics: [{id: 'a', anchorWordIndex: 3, placement: 'split_screen'}]}, compositions: {a: 'Unknown'}}, WORDS);
    expect(split).toEqual([WORDS[3]!.start]);
  });
  it('seed split plates carry a graphicSide and speak only transcript words', () => {
    for (const graphic of plates().raw.graphics) {
      if (graphic.placement === 'split_screen') expect(graphic.graphicSide).toBe('top');
      else expect(graphic.graphicSide).toBeUndefined();
      const values: string[] = [];
      const walk = (node: unknown): void => {
        if (typeof node === 'string') values.push(node);
        else if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') Object.entries(node).filter(([key]) => key !== 'recipeId').map(([, item]) => item).forEach(walk);
      };
      walk(JSON.parse(graphic.contentJson));
      for (const token of values.join(' ').match(/[A-Za-z']{4,}/g) ?? []) expect(spoken).toContain(` ${norm(token)} `);
    }
  });
});

describe('WP9A mixer', () => {
  const base = {durationSec: DURATION, look: remapped, words: WORDS, requested: LEAN, matteUsable: false};
  it('user B-roll resolvable: cutaways are proposed where the look allows, not text', () => {
    const plan = planEngagementBeats({...base, cutawayResolvable: true});
    expect(plan.beats.length).toBe(engagementWindows(DURATION).length);
    expect(plan.beats.every(beat => beat.kind === 'cutaway')).toBe(true);
    expect(plan.textFallbackWindows).toEqual([]);
    const result = fill({cutawayResolvable: true});
    expect(result.direction.moments.filter(moment => moment.layout === 'cutaway').length).toBeGreaterThanOrEqual(1);
    expect(meetsEngagementBar(result.direction, DURATION)).toBe(true);
  });
  it('rotates cutaway / split when the look allows both, never the same kind twice in a row', () => {
    const both = {...remapped, allowedElementKinds: [...remapped.allowedElementKinds, 'split' as never], graphicKinds: [...remapped.graphicKinds, 'split' as never], maxGraphics: 8};
    const plan = planEngagementBeats({...base, look: both, requested: new Set([...LEAN, 'split']), cutawayResolvable: true});
    const kinds = plan.beats.map(beat => beat.kind);
    expect(new Set(kinds)).toEqual(new Set(['cutaway', 'split']));
    kinds.slice(1).forEach((kind, index) => expect(kind).not.toBe(kinds[index]));
  });
  it('library covers satisfy their windows; the rest fall to a card (last resort) and are reported', () => {
    const plan = planEngagementBeats({...base, cutawayResolvable: false, libraryCovers: [1]});
    expect(plan.beats[0]).toMatchObject({kind: 'library_plate', source: 'library'});
    expect(plan.beats.slice(1).every(beat => beat.kind === 'card')).toBe(true);
    expect(plan.textFallbackWindows).toEqual([1, 2, 3]);
  });
  it('respects the look graphic cap', () => {
    const plan = planEngagementBeats({...base, cutawayResolvable: true, graphicsUsed: remapped.maxGraphics});
    expect(plan.beats.some(beat => beat.kind === 'cutaway')).toBe(false);
  });
});

describe('WP9A guards', () => {
  it('minimal_captions / density none stays sparse: no seeds, no fill', () => {
    const minimal = EDIT_LOOKS.find(entry => entry.id === 'minimal_captions')!;
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: minimal.id, explainPlates: true});
    expect(seed.raw.graphics).toEqual([]);
    expect(seed.none).toBe('look_allows_no_graphics');
    expect(applyPolishDensityFill({direction: thin(), look: minimal, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, cutawayResolvable: false, explainPlates: true}).added).toEqual({});
  });
  it('source pins: wiring and no clip / content-type branching', () => {
    const planner = read('./brollPlanner.ts');
    expect(planner).toContain("warnings.push('explain_plates:library_default')");
    expect(planner).toContain('explainPlates, sectionMarkers: true}');
    expect(read('../../pipeline/analyzeVideo.ts')).toContain('explainPlates: polishPath &&');
    expect(read('../motionDirector/libraryFallback.ts')).toContain('explainPlates: input.explainPlates');
    for (const file of ['./engagementMixer.ts', './engagementCadence.ts', './polishDensityFill.ts', '../motionDirector/transcriptLibrarySeed.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch/i);
  });
});
