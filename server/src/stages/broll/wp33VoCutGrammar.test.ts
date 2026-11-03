/**
 * WP33: VO-driven cut grammar (Metromedia ASL). Offline: no render, no network, no model.
 *   1. caption groups: 1-3 words (never > 4), every spoken word once and in order, cuts on group starts, not on a dangling function word
 *   2. shot length: mean ~0.85 s, shot count ~ duration / 0.85 (+-20 %), clamps [0.3, 2.5]
 *   3. holds only on flagged headline / money / CTA windows (1.5-2.5 s, no cut inside)
 *   4. chapter cards: 15-25 s apart, 0.7-1.0 s, verbatim spoken words, never over a hold, no cut inside
 *   5. hardCutShareTarget 0.85: the density picker leans to hard cuts, VO cuts are preferred anchors, the old behaviour is unchanged without the flag
 *   6. the library seed emits the chapter cards as white FlashCards (existing WP17 path)
 *   7. wiring pins (env flag default on, one analyze switch, existing forcedCuts pins intact) + the offline proof
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {isGroundedInTranscript} from './groundedText.ts';
import {ensurePolishTransitionDensity, POLISH_HARD_CUT_SHARE} from './transitionDensity.ts';
import {
  VO_ASL_BAND_SEC,
  VO_CHAPTER_GAPS_SEC,
  VO_CHAPTER_MAX_GAP_SEC,
  VO_CHAPTER_MAX_SEC,
  VO_CHAPTER_MIN_GAP_SEC,
  VO_CHAPTER_MIN_SEC,
  VO_GROUP_HARD_MAX_WORDS,
  VO_GROUP_MAX_WORDS,
  VO_HARD_CUT_SHARE_TARGET,
  VO_HOLD_MAX_SEC,
  VO_HOLD_MIN_SEC,
  VO_MAX_SHOT_SEC,
  VO_MIN_SHOT_SEC,
  VO_TARGET_ASL_SEC,
  ctaWindowsOf,
  isFunctionWord,
  moneyWindowsOf,
  planVoCutGrammar,
  type VoWord,
} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const fixture = JSON.parse(read('./fixtures/wp33-vo-words.json')) as {durationSec: number; words: VoWord[]};
const WORDS = fixture.words;
const DURATION = fixture.durationSec;
const FLAGS = {moneyWindows: moneyWindowsOf(WORDS), ctaWindows: ctaWindowsOf(WORDS, DURATION)};
const plan = planVoCutGrammar({words: WORDS, durationSec: DURATION, flags: FLAGS});
const transcript = WORDS.map(word => word.text).join(' ');

/** ~95 s of the same narration repeated (each repeat starts after the previous one), for the long-form schedule. */
const longWords: VoWord[] = [];
for (let repeat = 0; repeat < 5; repeat += 1) for (const word of WORDS) longWords.push({text: word.text, start: Math.round((word.start + repeat * 19.9) * 100) / 100, end: Math.round((word.end + repeat * 19.9) * 100) / 100});
const LONG_DURATION = 95;
const longPlan = planVoCutGrammar({words: longWords, durationSec: LONG_DURATION, flags: {moneyWindows: moneyWindowsOf(longWords), ctaWindows: ctaWindowsOf(longWords, LONG_DURATION)}});

