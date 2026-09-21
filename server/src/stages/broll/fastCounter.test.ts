import {describe, expect, it} from 'vitest';

import {
  ensureHugeNumberCounters,
  hugeNumberHits,
  isHugeSpokenNumber,
  parseSpokenMagnitude,
} from './fastCounter.ts';

describe('fast counter edit tool', () => {
  it('treats 50B as a huge number and 5 weeks as not', () => {
    expect(isHugeSpokenNumber(parseSpokenMagnitude('50B')!)).toBe(true);
    expect(isHugeSpokenNumber(parseSpokenMagnitude('90k')!)).toBe(true);
    expect(isHugeSpokenNumber(parseSpokenMagnitude('5')!)).toBe(false);
  });

  it('finds a two-word magnitude on the spoken timeline', () => {
    const hits = hugeNumberHits([
      {text: 'We', start: 1, end: 1.2},
      {text: 'hit', start: 1.3, end: 1.5},
      {text: '50', start: 4.0, end: 4.2},
      {text: 'billion', start: 4.25, end: 4.7},
      {text: 'this', start: 4.8, end: 5.0},
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.countFrom).toBe(35);
    expect(hits[0]?.countTo).toBe(50);
    expect(hits[0]?.start).toBeCloseTo(4.0, 5);
  });

  it('does not inject a count treatment when the director omitted one', () => {
    const out = ensureHugeNumberCounters(
      [],
      [
        {text: 'sold', start: 2, end: 2.3},
        {text: '50B', start: 6.1, end: 6.6},
      ],
      20,
    );
    expect(out).toEqual([]);
  });
});
