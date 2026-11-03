/**
 * WP10B: finish the craft pass. Every library plate takes its colours from the theme palette, WikiCallout (article page with a dominant highlighter), and overlay pills placed clear of the caption band.
 * Offline: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {assembleDirectedGraphics, type MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {clearOfCaptionBand, DEFAULT_PILL_BOX, MIN_OVERLAY_BOX_H, plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {LEAVE_THE_FACE_COMPOSITIONS} from './engagementCadence.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps} from './explainPlateGaps.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const motion = (file: string) => read(`../../../../remotion/src/motion/${file}`);
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'v', placement, content});
const wordsOf = (sentences: string[]) =>
  sentences.flatMap((sentence, index) => {
    const tokens = sentence.split(' ');
    const slot = 3.5 / tokens.length;
    return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
  });
const BOTTOM_BAND = {top: 0.67, bottom: 0.8}; // default bottom karaoke band (bottomFrac 0.2)
const overlaps = (box: {y: number; h: number}, band: {top: number; bottom: number}) => box.y < band.bottom && box.y + box.h > band.top;

describe('WP10B 1) every library plate is themed', () => {
  const comps = ['VsClaim', 'ProcessSteps', 'BeforeAfter', 'ChartExplainer', 'StatHighlight', 'BrandLockupBar', 'PointerCallout', 'WikiCallout'];
  it.each(comps)('%s takes its colours from the plate palette: no theme-fixed neon, no content-type / niche branching', file => {
    const source = motion(`compositions/${file}.tsx`);
    expect(source).toContain('usePlatePalette');
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).not.toMatch(/theme\.(?:secondary|success|accent|primary)\b/);
    expect(source).not.toMatch(/contentType|content_type|niche|mood|\bcyan\b|\bteal\b/i);
  });
  it('opaque plates paint the shared PlateGround (no Background variants left on a full-screen comp)', () => {
    for (const file of ['VsClaim', 'ProcessSteps', 'BeforeAfter', 'ChartExplainer', 'StatHighlight', 'WikiCallout']) expect(motion(`compositions/${file}.tsx`), file).toContain('<PlateGround />');
  });
  it.each([
    ['VsClaim', {left: 'speed', right: 'quality'}],
    ['ProcessSteps', {title: 'Ship it', steps: ['write', 'review', 'ship']}],
    ['BeforeAfter', {before: {label: 'Before', value: '12h'}, after: {label: 'After', value: '2h'}, title: 'Editing time'}],
    ['ChartExplainer', {kind: 'bar', data: [{label: 'features', value: 40}, {label: 'bugs', value: 12}]}],
    ['StatHighlight', {value: {to: 85, suffix: '%'}, label: 'of projects slip'}],
    ['WikiCallout', {passage: 'the standard is reviewed every single quarter', title: 'Standards', highlight: ['standard', 'quarter']}],
  ])('%s: the generated module passes worker validation (contract, typecheck, compile)', async (id, content) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe(id);
    const {report, compiled} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
});

describe('WP10B 2) WikiCallout', () => {
  it('registry: passage (+ title, highlight <= 3) -> WikiCallout, before stamp + title; opaque on a full screen, transparent on an overlay', () => {
    const hit = resolveLibraryGraphic(brief({passage: 'The standard is reviewed every quarter', title: 'Standards', highlight: ['standard']}))!;
    expect(hit).toMatchObject({compositionId: 'WikiCallout', props: {passage: 'The standard is reviewed every quarter', title: 'Standards', highlight: ['standard'], background: true}});
    expect(resolveLibraryGraphic(brief({passage: 'x y z w'}, 'overlay'))!.props.background).toBe(false);
    expect(resolveLibraryGraphic(brief({passage: 'a b c d', highlight: ['a', 'b', 'c', 'd']}))).toBeNull();
    expect(resolveLibraryGraphic(brief({passage: ''}))).toBeNull();
    expect(LEAVE_THE_FACE_COMPOSITIONS.has('WikiCallout')).toBe(true);
  });
  it('exported, in the compositions map, documented, with a dominant highlighter, and visually distinct from TweetCard', () => {
    const index = motion('index.ts');
    expect(index).toMatch(/export \{WikiCallout\b/);
    expect(index).toMatch(/export const compositions = \{[^}]*\bWikiCallout\b/);
    expect(motion('README.md')).toContain('| `WikiCallout` |');
    const wiki = motion('compositions/WikiCallout.tsx');
    for (const needle of ['highlightStyle="marker"', 'highlightOpacity={1}', 'highlightInk={palette.markerInk}', 'slice(0, 3)']) expect(wiki, needle).toContain(needle);
    const tweet = motion('compositions/TweetCard.tsx');
    expect(wiki).not.toContain('rotate(');
    expect(tweet).toContain('rotate(-1.2deg)');
    expect(wiki).toContain('tabs');
    expect(tweet).not.toContain('tabs');
    for (const source of [wiki]) for (const word of ['fetch(', 'http://', 'https://', 'AssetImage', '<img', 'staticFile', 'Math.random', 'Date.now']) expect(source, word).not.toContain(word);
  });
  const SENTENCES = [
    'According to the wiki the standard is reviewed every single quarter.',
    'Research shows that most teams skip the documentation entirely.',
    'Small habits compound into something very large over time.',
    'Honestly the best way to learn anything new is to teach it to someone else right away.',
  ];
  const WORDS = wordsOf(SENTENCES);
  const transcript = WORDS.map(word => word.text).join(' ');
  it('WP52: a long quotable claim without an article cue is no WikiCallout', () => {
    expect(plateShapeAt(WORDS, 3 * 4 + 0.2)?.composition).not.toBe('WikiCallout');
  });
  it.each([
    [0, 'the standard is reviewed every single quarter'],
    [1, 'most teams skip the documentation entirely'],
  ])('sentence %i (article cue; WP52: no long-claim route) -> WikiCallout {passage, highlight}: verbatim, grounded, highlight inside passage', (index, passage) => {
    const shape = plateShapeAt(WORDS, index * 4 + 0.2)!;
    expect(shape.composition).toBe('WikiCallout');
    expect((shape.content.passage as string).toLowerCase()).toBe(passage.toLowerCase());
    const highlight = shape.content.highlight as string[];
    expect(highlight.length).toBeGreaterThanOrEqual(1);
    expect(highlight.length).toBeLessThanOrEqual(3);
    for (const word of highlight) {
      expect(shape.content.passage as string).toContain(word);
      expect(isGroundedInTranscript(word, transcript)).toBe(true);
    }
    expect(Object.keys(shape.content).sort()).toEqual(['highlight', 'passage']);
  });
  it('seeds place it on the explain path only, gap briefs build it from the library, and a post cue still gives TweetCard', () => {
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: 24, lookId: remapped.id, explainPlates: true});
    expect(Object.values(seed.compositions)).toContain('WikiCallout');
    expect(Object.values(seedLibraryGraphics({words: WORDS, outputDurationSec: 24, lookId: remapped.id}).compositions)).not.toContain('WikiCallout');
    const briefs = buildClaudePlateBriefs(detectExplainPlateGaps({durationSec: 24, words: WORDS, coverStarts: []}), WORDS, 3);
    const wiki = briefs.filter(item => 'passage' in JSON.parse(item.contentJson));
    expect(wiki.length).toBeGreaterThanOrEqual(1);
    for (const item of wiki) {
      expect(item.visualDescription).toMatch(/encyclopedia article callout/);
      expect(resolveLibraryGraphic({goal: item.goal, visualDescription: item.visualDescription, placement: item.placement, content: JSON.parse(item.contentJson)})?.compositionId).toBe('WikiCallout');
    }
    const tweet = wordsOf(['Someone tweeted that nobody reads the documentation anymore.']);
    expect(plateShapeAt(tweet, 0.2)!.composition).toBe('TweetCard');
  });
});

describe('WP10B 3) TopicPills clear of the caption band', () => {
  const SENTENCES = ['Most people never learn how to use artificial intelligence properly today.', 'We remove retakes, fillers, noise and dead air from every video.', 'Curiosity is the only advantage that keeps compounding over time always.'];
  const WORDS = wordsOf(SENTENCES);
  it('the default pill box itself stays above the default bottom caption band', () => {
    expect(overlaps(DEFAULT_PILL_BOX, BOTTOM_BAND)).toBe(false);
  });
  it('clearOfCaptionBand: clear box unchanged; overlapping box shrunk above the band; moved below when no room above; null when neither fits', () => {
    const clear = {x: 0.04, y: 0.1, w: 0.5, h: 0.3};
    expect(clearOfCaptionBand(clear, BOTTOM_BAND)).toBe(clear);
    const shrunk = clearOfCaptionBand({x: 0.04, y: 0.32, w: 0.55, h: 0.42}, BOTTOM_BAND)!;
    expect(overlaps(shrunk, BOTTOM_BAND)).toBe(false);
    expect(shrunk.y).toBe(0.32);
    expect(shrunk.h).toBeGreaterThanOrEqual(MIN_OVERLAY_BOX_H);
    const topBand = {top: 0.12, bottom: 0.25};
    const moved = clearOfCaptionBand({x: 0.04, y: 0.1, w: 0.5, h: 0.3}, topBand)!;
    expect(overlaps(moved, topBand)).toBe(false);
    expect(moved.y).toBeGreaterThanOrEqual(topBand.bottom);
    expect(clearOfCaptionBand({x: 0.04, y: 0.3, w: 0.5, h: 0.3}, {top: 0.2, bottom: 0.95})).toBeNull();
  });
  it.each([
    ['bottom', BOTTOM_BAND],
    ['center', {top: 0.435, bottom: 0.565}],
    ['top', {top: 0.12, bottom: 0.25}],
  ])('seeds with a %s caption band: no overlay seed overlaps it, and the assembler refuses none for the band', (_name, band) => {
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: 36, lookId: remapped.id, explainPlates: true, captionBand: band});
    for (const graphic of seed.raw.graphics) if (graphic.box) expect(overlaps({y: graphic.box.y, h: graphic.box.h}, band), graphic.id).toBe(false);
    const assembled = assembleDirectedGraphics(seed.raw, {words: WORDS, outputDurationSec: 36, occupied: [], maxGraphics: 6, captionBand: band});
    expect(assembled.refusals.filter(item => /caption band/.test(item.reason))).toEqual([]);
  });
  it('the unmeasured-speaker pills seed (default box) is accepted by the assembler under the default bottom band; before WP10B the same box was refused', () => {
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: 36, lookId: remapped.id, captionBand: BOTTOM_BAND});
    const pills = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'TopicPills');
    expect(pills?.box).toBeDefined();
    expect(overlaps({y: pills!.box!.y, h: pills!.box!.h}, BOTTOM_BAND)).toBe(false);
    expect(assembleDirectedGraphics(seed.raw, {words: WORDS, outputDurationSec: 36, occupied: [], maxGraphics: 6, captionBand: BOTTOM_BAND}).refusals).toEqual([]);
    expect(overlaps({y: 0.32, h: 0.42}, BOTTOM_BAND)).toBe(true); // the WP9H box
  });
  it('a pill box with no room anywhere is skipped with a clear warning, not seeded and refused', () => {
    const band = {top: 0.2, bottom: 0.95};
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: 36, lookId: remapped.id, captionBand: band});
    expect(seed.compositions && Object.values(seed.compositions)).not.toContain('TopicPills');
    expect(seed.skippedForCaptionBand).toBeGreaterThanOrEqual(1);
    const result = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: 36, occupied: [], captionBand: band, lookId: remapped.id});
    expect(result.warnings.some(warning => warning.startsWith('motion_graphic:overlay_skipped_caption_band:'))).toBe(true);
    expect(result.warnings.some(warning => /caption_band/.test(warning))).toBe(true);
  });
  it('wiring pin: addLibrarySeeds hands the caption band to the seeder', () => {
    expect(read('../motionDirector/libraryFallback.ts')).toContain('captionBand: input.captionBand');
  });
});
