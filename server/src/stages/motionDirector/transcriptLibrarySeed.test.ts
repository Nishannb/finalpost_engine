/**
 * WP8J tests: the pure transcript seed, its assembly through the real Director guards, the stage-level orchestration (a synthetic Director result, no model), the library-only publish with a
 * generator that fails the test if called, and source pins for the wiring. No network, no model call, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {assembleDirectedGraphics, type MotionDirectorResult, type TimedWord} from './motionDirector.ts';
import {buildGeneratedGraphics} from './buildGeneratedGraphics.ts';
import {addLibrarySeeds} from './libraryFallback.ts';
import {resolveLibraryGraphic} from './libraryRegistry.ts';
import {DEFAULT_PILL_BOX, MIN_SEPARATION_SEC, safeOverlayBox, SEED_MAX_GRAPHICS, seedLibraryGraphics} from './transcriptLibrarySeed.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/** Words at 0.34 s each; a sentence in `parts` is followed by a 1 s pause. */
function timed(parts: string[], startSec = 0.4): {words: TimedWord[]; transcript: string; duration: number} {
  const words: TimedWord[] = [];
  let cursor = startSec;
  for (const part of parts) {
    for (const text of part.split(/\s+/)) {
      words.push({text, start: Math.round(cursor * 100) / 100, end: Math.round((cursor + 0.3) * 100) / 100});
      cursor += 0.34;
    }
    cursor += 1;
  }
  return {words, transcript: words.map(word => word.text).join(' '), duration: Math.ceil(cursor + 1)};
}

const CONTRAST_CLIP = timed([
  'Today and I have a choice between two one that have no clue and one that have expert in every field.',
  'Most people just keep guessing.',
  'We remove the guessing for you.',
]);
/** Filler lines of more than 14 words: they are never a headline, a statement or a maxim, so they do not compete with the line under test. */
const FILL_A = 'Hello and welcome back to the channel where we talk about video editing every single week for creators.';
const FILL_B = 'Thank you so much for watching this video and see you in the next one where we go through another idea.';
const padded = (core: string[]) => timed([FILL_A, ...core, FILL_B]);
const BELOW_FACE = {x: 0.3, y: 0.42, w: 0.4, h: 0.5};

const normalized = (text: string) => text.replace(/\s+/g, ' ');
const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

