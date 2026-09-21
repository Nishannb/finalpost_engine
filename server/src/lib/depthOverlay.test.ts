import {describe, expect, it} from 'vitest';

import {
  DEFAULT_DEPTH_OVERLAY_PARAMS,
  getOverlayTransform,
  overlayLayerMode,
  validateDepthOverlays,
} from './depthOverlay.ts';

describe('getOverlayTransform', () => {
  const hold = 3;
  const params = DEFAULT_DEPTH_OVERLAY_PARAMS;

  it('starts off-screen at t=0', () => {
    const transform = getOverlayTransform(0, hold, params);
    expect(transform.opacity).toBe(0);
    expect(transform.y).toBe(-1);
  });

  it('parks in place at mid hold', () => {
    const transform = getOverlayTransform(1.5, hold, params);
    expect(transform.y).toBe(0);
    expect(transform.opacity).toBeCloseTo(1);
  });

  it('stays parked at the end when exit is off', () => {
    const transform = getOverlayTransform(hold, hold, params);
    expect(transform.y).toBe(0);
    expect(transform.opacity).toBeCloseTo(1);
  });

  it('mirrors the entrance at the end when exit is on', () => {
    const withExit = {
      ...params,
      animation: {...params.animation, exit: true},
    };
    const transform = getOverlayTransform(hold, hold, withExit);
    expect(transform.opacity).toBe(0);
    expect(transform.y).toBe(-1);
  });

  it('clamps out-of-range times', () => {
    expect(getOverlayTransform(-2, hold, params)).toEqual(
      getOverlayTransform(0, hold, params),
    );
    expect(getOverlayTransform(99, hold, params)).toEqual(
      getOverlayTransform(hold, hold, params),
    );
  });

  it('enters from below when direction is up', () => {
    const up = {
      ...params,
      animation: {...params.animation, direction: 'up' as const},
    };
    expect(getOverlayTransform(0, hold, up).y).toBe(1);
    expect(getOverlayTransform(1.5, hold, up).y).toBe(0);
  });
});

describe('validateDepthOverlays', () => {
  const base = {
    outputDurationSec: 20,
    maskAvailable: true,
    clips: [
      {
        id: 'a',
        start: 4,
        end: 7,
        direction: 'down' as const,
        reason: 'show the bottle',
        assetId: 'ub_1',
        width: 1080,
        height: 1080,
      },
    ],
  };

  it('keeps a valid clip', () => {
    const result = validateDepthOverlays(base);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.params.opacity).toBe(1);
  });

  it('drops overlapping depth overlays', () => {
    const result = validateDepthOverlays({
      ...base,
      clips: [
        ...base.clips,
        {
          id: 'b',
          start: 6,
          end: 9,
          direction: 'up',
          reason: 'again',
          assetId: 'ub_2',
          width: 1080,
          height: 1080,
        },
      ],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.violations.some(item => item.code === 'depth_overlay_overlap')).toBe(
      true,
    );
  });

  it('drops clips that overlap B-roll', () => {
    const result = validateDepthOverlays({
      ...base,
      brollRanges: [{start: 5, end: 8}],
    });
    expect(result.clips).toHaveLength(0);
    expect(
      result.violations.some(item => item.code === 'depth_overlay_broll_overlap'),
    ).toBe(true);
  });

  it('enforces the minimum gap', () => {
    const result = validateDepthOverlays({
      ...base,
      clips: [
        ...base.clips,
        {
          id: 'b',
          start: 8,
          end: 11,
          direction: 'up',
          reason: 'second beat',
          assetId: 'ub_2',
          width: 1080,
          height: 1080,
        },
      ],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.violations.some(item => item.code === 'depth_overlay_min_gap')).toBe(
      true,
    );
  });

  it('caps share of total duration', () => {
    const result = validateDepthOverlays({
      outputDurationSec: 10,
      maskAvailable: true,
      clips: [
        {
          id: 'a',
          start: 1.5,
          end: 7.5,
          direction: 'down',
          reason: 'too much',
          assetId: 'ub_1',
          width: 1080,
          height: 1080,
        },
      ],
    });
    // 6s hold on 10s video is 60% > 35%
    expect(result.clips).toHaveLength(0);
    expect(result.violations.some(item => item.code === 'depth_overlay_share_cap')).toBe(
      true,
    );
  });

  it('clamps invalid params instead of dropping', () => {
    const result = validateDepthOverlays({
      ...base,
      clips: [
        {
          ...base.clips[0]!,
          params: {
            region: {y: -1, height: 2, fit: 'fill'},
            opacity: 9,
            edgeMask: {feather: 1, rounded: true},
            blendMode: 'normal',
            animation: {
              direction: 'down',
              duration: 4,
              easing: 'easeOutCubic',
              exit: false,
            },
          },
        },
      ],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.params.opacity).toBe(1);
    expect(result.clips[0]?.params.animation.duration).toBe(1.15);
    expect(result.clips[0]?.params.edgeMask.feather).toBe(0.25);
  });

  it('drops when no mask is available', () => {
    const result = validateDepthOverlays({...base, maskAvailable: false});
    expect(result.clips).toHaveLength(0);
    expect(result.violations[0]?.code).toBe('depth_overlay_no_mask');
  });

  it('keeps a requested overlay when occupancy cannot prove the speaker is visible', () => {
    const result = validateDepthOverlays({
      ...base,
      speakerVisible: [{start: 0, end: 1}],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.id).toBe('a');
  });

  it('alternates direction unless the director explains it', () => {
    const result = validateDepthOverlays({
      outputDurationSec: 30,
      maskAvailable: true,
      clips: [
        {
          id: 'a',
          start: 4,
          end: 6.5,
          direction: 'down',
          reason: 'product',
          assetId: 'ub_1',
          width: 800,
          height: 800,
        },
        {
          id: 'b',
          start: 12,
          end: 15,
          direction: 'down',
          reason: 'another product',
          assetId: 'ub_2',
          width: 800,
          height: 800,
        },
      ],
    });
    expect(result.clips.map(clip => clip.direction)).toEqual(['down', 'up']);
    expect(result.coercions.some(item => item.startsWith('alternate_direction'))).toBe(
      true,
    );
  });
});

describe('overlayLayerMode', () => {
  it('refuses compositing when no real mask exists', () => {
    expect(overlayLayerMode(false)).toBe('refused');
    expect(overlayLayerMode(true)).toBe('behind');
  });
});
