import {describe, expect, it} from 'vitest';

import {buildDuckEnvelope, duckDbAt} from './duckEnvelope.ts';
import {carvedTwinEnabled, mixMeasureEnabled} from './flags.ts';
import {bedSpecFor, buildMixProbeArgv, carvedDecision, describePauses, gapsFromMeasure, mixWindows, parseEbur128Summary} from './mixMeasure.ts';

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

  it('settled windows exclude hold, release and attack and drop pauses too short to settle', () => {
    const duck = buildDuckEnvelope({
      words: [
        {start: 1, end: 2},
        {start: 4, end: 5}, // 2.0 s pause: settles from 2 + .15 + .45 (+ .02 guard) to 4 - .08 (- .02 guard)
        {start: 5.8, end: 6.5}, // 0.8 s pause: a pause window, but 0.8 - 0.6 - 0.08 < 0.3, never settles
        {start: 7.5, end: 8}, // 1.0 s pause: still short of the 0.3 s settled minimum
      ],
      durationSec: 10,
      voLufs: -20,
      bedLufs: -16,
      releaseSec: 0.45,
      leadSec: 0,
    });
    const windows = mixWindows(duck);
    expect(windows.pause).toEqual([[2, 4], [5, 5.8], [6.5, 7.5]]);
    expect(windows.pauseSettled).toEqual([[2.62, 3.9]]);
    // The envelope really is at the pause gain across the settled window and not before it.
    expect(duckDbAt(duck, 2.62)).toBeCloseTo(duck.pauseDb, 6);
    expect(duckDbAt(duck, 3.9)).toBeCloseTo(duck.pauseDb, 6);
    expect(duckDbAt(duck, 2.3)).toBeLessThan(duck.pauseDb);
  });

  it('describes each pause by length and whether it settled', () => {
    const duck = buildDuckEnvelope({words: [{start: 1, end: 2}, {start: 4, end: 5}, {start: 5.8, end: 6.5}], durationSec: 8, voLufs: -20, bedLufs: -16, releaseSec: 0.45, leadSec: 0});
    expect(describePauses(duck)).toEqual([
      {start: 2, end: 4, lengthSec: 2, settledSec: 1.28, settled: true},
      {start: 5, end: 5.8, lengthSec: 0.8, settledSec: 0, settled: false},
    ]);
  });

  it('the look-ahead moves the end of the settled window earlier by leadSec', () => {
    const words = [{start: 1, end: 2}, {start: 4, end: 5}];
    const noLead = mixWindows(buildDuckEnvelope({words, durationSec: 6, voLufs: -20, bedLufs: -16, releaseSec: 0.3, leadSec: 0}));
    const lead = mixWindows(buildDuckEnvelope({words, durationSec: 6, voLufs: -20, bedLufs: -16, releaseSec: 0.3}));
    expect(noLead.pauseSettled[0]![1] - lead.pauseSettled[0]![1]).toBeCloseTo(0.0333, 3);
  });

  it('a shorter release settles more pauses', () => {
    const words = [{start: 1, end: 2}, {start: 3, end: 4}];
    const slow = mixWindows(buildDuckEnvelope({words, durationSec: 6, voLufs: -20, bedLufs: -16, releaseSec: 0.45, leadSec: 0}));
    const fast = mixWindows(buildDuckEnvelope({words, durationSec: 6, voLufs: -20, bedLufs: -16, releaseSec: 0.3, holdSec: 0.1, leadSec: 0}));
    expect(slow.pauseSettled).toEqual([]);
    expect(fast.pauseSettled).toEqual([[2.42, 2.9]]);
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
    expect(gaps.pauseGapLuAll).toBe(9);
    expect(gaps.pauseGapLuSettled).toBeNull();
    expect(gapsFromMeasure({vo_speech_lufs: -20, bed_speech_lufs: null, bed_pause_lufs: null}).speechGapLu).toBeNull();
  });

  it('reports the all-window and settled pause gaps apart, with the settled count and duration', () => {
    const gaps = gapsFromMeasure({vo_speech_lufs: -20, bed_speech_lufs: -38, bed_pause_lufs: -32.4, bed_pause_settled_lufs: -29}, [[2.7, 3.9], [6, 6.5]]);
    expect(gaps.pauseGapLuAll).toBe(12.4);
    expect(gaps.pauseGapLuSettled).toBe(9);
    expect(gaps.settledPauseCount).toBe(2);
    expect(gaps.settledPauseSec).toBe(1.7);
  });

  it('carries the voice-fight count and treats a missing count as zero', () => {
    const fight = gapsFromMeasure({vo_speech_lufs: -20, bed_speech_lufs: -38, bed_over_voice_windows: 2, speech_windows_unmeasured: 1, min_speech_window_gap_lu: 4.5});
    expect(fight).toMatchObject({bedOverVoiceWindows: 2, speechWindowsUnmeasured: 1, minSpeechWindowGapLu: 4.5});
    expect(gapsFromMeasure({}).bedOverVoiceWindows).toBe(0);
  });

  it('reads the ebur128 summary', () => {
    const stderr = '[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -16.2 LUFS\n    Threshold: -26.2 LUFS\n\n  True peak:\n    Peak:       -1.3 dBFS\n';
    expect(parseEbur128Summary(stderr)).toEqual({finalLufs: -16.2, finalTruePeak: -1.3});
  });
});

