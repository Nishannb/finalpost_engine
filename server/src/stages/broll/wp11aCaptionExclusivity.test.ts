/**
 * WP11A: one text job at a time (captions muted while a graphic owns the words), no caption-clone overlays, no invented ordinals, curve only with editorial weight, grounded Lucide icons on list plates,
 * and a higher-contrast short-form palette. Offline: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionsMutedAt} from '../../../../remotion/src/lib/captionSplit.ts';
import {timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {platePalette, plateContrast, isKaraokeCyan} from '../../../../remotion/src/motion/palette.ts';
import {captionMuteRanges} from '../../lib/captionMute.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {ICON_ALLOWLIST, iconForLabel, iconsForLabels, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {isEditorialText, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {generatedGraphicIsGrounded} from './legibility.ts';
import {planSectionMarkers, spokenOrdinalOf} from './polishDensityFill.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const timed = (sentences: string[], perWord = 0.28, gap = 1.2) => {
  let t = 0;
  return sentences.flatMap(sentence =>
    sentence.split(' ').map((text, i, all) => {
      const start = Math.round(t * 1000) / 1000;
      t += perWord;
      if (i === all.length - 1) t += gap;
      return {text, start, end: Math.round((start + perWord * 0.9) * 1000) / 1000};
    }),
  );
};
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'pills', placement, content});

describe('WP11A A) captions muted while a graphic owns the words', () => {
  const words = timed(['Today and I have a choice between two options that matter.', 'Pick one metric and protect it.', 'According to the wiki the standard is reviewed every single quarter.', 'Then keep going and ship it today.'], 0.4, 2);
  const graphics = [
    {id: 'open', start: 0, end: 2.4, placement: {mode: 'full_screen'}},
    {id: 'wiki', start: 9, end: 13, placement: {mode: 'full_screen'}},
  ];
  it('full-screen plates mute exactly their window; words outside the ranges stay on', () => {
    const ranges = captionMuteRanges({graphics, contentById: new Map(), captionWords: words});
    expect(ranges).toEqual([{startSec: 0, endSec: 2.4}, {startSec: 9, endSec: 13}]);
    expect(captionsMutedAt(ranges, 1)).toBe(true);
    expect(captionsMutedAt(ranges, 2.4)).toBe(false); // end exclusive
    expect(captionsMutedAt(ranges, 5)).toBe(false);
    expect(captionsMutedAt(ranges, 9)).toBe(true);
    expect(captionsMutedAt(ranges, 13.2)).toBe(false);
    const outside = words.filter(word => !captionsMutedAt(ranges, word.start));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.length).toBeLessThan(words.length);
  });
  it('split-screen mutes too; an overlay mutes only when its words intersect the spoken caption words in its window', () => {
    const overlay = {id: 'chip', start: 4, end: 6, placement: {mode: 'overlay'}};
    const spokenWords = timed(['pick one metric and protect it from everything else'], 0.3, 0);
    const shifted = spokenWords.map(word => ({...word, start: word.start + 4, end: word.end + 4}));
    expect(captionMuteRanges({graphics: [overlay], contentById: new Map([['chip', {items: ['metric', 'protect']}]]), captionWords: shifted})).toEqual([{startSec: 4, endSec: 6}]);
    expect(captionMuteRanges({graphics: [overlay], contentById: new Map([['chip', {items: ['unrelated', 'banana']}]]), captionWords: shifted})).toEqual([]);
    expect(captionMuteRanges({graphics: [{id: 's', start: 1, end: 3, placement: {mode: 'split_screen'}}], contentById: new Map(), captionWords: shifted})).toEqual([{startSec: 1, endSec: 3}]);
  });
  it('icon names are not words: an icon key does not count as shared caption text', () => {
    const overlay = {id: 'p', start: 0, end: 2, placement: {mode: 'overlay'}};
    expect(captionMuteRanges({graphics: [overlay], contentById: new Map([['p', {items: ['zzz'], icons: ['users']}]]), captionWords: [{text: 'users', start: 0.2, end: 0.6}]})).toEqual([]);
  });
  it('adjacent ranges merge', () => {
    const merged = captionMuteRanges({graphics: [{id: 'a', start: 0, end: 2, placement: {mode: 'full_screen'}}, {id: 'b', start: 2.02, end: 4, placement: {mode: 'full_screen'}}], contentById: new Map(), captionWords: []});
    expect(merged).toEqual([{startSec: 0, endSec: 4}]);
  });
  it('wiring pins: blueprint field, the renderer gate, the server emit and the warning', () => {
    expect(Object.keys(timelineBlueprintSchema.shape)).toContain('captionMuteRanges');
    expect(timelineBlueprintSchema.shape.captionMuteRanges.parse(undefined)).toEqual([]);
    const short = read('../../../../remotion/src/ShortVideo.tsx');
    expect(short).toContain('captionsMutedAt(blueprint.captionMuteRanges, timeSec)');
    expect(short).toMatch(/\{!openingShowing && legibleCaptions/);
    expect(short).toMatch(/\{!openingShowing \? \(/);
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('polish_captions:muted_for_graphics:');
    expect(analyze).toContain('captionMuteRanges: muteRanges');
    expect(read('../../types/blueprint.ts')).toContain('captionMuteRanges?:');
  });
});

describe('WP11A B) no caption clones', () => {
  const OPENER = 'Today and I have a choice between two options that matter for the company I am building right now';
  const PROFESSIONS = 'I would hire a lawyer, a marketing person, supply chain help, a business developer and customer support.';
  const NO_ICON = 'We remove retakes, fillers, noise, silences and dead air from every video.';
  const REST = ['You should always hire the expert and trust their advice.', 'The right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal from you.', 'Then keep the standard high and ship it anyway today.'];
  const seedOf = (sentences: string[]) => {
    const words = timed(sentences, 0.28, 4.2);
    return {words, seed: seedLibraryGraphics({words, outputDurationSec: Math.max(40, Math.ceil(words[words.length - 1]!.end + 2)), lookId: remapped.id, explainPlates: true})};
  };
  it('WP52: a bare-text pill list (no label maps to an icon) is skipped, never drawn as bare pills and never upgraded to a WikiCallout; the OpenPlate still seeds', () => {
    const {words, seed} = seedOf([OPENER, NO_ICON, ...REST]);
    const comps = Object.values(seed.compositions);
    expect(comps).not.toContain('TopicPills');
    expect(comps).not.toContain('WikiCallout');
    expect(seed.listUpgraded ?? []).toEqual([]);
    expect(comps).toContain('OpenPlate');
    const result = addLibrarySeeds(emptyDirector, {words, outputDurationSec: Math.max(40, Math.ceil(words[words.length - 1]!.end + 2)), occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    expect(result.warnings).not.toContain('motion_graphic:list_upgraded:wiki');
  });
  it('a profession list whose every label maps to an icon is kept as an illustrated list: the seeded pills carry icons', () => {
    const {seed} = seedOf([OPENER, PROFESSIONS, REST[0]!]);
    const pills = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'TopicPills');
    expect(pills).toBeDefined();
    const content = JSON.parse(pills!.contentJson) as {items: string[]; icons: string[]};
    expect(content.icons.length).toBe(content.items.length);
    for (const icon of content.icons) expect(ICON_ALLOWLIST.has(icon)).toBe(true);
    const hit = resolveLibraryGraphic({goal: pills!.goal, visualDescription: pills!.visualDescription, placement: pills!.placement, content})!;
    expect(hit.compositionId).toBe('TopicPills');
    expect((hit.props.items as Array<{label: string; icon?: string}>).every(item => typeof item.icon === 'string')).toBe(true);
    expect((hit.props.items as Array<{label: string}>).length).toBeGreaterThanOrEqual(1);
  });
  it('an overlay headline that repeats the spoken line becomes a designed full-screen statement (captions muted by the plate)', () => {
    const {seed} = seedOf(['Never stop building what people actually need!', ...REST]);
    for (const graphic of seed.raw.graphics) if (seed.compositions[graphic.id] === 'BigKineticHeadline') expect(graphic.placement).not.toBe('overlay');
  });
  it('the standard (non-explain) seed path is unchanged: bare pills still seed there', () => {
    const words = timed([OPENER, NO_ICON, ...REST], 0.28, 4.2);
    const standard = seedLibraryGraphics({words, outputDurationSec: Math.ceil(words[words.length - 1]!.end + 2), lookId: remapped.id});
    expect(standard.captionClonesSkipped).toBeUndefined();
  });
});

describe('WP11A C) ordinals only when spoken', () => {
  it('spokenOrdinalOf reads real leads and nothing else', () => {
    expect(spokenOrdinalOf('Number two is market size')).toBe(2);
    expect(spokenOrdinalOf('Step 3 write the plan')).toBe(3);
    expect(spokenOrdinalOf('First, we remove retakes')).toBe(1);
    expect(spokenOrdinalOf('Marketing person supply chain customer')).toBeNull();
    expect(spokenOrdinalOf('I need one lawyer')).toBeNull();
  });
  it('section markers on a list with no ordinal speech: none; with a spoken ordinal: the SPOKEN number, never the slice index', () => {
    const plain = timed(['Most teams choose speed.', 'Hire a lawyer a marketing person supply chain help and customer support please.', 'Small habits compound into something very large over time.', 'Pick one metric and protect it from everything around you.', 'Never confuse busy with progress forward.', 'Keep the standard high and ship it anyway today.'], 0.35, 3.5);
    const duration = Math.ceil(plain[plain.length - 1]!.end + 2);
    expect(planSectionMarkers({words: plain, outputDurationSec: duration, hookEndSec: 0, taken: [], spokenOrdinalOnly: true})).toEqual([]);
    expect(planSectionMarkers({words: plain, outputDurationSec: duration, hookEndSec: 0, taken: []}).length).toBeGreaterThan(0); // legacy numbering stays available to unit tests
    const spoken = timed(['Most teams choose speed.', 'Number two is market size and why it matters most.', 'Small habits compound into something very large over time.', 'Step 3 is to pick one metric and protect it from everything.', 'Never confuse busy with progress forward.', 'Keep the standard high and ship it anyway today.'], 0.35, 3.5);
    const markers = planSectionMarkers({words: spoken, outputDurationSec: Math.ceil(spoken[spoken.length - 1]!.end + 2), hookEndSec: 0, taken: [], spokenOrdinalOnly: true});
    expect(markers.length).toBeGreaterThanOrEqual(1);
    for (const marker of markers) expect(marker.label).toMatch(/^0[23] — /);
  });
  it('the fill passes spokenOrdinalOnly unless explicitly allowed (source pin)', () => {
    expect(read('./polishDensityFill.ts')).toContain('spokenOrdinalOnly: !input.allowUnspokenOrdinals');
  });
  it('a list sentence without "number one / first" seeds no StampTitle, and no stamp 01 anywhere', () => {
    const words = timed(['Today and I have a choice between two options that matter.', 'Marketing person supply chain customer and a business developer help.', 'Small habits compound into something very large over time.', 'Then keep the standard high and ship it anyway today.'], 0.28, 4.2);
    const seed = seedLibraryGraphics({words, outputDurationSec: 40, lookId: remapped.id, explainPlates: true});
    expect(Object.values(seed.compositions)).not.toContain('StampTitle');
    for (const graphic of seed.raw.graphics) expect(JSON.parse(graphic.contentJson).stamp).toBeUndefined();
  });
});

describe('WP11A E) curve is a spice', () => {
  it('isEditorialText: stop / filler kickers are not editorial', () => {
    expect(isEditorialText('Today and I')).toBe(false);
    expect(isEditorialText('and the')).toBe(false);
    expect(isEditorialText('Hire experts')).toBe(true);
    expect(isEditorialText('Biggest mistake')).toBe(true);
  });
  const open = (sentence: string) => {
    const words = timed([sentence, 'You should always hire the expert and trust their advice.'], 0.28, 3);
    return JSON.parse(seedLibraryGraphics({words, outputDurationSec: 30, lookId: remapped.id, explainPlates: true}).raw.graphics[0]!.contentJson) as Record<string, unknown>;
  };
  it('"today and I have a choice between two ..." is not curved but keeps its punch-word accent', () => {
    const content = open('Today and I have a choice between two options that could change everything for the company');
    expect(content.curve).toBe(false);
    expect(String(content.accent).toLowerCase()).toBe('choice');
    expect(resolveLibraryGraphic(brief({openTitle: content.openTitle as string, kicker: content.kicker as string, accent: content.accent as string, curve: false}))!.props.curve).toBe(false);
  });
  it('an emphatic kicker keeps the arc (no curve flag)', () => {
    const content = open('Biggest mistakes founders make when they hire their first employees without any process');
    expect(content.curve).toBeUndefined();
    expect(resolveLibraryGraphic(brief({openTitle: 'when they hire their first employees', kicker: 'Biggest mistakes'}))!.props.curve).toBeUndefined();
  });
  it('OpenPlate draws straight FitText when curve is false (source pin)', () => {
    const source = read('../../../../remotion/src/motion/compositions/OpenPlate.tsx');
    expect(source).toContain('curve ? <CurvedText');
    expect(source).toContain('curve = true');
  });
});

describe('WP11A F) icons on list plates', () => {
  it('label -> icon mappings (stems), none when unsure', () => {
    expect(iconForLabel('lawyer')).toBe('briefcase');
    expect(iconForLabel('marketing person')).toBe('megaphone');
    expect(iconForLabel('supply chain')).toBe('truck');
    expect(iconForLabel('customer')).toBe('users');
    expect(iconForLabel('AI')).toBe('bot');
    expect(iconForLabel('banana')).toBeNull();
    expect(iconsForLabels(['lawyer', 'banana'])).toBeNull();
    expect(iconsForLabels(['lawyer', 'customer'])).toEqual(['briefcase', 'users']);
  });
  it('the server allowlist equals the toolkit ICONS keys (Lucide only, no urls)', () => {
    const media = read('../../../../remotion/src/motion/components/Media.tsx');
    const block = media.slice(media.indexOf('const ICONS = {'), media.indexOf('export const ICON_NAMES'));
    const names = [...block.matchAll(/^\s{2}(?:'([a-z-]+)'|([a-z]+)):/gm)].map(match => match[1] ?? match[2]!);
    expect([...ICON_ALLOWLIST].sort()).toEqual([...new Set(names)].sort());
    expect(read('../motionDirector/libraryRegistry.ts')).not.toMatch(/https?:\/\/|fetch\(/);
  });
  it('registry: parallel icons reach TopicPills and ProcessSteps; unknown names are dropped; StatHighlight takes an icon', () => {
    const pills = resolveLibraryGraphic(brief({items: ['lawyer', 'customer'], icons: ['briefcase', 'http://x/y.svg']}, 'overlay'))!;
    expect(pills.props.items).toEqual([{label: 'lawyer', icon: 'briefcase'}, {label: 'customer'}]);
    const steps = resolveLibraryGraphic(brief({steps: ['write', 'review', 'ship'], icons: ['file-text', 'check', 'rocket']}))!;
    expect((steps.props.steps as Array<{icon?: string}>).map(step => step.icon)).toEqual(['file-text', 'check', 'rocket']);
    expect(resolveLibraryGraphic(brief({value: {to: 85, suffix: '%'}, label: 'of customers', icon: 'users'}))!.props.icon).toBe('users');
  });
  it('icon names are not words: the grounding rule ignores icon / icons keys', () => {
    expect(generatedGraphicIsGrounded({props: {content: {items: ['lawyer'], icons: ['briefcase']}}}, 'i would hire a lawyer')).toBe(true);
    expect(generatedGraphicIsGrounded({props: {content: {items: ['lawyer'], icon: 'briefcase'}}}, 'i would hire a lawyer')).toBe(true);
    expect(generatedGraphicIsGrounded({props: {content: {items: ['plumber']}}}, 'i would hire a lawyer')).toBe(false);
  });
  it('TopicPills renders the icon (Badge icon prop) from the item', () => {
    expect(read('../../../../remotion/src/motion/compositions/TopicPills.tsx')).toContain('icon={item.icon}');
  });
});

describe('WP11A D) short-form palette', () => {
  const navy = {primary: '#1E3A8A', secondary: '#3B82F6', background: '#0B1B3A', surface: '#12285A', text: '#E8EEFF', mutedText: '#8FA3D1', accent: '#4ADE80'};
  it('a surface that does not stand off the ground becomes bright paper with ground-coloured ink (strong chips), still readable', () => {
    const palette = platePalette({...navy, surface: '#0E2147'});
    expect(plateContrast(palette.paper, palette.ground)).toBeGreaterThanOrEqual(7);
    expect(plateContrast(palette.paperInk, palette.paper)).toBeGreaterThanOrEqual(4.5);
    expect(isKaraokeCyan(palette.paper)).toBe(false);
  });
  it('a surface that already stands off the ground is kept', () => {
    const light = platePalette({...navy, surface: '#FFFFFF'});
    expect(light.paper).toBe('#FFFFFF');
  });
  it('the deep end of the ground gradient goes toward black on dark grounds (no muddy mid navy)', () => {
    const dark = platePalette(navy);
    expect(plateContrast(dark.groundDeep, '#000000')).toBeLessThan(plateContrast(dark.ground, '#000000'));
  });
  it('markers still read on the ground and are never karaoke cyan; pure theme-in colours-out (no niche branching)', () => {
    const palette = platePalette(navy);
    expect(plateContrast(palette.marker, palette.ground)).toBeGreaterThanOrEqual(3);
    expect(isKaraokeCyan(palette.marker)).toBe(false);
    expect(read('../../../../remotion/src/motion/palette.ts')).not.toMatch(/contentType|content_type|niche|mood/i);
  });
  it('the article plate has no sidebar chrome (reads as a clipping, not a dashboard) and takes the passage prop the registry sends', () => {
    const wiki = read('../../../../remotion/src/motion/compositions/WikiCallout.tsx');
    expect(wiki).not.toContain('bars.map');
    expect(wiki).toContain('passage ?? body');
    expect(resolveLibraryGraphic(brief({passage: 'The standard is reviewed every quarter', highlight: ['standard']}))!.props).toHaveProperty('passage');
  });
});