describe('WP33 1) caption groups', () => {
  it('every group is 1-3 words (never more than 4), and the groups cover every spoken word once, in order', () => {
    expect(VO_GROUP_MAX_WORDS).toBe(3);
    expect(VO_GROUP_HARD_MAX_WORDS).toBe(4);
    for (const group of plan.groups) {
      expect(group.words.length).toBeGreaterThanOrEqual(1);
      expect(group.words.length).toBeLessThanOrEqual(VO_GROUP_MAX_WORDS);
      expect(group.end).toBeGreaterThan(group.start);
    }
    expect(plan.groups.flatMap(group => group.words)).toEqual(WORDS.map(word => word.text));
    for (let index = 1; index < plan.groups.length; index += 1) expect(plan.groups[index]!.start).toBeGreaterThanOrEqual(plan.groups[index - 1]!.end);
  });
  it('most groups are 2-3 words (the doc rhythm), and the mean sits at ~2.3 words', () => {
    const mean = WORDS.length / plan.groups.length;
    expect(mean).toBeGreaterThan(1.8);
    expect(mean).toBeLessThanOrEqual(3);
  });
  it('a group never ends on a function word unless the clause ends there (cuts land on content words)', () => {
    for (const group of plan.groups) {
      const last = group.words[group.words.length - 1]!;
      if (isFunctionWord(last)) expect(/[.,;:!?]$/.test(last) || group === plan.groups[plan.groups.length - 1], group.words.join(' ')).toBe(true);
    }
  });
  it('a cut sits on every group start (the first group starts at 0.2 s: 0.2 < 0.3 s so it needs no cut of its own, unless the speech starts later)', () => {
    for (const group of plan.groups.slice(1)) {
      const insideHold = plan.holds.some(hold => group.start > hold.start + 1e-6 && group.start < hold.end - 1e-6);
      const insideCard = plan.chapterCards.some(card => group.start > card.at + 1e-6 && group.start < card.at + card.duration - 1e-6);
      if (!insideHold && !insideCard) expect(plan.cuts.some(cut => Math.abs(cut - group.start) < 0.01), `cut at ${group.start}`).toBe(true);
    }
    const late = planVoCutGrammar({words: WORDS.map(word => ({...word, start: word.start + 1, end: word.end + 1})), durationSec: DURATION});
    expect(late.cuts.some(cut => Math.abs(cut - 1.2) < 0.01)).toBe(true);
  });
  it('a long single word and a pause close a group; punctuation closes a group', () => {
    const slow = planVoCutGrammar({
      durationSec: 6,
      words: [
        {text: 'Unbelievable', start: 0.2, end: 1.2},
        {text: 'results', start: 1.3, end: 1.9},
        {text: 'arrived,', start: 1.95, end: 2.5},
        {text: 'quietly', start: 2.52, end: 3.0},
        {text: 'today', start: 3.05, end: 3.5},
      ],
    });
    expect(slow.groups.map(group => group.words.join(' '))).toEqual(['Unbelievable', 'results arrived,', 'quietly today']);
  });
});