describe('the seed rules, one by one', () => {
  it('contrast: the contrast line gives a VsClaim with both sides taken from the transcript', () => {
    const seed = seedLibraryGraphics({words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration});
    const vs = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'VsClaim')!;
    expect(vs).toBeDefined();
    const content = JSON.parse(vs.contentJson) as {left: string; right: string};
    expect(content.left).toBe('one that have no clue'); // sides are trimmed to 5 words
    expect(content.right).toBe('one that have expert');
    expect(vs.placement).toBe('full_screen');
    expect(vs.anchorWordIndex).toBe(0);
  });
  it('the other contrast shapes: either/or, versus, not/but, instead of', () => {
    const left = (text: string) => {
      const built = padded([text]);
      const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration});
      return seed.raw.graphics.filter(graphic => seed.compositions[graphic.id] === 'VsClaim').map(graphic => JSON.parse(graphic.contentJson));
    };
    expect(left('You either ship the raw take or ship the polished one today.')[0]).toEqual({left: 'ship the raw take', right: 'ship the polished one today'});
    expect(left('Raw versus polished decides who gets watched.')[0]).toEqual({left: 'Raw', right: 'polished decides who gets watched'});
    expect(left('Do not edit by hand but let the editor cut it.')[0]).toEqual({left: 'edit by hand', right: 'let the editor cut'});
    expect(left('Keep the best take instead of every retake you recorded.')[0]).toEqual({left: 'every retake you recorded', right: 'Keep the best take'});
  });
  it('stat: a number with a unit and a label gives a StatHighlight; a year and a lone small number do not', () => {
    const stat = (text: string) => {
      const built = padded([text]);
      const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration});
      return seed.raw.graphics.filter(graphic => seed.compositions[graphic.id] === 'StatHighlight').map(graphic => JSON.parse(graphic.contentJson));
    };
    expect(stat('We cut editing time by 85 percent for every creator who tried it.')[0]).toEqual({value: {to: 85, suffix: '%'}, label: 'for every creator'});
    expect(stat('It costs $20 per month for the whole team.')[0]).toMatchObject({value: {to: 20, prefix: '$'}, label: expect.stringContaining('per month')});
    expect(stat('Back in 2019 we started the company in a garage somewhere.')).toEqual([]);
    expect(stat('There are 3 things you need to know right now friends.')).toEqual([]);
  });
  it('list: 3-6 short parts give TopicPills; WP8R still seeds them with a default box when the speaker is unmeasured', () => {
    const built = padded(['We remove retakes, fillers, noise and dead air from every video you record.']);
    const unmeasured = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration});
    const unmeasuredPills = unmeasured.raw.graphics.find(graphic => unmeasured.compositions[graphic.id] === 'TopicPills')!;
    expect(unmeasuredPills).toBeDefined();
    expect(unmeasuredPills.placement).toBe('overlay');
    expect(unmeasuredPills.box).toEqual(DEFAULT_PILL_BOX);
    const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration, speakerBox: BELOW_FACE});
    const pills = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'TopicPills')!;
    expect(pills).toBeDefined();
    expect(JSON.parse(pills.contentJson).items).toEqual(['remove retakes', 'fillers', 'noise', 'dead air']);
    expect(pills.placement).toBe('overlay');
    expect(pills.box).toEqual(safeOverlayBox(BELOW_FACE));
    expect(pills.visualDescription).toContain('pills');
    const tooMany = padded(['We cover one, two, three, four, five, six and seven things for you.']);
    expect(Object.values(seedLibraryGraphics({words: tooMany.words, outputDurationSec: tooMany.duration, speakerBox: BELOW_FACE}).compositions)).not.toContain('TopicPills');
  });
  it('opening: the first sentence becomes a BigKineticHeadline in up to 3 short lines (an accent word from the lines)', () => {
    const built = timed(['Most creators film everything in one take.', 'Then they spend hours cutting every mistake out by hand.']);
    const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration});
    const headline = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'BigKineticHeadline')!;
    expect(JSON.parse(headline.contentJson)).toEqual({lines: ['Most creators film', 'everything in one', 'take'], accent: 'creators'});
    expect(headline.placement).toBe('full_screen'); // no known speaker: no overlay band
    const overlay = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration, speakerBox: BELOW_FACE}).raw.graphics.find(graphic => graphic.id.startsWith('seed-big-kinetic'))!;
    expect(overlay.placement).toBe('overlay');
    expect(overlay.box!.y).toBeLessThan(BELOW_FACE.y);
  });
  it('closing: a late 4-14 word statement gives a FullscreenStatement; a question never does', () => {
    const built = timed([FILL_A, FILL_A, 'So keep the best take every single time.']);
    const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration});
    const statement = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'FullscreenStatement')!;
    expect(JSON.parse(statement.contentJson)).toEqual({statement: 'So keep the best take every single time'});
    const question = timed([FILL_A, FILL_A, 'So why keep every single take you recorded?']);
    const asked = seedLibraryGraphics({words: question.words, outputDurationSec: question.duration});
    expect(Object.values(asked.compositions)).not.toContain('FullscreenStatement');
  });
  it('maxim: a short never / always / the key sentence gives a QuoteCallout (no author is invented)', () => {
    const built = timed(['Welcome back.', 'Nobody ever remembers the take you almost used here.', 'Thanks for watching.']);
    const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration});
    const quote = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'QuoteCallout');
    if (quote) expect(JSON.parse(quote.contentJson)).toEqual({quote: 'Nobody ever remembers the take you almost used here'});
    const lone = timed(['One.', 'Nobody ever remembers the take you almost used here.', 'Two.']);
    const alone = seedLibraryGraphics({words: lone.words, outputDurationSec: lone.duration, lookId: 'explainer_cutaway'});
    expect(alone.raw.graphics.some(graphic => graphic.contentJson.includes('author'))).toBe(false);
  });
});

