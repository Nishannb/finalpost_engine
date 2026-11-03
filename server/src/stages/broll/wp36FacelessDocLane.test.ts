/**
 * WP36: the FACELESS DOCUMENTARY lane (Metromedia: no on-camera speaker, ~100 % B-roll, one literal still per VO cut-plan shot). Offline: no render, no network, no model.
 *   1. coverage planner: every cut-plan shot gets a still, boundaries are the cut plan's, no gap > 0.3 s, photo coverage >= 95 %, ~0.85 s mean shot
 *   2. integrates voCutGrammar: caption groups -> the spoken words of each shot -> literal queries; chapter cards (blocked ranges) keep their span
 *   3. solids gate: only https photo URLs, no solid fixtures / videos / gifs; a miss re-uses an earlier photo, never leaves a gap or a solid
 *   4. runs: 2-6 stills, exact per-shot holds, ~15 % framed cards (never the last of a run, so a fly-out exists), full-bleed push-in for the rest
 *   5. renderer + registry: ImageRun `holdsSec` / `framedItems`, per-still timing math, the library hit, punch-in over the stills
 *   6. wiring: POLISH_FACELESS_DOC default OFF -> no faceless path; on -> replaces the WP30 montage, runs after the WP33 plan
 *   7. the offline proof
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {BLEED_PUSH_FROM, BLEED_PUSH_TO, bleedScaleAt, imageRunSlots, isFramedItem} from '../../../../remotion/src/lib/imageRunTiming.ts';
import {env} from '../../config/env.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {isPhotoUrl} from './editorialStillMontage.ts';
import {
  FACELESS_COVERAGE_TARGET,
  FACELESS_FRAMED_MIN_SHOT_SEC,
  FACELESS_MAX_GAP_SEC,
  FACELESS_MAX_RUN_ITEMS,
  FACELESS_MIN_RUN_ITEMS,
  chunkSizes,
  facelessSlots,
  isFacelessRun,
  longestGap,
  planFacelessDocLane,
  spokenInSpan,
  unionSeconds,
} from './facelessDocLane.ts';
import {runCutTimes} from './labeledAssetPlacement.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar, type VoWord} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp36-vo-words.json')) as {durationSec: number; words: VoWord[]};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags: {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)}});
const cardRanges = plan.chapterCards.map(card => ({start: card.at, end: Math.round((card.at + card.duration) * 1000) / 1000}));

let counter = 0;
/** A fake stock library: every query gets its own https photo (unique id), recorded so tests can see what was asked. */
const makeResolver = (options: {missQueries?: RegExp; badUrl?: (query: string) => string | null} = {}) => {
  const asked: string[] = [];
  const resolver = async (query: string, o: {excludeKeys: Set<string>}) => {
    asked.push(query);
    if (options.missQueries?.test(query)) return null;
    counter += 1;
    const url = options.badUrl?.(query) ?? `https://images.example.com/${query.replace(/\s+/g, '-')}-${counter}.jpg`;
    const photo = {assetUrl: url, provider: 'pexels', providerId: counter};
    return o.excludeKeys.has(`${photo.provider}:${photo.providerId}`) ? null : photo;
  };
  return {resolver, asked};
};

const lane = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: makeResolver().resolver, blockedRanges: cardRanges});