describe('WP33 2) shot length', () => {
  it('the target is 0.85 s: shot count ~ duration / 0.85 within 20 %, mean inside the band, hard-cut target 0.85', () => {
    expect(VO_TARGET_ASL_SEC).toBe(0.85);
    const wanted = DURATION / VO_TARGET_ASL_SEC;
    expect(plan.stats.shotCount).toBe(plan.cuts.length + 1);
    expect(plan.stats.shotCount).toBeGreaterThanOrEqual(wanted * 0.8);
    expect(plan.stats.shotCount).toBeLessThanOrEqual(wanted * 1.2);
    expect(plan.stats.meanShotSec).toBeGreaterThanOrEqual(VO_ASL_BAND_SEC.min);
    expect(plan.stats.meanShotSec).toBeLessThanOrEqual(VO_ASL_BAND_SEC.max);
    expect(plan.stats.meanShotSec).toBeCloseTo(DURATION / plan.stats.shotCount, 2);
    expect(plan.stats.hardCutShareTarget).toBe(0.85);
    expect(VO_HARD_CUT_SHARE_TARGET).toBe(0.85);
  });
  it('density scales to a 90 s piece: ~100-120 shots (the reference range), not a talking-head hold', () => {
    expect(longPlan.stats.shotCount).toBeGreaterThanOrEqual(90);
    expect(longPlan.stats.shotCount).toBeLessThanOrEqual(130);
    expect(longPlan.stats.meanShotSec).toBeGreaterThanOrEqual(VO_ASL_BAND_SEC.min);
    expect(longPlan.stats.meanShotSec).toBeLessThanOrEqual(VO_ASL_BAND_SEC.max);
  });
  it('shots tile the timeline and every shot is inside [0.3, 2.5] s (holds are 1.5-2.5 s)', () => {
    expect(VO_MIN_SHOT_SEC).toBe(0.3);
    expect(VO_MAX_SHOT_SEC).toBe(2.5);
    for (const result of [plan, longPlan]) {
      const duration = result === plan ? DURATION : LONG_DURATION;
      expect(result.shots[0]!.start).toBe(0);
      expect(result.shots[result.shots.length - 1]!.end).toBeCloseTo(duration, 2);
      for (let index = 1; index < result.shots.length; index += 1) expect(result.shots[index]!.start).toBe(result.shots[index - 1]!.end);
      for (const shot of result.shots) {
        const length = shot.end - shot.start;
        expect(length, `${shot.start}-${shot.end}`).toBeGreaterThanOrEqual(VO_MIN_SHOT_SEC - 0.011);
        expect(length, `${shot.start}-${shot.end}`).toBeLessThanOrEqual(VO_MAX_SHOT_SEC + 0.011);
      }
      expect(result.cuts).toEqual([...result.cuts].sort((a, b) => a - b));
      expect(new Set(result.cuts).size).toBe(result.cuts.length);
    }
  });
  it('a long silence is split by plain hard cuts (never a shot over 2.5 s) and reported', () => {
    const gappy = planVoCutGrammar({
      durationSec: 12,
      words: [{text: 'Hello', start: 0.2, end: 0.6}, {text: 'there', start: 0.65, end: 1}, {text: 'friend', start: 1.05, end: 1.5}, {text: 'Goodbye', start: 9, end: 9.5}, {text: 'for', start: 9.55, end: 9.7}, {text: 'now', start: 9.75, end: 10}],
    });
    for (const shot of gappy.shots) expect(shot.end - shot.start).toBeLessThanOrEqual(2.5 + 0.011);
    expect(gappy.shots.some(shot => shot.kind === 'split')).toBe(true);
    expect(gappy.warnings.some(warning => /^polish_pace:vo_cuts_split:\d+$/.test(warning))).toBe(true);
  });
  it('warnings: polish_pace:vo_cuts:<n> and polish_pace:mean_asl:<sec> (off-target flagged only outside the band)', () => {
    expect(plan.warnings).toContain(`polish_pace:vo_cuts:${plan.cuts.length}`);
    expect(plan.warnings).toContain(`polish_pace:mean_asl:${plan.stats.meanShotSec.toFixed(2)}`);
    expect(plan.warnings.some(warning => warning.startsWith('polish_pace:vo_asl_off_target'))).toBe(false);
    const sparse = planVoCutGrammar({durationSec: 30, words: [{text: 'One', start: 0.2, end: 0.6}, {text: 'two', start: 0.7, end: 1}, {text: 'three', start: 1.1, end: 1.5}]});
    expect(sparse.warnings.some(warning => warning.startsWith('polish_pace:vo_asl_off_target'))).toBe(true);
  });
  it('too little speech plans nothing (one shot, polish_pace:vo_cuts:0); deterministic and non-mutating', () => {
    const none = planVoCutGrammar({words: [], durationSec: 10});
    expect(none.cuts).toEqual([]);
    expect(none.warnings).toEqual(['polish_pace:vo_cuts:0']);
    expect(none.stats.shotCount).toBe(1);
    const snapshot = JSON.stringify(WORDS);
    const again = planVoCutGrammar({words: WORDS, durationSec: DURATION, flags: FLAGS});
    expect(again).toEqual(plan);
    expect(JSON.stringify(WORDS)).toBe(snapshot);
  });
});

describe('WP33 3) holds only on headline / money / CTA', () => {
  it('detects the money shot ("six billion dollars") and the CTA from the speech', () => {
    expect(FLAGS.moneyWindows).toHaveLength(1);
    const money = FLAGS.moneyWindows[0]!;
    const six = WORDS.find(word => word.text === 'six')!;
    const dollars = WORDS.find(word => word.text === 'dollars.')!;
    expect(money.start).toBe(six.start);
    expect(money.end).toBe(dollars.end);
    expect(FLAGS.ctaWindows).toHaveLength(1);
    expect(FLAGS.ctaWindows[0]!.start).toBe(WORDS.find(word => word.text === 'Follow')!.start);
    expect(moneyWindowsOf([{text: 'plain', start: 0, end: 1}])).toEqual([]);
    expect(ctaWindowsOf([{text: 'plain', start: 0, end: 1}], 10)).toEqual([]);
  });
  it('a hold is 1.5-2.5 s, starts on a group start, carries its reason, and no cut falls strictly inside it', () => {
    expect(plan.holds.map(hold => hold.reason)).toEqual(['money', 'cta']);
    for (const hold of plan.holds) {
      expect(hold.end - hold.start).toBeGreaterThanOrEqual(VO_HOLD_MIN_SEC - 0.011);
      expect(hold.end - hold.start).toBeLessThanOrEqual(VO_HOLD_MAX_SEC + 0.011);
      expect(plan.groups.some(group => Math.abs(group.start - hold.start) < 0.01)).toBe(true);
      expect(plan.cuts.filter(cut => cut > hold.start + 0.01 && cut < hold.end - 0.01)).toEqual([]);
    }
    expect(plan.shots.filter(shot => shot.kind === 'hold')).toHaveLength(2);
  });
  it('without flags there are no holds, and every shot is a caption-group shot (no unflagged shot is held)', () => {
    const plain = planVoCutGrammar({words: WORDS, durationSec: DURATION});
    expect(plain.holds).toEqual([]);
    for (const shot of plain.shots) if (shot.kind === 'group') expect(shot.end - shot.start).toBeLessThanOrEqual(1.6);
    expect(plain.stats.shotCount).toBeGreaterThan(plan.stats.shotCount);
  });
  it('a headline window holds too (reason headline), and holds do not stack', () => {
    const headline = planVoCutGrammar({words: WORDS, durationSec: DURATION, flags: {headlineWindows: [{start: 0.2, end: 1.2}, {start: 0.9, end: 1.5}]}});
    expect(headline.holds).toHaveLength(1);
    expect(headline.holds[0]).toMatchObject({reason: 'headline'});
    expect(headline.holds[0]!.end - headline.holds[0]!.start).toBeGreaterThanOrEqual(VO_HOLD_MIN_SEC - 0.011);
  });
});

