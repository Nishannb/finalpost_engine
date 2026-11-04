import {describe, expect, it} from 'vitest';

import {duckBaseDbAt as remotionBase, duckDbAt as remotionDuckDbAt, loudnessCorrectionDb as remotionCorrection} from '../../../../remotion/src/audio/duckEnvelope.ts';
import {buildBedLoudnessTrack, loudnessCorrectionRange, LOUDNESS_SLEW_DB_PER_FRAME} from './bedLoudness.ts';
import {buildDuckEnvelope, duckBaseDbAt, duckDbAt, DUCK_LOUDNESS_MAX_BOOST_DB, loudnessCorrectionDb, type DuckEnvelope} from './duckEnvelope.ts';
import {mixWindows} from './mixMeasure.ts';
import {placeMusic} from './placement.ts';
import type {BedPlacementMeta} from './placementMeta.ts';

const VO = -20;
const words = (() => {
  // Phrases of ~2.2 s with 1.4 s pauses over 70 s: plenty of settled pause.
  const out: Array<{start: number; end: number}> = [];
  for (let t = 1; t < 66; t += 3.6) for (let k = 0; k < 6; k += 1) out.push({start: t + k * 0.36, end: t + k * 0.36 + 0.3});
  return out;
})();
const DURATION = 70;

/** 120 bpm bed: bar 2.0 s, downbeats every 2 s from 0.5 s. Quiet first 8 bars, then a loud section. Per-bar LUFS are the synthetic bed's measured loudness. */
function bed(quiet: number, loud: number, over: Partial<BedPlacementMeta> = {}): BedPlacementMeta {
  const bars = 29;
  const downbeatTimes = Array.from({length: bars}, (_, i) => 0.5 + i * 2);
  return {
    downbeatTimes,
    energyMap: downbeatTimes.map((_, i) => (i < 8 ? 0.15 : 0.9)),
    liftSec: downbeatTimes[8]!,
    liftBar: 8,
    barSec: 2,
    fullDurationSec: 58.5,
    hasLoop: false,
    loopDurationSec: null,
    loopBars: null,
    loudnessMap: downbeatTimes.map((_, i) => (i < 8 ? quiet : loud)),
    ...over,
  };
}

const staticDuck = () => buildDuckEnvelope({words, durationSec: DURATION, voLufs: VO, bedLufs: -16});
const withTrack = (meta: BedPlacementMeta, offset: number, loopFrom: number | null = null, carved = false): DuckEnvelope => {
  const duck = staticDuck();
  const track = buildBedLoudnessTrack({bed: meta, startOffsetSec: offset, loopFromSec: loopFrom, durationSec: DURATION, duck, carved});
  return {...duck, bedLoudness: track!};
};

/** The bed loudness actually playing at video time t, straight from the per-bar map (no smoothing): the ground truth the gap is measured against. */
const playedLufs = (meta: BedPlacementMeta, offset: number, t: number) => {
  const position = offset + t;
  let index = 0;
  meta.downbeatTimes.forEach((d, i) => {
    if (d <= position + 1e-9) index = i;
  });
  return meta.loudnessMap![Math.min(index, meta.loudnessMap!.length - 1)]!;
};

/** Mean gap over a set of times, the way the render measures it: voice LUFS minus the energy-averaged bed (bed loudness + gain) over those moments. */
function meanGap(meta: BedPlacementMeta, duck: DuckEnvelope, offset: number, times: number[]): number {
  const energy = times.map(t => 10 ** ((playedLufs(meta, offset, t) + duckDbAt(duck, t)) / 10));
  return VO - 10 * Math.log10(energy.reduce((a, b) => a + b, 0) / energy.length);
}
const speechTimes = (): number[] => {
  const phrases = staticDuck().phrases;
  const out: number[] = [];
  for (const phrase of phrases) for (let t = phrase.start + 0.1; t < phrase.end - 0.05; t += 0.05) out.push(t);
  return out;
};
const settledPauseTimes = (): number[] => {
  const out: number[] = [];
  for (const [a, b] of mixWindows(staticDuck()).pauseSettled) for (let t = a; t < b; t += 0.05) out.push(t);
  return out;
};

