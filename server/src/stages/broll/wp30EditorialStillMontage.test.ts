/**
 * WP30: editorial still montage. Offline: an injected photo resolver, no network, no render.
 *   - a run of 3-6 stock stills with rotating still_push_in / card_tilt_in / orbit_drift, holds 1.2-2.5 s
 *   - blocked windows respected, caps respected, WP29 solid URLs never scheduled
 *   - queries are visible 2-4 word scenes: never love / heart / emoji / abstract words
 *   - analyze wires it after the labeled image-run block and before the WP16 transition density
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import type {MotionGraphicResult} from '../../motionWorker/worker.ts';
import {
  EDITORIAL_FALLBACK_SCENES,
  EDITORIAL_HOLD_MAX_SEC,
  EDITORIAL_HOLD_MIN_SEC,
  EDITORIAL_MAX_MID_RUNS,
  EDITORIAL_MAX_OPEN_RUNS,
  EDITORIAL_RECIPES,
  coveredFraction,
  editorialStillQueries,
  editorialWarnings,
  finalizeEditorialQuery,
  freeIntervals,
  isEditorialRun,
  planEditorialStillMontage,
  runShape,
  type EditorialPhotoResolver,
} from './editorialStillMontage.ts';
import {publishImageRuns, type ImageRunPublisher} from './imageRunPublish.ts';
import {isLiteralEmojiQuery, type CaptionWordLike} from './klipyContextQuery.ts';
import {isSolidFixtureUrl} from './solidStill.ts';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const analyze = strip(readFileSync(new URL('../../pipeline/analyzeVideo.ts', import.meta.url), 'utf8'));

/** Words at 0.35 s each, a 0.7 s pause between sentences (so each sentence start is a claim anchor). */
function speak(sentences: string[], startAt = 0.2): CaptionWordLike[] {
  const words: CaptionWordLike[] = [];
  let at = startAt;
  for (const sentence of sentences) {
    for (const text of sentence.split(/\s+/)) {
      words.push({text, start: Math.round(at * 1000) / 1000, end: Math.round((at + 0.3) * 1000) / 1000});
      at += 0.35;
    }
    at += 0.7;
  }
  return words;
}

const SENTENCES = [
  'He built a startup in a tiny office and raised a billion dollars',
  'Then the company collapsed and everyone was fired in a single week',
  'Everybody scrolling their phone watched the news headline spread',
  'The whole city street was talking about the founder and his team',
  'We loved it and my heart was full of success and happiness',
  'He wrote a long email to the team about the laptop and the code',
  'The investors in the meeting counted money on the table all night',
  'A crowd on the street filled the downtown station every morning',
  'Later the restaurant kitchen crew cooked dinner for the family at home',
  'The speaker on stage told the audience what the whole story meant',
  'Students in the class studied the data on a computer screen after school',
  'At the airport the passport line moved while the plane waited outside',
];
const WORDS = speak(SENTENCES);
const DURATION = 62;

/** A deterministic fake library: every query yields a distinct https photo (the resolver honours excludeKeys). */
function fakeResolver(log: string[] = [], miss: (query: string) => boolean = () => false): EditorialPhotoResolver {
  let next = 1000;
  return async (query, {excludeKeys}) => {
    log.push(query);
    if (miss(query)) return null;
    for (;;) {
      next += 1;
      if (!excludeKeys.has(`pexels:${next}`)) break;
    }
    return {assetUrl: `https://images.pexels.com/photos/${next}/pexels-photo-${next}.jpeg?w=1200`, provider: 'pexels', providerId: next};
  };
}