describe('WP33 4) chapter cards', () => {
  it('every 15-25 s, 0.7-1.0 s long: the 20 s proof carries one, a 95 s piece carries several, the gaps cycle 17/19/16/22/18/20/15/24 (mean ~18)', () => {
    expect(VO_CHAPTER_MIN_GAP_SEC).toBe(15);
    expect(VO_CHAPTER_MAX_GAP_SEC).toBe(25);
    expect(VO_CHAPTER_MIN_SEC).toBe(0.7);
    expect(VO_CHAPTER_MAX_SEC).toBe(1);
    expect(VO_CHAPTER_GAPS_SEC.every(gap => gap >= 15 && gap <= 25)).toBe(true);
    expect(VO_CHAPTER_GAPS_SEC.reduce((sum, gap) => sum + gap, 0) / VO_CHAPTER_GAPS_SEC.length).toBeGreaterThanOrEqual(17.5);
    expect(plan.chapterCards).toHaveLength(1);
    expect(longPlan.chapterCards.length).toBeGreaterThanOrEqual(3);
    for (const result of [plan, longPlan]) {
      let previous = 0;
      for (const card of result.chapterCards) {
        expect(card.at - previous).toBeGreaterThanOrEqual(VO_CHAPTER_MIN_GAP_SEC - 0.011);
        expect(card.at - previous).toBeLessThanOrEqual(VO_CHAPTER_MAX_GAP_SEC + 0.011);
        expect(card.duration).toBeGreaterThanOrEqual(VO_CHAPTER_MIN_SEC);
        expect(card.duration).toBeLessThanOrEqual(VO_CHAPTER_MAX_SEC);
        previous = card.at;
      }
    }
  });
  it('the text is 1-3 spoken words, verbatim (grounded in the transcript), on the word it names', () => {
    for (const card of [...plan.chapterCards, ...longPlan.chapterCards]) {
      const words = card.text.split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words.length).toBeLessThanOrEqual(3);
      expect(isGroundedInTranscript(card.text, transcript)).toBe(true);
      const source = (longWords[card.wordIndex] ?? WORDS[card.wordIndex])!;
      expect(Math.abs(source.start - card.at)).toBeLessThan(0.011);
    }
    expect(plan.chapterCards[0]).toMatchObject({text: 'He was fired'});
  });
  it('a card never overlaps a hold, and no cut falls inside it (its edges are the cuts)', () => {
    for (const result of [plan, longPlan]) {
      for (const card of result.chapterCards) {
        const end = card.at + card.duration;
        for (const hold of result.holds) expect(card.at < hold.end && end > hold.start, `${card.at} vs hold ${hold.start}`).toBe(false);
        expect(result.cuts.filter(cut => cut > card.at + 0.01 && cut < end - 0.01)).toEqual([]);
        expect(result.cuts.some(cut => Math.abs(cut - card.at) < 0.01)).toBe(true);
        expect(result.shots.find(shot => Math.abs(shot.start - card.at) < 0.01)?.kind).toBe('card');
      }
    }
  });
  it('prefers a year token or a connective ("But then") to a plain sentence start when the slot allows it', () => {
    const timeline: VoWord[] = [];
    let t = 0.2;
    const say = (text: string) => { timeline.push({text, start: t, end: t + 0.3}); t += 0.34; };
    for (let index = 0; index < 40; index += 1) say(index === 10 ? 'Eventually,' : index === 30 ? 'later' : 'word' + (index % 7));
    for (const word of ['In', '2012']) say(word);
    for (let index = 0; index < 30; index += 1) say('thing' + (index % 5));
    const result = planVoCutGrammar({words: timeline, durationSec: Math.ceil(t) + 1});
    expect(result.chapterCards.length).toBeGreaterThanOrEqual(1);
    expect(result.chapterCards[0]!.at).toBeGreaterThanOrEqual(15);
  });
});

