import {describe, expect, it} from 'vitest';

import type {TimeRange, WordToken} from '../../types/blueprint.ts';
import {autoTrimSilence, isFillerToken} from './autoTrim.ts';
import {inPlaceWordSwaps, intraUtteranceRestarts, isRetakeOf, transcriptRetakeExclusions, wordsOutsideRanges} from './transcriptRetakeTrim.ts';

/** One spoken sentence as word tokens: `wordSec` per word, `gapSec` between words. */
const say = (text: string, start: number, wordSec = 0.28, gapSec = 0.06): {words: WordToken[]; end: number} => {
  let cursor = start;
  const words = text.split(/\s+/).map(token => {
    const word = {text: token, start: cursor, end: cursor + wordSec};
    cursor += wordSec + gapSec;
    return word;
  });
  return {words, end: words.at(-1)!.end};
};

/** Takes spoken one after another with `pauseSec` of silence between them; returns words and each take's span. */
const timeline = (takes: string[], pauseSec = 1.0, from = 0.2) => {
  const words: WordToken[] = [];
  const spans: Array<{start: number; end: number}> = [];
  let cursor = from;
  for (const take of takes) {
    const spoken = say(take, cursor);
    words.push(...spoken.words);
    spans.push({start: spoken.words[0]!.start, end: spoken.end});
    cursor = spoken.end + pauseSec;
  }
  return {words, spans, end: cursor};
};

const FIGMA_1 = 'this is exactly how figma revolutionized collaboration in design';
const FIGMA_2 = 'this is exactly how figma redefined collaboration for design teams';
const BEAT_A = 'first we open the file and pick a frame to work on';
const BEAT_B = 'then we add auto layout to every button on the screen';
const BEAT_C = 'finally we share the prototype link with the whole team';

const insideAny = (point: number, ranges: TimeRange[]) => ranges.some(range => point >= range.start && point <= range.end);
const overlaps = (a: {start: number; end: number}, ranges: TimeRange[]) => ranges.some(range => range.start < a.end && range.end > a.start);

