import {describe, expect, it} from 'vitest';

import {findStaticGapStarts} from './brollPlanner.ts';

describe('findStaticGapStarts', () => {
  it('does not invent cutaways in talking-head gaps', () => {
    const starts = findStaticGapStarts({
      outputDurationSec: 30,
      clips: [{start: 8, end: 10.4} as never],
      overlays: [{layout: 'split', start: 20, end: 22.5} as never],
      maxTalkSec: 5.5,
      cutawayDurationSec: 2.4,
    });
    expect(starts).toEqual([]);
  });
});
