import {kineticSplitCaptionLayout} from '../../../remotion/src/lib/captionSplit.ts';
import {KINETIC_MAX_CROP, SPLIT_ENTER_SEC, SPLIT_EXIT_SEC, kineticPlateSize, splitExitStartsAt, splitTiming} from '../../../remotion/src/lib/splitMotion.ts';
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

describe('2026-11-27 Kinetic B-roll split: motion fits the window, asset drawn large', () => {
  const ov = (start: number, end: number, extra: Record<string, unknown> = {}) => ({start, end, mediaKind: 'image', ...extra}) as unknown as Parameters<typeof splitTiming>[0];
  it('a 2.5 s Kinetic split enters and FINISHES its exit inside the window (it used to need ~6.8 s and vanished in one frame)', () => {
    const t = splitTiming(ov(4, 6.5, {kineticMotion: true}));
    expect(t.enter).toBeGreaterThanOrEqual(0.3);
    expect(t.exitAt + t.exit).toBeCloseTo(2.5, 5);
    expect(t.exitAt).toBeGreaterThan(t.enter);
  });
  it('without kineticMotion the legacy timing is unchanged', () => {
    const t = splitTiming(ov(4, 6.5));
    expect([t.enter, t.exit]).toEqual([SPLIT_ENTER_SEC, SPLIT_EXIT_SEC]);
    expect(t.exitAt).toBe(splitExitStartsAt(ov(4, 6.5)));
  });
  it('a landscape asset covers most of the 1080x960 half, cropping at most KINETIC_MAX_CROP of its width', () => {
    const s = kineticPlateSize(1600, 900, 1080, 960);
    expect(s.h / 960).toBeGreaterThan(0.8);
    expect(1 - 1080 / s.w).toBeLessThanOrEqual(KINETIC_MAX_CROP + 1e-3);
    expect(kineticPlateSize(1000, 900, 1080, 960)).toEqual({w: 1080, h: 972}); // near the half's shape: plain cover
  });
});

describe('2026-11-27 Kinetic split captions stay in the talking-head half', () => {
  it('speaker below the seam: the caption band is just under the seam (never over the asset half), centred; speaker above: the bottom of the upper half', () => {
    const base = {position: 'bottom' as const, bottomFrac: 0.14, frameTopFrac: 0, frameHeightFrac: 1};
    const below = kineticSplitCaptionLayout(base, 'bottom');
    expect(below.frameTopFrac).toBeGreaterThanOrEqual(0.5);
    expect(below.frameTopFrac + below.frameHeightFrac).toBeLessThanOrEqual(0.7);
    expect(below.position).toBe('center');
    const above = kineticSplitCaptionLayout(base, 'top');
    expect(above.frameTopFrac + above.frameHeightFrac).toBeLessThanOrEqual(0.5);
  });
});