describe('transcriptRetakeExclusions: what counts as another take', () => {
  it('an exact retake: the earlier take is cut, the last take is kept', () => {
    const t = timeline([BEAT_A, FIGMA_1, FIGMA_1, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(1);
    expect(result.clusters).toBe(1);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(false);
    expect(overlaps(t.spans[0]!, result.trimExclusions)).toBe(false);
    expect(overlaps(t.spans[3]!, result.trimExclusions)).toBe(false);
  });

  it('a near-duplicate with a swapped verb and noun (the uncut.mp4 case) is a retake', () => {
    const t = timeline([BEAT_A, FIGMA_1, FIGMA_2, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(1);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(false);
  });

  it('a false start (the cut-off first half of the same sentence) is dropped', () => {
    const t = timeline([BEAT_A, 'this is exactly how figma revolutionized', FIGMA_2, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(1);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(false);
  });

  it('three takes of one line keep exactly one (the last)', () => {
    const t = timeline([FIGMA_1, FIGMA_1, FIGMA_2, BEAT_A, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(2);
    expect(result.clusters).toBe(1);
    expect(overlaps(t.spans[0]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(false);
  });

  it('fillers inside a take do not stop it matching (um / uh are ignored when comparing)', () => {
    const t = timeline([BEAT_A, 'this is um exactly how figma uh revolutionized collaboration in design', FIGMA_2, BEAT_B]);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end}).droppedTakes).toBe(1);
  });

  it('works without any script text: the function takes only words and options', () => {
    expect(transcriptRetakeExclusions.length).toBe(2);
  });
});

describe('keep rule', () => {
  it('the last take is kept by default', () => {
    const t = timeline([FIGMA_1, FIGMA_2, BEAT_A, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(overlaps(t.spans[0]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(false);
  });

  it('an earlier take that is clearly more complete is kept instead, when the last attempt was cut short', () => {
    const full = 'this is exactly how figma redefined collaboration for design teams and for whole companies around the world';
    const shortLast = 'this is exactly how figma redefined collaboration for design teams';
    const t = timeline([BEAT_A, full, shortLast, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(1);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(false);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(true);
  });

  it('a slightly longer earlier take does not beat the last one (it must be clearly longer)', () => {
    const t = timeline([BEAT_A, `${FIGMA_2} today`, FIGMA_2, BEAT_B]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(false);
  });
});

describe('what is not a retake', () => {
  it('adjacent beats that make different points are all kept', () => {
    const t = timeline([BEAT_A, BEAT_B, BEAT_C, FIGMA_1]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.trimExclusions).toEqual([]);
    expect(result.droppedTakes).toBe(0);
    expect(result.clusters).toBe(0);
    expect(result.skipped).toBeUndefined();
  });

  it('two sentences that only share function words are not takes of one line', () => {
    expect(isRetakeOf('we are going to the store and then to the park'.split(' '), 'we are going to the office and then to the bank'.split(' '))).toBe(false);
    expect(isRetakeOf(['this', 'is', 'the', 'one', 'that', 'you', 'want'], ['this', 'is', 'the', 'one', 'that', 'we', 'need'])).toBe(false);
  });

  it('a short interjection is never a take', () => {
    const t = timeline([FIGMA_1, 'yeah right', 'yeah right', BEAT_B]);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end}).trimExclusions).toEqual([]);
  });

  it('the same line spoken far apart (a deliberate refrain, over 25 s) is left alone', () => {
    const t = timeline([FIGMA_2, BEAT_A, BEAT_B, BEAT_C, `${BEAT_A} again`, `${BEAT_B} again`, FIGMA_2], 5);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(overlaps(t.spans[0]!, result.trimExclusions)).toBe(false);
    expect(overlaps(t.spans[6]!, result.trimExclusions)).toBe(false);
  });

  it('the isRetakeOf rule needs enough tokens and shared content words', () => {
    expect(isRetakeOf(['one', 'two', 'three'], ['one', 'two', 'three', 'four'])).toBe(false);
    expect(isRetakeOf('the and of to in on at for with'.split(' '), 'the and of to in on at for with'.split(' '))).toBe(false);
  });
});

describe('cut ranges and safety', () => {
  it('a cut stays inside the dropped take\'s own utterance window and never reaches a neighbouring utterance', () => {
    const t = timeline([BEAT_A, FIGMA_1, FIGMA_2, BEAT_B], 0.7);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, paddingSec: 0.5});
    for (const range of result.trimExclusions) {
      expect(range.start).toBeGreaterThanOrEqual(t.spans[0]!.end);
      expect(range.end).toBeLessThanOrEqual(t.spans[2]!.start);
    }
  });

  it('too few words: nothing is done', () => {
    const t = timeline(['this is exactly how figma changed', 'this is exactly how figma changed']);
    const result = transcriptRetakeExclusions(t.words.slice(0, 11), {sourceDurationSec: t.end});
    expect(result.skipped).toBe('sparse_speech');
    expect(result.trimExclusions).toEqual([]);
  });

  it('a transcript that is mostly repeats (junk ASR) is left whole: too many takes, or too much of the source', () => {
    const t = timeline([FIGMA_1, FIGMA_1, FIGMA_1, FIGMA_1, FIGMA_1, FIGMA_1, FIGMA_1, BEAT_A]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.trimExclusions).toEqual([]);
    expect(result.droppedTakes).toBe(0);
    expect(['too_many_takes', 'would_remove_too_much']).toContain(result.skipped);
  });

  it('the removal-fraction guard: a small allowance leaves the video whole', () => {
    const t = timeline([BEAT_A, FIGMA_1, FIGMA_2, BEAT_B, BEAT_C, 'and that is how the whole thing comes together in the end', 'thanks for watching see you next time everyone'], 0.8);
    const loose = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, maxRemovalFrac: 0.3});
    expect(loose.droppedTakes).toBe(1);
    const strict = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, maxRemovalFrac: 0.05});
    expect(strict.trimExclusions).toEqual([]);
    expect(strict.skipped).toBe('would_remove_too_much');
  });

  it('a single take of everything: nothing to do and no skip reason', () => {
    const t = timeline([BEAT_A, BEAT_B, BEAT_C]);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end})).toEqual({trimExclusions: [], droppedTakes: 0, clusters: 0, restarts: 0});
  });

  it('does not mutate its input', () => {
    const t = timeline([BEAT_A, FIGMA_1, FIGMA_2, BEAT_B]);
    const frozen = Object.freeze(t.words.map(word => Object.freeze({...word})));
    expect(() => transcriptRetakeExclusions(frozen, {sourceDurationSec: t.end})).not.toThrow();
  });
});

describe('wordsOutsideRanges', () => {
  it('drops the words whose midpoint is inside a range and keeps the rest', () => {
    const words = [{text: 'a', start: 0, end: 1}, {text: 'b', start: 1, end: 2}, {text: 'c', start: 2, end: 3}];
    expect(wordsOutsideRanges(words, [{start: 0.9, end: 2.1}]).map(word => word.text)).toEqual(['a', 'c']);
    expect(wordsOutsideRanges(words, [])).toEqual(words);
  });
  it('words already cut by the script path are not judged again', () => {
    const t = timeline([BEAT_A, FIGMA_1, FIGMA_2, BEAT_B]);
    const cut = [{start: t.spans[1]!.start - 0.05, end: t.spans[1]!.end + 0.05}];
    const remaining = wordsOutsideRanges(t.words, cut);
    expect(transcriptRetakeExclusions(remaining, {sourceDurationSec: t.end}).droppedTakes).toBe(0);
    expect(insideAny(t.spans[1]!.start, cut)).toBe(true);
  });
});

describe('autoTrimSilence: isolated hesitation sounds still get cut (the expressive-skipped path)', () => {
  // The source ends right after the last word, so the dead-air guard is not what these tests exercise.
  const optionsFor = (words: WordToken[]) => ({thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: words.at(-1)!.end + 0.1});
  const speech = (filler: string, gapBefore: number, gapAfter: number, span = 0.3) => {
    const words: WordToken[] = [];
    let cursor = 0.2;
    for (const token of 'so the plan for this week is quite simple'.split(' ')) {
      words.push({text: token, start: cursor, end: cursor + 0.25});
      cursor += 0.3;
    }
    cursor = words.at(-1)!.end + gapBefore;
    const fillerWord = {text: filler, start: cursor, end: cursor + span};
    words.push(fillerWord);
    cursor = fillerWord.end + gapAfter;
    for (const token of 'we ship the editor on friday'.split(' ')) {
      words.push({text: token, start: cursor, end: cursor + 0.25});
      cursor += 0.3;
    }
    return {words, fillerWord, before: words.find(word => word.text === 'quite' || word.text === 'simple')};
  };

  it('um / uh / uhm / hm / hmm with a slight pause are cut (as before)', () => {
    for (const filler of ['um', 'Um,', 'uh', 'uhm', 'hm', 'Hmm.']) {
      const {words, fillerWord} = speech(filler, 0.15, 0.15);
      const result = autoTrimSilence(words, optionsFor(words));
      expect(result.trimExclusions.some(range => range.start <= fillerWord.start + 0.05 && range.end >= fillerWord.end - 0.05), filler).toBe(true);
    }
  });

  it('a hesitation sound that ASR glued to its neighbours (gaps under 0.04 s) is now cut, without clipping the words next to it', () => {
    for (const filler of ['um', 'uh', 'uhm', 'erm', 'hm', 'hmm', 'mm']) {
      const {words, fillerWord} = speech(filler, 0.0, 0.0, 0.32);
      const previous = words[words.indexOf(fillerWord) - 1]!;
      const next = words[words.indexOf(fillerWord) + 1]!;
      const result = autoTrimSilence(words, optionsFor(words));
      const cut = result.trimExclusions.find(range => range.start < fillerWord.end && range.end > fillerWord.start);
      expect(cut, filler).toBeDefined();
      expect(cut!.start, filler).toBeGreaterThanOrEqual(previous.end - 1e-6);
      expect(cut!.end, filler).toBeLessThanOrEqual(next.start + 1e-6);
      expect(cut!.end - cut!.start, filler).toBeGreaterThan(0.2);
    }
  });

  it('"ah", "eh", "huh" stay under the old guard when glued (they can be speech) and are not cut', () => {
    for (const filler of ['ah', 'eh', 'huh']) {
      const {words, fillerWord} = speech(filler, 0.0, 0.0, 0.3);
      const result = autoTrimSilence(words, optionsFor(words));
      expect(result.trimExclusions.some(range => range.start < fillerWord.end && range.end > fillerWord.start), filler).toBe(false);
    }
  });

  it('content words are never cut as fillers: like, you know, so, well, actually, basically', () => {
    for (const word of ['like', 'know', 'so', 'well', 'actually', 'basically', 'right']) {
      expect(isFillerToken(word), word).toBe(false);
      const {words, fillerWord} = speech(word, 0.0, 0.0, 0.3);
      const result = autoTrimSilence(words, optionsFor(words));
      expect(result.trimExclusions.some(range => range.start < fillerWord.end && range.end > fillerWord.start), word).toBe(false);
    }
  });

  it('a long "um" (over 0.85 s) is still left alone as before', () => {
    const {words, fillerWord} = speech('um', 0.0, 0.0, 0.9);
    expect(autoTrimSilence(words, optionsFor(words)).trimExclusions.some(range => range.start < fillerWord.end && range.end > fillerWord.start)).toBe(false);
  });

  it('the removal guard still protects a junk transcript', () => {
    const words = Array.from({length: 10}, (_, index) => ({text: 'um', start: index * 1.0, end: index * 1.0 + 0.5}));
    expect(autoTrimSilence(words, {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: 10}).skipped).toBe('would_remove_too_much');
  });
});

// ---- WP6B: the observed uncut.mp4 mash, and restarts inside one utterance ------------------------------------------------------------------------------------------------
// The caption sample from the real run was: "This is exactly how Figma revolutionized Redefined collaboration in design for design." The two fixtures below model how such a mash arises
// from raw footage: (1) two takes with a verb swap spoken with a messy pause between them; (2) the same restart spoken in one breath (no pause long enough to split an utterance).
const MASH_TAKE_1 = 'this is exactly how figma revolutionized collaboration in design';
const MASH_TAKE_2 = 'this is exactly how figma redefined collaboration in design for design';
const MASH_FALSE_START = 'this is exactly how figma revolutionized';

describe('WP6B fixture 1: the mash as two takes with a messy pause', () => {
  it('drops the earlier take and keeps one, so the captions cannot carry both verbs', () => {
    const t = timeline([BEAT_A, MASH_TAKE_1, MASH_TAKE_2, BEAT_B, BEAT_C], 0.75);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(1);
    expect(result.restarts).toBe(0);
    expect(overlaps(t.spans[1]!, result.trimExclusions)).toBe(true);
    expect(overlaps(t.spans[2]!, result.trimExclusions)).toBe(false);
    const kept = t.words.filter(word => !insideAny((word.start + word.end) / 2, result.trimExclusions)).map(word => word.text).join(' ');
    expect(kept).toContain('redefined');
    expect(kept).not.toContain('revolutionized');
    expect(kept.match(/this is exactly how figma/g)).toHaveLength(1);
  });
});

describe('WP6B fixture 2: the same restart in one breath (no pause that splits an utterance)', () => {
  // gaps between the takes are 0.2 s, under the 0.55 s utterance gap, so everything is ONE utterance and the take rule cannot see it
  const oneBreath = (takes: string[]) => timeline(takes, 0.2);

  it('the two takes really form a single utterance (this is the gap the take rule leaves)', () => {
    const t = oneBreath([MASH_FALSE_START, MASH_TAKE_2]);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end}).clusters).toBe(0);
  });

  it('a false start followed by the fuller restatement: the false start is cut, the restatement is kept', () => {
    const t = oneBreath([BEAT_A, MASH_FALSE_START, MASH_TAKE_2]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.restarts).toBe(1);
    expect(result.droppedTakes).toBe(1);
    expect(result.clusters).toBe(0);
    const kept = t.words.filter(word => !insideAny((word.start + word.end) / 2, result.trimExclusions)).map(word => word.text).join(' ');
    expect(kept).not.toContain('revolutionized');
    expect(kept).toContain('redefined collaboration in design for design');
    expect(kept.match(/this is exactly how figma/g)).toHaveLength(1);
    expect(kept).toContain('first we open the file'); // the first beat is untouched
  });

  it('the cut is exactly the abandoned span: it ends before the restatement and does not touch the words before it', () => {
    const t = oneBreath([BEAT_A, MASH_FALSE_START, MASH_TAKE_2]);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    const abandoned = t.words.filter(word => ['this', 'is', 'exactly', 'how', 'figma', 'revolutionized'].includes(word.text)).slice(0, 6);
    const restated = t.words.filter(word => word.text === 'redefined')[0]!;
    const beatEnd = t.words.find(word => word.text === 'on')!.end;
    for (const range of result.trimExclusions) {
      expect(range.start).toBeGreaterThanOrEqual(beatEnd - 1e-6);
      expect(range.end).toBeLessThanOrEqual(restated.start);
    }
    expect(result.trimExclusions.some(range => range.start <= abandoned[0]!.start && range.end >= abandoned[5]!.end)).toBe(true);
  });

  it('a full near-duplicate sentence restated in one breath (verb swap) is also cut', () => {
    const t = oneBreath([BEAT_A, 'this is exactly how figma revolutionized collaboration in design', 'this is exactly how figma redefined collaboration for design teams']);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.restarts).toBe(1);
    const kept = t.words.filter(word => !insideAny((word.start + word.end) / 2, result.trimExclusions)).map(word => word.text).join(' ');
    expect(kept).not.toContain('revolutionized');
    expect(kept).toContain('redefined collaboration for design teams');
  });

  it('two restarts in one breath: both abandoned attempts are cut and the last statement is kept', () => {
    const t = oneBreath([BEAT_A, 'this is exactly how figma', MASH_FALSE_START, MASH_TAKE_2]);
    // in this short clip the two abandoned attempts are about 30% of the source, which is the default removal guard, so the guard is the thing that stops it:
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end}).skipped).toBe('would_remove_too_much');
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, maxRemovalFrac: 0.5});
    expect(result.restarts).toBe(2);
    const kept = t.words.filter(word => !insideAny((word.start + word.end) / 2, result.trimExclusions)).map(word => word.text).join(' ');
    expect(kept.match(/this is exactly how figma/g)).toHaveLength(1);
    expect(kept).toContain('redefined collaboration in design for design');
  });

  it('fillers inside the false start do not hide it', () => {
    const t = oneBreath([BEAT_A, 'this is exactly how figma um revolutionized', MASH_TAKE_2]);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end}).restarts).toBe(1);
  });

  it('an utterance already dropped as a whole take is not cut a second time', () => {
    const t = timeline([BEAT_A, MASH_TAKE_1, MASH_TAKE_1, BEAT_B], 0.75);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end});
    expect(result.droppedTakes).toBe(1);
    expect(result.restarts).toBe(0);
  });
});