describe('caps, spacing and refusals', () => {
  it('empty, short or too-brief input seeds nothing, with a reason', () => {
    expect(seedLibraryGraphics({words: [], outputDurationSec: 30})).toMatchObject({raw: {graphics: []}, none: 'too_short'});
    expect(seedLibraryGraphics({words: timed(['Hello there friend.']).words, outputDurationSec: 30})).toMatchObject({none: 'too_short'});
    expect(seedLibraryGraphics({words: CONTRAST_CLIP.words, outputDurationSec: 4})).toMatchObject({none: 'too_short'});
  });
  it('the look caps the count: minimal_captions allows none; others are duration-scaled up to SEED_MAX_GRAPHICS and the look max', () => {
    expect(SEED_MAX_GRAPHICS).toBe(6);
    expect(seedLibraryGraphics({words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration, lookId: 'minimal_captions'})).toMatchObject({limit: 0, none: 'look_allows_no_graphics'});
    for (const lookId of ['talking_head', 'explainer_cutaway', 'split_story', undefined, null, 'unknown_look']) {
      const seed = seedLibraryGraphics({words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration, lookId, speakerBox: BELOW_FACE});
      expect(seed.limit, String(lookId)).toBeLessThanOrEqual(SEED_MAX_GRAPHICS);
      expect(seed.raw.graphics.length, String(lookId)).toBeLessThanOrEqual(seed.limit);
    }
  });
  it('picks never overlap each other or an occupied interval and start at least MIN_SEPARATION_SEC apart', () => {
    const many = timed(['Most creators film everything in one take.', 'We cut editing time by 85 percent for every creator.', 'You either keep the raw take or keep the polished one.', 'So keep the best take every single time.']);
    const seed = seedLibraryGraphics({words: many.words, outputDurationSec: many.duration});
    const starts = seed.raw.graphics.map(graphic => many.words[graphic.anchorWordIndex]!.start);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(MIN_SEPARATION_SEC);
    const blocked = seedLibraryGraphics({words: many.words, outputDurationSec: many.duration, occupied: [{start: 0, end: many.duration, what: 'everything'}]});
    expect(blocked.raw.graphics).toEqual([]);
    expect(blocked.none).toBe('no_candidates');
  });
  it('a speaker with no room above, or an unknown one, gives no overlay box', () => {
    expect(safeOverlayBox({x: 0.2, y: 0.18, w: 0.6, h: 0.6})).toBeNull();
    expect(safeOverlayBox(BELOW_FACE, true)).toBeNull();
    expect(safeOverlayBox(undefined)).toBeNull();
    expect(safeOverlayBox(BELOW_FACE)).toEqual({x: 0.06, y: 0.06, w: 0.88, h: 0.28});
  });
});

