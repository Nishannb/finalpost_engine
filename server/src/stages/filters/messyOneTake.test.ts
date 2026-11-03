/**
 * WP7C golden tests: run the Stage-B cut stack of the cuts profile (autoTrimSilence with fillers, nonSpeechExclusions, transcriptRetakeExclusions; the same calls and defaults as `analyzeVideo`,
 * which is not imported because it imports the logger) on the synthetic messy-one-take timelines and assert on the KEPT transcript. Pure: no video, no audio, no FFmpeg, no model.
 */
import {describe, expect, it} from 'vitest';

import type {TimeRange, WordToken} from '../../types/blueprint.ts';
import {autoTrimSilence, isBackchannelToken, isFillerToken} from './autoTrim.ts';
import {buildCaptionWords} from './autoZoom.ts';
import {buildTimeline as buildOutputTimeline} from './timeline.ts';
import {MESSY_ONE_TAKE_FIXTURES, buildTimeline, type MessyFixture} from './messyOneTake.fixtures.ts';
import {mergeTimeRanges, nonSpeechExclusions, normalizeToken} from './scriptRetakeTrim.ts';
import {transcriptRetakeExclusions, wordsOutsideRanges} from './transcriptRetakeTrim.ts';

// The server defaults (config/env.ts: SILENCE_THRESHOLD_SEC 0.4, SILENCE_PADDING_SEC 0.08).
const THRESHOLD = 0.4;
const PADDING = 0.08;
const COMBINED_GUARD = 0.55;

const insideAny = (point: number, ranges: TimeRange[]) => ranges.some(range => point >= range.start && point <= range.end);

function runStack(fixture: MessyFixture) {
  const silence = autoTrimSilence(fixture.words, {thresholdSec: THRESHOLD, paddingSec: PADDING, sourceDurationSec: fixture.durationSec, removeFillers: true});
  const cough = nonSpeechExclusions(fixture.words, {paddingSec: PADDING});
  const retakes = transcriptRetakeExclusions(wordsOutsideRanges(fixture.words, []), {sourceDurationSec: fixture.durationSec, paddingSec: PADDING});
  const exclusions = mergeTimeRanges([...silence.trimExclusions, ...cough, ...retakes.trimExclusions]);
  const kept = fixture.words.filter(word => !insideAny((word.start + word.end) / 2, exclusions));
  const removedSec = exclusions.reduce((total, range) => total + (range.end - range.start), 0);
  return {silence, retakes, exclusions, kept, removedSec, keptText: kept.map(word => normalizeToken(word.text)).filter(Boolean).join(' ')};
}

const countOf = (text: string, phrase: string) => text.split(phrase).length - 1;

describe('the fixtures are well-formed', () => {
  it('have at least three timelines with ordered, non-overlapping words', () => {
    expect(MESSY_ONE_TAKE_FIXTURES.length).toBeGreaterThanOrEqual(3);
    for (const fixture of MESSY_ONE_TAKE_FIXTURES) {
      for (let i = 1; i < fixture.words.length; i += 1) expect(fixture.words[i]!.start, fixture.id).toBeGreaterThanOrEqual(fixture.words[i - 1]!.end - 1e-9);
      expect(fixture.durationSec).toBeGreaterThan(fixture.words.at(-1)!.end);
    }
  });
  it('the raw transcripts really contain the mess (so the assertions below are not vacuous)', () => {
    for (const fixture of MESSY_ONE_TAKE_FIXTURES) {
      const raw = fixture.words.map(word => normalizeToken(word.text)).filter(Boolean).join(' ');
      for (const phrase of fixture.mustNotKeep) expect(raw, `${fixture.id}: ${phrase}`).toContain(phrase);
    }
  });
  it('buildTimeline places glued fillers with no gap and isolated ones with a gap', () => {
    const built = buildTimeline([{say: 'one two'}, {filler: 'um'}, {say: 'three'}, {gap: 0.3}, {filler: 'uh'}]);
    expect(built.words[2]!.start).toBeCloseTo(built.words[1]!.end, 6);
    expect(built.words[3]!.start).toBeCloseTo(built.words[2]!.end, 6);
    expect(built.words[4]!.start - built.words[3]!.end).toBeCloseTo(0.3, 6);
  });
});

