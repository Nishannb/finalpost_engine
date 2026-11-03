/**
 * WP10A: top-tier plate craft. Open / thumbnail plate, theme-derived plate palette (no neon default), CurvedText + MaskReveal in the library comps, a post / wiki callout with a dominant
 * highlighter, and craft plates preferred on the explain path. Offline: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {platePalette, plateContrast} from '../../../../remotion/src/motion/palette.ts';
import {defaultTheme} from '../../../../remotion/src/motion/theme.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {CRAFT_PLATES, highlightWordsOf, OPEN_PLATE_MAX_START_SEC, plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {LEAVE_THE_FACE_COMPOSITIONS} from './engagementCadence.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps} from './explainPlateGaps.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const motion = (file: string) => read(`../../../../remotion/src/motion/${file}`);
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};

const wordsOf = (sentences: string[], slotSec = 4) =>
  sentences.flatMap((sentence, index) => {
    const tokens = sentence.split(' ');
    const slot = 3.5 / tokens.length;
    return tokens.map((text, i) => ({text, start: Math.round((index * slotSec + i * slot) * 1000) / 1000, end: Math.round((index * slotSec + (i + 1) * slot) * 1000) / 1000}));
  });
const SENTENCES = [
  'Nobody reads the documentation anymore because clarity beats effort.',
  'Someone tweeted that nobody reads the documentation anymore.',
  'Pick one metric and protect it from everything else around you.',
  'Small habits compound into something very large over time.',
  'According to the wiki the standard is reviewed every single quarter.',
  'Never confuse being busy with making real progress forward.',
  'Write the plan down and share it with your whole team.',
  'Then keep the standard high and ship it anyway today.',
  'Start building something real with these tools right now.',
];
const WORDS = wordsOf(SENTENCES);
const DURATION = 36;
const transcript = WORDS.map(word => word.text).join(' ');
const seed = (over: Record<string, unknown> = {}) => seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true, ...over});
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'v', placement, content});

describe('WP10A 1) opening thumbnail plate', () => {
  it('the 36 s fixture gets an OpenPlate at the first spoken word (< 1.0 s) held ~2.4 s, with a verbatim title, arc kicker and accent word', () => {
    const result = seed();
    const first = result.raw.graphics[0]!;
    expect(result.compositions[first.id]).toBe('OpenPlate');
    expect(WORDS[first.anchorWordIndex]!.start).toBeLessThan(OPEN_PLATE_MAX_START_SEC);
    expect(first.placement).toBe('full_screen');
    expect(first.durationSeconds).toBeLessThanOrEqual(2.5);
    expect(result.openPlateId).toBe(first.id);
    const content = JSON.parse(first.contentJson) as Record<string, string>;
    for (const key of ['openTitle', 'kicker', 'accent']) expect(isGroundedInTranscript(content[key]!, transcript), key).toBe(true);
    expect(transcript.toLowerCase()).toContain(`${content.kicker} ${content.openTitle}`.toLowerCase());
    expect(content.openTitle!.toLowerCase()).toContain(content.accent!.toLowerCase());
  });
  it('"Number two ..." as the first line becomes the plate\'s ordinal (StampTitle-style chrome)', () => {
    const words = wordsOf(['Number two market size matters more than anything else.', ...SENTENCES.slice(1)]);
    const first = seedLibraryGraphics({words, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true}).raw.graphics[0]!;
    expect(JSON.parse(first.contentJson)).toMatchObject({stamp: '02 —'});
  });
  it('only on the explain path; the standard seed keeps its headline', () => {
    expect(Object.values(seed({explainPlates: false}).compositions)).not.toContain('OpenPlate');
  });
  it('registry: openTitle -> OpenPlate (opaque on a full screen, transparent on an overlay), checked before stamp + title', () => {
    const hit = resolveLibraryGraphic(brief({openTitle: 'Market size matters', kicker: 'Number two', stamp: '02 —', accent: 'matters'}))!;
    expect(hit.compositionId).toBe('OpenPlate');
    expect(hit.props).toEqual({title: 'Market size matters', kicker: 'Number two', stamp: '02 —', accent: 'matters', background: true});
    expect(resolveLibraryGraphic(brief({openTitle: 'Market size matters'}, 'overlay'))!.props.background).toBe(false);
    expect(resolveLibraryGraphic(brief({openTitle: 'x'.repeat(90)}))).toBeNull();
    expect(LEAVE_THE_FACE_COMPOSITIONS.has('OpenPlate')).toBe(true);
  });
  it('addLibrarySeeds over a hook title window: the open plate takes the hook window, warns polish_open:thumbnail_plate and reports its id; every other plate stays out of the hook window', () => {
    const result = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [{start: 0, end: 3, what: 'hook title'}], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    expect(result.warnings).toContain('polish_open:thumbnail_plate');
    expect(result.openPlateId).toBeDefined();
    const starts = result.director.graphics.map(graphic => graphic.start).sort((a, b) => a - b);
    expect(starts[0]!).toBeLessThan(1);
    expect(starts.slice(1).every(start => start >= 3 - 1e-9)).toBe(true);
    const plain = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [{start: 0, end: 3, what: 'hook title'}], captionBand: undefined as never, lookId: remapped.id});
    expect(plain.warnings).not.toContain('polish_open:thumbnail_plate');
    expect(plain.director.graphics.every(graphic => graphic.start >= 3 - 1e-9)).toBe(true);
  });
  it('wiring pins: the stage drops the stack hook only when the plate was delivered; the render path painting the plate is the library graphic track (hook renderer untouched)', () => {
    const stage = read('../motionDirector/index.ts');
    expect(stage).toContain("warnings.push('polish_open:hook_replaced_by_plate')");
    expect(stage).toContain('some(graphic => graphic.id === openPlateId)');
    expect(read('../../pipeline/analyzeVideo.ts')).toContain("if (motion.suppressHookTitle) broll.hookTitle = ''");
    expect(read('./brollPlanner.ts')).toContain('hookWindowFromDirection(direction, hookDurationSec)');
  });
});

describe('WP10A 2) intentional colour: theme in, colours out', () => {
  const themes = [
    {primary: '#FF3D2E', secondary: '#FF9F1C', background: '#101010', surface: '#1E1E1E', text: '#FFFFFF', mutedText: '#B0B0B0', accent: '#FFE600'},
    {primary: '#2F5BEA', secondary: '#12A594', background: '#F6F3EE', surface: '#FFFFFF', text: '#1B1B1F', mutedText: '#6B6B76', accent: '#E4572E'},
    {primary: '#C8A96A', secondary: '#6B7F8E', background: '#0C0F12', surface: '#171C21', text: '#F2F2F0', mutedText: '#9AA0A6', accent: '#E6C98B'},
    {primary: '#E58AA8', secondary: '#7FC8C0', background: '#F7EEF3', surface: '#FFFFFF', text: '#2B2233', mutedText: '#6F6380', accent: '#E8E8E8'},
  ];
  it.each(themes.map((theme, i) => [i, theme] as const))('theme %i: ink, marker, marker ink and paper ink are all readable on what they sit on', (_i, theme) => {
    const palette = platePalette(theme);
    expect(palette.ground).toBe(theme.background);
    expect(plateContrast(palette.ink, palette.ground)).toBeGreaterThanOrEqual(4.5);
    expect(plateContrast(palette.marker, palette.ground)).toBeGreaterThanOrEqual(3);
    expect(plateContrast(palette.markerInk, palette.marker)).toBeGreaterThanOrEqual(4.5);
    expect(plateContrast(palette.paperInk, palette.paper)).toBeGreaterThanOrEqual(4.5);
  });
  it('different themes give different palettes; the theme\'s own accent is the marker when it reads (no fixed neon)', () => {
    expect(platePalette(themes[0]!).marker).toBe('#FFE600');
    expect(platePalette(themes[1]!).marker).toBe('#E4572E');
    expect(new Set(themes.map(theme => platePalette(theme).groundDeep)).size).toBe(themes.length);
  });
  it('an unreadable accent falls back to another theme colour, never to a constant', () => {
    expect(platePalette(themes[3]!).marker).not.toBe('#E8E8E8');
    expect(platePalette({...themes[0]!, accent: '#101010'}).marker).not.toBe('#101010');
  });
  it('the motion default theme is no longer cyan', () => {
    expect(defaultTheme.secondary.toUpperCase()).not.toBe('#22D3EE');
  });
  it('source pin: plate comps + palette take colours from the theme; no cyan / teal literals, no content-type / niche / mood branching', () => {
    for (const file of ['palette.ts', 'components/Plate.tsx', 'compositions/OpenPlate.tsx', 'compositions/StampTitle.tsx', 'compositions/TweetCard.tsx', 'compositions/FullscreenStatement.tsx', 'compositions/QuoteCallout.tsx', 'compositions/BigKineticHeadline.tsx']) {
      const source = motion(file);
      expect(source, file).not.toMatch(/#(?:22D3EE|00E5FF|2DD4BF|38BDF8|06B6D4|14B8A6)/i);
      expect(source, file).not.toMatch(/contentType|content_type|niche|mood|\bcyan\b|\bteal\b/i);
    }
    for (const file of ['compositions/OpenPlate.tsx', 'compositions/StampTitle.tsx', 'compositions/TweetCard.tsx', 'compositions/FullscreenStatement.tsx', 'compositions/QuoteCallout.tsx', 'compositions/BigKineticHeadline.tsx']) {
      expect(motion(file), file).toContain('usePlatePalette');
    }
  });
});

describe('WP10A 3) craft wired into the compositions', () => {
  it('OpenPlate uses CurvedText (arc kicker) and MaskReveal (masked title); StampTitle uses MaskReveal', () => {
    const open = motion('compositions/OpenPlate.tsx');
    expect(open).toMatch(/import \{CurvedText\} from '..\/components\/CurvedText'/);
    expect(open).toMatch(/import \{MaskReveal\} from '..\/components\/MaskedText'/);
    expect(open).toContain('<CurvedText');
    expect(open).toContain('<MaskReveal');
    expect(motion('compositions/StampTitle.tsx')).toMatch(/import \{MaskReveal\} from '..\/components\/MaskedText'/);
    expect(motion('compositions/StampTitle.tsx')).toContain('<MaskReveal');
  });
  it('the motion index exports OpenPlate, the palette and the compositions map; the README documents it', () => {
    const index = motion('index.ts');
    expect(index).toMatch(/export \{OpenPlate\b/);
    expect(index).toMatch(/export const compositions = \{[^}]*\bOpenPlate\b/);
    expect(index).toContain('platePalette');
    expect(motion('README.md')).toContain('| `OpenPlate` |');
  });
  it.each([
    ['OpenPlate', {openTitle: 'Market size matters more', kicker: 'Number two', stamp: '02 —', accent: 'matters'}],
    ['StampTitle', {stamp: '02 —', title: 'Market size matters', subtitle: 'more than anything'}],
    ['TweetCard', {body: 'Nobody reads the documentation anymore', name: 'Ada', handle: '@ada', highlight: ['Nobody reads', 'documentation']}],
    ['FullscreenStatement', {statement: 'Keep the standard high', highlight: ['standard']}],
  ])('%s: the generated module passes worker validation (contract, typecheck, compile)', async (id, content) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe(id);
    const {report, compiled} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
});

describe('WP10A 4) tweet / wiki screenshot callout with a dominant highlighter', () => {
  it('TweetCard props carry highlight through the registry; the card paints a solid marker (opacity 1) with flipped ink, on a paper surface with capture chrome', () => {
    const hit = resolveLibraryGraphic(brief({body: 'Ship small things every day', highlight: ['Ship small']}))!;
    expect(hit).toMatchObject({compositionId: 'TweetCard', props: {highlight: ['Ship small']}});
    const card = motion('compositions/TweetCard.tsx');
    for (const needle of ['highlightStyle="marker"', 'highlightOpacity={1}', 'highlightInk={palette.markerInk}', 'palette.paper', 'slice(0, 3)']) expect(card, needle).toContain(needle);
    const text = motion('components/Text.tsx');
    expect(text).toContain('highlightInk');
    expect(text).toContain('props.highlightOpacity ?? 0.9');
  });
  it('highlightWordsOf picks 1-2 long content words, each a substring of the body, in reading order', () => {
    const body = 'nobody reads the documentation anymore';
    const picked = highlightWordsOf(body);
    expect(picked.length).toBeGreaterThanOrEqual(1);
    expect(picked.length).toBeLessThanOrEqual(2);
    for (const word of picked) expect(body).toContain(word);
    expect(picked.map(word => body.indexOf(word))).toEqual([...picked.map(word => body.indexOf(word))].sort((a, b) => a - b));
  });
  it.each([
    [1, 'nobody reads the documentation anymore'],
  ])('sentence %i (tweeted cue) -> TweetCard {body, highlight} with grounded words', (index, body) => {
    const shape = plateShapeAt(WORDS, index * 4 + 0.2)!;
    expect(shape.composition).toBe('TweetCard');
    expect((shape.content.body as string).toLowerCase()).toBe(body.toLowerCase());
    const highlight = shape.content.highlight as string[];
    expect(highlight.length).toBeGreaterThanOrEqual(1);
    for (const word of highlight) {
      expect(shape.content.body as string).toContain(word);
      expect(isGroundedInTranscript(word, transcript)).toBe(true);
    }
    expect(Object.keys(shape.content).sort()).toEqual(['body', 'highlight']); // no invented name / handle
  });
  // WP52: a maxim ("Never confuse being busy ...") is NOT a tweet without a post / tweet / handle cue.
  it('WP52: sentence 5 (a bare maxim) is no longer a TweetCard', () => {
    expect(plateShapeAt(WORDS, 5 * 4 + 0.2)?.composition).not.toBe('TweetCard');
  });
  it('seeds emit the callout, and the gap briefs build the same shape (description says so, resolves from the library)', () => {
    expect(Object.values(seed().compositions).some(id => id === 'TweetCard' || id === 'WikiCallout')).toBe(true); // WP10B: an article cue is now a WikiCallout
    const briefs = buildClaudePlateBriefs(detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: []}), WORDS, 3);
    const posts = briefs.filter(item => 'highlight' in JSON.parse(item.contentJson));
    expect(posts.length).toBeGreaterThanOrEqual(1);
    for (const item of posts) {
      const hit = resolveLibraryGraphic({goal: item.goal, visualDescription: item.visualDescription, placement: item.placement, content: JSON.parse(item.contentJson)});
      expect(hit?.compositionId).toBe('highlight' in JSON.parse(item.contentJson) && !('passage' in JSON.parse(item.contentJson)) ? 'TweetCard' : 'WikiCallout');
    }
  });
});

describe('WP10A 5) the explain-plate mixer prefers craft plates', () => {
  it('CRAFT_PLATES are the open / stamp / post-card plates', () => {
    expect([...CRAFT_PLATES].sort()).toEqual(['NewspaperCallout', 'OpenPlate', 'StampTitle', 'TweetCard', 'WikiCallout']); // WP10B added WikiCallout, WP13D NewspaperCallout
  });
  it('with a quotable claim and a plain content line competing in one window, the post card with highlighter wins over a quote / statement card', () => {
    const words = wordsOf([
      'Stop scrolling and listen closely to this one idea today.',
      'Filler words do not carry any meaning at all here.',
      'She posted that never confuse being busy with making real progress forward.',
      'Practice builds confidence slowly through repeated attempts.',
      'Then keep the standard high and ship it anyway today.',
      'Start building something real with these tools right now.',
    ]);
    const result = seedLibraryGraphics({words, outputDurationSec: 24, lookId: remapped.id, explainPlates: true});
    const comps = Object.values(result.compositions);
    expect(comps).toContain('TweetCard');
    const claimWindow = result.raw.graphics.find(graphic => (words[graphic.anchorWordIndex]?.start ?? 0) >= 8 && (words[graphic.anchorWordIndex]?.start ?? 0) < 16)!;
    expect(result.compositions[claimWindow.id]).toBe('TweetCard');
    expect(JSON.parse(claimWindow.contentJson).highlight.length).toBeGreaterThanOrEqual(1);
  });
  it('still library-first and transcript-grounded: every seed string is spoken, and the seeder imports no model, env or network', () => {
    for (const graphic of seed().raw.graphics) {
      const content = JSON.parse(graphic.contentJson) as Record<string, unknown>;
      for (const value of Object.entries(content).filter(([key]) => key !== 'recipeId').map(([, item]) => item).flat()) if (typeof value === 'string' && !/^0\d —$/.test(value)) expect(isGroundedInTranscript(value, transcript), value).toBe(true);
    }
    const source = read('../motionDirector/transcriptLibrarySeed.ts');
    expect(source).not.toMatch(/process\.env|fetch\(|anthropic|import .*logger/i);
    expect(source).not.toMatch(/contentType|content_type|niche/);
  });
});