describe('an envelope with no loudness track is unchanged', () => {
  it('matches the values the code gave before Phase 3.1 (snapshot)', () => {
    const duck = buildDuckEnvelope({words: [{start: 1, end: 2.2}, {start: 2.4, end: 3.1}, {start: 4.6, end: 6}, {start: 6.2, end: 7}, {start: 9.5, end: 10.5}], durationSec: 12, voLufs: -20, bedLufs: -16});
    const expected: Array<[number, number]> = [[0, -8], [0.5, -8], [0.9, -10.3275], [1, -22], [1.5, -22], [2.3, -22], [3, -22], [3.2, -22], [3.5, -14.5], [3.9, -13], [4.5, -14.49625], [4.55, -20.12125], [4.6, -22], [5, -22], [6.1, -22], [7.2, -20.5], [8, -13], [9.4, -14.49625], [9.5, -22], [10.6, -22], [11, -8], [12, -8]];
    for (const [t, db] of expected) {
      expect(Number(duckDbAt(duck, t).toFixed(6)), `t=${t}`).toBe(db);
      expect(duckDbAt(duck, t)).toBe(duckBaseDbAt(duck, t));
      expect(loudnessCorrectionDb(duck, t)).toBe(0);
    }
    expect(duck.bedLoudness).toBeUndefined();
  });
  it('a bed without a loudness map gets no track', () => {
    const meta = bed(-19, -13);
    const {loudnessMap: _drop, ...older} = meta;
    expect(buildBedLoudnessTrack({bed: older, startOffsetSec: 0, loopFromSec: null, durationSec: DURATION, duck: staticDuck(), carved: false})).toBeNull();
    expect(buildBedLoudnessTrack({bed: undefined, startOffsetSec: 0, loopFromSec: null, durationSec: DURATION, duck: staticDuck(), carved: false})).toBeNull();
  });
  it('only the talking preset reads a track', () => {
    const track = {stepSec: 0.1, lufs: Array.from({length: 100}, () => -24)};
    for (const preset of ['default', 'legacy_brief'] as const) {
      const duck = {...buildDuckEnvelope({words, durationSec: 12, preset}), bedLoudness: track};
      expect(loudnessCorrectionDb(duck, 3)).toBe(0);
      expect(duckDbAt(duck, 3)).toBe(duckBaseDbAt(duck, 3));
    }
  });
});

describe('the gap holds for whatever part of the bed is playing', () => {
  const meta = bed(-19.5, -13.5); // quiet 8 bars then loud: both within the +6 dB boost allowance
  const offsets = meta.downbeatTimes.filter(d => d <= 58.5 - 20);

  it('with any placement offset the speech gap is 18 +/- 1 LU and the settled pause gap 9 +/- 1 LU', () => {
    const speech = speechTimes();
    const pause = settledPauseTimes();
    expect(pause.length).toBeGreaterThan(40);
    for (const offset of offsets) {
      const duck = withTrack(meta, offset);
      expect(Math.abs(meanGap(meta, duck, offset, speech) - 18), `speech, offset ${offset}`).toBeLessThanOrEqual(1);
      expect(Math.abs(meanGap(meta, duck, offset, pause) - 9), `pause, offset ${offset}`).toBeLessThanOrEqual(1);
    }
  });

  it('the static duck (the old behaviour) drifts outside that band for some offsets, so the test can fail', () => {
    const speech = speechTimes();
    const worst = Math.max(...offsets.map(offset => Math.abs(meanGap(meta, staticDuck(), offset, speech) - 18)));
    expect(worst).toBeGreaterThan(1.5);
  });

  it('a near-silent intro is not pumped up: the boost stops at +6 dB, so the bed there is quieter than target, never louder', () => {
    const quietMeta = bed(-30, -12);
    const duck = withTrack(quietMeta, quietMeta.downbeatTimes[0]!);
    expect(DUCK_LOUDNESS_MAX_BOOST_DB).toBe(6);
    const range = loudnessCorrectionRange(duck)!;
    expect(range.maxDb).toBe(6);
    const gapQuiet = meanGap(quietMeta, duck, quietMeta.downbeatTimes[0]!, speechTimes().filter(t => t < 6));
    expect(gapQuiet).toBeGreaterThanOrEqual(18 + 7); // needed +14, got +6: 8 LU quieter than target
  });

  it('a loud section is ducked harder (negative correction) and the total never goes above 0 or below -40 dB', () => {
    const loudMeta = bed(-16, -8);
    const duck = withTrack(loudMeta, loudMeta.downbeatTimes[0]!);
    expect(loudnessCorrectionRange(duck)!.minDb).toBeLessThan(-6);
    for (let t = 0; t <= DURATION; t += 0.02) {
      const db = duckDbAt(duck, t);
      expect(db).toBeLessThanOrEqual(0);
      expect(db).toBeGreaterThanOrEqual(-40);
    }
    const heavy = {...duck, bedLoudness: {stepSec: 0.1, lufs: Array.from({length: 800}, () => 40)}}; // an absurdly loud bed
    expect(Math.min(...Array.from({length: 700}, (_, i) => duckDbAt(heavy, i * 0.1)))).toBe(-40);
  });

  it('with placement chosen by placeMusic the gaps hold too (real offset, real hand-off)', () => {
    const placed = placeMusic({bed: meta, durationSec: DURATION, hookAtSec: 2.5, intensity: Array.from({length: DURATION}, () => 0.3), bpm: 120});
    const duck = withTrack(meta, placed.startOffsetSec, placed.loopFromSec);
    expect(Math.abs(meanGap(meta, duck, placed.startOffsetSec, speechTimes().filter(t => t < 40)) - 18)).toBeLessThanOrEqual(1);
  });
});