describe('WP33 5) transitions: hard cut is the default, VO cuts are preferred anchors', () => {
  const sentenceStarts = [0.2, 4.05, 6.41, 9.78, 13.56, 16.72, 18.4];
  const base = {durationSec: 40, existing: [], sentenceStarts};
  it('with the grammar active ~85 % of the placed transitions are plain hard cuts (accents are the minority)', () => {
    expect(POLISH_HARD_CUT_SHARE).toBe(0.85);
    const result = ensurePolishTransitionDensity({...base, target: 20, preferHardCut: true, minGapSec: 0.8, voCutTimes: Array.from({length: 45}, (_, index) => 1 + index * 0.85)});
    expect(result.added.length).toBeGreaterThanOrEqual(15);
    const hard = result.added.filter(item => item.keyword === 'hard cut').length;
    expect(hard / result.added.length).toBeGreaterThanOrEqual(POLISH_HARD_CUT_SHARE - 0.001);
    expect(result.added.length - hard).toBeGreaterThanOrEqual(1);
  });
  it('existing whip-heavy transitions count against the accent budget (the picker never adds an accent on top of them)', () => {
    const existing = [{at: 3, keyword: 'whip blur right'}, {at: 9, keyword: 'smash zoom'}];
    const result = ensurePolishTransitionDensity({...base, existing, target: 8, preferHardCut: true, voCutTimes: Array.from({length: 45}, (_, index) => 1 + index * 0.85)});
    expect(result.added.length).toBeGreaterThan(0);
    for (const item of result.added) expect(item.keyword).toBe('hard cut');
  });
  it('the VO cuts are anchors (rank above a bare sentence start, below a media cut) and are used when nothing better fits', () => {
    const result = ensurePolishTransitionDensity({durationSec: 20, existing: [], sentenceStarts: [], voCutTimes: [3.1, 6.2, 9.3, 12.4, 15.5], target: 5, preferHardCut: true});
    expect(result.added.map(item => item.anchor)).toEqual(['vo_cut', 'vo_cut', 'vo_cut', 'vo_cut', 'vo_cut']);
    const media = ensurePolishTransitionDensity({durationSec: 20, existing: [], sentenceStarts: [5], cutTimes: [5.05], voCutTimes: [5.3], target: 1, minGapSec: 0.8});
    expect(media.added[0]!.anchor).toBe('cut');
  });
  it('a forced cut (a card edge) is still added first and is a hard cut under the grammar', () => {
    const forced = ensurePolishTransitionDensity({durationSec: 30, existing: [], sentenceStarts: [], forcedCuts: [16.7], target: 0, preferHardCut: true});
    expect(forced.added).toHaveLength(1);
    expect(forced.added[0]).toMatchObject({anchor: 'forced_cut', keyword: 'hard cut'});
  });
  it('without the flag nothing changes: the rotation still decides (whips / zooms / dips are not suppressed)', () => {
    const result = ensurePolishTransitionDensity({...base, durationSec: 30, target: 8});
    expect(result.added.filter(item => item.keyword !== 'hard cut').length).toBeGreaterThan(result.added.length / 2);
  });
  it('the planner and the picker agree on the 0.85 target', () => {
    expect(plan.stats.hardCutShareTarget).toBe(POLISH_HARD_CUT_SHARE);
  });
});