describe('WP36 1) the coverage planner', () => {
  it('fills every cut-plan shot with a still on the plan boundaries (hard cuts, no gap, no overlap)', () => {
    const expected = facelessSlots(plan.shots, cardRanges, fixture.durationSec);
    expect(lane.unfilled).toEqual([]);
    // a lone slot between two beats is split in two; otherwise the lane keeps exactly the plan's shots
    expect(lane.shots.length).toBeGreaterThanOrEqual(expected.length);
    const boundaries = new Set(plan.shots.flatMap(shot => [shot.start, shot.end]));
    for (const shot of lane.shots) {
      expect(shot.end).toBeGreaterThan(shot.start);
    }
    for (const plannedShot of expected) {
      const covering = lane.shots.filter(shot => shot.start >= plannedShot.start - 0.002 && shot.end <= plannedShot.end + 0.002);
      expect(covering.length, `shot ${plannedShot.start}`).toBeGreaterThanOrEqual(1);
      expect(Math.min(...covering.map(shot => shot.start))).toBeCloseTo(plannedShot.start, 2);
      expect(Math.max(...covering.map(shot => shot.end))).toBeCloseTo(plannedShot.end, 2);
    }
    // consecutive stills meet exactly
    for (let index = 1; index < lane.shots.length; index += 1) {
      const gap = lane.shots[index]!.start - lane.shots[index - 1]!.end;
      expect(gap === 0 || cardRanges.some(range => Math.abs(range.start - lane.shots[index - 1]!.end) < 0.002)).toBe(true);
    }
    expect([...boundaries].length).toBeGreaterThan(10);
  });

  it('no gap over 0.3 s without media; photo coverage >= 95 %; the chapter card counts as media', () => {
    expect(lane.stats.maxGapSec).toBeLessThanOrEqual(FACELESS_MAX_GAP_SEC);
    expect(lane.stats.photoCoverage).toBeGreaterThanOrEqual(FACELESS_COVERAGE_TARGET);
    expect(lane.stats.mediaCoverage).toBeGreaterThanOrEqual(0.99);
    expect(plan.chapterCards.length).toBeGreaterThanOrEqual(1);
    const photos = lane.shots.map(shot => ({start: shot.start, end: shot.end}));
    expect(longestGap([...photos, ...cardRanges], fixture.durationSec)).toBeLessThanOrEqual(FACELESS_MAX_GAP_SEC);
    expect(unionSeconds(photos, fixture.durationSec) / fixture.durationSec).toBeCloseTo(lane.stats.photoCoverage, 2);
  });

  it('shot density ~ duration / 0.85 (+-25 %)', () => {
    const target = fixture.durationSec / 0.85;
    expect(lane.stats.shotCount).toBeGreaterThanOrEqual(target * 0.75);
    expect(lane.stats.shotCount).toBeLessThanOrEqual(target * 1.25);
    expect(lane.stats.meanShotSec).toBeGreaterThan(0.6);
    expect(lane.stats.meanShotSec).toBeLessThan(1.1);
  });

  it('one still per shot: the photos are unique while the lookups last', () => {
    expect(new Set(lane.shots.map(shot => shot.src)).size).toBe(lane.shots.length);
    expect(lane.stats.reused).toBe(0);
  });

  it('the lane warnings carry polish_pace:faceless_coverage:<pct>', () => {
    expect(lane.warnings).toContain(`polish_pace:faceless_coverage:${(lane.stats.mediaCoverage * 100).toFixed(1)}`);
    expect(lane.warnings.some(warning => /^polish_pace:faceless_coverage:\d+\.\d$/.test(warning))).toBe(true);
    expect(lane.warnings.some(warning => warning.startsWith('polish_pace:faceless_gap'))).toBe(false);
  });

  it('empty / invalid input plans nothing and reports 0 coverage', async () => {
    const none = await planFacelessDocLane({plan: {shots: [], groups: []}, words: [], durationSec: 20, resolver: makeResolver().resolver});
    expect(none.runs).toEqual([]);
    expect(none.warnings).toEqual(['polish_pace:faceless_coverage:0.0']);
    const short = await planFacelessDocLane({plan, words: fixture.words, durationSec: 1, resolver: makeResolver().resolver});
    expect(short.shots).toEqual([]);
  });
});

