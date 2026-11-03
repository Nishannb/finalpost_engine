/**
 * WP12B: the speech-synced "walking" highlighter on article / post plates, WikiCallout preferred over QuoteCallout for claim / list / money-in-prose speech, and the passage-first article layout. Offline.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {activeSpanAt, cleanSchedule, scheduleFrames, visitedWordsAt} from '../../../../remotion/src/motion/highlightSchedule.ts';
import {platePalette} from '../../../../remotion/src/motion/palette.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {libraryGraphicSource, resolveLibraryGraphic, scheduleProp} from '../motionDirector/libraryRegistry.ts';
import {highlightScheduleFor, plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const timed = (sentences: string[], perWord = 0.3, gap = 1.2) => {
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
const brief = (content: Record<string, unknown>) => ({goal: 'g', visualDescription: 'v', placement: 'full_screen', content});

const FUND = 'According to the report Fireworks AI just raised a round and the startup is now valued at 1.5 billion dollars after investors piled in.';
const FUND_WORDS = timed(['Today and I have a choice between two options that matter for the company I am building right now', FUND, 'Then keep the standard high and ship it anyway today.'], 0.3, 4.5);

describe('WP12B 1) speech-synced highlighter', () => {
  it('pure schedule helpers: active span matches the spoken word mid-window; before, between and after the spans fall back cleanly', () => {
    const schedule = [{word: 'Fireworks', fromSec: 0.2, toSec: 0.8}, {word: 'raised', fromSec: 1.5, toSec: 2}, {word: 'billion', fromSec: 3, toSec: 3.6}];
    expect(activeSpanAt(schedule, 0.5)?.word).toBe('Fireworks');
    expect(activeSpanAt(schedule, 1.7)?.word).toBe('raised');
    expect(activeSpanAt(schedule, 3.2)?.word).toBe('billion');
    expect(activeSpanAt(schedule, 0.05)).toBeNull(); // before the first
    expect(activeSpanAt(schedule, 1.0)).toBeNull(); // between spans
    expect(activeSpanAt(schedule, 9)).toBeNull(); // after the last
    expect(activeSpanAt(undefined, 1)).toBeNull();
    expect(visitedWordsAt(schedule, 1.6)).toEqual(['Fireworks', 'raised']);
    expect(visitedWordsAt(schedule, 0)).toEqual([]);
    expect(cleanSchedule([{word: '  ', fromSec: 0, toSec: 1}, {word: 'x', fromSec: 2, toSec: 1}, {word: 'ok', fromSec: 0, toSec: 1}]).map(span => span.word)).toEqual(['ok']);
  });
  it('scheduleFrames: bars start at the spoken frame and dim when the NEXT word begins; the last never dims; empty = static', () => {
    const frames = scheduleFrames([{word: 'Fireworks', fromSec: 0.2, toSec: 0.8}, {word: 'raised.', fromSec: 1.5, toSec: 2}], 30);
    expect(frames.words).toEqual(['Fireworks', 'raised.']);
    expect(frames.starts).toEqual({fireworks: 6, raised: 45});
    expect(frames.ends).toEqual({fireworks: 45});
    expect(scheduleFrames(undefined, 30).words).toEqual([]);
    expect(scheduleFrames([], 30).words).toEqual([]);
  });
  it('the seed locates the passage verbatim in the spoken words and emits >= 2 spans, relative to the plate start, with whole-word stops that are spoken at those times', () => {
    const passage = 'Fireworks AI just raised a round and the startup is now valued at 1.5 billion dollars';
    const fromWord = FUND_WORDS.findIndex(word => word.text === 'Fireworks');
    const windowStart = FUND_WORDS[fromWord]!.start;
    const schedule = highlightScheduleFor(passage, FUND_WORDS, fromWord, windowStart, 4);
    expect(schedule.length).toBeGreaterThanOrEqual(2);
    expect(schedule.length).toBeLessThanOrEqual(6);
    for (const span of schedule) {
      expect(passage.split(/\s+/).map(token => token.replace(/[^\p{L}\p{N}.]+/gu, ''))).toContain(span.word);
      const spoken = FUND_WORDS.find(word => Math.abs(word.start - windowStart - span.fromSec) < 0.002)!;
      expect(spoken.text.replace(/[^\p{L}\p{N}.]+/gu, '')).toBe(span.word);
      expect(span.toSec).toBeGreaterThan(span.fromSec);
    }
    expect(schedule.map(span => span.fromSec)).toEqual([...schedule.map(span => span.fromSec)].sort((a, b) => a - b));
  });
  it('a passage that is not in the speech verbatim gets no schedule (the static highlight stays)', () => {
    expect(highlightScheduleFor('Fireworks AI quietly vanished overnight', FUND_WORDS, 0, 0, 4)).toEqual([]);
    expect(highlightScheduleFor('Then keep', FUND_WORDS, 0, 0, 4)).toEqual([]); // fewer than 2 stops
  });
  it('seeded WikiCallout / TweetCard carry highlightSchedule next to the static highlight; the registry keeps only whole-word, ordered spans; all words are grounded', () => {
    const seed = seedLibraryGraphics({words: FUND_WORDS, outputDurationSec: 40, lookId: remapped.id, explainPlates: true});
    const wiki = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'WikiCallout');
    expect(wiki).toBeDefined();
    const content = JSON.parse(wiki!.contentJson) as {passage: string; highlight: string[]; highlightSchedule: Array<{word: string; fromSec: number; toSec: number}>};
    expect(content.highlight.length).toBeGreaterThanOrEqual(1);
    expect(content.highlightSchedule.length).toBeGreaterThanOrEqual(2);
    const transcript = FUND_WORDS.map(word => word.text).join(' ');
    for (const span of content.highlightSchedule) expect(isGroundedInTranscript(span.word, transcript)).toBe(true);
    const hit = resolveLibraryGraphic({goal: wiki!.goal, visualDescription: wiki!.visualDescription, placement: wiki!.placement, content})!;
    expect(hit.compositionId).toBe('WikiCallout');
    expect((hit.props.highlightSchedule as unknown[]).length).toBe(content.highlightSchedule.length);
    // mid-window: the active highlight is the spoken word at that time
    const mid = content.highlightSchedule[1]!;
    expect(activeSpanAt(hit.props.highlightSchedule as never, (mid.fromSec + mid.toSec) / 2)?.word).toBe(mid.word);
  });
  it('scheduleProp drops fragments, out-of-order and bad spans; one valid span is not a walk', () => {
    const text = 'The accountant raised a billion dollars';
    expect(scheduleProp(text, [{word: 'account', fromSec: 0, toSec: 1}, {word: 'raised', fromSec: 1, toSec: 2}])).toEqual({});
    expect(scheduleProp(text, [{word: 'accountant', fromSec: 0, toSec: 1}, {word: 'raised', fromSec: 1, toSec: 2}, {word: 'billion', fromSec: 0.5, toSec: 1}])).toEqual({
      highlightSchedule: [{word: 'accountant', fromSec: 0, toSec: 1}, {word: 'raised', fromSec: 1, toSec: 2}],
    });
    expect(scheduleProp(text, [{word: 'raised', fromSec: 2, toSec: 1}, {word: 'billion', fromSec: -1, toSec: 1}])).toEqual({});
    expect(scheduleProp(text, 'nope')).toEqual({});
    expect(resolveLibraryGraphic(brief({passage: text, highlight: ['billion']}))!.props.highlightSchedule).toBeUndefined();
  });
  it('wiring pins: the comps schedule through KineticText start / end frames, with the static highlight as fallback', () => {
    for (const name of ['WikiCallout', 'TweetCard']) {
      const source = read(`../../../../remotion/src/motion/compositions/${name}.tsx`);
      expect(source, name).toContain('scheduleFrames(highlightSchedule, fps)');
      expect(source, name).toContain('highlightStartFrames={walk.words.length > 0 ? walk.starts : undefined}');
      expect(source, name).toContain('walk.words.length > 0 ? walk.words.slice(0, 8) : (highlight ?? []).slice(0, 3)');
    }
    const text = read('../../../../remotion/src/motion/components/Text.tsx');
    expect(text).toContain('props.highlightStartFrames?.[normalize(word)] ?? wordStart + 2');
    expect(text).toContain('props.highlightEndFrames');
  });
  it.each([
    ['WikiCallout', {passage: 'Fireworks AI just raised a round and is valued at 1.5 billion dollars', highlight: ['raised'], highlightSchedule: [{word: 'Fireworks', fromSec: 0.2, toSec: 0.8}, {word: 'raised', fromSec: 1.5, toSec: 2}, {word: 'billion', fromSec: 3, toSec: 3.6}]}],
    ['TweetCard', {body: 'Nobody reads the documentation anymore', highlight: ['documentation'], highlightSchedule: [{word: 'Nobody', fromSec: 0, toSec: 0.5}, {word: 'documentation', fromSec: 1, toSec: 1.6}]}],
  ])('%s with a schedule passes worker validation (contract, typecheck, compile)', async (id, content) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe(id);
    expect(hit.props.highlightSchedule).toBeDefined();
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
});

describe('WP12B 2) WikiCallout beats QuoteCallout for claim / list / money speech', () => {
  const shape = (sentence: string) => plateShapeAt(timed([sentence]), 0.1);
  it('WP52: money / funding prose, an enumeration in prose and a long claim WITHOUT an article cue are no WikiCallout; the cued version is', () => {
    for (const sentence of ['Fireworks AI just raised a huge round and investors are piling in at a valuation nobody expected last year.', 'We work with lawyers, marketers, accountants, engineers and designers across the company every day.', 'You should always hire the expert and trust their advice when the stakes are high and the team is watching closely.']) {
      expect(shape(sentence)?.composition, sentence).not.toBe('WikiCallout');
    }
    const cued = shape('According to the report Fireworks AI just raised a huge round and investors are piling in at a valuation nobody expected last year.')!;
    expect(cued.composition).toBe('WikiCallout');
    expect((cued.content.highlight as string[]).length).toBeGreaterThanOrEqual(1);
  });
  it('a fundraising-like transcript seeds a WikiCallout and no QuoteCallout takes its place', () => {
    const seed = seedLibraryGraphics({words: FUND_WORDS, outputDurationSec: 40, lookId: remapped.id, explainPlates: true});
    const comps = Object.values(seed.compositions);
    expect(comps).toContain('OpenPlate');
    expect(comps).toContain('WikiCallout');
  });
  it('a chosen plain QuoteCallout is swapped for a WikiCallout candidate that fits where it sits', () => {
    const words = timed(
      [
        'Today and I have a choice between two options that matter for the company I am building right now',
        'Curiosity is the only advantage that keeps compounding over time always.',
        'Practice builds confidence slowly through repeated attempts and honest feedback.',
        'According to the report Fireworks AI just raised a round and the startup is now valued at 1.5 billion dollars after investors piled in.',
        'Then keep the standard high and ship it anyway today.',
      ],
      0.3,
      4.5,
    );
    const seed = seedLibraryGraphics({words, outputDurationSec: 50, lookId: remapped.id, explainPlates: true});
    const comps = Object.values(seed.compositions);
    expect(comps).toContain('WikiCallout');
    expect(seed.raw.graphics.length).toBeLessThanOrEqual(seed.limit);
  });
  it('source pins: the upgrade step exists and is explain-only; the standard path never seeds a WikiCallout', () => {
    expect(read('../motionDirector/transcriptLibrarySeed.ts')).toContain('a plain QuoteCallout is not "evidence"');
    const standard = seedLibraryGraphics({words: FUND_WORDS, outputDurationSec: 40, lookId: remapped.id});
    expect(Object.values(standard.compositions)).not.toContain('WikiCallout');
  });
});

describe('WP12B 3) article layout', () => {
  it('passage-first: the passage is large display-weight body type; the heading is optional and gets its own band only when present; the marker is the look marker', () => {
    const wiki = read('../../../../remotion/src/motion/compositions/WikiCallout.tsx');
    expect(wiki).toContain('weight={800} font="body"');
    expect(wiki).toContain('title ? sliceTop(afterTabs, 0.2');
    expect(wiki).toContain('highlightColor={palette.marker}');
    expect(wiki).not.toContain('bars.map');
    const lime = platePalette({primary: '#2F5BEA', secondary: '#12A594', background: '#F6F3EE', surface: '#FFFFFF', text: '#1B1B1F', mutedText: '#6B6B76', accent: '#E4572E', look: 'auto'});
    expect(lime.look).toBe('paper_lime');
    expect(lime.marker).toBe('#C8F31D');
    expect(lime.paper).toBe('#FFFFFF');
  });
});