describe('the copy rule and the shape', () => {
  const texts = [CONTRAST_CLIP, timed(['Most creators film everything in one take.', 'We cut editing time by 85 percent for every creator.', 'You either keep the raw take or keep the polished one.', 'So keep the best take every single time.']), timed(['Welcome back everybody.', 'We remove retakes, fillers, noise and dead air from every video you record.'])];
  it('every string in every seeded content is a substring of the transcript (case kept); nothing is invented', () => {
    for (const built of texts) {
      const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration, speakerBox: BELOW_FACE});
      for (const graphic of seed.raw.graphics) {
        const content = JSON.parse(graphic.contentJson) as Record<string, unknown>;
        for (const value of strings(content)) {
          if (value === '$' || value === '%' || value === '' || /^[a-z]+$/.test(value) && ['to', 'prefix', 'suffix', 'value', 'label'].includes(value)) continue;
          expect(normalized(built.transcript), value).toContain(value);
        }
      }
    }
  });
  it('each seed goes through the real Director assembly and the library resolver, and lands on the composition it was seeded for', () => {
    let hits = 0;
    for (const built of texts) {
      const seed = seedLibraryGraphics({words: built.words, outputDurationSec: built.duration, speakerBox: BELOW_FACE});
      const assembled = assembleDirectedGraphics(seed.raw, {words: built.words, outputDurationSec: built.duration, occupied: [], maxGraphics: seed.limit, captionBand: {top: 0.82, bottom: 0.96}});
      expect(assembled.refusals, JSON.stringify(assembled.refusals)).toEqual([]);
      for (const directed of assembled.graphics) {
        const hit = resolveLibraryGraphic({goal: directed.brief.goal, visualDescription: directed.brief.visualDescription, placement: directed.brief.placement, content: directed.brief.content, textTreatment: directed.brief.textTreatment});
        expect(hit?.compositionId, directed.brief.id).toBe(seed.compositions[directed.brief.id]);
        hits += 1;
      }
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });
  it('is deterministic and does not mutate its input', () => {
    const input = {words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration, speakerBox: BELOW_FACE};
    const before = JSON.stringify(input);
    expect(JSON.stringify(seedLibraryGraphics(input))).toBe(JSON.stringify(seedLibraryGraphics(input)));
    expect(JSON.stringify(input)).toBe(before);
  });
  it('the module is pure: only types, the look table and the registry are imported; no env, logger, network or file access', () => {
    const module_ = read('server/src/stages/motionDirector/transcriptLibrarySeed.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...module_.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(['../directorV2/editLooks.ts', '../../lib/motionRecipes.ts', '../broll/flashCardSeed.ts', './libraryRegistry.ts', './motionDirector.ts']); // WP14B: the pure recipe-id mirror;
    expect(module_).toMatch(/^import type \{Interval, TimedWord\} from '\.\/motionDirector\.ts';/m);
    for (const word of ['process.env', 'fetch(', 'logger', 'readFile', 'requestJson', 'callDirectorModel']) expect(module_).not.toContain(word);
  });
});

