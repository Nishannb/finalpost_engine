import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {
  isNonSpeechToken,
  jaccardSimilarity,
  nonSpeechExclusions,
  scriptLinesFromText,
  scriptRetakeExclusions,
} from './scriptRetakeTrim.ts';

const word = (text: string, start: number, end: number): WordToken => ({
  text,
  start,
  end,
});

describe('scriptRetakeTrim', () => {
  it('splits script into lines', () => {
    const lines = scriptLinesFromText(
      'Hello everyone welcome\n\nThis is my second line here',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.[0]).toBe('hello');
  });

  it('scores jaccard overlap', () => {
    expect(
      jaccardSimilarity(['hello', 'world'], ['hello', 'world', 'today']),
    ).toBeCloseTo(2 / 3, 5);
  });

  it('keeps the last take of a repeated script line', () => {
    const script = 'I love this product so much\nTry it today please friends';
    // First take of line 1 (worse), pause, second take of line 1 (keeper), then line 2.
    const words: WordToken[] = [
      word('I', 0.0, 0.2),
      word('love', 0.2, 0.4),
      word('this', 0.4, 0.55),
      word('product', 0.55, 0.9),
      word('so', 0.9, 1.05),
      word('much', 1.05, 1.3),
      // long pause + retake
      word('I', 3.0, 3.2),
      word('love', 3.2, 3.4),
      word('this', 3.4, 3.55),
      word('product', 3.55, 3.9),
      word('so', 3.9, 4.05),
      word('much', 4.05, 4.35),
      word('Try', 4.5, 4.7),
      word('it', 4.7, 4.85),
      word('today', 4.85, 5.1),
      word('please', 5.1, 5.35),
      word('friends', 5.35, 5.7),
    ];
    const result = scriptRetakeExclusions(words, script, {
      sourceDurationSec: 6,
      utteranceGapSec: 0.5,
      minSimilarity: 0.4,
    });
    expect(result.droppedTakes).toBeGreaterThanOrEqual(1);
    expect(result.trimExclusions.length).toBeGreaterThanOrEqual(1);
    const cut = result.trimExclusions[0]!;
    expect(cut.start).toBeLessThan(2);
    expect(cut.end).toBeLessThanOrEqual(3.1);
  });

  it('detects cough tokens', () => {
    expect(isNonSpeechToken('[cough]')).toBe(true);
    expect(isNonSpeechToken('hello')).toBe(false);
    const cuts = nonSpeechExclusions(
      [
        word('hi', 0, 0.3),
        word('[cough]', 0.5, 0.9),
        word('there', 1.1, 1.4),
      ],
      {},
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.start).toBeLessThan(0.6);
  });
});