describe('smoothing, slew and the unchanged attack, hold, release and look-ahead', () => {
  it('the loudness the correction follows moves at most 0.4 dB per frame at 30 fps, even across a 12 LU step', () => {
    const duck = withTrack(bed(-22, -10), 0.5);
    let worst = 0;
    for (let f = 1; f < DURATION * 30; f += 1) worst = Math.max(worst, Math.abs(loudnessCorrectionDb(duck, f / 30) - loudnessCorrectionDb(duck, (f - 1) / 30)));
    expect(worst).toBeLessThanOrEqual(LOUDNESS_SLEW_DB_PER_FRAME + 1e-6);
    expect(LOUDNESS_SLEW_DB_PER_FRAME).toBeLessThanOrEqual(0.5);
  });
  it('the step is smoothed over about one bar, not a hard edge', () => {
    const duck = withTrack(bed(-22, -10), 0.5); // the step is at bed 16.5 s = video 16.0 s
    const track = duck.bedLoudness!;
    const at = (t: number) => track.lufs[Math.round(t / track.stepSec)]!;
    expect(at(14)).toBeCloseTo(-22, 0);
    expect(at(18)).toBeCloseTo(-10, 0);
    expect(at(15.5)).toBeLessThan(-12);
    expect(at(15.5)).toBeGreaterThan(-22);
    expect(at(16.5)).toBeGreaterThan(-22);
  });
  it('the total gain per frame is bounded by the static attack slope plus the correction slew', () => {
    const duck = withTrack(bed(-22, -10), 0.5);
    const fps = 30;
    const attackPerFrame = (Math.abs(duck.openDb - duck.speechDb) / duck.attackSec) / fps;
    let worst = 0;
    for (let f = 1; f < DURATION * fps; f += 1) worst = Math.max(worst, Math.abs(duckDbAt(duck, f / fps) - duckDbAt(duck, (f - 1) / fps)));
    expect(worst).toBeLessThanOrEqual(attackPerFrame + LOUDNESS_SLEW_DB_PER_FRAME + 0.5);
  });
  it('attack, hold, release and look-ahead are untouched: the static curve is the same with and without a track', () => {
    const duck = withTrack(bed(-19.5, -13.5), 0.5);
    const plain = staticDuck();
    for (let t = 0; t < DURATION; t += 0.013) expect(duckBaseDbAt(duck, t)).toBe(duckBaseDbAt(plain, t));
    expect({attack: duck.attackSec, hold: duck.holdSec, release: duck.releaseSec, lead: duck.leadSec}).toEqual({attack: plain.attackSec, hold: plain.holdSec, release: plain.releaseSec, lead: plain.leadSec});
  });
});

describe('server and Remotion agree', () => {
  it('duckDbAt, duckBaseDbAt and the correction match at every 1/120 s, with a track', () => {
    const duck = withTrack(bed(-19.5, -13.5), 4.5);
    for (let f = 0; f < DURATION * 120; f += 1) {
      const t = f / 120;
      expect(duckDbAt(duck, t)).toBeCloseTo(remotionDuckDbAt(duck, t), 9);
      expect(duckBaseDbAt(duck, t)).toBeCloseTo(remotionBase(duck, t), 9);
      expect(loudnessCorrectionDb(duck, t)).toBeCloseTo(remotionCorrection(duck, t), 9);
    }
  });
  it('and without a track, and for the other presets', () => {
    for (const preset of ['talking', 'default', 'legacy_brief'] as const) {
      const duck = buildDuckEnvelope({words, durationSec: 20, preset, voLufs: VO});
      for (let f = 0; f < 20 * 120; f += 1) expect(duckDbAt(duck, f / 120)).toBeCloseTo(remotionDuckDbAt(duck, f / 120), 9);
    }
  });
});