describe('WP33 6) the chapter cards ride the existing FlashCard seed path', () => {
  const seeded = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: null, explainPlates: true, chapterCards: plan.chapterCards});
  const flashOf = (result: ReturnType<typeof seedLibraryGraphics>) => result.raw.graphics.filter(graphic => result.compositions[graphic.id] === 'FlashCard');
  it('a chapter card becomes a white FlashCard on the planned word, for the planned duration, with the spoken words', () => {
    const card = plan.chapterCards[0]!;
    const flash = flashOf(seeded);
    expect(seeded.chapterCards).toBe(1);
    const chapter = flash.find(graphic => (JSON.parse(graphic.contentJson) as {flash?: string}).flash === card.text);
    expect(chapter).toBeDefined();
    expect(chapter!.anchorWordIndex).toBe(card.wordIndex);
    expect(chapter!.durationSeconds).toBeCloseTo(card.duration, 1);
    expect(JSON.parse(chapter!.contentJson)).toMatchObject({flash: card.text, ground: 'white'});
    expect(chapter!.placement).toBe('full_screen');
    expect(isGroundedInTranscript(card.text, transcript)).toBe(true);
  });
  it('no chapter cards in = the seed is unchanged (no chapterCards field)', () => {
    const plain = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: null, explainPlates: true});
    expect(plain.chapterCards).toBeUndefined();
  });
  it('a card that does not sit on the word it names, or is off the explain-plate path, places nothing', () => {
    const wrong = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: null, explainPlates: true, chapterCards: [{...plan.chapterCards[0]!, wordIndex: 3}]});
    expect(wrong.chapterCards).toBeUndefined();
    const off = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: null, explainPlates: false, chapterCards: plan.chapterCards});
    expect(off.chapterCards).toBeUndefined();
  });
});

describe('WP33 7) wiring pins + the offline proof', () => {
  const analyze = read('../../pipeline/analyzeVideo.ts');
  it('env: POLISH_VO_CUT_GRAMMAR defaults on and is documented', () => {
    expect(read('../../config/env.ts')).toContain('POLISH_VO_CUT_GRAMMAR: bool(true)');
    expect(read('../../../../.env.example')).toContain('POLISH_VO_CUT_GRAMMAR=1');
  });
  it('analyze plans the grammar ONCE, only on polish behind the flag, before the motion stage, and feeds the seed + the density', () => {
    expect(analyze.split('\n').filter(line => line.includes('planVoCutGrammar(')).length).toBe(1);
    expect(analyze).toMatch(/const voGrammar = polishPath && env\.POLISH_VO_CUT_GRAMMAR/);
    expect(analyze.indexOf('const voGrammar')).toBeLessThan(analyze.indexOf('motion = await runMotionGraphicsStage({'));
    expect(analyze.indexOf('motion = await runMotionGraphicsStage({')).toBeLessThan(analyze.indexOf('ensurePolishTransitionDensity('));
    expect(analyze).toContain('chapterCards: voGrammar.chapterCards');
    expect(analyze).toContain('voCutTimes: voGrammar.cuts, preferHardCut: true');
    expect(analyze).toContain('warnings.push(...voGrammar.warnings)');
  });
  it('the existing forcedCuts pins (WP22 / WP30) still hold; the chapter card start is appended', () => {
    expect(analyze).toMatch(/forcedCuts: \[\.\.\.flashCardEnds, \.\.\.imageRunCuts\]\.concat\(editorialRunWindows\.map\(window => window\.start\)/);
    expect(analyze).toContain('.concat(chapterCardStarts)');
  });
  it('the planner is pure: no env, I/O, model or randomness; the stage input carries chapterCards to the seed', () => {
    const code = read('./voCutGrammar.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const needle of ['process.env', 'fetch(', 'readFileSync', 'logger', 'anthropic', 'Math.random', 'Date.now', 'import ']) expect(code, needle).not.toContain(needle);
    expect(read('../motionDirector/index.ts')).toContain('chapterCards?: ReadonlyArray');
    expect(read('../motionDirector/libraryFallback.ts')).toContain('chapterCards: input.chapterCards');
    expect(read('../motionDirector/libraryFallback.ts')).toContain('polish_pace:chapter_cards:');
  });
  it('the offline proof plans from the REAL planner and renders hard cuts between stills (no whip / flash / overlay)', () => {
    const script = read('../../../../remotion/scripts/wp33-preview.mjs');
    const entry = read('../../../../remotion/scripts/wp33/entry.tsx');
    expect(script).toContain('voCutGrammar.ts');
    expect(script).toContain('wp33-vo-words.json');
    expect(script).toContain('wp33-vo-cut-grammar.mp4');
    expect(entry).toContain('wp33-plan.json');
    expect(entry).toContain("import {FlashCard} from '../../src/motion/compositions/FlashCard';");
    expect(entry).not.toMatch(/TransitionTrack|whip|flash_white|SmashPunch/);
    expect(read('../../../../remotion/package.json')).toContain('"preview:wp33": "node scripts/wp33-preview.mjs"');
  });
});