describe('the stage step: seeds only when the Director gave the library nothing', () => {
  const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'library_seed', latencyMs: 0, raw: null};
  const base = {words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration, occupied: [], captionBand: {top: 0.82, bottom: 0.96}, lookId: 'explainer_cutaway'};
  it('a failed Director (an empty stand-in) is replaced by seeds, each reported as motion_graphic:library_seed:<composition>', () => {
    const result = addLibrarySeeds(emptyDirector, base);
    expect(result.director.graphics.length).toBeGreaterThan(0);
    expect(result.director.graphics.length).toBeLessThanOrEqual(2);
    expect(result.warnings.every(warning => /^motion_graphic:library_seed:[A-Za-z]+$/.test(warning))).toBe(true);
    expect(result.warnings).toContain('motion_graphic:library_seed:VsClaim');
    expect(emptyDirector.graphics).toEqual([]); // not mutated
  });
  it('nothing seedable gives the explicit "none" warning', () => {
    const result = addLibrarySeeds(emptyDirector, {...base, words: timed(['Hello there friend.']).words});
    expect(result.warnings).toEqual(['motion_graphic:library_seed:none']);
    expect(result.director.graphics).toEqual([]);
  });
  it('the minimal look seeds nothing; a Director that already gave the library a brief is left alone', () => {
    expect(addLibrarySeeds(emptyDirector, {...base, lookId: 'minimal_captions'}).warnings).toEqual(['motion_graphic:library_seed:none']);
    const seeded = addLibrarySeeds(emptyDirector, base).director;
    const again = addLibrarySeeds(seeded, base);
    expect(again.warnings).toEqual([]);
    expect(again.director).toBe(seeded);
  });
  it('briefs the library cannot draw do not count: seeds are added around them, never overlapping them', () => {
    const odd = assembleDirectedGraphics({graphics: [{id: 'odd', anchorWordIndex: 0, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen', contentJson: '{"mood":"calm"}'}]}, {words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration, occupied: [], maxGraphics: 4}).graphics;
    expect(odd).toHaveLength(1);
    const result = addLibrarySeeds({...emptyDirector, graphics: odd}, base);
    const seeds = result.director.graphics.filter(graphic => graphic.brief.id.startsWith('seed-'));
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) expect(seed.start >= odd[0]!.end || seed.end <= odd[0]!.start).toBe(true);
  });
});

describe('library-only delivery of the seeds: no generator, no cost', () => {
  it('buildGeneratedGraphics with claudeAllowed false publishes every seed from the library', async () => {
    const calls: unknown[] = [];
    const generator = async () => {
      calls.push(1);
      throw new Error('the generator must not be called');
    };
    const upload = async (_code: string, sha: string) => `https://cdn.example/${sha}.js`;
    const seeded = addLibrarySeeds({graphics: [], refusals: [], notes: '', costUsd: 0, model: 'library_seed', latencyMs: 0, raw: null}, {words: CONTRAST_CLIP.words, outputDurationSec: CONTRAST_CLIP.duration, occupied: [], captionBand: {top: 0.82, bottom: 0.96}, lookId: 'explainer_cutaway'});
    const outcome = await buildGeneratedGraphics(seeded.director.graphics, {generator, upload, runtimeCheck: false, preferLibrary: true, claudeAllowed: false});
    expect(calls).toEqual([]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.generatedGraphics.length).toBe(seeded.director.graphics.length);
    expect(outcome.provenance.every(item => item.source === 'library')).toBe(true);
    expect(outcome.claudeCostUsd).toBe(0);
  }, 90_000);
});

describe('wiring (source text)', () => {
  const stage = read('server/src/stages/motionDirector/index.ts');
  it('seeding runs in library-only mode and (WP9E) always on the explain-plate path, after the Director (including after its failure), before the text treatments; the failure stays reported', () => {
    expect(stage).toContain('const seedMode = Boolean(input.preferLibrary) && (input.claudeAllowed === false || Boolean(input.explainPlates));');
    expect(stage).toContain("director = {graphics: [], refusals: [], notes: 'motion Director failed; library seed', costUsd: 0, model: 'library_seed', latencyMs: 0, raw: null};");
    expect(stage).toContain("warnings.push('motion_director_failed', `motion_director_failed:${motionDirectorFailureReason(error)}`);");
    expect(stage).toContain('const seeded = addLibrarySeeds(director, {');
    expect(stage.indexOf('const seeded = addLibrarySeeds(director, {')).toBeLessThan(stage.indexOf('// Text treatments: each request is delivered'));
    expect(stage).toContain('...(directorFailure ? {directorFailure} : {}),');
    expect(stage.match(/addLibrarySeeds\(/g)).toHaveLength(1);
    // the non-seed failure path is the old early return
    expect(stage).toContain("    } else {\n    return {generatedGraphics: [], director: null,");
  });
  it('analyzeVideo passes the chosen look to the stage; a failed Director stays a strict failure even with seeds', () => {
    expect(read('server/src/pipeline/analyzeVideo.ts')).toContain("lookId: [...warnings].reverse().find(warning => warning.startsWith('edit_look:'))?.slice('edit_look:'.length) ?? null,");
    expect(read('server/src/pipeline/strictOutcome.ts')).toContain('if (!stage.director || stage.directorFailure) {');
  });
  it('no new model call: the fallback module and the seed import no provider, and the Claude path is untouched', () => {
    const fallback = read('server/src/stages/motionDirector/libraryFallback.ts');
    for (const word of ['callDirectorModel', 'requestJson', 'anthropic', 'generateMotionGraphic', 'fetch(']) expect(fallback).not.toContain(word);
    expect(read('server/src/config/env.ts')).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
  });
});