describe('intraUtteranceRestarts (pure rule)', () => {
  const tokens = (text: string) => text.split(' ');

  it('finds the abandoned span and where the restatement starts', () => {
    expect(intraUtteranceRestarts(tokens('this is exactly how figma revolutionized this is exactly how figma redefined collaboration in design'))).toEqual([{from: 0, to: 6}]);
  });

  it('finds a restart that begins mid-utterance', () => {
    const found = intraUtteranceRestarts(tokens('so today we are looking at this is exactly how figma revolutionized this is exactly how figma redefined collaboration in design'));
    expect(found).toEqual([{from: 6, to: 12}]);
  });

  it('distinct speech is untouched, including parallel phrasing with a repeated function-word opening', () => {
    expect(intraUtteranceRestarts(tokens('the plan is simple and the plan is to ship fast on friday'))).toEqual([]);
    expect(intraUtteranceRestarts(tokens('we ship the editor on friday and we ship the docs on monday morning'))).toEqual([]);
    expect(intraUtteranceRestarts(tokens('first we open the file and pick a frame to work on then we add auto layout'))).toEqual([]);
  });

  it('a two-word stutter is not a restart (the repeated opening must be at least three tokens with two content words)', () => {
    expect(intraUtteranceRestarts(tokens('we ship we ship the editor on friday and the docs on monday'))).toEqual([]);
    expect(intraUtteranceRestarts(tokens('this is the one this is the one that we really want to ship'))).toEqual([]);
  });

  it('a restatement shorter than the abandoned span is not taken for a restart', () => {
    expect(intraUtteranceRestarts(tokens('this is exactly how figma revolutionized collaboration in design teams this is exactly how'))).toEqual([]);
  });

  it('short utterances (under eight tokens) are left alone', () => {
    expect(intraUtteranceRestarts(tokens('this is exactly how this is exactly'))).toEqual([]);
    expect(intraUtteranceRestarts(tokens('figma redefined collaboration figma redefined collaboration'))).toEqual([]);
  });

  it('the per-utterance removal cap: when most of the utterance would go, nothing is cut', () => {
    expect(intraUtteranceRestarts(tokens('we ship the editor we ship the editor we ship the editor'))).toEqual([]);
  });

  it('the span limit: an opening restated much later is not a restart', () => {
    const filler = Array.from({length: 22}, (_, index) => `word${index}`).join(' ');
    expect(intraUtteranceRestarts(tokens(`this is exactly how figma ${filler} this is exactly how figma redefined collaboration in design for design today`))).toEqual([]);
  });
});