describe('WP36 2) it integrates the voCutGrammar groups and the literal resolver', () => {
  it('every caption group starts inside exactly one still; the still is literal to the words spoken in it', () => {
    for (const group of plan.groups) {
      if (cardRanges.some(range => group.start >= range.start - 1e-6 && group.start < range.end - 1e-6)) continue;
      const shots = lane.shots.filter(shot => group.start >= shot.start - 0.02 && group.start < shot.end - 0.02);
      expect(shots.length, `group ${group.words.join(' ')}`).toBe(1);
      expect(shots[0]!.spoken.toLowerCase()).toContain(group.words[0]!.toLowerCase());
    }
  });

  it('queries are visible 2-4 word scenes taken from the spoken words (never emoji / abstract); a claim with no scene falls back to neutral b-roll', () => {
    for (const shot of lane.shots) {
      expect(shot.query).toMatch(/^[a-z0-9]+( [a-z0-9]+){1,3}$/);
      expect(shot.query).not.toMatch(/\b(success|love|heart|motivation|dream)\b/);
    }
    const money = lane.shots.find(shot => /billion/i.test(shot.spoken));
    expect(money?.fallbackScene).toBe(false);
    expect(money?.query).toMatch(/cash|stock|bank|money/);
    const fired = lane.shots.find(shot => /fired|collapsed/i.test(shot.spoken));
    expect(fired?.query).toMatch(/desk|box|rain|office/);
    expect(lane.stats.fallbackShots).toBeLessThan(lane.stats.shotCount);
  });

  it('spokenInSpan: the groups that start inside, else the words, else the nearest word before', () => {
    const group = plan.groups[3]!;
    expect(spokenInSpan({start: group.start, end: group.end}, plan, fixture.words)).toContain(group.words[0]!);
    expect(spokenInSpan({start: 0.9, end: 0.95}, {groups: []}, fixture.words)).toBe('a');
    expect(spokenInSpan({start: 100, end: 101}, {groups: []}, fixture.words)).toBe(fixture.words[fixture.words.length - 1]!.text);
  });

  it('a chapter card keeps its span: no still under it; without the blocked range the card shot is a still', async () => {
    for (const range of cardRanges) {
      expect(lane.shots.some(shot => shot.start < range.end - 0.01 && shot.end > range.start + 0.01)).toBe(false);
    }
    const noCards = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: makeResolver().resolver});
    expect(noCards.shots.length).toBeGreaterThan(lane.shots.length - 1);
    expect(noCards.stats.photoCoverage).toBeGreaterThan(0.99);
  });

  it('facelessSlots clips a shot to the free part and drops slivers', () => {
    const slots = facelessSlots([{start: 0, end: 2}, {start: 2, end: 2.05}], [{start: 1, end: 1.5}, {start: 2, end: 2.05}], 3);
    expect(slots).toEqual([{start: 0, end: 1}, {start: 1.5, end: 2}]);
  });
});

describe('WP36 3) the solids gate', () => {
  it('only https photo URLs are scheduled: http, video, gif and solid fixtures are refused', async () => {
    expect(isPhotoUrl('https://x.com/a.jpg')).toBe(true);
    for (const bad of ['http://x.com/a.jpg', 'https://x.com/a.mp4', 'https://x.com/a.gif', 'https://x.com/a.webm?x=1']) expect(isPhotoUrl(bad), bad).toBe(false);
    let call = 0;
    const {resolver} = makeResolver({badUrl: () => { call += 1; return call % 3 === 0 ? 'http://insecure.example.com/x.jpg' : call % 3 === 1 && call > 3 ? 'https://x.com/clip.mp4' : null; }});
    const gated = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver, blockedRanges: cardRanges});
    for (const shot of gated.shots) {
      expect(shot.src.startsWith('https://')).toBe(true);
      expect(shot.src).not.toMatch(/\.(mp4|gif|webm)/);
    }
    expect(gated.stats.misses).toBeGreaterThan(0);
  });

  it('a miss re-uses an earlier photo (not within the cooldown): never a gap, never a solid', async () => {
    const {resolver} = makeResolver({missQueries: /desk|screen|street|crowd|office|laptop/});
    const missy = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver, blockedRanges: cardRanges});
    expect(missy.stats.misses).toBeGreaterThan(0);
    expect(missy.stats.reused).toBe(missy.stats.misses);
    expect(missy.stats.maxGapSec).toBeLessThanOrEqual(FACELESS_MAX_GAP_SEC);
    expect(missy.warnings.some(warning => warning.startsWith('polish_assets:faceless_reused:'))).toBe(true);
    const reusedShots = missy.shots.filter(shot => shot.reused);
    expect(reusedShots.length).toBeGreaterThan(0);
    for (const shot of reusedShots) expect(missy.shots.findIndex(other => other.src === shot.src && !other.reused)).toBeGreaterThanOrEqual(0);
  });

  it('a resolver that never answers leaves a reported gap, not a fabricated still', async () => {
    const dead = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: async () => null, blockedRanges: cardRanges});
    expect(dead.shots).toEqual([]);
    expect(dead.runs).toEqual([]);
    expect(dead.unfilled.length).toBeGreaterThan(10);
    expect(dead.warnings.some(warning => warning.startsWith('polish_pace:faceless_coverage_low:'))).toBe(true);
    const throwing = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: async () => { throw new Error('quota'); }});
    expect(throwing.shots).toEqual([]);
  });

  it('the lookup budget is honoured', async () => {
    const {resolver, asked} = makeResolver();
    const capped = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver, maxLookups: 8});
    expect(asked.length).toBeLessThanOrEqual(8);
    expect(capped.stats.lookups).toBeLessThanOrEqual(8);
  });

  it('the lane source never schedules a solid (the editorial gate is reused) and is pure', () => {
    const source = stripComments(read('./facelessDocLane.ts'));
    expect(source).toContain('isPhotoUrl(photo.assetUrl)');
    expect(source).not.toMatch(/process\.env|\benv\b|Date\.now|Math\.random|fetch\(|readFileSync/);
  });
});

