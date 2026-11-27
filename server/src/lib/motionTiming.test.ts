import {kineticSplitCaptionLayout} from '../../../remotion/src/lib/captionSplit.ts';
import {KINETIC_FIT_SETTLE_FROM, SPLIT_ENTER_SEC, SPLIT_EXIT_SEC, kineticFitScale, kineticFitSize, kineticSplitMediaBox, splitExitStartsAt, splitTiming} from '../../../remotion/src/lib/splitMotion.ts';
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
  it('2026-11-28: a creator asset is shown WHOLE (contain, never cropped), as large as the box allows', () => {
    // landscape 16:9 in the 1080 x 960 half: full width, nothing cut
    expect(kineticFitSize(1600, 900, 1080, 960)).toEqual({w: 1080, h: 607});
    // 4:3 that is taller than the half allows at full width: fits the height, still whole
    expect(kineticFitSize(1080, 1000, 1080, 960)).toEqual({w: 1036, h: 960});
    // portrait 3:4 full frame (1080 x 1920): full width, bands above / below, no crop
    expect(kineticFitSize(3024, 4032, 1080, 1920)).toEqual({w: 1080, h: 1440});
    // a phone screenshot taller than 9:16: fits the height
    const tall = kineticFitSize(1179, 2556, 1080, 1920);
    expect(tall.h).toBe(1920);
    expect(tall.w).toBeLessThanOrEqual(1080);
  });
  it('2026-11-28: the settle-in never grows past the fitted size (so it never crops), and the split box stays clear of the seam fade', () => {
    for (const f of [0, 5, 30, 90, 300]) {
      const s = kineticFitScale(f, 90);
      expect(s).toBeGreaterThanOrEqual(KINETIC_FIT_SETTLE_FROM);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(kineticFitScale(90, 90)).toBe(1);
    const box = kineticSplitMediaBox(1080, 1920);
    expect(box.w).toBe(1080);
    expect(box.h).toBeLessThan(960);
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