describe('WP6B safety guards still hold', () => {
  it('the global removal guard covers the restart cuts too', () => {
    const t = timeline([MASH_FALSE_START, MASH_TAKE_2], 0.2);
    const loose = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, maxRemovalFrac: 0.6});
    expect(loose.restarts).toBe(1);
    const strict = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, maxRemovalFrac: 0.05});
    expect(strict.trimExclusions).toEqual([]);
    expect(strict.skipped).toBe('would_remove_too_much');
  });

  it('too few words: nothing is done even if a restart is present', () => {
    const t = timeline([MASH_FALSE_START], 0.2);
    expect(transcriptRetakeExclusions(t.words.slice(0, 11), {sourceDurationSec: t.end}).skipped).toBe('sparse_speech');
  });

  it('ordinary continuous speech (no restarts, no retakes) is not changed', () => {
    const t = timeline([BEAT_A, BEAT_B, BEAT_C], 0.2);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end})).toEqual({trimExclusions: [], droppedTakes: 0, clusters: 0, restarts: 0});
  });

  it('a cut never starts before the end of the previous utterance', () => {
    const t = timeline([BEAT_A, MASH_FALSE_START, MASH_TAKE_2], 0.2);
    const first = say(BEAT_A, 0.2);
    const result = transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end, paddingSec: 1});
    for (const range of result.trimExclusions) expect(range.start).toBeGreaterThanOrEqual(first.end - 1e-6);
  });

  it('does not mutate its input', () => {
    const t = timeline([MASH_FALSE_START, MASH_TAKE_2, BEAT_A], 0.2);
    const frozen = Object.freeze(t.words.map(word => Object.freeze({...word})));
    expect(() => transcriptRetakeExclusions(frozen, {sourceDurationSec: t.end})).not.toThrow();
  });

  it('WP6C superseded the old not-detected case: the in-place swap is now cut (see the WP6C block)', () => {
    const t = timeline([BEAT_A, 'this is exactly how figma revolutionized redefined collaboration in design for design'], 0.2);
    expect(transcriptRetakeExclusions(t.words, {sourceDurationSec: t.end}).restarts).toBe(1);
  });
});

