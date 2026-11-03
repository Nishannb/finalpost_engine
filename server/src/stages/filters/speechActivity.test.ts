import {describe, expect, it} from 'vitest';

import type {KeepSegment, TimeRange, WordToken} from '../../types/blueprint.ts';
import {autoTrimSilence, isFillerToken} from './autoTrim.ts';
import {energySpeechRegions, refineWordBounds, selectPausePolicy} from './speechActivity.ts';

const SR = 16_000;
const word = (text: string, start: number, end: number): WordToken => ({text, start, end});
const POLICY = {intentionalMaxSec: 0.65, preservedSec: 0.2, minGapSec: 0.4};

/** Deterministic pseudo-noise in [-1, 1]. */
const noiseAt = (i: number): number => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
const dbToAmp = (db: number): number => 10 ** (db / 20);

type Segment = {from: number; to: number; db: number};
/** Builds noise PCM where each segment has the given RMS level (white-ish noise scaled so rms = amplitude). */
const makePcm = (durationSec: number, segments: Segment[], baseDb = -90): Float32Array => {
  const pcm = new Float32Array(Math.round(durationSec * SR));
  const level = (t: number): number => {
    for (let k = segments.length - 1; k >= 0; k -= 1) {
      const s = segments[k]!;
      if (t >= s.from && t < s.to) return s.db;
    }
    return baseDb;
  };
  for (let i = 0; i < pcm.length; i += 1) {
    pcm[i] = noiseAt(i) * Math.sqrt(3) * dbToAmp(level(i / SR));
  }
  return pcm;
};

const seq = (n: number, from: number, step: number, len: number, prefix = 'w'): WordToken[] =>
  Array.from({length: n}, (_, i) => word(`${prefix}${i}`, from + i * step, from + i * step + len));

const assertKeepSegments = (segments: KeepSegment[], exclusions: TimeRange[], duration: number): void => {
  let outputCursor = 0;
  let prevEnd = -1;
  for (const seg of segments) {
    expect(seg.sourceEnd).toBeGreaterThan(seg.sourceStart);
    expect(seg.sourceStart).toBeGreaterThanOrEqual(prevEnd - 1e-6);
    expect(seg.outputStart).toBeCloseTo(outputCursor, 1);
    outputCursor += seg.sourceEnd - seg.sourceStart;
    prevEnd = seg.sourceEnd;
    for (const ex of exclusions) {
      const overlap = Math.min(seg.sourceEnd, ex.end) - Math.max(seg.sourceStart, ex.start);
      expect(overlap).toBeLessThanOrEqual(0.011);
    }
  }
  const removed = exclusions.reduce((t, r) => t + r.end - r.start, 0);
  expect(outputCursor).toBeCloseTo(duration - removed, 1);
};

const cutLength = (exclusions: TimeRange[], from: number, to: number): number =>
  exclusions.reduce((t, r) => t + Math.max(0, Math.min(r.end, to) - Math.max(r.start, from)), 0);

describe('energySpeechRegions', () => {
  it('returns [] for empty or silent pcm', () => {
    expect(energySpeechRegions(new Float32Array(0), SR)).toEqual([]);
    expect(energySpeechRegions(new Float32Array(SR), SR)).toEqual([]);
  });

  it('1. covers speech bursts only, not the long silence between', () => {
    const pcm = makePcm(5, [{from: 0.5, to: 1.5, db: -20}, {from: 3.5, to: 4.5, db: -20}]);
    const regions = energySpeechRegions(pcm, SR, {words: [{start: 0.5, end: 1.5}, {start: 3.5, end: 4.5}]});
    expect(regions).toHaveLength(2);
    expect(regions[0]!.start).toBeCloseTo(0.5, 1);
    expect(regions[0]!.end).toBeCloseTo(1.5, 1);
    expect(regions[1]!.start).toBeCloseTo(3.5, 1);
    expect(regions[1]!.end).toBeCloseTo(4.5, 1);
  });

  it('11. noisy floor is not one big speech region', () => {
    const pcm = makePcm(6, [{from: 0, to: 6, db: -20}, {from: 1, to: 2, db: -8}, {from: 4, to: 5, db: -8}]);
    const regions = energySpeechRegions(pcm, SR, {words: [{start: 1, end: 2}, {start: 4, end: 5}]});
    expect(regions).toHaveLength(2);
    expect(regions[0]!.end - regions[0]!.start).toBeLessThan(1.3);
    expect(regions[1]!.start).toBeGreaterThan(3.8);
  });
});