describe('where the loudness comes from', () => {
  it('follows the loop body after the hand-off, cycling', () => {
    const meta = bed(-16, -16, {hasLoop: true, loopDurationSec: 8, loopBars: 4, loopLoudnessMap: [-19, -19, -13, -13]});
    const track = buildBedLoudnessTrack({bed: meta, startOffsetSec: 0.5, loopFromSec: 40, durationSec: DURATION, duck: staticDuck(), carved: false})!;
    const at = (t: number) => track.lufs[Math.round(t / track.stepSec)]!;
    expect(at(30)).toBeCloseTo(-16, 0); // the full bed
    expect(at(41.5)).toBeCloseTo(-19, 0); // loop bars 1-2
    expect(at(45)).toBeCloseTo(-13, 0); // loop bars 3-4
    expect(at(49.5)).toBeCloseTo(-19, 0); // the body cycles
  });
  it('uses the carved twin under speech and the full bed in pauses, with the renderer\'s crossfade weights', () => {
    const meta = bed(-16, -16, {carvedLoudnessMap: Array.from({length: 29}, () => -19)});
    const duck = staticDuck();
    const track = buildBedLoudnessTrack({bed: meta, startOffsetSec: 0.5, loopFromSec: null, durationSec: DURATION, duck, carved: true})!;
    const phrase = duck.phrases[3]!;
    const insideSpeech = track.lufs[Math.round(((phrase.start + phrase.end) / 2) / track.stepSec)]!;
    expect(insideSpeech).toBeLessThan(-17.3); // carved -19, full -16, smoothed over a bar
    const longPause = mixWindows(duck).pauseSettled[2]!;
    const insidePause = track.lufs[Math.round(((longPause[0] + longPause[1]) / 2) / track.stepSec)]!;
    expect(insidePause).toBeGreaterThan(insideSpeech);
    const noCarved = buildBedLoudnessTrack({bed: meta, startOffsetSec: 0.5, loopFromSec: null, durationSec: DURATION, duck, carved: false})!;
    expect(Math.max(...noCarved.lufs.map(v => Math.abs(v + 16)))).toBeLessThan(0.01); // carved off: only the full bed
  });
  it('the correction range for the log', () => {
    expect(loudnessCorrectionRange(staticDuck())).toBeNull();
    const range = loudnessCorrectionRange(withTrack(bed(-19.5, -13.5), 0.5))!;
    expect(range.maxDb).toBeGreaterThan(2);
    expect(range.minDb).toBeLessThan(-1);
  });
});

describe('wiring', () => {
  it('analyzeVideo builds the track for any generated bed with a map (placed or not), from the plan\'s loudness map, after placement', async () => {
    const {readFileSync} = await import('node:fs');
    const source = readFileSync(new URL('../../pipeline/analyzeVideo.ts', import.meta.url), 'utf8');
    const placement = source.indexOf('audioDesign = withPlacement(audioDesign, planned.placement);');
    const track = source.indexOf('const track = buildBedLoudnessTrack({');
    expect(placement).toBeGreaterThan(0);
    expect(track).toBeGreaterThan(placement);
    expect(source).toContain("if (resolved.source === 'generated' && audioDesign.duck && !audioDesign.duck.bedLoudness) {");
    expect(source).toContain('bed: musicPlan?.placement,');
    expect(source).toContain('startOffsetSec: placed?.startOffsetSec ?? 0,');
    expect(source).toContain('loopFromSec: placed ? placed.loopFromSec : legacyLoopFrom,');
    expect(source).toContain('if (track) {');
    // not gated on MUSIC_PERSONALIZE: it is the voice-first fix
    const block = source.slice(source.indexOf('// Loudness-aware ducking (Phase 3.1)'), track);
    expect(block).not.toContain('personalizeEnabled');
  });
  it('without placement the loop takes over at the end of the full bed on a long timeline, as MusicBedTrack does', () => {
    const meta = bed(-16, -16, {hasLoop: true, loopDurationSec: 8, loopBars: 4, loopLoudnessMap: [-13, -13, -13, -13]});
    const track = buildBedLoudnessTrack({bed: meta, startOffsetSec: 0, loopFromSec: 58.5, durationSec: 75, duck: staticDuck(), carved: false})!;
    const at = (t: number) => track.lufs[Math.round(t / track.stepSec)]!;
    expect(at(50)).toBeCloseTo(-16, 0);
    expect(at(70)).toBeCloseTo(-13, 0);
  });
});