describe('WP6C: in-place alternative-word swap', () => {
  const MASH = 'this is exactly how figma revolutionized redefined collaboration in design for design';
  const toks = (text: string) => text.split(/\s+/);
  const clip = (text: string) => say(text, 0.2).words;
  const opts = (words: WordToken[]) => ({sourceDurationSec: words.at(-1)!.end + 0.1, maxRemovalFrac: 0.5});

  it('finds exactly the abandoned verb in the uncut-shaped mash', () => {
    expect(inPlaceWordSwaps(toks(MASH))).toEqual([{from: 5, to: 6}]);
  });

  it('cuts only the abandoned word in time and keeps the restatement', () => {
    const words = clip(MASH);
    const result = transcriptRetakeExclusions(words, opts(words));
    expect(result.skipped).toBeUndefined();
    expect(result.restarts).toBe(1);
    expect(result.droppedTakes).toBe(1);
    expect(result.trimExclusions).toHaveLength(1);
    expect(insideAny((words[5]!.start + words[5]!.end) / 2, result.trimExclusions)).toBe(true);
    expect(insideAny((words[6]!.start + words[6]!.end) / 2, result.trimExclusions)).toBe(false);
    expect(insideAny((words[4]!.start + words[4]!.end) / 2, result.trimExclusions)).toBe(false);
    expect(insideAny((words[7]!.start + words[7]!.end) / 2, result.trimExclusions)).toBe(false);
  });

  it('allows a repeated function-word tail', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionized the redefined the collaboration in design'))).toEqual([{from: 5, to: 7}]);
  });

  it('keeps distinct verbs in a real sentence', () => {
    expect(inPlaceWordSwaps(toks('figma designed and shipped collaboration tools for every team'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('figma designed then shipped collaboration tools for every team'))).toEqual([]);
    const words = clip('figma designed and shipped collaboration tools for every team');
    expect(transcriptRetakeExclusions(words, opts(words)).trimExclusions).toEqual([]);
  });

  it('keeps a tail that is not repeated, and a tail that is a conjunction', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionized the redefined collaboration in design'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma designed or shipped collaboration tools for teams'))).toEqual([]);
  });

  it('keeps stacked adjectives after a linking or degree word', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma was limited detailed collaboration in design'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('the new plan is very limited detailed collaboration in design'))).toEqual([]);
  });

  it('needs left context, right context and enough words', () => {
    expect(inPlaceWordSwaps(toks('it revolutionized redefined collaboration in design for teams'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionized redefined'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is how figma revolutionized redefined the way'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('figma revolutionized redefined it'))).toEqual([]);
  });

  it('ignores same-stem pairs, short words, and other verb forms', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma designed designed collaboration in design'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma liked used collaboration in design for design'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionizing redefining collaboration in design'))).toEqual([]);
  });

  it('caps the share removed from one utterance', () => {
    expect(inPlaceWordSwaps(toks('team revolutionized redefined work then reshaped rebuilt tools'))).toEqual([]);
  });

  it('does not cut twice when a swap sits inside a WP6B restart span', () => {
    const words = clip('this is exactly how figma revolutionized redefined this is exactly how figma revolutionized redefined collaboration in design for teams');
    const result = transcriptRetakeExclusions(words, {...opts(words), maxRemovalFrac: 0.6});
    // One restart span (the whole first attempt, its inner swap not cut again) plus the swap left in the kept restatement.
    expect(result.restarts).toBe(2);
    expect(result.trimExclusions).toHaveLength(2);
    expect(result.trimExclusions[0]!.end).toBeLessThanOrEqual(result.trimExclusions[1]!.start);
  });

  it('still cuts the retake with a pause and the restart with a repeated opening', () => {
    const takes = timeline([FIGMA_1, FIGMA_2, BEAT_A], 1.0);
    const retake = transcriptRetakeExclusions(takes.words, {sourceDurationSec: takes.end, maxRemovalFrac: 0.5});
    expect(retake.droppedTakes).toBeGreaterThanOrEqual(1);
    expect(retake.restarts).toBe(0);
    expect(intraUtteranceRestarts(toks('this is exactly how figma revolutionized this is exactly how figma redefined collaboration in design'))).toEqual([{from: 0, to: 6}]);
  });

  it('respects the global removal guard and the sparse-speech guard', () => {
    const words = clip(MASH);
    const tight = transcriptRetakeExclusions(words, {sourceDurationSec: 1.5, maxRemovalFrac: 0.05});
    expect(tight.skipped).toBe('would_remove_too_much');
    expect(tight.trimExclusions).toEqual([]);
    expect(transcriptRetakeExclusions(words.slice(0, 8), opts(words)).skipped).toBe('sparse_speech');
  });
});