describe.each(MESSY_ONE_TAKE_FIXTURES)('golden: $id', fixture => {
  const result = runStack(fixture);

  it('cuts the expected kinds of mess', () => {
    if (fixture.expect.droppedTakes) {
      expect(result.retakes.skipped).toBeUndefined();
      expect(result.retakes.droppedTakes).toBeGreaterThanOrEqual(fixture.expect.droppedTakes);
    }
    if (fixture.expect.restarts) expect(result.retakes.restarts).toBeGreaterThanOrEqual(fixture.expect.restarts);
    if (fixture.expect.fillerCuts) {
      const fillerWords = fixture.words.filter(word => isFillerToken(word.text));
      expect(fillerWords.length).toBeGreaterThanOrEqual(fixture.expect.fillerCuts);
      const cutFillers = fillerWords.filter(word => insideAny((word.start + word.end) / 2, result.exclusions));
      expect(cutFillers.length, 'every hesitation sound is cut').toBe(fillerWords.length);
    }
  });

  it('removes a material share of the time, but stays under the combined analyze guard', () => {
    const fraction = result.removedSec / fixture.durationSec;
    expect(fraction).toBeGreaterThanOrEqual(fixture.expect.minRemovedFrac);
    expect(fraction).toBeLessThan(COMBINED_GUARD);
  });

  it('the kept transcript no longer holds the mash / duplicate opening / abandoned attempt', () => {
    for (const phrase of fixture.mustNotKeep) expect(result.keptText, phrase).not.toContain(phrase);
    for (const phrase of fixture.exactlyOnce) expect(countOf(result.keptText, phrase), phrase).toBe(1);
  });

  it('the kept transcript keeps the restatement and every unique beat', () => {
    for (const phrase of fixture.mustKeep) expect(result.keptText, phrase).toContain(phrase);
  });

  it('no filler sound survives in the kept words, and "like" / "you know" are never treated as fillers', () => {
    expect(result.kept.filter(word => isFillerToken(word.text))).toEqual([]);
    expect(isFillerToken('like')).toBe(false);
    expect(isFillerToken('you')).toBe(false);
    expect(isFillerToken('know')).toBe(false);
  });

  it('the stack is deterministic and does not mutate its input', () => {
    const before = JSON.stringify(fixture.words);
    const again = runStack(fixture);
    expect(JSON.stringify(again.exclusions)).toBe(JSON.stringify(result.exclusions));
    expect(JSON.stringify(fixture.words)).toBe(before);
  });
});

describe('a clean take is left alone (no false cuts from the same stack)', () => {
  it('a tight, unique, filler-free script loses nothing but is not harmed', () => {
    const built = buildTimeline([
      {say: 'first we map the user journey on one simple page'}, {gap: 0.3},
      {say: 'then we cut every step that does not help the first win'}, {gap: 0.3},
      {say: 'after that we test it with five real customers this week'}, {gap: 0.3},
      {say: 'finally we ship the smallest version and measure what changed'},
    ]);
    const fixture: MessyFixture = {id: 'clean', title: 'clean', ...built, mustNotKeep: [], mustKeep: [], exactlyOnce: [], expect: {minRemovedFrac: 0}};
    const result = runStack(fixture);
    expect(result.retakes.droppedTakes).toBe(0);
    expect(result.kept.length).toBe(built.words.length);
  });
});

const stackOf = (built: {words: WordToken[]; durationSec: number}) =>
  runStack({id: 'wp7e', title: 'wp7e', ...built, mustNotKeep: [], mustKeep: [], exactlyOnce: [], expect: {minRemovedFrac: 0}});

const BEAT_MAP = 'first we map the user journey on one simple page';
const BEAT_CUT = 'then we cut every step that does not help the first win';
const BEAT_TEST = 'after that we test it with five real customers this week';

describe('WP7E: yeah / yep / yup backchannels', () => {
  it('recognises close spellings but never yes / no / real words', () => {
    for (const token of ['yeah', 'Yeah,', 'yeahh', 'yep', 'yup', 'yah', 'yea', '"yeah."']) expect(isBackchannelToken(token), token).toBe(true);
    for (const token of ['yes', 'no', 'year', 'yellow', 'yet', 'ya', 'yeast']) expect(isBackchannelToken(token), token).toBe(false);
  });
  it('cuts yeahs at phrase edges and stacked ones, keeps a glued mid-sentence yeah', () => {
    const built = buildTimeline([
      {say: 'so when i started building the product'}, {gap: 0.3}, {say: 'yeah'}, {gap: 0.3},
      {say: 'i honestly had no plan for the first month'}, {gap: 0.25}, {say: 'yep'}, {say: 'yup'}, {gap: 0.3},
      {say: 'and we shipped small changes and yeah that works every single day'}, {gap: 0.3},
      {say: BEAT_MAP},
    ]);
    const result = stackOf(built);
    expect(result.keptText).not.toMatch(/\b(yep|yup)\b/);
    expect(countOf(result.keptText, 'building the product yeah')).toBe(0);
    expect(result.keptText).toContain('and yeah that works every single day');
    expect(result.keptText).toContain('i honestly had no plan for the first month');
  });
});

