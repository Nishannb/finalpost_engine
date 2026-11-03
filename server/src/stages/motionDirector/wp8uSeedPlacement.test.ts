/**
 * WP8U: library seeds survive occupied beats (Gate 6: hook + lockup + emphasis + a director graphic left no window for any seed, and an empty top-up logged nothing). Pure: no model, no render.
 * The fixture is shaped like a generic ~36 s talking head; nothing here depends on a clip, a niche or a content type.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {addLibrarySeeds} from './libraryFallback.ts';
import {assembleDirectedGraphics, type MotionDirectorResult} from './motionDirector.ts';
import {MIN_SEPARATION_SEC, seedLibraryGraphics} from './transcriptLibrarySeed.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const empty: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};

const SENTENCES = [
  'Most teams choose between speed and quality every single week.',
  'Here is the thing nobody tells you about shipping fast.',
  'Small habits compound into something very large over time.',
  'Pick one metric and protect it from everything else.',
  'Never confuse being busy with making real progress.',
  'Clarity beats effort when the goal is unclear to everyone.',
  'Write the plan down and share it with your whole team.',
  'So keep the standard high and ship it anyway.',
];
const SEC_PER = 4.5;
function timed(sentences: string[]) {
  const words: {text: string; start: number; end: number}[] = [];
  sentences.forEach((sentence, index) => {
    const tokens = sentence.split(/\s+/);
    const slot = (SEC_PER - 0.6) / tokens.length;
    tokens.forEach((text, i) => {
      const start = Math.round((0.4 + index * SEC_PER + i * slot) * 1000) / 1000;
      words.push({text, start, end: Math.round((start + slot * 0.9) * 1000) / 1000});
    });
  });
  return {words, duration: Math.round((sentences.length * SEC_PER + 0.4) * 10) / 10};
}
const clip = timed(SENTENCES);
const startOf = (sentence: number) => 0.4 + sentence * SEC_PER;

/** A hook, a lockup, an emphasis and a late graphic, each sitting on the START of a spoken line (so every preferred window collides). */
const GATE6_OCCUPIED = [
  {start: 0, end: startOf(0) + 1.4, what: 'hook title'},
  {start: startOf(1) - 0.1, end: startOf(1) + 1.2, what: 'emphasis'},
  {start: startOf(3) - 0.2, end: startOf(3) + 1.6, what: 'lockup'},
  {start: startOf(4) - 0.2, end: startOf(4) + 1.0, what: 'zoom'},
  {start: startOf(6) - 0.2, end: startOf(6) + 1.5, what: 'motion graphic'},
  {start: startOf(7) - 0.2, end: startOf(7) + 1.2, what: 'emphasis'},
];
const overlapsAny = (graphic: {start: number; end: number}, occupied: readonly {start: number; end: number}[]) => occupied.some(interval => graphic.start < interval.end && graphic.end > interval.start);

describe('WP8U seed placement around occupied beats', () => {
  it('control: with nothing occupied the same transcript seeds several graphics', () => {
    expect(seedLibraryGraphics({words: clip.words, outputDurationSec: clip.duration, lookId: 'talking_head'}).raw.graphics.length).toBeGreaterThanOrEqual(2);
  });
  it('Gate 6 pattern: every preferred window is occupied, yet at least 2 seeds land in free gaps (anchored on a later word of the same line)', () => {
    const seed = seedLibraryGraphics({words: clip.words, outputDurationSec: clip.duration, lookId: 'talking_head', occupied: GATE6_OCCUPIED});
    expect(seed.none).toBeUndefined();
    expect(seed.raw.graphics.length).toBeGreaterThanOrEqual(2);
    expect(seed.raw.graphics.length).toBeLessThanOrEqual(seed.limit);
    const spans = seed.raw.graphics.map(graphic => {
      const start = clip.words[graphic.anchorWordIndex]!.start;
      return {start, end: start + graphic.durationSeconds};
    });
    for (const span of spans) {
      expect(overlapsAny(span, GATE6_OCCUPIED)).toBe(false);
      expect(span.end - span.start).toBeGreaterThanOrEqual(1.5);
      expect(span.end).toBeLessThanOrEqual(clip.duration);
    }
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]!.start - spans[i - 1]!.start).toBeGreaterThanOrEqual(MIN_SEPARATION_SEC);
  });
  it('a slid seed keeps its copy: every string is still a substring of the transcript', () => {
    const transcript = SENTENCES.join(' ');
    const seed = seedLibraryGraphics({words: clip.words, outputDurationSec: clip.duration, lookId: 'talking_head', occupied: GATE6_OCCUPIED});
    for (const graphic of seed.raw.graphics) {
      const content = JSON.parse(graphic.contentJson) as Record<string, unknown>;
      const strings = Object.entries(content).filter(([key]) => key !== 'recipeId').map(([, item]) => item).flatMap(value => (Array.isArray(value) ? value : [value])).filter((value): value is string => typeof value === 'string');
      for (const text of strings) expect(transcript.toLowerCase()).toContain(text.toLowerCase());
    }
  });
  it('a fully occupied timeline still seeds nothing (no overlap is ever forced)', () => {
    const seed = seedLibraryGraphics({words: clip.words, outputDurationSec: clip.duration, lookId: 'talking_head', occupied: [{start: 0, end: clip.duration, what: 'everything'}]});
    expect(seed.none).toBe('no_candidates');
  });
  it('minimal_captions still seeds none', () => {
    expect(seedLibraryGraphics({words: clip.words, outputDurationSec: clip.duration, lookId: 'minimal_captions', occupied: GATE6_OCCUPIED}).none).toBe('look_allows_no_graphics');
  });
});

