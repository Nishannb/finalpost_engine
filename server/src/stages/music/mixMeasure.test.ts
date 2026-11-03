import {describe, expect, it} from 'vitest';

import {buildDuckEnvelope} from './duckEnvelope.ts';
import {mixMeasureEnabled} from './flags.ts';
import {buildMixProbeArgv, gapsFromMeasure, mixWindows, parseEbur128Summary} from './mixMeasure.ts';

describe('mix measure flag and argv', () => {
  it('is off by default and builds no argv', () => {
    expect(mixMeasureEnabled({})).toBe(false);
    expect(mixMeasureEnabled({MUSIC_MIX_MEASURE: '0'})).toBe(false);
    expect(buildMixProbeArgv({stem: 'bed', outPath: '/tmp/b.wav', propsPath: '/tmp/p.json'}, {})).toBeNull();
  });

  it('builds a local wav render of MusicMixProbe with no Lambda flags when on', () => {
    const argv = buildMixProbeArgv({stem: 'vo', outPath: '/tmp/v.wav', propsPath: '/tmp/p.json'}, {MUSIC_MIX_MEASURE: '1'});
    expect(argv).not.toBeNull();
    expect(argv).toContain('--codec=wav');
    expect(argv).toContain('MusicMixProbe');
    expect(argv!.join(' ')).not.toMatch(/lambda/i);
  });
});

describe('mix windows', () => {
  it('uses phrases as speech and only interior gaps of at least 600 ms as pauses', () => {
    const duck = buildDuckEnvelope({
      words: [
        {start: 1, end: 2},
        {start: 3, end: 4}, // 1.0 s gap: pause
        {start: 4.4, end: 5}, // 0.4 s gap: merged? no, >= 0.35 so separate, but < 0.6 so not a pause
      ],
      durationSec: 8,
      voLufs: -20,
      bedLufs: -16,
    });
    const windows = mixWindows(duck);
    expect(windows.speech).toEqual([[1, 2], [3, 4], [4.4, 5]]);
    expect(windows.pause).toEqual([[2, 3]]);
  });

  it('stores the gains the fixture test applies for voLufs -20 / bedLufs -16', () => {
    const duck = buildDuckEnvelope({words: [{start: 1, end: 2}], durationSec: 4, voLufs: -20, bedLufs: -16});
    expect(duck.speechDb).toBe(-22);
    expect(duck.pauseDb).toBe(-13);
  });
});

describe('measure parsing', () => {
  it('derives both gaps from VO speech minus bed speech / bed pause', () => {
    const gaps = gapsFromMeasure({vo_speech_lufs: -20, bed_speech_lufs: -38, bed_pause_lufs: -29});
    expect(gaps.speechGapLu).toBe(18);
    expect(gaps.pauseGapLu).toBe(9);
    expect(gapsFromMeasure({vo_speech_lufs: -20, bed_speech_lufs: null, bed_pause_lufs: null}).speechGapLu).toBeNull();
  });

  it('reads the ebur128 summary', () => {
    const stderr = '[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -16.2 LUFS\n    Threshold: -26.2 LUFS\n\n  True peak:\n    Peak:       -1.3 dBFS\n';
    expect(parseEbur128Summary(stderr)).toEqual({finalLufs: -16.2, finalTruePeak: -1.3});
  });
});
