/**
 * WP39: the still-motion SPEED DIAL (Skill A polish). The full-bleed push-in of the faceless documentary used a fixed 1.00 -> 1.08 that read slightly fast on 0.4-1.0 s holds. Now:
 *   - `motionSpeed` slow 1.04 (the DEFAULT) / normal 1.06 / fast 1.08, linear over the still's own hold
 *   - ImageRun: per-item + run-level `motionSpeed`; framed cards ignore it
 *   - facelessDocLane: money / headline / hook = fast; breathing + chapter-adjacent = slow; everything else the default
 *   - library registry + publisher carry it; Skill A (wp36) structure untouched
 * Offline: no render, no network.
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {
  BLEED_PUSH_FROM,
  BLEED_PUSH_TO,
  BLEED_PUSH_TO_BY_SPEED,
  DEFAULT_MOTION_SPEED,
  MOTION_SPEEDS,
  bleedScaleAt,
  isMotionSpeed,
  motionSpeedAt,
  resolveMotionSpeed,
} from '../../../../remotion/src/lib/imageRunTiming.ts';
import {env} from '../../config/env.ts';
import {resolveLibraryGraphic, libraryGraphicSource} from '../motionDirector/libraryRegistry.ts';
import {FACELESS_BREATHING_SHOT_SEC, FACELESS_HOOK_FAST_SEC, facelessMotionSpeed, planFacelessDocLane} from './facelessDocLane.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar, type VoWord} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp36-vo-words.json')) as {durationSec: number; words: VoWord[]};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags: {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)}});
const cardRanges = plan.chapterCards.map(card => ({start: card.at, end: Math.round((card.at + card.duration) * 1000) / 1000}));

let counter = 0;
const resolver = async (query: string, o: {excludeKeys: Set<string>}) => {
  counter += 1;
  const photo = {assetUrl: `https://images.example.com/${query.replace(/\s+/g, '-')}-w39-${counter}.jpg`, provider: 'pexels', providerId: 900000 + counter};
  return o.excludeKeys.has(`${photo.provider}:${photo.providerId}`) ? null : photo;
};
const lane = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver, blockedRanges: cardRanges});

describe('WP39 1) the speed dial math', () => {
  it('slow (default) 1.00 -> 1.04, normal 1.06, fast 1.08; all linear over the hold and clamped', () => {
    expect(DEFAULT_MOTION_SPEED).toBe('slow');
    expect(MOTION_SPEEDS).toEqual(['slow', 'normal', 'fast']);
    expect(BLEED_PUSH_TO_BY_SPEED).toEqual({slow: 1.04, normal: 1.06, fast: 1.08});
    expect(BLEED_PUSH_FROM).toBe(1);
    expect(BLEED_PUSH_TO).toBe(BLEED_PUSH_TO_BY_SPEED.fast);
    for (const speed of MOTION_SPEEDS) {
      const to = BLEED_PUSH_TO_BY_SPEED[speed];
      expect(bleedScaleAt(0, 30, speed)).toBe(1);
      expect(bleedScaleAt(15, 30, speed)).toBeCloseTo(1 + (to - 1) / 2, 4);
      expect(bleedScaleAt(30, 30, speed)).toBeCloseTo(to, 4);
      expect(bleedScaleAt(300, 30, speed)).toBeCloseTo(to, 4);
      expect(bleedScaleAt(-5, 30, speed)).toBe(1);
    }
  });

  it('the default is calmer than the WP36 push at every frame of a short hold', () => {
    for (let frame = 1; frame <= 12; frame += 1) {
      expect(bleedScaleAt(frame, 12)).toBeLessThan(bleedScaleAt(frame, 12, 'fast'));
      expect(bleedScaleAt(frame, 12)).toBe(bleedScaleAt(frame, 12, 'slow'));
    }
    // the per-frame zoom rate of the default is half the WP36 rate
    const rate = (speed: 'slow' | 'fast') => (bleedScaleAt(10, 10, speed) - 1) / 10;
    expect(rate('slow') / rate('fast')).toBeCloseTo(0.5, 2);
    expect(bleedScaleAt(5, 10, 'slow')).toBeLessThan(bleedScaleAt(5, 10, 'normal'));
    expect(bleedScaleAt(5, 10, 'normal')).toBeLessThan(bleedScaleAt(5, 10, 'fast'));
  });

  it('unknown / absent speeds fall back to slow; an item speed wins over the run speed', () => {
    expect(isMotionSpeed('fast')).toBe(true);
    for (const bad of ['', 'FAST', 'medium', 1, null, undefined, {}]) expect(isMotionSpeed(bad), String(bad)).toBe(false);
    expect(resolveMotionSpeed('bogus')).toBe('slow');
    expect(bleedScaleAt(30, 30, 'bogus' as never)).toBeCloseTo(1.04, 4);
    expect(motionSpeedAt(undefined, 0)).toBe('slow');
    expect(motionSpeedAt(undefined, 0, 'fast')).toBe('fast');
    expect(motionSpeedAt(['normal', undefined], 0, 'fast')).toBe('normal');
    expect(motionSpeedAt(['normal', undefined], 1, 'fast')).toBe('fast');
    expect(motionSpeedAt(['normal'], 4, 'fast')).toBe('fast');
  });
});

describe('WP39 2) ImageRun', () => {
  const run = read('../../../../remotion/src/motion/compositions/ImageRun.tsx');

  it('takes motionSpeed per item and per run and hands it to the bleed still; framed cards do not use it', () => {
    for (const needle of ['motionSpeed?: MotionSpeed', 'motionSpeedAt(', 'speed?: MotionSpeed', 'bleedScaleAt(frame, hold, speed)', '<BleedStill src={item.src} hold={slotAt.hold} speed=']) expect(run, needle).toContain(needle);
    const framedBranch = run.slice(run.indexOf('const slot = cardSequenceFrames('));
    expect(framedBranch.slice(0, framedBranch.indexOf('</Sequence>'))).not.toContain('motionSpeed');
  });

  it('keeps the WP36 / WP35 contracts (props order pin, framed card entrances snappy)', () => {
    expect(run).toContain("fit = 'contain', borderPx, exit, holdsSec, framedItems}) => {");
    expect(run).toContain('interpolate(frame, [0, 4], [1.07, 1]'); // the cut pop is unchanged
  });
});

describe('WP39 3) the faceless planner sets the speed from context', () => {
  const holds = [{start: 10, end: 11.8, reason: 'money' as const}, {start: 20, end: 22, reason: 'cta' as const}, {start: 30, end: 31.6, reason: 'headline' as const}];
  const cards = [{at: 17, duration: 0.8}];

  it('facelessMotionSpeed: hook / money / headline fast; breathing + chapter-adjacent slow; the rest the fallback', () => {
    expect(facelessMotionSpeed({start: 0.1, end: 0.9}, {holds})).toBe('fast'); // hook
    expect(FACELESS_HOOK_FAST_SEC).toBeGreaterThan(0.5);
    expect(facelessMotionSpeed({start: 10, end: 11.8}, {holds})).toBe('fast'); // money (even though it is a long shot)
    expect(facelessMotionSpeed({start: 30.4, end: 31.2}, {holds})).toBe('fast'); // headline
    expect(facelessMotionSpeed({start: 20, end: 22}, {holds, fallback: 'fast'})).toBe('slow'); // a cta hold is breathing room
    expect(facelessMotionSpeed({start: 5, end: 5 + FACELESS_BREATHING_SHOT_SEC}, {holds, fallback: 'fast'})).toBe('slow'); // breathing
    expect(facelessMotionSpeed({start: 16.4, end: 17}, {holds, chapterCards: cards, fallback: 'fast'})).toBe('slow'); // right before the card
    expect(facelessMotionSpeed({start: 17.8, end: 18.4}, {holds, chapterCards: cards, fallback: 'fast'})).toBe('slow'); // right after
    expect(facelessMotionSpeed({start: 25, end: 25.7}, {holds, chapterCards: cards})).toBe('slow'); // default
    expect(facelessMotionSpeed({start: 25, end: 25.7}, {holds, chapterCards: cards, fallback: 'normal'})).toBe('normal');
    expect(facelessMotionSpeed({start: 25, end: 25.7})).toBe('slow');
  });

  it('every full-bleed shot has a speed, framed cards none; the plan has both a calm default and fast money / hook shots', () => {
    expect(lane.shots.length).toBeGreaterThan(10);
    for (const shot of lane.shots) {
      if (shot.framed) expect(shot.motionSpeed).toBeUndefined();
      else expect(MOTION_SPEEDS).toContain(shot.motionSpeed);
    }
    const slow = lane.shots.filter(shot => shot.motionSpeed === 'slow').length;
    const fast = lane.shots.filter(shot => shot.motionSpeed === 'fast').length;
    expect(slow).toBeGreaterThan(fast); // calm is the default
    expect(fast).toBeGreaterThanOrEqual(1);
    expect(lane.stats.motionSpeeds).toEqual({slow, normal: 0, fast});
    expect(lane.warnings).toContain(`polish_pace:faceless_motion:slow=${slow},normal=0,fast=${fast}`);
  });

  it('money holds and the hook shot are fast; shots beside the chapter card are slow', () => {
    const fastShots = lane.shots.filter(shot => shot.motionSpeed === 'fast');
    const money = plan.holds.filter(hold => hold.reason === 'money');
    expect(money.length).toBeGreaterThanOrEqual(1);
    for (const hold of money) {
      const covering = lane.shots.filter(shot => !shot.framed && shot.start < hold.end - 1e-6 && shot.end > hold.start + 1e-6);
      for (const shot of covering) expect(shot.motionSpeed, `money ${hold.start}`).toBe('fast');
    }
    expect(lane.shots.find(shot => shot.start < FACELESS_HOOK_FAST_SEC && !shot.framed)?.motionSpeed).toBe('fast');
    expect(fastShots.length).toBeLessThan(lane.shots.length / 2);
    for (const card of plan.chapterCards) {
      const beside = lane.shots.filter(shot => !shot.framed && shot.start < card.at + card.duration + 1.5 && shot.end > card.at - 1.5 && !(shot.start < FACELESS_HOOK_FAST_SEC) && !plan.holds.some(hold => hold.reason !== 'cta' && shot.start < hold.end && shot.end > hold.start));
      for (const shot of beside) expect(shot.motionSpeed).toBe('slow');
    }
  });

  it('the run items carry the speed (full-bleed only) and it is deterministic; defaultMotionSpeed moves only the plain shots', async () => {
    for (const planned of lane.runs) {
      planned.items.forEach((item, index) => {
        if (planned.framedItems![index]) expect(item.motionSpeed).toBeUndefined();
        else expect(MOTION_SPEEDS).toContain(item.motionSpeed);
      });
    }
    const again = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver, blockedRanges: cardRanges});
    expect(again.stats.motionSpeeds).toEqual(lane.stats.motionSpeeds);
    const normal = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver, blockedRanges: cardRanges, defaultMotionSpeed: 'normal'});
    expect(normal.stats.motionSpeeds.normal).toBeGreaterThan(0);
    expect(normal.stats.motionSpeeds.fast).toBe(lane.stats.motionSpeeds.fast);
    expect(normal.shots.length).toBe(lane.shots.length);
  });

  it('a plan without holds / chapter cards (the WP36 shape) still plans: hook fast, the rest slow', async () => {
    const bare = await planFacelessDocLane({plan: {shots: plan.shots, groups: plan.groups}, words: fixture.words, durationSec: fixture.durationSec, resolver});
    expect(bare.shots.length).toBeGreaterThan(10);
    expect(bare.stats.motionSpeeds.normal).toBe(0);
    expect(bare.stats.motionSpeeds.slow).toBeGreaterThan(bare.stats.motionSpeeds.fast);
  });
});

describe('WP39 4) library registry + publisher carry the speed', () => {
  const items = ['a', 'b', 'c'].map(name => ({src: `https://example.com/${name}.jpg`}));
  const brief = (content: Record<string, unknown>) => ({goal: 'show photos', visualDescription: 'stills', placement: 'full_screen' as const, content});

  it('per-item and run-level motionSpeed pass; unknown values are dropped', () => {
    const hit = resolveLibraryGraphic(brief({imageRun: [{...items[0]!, motionSpeed: 'fast'}, {...items[1]!, motionSpeed: 'slow'}, {...items[2]!, motionSpeed: 'warp'}], fit: 'cover', motionSpeed: 'normal'}));
    expect(hit?.compositionId).toBe('ImageRun');
    const props = hit!.props as {items: Array<Record<string, unknown>>; motionSpeed?: string};
    expect(props.items.map(item => item.motionSpeed)).toEqual(['fast', 'slow', undefined]);
    expect(props.motionSpeed).toBe('normal');
    const bad = resolveLibraryGraphic(brief({imageRun: items, motionSpeed: 'warp'}));
    expect(bad?.props).not.toHaveProperty('motionSpeed');
    const plain = resolveLibraryGraphic(brief({imageRun: items}));
    expect(plain?.props).not.toHaveProperty('motionSpeed'); // absent = ImageRun's calm default
  });

  it('the generated module forwards the item speed; the schema documents it; the publisher forwards the run speed', () => {
    const hit = resolveLibraryGraphic(brief({imageRun: items, motionSpeed: 'fast'}));
    expect(libraryGraphicSource(hit!)).toContain('motionSpeed: item.motionSpeed as Parameters<typeof ImageRun>[0][\'items\'][number][\'motionSpeed\']');
    expect(read('../motionDirector/libraryRegistry.ts')).toContain("motionSpeed?:'slow'|'normal'|'fast'");
    expect(read('./imageRunPublish.ts')).toContain('...(run.motionSpeed ? {motionSpeed: run.motionSpeed} : {})');
    expect(read('./imageRunPublish.ts')).toContain('content: {imageRun: run.items,'); // items (with their speed) pass whole
  });
});

describe('WP39 5) Skill A stays on, live stays paused', () => {
  it('POLISH_FACELESS_DOC is still the only switch and defaults off; the analyze wiring is untouched', () => {
    expect(env.POLISH_FACELESS_DOC).toBe(false);
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const facelessDoc = Boolean(polishPath && flags.facelessDoc && voGrammar && motion && stockConfigured());');
    expect(analyze).toContain('plan: voGrammar,'); // the full cut plan (holds + chapter cards) is what the lane reads the context from
    expect(analyze.split('planFacelessDocLane(').length - 1).toBe(1);
  });

  it('no SFX / no live: the lane + helper stay pure and the proof entry forwards the speed', () => {
    const lanes = read('./facelessDocLane.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(lanes).not.toMatch(/process\.env|\benv\b|Date\.now|Math\.random|fetch\(|readFileSync|sfx/i);
    const entry = read('../../../../remotion/scripts/wp36/entry.tsx');
    expect(entry).toContain('motionSpeed: item.motionSpeed');
    expect(stripComments(entry)).not.toMatch(/Audio|sfx/i);
  });

  it('the grammar yaml keeps the WP36 reference and adds the WP39 dial', () => {
    const yaml = read('../../../../remotion/out/phase36-readiness/metromedia-grammar.yaml');
    expect(yaml).toContain('stills_motion: {type: push_in, scale: [1.0, 1.08], ease: linear}');
    expect(yaml).toContain('stills_motion_wp39:');
  });
});

describe('WP39 6) the offline strip + docs', () => {
  it('npm run preview:wp39 renders the production ImageRun at slow / normal / fast and writes wp39-motion-speed.jpg', () => {
    expect(read('../../../../remotion/package.json')).toContain('"preview:wp39": "node scripts/wp39-preview.mjs"');
    const script = read('../../../../remotion/scripts/wp39-preview.mjs');
    for (const needle of ['wp39-motion-speed.jpg', 'wp39-motion-speed.json', 'WP39Motion', 'renderStill']) expect(script, needle).toContain(needle);
    const entry = read('../../../../remotion/scripts/wp39/entry.tsx');
    for (const needle of ['ImageRun', 'framedItems', 'motionSpeed']) expect(entry, needle).toContain(needle);
    expect(stripComments(entry)).not.toMatch(/Audio|sfx|OffthreadVideo/i);
  });

  it('WP39_MOTION_SPEED.md documents the dial and editref notes WP39', () => {
    const doc = read('../../../../remotion/out/phase36-readiness/WP39_MOTION_SPEED.md');
    for (const needle of ['slow', 'normal', 'fast', '1.04', '1.06', '1.08', 'POLISH_FACELESS_DOC', 'wp36-faceless-doc.mp4']) expect(doc, needle).toContain(needle);
    const ref = read('../../../../editref.md');
    expect(ref).toContain('WP39');
    expect(ref).toContain('motionSpeed');
  });

  it.runIf(existsSync(new URL('../../../../remotion/out/phase36-readiness/wp39-motion-speed.json', import.meta.url)))('the measured strip: slow travels less than normal, normal less than fast', () => {
    const measured = JSON.parse(read('../../../../remotion/out/phase36-readiness/wp39-motion-speed.json')) as {endScale: Record<string, number>; holdFrames: number};
    expect(measured.endScale.slow).toBeLessThan(measured.endScale.normal);
    expect(measured.endScale.normal).toBeLessThan(measured.endScale.fast);
    expect(measured.endScale.fast).toBeCloseTo(1.08, 3);
    expect(measured.endScale.slow).toBeCloseTo(1.04, 3);
  });
});