describe('autoTrimSilence with speech regions', () => {
  // 6 words, 0.5s gap between w2 and w3, speech padded on both sides so removal stays < 40%.
  const shortPause = (): {words: WordToken[]; duration: number; pcm: Float32Array} => {
    const a = seq(3, 0, 0.5, 0.45); // 0 – 1.45
    const b = seq(3, 1.95, 0.5, 0.45).map((w, i) => ({...w, text: `x${i}`})); // 1.95 – 3.4
    const duration = 3.4;
    const pcm = makePcm(duration, [{from: 0, to: 1.45, db: -20}, {from: 1.95, to: 3.4, db: -20}]);
    return {words: [...a, ...b], duration, pcm};
  };

  it('2. keeps ~preservedSec of a short intentional pause; legacy cuts it to padding', () => {
    const {words, duration, pcm} = shortPause();
    const regions = energySpeechRegions(pcm, SR, {words});
    const base = {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: duration};
    const vad = autoTrimSilence(words, {...base, speechRegions: regions, pausePolicy: POLICY});
    const legacy = autoTrimSilence(words, base);
    expect(vad.skipped).toBeUndefined();
    const residualVad = 0.5 - cutLength(vad.trimExclusions, 1.45, 1.95);
    const residualLegacy = 0.5 - cutLength(legacy.trimExclusions, 1.45, 1.95);
    expect(residualVad).toBeGreaterThan(0.17);
    expect(residualVad).toBeLessThan(0.27);
    expect(residualLegacy).toBeCloseTo(0.16, 1);
    assertKeepSegments(vad.keepSegments, vad.trimExclusions, duration);
  });

  it('3. soft speech inside an ASR gap protects the gap', () => {
    const words = [...seq(8, 0, 0.4, 0.35), ...seq(8, 4.8, 0.4, 0.35).map(w => ({...w, text: 'y' + w.text}))];
    const duration = 8.1;
    const pcm = makePcm(duration, [{from: 0, to: 3.15, db: -18}, {from: 3.7, to: 4.3, db: -28}, {from: 4.8, to: 8.0, db: -18}]);
    const regions = energySpeechRegions(pcm, SR, {words});
    expect(regions.some(r => r.start <= 3.8 && r.end >= 4.2)).toBe(true);
    const base = {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: duration};
    const vad = autoTrimSilence(words, {...base, speechRegions: regions, pausePolicy: POLICY});
    const legacy = autoTrimSilence(words, base);
    expect(legacy.skipped).toBeUndefined();
    expect(cutLength(vad.trimExclusions, 3.7, 4.3)).toBe(0);
    expect(cutLength(legacy.trimExclusions, 3.7, 4.3)).toBeGreaterThan(0.5);
  });

  it('4. music bed: policy says musicBed, short gap kept, near-silent hole cut', () => {
    const duration = 12;
    const words = [...seq(4, 0.2, 0.3, 0.25), ...seq(4, 1.8, 0.3, 0.25).map(w => ({...w, text: 'z' + w.text}))];
    // islands 0.2–1.4 and 1.8–3.0 with a 0.4s gap -> make a 0.6s gap instead
    const gapWords = [...seq(4, 0.2, 0.3, 0.25), ...seq(4, 2.0, 0.3, 0.25).map(w => ({...w, text: 'z' + w.text}))];
    void words;
    const pcm = makePcm(duration, [{from: 0, to: duration, db: -25}, {from: 6, to: 7.5, db: -80}]);
    const regions = energySpeechRegions(pcm, SR, {words: gapWords});
    const policy = selectPausePolicy({speech: regions, words: gapWords, durationSec: duration});
    expect(policy.musicBed).toBe(true);
    expect(policy.minGapSec).toBe(0.9);
    const res = autoTrimSilence(gapWords, {
      thresholdSec: 0.4,
      paddingSec: 0.08,
      sourceDurationSec: duration,
      speechRegions: regions,
      pausePolicy: policy,
    });
    expect(cutLength(res.trimExclusions, 1.25, 2.0)).toBe(0); // 0.75s gap under the music-bed minimum
    // Hole cut only when a word gap spans it.
    const withHole = [...gapWords.slice(0, 4), ...seq(4, 8, 0.3, 0.25).map(w => ({...w, text: 'h' + w.text}))];
    const res2 = autoTrimSilence(withHole, {
      thresholdSec: 0.4,
      paddingSec: 0.08,
      sourceDurationSec: duration,
      speechRegions: regions,
      pausePolicy: policy,
    });
    expect(regions.some(r => r.end <= 6.2) && regions.some(r => r.start >= 7.3)).toBe(true);
    expect(cutLength(res2.trimExclusions, 6, 7.5)).toBeGreaterThan(1.2);
  });

  it('12. very short clip still reports sparse_speech', () => {
    const words = [word('a', 0, 0.3), word('b', 9, 9.3)];
    const res = autoTrimSilence(words, {
      thresholdSec: 0.4,
      paddingSec: 0.08,
      sourceDurationSec: 10,
      speechRegions: [{start: 0, end: 0.3}, {start: 9, end: 9.3}],
      pausePolicy: POLICY,
    });
    expect(res.skipped).toBe('sparse_speech');
    expect(res.removedSec).toBe(0);
  });

  it('13. null speechRegions and empty regions match the legacy call', () => {
    const words = [...seq(10, 0, 0.3, 0.25), ...seq(10, 3.8, 0.3, 0.25).map(w => ({...w, text: 'q' + w.text}))];
    const base = {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: 7, removeFillers: true};
    const legacy = autoTrimSilence(words, base);
    expect(legacy.trimExclusions.length).toBeGreaterThan(0);
    expect(autoTrimSilence(words, {...base, speechRegions: null}).trimExclusions).toEqual(legacy.trimExclusions);
    expect(autoTrimSilence(words, {...base, speechRegions: [], pausePolicy: POLICY}).trimExclusions).toEqual(legacy.trimExclusions);
  });

  it('10. fast speech: continuous regions, nothing removed', () => {
    const words = seq(12, 0, 0.3, 0.25);
    const duration = 3.6;
    const pcm = makePcm(duration, [{from: 0, to: 3.55, db: -20}]);
    const regions = energySpeechRegions(pcm, SR, {words});
    const res = autoTrimSilence(words, {
      thresholdSec: 0.4,
      paddingSec: 0.08,
      sourceDurationSec: duration,
      speechRegions: regions,
      pausePolicy: POLICY,
    });
    expect(res.trimExclusions).toEqual([]);
    expect(res.removedSec).toBe(0);
  });

  it('long dead air with VAD keeps early soft speech before the first ASR word', () => {
    const words = seq(12, 1.0, 0.3, 0.25);
    const duration = 5;
    const pcm = makePcm(duration, [{from: 0.2, to: 0.5, db: -28}, {from: 1.0, to: 4.55, db: -18}]);
    const regions = energySpeechRegions(pcm, SR, {words});
    const res = autoTrimSilence(words, {
      thresholdSec: 0.4,
      paddingSec: 0.08,
      sourceDurationSec: duration,
      speechRegions: regions,
      pausePolicy: POLICY,
    });
    expect(cutLength(res.trimExclusions, 0.2, 0.5)).toBe(0);
    expect(res.skipped).toBeUndefined();
    expect(res.trimExclusions[0]!.start).toBe(0);
    assertKeepSegments(res.keepSegments, res.trimExclusions, duration);
  });
});