describe('WP8U stage level: one library hit then a top-up', () => {
  const spoken = assembleDirectedGraphics(
    {graphics: [{id: 'd1', anchorWordIndex: 40, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'big type', placement: 'full_screen', contentJson: JSON.stringify({statement: 'Never confuse being busy with making real progress'})}]},
    {words: clip.words, outputDurationSec: clip.duration, occupied: [], maxGraphics: 4},
  ).graphics;
  it('the control graphic exists', () => expect(spoken).toHaveLength(1));
  it('with the Gate 6 occupied pattern the top-up adds at least 2 graphics and says so', () => {
    const result = addLibrarySeeds({...empty, graphics: spoken}, {words: clip.words, outputDurationSec: clip.duration, occupied: GATE6_OCCUPIED, lookId: 'talking_head'});
    expect(result.director.graphics.length).toBeGreaterThanOrEqual(3);
    expect(result.warnings.filter(warning => warning.startsWith('motion_graphic:library_seed:')).length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some(warning => /^motion_graphic:library_seed_topup:[1-9]/.test(warning))).toBe(true);
  });
  it('empty occupied still seeds', () => {
    expect(addLibrarySeeds(empty, {words: clip.words, outputDurationSec: clip.duration, occupied: [], lookId: 'talking_head'}).director.graphics.length).toBeGreaterThanOrEqual(2);
  });
  it('room > 0 and zero seeds is never silent, with or without a prior library hit', () => {
    const blocked = [{start: 0, end: clip.duration, what: 'everything'}];
    const withHit = addLibrarySeeds({...empty, graphics: spoken}, {words: clip.words, outputDurationSec: clip.duration, occupied: blocked, lookId: 'talking_head'});
    expect(withHit.warnings).toContain('motion_graphic:library_seed:none');
    expect(withHit.warnings).toContain('motion_graphic:library_seed_topup:0');
    const noHit = addLibrarySeeds(empty, {words: clip.words, outputDurationSec: clip.duration, occupied: blocked, lookId: 'talking_head'});
    expect(noHit.warnings).toContain('motion_graphic:library_seed:none');
  });
  it('ungrounded top-ups stay refused and still leave a warning', () => {
    const result = addLibrarySeeds(empty, {words: clip.words, outputDurationSec: clip.duration, occupied: [], lookId: 'talking_head', isCopyGrounded: () => false});
    expect(result.director.graphics).toHaveLength(0);
    expect(result.warnings.some(warning => warning.startsWith('motion_seed_ungrounded:'))).toBe(true);
    expect(result.warnings).toContain('motion_graphic:library_seed:none');
  });
});

describe('WP8U source pins', () => {
  it('no clip, content-type or niche branching in the seed placement', () => {
    for (const file of ['transcriptLibrarySeed.ts', 'libraryFallback.ts']) {
      const text = readFileSync(resolve(ROOT, 'server/src/stages/motionDirector', file), 'utf8');
      expect(text).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'/i);
    }
    expect(readFileSync(resolve(ROOT, 'server/src/stages/motionDirector/transcriptLibrarySeed.ts'), 'utf8')).toContain('fitWindow');
    expect(readFileSync(resolve(ROOT, 'server/src/stages/motionDirector/libraryFallback.ts'), 'utf8')).toContain('library_seed_topup:0');
  });
});
