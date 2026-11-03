/**
 * WP9B: a split with no creator B-roll is a library plate (top graphic, bottom speaker), and the plate anchors the polish plan asks for match the motion stage. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {EDIT_LOOKS, remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {polishRequestedEdits, POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {explainPlateLimit, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {applyPolishDensityFill, MIN_BEAT_GAP_SEC} from './polishDensityFill.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {engagementWindows, isTextChipCadenceOnly, libraryCoverStarts, meetsEngagementBar, uncoveredEngagementWindows} from './engagementCadence.ts';
import {hookWindowFromDirection, occupiedFromDirection, planEngagementBeats} from './engagementMixer.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {assembleDirectedGraphics, type MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
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



const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const base = {durationSec: DURATION, look: remapped, words: WORDS, requested: LEAN, matteUsable: false, cutawayResolvable: false};
const seedInput = {words: WORDS, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true};

describe('WP9B split without creator B-roll', () => {
  it('cutawayResolvable false no longer kills split: the mixer proposes a plate-backed split on the explain path', () => {
    const plan = planEngagementBeats({...base, plateSplit: true});
    const proposed = plan.beats.filter(beat => beat.source === 'proposed');
    expect(proposed.length).toBe(engagementWindows(DURATION).length);
    expect(proposed.every(beat => beat.kind === 'split' && beat.via === 'plate')).toBe(true);
    expect(plan.beats.some(beat => beat.kind === 'cutaway')).toBe(false);
    expect(plan.textFallbackWindows).toEqual([]);
  });
  it('off the explain path (or a look with no graphic room) split stays unavailable: cards, reported', () => {
    expect(planEngagementBeats(base).beats.every(beat => beat.kind === 'card')).toBe(true);
    const minimal = EDIT_LOOKS.find(entry => entry.id === 'minimal_captions')!;
    expect(planEngagementBeats({...base, look: minimal, plateSplit: true}).beats.some(beat => beat.kind === 'split')).toBe(false);
  });
  it('plate splits share the look cap with predicted plates', () => {
    const plan = planEngagementBeats({...base, plateSplit: true, libraryCovers: [1, 9], graphicsUsed: 1});
    const splits = plan.beats.filter(beat => beat.source === 'proposed' && beat.kind === 'split').length;
    expect(splits).toBeLessThanOrEqual(remapped.maxGraphics - 1 - 2);
  });
  it('footage split still needs resolvable media; cutaway stays gated on it', () => {
    const split = {...remapped, allowedElementKinds: [...remapped.allowedElementKinds, 'split' as never]};
    const unresolved = planEngagementBeats({...base, look: split, requested: new Set([...LEAN, 'split']), proposable: ['cutaway', 'split']});
    expect(unresolved.beats.some(beat => beat.kind === 'split')).toBe(false);
    const resolved = planEngagementBeats({...base, look: split, requested: new Set([...LEAN, 'split']), cutawayResolvable: true});
    expect(new Set(resolved.beats.map(beat => beat.kind))).toEqual(new Set(['cutaway', 'split']));
    expect(resolved.beats.filter(beat => beat.kind === 'split').every(beat => beat.via === 'media')).toBe(true);
  });
  it('fill: lean + no creator B-roll + explain path emits plate anchors (never a footage moment that would be dropped); the bar passes with no card', () => {
    const result = fill({cutawayResolvable: false, explainPlates: true});
    expect(result.direction.moments.some(moment => moment.layout === 'split' || moment.layout === 'cutaway')).toBe(false);
    expect(result.plateAnchors.length).toBeGreaterThanOrEqual(2);
    expect(result.plateAnchors.every(anchor => anchor.placement === 'split_screen')).toBe(true);
    const starts = result.plateAnchors.map(anchor => anchor.startSec);
    expect(uncoveredEngagementWindows(result.direction, DURATION, starts)).toEqual([]);
    expect(isTextChipCadenceOnly(result.direction, starts)).toBe(false);
    expect(meetsEngagementBar(result.direction, DURATION, starts)).toBe(true);
    expect(Object.keys(result.added).filter(key => key === 'cadence_card' || key === 'cadence_lockup')).toEqual([]);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:window_text_fallback'))).toBe(false);
    for (const anchor of result.plateAnchors) expect(spoken).toContain(` ${norm(anchor.text)} `);
  });
  it('fill: not on the explain path no anchors are produced', () => {
    expect(fill({cutawayResolvable: false}).plateAnchors).toEqual([]);
  });
});

describe('WP9B plate anchors match the motion stage', () => {
  const hook = direction({hookTitle: 'Ship faster', hookStartSec: 0});
  const planned = occupiedFromDirection(hook, 3);
  it('occupiedFromDirection mirrors occupiedByExistingEdits for the hook', () => {
    expect(planned).toEqual([{start: 0, end: 3}]);
  });
  it('predicted covers (same words / look / occupied) equal what addLibrarySeeds places, within 0.5 s', () => {
    // WP10A: on the explain path the hook window is passed separately (the open plate may take it).
    const predicted = libraryCoverStarts(seedLibraryGraphics({...seedInput, occupied: [], hookWindow: hookWindowFromDirection(hook, 3)}), WORDS);
    const real = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [{start: 0, end: 3, what: 'hook title'}], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    const placed = real.director.graphics.map(graphic => graphic.start);
    expect(predicted.length).toBeGreaterThanOrEqual(3);
    expect(placed.length).toBe(predicted.length);
    predicted.forEach((start, index) => expect(Math.abs(start - placed[index]!)).toBeLessThanOrEqual(0.5));
  });
  it('without the hook in the prediction the first plate lands in the hook (the divergence WP9B removes)', () => {
    const naive = libraryCoverStarts(seedLibraryGraphics(seedInput), WORDS);
    expect(naive.some(start => start < 3)).toBe(true);
    const aware = libraryCoverStarts(seedLibraryGraphics({...seedInput, occupied: planned.map(item => ({...item, what: 'planned'}))}), WORDS);
    expect(aware.every(start => start >= 3 - 1e-9)).toBe(true);
    // WP10A: with the hook passed as a window instead, only the open plate (at the first word) may start inside it.
    const windowed = libraryCoverStarts(seedLibraryGraphics({...seedInput, hookWindow: hookWindowFromDirection(hook, 3)}), WORDS);
    expect(windowed.filter(start => start < 3 - 1e-9).length).toBeLessThanOrEqual(1);
  });
  it('anchors the fill produced are placed by addLibrarySeeds as split_screen plates of the speaker\'s own words', () => {
    const anchors = fill({cutawayResolvable: false, explainPlates: true}).plateAnchors;
    const real = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true, plateAnchors: anchors});
    for (const anchor of anchors) {
      const hit = real.director.graphics.find(graphic => Math.abs(graphic.start - anchor.startSec) <= 0.5);
      expect(hit, anchor.text).toBeDefined();
      expect(hit!.brief.placement).toBe('split_screen');
      expect(hit!.brief.graphicSide).toBe('top');
    }
    expect(real.warnings.some(warning => warning.startsWith('explain_plates:anchor_unplaced'))).toBe(false);
  });
  it('an anchor inside an occupied span is reported, not forced', () => {
    const result = seedLibraryGraphics({...seedInput, occupied: [{start: 8, end: 12, what: 'x'}], anchors: [{startSec: WORDS.find(word => word.start >= 9)!.start, text: 'Pick one metric', placement: 'split_screen'}]});
    expect(result.unplacedAnchors).toBe(1);
  });
});

describe('WP9B split seed plates are real briefs', () => {
  it('at least one explain-plate seed on the 36 s fixture is split_screen with graphicSide top, and the registry resolves it', () => {
    const seed = seedLibraryGraphics(seedInput);
    const splits = seed.raw.graphics.filter(graphic => graphic.placement === 'split_screen');
    expect(splits.length).toBeGreaterThanOrEqual(1);
    const assembled = assembleDirectedGraphics(seed.raw, {words: WORDS, outputDurationSec: DURATION, occupied: [], maxGraphics: 6, captionBand: undefined as never});
    expect(assembled.refusals).toEqual([]);
    for (const graphic of assembled.graphics.filter(item => splits.some(split => split.id === item.brief.id))) {
      expect(graphic.brief.placement).toBe('split_screen');
      expect(graphic.brief.graphicSide).toBe('top');
      expect(graphic.brief.box).toBeUndefined();
      const hit = resolveLibraryGraphic({goal: graphic.brief.goal, visualDescription: graphic.brief.visualDescription, placement: graphic.brief.placement, content: graphic.brief.content});
      expect(hit).not.toBeNull();
      expect(hit!.compositionId).toBe(seed.compositions[graphic.brief.id]);
    }
  });
  it('an anchor plate is a QuoteCallout split of the anchor words, anchored at the spoken word', () => {
    const start = WORDS.find(word => word.start >= 9)!;
    const seed = seedLibraryGraphics({...seedInput, anchors: [{startSec: start.start, text: 'Pick one metric', placement: 'split_screen'}]});
    const hit = seed.raw.graphics.find(graphic => WORDS[graphic.anchorWordIndex]!.start === start.start)!;
    expect(hit.placement).toBe('split_screen');
    expect(hit.graphicSide).toBe('top');
    expect(JSON.parse(hit.contentJson)).toEqual({quote: 'Pick one metric'});
  });
  it('minimal_captions still seeds nothing, anchors or not', () => {
    const seed = seedLibraryGraphics({...seedInput, lookId: 'minimal_captions', anchors: [{startSec: 9, text: 'Pick one metric', placement: 'split_screen'}]});
    expect(seed.raw.graphics).toEqual([]);
  });
  it('source pins: wiring and no clip / content-type / stock branching', () => {
    expect(read('./brollPlanner.ts')).toContain('plateAnchors = density.plateAnchors');
    expect(read('./brollPlanner.ts')).toContain('occupiedFromDirection(direction, hookDurationSec, ');
    expect(read('../../pipeline/analyzeVideo.ts')).toContain('plateAnchors: broll.plateAnchors');
    expect(read('../motionDirector/index.ts')).toContain('plateAnchors: input.plateAnchors');
    expect(read('../motionDirector/libraryFallback.ts')).toContain('anchors: input.plateAnchors');
    for (const file of ['./engagementMixer.ts', './polishDensityFill.ts', '../motionDirector/transcriptLibrarySeed.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch/i);
  });
});
