import {describe, expect, it} from 'vitest';

import {drawableTransitions, transitionIsDrawable, transitionWindow} from '../../../../remotion/src/lib/timeline.ts';
import {transitionClipSchema} from '../../../../remotion/src/blueprintSchema.ts';

const clip = (at: number, extra: Record<string, unknown> = {}) => ({at, duration: 0.38, keyword: 'film burn', assetUrl: '', blend: 'screen' as const, provider: 'generated' as const, providerId: 0, width: 1080, height: 1920, credit: '', creditUrl: '', ...extra});

describe('generated transition fallback (renderer contract)', () => {
  it('draws nothing for asset-less transitions unless renderGenerated is set (legacy output preserved)', () => {
    expect(transitionIsDrawable(clip(10))).toBe(false);
    expect(drawableTransitions([clip(10), clip(20)], 30, 900)).toEqual([]);
    expect(drawableTransitions([clip(10, {renderGenerated: true})], 30, 900)).toHaveLength(1);
    expect(drawableTransitions([clip(10, {assetUrl: 'https://x/leak.mp4'})], 30, 900)).toHaveLength(1);
  });

  it('starts the sweep a third before the cut so it peaks on it', () => {
    expect(transitionWindow({at: 10, duration: 0.4}, 30, 900)).toEqual({from: Math.round((10 - 0.14) * 30), durationInFrames: 12});
  });

  it('clips at both video boundaries and refuses unusable timing', () => {
    expect(transitionWindow({at: 0.05, duration: 0.4}, 30, 900)!.from).toBe(0);
    expect(transitionWindow({at: 29.95, duration: 0.8}, 30, 900)).toEqual({from: Math.round((29.95 - 0.28) * 30), durationInFrames: 900 - Math.round((29.95 - 0.28) * 30)});
    expect(transitionWindow({at: 31, duration: 0.4}, 30, 900)).toBeNull();
    expect(transitionWindow({at: 29.99, duration: 0.01}, 30, 900)).toBeNull();
    for (const bad of [{at: Number.NaN, duration: 0.4}, {at: 5, duration: 0}, {at: 5, duration: -1}, {at: -1, duration: 0.4}, {at: 5, duration: Infinity}]) {
      expect(transitionWindow(bad, 30, 900)).toBeNull();
    }
  });

  it('draws one sweep per cut even if the plan lists the same cut twice', () => {
    const drawn = drawableTransitions([clip(10.2, {renderGenerated: true}), clip(10, {renderGenerated: true}), clip(20, {renderGenerated: true})], 30, 900);
    expect(drawn.map(item => item.clip.at)).toEqual([10, 20]);
  });

  it('never merges asset transitions (legacy behaviour)', () => {
    expect(drawableTransitions([clip(10, {assetUrl: 'a'}), clip(10.1, {assetUrl: 'b'})], 30, 900)).toHaveLength(2);
  });

  it('round-trips renderGenerated through the blueprint schema; legacy clips still parse', () => {
    expect(transitionClipSchema.parse(clip(10, {renderGenerated: true})).renderGenerated).toBe(true);
    expect(transitionClipSchema.parse(clip(10)).renderGenerated).toBeUndefined();
  });
});