describe('WP6E: widened self-correction (irregular, same lemma, noun retry)', () => {
  const toks = (text: string) => text.split(/\s+/);
  const clip = (text: string) => say(text, 0.2).words;
  const opts = (words: WordToken[]) => ({sourceDurationSec: words.at(-1)!.end + 0.1, maxRemovalFrac: 0.5});

  it('cuts the abandoned irregular past (built/rebuilt, made/remade, took/made)', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma built rebuilt collaboration in design for teams'))).toEqual([{from: 5, to: 6}]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma made remade collaboration in design for teams'))).toEqual([{from: 5, to: 6}]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma took made collaboration in design for teams'))).toEqual([{from: 5, to: 6}]);
  });

  it('keeps ordinary irregular verbs, auxiliaries and mixed pairs', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma built and made collaboration in design'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how the file got built collaboration in design tools'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how the team had made collaboration in design tools'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma built designed collaboration in design for teams'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma was built made collaboration in design for teams'))).toEqual([]);
  });

  it('cuts a same-lemma restart but not short stems or other lemmas', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionize revolutionized collaboration in design'))).toEqual([{from: 5, to: 6}]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma design designed collaboration in design for teams'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionizing redefining collaboration in design'))).toEqual([]);
  });

  it('cuts a determiner + noun retry and keeps the restatement', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how the plan the strategy for design teams'))).toEqual([{from: 4, to: 6}]);
    const words = clip('so this is exactly how the plan the strategy for design teams works today');
    const result = transcriptRetakeExclusions(words, opts(words));
    expect(result.restarts).toBe(1);
    expect(insideAny((words[5]!.start + words[5]!.end) / 2, result.trimExclusions)).toBe(true);
    expect(insideAny((words[7]!.start + words[7]!.end) / 2, result.trimExclusions)).toBe(false);
  });

  it('keeps lists, different determiners, conjunction frames and short context', () => {
    expect(inPlaceWordSwaps(toks('this is exactly the good the bad the ugly of design'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('we love exactly the plan and the strategy for design teams'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly the plan a strategy for design teams'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('the plan the strategy for design teams and tools'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly the plan the same for design'))).toEqual([]);
  });

  it('WP6C cases are unchanged', () => {
    expect(inPlaceWordSwaps(toks('this is exactly how figma revolutionized redefined collaboration in design for design'))).toEqual([{from: 5, to: 6}]);
    expect(inPlaceWordSwaps(toks('figma designed and shipped collaboration tools for every team'))).toEqual([]);
    expect(inPlaceWordSwaps(toks('this is exactly how figma was limited detailed collaboration in design'))).toEqual([]);
  });
});

