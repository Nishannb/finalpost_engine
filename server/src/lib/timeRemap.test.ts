import {describe, expect, it} from 'vitest';

import {
  buildTimeRemap,
  mapOutputToSource,
  mapSourceToOutput,
  remapWords,
} from './timeRemap.ts';

describe('shared delivery time remap', () => {
  const map = buildTimeRemap({
    sourceDurationSec: 10,
    crossfadeMs: 10,
    ops: [
      {op: 'trim_silence', start: 2, end: 3},
      {
        op: 'insert_pause',
        start: 5,
        end: 5,
        params: {position: 'after_word', durationMs: 300},
      },
      {
        op: 'speed_ramp',
        start: 6,
        end: 8,
        params: {rate: 0.92, rampInMs: 120, rampOutMs: 120},
      },
    ],
  });

  it('is monotonic in both domains', () => {
    const media = map.segments.filter(segment => segment.kind === 'media');
    for (let index = 1; index < media.length; index += 1) {
      expect(media[index]!.sourceStart).toBeGreaterThanOrEqual(
        media[index - 1]!.sourceEnd,
      );
      expect(media[index]!.outputStart).toBeGreaterThanOrEqual(
        media[index - 1]!.outputStart,
      );
    }
  });

  it('round trips surviving instants', () => {
    for (const source of [0.5, 1.5, 4, 5.5, 6.5, 8.5, 9.5]) {
      const output = mapSourceToOutput(map, source);
      expect(output).not.toBeNull();
      expect(mapOutputToSource(map, output!)).toBeCloseTo(source, 3);
    }
  });

  it('maps trimmed time to null and inserted pause back to its anchor', () => {
    expect(mapSourceToOutput(map, 2.5)).toBeNull();
    const pause = map.segments.find(segment => segment.kind === 'pause')!;
    expect(mapOutputToSource(map, (pause.outputStart + pause.outputEnd) / 2)).toBe(
      pause.sourceStart,
    );
  });

  it('keeps captions word-accurate after trims, pauses and speed changes', () => {
    const words = [
      {text: 'before', start: 1, end: 1.4},
      {text: 'cut', start: 2.2, end: 2.6},
      {text: 'after', start: 4, end: 4.4},
      {text: 'slow', start: 6.2, end: 6.7},
    ];
    const remapped = remapWords(words, map);
    expect(remapped.map(word => word.text)).toEqual(['before', 'after', 'slow']);
    expect(remapped[1]!.start).toBeLessThan(4);
    expect(remapped[2]!.end - remapped[2]!.start).toBeGreaterThan(0.5);
  });
});