describe('refineWordBounds + fillers', () => {
  it('5. tightens a wide filler and the exclusion avoids neighbours', () => {
    const words = [
      word('one', 0, 0.4), word('two', 0.5, 0.9), word('three', 1.0, 1.4),
      word('um', 1.6, 2.4),
      word('four', 2.5, 2.9), word('five', 3.0, 3.4), word('six', 3.5, 3.9),
    ];
    const speech = [{start: 0, end: 1.4}, {start: 1.9, end: 2.1}, {start: 2.5, end: 3.9}];
    const refined = refineWordBounds(words, speech);
    const um = refined[3]!;
    expect(um.start).toBeGreaterThan(1.6 + 0.1);
    expect(um.end).toBeLessThan(2.4 - 0.1);
    const res = autoTrimSilence(refined, {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: 4.1, removeFillers: true});
    const cutAroundUm = res.trimExclusions.filter(r => r.end > 1.45 && r.start < 2.45);
    expect(cutAroundUm.length).toBeGreaterThan(0);
    for (const r of cutAroundUm) {
      expect(r.start).toBeGreaterThanOrEqual(1.4);
      expect(r.end).toBeLessThanOrEqual(2.5);
    }
    expect(refined[2]).toEqual(words[2]);
    expect(refined[4]).toEqual(words[4]);
  });

  it('6. leading uh and trailing hmm are cut, content words intact', () => {
    const content = Array.from({length: 9}, (_, i) => word(`c${i}`, 0.8 + i * 0.4, 0.8 + i * 0.4 + 0.35));
    const words = [word('uh', 0.2, 0.7), ...content, word('hmm', 4.8, 5.3)];
    const speech = [{start: 0.3, end: 0.55}, {start: 0.8, end: 4.4}, {start: 4.9, end: 5.15}];
    const refined = refineWordBounds(words, speech);
    expect(refined[0]!.end - refined[0]!.start).toBeLessThan(0.5);
    const res = autoTrimSilence(refined, {thresholdSec: 0.4, paddingSec: 0.08, sourceDurationSec: 5.6, removeFillers: true});
    expect(res.skipped).toBeUndefined();
    expect(cutLength(res.trimExclusions, refined[0]!.start, refined[0]!.end)).toBeGreaterThan(0.2);
    expect(cutLength(res.trimExclusions, 4.9, 5.15)).toBeGreaterThan(0.2);
    for (const w of refined.slice(1, 10)) expect(cutLength(res.trimExclusions, w.start, w.end)).toBe(0);
    assertKeepSegments(res.keepSegments, res.trimExclusions, 5.6);
  });

  it('7. pulls a late ASR start earlier; a following silence cut stays outside the word', () => {
    const words = [
      word('alpha', 0.1, 0.5), word('beta', 0.6, 1.0), word('gamma', 1.1, 1.5),
      word('delta', 2.6, 3.0), word('eps', 3.1, 3.5), word('zeta', 3.6, 4.0),
    ];
    const speech = [{start: 0.1, end: 1.5}, {start: 2.5, end: 4.0}]; // delta really starts at 2.5
    const refined = refineWordBounds(words, speech);
    expect(refined[3]!.start).toBeCloseTo(2.5, 5);
    const res = autoTrimSilence(refined, {
      thresholdSec: 0.4,
      paddingSec: 0.08,
      sourceDurationSec: 4.2,
      speechRegions: speech,
      pausePolicy: POLICY,
    });
    for (const r of res.trimExclusions) expect(r.end).toBeLessThanOrEqual(2.5 - 0.02 + 1e-6);
    expect(res.trimExclusions.length).toBeGreaterThan(0);
  });

  it('never overlaps neighbours or reverses', () => {
    const words = seq(8, 0, 0.12, 0.1);
    const refined = refineWordBounds(words, [{start: 0.02, end: 0.5}, {start: 0.6, end: 1.0}]);
    for (let i = 0; i < refined.length; i += 1) {
      expect(refined[i]!.end).toBeGreaterThan(refined[i]!.start);
      if (i > 0) expect(refined[i]!.start).toBeGreaterThanOrEqual(refined[i - 1]!.end - 1e-9);
    }
  });

  it('8. identical phrases separated by a pause both survive', () => {
    const words = [
      word('send', 0, 0.3), word('the', 0.35, 0.5), word('file', 0.55, 0.9),
      word('send', 2.0, 2.3), word('the', 2.35, 2.5), word('file', 2.55, 2.9),
    ];
    const refined = refineWordBounds(words, [{start: 0, end: 0.9}, {start: 2.0, end: 2.9}]);
    expect(refined.map(w => w.text)).toEqual(words.map(w => w.text));
  });

  it('9. paraphrase retakes keep both wordings', () => {
    const words = [
      word('please', 0, 0.3), word('send', 0.35, 0.6), word('it', 0.65, 0.8),
      word('kindly', 2.0, 2.3), word('forward', 2.35, 2.7), word('that', 2.75, 2.95),
    ];
    const refined = refineWordBounds(words, [{start: 0, end: 0.8}, {start: 2.0, end: 2.95}]);
    expect(refined.map(w => w.text)).toEqual(words.map(w => w.text));
  });

  it('does not mutate input and leaves fillers with no overlapping speech unchanged', () => {
    const words = [word('um', 1, 1.4)];
    const copy = JSON.parse(JSON.stringify(words));
    const refined = refineWordBounds(words, [{start: 5, end: 6}]);
    expect(words).toEqual(copy);
    expect(refined[0]).toEqual(words[0]);
  });
});

describe('selectPausePolicy', () => {
  it('picks fast / slow / default by words per second', () => {
    const speech = [{start: 0, end: 5}];
    const mk = (n: number) => Array.from({length: n}, (_, i) => ({start: (i * 5) / n, end: (i * 5) / n + 4.5 / n}));
    expect(selectPausePolicy({speech, words: mk(20), durationSec: 5}).minGapSec).toBe(0.45);
    expect(selectPausePolicy({speech, words: mk(5), durationSec: 5}).minGapSec).toBe(0.55);
    expect(selectPausePolicy({speech, words: mk(12), durationSec: 5})).toMatchObject({intentionalMaxSec: 0.65, preservedSec: 0.2, minGapSec: 0.4, musicBed: false});
  });
});

describe('filler lexicon is not widened', () => {
  it.each(['like', 'you', 'know', 'actually', 'mean'])('%s is not a filler', t => {
    expect(isFillerToken(t)).toBe(false);
  });
  it.each(['um', 'uh', 'uhm', 'hmm', 'hm', 'erm', 'mm', 'mhm'])('%s is a filler', t => {
    expect(isFillerToken(t)).toBe(true);
  });
});
