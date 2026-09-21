import {describe, expect, it} from 'vitest';

import {
  DEFAULT_INSET_REVEAL_PARAMS,
  captionLayoutAtTime,
  captionLayoutForInset,
  getInsetState,
  snapToTranscriptBoundaries,
  validateInsetReveals,
} from './insetReveal.ts';

describe('getInsetState', () => {
  const duration = 4;
  const params = DEFAULT_INSET_REVEAL_PARAMS;

  it('is full-frame before the clip', () => {
    const state = getInsetState(-1, duration, params);
    expect(state.phase).toBe('before');
    expect(state.scale).toBe(1);
    expect(state.progress).toBe(0);
    expect(state.bgOpacity).toBe(0);
    expect(state.cornerRadius).toBe(0);
  });

  it('is mid-transition during scale-in', () => {
    const state = getInsetState(0.45, duration, params);
    expect(state.phase).toBe('in');
    expect(state.scale).toBeGreaterThan(params.insetScale);
    expect(state.scale).toBeLessThan(1);
    expect(state.progress).toBeGreaterThan(0.05);
    expect(state.progress).toBeLessThan(0.95);
  });

  it('holds the inset scale in the middle of the clip', () => {
    const state = getInsetState(2, duration, params);
    expect(state.phase).toBe('hold');
    expect(state.scale).toBeCloseTo(params.insetScale);
    expect(state.progress).toBe(1);
    expect(state.y).toBeCloseTo(params.topMargin);
    expect(state.shadowOpacity).toBe(1);
  });

  it('is mid-transition during scale-out', () => {
    const state = getInsetState(3.8, duration, params);
    expect(state.phase).toBe('out');
    expect(state.scale).toBeGreaterThan(params.insetScale);
    expect(state.scale).toBeLessThan(1);
  });

  it('restores full-frame after the clip', () => {
    const state = getInsetState(4, duration, params);
    expect(state.phase).toBe('after');
    expect(state.scale).toBe(1);
    expect(state.progress).toBe(0);
    expect(state.bgOpacity).toBe(0);
  });

  it('clamps out-of-range times', () => {
    expect(getInsetState(-2, duration, params)).toEqual(
      getInsetState(0, duration, params),
    );
    expect(getInsetState(99, duration, params)).toEqual(
      getInsetState(duration, duration, params),
    );
  });
});

describe('caption restore', () => {
  const base = {position: 'top' as const, bottomFrac: 0.12};

  it('keeps the original dock before an inset', () => {
    const layout = captionLayoutForInset(0, base);
    expect(layout.dockMode).toBe('default');
    expect(layout.position).toBe('top');
    expect(layout.frameTopFrac).toBe(0);
    expect(layout.frameHeightFrac).toBe(1);
  });

  it('moves captions into the below-video zone at full inset', () => {
    const layout = captionLayoutForInset(1, base);
    expect(layout.dockMode).toBe('below_video');
    expect(layout.position).toBe('bottom');
    expect(layout.frameTopFrac).toBeGreaterThan(0.6);
    expect(layout.frameHeightFrac).toBeLessThan(0.4);
  });

  it('restores the previous dock after the clip ends', () => {
    const clips = [
      {start: 5, end: 9, params: DEFAULT_INSET_REVEAL_PARAMS},
    ];
    const during = captionLayoutAtTime(7, clips, base);
    const after = captionLayoutAtTime(9.1, clips, base);
    expect(during.dockMode).toBe('below_video');
    expect(after.dockMode).toBe('default');
    expect(after.position).toBe('top');
    expect(after.frameTopFrac).toBe(0);
  });
});

describe('validateInsetReveals', () => {
  const words = [
    {start: 3.0, end: 3.2},
    {start: 3.2, end: 3.5},
    {start: 8.8, end: 9.0},
    {start: 12.0, end: 12.4},
    {start: 15.8, end: 16.1},
  ];
  const sentences = [
    {start: 3.0, end: 9.0},
    {start: 12.0, end: 16.1},
  ];
  const base = {
    outputDurationSec: 40,
    words,
    sentences,
    clips: [
      {
        id: 'a',
        start: 5,
        end: 9.2,
        variant: 'simple' as const,
        reason: 'section change',
      },
    ],
  };

  it('keeps a valid clip', () => {
    const result = validateInsetReveals(base);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.params.insetScale).toBeCloseTo(0.68);
  });

  it('drops overlap with B-roll / depth_overlay', () => {
    const result = validateInsetReveals({
      ...base,
      blockedRanges: [{start: 6, end: 10}],
    });
    expect(result.clips).toHaveLength(0);
    expect(result.drops[0]).toMatch(/overlap/);
  });

  it('drops a second clip that violates the min gap', () => {
    const result = validateInsetReveals({
      ...base,
      clips: [
        ...base.clips,
        {id: 'b', start: 9.5, end: 14.0, variant: 'simple', reason: 'too soon'},
      ],
    });
    expect(result.clips.map(clip => clip.id)).toEqual(['a']);
    expect(result.drops.some(item => item.includes('min_gap'))).toBe(true);
  });

  it('enforces the share cap', () => {
    const result = validateInsetReveals({
      outputDurationSec: 40,
      clips: [
        {id: 'a', start: 4, end: 10, variant: 'simple', reason: 'first'},
        {id: 'b', start: 18, end: 26, variant: 'simple', reason: 'would exceed share'},
      ],
    });
    const used = result.clips.reduce((sum, clip) => sum + (clip.end - clip.start), 0);
    expect(used / 40).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(result.drops.some(item => item.includes('share_cap') || item.includes('max_count'))).toBe(
      true,
    );
  });

  it('expands a short inset instead of dropping it', () => {
    const result = validateInsetReveals({
      outputDurationSec: 40,
      clips: [{id: 'a', start: 5, end: 6.2, variant: 'simple', reason: 'short'}],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]!.end - result.clips[0]!.start).toBeGreaterThanOrEqual(3.4);
  });

  it('clamps invalid params rather than dropping the clip', () => {
    const result = validateInsetReveals({
      ...base,
      clips: [
        {
          id: 'a',
          start: 5,
          end: 9.2,
          variant: 'simple',
          reason: 'ok',
          params: {
            ...DEFAULT_INSET_REVEAL_PARAMS,
            insetScale: 0.2,
            transitionIn: {duration: 2},
          },
        },
      ],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.params.insetScale).toBeGreaterThanOrEqual(0.55);
    expect(result.clips[0]?.params.transitionIn.duration).toBeLessThanOrEqual(1.2);
  });

  it('snaps start and end toward sentence boundaries', () => {
    const result = validateInsetReveals({
      ...base,
      clips: [{id: 'a', start: 3.15, end: 8.85, variant: 'simple', reason: 'phrase'}],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.coercions.some(item => item.startsWith('snap_boundary'))).toBe(true);
    expect(result.clips[0]?.start).toBeCloseTo(3.0);
    expect(result.clips[0]?.end).toBeCloseTo(9.0);
  });
});

describe('snapToTranscriptBoundaries', () => {
  it('does not snap when no nearby edge exists', () => {
    const snapped = snapToTranscriptBoundaries(10, 14, [{start: 0, end: 1}]);
    expect(snapped.snapped).toBe(false);
    expect(snapped.start).toBe(10);
  });
});