describe('WP36 4) the runs', () => {
  it('2-6 stills per run; holdsSec / framedItems / items line up and the holds sum to the run length', () => {
    expect(lane.runs.length).toBeGreaterThanOrEqual(2);
    for (const run of lane.runs) {
      expect(run.items.length).toBeGreaterThanOrEqual(FACELESS_MIN_RUN_ITEMS);
      expect(run.items.length).toBeLessThanOrEqual(FACELESS_MAX_RUN_ITEMS);
      expect(run.holdsSec).toHaveLength(run.items.length);
      expect(run.framedItems).toHaveLength(run.items.length);
      expect(run.slotIds).toHaveLength(run.items.length);
      expect(run.holdsSec!.reduce((sum, hold) => sum + hold, 0)).toBeCloseTo(run.end - run.start, 1);
      expect(run).toMatchObject({mode: 'sequence', fit: 'cover', backdrop: 'blur_self'});
      expect(isFacelessRun(run)).toBe(true);
      for (const hold of run.holdsSec!) expect(hold).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('runs meet exactly (no gap between two consecutive runs) and cutAts are the still starts', () => {
    for (let index = 1; index < lane.runs.length; index += 1) {
      const gap = lane.runs[index]!.start - lane.runs[index - 1]!.end;
      expect(gap === 0 || cardRanges.some(range => Math.abs(range.start - lane.runs[index - 1]!.end) < 0.002)).toBe(true);
    }
    for (const run of lane.runs) {
      expect(run.cutAts).toHaveLength(run.items.length - 1);
      expect(run.cutAts).toEqual(runCutTimes(run));
    }
    const starts = new Set(lane.shots.map(shot => Math.round(shot.start * 100) / 100));
    for (const run of lane.runs) for (const cut of run.cutAts) expect(starts.has(Math.round(cut * 100) / 100), `cut ${cut}`).toBe(true);
  });

  it('~15 % of the stills are framed cards; never the last of a run (a fly-out has a next still); never shorter than 0.6 s; the rest are full-bleed', () => {
    const framed = lane.shots.filter(shot => shot.framed);
    expect(framed.length).toBeGreaterThanOrEqual(1);
    expect(framed.length / lane.shots.length).toBeLessThanOrEqual(0.25);
    expect(lane.stats.framedShots).toBe(framed.length);
    for (const shot of framed) expect(shot.end - shot.start).toBeGreaterThanOrEqual(FACELESS_FRAMED_MIN_SHOT_SEC - 1e-6);
    for (const run of lane.runs) {
      expect(run.framedItems![run.items.length - 1]).toBe(false);
      expect(run.framedItems![0]).toBe(false);
      run.framedItems!.forEach((flag, index) => {
        if (flag) expect(run.framedItems![index - 1]).toBe(false);
        if (flag) expect(run.items[index]!.recipeId).toBeTruthy();
      });
    }
    const flyOuts = lane.runs.reduce((sum, run) => sum + run.framedItems!.filter((flag, index) => flag && index < run.items.length - 1).length, 0);
    expect(flyOuts).toBeGreaterThanOrEqual(1);
  });

  it('framedShare 0 draws no framed card', async () => {
    const plain = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: makeResolver().resolver, blockedRanges: cardRanges, framedShare: 0});
    expect(plain.stats.framedShots).toBe(0);
    expect(plain.runs.every(run => run.framedItems!.every(flag => flag === false))).toBe(true);
  });

  it('chunkSizes never leaves a lone still and never exceeds 6', () => {
    for (let count = 2; count <= 40; count += 1) {
      const sizes = chunkSizes(count);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(count);
      for (const size of sizes) {
        expect(size).toBeGreaterThanOrEqual(2);
        expect(size).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('WP36 5) renderer + registry', () => {
  it('imageRunSlots: exact cumulative boundaries, even split without holds, the last still runs to the end', () => {
    const slots = imageRunSlots({count: 4, durationInFrames: 90, fps: 30, holdFrames: 22, holdsSec: [0.5, 0.3, 1.2, 1]});
    expect(slots.map(slot => slot.from)).toEqual([0, 15, 24, 60]);
    expect(slots.map(slot => slot.hold)).toEqual([15, 9, 36, 30]);
    const even = imageRunSlots({count: 3, durationInFrames: 90, fps: 30, holdFrames: 30});
    expect(even).toEqual([{from: 0, hold: 30}, {from: 30, hold: 30}, {from: 60, hold: 30}]);
    expect(imageRunSlots({count: 3, durationInFrames: 90, fps: 30, holdFrames: 30, holdsSec: [1, 1]})).toEqual(even); // too short: even
    expect(imageRunSlots({count: 2, durationInFrames: 60, fps: 30, holdFrames: 30, holdsSec: [1, -1]})).toEqual([{from: 0, hold: 30}, {from: 30, hold: 30}]); // malformed: even
    // a 0.3 s group (9 frames) is kept
    expect(imageRunSlots({count: 2, durationInFrames: 40, fps: 30, holdFrames: 20, holdsSec: [0.3, 1]})[0]).toEqual({from: 0, hold: 9});
  });

  it('isFramedItem: per still true / false, undefined without flags', () => {
    expect(isFramedItem(undefined, 0)).toBeUndefined();
    expect(isFramedItem([true, false], 0)).toBe(true);
    expect(isFramedItem([true, false], 1)).toBe(false);
    expect(isFramedItem([true], 3)).toBeUndefined();
  });

  it('full-bleed push-in is linear; WP39: the default is slow (1.00 -> 1.04), fast (1.08) is the WP36 push', () => {
    expect([BLEED_PUSH_FROM, BLEED_PUSH_TO]).toEqual([1, 1.08]); // BLEED_PUSH_TO = the fast end scale
    expect(bleedScaleAt(0, 30)).toBe(1);
    expect(bleedScaleAt(15, 30)).toBeCloseTo(1.02, 4); // default = slow
    expect(bleedScaleAt(30, 30)).toBeCloseTo(1.04, 4);
    expect(bleedScaleAt(99, 30)).toBeCloseTo(1.04, 4);
    // the WP36 push is still there as `fast`
    expect(bleedScaleAt(15, 30, 'fast')).toBeCloseTo(1.04, 4);
    expect(bleedScaleAt(30, 30, 'fast')).toBeCloseTo(1.08, 4);
  });

  it('ImageRun renders per-still holds, a bleed still and the framed card; ShortVideo punches the generated graphics', () => {
    const run = read('../../../../remotion/src/motion/compositions/ImageRun.tsx');
    for (const needle of ['holdsSec?: number[]', 'framedItems?: boolean[]', 'const BleedStill', 'imageRunSlots(', 'isFramedItem(framedItems, index)', 'bleedScaleAt(frame, hold, speed)']) expect(run, needle).toContain(needle);
    const short = read('../../../../remotion/src/ShortVideo.tsx');
    expect(short).toMatch(/<ImpactPunch fx=\{blueprint\.impactFx\} enabled=\{style\.brollEnabled\}>\s*<GeneratedGraphicTrack/);
  });

  it('the library hit carries holdsSec / framedItems (and the framed border + fly-out only when a still is framed); malformed values are dropped', () => {
    const items = ['a', 'b', 'c'].map(name => ({src: `https://example.com/${name}.jpg`}));
    const brief = (content: Record<string, unknown>) => ({goal: 'show photos', visualDescription: 'stills', placement: 'full_screen' as const, content});
    const hit = resolveLibraryGraphic(brief({imageRun: items, fit: 'cover', backdrop: 'blur_self', holdsSec: [0.4, 0.9, 1.1], framedItems: [false, true, false]}));
    expect(hit?.compositionId).toBe('ImageRun');
    expect(hit?.props).toMatchObject({holdsSec: [0.4, 0.9, 1.1], framedItems: [false, true, false], borderPx: 5, exit: 'fly_out'});
    const bleedOnly = resolveLibraryGraphic(brief({imageRun: items, holdsSec: [0.4, 0.9, 1.1], framedItems: [false, false, false]}));
    expect(bleedOnly?.props).not.toHaveProperty('borderPx');
    expect(bleedOnly?.props).toMatchObject({framedItems: [false, false, false]});
    const bad = resolveLibraryGraphic(brief({imageRun: items, holdsSec: [0.4, 9, 1.1], framedItems: [false, 'yes', false]}));
    expect(bad?.props).not.toHaveProperty('holdsSec');
    expect(bad?.props).not.toHaveProperty('framedItems');
    const short = resolveLibraryGraphic(brief({imageRun: items, holdsSec: [0.4, 0.9]}));
    expect(short?.props).not.toHaveProperty('holdsSec');
    expect(read('./imageRunPublish.ts')).toContain('...(run.holdsSec ? {holdsSec: run.holdsSec} : {})');
    expect(read('./imageRunPublish.ts')).toContain('...(run.framedItems ? {framedItems: run.framedItems} : {})');
  });

  it('runCutTimes uses the per-still holds', () => {
    expect(runCutTimes({start: 10, end: 13, mode: 'sequence', items: [{src: 'a'}, {src: 'b'}, {src: 'c'}], holdsSec: [0.5, 1, 1.5]})).toEqual([10.5, 11.5]);
    expect(runCutTimes({start: 10, end: 13, mode: 'sequence', items: [{src: 'a'}, {src: 'b'}, {src: 'c'}]})).toEqual([11, 12]);
  });
});

describe('WP36 6) wiring: POLISH_FACELESS_DOC (default off)', () => {
  it('the flag is off by default, documented, and the only switch', () => {
    expect(env.POLISH_FACELESS_DOC).toBe(false);
    expect(read('../../../../.env.example')).toContain('POLISH_FACELESS_DOC');
    expect(read('../../config/env.ts')).toContain('POLISH_FACELESS_DOC: bool(false)');
  });

  it('analyze: the faceless path needs the flag + polish + the WP33 plan + motion + stock; flag off -> the old path (WP30 montage) and no faceless call', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const facelessDoc = Boolean(polishPath && env.POLISH_FACELESS_DOC && voGrammar && motion && stockConfigured());');
    expect(analyze).toContain('if (facelessDoc && voGrammar && motion) {');
    // the one planFacelessDocLane call sits inside the gated block
    const calls = analyze.split('planFacelessDocLane(').length - 1;
    expect(calls).toBe(1);
    expect(analyze.indexOf('planFacelessDocLane(')).toBeGreaterThan(analyze.indexOf('if (facelessDoc && voGrammar && motion) {'));
    // the WP30 editorial montage is replaced, not stacked
    expect(analyze).toContain('if (polishPath && motion && !facelessDoc && env.POLISH_EDITORIAL_STILLS_ENABLED && stockConfigured()) {');
    // faceless runs after the WP33 plan and before the WP34 / WP35 captions + FX are written to the blueprint (they come from the same plan)
    expect(analyze.indexOf('const voGrammar =')).toBeLessThan(analyze.indexOf('const facelessDoc ='));
    // a skipped faceless request says why
    expect(analyze).toContain('polish_pace:faceless_skipped:');
    // portrait photos for the full-bleed 9:16 frame
    expect(analyze.slice(analyze.indexOf('const lane = await planFacelessDocLane'), analyze.indexOf('warnings.push(...lane.warnings)'))).toContain("orientation: 'portrait'");
  });

  it('the lane blocks on full-screen beats only (a chapter card keeps its span), and publishes through the same ImageRun path', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    const block = analyze.slice(analyze.indexOf('if (facelessDoc && voGrammar && motion) {'), analyze.indexOf('if (polishPath && motion && !facelessDoc'));
    expect(block).toContain("graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen'");
    expect(block).toContain("idPrefix: 'faceless_run'");
    expect(block).toContain('editorialRunWindows = editorialRunRanges(');
    expect(block).toContain('polish_assets:faceless_failed');
  });

  it('WP34 captions / WP35 FX are planned from the same cut plan and are untouched by the lane', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const accumulate = polishAccumulateCaptions(broll.caption, {plan: voGrammar');
    expect(analyze).toContain('const impactFx = polishPath && env.POLISH_IMPACT_FX && voGrammar ? planImpactFx(');
    expect(analyze.indexOf('const accumulate = polishAccumulateCaptions(')).toBeLessThan(analyze.indexOf('const facelessDoc ='));
  });
});

describe('WP36 7) the offline proof', () => {
  it('npm run preview:wp36 renders the production components from the real planners', () => {
    expect(read('../../../../remotion/package.json')).toContain('"preview:wp36": "node scripts/wp36-preview.mjs"');
    const script = read('../../../../remotion/scripts/wp36-preview.mjs');
    for (const needle of ['voCutGrammar.ts', 'polishAccumulateCaptions.ts', 'polishImpactFx.ts', 'facelessDocLane.ts', 'stockSearch.ts', 'wp36-vo-words.json', 'wp36-faceless-doc.mp4', 'wp36-contact-sheet.jpg', 'wp36-measured.json', 'wp36-vs-metromedia.jpg']) expect(script, needle).toContain(needle);
    const entry = read('../../../../remotion/scripts/wp36/entry.tsx');
    for (const needle of ['ImageRun', 'holdsSec={run.holdsSec}', 'framedItems={run.framedItems}', 'ImpactFxTrack', 'ImpactPunch', 'AccumulateCaptions', 'FlashCard']) expect(entry, needle).toContain(needle);
    expect(entry).not.toMatch(/VideoTrack|<Video|OffthreadVideo|Footage|TransitionTrack|SmashPunch/);
  });

  it('the fixture VO is 20-30 s', () => {
    expect(fixture.durationSec).toBeGreaterThanOrEqual(20);
    expect(fixture.durationSec).toBeLessThanOrEqual(30);
  });

  it.runIf(existsSync(new URL('../../../../remotion/out/phase36-readiness/wp36-measured.json', import.meta.url)))('the measured MP4: shot density in band, >= 95 % photo-world frames, a card, a flash, a fly-out, B&W present, no talking head', () => {
    const measured = JSON.parse(read('../../../../remotion/out/phase36-readiness/wp36-measured.json')) as {
      durationSec: number;
      shots: {shotsOnFile: number; plannedCuts: number; plannedCutsVerifiedOnFile: number; targetBand: [number, number]};
      coverage: {photoCoverageMeasured: number; mediaCoverageMeasured: number; talkingHeadFrames: number};
      grammar: {chapterCards: number; flashes: number; flyOuts: number; bwSharePlanned: number; bwShareMeasured: number; captionMode: string};
    };
    expect(measured.durationSec).toBeGreaterThanOrEqual(20);
    expect(measured.durationSec).toBeLessThanOrEqual(30);
    expect(measured.shots.shotsOnFile).toBeGreaterThanOrEqual(measured.shots.targetBand[0]);
    expect(measured.shots.shotsOnFile).toBeLessThanOrEqual(measured.shots.targetBand[1]);
    expect(measured.shots.plannedCutsVerifiedOnFile / measured.shots.plannedCuts).toBeGreaterThanOrEqual(0.85);
    expect(measured.coverage.photoCoverageMeasured).toBeGreaterThanOrEqual(0.95);
    expect(measured.coverage.mediaCoverageMeasured).toBeGreaterThanOrEqual(0.98);
    expect(measured.coverage.talkingHeadFrames).toBe(0);
    expect(measured.grammar.chapterCards).toBeGreaterThanOrEqual(1);
    expect(measured.grammar.flashes).toBeGreaterThanOrEqual(1);
    expect(measured.grammar.flyOuts).toBeGreaterThanOrEqual(1);
    expect(measured.grammar.bwSharePlanned).toBeGreaterThan(0);
    expect(measured.grammar.bwShareMeasured).toBeGreaterThan(0);
    expect(measured.grammar.captionMode).toBe('word_by_word_accumulate');
  });
});