describe('WP7E: one best take per cluster', () => {
  it('three spoken takes of the same tip collapse to the last, full take', () => {
    const built = buildTimeline([
      {say: 'the best onboarding tip is to show one clear win in the first minute'}, {gap: 1.0},
      {say: 'the best onboarding tip is show one win in the first minute'}, {gap: 1.0},
      {say: 'the best onboarding tip is to show one clear win in the very first minute'}, {gap: 0.8},
      {say: BEAT_MAP}, {gap: 0.8}, {say: BEAT_CUT}, {gap: 0.8}, {say: BEAT_TEST}, {gap: 0.8},
      {say: 'finally we ship the smallest version and measure what changed'}, {gap: 0.8}, {say: 'and that is how a small team beats a big one every time'},
    ]);
    const result = stackOf(built);
    expect(countOf(result.keptText, 'the best onboarding tip')).toBe(1);
    expect(result.keptText).toContain('very first minute');
    expect(result.keptText).toContain(BEAT_MAP);
    expect(result.keptText).toContain(BEAT_CUT);
  });
  it('a verbatim repeated sentence keeps one copy', () => {
    const sentence = 'small teams move fast because nobody waits for approval';
    const built = buildTimeline([{say: sentence}, {gap: 0.9}, {say: sentence}, {gap: 0.9}, {say: BEAT_MAP}, {gap: 0.8}, {say: BEAT_CUT}, {gap: 0.8}, {say: BEAT_TEST}]);
    expect(countOf(stackOf(built).keptText, sentence)).toBe(1);
  });
});

describe('WP7E: coach echo', () => {
  const unique = [{gap: 0.9}, {say: BEAT_MAP}, {gap: 0.8}, {say: BEAT_CUT}, {gap: 0.8}, {say: BEAT_TEST}] as const;
  it('drops the coaching prompt and keeps the creator performance', () => {
    const built = buildTimeline([
      {say: 'say figma redefined collaboration'}, {gap: 1.2}, {say: 'figma redefined collaboration in design'}, ...unique,
    ]);
    const result = stackOf(built);
    expect(result.retakes.droppedTakes).toBeGreaterThanOrEqual(1);
    expect(result.keptText).not.toContain('say figma');
    expect(countOf(result.keptText, 'figma redefined collaboration')).toBe(1);
    expect(result.keptText).toContain('figma redefined collaboration in design');
    for (const beat of [BEAT_MAP, BEAT_CUT, BEAT_TEST]) expect(result.keptText).toContain(beat);
  });
  it('drops a bare three-word prompt that the creator then expands', () => {
    const built = buildTimeline([{say: 'figma redefined collaboration'}, {gap: 1.0}, {say: 'figma redefined collaboration for every design team'}, ...unique]);
    const result = stackOf(built);
    expect(result.retakes.echoes).toBe(1);
    expect(countOf(result.keptText, 'figma redefined collaboration')).toBe(1);
    expect(result.keptText).toContain('every design team');
  });
  it('keeps a longer first statement and distinct adjacent beats', () => {
    const longer = buildTimeline([{say: 'figma redefined collaboration in design for every team'}, {gap: 1.0}, {say: 'figma redefined collaboration'}, ...unique]);
    expect(stackOf(longer).keptText).toContain('figma redefined collaboration in design for every team');
    const distinct = buildTimeline([{say: BEAT_MAP}, {gap: 0.8}, {say: BEAT_CUT}, {gap: 0.8}, {say: BEAT_TEST}, {gap: 0.8}, {say: 'finally we ship the smallest version and measure what changed'}]);
    const result = stackOf(distinct);
    expect(result.retakes.droppedTakes).toBe(0);
    expect(result.kept.length).toBe(distinct.words.length);
  });
  it('ignores an echo more than twelve seconds away', () => {
    const built = buildTimeline([{say: 'figma redefined collaboration'}, {gap: 14}, {say: 'figma redefined collaboration in design'}, ...unique]);
    expect(stackOf(built).retakes.echoes).toBeUndefined();
  });
});

describe('WP7E: captions follow the kept speech (no mash)', () => {
  it('captions hold only words of the kept take, none of an excluded word', () => {
    const built = buildTimeline([
      {say: 'what we learned is that small teams move fast what we learned is that small teams ship faster than big ones'}, {gap: 0.7},
      {say: 'this is exactly how figma revolutionized redefined collaboration in design for design'}, {gap: 0.7}, {say: BEAT_MAP}, {gap: 0.7}, {say: BEAT_CUT},
    ]);
    const result = stackOf(built);
    const out = buildOutputTimeline(autoTrimSilence(built.words, {thresholdSec: THRESHOLD, paddingSec: PADDING, sourceDurationSec: built.durationSec}).keepSegments);
    const captions = buildCaptionWords(built.words, out, result.exclusions).map(c => normalizeToken(c.text)).join(' ');
    expect(captions).not.toContain('revolutionized');
    expect(captions).toContain('redefined collaboration');
    expect(captions).not.toContain('move fast what we learned');
  });
  it('buildCaptionWords drops a word whose midpoint is inside an exclusion even if its start maps to a kept edge', () => {
    const words: WordToken[] = [{text: 'a', start: 0, end: 0.4}, {text: 'b', start: 0.5, end: 1.1}];
    const out = buildOutputTimeline([{sourceStart: 0, sourceEnd: 2, outputStart: 0}]);
    expect(buildCaptionWords(words, out, [{start: 0.45, end: 1.2}]).map(c => c.text)).toEqual(['a']);
  });
});

export type {WordToken};
