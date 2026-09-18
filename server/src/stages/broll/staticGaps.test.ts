import {describe, expect, it} from 'vitest';

import {findStaticGapStarts} from './brollPlanner.ts';

describe('findStaticGapStarts', () => {
  it('inserts mid-gap cutaways when talking-head runs long without visuals', () => {
    const starts = findStaticGapStarts({
      outputDurationSec: 30,
      clips: [{start: 8, end: 10.4} as never],
      overlays: [{layout: 'split', start: 20, end: 22.5} as never],
      maxTalkSec: 5.5,
      cutawayDurationSec: 2.4,
    });
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every(start => start >= 3.5)).toBe(true);
  });

  it('skips short gaps that already feel paced', () => {
    const starts = findStaticGapStarts({
      outputDurationSec: 18,
      clips: [
        {start: 4, end: 6.4} as never,
        {start: 9, end: 11.4} as never,
        {start: 14, end: 16.4} as never,
      ],
      overlays: [],
      maxTalkSec: 5.5,
      cutawayDurationSec: 2.4,
    });
    expect(starts).toEqual([]);
  });
});