describe('WP30 query builder', () => {
  it('turns a claim into a visible 2-4 word scene', () => {
    const queries = editorialStillQueries('He raised a billion dollars for the startup');
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      const count = query.split(' ').length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
    expect(queries[0]).toMatch(/cash|startup|stock|bank|office|founder/);
  });

  it('never emits love / heart / emoji-style or abstract queries', () => {
    const spoken = [
      'we loved it and my heart was full',
      'pure love and passion and happiness',
      'success motivation mindset hustle journey',
      'I adore the emoji thumbs up smiley kiss hug',
      'so happy and inspired by this amazing dream',
    ];
    for (const text of spoken) {
      for (const query of editorialStillQueries(text)) {
        expect(isLiteralEmojiQuery(query)).toBe(false);
        expect(query).not.toMatch(/\b(love|loved|heart|emoji|kiss|hug|smiley|thumbs?|success|motivation|mindset|hustle|journey|happy|happiness|dream|passion)\b/);
      }
    }
    // abstract-only speech has nothing visible: the caller falls back to neutral editorial scenes
    expect(editorialStillQueries('success motivation mindset hustle journey')).toEqual([]);
  });

  it('finalize refuses emoji glyphs, lone words, abstract words, non-latin script', () => {
    expect(finalizeEditorialQuery('❤️ heart')).toBe('');
    expect(finalizeEditorialQuery('heart emoji')).toBe('');
    expect(finalizeEditorialQuery('love story')).toBe('');
    expect(finalizeEditorialQuery('success')).toBe('');
    expect(finalizeEditorialQuery('success story')).toBe('');
    expect(finalizeEditorialQuery('सफलता कहानी')).toBe('');
    expect(finalizeEditorialQuery('Hands Scrolling Phone!')).toBe('hands scrolling phone');
    expect(finalizeEditorialQuery('a very long city street crowd at night')).toBe('very long city street');
  });

  it('every neutral fallback scene is itself a safe visible scene', () => {
    for (const scene of EDITORIAL_FALLBACK_SCENES) expect(finalizeEditorialQuery(scene)).toBe(scene);
  });
});

describe('WP30 planner geometry', () => {
  it('runShape keeps holds inside 1.2-2.5 s and 3-6 items', () => {
    expect(runShape(3)).toBeNull();
    for (const length of [3.6, 4.5, 6, 7.2, 9, 14, 30]) {
      const shape = runShape(length)!;
      expect(shape.count).toBeGreaterThanOrEqual(3);
      expect(shape.count).toBeLessThanOrEqual(6);
      expect(shape.hold).toBeGreaterThanOrEqual(EDITORIAL_HOLD_MIN_SEC);
      expect(shape.hold).toBeLessThanOrEqual(EDITORIAL_HOLD_MAX_SEC);
      expect(shape.count * shape.hold).toBeLessThanOrEqual(length + 1e-6);
    }
    expect(runShape(30, 4)!.count).toBe(4);
  });

  it('freeIntervals removes padded blocked ranges; coveredFraction counts union overlap once', () => {
    const free = freeIntervals(0, 20, [{start: 5, end: 8}], 1);
    expect(free).toEqual([{start: 0, end: 4}, {start: 9, end: 20}]);
    expect(coveredFraction(0, 10, [{start: 0, end: 4}, {start: 3, end: 6}])).toBeCloseTo(0.6);
  });
});

