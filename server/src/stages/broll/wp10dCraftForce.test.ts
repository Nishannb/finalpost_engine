/**
 * WP10D: force craft on live polish. A long first sentence still gets the OpenPlate (sliced verbatim run), claim / advice speech seeds a TweetCard or WikiCallout, and plate colours never settle on karaoke cyan.
 * Offline: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {isKaraokeCyan, platePalette} from '../../../../remotion/src/motion/palette.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {OPEN_PLATE_MAX_START_SEC, plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};

// Mirrors the WP10C shape: a 28-word first sentence from 0 s (no sentence break until 28 words), then advice / hire / expert / choice speech with no "tweeted" or "wikipedia".
const FIRST = 'If you are building a company right now the single biggest decision you will make is who you hire and who you listen to when the pressure arrives and nobody is looking';
const REST = [
  'She posted that you should always hire the expert and trust their advice.',
  'According to the study the right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal.',
  'Small habits compound into something very large over time.',
  'Then keep the standard high and ship it anyway today.',
  'Start building something real with these tools right now.',
];
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
const WORDS = timed([FIRST, ...REST]);
const DURATION = Math.ceil(WORDS[WORDS.length - 1]!.end + 1);
const transcript = WORDS.map(word => word.text).join(' ');
const seed = (over: Record<string, unknown> = {}) => seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true, ...over});

describe('WP10D 1) OpenPlate on a long first sentence', () => {
  it('the fixture really has a 28-word first sentence starting at 0 s', () => {
    expect(FIRST.split(' ').length).toBeGreaterThanOrEqual(28);
    expect(WORDS[0]!.start).toBe(0);
  });
  it('emits an OpenPlate at the first word, held ~2.4 s, from a contiguous verbatim run of the sentence start', () => {
    const result = seed();
    const first = result.raw.graphics[0]!;
    expect(result.compositions[first.id]).toBe('OpenPlate');
    expect(WORDS[first.anchorWordIndex]!.start).toBeLessThan(OPEN_PLATE_MAX_START_SEC);
    expect(first.durationSeconds).toBeLessThanOrEqual(2.5);
    expect(result.openPlateId).toBe(first.id);
    const content = JSON.parse(first.contentJson) as Record<string, string>;
    const sliced = `${content.kicker} ${content.openTitle}`.toLowerCase();
    expect(FIRST.toLowerCase().startsWith(sliced)).toBe(true);
    expect(content.openTitle!.length).toBeLessThanOrEqual(64);
    for (const key of ['openTitle', 'kicker', 'accent']) expect(isGroundedInTranscript(content[key]!, transcript), key).toBe(true);
  });
  it('beats VsClaim / TopicPills for the open window even when the first sentence is a contrast', () => {
    const contrast = timed(['Most teams choose between speed and quality every single week and then regret whichever side they pick once the quarter ends badly for everyone involved', ...REST]);
    const result = seedLibraryGraphics({words: contrast, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true});
    expect(result.compositions[result.raw.graphics[0]!.id]).toBe('OpenPlate');
  });
  it('addLibrarySeeds over a hook title window: polish_open:thumbnail_plate fires and the id is reported (the stage then replaces the hook)', () => {
    const result = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: DURATION, occupied: [{start: 0, end: 3, what: 'hook title'}], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    expect(result.warnings).toContain('polish_open:thumbnail_plate');
    expect(result.openPlateId).toBeDefined();
    expect(read('../motionDirector/index.ts')).toContain("warnings.push('polish_open:hook_replaced_by_plate')");
  });
  it('still only on the explain path', () => {
    expect(Object.values(seed({explainPlates: false}).compositions)).not.toContain('OpenPlate');
  });
});

describe('WP10D 2) callouts on claim / advice speech', () => {
  it('advice, hire, choice lines are matched; short -> TweetCard, long (13-24 words) -> WikiCallout; verbatim and highlighted', () => {
    const at = (index: number) => {
      const starts = WORDS.map((word, i) => (i === 0 || WORDS[i]!.start - WORDS[i - 1]!.end > 0.8 ? word.start : -1)).filter(t => t >= 0);
      return plateShapeAt(WORDS, starts[index]! + 0.05);
    };
    const short = at(1)!;
    expect(short.composition).toBe('TweetCard');
    expect((short.content.body as string).toLowerCase()).toContain('hire the expert');
    const long = at(2)!;
    expect(long.composition).toBe('WikiCallout');
    for (const shape of [short, long]) {
      const highlight = shape.content.highlight as string[];
      expect(highlight.length).toBeGreaterThanOrEqual(1);
      const body = (shape.content.body ?? shape.content.passage) as string;
      for (const word of highlight) expect(body).toContain(word);
      expect(isGroundedInTranscript(body, transcript)).toBe(true);
    }
  });
  it('the jensen-like transcript seeds an OpenPlate AND at least one TweetCard / WikiCallout', () => {
    const comps = Object.values(seed().compositions);
    expect(comps).toContain('OpenPlate');
    expect(comps.some(id => id === 'TweetCard' || id === 'WikiCallout')).toBe(true);
  });
  it('guarantee: even when the cap is full of other plates, one callout is forced in (replacing the lowest-ranked non-open plate), and it resolves from the library', () => {
    const crowded = timed([FIRST, 'Roughly 85 percent of projects slip without a clear owner.', 'We shipped 40 features in spring and 12 bugs in summer.', 'She posted that you should always hire the expert and trust their advice.', 'Most teams choose between speed and quality every single week.', 'Then keep the standard high and ship it anyway today.'], 0.28, 4.5);
    const result = seedLibraryGraphics({words: crowded, outputDurationSec: Math.ceil(crowded[crowded.length - 1]!.end + 1), lookId: remapped.id, explainPlates: true});
    const comps = Object.values(result.compositions);
    expect(comps).toContain('OpenPlate');
    expect(comps.some(id => id === 'TweetCard' || id === 'WikiCallout')).toBe(true);
    expect(result.raw.graphics.length).toBeLessThanOrEqual(result.limit);
    for (const graphic of result.raw.graphics) {
      expect(resolveLibraryGraphic({goal: graphic.goal, visualDescription: graphic.visualDescription, placement: graphic.placement, content: JSON.parse(graphic.contentJson)})?.compositionId, graphic.id).toBe(result.compositions[graphic.id]);
    }
  });
  it('no cue, no callout: a transcript without any claim / advice / article language is not forced to invent one', () => {
    const plain = timed(['Pick one metric and protect it from everything else around you now', 'Small habits compound into something very large over time', 'Start building something real with these tools right now']);
    const result = seedLibraryGraphics({words: plain, outputDurationSec: 30, lookId: remapped.id, explainPlates: true});
    expect(Object.values(result.compositions).some(id => id === 'WikiCallout')).toBe(false);
  });
  it('source pin: no niche / content-type branching and no model or network in the seeder', () => {
    const source = read('../motionDirector/transcriptLibrarySeed.ts');
    expect(source).not.toMatch(/contentType|content_type|niche|process\.env|fetch\(|anthropic/i);
  });
});

describe('WP10D 3) plate identity is not karaoke cyan', () => {
  const base = {primary: '#6366F1', secondary: '#A78BFA', background: '#0B1020', surface: '#161D33', text: '#F8FAFC', mutedText: '#94A3B8', accent: '#FACC15'};
  it('isKaraokeCyan flags the neon cyan / teal / sky band and nothing warm or neutral', () => {
    for (const cyan of ['#00E5FF', '#22D3EE', '#2DD4BF', '#38BDF8', '#00D8F0']) expect(isKaraokeCyan(cyan), cyan).toBe(true);
    for (const other of ['#FFE600', '#FF3D2E', '#6366F1', '#FFFFFF', '#101010', '#E4572E', '#7FA66B']) expect(isKaraokeCyan(other), other).toBe(false);
  });
  it('accent #00E5FF is never the marker: the next readable theme colour (primary, secondary, then ink) is', () => {
    expect(platePalette({...base, accent: '#00E5FF'}).marker).not.toBe('#00E5FF');
    expect(platePalette({...base, accent: '#00E5FF'}).marker).toBe('#6366F1');
    for (const accent of ['#00E5FF', '#22D3EE', '#38BDF8', '#2DD4BF']) expect(isKaraokeCyan(platePalette({...base, accent}).marker), accent).toBe(false);
  });
  it('an all-cyan theme falls back to ink, not cyan; the ground tint is never cyan either', () => {
    const allCyan = {...base, primary: '#2DD4BF', secondary: '#38BDF8', accent: '#00E5FF', background: '#0B1B2B', surface: '#12283D'};
    const palette = platePalette(allCyan);
    expect(isKaraokeCyan(palette.marker)).toBe(false);
    expect(palette.marker).toBe(palette.ink);
    expect(isKaraokeCyan(palette.groundDeep)).toBe(false);
  });
  it('a non-cyan accent is still used as is (identity comes from the theme), and contrast guarantees hold', () => {
    const palette = platePalette(base);
    expect(palette.marker).toBe('#FACC15');
    expect(palette.markerInk).not.toBe(palette.marker);
  });
  it('source pin: the rule is a colour test only (hue / saturation / lightness): no content-type, niche or mood in palette.ts', () => {
    const source = read('../../../../remotion/src/motion/palette.ts');
    expect(source).toContain('isKaraokeCyan');
    expect(source).not.toMatch(/contentType|content_type|niche|mood/i);
  });
});
