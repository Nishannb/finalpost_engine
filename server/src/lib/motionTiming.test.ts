import {describe, expect, it} from 'vitest';

import {
  FRAME_INSET_ENTER_SEC,
  FRAME_INSET_EXIT_SEC,
  FRAME_INSET_MIN_STILL_SEC,
  SPLIT_ENTER_SEC,
  SPLIT_EXIT_SEC,
  SPLIT_MIN_STILL_SEC,
  frameInsetTotalSec,
  splitStillSec,
  splitTotalSec,
  zoomEnvelope,
} from './motionTiming.ts';

describe('splitStillSec', () => {
  it('keeps still photos parked at least 4s', () => {
    expect(splitStillSec({speechSec: 1.5, mediaKind: 'image'})).toBe(SPLIT_MIN_STILL_SEC);
    expect(splitStillSec({speechSec: 6, mediaKind: 'image'})).toBe(6);
  });

  it('plays a video clip fully after the enter, not a fixed still clock', () => {
    expect(
      splitStillSec({speechSec: 2, mediaKind: 'video', assetDurationSec: 5.2}),
    ).toBeCloseTo(5.2);
  });
});

describe('splitTotalSec', () => {
  it('is enter + still + exit so retract cannot start at 100% in', () => {
    const still = 4;
    const total = splitTotalSec(still);
    expect(total).toBeCloseTo(SPLIT_ENTER_SEC + still + SPLIT_EXIT_SEC);
    expect(total).toBeGreaterThan(SPLIT_ENTER_SEC + 3.9);
  });
});

describe('frameInsetTotalSec', () => {
  it('holds the inset long enough to read before restoring', () => {
    expect(frameInsetTotalSec(1)).toBe(
      FRAME_INSET_ENTER_SEC + FRAME_INSET_MIN_STILL_SEC + FRAME_INSET_EXIT_SEC,
    );
  });
});

describe('zoomEnvelope', () => {
  it('reaches full scale quickly then eases out over a longer retract', () => {
    expect(zoomEnvelope(5, 5, 8)).toBeCloseTo(0);
    expect(zoomEnvelope(5.35, 5, 8)).toBeGreaterThan(0.9);
    expect(zoomEnvelope(7.5, 5, 8)).toBeGreaterThan(0.15);
    expect(zoomEnvelope(7.5, 5, 8)).toBeLessThan(0.9);
    expect(zoomEnvelope(8, 5, 8)).toBeCloseTo(0);
  });
});