describe('WP6E: filler spellings', () => {
  const fillers = ['um', 'Um,', 'umm', 'ummm.', 'uh', 'Uhh', 'uhhm', 'uhm', 'erm', 'ehm', 'ahm', 'hm', 'hmm', 'Hmmm?', 'mm', 'mmm', 'mhm', 'mmhm', 'um...', 'um\u2026', '(um)', '"hmm"', '\u2014uh', 'uh-', '[uh]', '\u201cum,\u201d'];
  it.each(fillers)('%s is a filler', token => expect(isFillerToken(token)).toBe(true));
  it.each(['like', 'you', 'know', 'umbrella', 'human', 'hum', 'summer', 'ham', 'mum', 'er', 'ER', '...', 'the', 'ugh', 'yum'])('%s is not a filler', token => expect(isFillerToken(token)).toBe(false));
  it.each(['(um...)', '"hmm"', '\u2014uh', 'ummm.', 'uhhm', 'ehm', 'mmhm'])('a glued, wrapped hesitation %s is cut; "like" next to it is kept', spelled => {
    const texts = ['we', 'open', spelled, 'the', 'like', 'file', 'and', 'then', 'we', 'add', 'auto', 'layout', 'to', 'every', 'button', 'now'];
    const words: WordToken[] = texts.map((text, index) => ({text, start: index * 0.3, end: index * 0.3 + 0.3}));
    const result = autoTrimSilence(words, {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: words.at(-1)!.end + 0.1});
    const filler = words[2]!;
    const like = words[4]!;
    expect(result.trimExclusions.some(range => range.start <= filler.start + 0.05 && range.end >= filler.end - 0.05)).toBe(true);
    expect(result.trimExclusions.some(range => range.start < like.end && range.end > like.start)).toBe(false);
  });
});