describe('WP30 planner', () => {
  it('open run: >=3 stills, recipes set and rotated, https photos, no solid URLs', async () => {
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver()});
    expect(montage.runs.length).toBeGreaterThanOrEqual(1);
    const open = montage.runs[0]!;
    expect(open.mode).toBe('sequence');
    expect(open.items.length).toBeGreaterThanOrEqual(3);
    expect(open.items.length).toBeLessThanOrEqual(6);
    expect(open.start).toBeLessThan(2);
    for (const run of montage.runs) {
      const hold = (run.end - run.start) / run.items.length;
      expect(hold).toBeGreaterThanOrEqual(EDITORIAL_HOLD_MIN_SEC - 1e-6);
      expect(hold).toBeLessThanOrEqual(EDITORIAL_HOLD_MAX_SEC + 1e-6);
      for (const [index, item] of run.items.entries()) {
        expect(EDITORIAL_RECIPES as readonly string[]).toContain(item.recipeId);
        expect(item.src).toMatch(/^https:\/\//);
        expect(isSolidFixtureUrl(item.src)).toBe(false);
        if (index > 0) expect(item.recipeId).not.toBe(run.items[index - 1]!.recipeId);
      }
      expect(new Set(run.items.map(item => item.src)).size).toBe(run.items.length);
      expect(isEditorialRun(run)).toBe(true);
      expect(run.cutAts).toHaveLength(run.items.length - 1);
    }
    // the three editorial recipes all appear across the montage
    const recipes = new Set(montage.runs.flatMap(run => run.items.map(item => item.recipeId)));
    expect(recipes).toEqual(new Set(EDITORIAL_RECIPES));
    // no still repeats across runs
    const urls = montage.runs.flatMap(run => run.items.map(item => item.src));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('the spoken claim picks the scene: startup / money words search office + cash scenes', async () => {
    const log: string[] = [];
    await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver(log)});
    expect(log.length).toBeGreaterThan(0);
    expect(log.some(query => /startup|cash|office|stock|bank|founder/.test(query))).toBe(true);
    // every query the resolver ever saw is safe
    for (const query of log) {
      expect(query.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(query.split(' ').length).toBeLessThanOrEqual(4);
      expect(isLiteralEmojiQuery(query)).toBe(false);
      expect(query).not.toMatch(/\b(love|loved|heart|emoji|success|happiness)\b/);
    }
  });

  it('respects blocked windows (padded) and never overlaps another beat', async () => {
    const blocked = [{start: 0, end: 0.9}, {start: 9, end: 12}];
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, blockedRanges: blocked, resolver: fakeResolver()});
    expect(montage.runs.length).toBeGreaterThanOrEqual(1);
    for (const run of montage.runs) {
      for (const range of blocked) expect(run.start < range.end && run.end > range.start).toBe(false);
    }
    for (const [index, run] of montage.runs.entries()) {
      for (const other of montage.runs.slice(index + 1)) expect(run.start < other.end && run.end > other.start).toBe(false);
    }
  });

  it('an open already owned by other beats gets no open run', async () => {
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, blockedRanges: [{start: 0, end: 18}], resolver: fakeResolver()});
    expect(montage.openFilledFrac).toBeGreaterThanOrEqual(0.7);
    expect(montage.runs.every(run => run.start >= 18)).toBe(true);
  });

  it('soft caps: at most 2 open + 2 mid runs, 3-6 stills each, bounded share of the video', async () => {
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver()});
    const open = montage.runs.filter(run => run.start < 22);
    const mid = montage.runs.filter(run => run.start >= 22);
    expect(open.length).toBeLessThanOrEqual(EDITORIAL_MAX_OPEN_RUNS);
    expect(mid.length).toBeLessThanOrEqual(EDITORIAL_MAX_MID_RUNS);
    const covered = montage.runs.reduce((sum, run) => sum + (run.end - run.start), 0);
    expect(covered).toBeLessThanOrEqual(Math.max(22 * 0.7, DURATION * 0.3) + 0.01);
    for (const run of montage.runs) {
      expect(run.items.length).toBeGreaterThanOrEqual(3);
      expect(run.items.length).toBeLessThanOrEqual(6);
    }
    // mid runs are spaced
    for (const [index, run] of mid.entries()) if (index > 0) expect(run.start - mid[index - 1]!.start).toBeGreaterThanOrEqual(14);
  });

  it('respects the lookup cap and the injected caps', async () => {
    const log: string[] = [];
    const capped = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver(log), maxLookups: 5});
    expect(log.length).toBeLessThanOrEqual(5);
    expect(capped.lookups).toBeLessThanOrEqual(5);
    const one = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver(), maxOpenRuns: 1, maxMidRuns: 0});
    expect(one.runs).toHaveLength(1);
  });

  it('a solid / flat-fill / non-https / video URL from the library is never scheduled', async () => {
    const bad = ['https://cdn.example.com/solid-green.png', 'https://cdn.example.com/flat-fill/a.jpg', 'http://insecure.example.com/a.jpg', 'https://cdn.example.com/clip.mp4', 'https://cdn.example.com/wp28/labeled-1780000000-1.png'];
    let calls = 0;
    const resolver: EditorialPhotoResolver = async () => {
      calls += 1;
      return {assetUrl: bad[calls % bad.length]!, provider: 'pexels', providerId: calls};
    };
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver});
    expect(montage.runs).toHaveLength(0);
    expect(montage.stills).toBe(0);
    expect(montage.misses).toBeGreaterThan(0);
  });

  it('a library that cannot fill three stills drops the run (no slideshow of one or two)', async () => {
    let served = 0;
    const resolver: EditorialPhotoResolver = async (_query, {excludeKeys}) => {
      served += 1;
      if (served > 2) return null;
      excludeKeys.add(`pexels:${served}`);
      return {assetUrl: `https://images.pexels.com/photos/${served}/p.jpeg`, provider: 'pexels', providerId: served};
    };
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver});
    expect(montage.runs).toHaveLength(0);
    expect(montage.warnings).not.toContain('polish_assets:editorial_stills:2');
  });

  it('a resolver that throws is a miss, not a crash', async () => {
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: async () => { throw new Error('network'); }});
    expect(montage.runs).toHaveLength(0);
    expect(montage.misses).toBeGreaterThan(0);
  });

  it('abstract-only or non-latin speech still produces a montage from neutral editorial scenes', async () => {
    const log: string[] = [];
    const words = speak(['success motivation mindset hustle journey growth', 'सफलता र प्रेरणा को कुरा', 'happy inspired amazing dream passion love']);
    const montage = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: fakeResolver(log)});
    expect(montage.runs.length).toBeGreaterThanOrEqual(1);
    expect(montage.fallbackItems).toBe(montage.stills);
    for (const query of log) expect(EDITORIAL_FALLBACK_SCENES).toContain(query);
  });

  it('tiny or empty videos plan nothing; warnings follow the contract', async () => {
    const tiny = await planEditorialStillMontage({words: [], outputDurationSec: 3, resolver: fakeResolver()});
    expect(tiny.runs).toHaveLength(0);
    expect(editorialWarnings(tiny)).toEqual([]);
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver()});
    expect(montage.warnings).toContain(`polish_assets:editorial_stills:${montage.stills}`);
    expect(montage.warnings).toContain(`polish_assets:editorial_runs:${montage.runs.length}`);
  });
});

