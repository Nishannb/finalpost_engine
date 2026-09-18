import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {autoTrimSilence, isFillerToken, keepSegmentsFor} from './autoTrim.ts';

const word = (text: string, start: number, end: number): WordToken => ({
  text,
  start,
  end,
});

const spoken = (count: number, from: number, to: number): WordToken[] => {
  const span = Math.max(0.05, (to - from) / count);
  return Array.from({length: count}, (_, index) => {
    const start = from + index * span;
    return word(`w${index}`, start, start + span * 0.85);
  });
};

describe('autoTrimSilence', () => {
  const options = {thresholdSec: 0.4, paddingSec: 0.1, sourceDurationSec: 10};

  it('keeps a continuous take untouched', () => {
    const result = autoTrimSilence(spoken(8, 0, 10), options);
    expect(result.trimExclusions).toEqual([]);
    expect(result.removedSec).toBe(0);
    expect(result.keepSegments).toEqual([
      {sourceStart: 0, sourceEnd: 10, outputStart: 0},
    ]);
  });

  it('cuts a mid-clip pause and keeps the configured padding', () => {
    const result = autoTrimSilence(
      [
        word('a', 0, 0.25),
        word('b', 0.25, 0.5),
        word('c', 0.5, 0.75),
        word('d', 0.75, 1),
        word('e', 4, 5.5),
        word('f', 5.5, 7),
        word('g', 7, 8.5),
        word('h', 8.5, 10),
      ],
      options,
    );
    expect(result.trimExclusions).toEqual([{start: 1.1, end: 3.9}]);
    expect(result.removedSec).toBeCloseTo(2.8, 5);
    expect(result.keepSegments).toEqual([
      {sourceStart: 0, sourceEnd: 1.1, outputStart: 0},
      {sourceStart: 3.9, sourceEnd: 10, outputStart: 1.1},
    ]);
  });

  it('trims dead air before the first word from zero', () => {
    const result = autoTrimSilence(spoken(8, 3, 10), options);
    expect(result.trimExclusions).toEqual([{start: 0, end: 2.9}]);
    expect(result.keepSegments[0]).toEqual({
      sourceStart: 2.9,
      sourceEnd: 10,
      outputStart: 0,
    });
  });

  it('trims trailing dead air when it is a small tail', () => {
    const result = autoTrimSilence(spoken(8, 0, 8.5), options);
    expect(result.trimExclusions[0]?.end).toBe(10);
    expect(result.keepSegments[0]?.sourceStart).toBe(0);
    expect(result.removedSec).toBeGreaterThan(1);
    expect(result.removedSec).toBeLessThan(3);
  });

  it('ignores gaps at or below the threshold', () => {
    const result = autoTrimSilence(
      [
        word('a', 0, 1),
        word('b', 1.4, 2),
        word('c', 2.1, 3),
        word('d', 3.2, 4),
        word('e', 4.3, 5),
        word('f', 5.2, 10),
      ],
      options,
    );
    expect(result.trimExclusions).toEqual([]);
  });

  it('skips cuts that padding shrinks below the minimum seam', () => {
    const result = autoTrimSilence(
      [
        word('a', 0, 1),
        word('b', 1.45, 2),
        word('c', 2.1, 3),
        word('d', 3.2, 4),
        word('e', 4.3, 5),
        word('f', 5.2, 10),
      ],
      {...options, thresholdSec: 0.4, paddingSec: 0.22},
    );
    expect(result.trimExclusions).toEqual([]);
  });

  it('never returns an empty timeline when there are no words', () => {
    const result = autoTrimSilence([], options);
    expect(result.keepSegments).toEqual([
      {sourceStart: 0, sourceEnd: 10, outputStart: 0},
    ]);
    expect(result.skipped).toBe('no_words');
  });

  it('does not collapse a clip when ASR only heard a couple of words', () => {
    const result = autoTrimSilence([word('huh', 1, 1.4)], options);
    expect(result.skipped).toBe('sparse_speech');
    expect(result.removedSec).toBe(0);
    expect(result.keepSegments[0]?.sourceEnd).toBe(10);
  });

  it('keeps the original length if a trim would throw away most of the file', () => {
    const result = autoTrimSilence(spoken(8, 0, 1.2), options);
    expect(result.skipped).toBe('would_remove_too_much');
    expect(result.removedSec).toBe(0);
  });

  it('cuts isolated um/uh fillers but not rushed mid-phrase tokens', () => {
    const result = autoTrimSilence(
      [
        word('Hello', 0, 0.4),
        word('there', 0.45, 0.8),
        word('um', 1.1, 1.35),
        word('friends', 1.6, 2.1),
        word('and', 2.2, 2.4),
        word('uh', 2.55, 2.75),
        word('welcome', 3.0, 3.5),
        word('back', 3.55, 4.0),
      ],
      {...options, sourceDurationSec: 4.2, thresholdSec: 0.9},
    );
    expect(result.trimExclusions.some(range => range.start <= 1.2 && range.end >= 1.3)).toBe(
      true,
    );
  });

  it('treats hm as a filler token', () => {
    expect(isFillerToken('hm')).toBe(true);
    expect(isFillerToken('hmm')).toBe(true);
    expect(isFillerToken('uhm')).toBe(true);
  });
});

describe('keepSegmentsFor', () => {
  it('accumulates output offsets across multiple cuts', () => {
    const segments = keepSegmentsFor(
      [
        {start: 1, end: 2},
        {start: 5, end: 7},
      ],
      12,
    );
    expect(segments).toEqual([
      {sourceStart: 0, sourceEnd: 1, outputStart: 0},
      {sourceStart: 2, sourceEnd: 5, outputStart: 1},
      {sourceStart: 7, sourceEnd: 12, outputStart: 4},
    ]);
  });

  it('merges overlapping exclusions before inverting them', () => {
    const segments = keepSegmentsFor(
      [
        {start: 1, end: 4},
        {start: 3, end: 5},
      ],
      8,
    );
    expect(segments).toEqual([
      {sourceStart: 0, sourceEnd: 1, outputStart: 0},
      {sourceStart: 5, sourceEnd: 8, outputStart: 1},
    ]);
  });
});