describe('carved decision', () => {
  const base = {speechGapLu: 17.3, pauseGapLuSettled: 9.1};
  it('compares carved=1 with carved=0, not with the intended gaps', () => {
    // 17.3 / 12.4 would fail a 18 / 9 band, but carved did not move anything.
    expect(carvedDecision({speechGapLu: 17.3, pauseGapLuSettled: 12.4}, {speechGapLu: 17.3, pauseGapLuSettled: 12.4})).toMatchObject({allowed: true, speechDeltaLu: 0, pauseDeltaLu: 0});
  });
  it('allows a move of exactly 1 LU and rejects more', () => {
    expect(carvedDecision(base, {speechGapLu: 18.3, pauseGapLuSettled: 8.1}).allowed).toBe(true);
    expect(carvedDecision(base, {speechGapLu: 18.4, pauseGapLuSettled: 9.1}).allowed).toBe(false);
    expect(carvedDecision(base, {speechGapLu: 17.3, pauseGapLuSettled: 7.9}).allowed).toBe(false);
  });
  it('is not allowed when a gap is missing', () => {
    expect(carvedDecision(base, {speechGapLu: 17.3, pauseGapLuSettled: null})).toMatchObject({allowed: false, pauseDeltaLu: null});
  });
  it('the flag is on by default (voice-first production default) and MUSIC_CARVED_TWIN=0 turns it off', () => {
    expect(carvedTwinEnabled({})).toBe(true);
    expect(carvedTwinEnabled({MUSIC_CARVED_TWIN: '1'})).toBe(true);
    expect(carvedTwinEnabled({MUSIC_CARVED_TWIN: '0'})).toBe(false);
  });
});

describe('bed spec for the probe', () => {
  it('carries the generated-bed fields (including the carved twin) and is absent for a bare bed', () => {
    expect(bedSpecFor({musicUrl: 'u', musicFullUrl: 'f', musicLoopUrl: 'l', musicCarvedUrl: 'c', musicFullDurationSec: 56.7, musicSource: 'generated'})).toEqual({
      musicFullUrl: 'f', musicLoopUrl: 'l', musicCarvedUrl: 'c', musicFullDurationSec: 56.7, musicSource: 'generated',
    });
    expect(bedSpecFor({musicUrl: 'u'})).toBeUndefined();
    expect(bedSpecFor(undefined)).toBeUndefined();
  });
});