describe('WP30 publish + analyze wiring', () => {
  const okPublisher: ImageRunPublisher = async (briefInput, source) => {
    const b = briefInput as {id: string; assets: Array<{id: string; url: string}>};
    return {id: b.id, module: {url: 'https://r2.example.com/m.js', sha256: 'x'}, placement: {mode: 'full_screen'}, props: {content: {}, assets: Object.fromEntries(b.assets.map(a => [a.id, {src: a.url}]))}, brief: {}, source} as unknown as MotionGraphicResult;
  };

  it('editorial runs publish as ImageRun graphics through the existing publisher', async () => {
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver()});
    const {published, failed} = await publishImageRuns(montage.runs, {publisher: okPublisher, idPrefix: 'editorial_run'});
    expect(failed).toHaveLength(0);
    expect(published).toHaveLength(montage.runs.length);
    for (const item of published) {
      expect(item.graphic.start).toBe(item.run.start);
      expect(item.graphic.end).toBe(item.run.end);
      expect(item.graphic.placement.mode).toBe('full_screen');
      expect(Object.keys(item.graphic.props!.assets as object)).toHaveLength(item.run.items.length);
    }
  });

  it('editorial photos fill the frame (fit: cover) through the registry; labeled runs keep contain', async () => {
    const montage = await planEditorialStillMontage({words: WORDS, outputDurationSec: DURATION, resolver: fakeResolver()});
    expect(montage.runs.every(run => run.fit === 'cover')).toBe(true);
    const seen: string[] = [];
    await publishImageRuns(montage.runs.slice(0, 1), {publisher: async (b, source) => { seen.push(source); return okPublisher(b, source); }, idPrefix: 'editorial_run'});
    expect(seen[0]).toMatch(/"fit": "cover"/);
    const labeled = await publishImageRuns([{...montage.runs[0]!, fit: undefined}], {publisher: async (b, source) => { seen.push(source); return okPublisher(b, source); }});
    expect(labeled.published).toHaveLength(1);
    expect(seen[1]).not.toMatch(/"fit"/);
  });

  it('analyze plans after the labeled block, before filler + WP16 density; stays behind stock + the env flag', () => {
    expect(analyze).toMatch(/planEditorialStillMontage\(/);
    expect(analyze).toMatch(/env\.POLISH_EDITORIAL_STILLS_ENABLED && stockConfigured\(\)/);
    expect(analyze).toMatch(/findPhotoAsset\(query/);
    expect(analyze).toMatch(/idPrefix: 'editorial_run'/);
    expect(analyze.indexOf('planEditorialStillMontage(')).toBeGreaterThan(analyze.indexOf('planLabeledAssetPlacements('));
    expect(analyze.indexOf('planEditorialStillMontage(')).toBeLessThan(analyze.indexOf('ensurePolishTransitionDensity('));
    // WP16: density anchors on the editorial run boundaries (windows) and whips at their starts
    expect(analyze).toMatch(/\.concat\(editorialRunWindows\)/);
    expect(analyze).toMatch(/forcedCuts: \[\.\.\.flashCardEnds, \.\.\.imageRunCuts\]\.concat\(editorialRunWindows\.map\(window => window\.start\)/);
    // WP29: no solid / full-bleed still path is introduced (ImageRun graphic only; no brollClips push)
    const block = analyze.slice(analyze.indexOf('planEditorialStillMontage('), analyze.indexOf('ensurePolishTransitionDensity('));
    expect(block).not.toMatch(/broll\.clips\s*=/);
  });
});
