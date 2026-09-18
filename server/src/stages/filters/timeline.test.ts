import {describe, expect, it} from 'vitest';

import {
  buildTimeline,
  exclusionsFromKeepSegments,
  identityTimeline,
} from './timeline.ts';

describe('buildTimeline', () => {
  const timeline = buildTimeline([
    {sourceStart: 0, sourceEnd: 2, outputStart: 0},
    {sourceStart: 5, sourceEnd: 9, outputStart: 2},
  ]);

  it('collapses cut time out of the output duration', () => {
    expect(timeline.outputDurationSec).toBe(6);
  });

  it('maps instants inside kept segments', () => {
    expect(timeline.mapSourceToOutput(0)).toBe(0);
    expect(timeline.mapSourceToOutput(1.5)).toBe(1.5);
    expect(timeline.mapSourceToOutput(5)).toBe(2);
    expect(timeline.mapSourceToOutput(8)).toBe(5);
  });

  it('returns null for instants inside a cut', () => {
    expect(timeline.mapSourceToOutput(3.5)).toBeNull();
  });

  it('snaps cut instants to the nearest surviving edge', () => {
    expect(timeline.mapSourceToOutputClamped(2.4)).toBe(2);
    expect(timeline.mapSourceToOutputClamped(4.8)).toBe(2);
  });

  it('treats an untrimmed clip as a passthrough', () => {
    const identity = identityTimeline(12);
    expect(identity.outputDurationSec).toBe(12);
    expect(identity.mapSourceToOutput(7)).toBe(7);
  });
});

describe('exclusionsFromKeepSegments', () => {
  it('recovers the cut ranges from kept segments', () => {
    expect(
      exclusionsFromKeepSegments(
        [
          {sourceStart: 0, sourceEnd: 2, outputStart: 0},
          {sourceStart: 5, sourceEnd: 9, outputStart: 2},
        ],
        11,
      ),
    ).toEqual([
      {start: 2, end: 5},
      {start: 9, end: 11},
    ]);
  });
});
