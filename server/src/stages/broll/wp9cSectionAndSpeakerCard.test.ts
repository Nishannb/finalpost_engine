/**
 * WP9C: `01 — …` section markers (grounded) and the speaker-card half of a split plate. Pure: no model, no render. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {EDIT_LOOKS, remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {polishRequestedEdits, POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import {explainPlateLimit, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {applyPolishDensityFill, MIN_BEAT_GAP_SEC} from './polishDensityFill.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {engagementWindows, isTextChipCadenceOnly, libraryCoverStarts, meetsEngagementBar, uncoveredEngagementWindows} from './engagementCadence.ts';
import {isGroundedInTranscript} from './groundedText.ts';
import {planSectionMarkers, sectionCount} from './polishDensityFill.ts';
import {occupiedFromDirection, planEngagementBeats} from './engagementMixer.ts';
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
const transcript = WORDS.map(word => word.text).join(' ');
const withMarkers = (over: Partial<Parameters<typeof applyPolishDensityFill>[0]> = {}) => fill({sectionMarkers: true, allowUnspokenOrdinals: true, allowCaptionClones: true, cutawayResolvable: false, explainPlates: true, ...over});
const markerTexts = (d: VisualDirection) => [
  ...d.motionGraphics.map(item => item.text),
  ...d.semanticEmphasis.map(item => item.text),
  ...d.moments.map(item => item.overlayText),
].filter(text => /^0\d \u2014 /.test(text));

describe('WP9C section markers', () => {
  it('count: none under 16 s, 2-4 above', () => {
    expect([0, 10, 15.9].map(sectionCount)).toEqual([0, 0, 0]);
    expect(sectionCount(20)).toBe(2);
    expect(sectionCount(36)).toBe(4);
    expect(sectionCount(120)).toBe(4);
  });
  it('pure plan on the 36 s fixture: 2-4 ordered markers, `0N — <spoken words>`, outside the hook', () => {
    const markers = planSectionMarkers({words: WORDS, outputDurationSec: DURATION, hookEndSec: 3.2, taken: []});
    expect(markers.length).toBeGreaterThanOrEqual(2);
    expect(markers.length).toBeLessThanOrEqual(4);
    markers.forEach((marker, index) => {
      expect(marker.index).toBe(index + 1);
      expect(marker.label).toBe(`0${index + 1} \u2014 ${marker.phrase}`);
      expect(marker.start).toBeGreaterThanOrEqual(3.2);
      expect(isGroundedInTranscript(marker.label, transcript)).toBe(true);
      expect(marker.phrase.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(marker.phrase.split(' ').length).toBeLessThanOrEqual(5);
      if (index > 0) expect(marker.start).toBeGreaterThan(markers[index - 1]!.start);
    });
  });
  it('the grounding allowance is narrow: ordinal chrome passes, unspoken words and other numerals do not', () => {
    expect(isGroundedInTranscript('01 \u2014 Pick one metric', transcript)).toBe(true);
    expect(isGroundedInTranscript('01 \u2014 Pick two metrics', transcript)).toBe(false);
    expect(isGroundedInTranscript('01 - Pick one metric', transcript)).toBe(false); // hyphen
    expect(isGroundedInTranscript('Pick one metric 01 \u2014', transcript)).toBe(false); // not at the start
    expect(isGroundedInTranscript('00 \u2014 Pick one metric', transcript)).toBe(false);
    expect(isGroundedInTranscript('10 \u2014 Pick one metric', transcript)).toBe(false);
  });
  it('fill: markers are off by default and on with the option; warning polish_density_fill:section_markers:<n>', () => {
    expect(markerTexts(fill({cutawayResolvable: false, explainPlates: true}).direction)).toEqual([]);
    const result = withMarkers();
    const texts = markerTexts(result.direction);
    expect(texts.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toContain(`polish_density_fill:section_markers:${result.added.section_markers}`);
    expect(result.added.section_markers).toBe(texts.length);
    for (const text of texts) expect(isGroundedInTranscript(text, transcript)).toBe(true);
    // the look-allowed form: explainer_cutaway allows card / emphasis, not kinetic text or lockup
    expect(result.direction.motionGraphics.some(item => item.text.startsWith('01'))).toBe(false);
  });
  it('markers keep their distance from every other designed beat and are not in every window', () => {
    const result = withMarkers();
    const markerTimes = [
      ...result.direction.moments.filter(item => /^0\d \u2014 /.test(item.overlayText)).map(item => item.timestamp),
      ...result.direction.semanticEmphasis.filter(item => /^0\d \u2014 /.test(item.text)).map(item => item.start),
    ];
    const others = [
      ...result.direction.moments.filter(item => !/^0\d \u2014 /.test(item.overlayText)).map(item => item.timestamp),
      ...result.direction.motionGraphics.map(item => item.start),
      ...result.plateAnchors.map(anchor => anchor.startSec),
    ];
    for (const time of markerTimes) for (const other of others) expect(Math.abs(time - other)).toBeGreaterThanOrEqual(1.5);
    expect(markerTimes.length).toBeLessThanOrEqual(4);
  });
  it('minimal_captions: no markers, no fill', () => {
    const minimal = EDIT_LOOKS.find(entry => entry.id === 'minimal_captions')!;
    const result = applyPolishDensityFill({direction: thin(), look: minimal, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, sectionMarkers: true, explainPlates: true});
    expect(result.added).toEqual({});
    expect(markerTexts(result.direction)).toEqual([]);
  });
  it('a look that allows kinetic text uses it (look-allowed form, not a fixed one)', () => {
    const kinetic = {...remapped, allowedElementKinds: [...remapped.allowedElementKinds, 'kinetic_text' as never], graphicKinds: [...remapped.graphicKinds, 'kinetic_text' as never]};
    const result = applyPolishDensityFill({direction: enforced, look: kinetic, words: WORDS, outputDurationSec: DURATION, requested: LEAN, matteUsable: false, cutawayResolvable: false, explainPlates: true, sectionMarkers: true, allowUnspokenOrdinals: true, allowCaptionClones: true});
    expect(result.direction.motionGraphics.some(item => /^0\d \u2014 /.test(item.text))).toBe(true);
  });
  it('the engagement bar still passes with markers on (they never replace a plate anchor)', () => {
    const result = withMarkers();
    const starts = result.plateAnchors.map(anchor => anchor.startSec);
    expect(uncoveredEngagementWindows(result.direction, DURATION, starts)).toEqual([]);
    expect(isTextChipCadenceOnly(result.direction, starts)).toBe(false);
    expect(meetsEngagementBar(result.direction, DURATION, starts)).toBe(true);
  });
});

describe('WP9C speaker card over the explain plate', () => {
  it('fill + seed path yields split_screen top plates (blueprint placement), and the speaker half is docked below', () => {
    const anchors = withMarkers().plateAnchors;
    const seeded = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true, plateAnchors: anchors});
    const splits = seeded.director.graphics.filter(graphic => graphic.brief.placement === 'split_screen');
    expect(splits.length).toBeGreaterThanOrEqual(anchors.length);
    for (const graphic of splits) expect(graphic.brief.graphicSide).toBe('top');
  });
  it('the renderer rounds the speaker half on the edge that meets the plate; media_container is not emitted (the renderer ignores it during a generated split)', () => {
    const stage = read('../../../../remotion/src/generated/GeneratedGraphicTrack.tsx');
    expect(stage).toContain('SPEAKER_CARD_RADIUS');
    expect(stage).toMatch(/borderTopLeftRadius: SPEAKER_CARD_RADIUS/);
    expect(stage).toMatch(/borderBottomLeftRadius: SPEAKER_CARD_RADIUS/);
    expect(read('../../../../remotion/src/ShortVideo.tsx')).toMatch(/mediaContainer =\s*!split && !generatedSplit/);
    const result = withMarkers();
    expect(result.direction.mediaContainers).toEqual([]);
  });
});

describe('WP9C guards', () => {
  it('source pins: planner turns markers on; no clip / content-type / stock branching', () => {
    expect(read('./brollPlanner.ts')).toContain('sectionMarkers: true');
    expect(read('./groundedText.ts')).toContain('SECTION_ORDINAL');
    for (const file of ['./polishDensityFill.ts', './groundedText.ts']) expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch/i);
  });
});
