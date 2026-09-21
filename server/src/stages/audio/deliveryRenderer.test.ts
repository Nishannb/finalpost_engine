import {describe, expect, it} from 'vitest';

import {buildTimeRemap} from '../../lib/timeRemap.ts';
import {buildDeliveryFilter} from './deliveryRenderer.ts';

describe('delivery FFmpeg compiler', () => {
  it('uses matching A/V crossfades, pitch-preserving tempo and loudness ceiling', () => {
    const map = buildTimeRemap({
      sourceDurationSec: 5,
      crossfadeMs: 10,
      ops: [
        {op: 'trim_silence', start: 1, end: 1.5},
        {
          op: 'speed_ramp',
          start: 2,
          end: 3,
          params: {rate: 0.92, rampInMs: 120, rampOutMs: 120},
        },
      ],
    });
    const filter = buildDeliveryFilter({
      map,
      ops: [],
      preset: 'natural',
      fps: 30,
    }).graph;
    expect(filter).toContain('atempo=');
    expect(filter).toContain('acrossfade=d=0.01');
    expect(filter).toContain('xfade=transition=fade:duration=0.01');
    expect(filter).toContain('loudnorm=I=-14:TP=-1.2');
    expect(filter).toContain('alimiter=limit=0.870964');
  });
});
