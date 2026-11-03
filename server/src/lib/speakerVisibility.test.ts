/** Unknown speaker visibility must never be reported as confirmed (Phase 17, decision 2). */
import {describe, expect, it} from 'vitest';

import {speakerVisibleRanges, validateDepthOverlays} from './depthOverlay.ts';

const box = {x: 0.2, y: 0.1, w: 0.6, h: 0.7};
const slice = (atSec: number, source: 'vision' | 'fallback', speaker = box) => ({atSec, occupancy: {speaker, source}});

describe('speakerVisibleRanges', () => {
  it('confirms visibility only where a speaker was detected and framed acceptably', () => {
    expect(speakerVisibleRanges([slice(0, 'vision'), slice(10, 'vision', {x: 0.01, y: 0.3, w: 0.2, h: 0.2})], 20)).toEqual([{start: 0, end: 10}]);
  });

  it('an undetected default box is UNKNOWN, not visible (it used to confirm the whole video)', () => {
    expect(speakerVisibleRanges([slice(0, 'fallback'), slice(5, 'fallback')], 20)).toEqual([]);
  });

  it('no slices at all is unknown, not "visible for the whole video"', () => {
    expect(speakerVisibleRanges([], 30)).toEqual([]);
  });

  it('a mix: only the detected stretch is confirmed', () => {
    expect(speakerVisibleRanges([slice(0, 'fallback'), slice(5, 'vision'), slice(12, 'fallback')], 20)).toEqual([{start: 5, end: 12}]);
  });

  it('slices without a source keep the framing rule (callers that do not say are unchanged)', () => {
    expect(speakerVisibleRanges([{atSec: 0, occupancy: {speaker: box}}], 10)).toEqual([{start: 0, end: 10}]);
  });
});

describe('depth overlay validation stays advisory about visibility (an unknown cannot authorise or block an edit)', () => {
  const base = {outputDurationSec: 40, maskAvailable: true, clips: [{id: 'a', assetId: 'a', start: 10, end: 14, direction: 'down' as const, width: 1080, height: 1080}]};

  it('keeps the overlay with no visibility evidence, and does not claim it was verified', () => {
    const result = validateDepthOverlays({...base, speakerVisible: speakerVisibleRanges([slice(0, 'fallback')], 40)} as never);
    expect(result.clips.map(clip => clip.id)).toEqual(['a']);
    expect(result.coercions.some(note => note.startsWith('speaker_visible_unverified'))).toBe(false);
  });

  it('keeps it and notes "unverified" when the detected visible range does not cover it', () => {
    const result = validateDepthOverlays({...base, speakerVisible: [{start: 0, end: 5}]} as never);
    expect(result.clips.map(clip => clip.id)).toEqual(['a']);
    expect(result.coercions).toContain('speaker_visible_unverified:a');
  });
});
