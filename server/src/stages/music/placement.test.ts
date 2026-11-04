import {describe, expect, it} from 'vitest';

import {placementGainAt} from '../../../../remotion/src/audio/placementGain.ts';
import type {AudioDesign} from '../../types/blueprint.ts';
import {buildDuckEnvelope, duckDbAt} from './duckEnvelope.ts';
import {buildIntensityCurve} from './intensity.ts';
import {hookAtFrom, planPlacement} from './personalize.ts';
import {BUTTON_FADE_SEC, HOLD_FADE_SEC, placeMusic, placementFields, withPlacement} from './placement.ts';
import type {BedPlacementMeta} from './placementMeta.ts';

/** 120 bpm: bar 2.0 s, beat 0.5 s. Bar lines every 2 s from 0.5 s (so the bed's first bar line is not at 0). */
function bed(over: Partial<BedPlacementMeta> & {bars?: number; liftBar?: number | null} = {}): BedPlacementMeta {
  const bars = over.bars ?? 28;
  const liftBar = over.liftBar === undefined ? 8 : over.liftBar;
  const downbeatTimes = Array.from({length: bars}, (_, i) => 0.5 + i * 2);
  const energyMap = downbeatTimes.map((_, i) => (liftBar !== null && i >= liftBar ? 0.9 : 0.15));
  return {
    downbeatTimes,
    energyMap,
    liftSec: liftBar === null ? null : downbeatTimes[liftBar]!,
    liftBar,
    barSec: 2,
    fullDurationSec: 56,
    hasLoop: false,
    loopDurationSec: null,
    loopBars: null,
    ...over,
  };
}
const flat = (seconds: number) => Array.from({length: seconds}, () => 0.3);

describe('intensity curve', () => {
  it('has one value per second, bounded 0..1, and rises around events and fast speech', () => {
    const quiet = buildIntensityCurve({durationSec: 20});
    expect(quiet).toHaveLength(20);
    expect(Math.max(...quiet)).toBe(0);
    const busy = buildIntensityCurve({
      durationSec: 20,
      cutTimesSec: [5.2, 5.6],
      zoomTimesSec: [5.4],
      plateTimesSec: [5.5, 5.7],
      popTimesSec: [5.1],
      words: Array.from({length: 30}, (_, i) => ({start: 4 + i * 0.1, end: 4.08 + i * 0.1})),
    });
    expect(Math.max(...busy)).toBeLessThanOrEqual(1);
    expect(Math.min(...busy)).toBeGreaterThanOrEqual(0);
    expect(busy[5]!).toBeGreaterThan(busy[12]!);
    expect(busy[12]).toBe(0);
    expect(buildIntensityCurve({durationSec: 0.4, cutTimesSec: [0.1]})).toHaveLength(1);
  });
});

describe('start offset', () => {
  it('puts the measured lift on the hook: the lift lands within a beat of hookAt, from a downbeat', () => {
    const placement = placeMusic({bed: bed(), durationSec: 30, hookAtSec: 2.5, intensity: flat(30), bpm: 120});
    // lift at bed 16.5 s, hook 2.5 s: the downbeat at 14.5 s puts the lift at 2.0 s (one beat early); 12.5 s would be 3 beats late
    expect(placement).toMatchObject({startOffsetSec: 14.5, liftAtVideoSec: 2, liftErrBeats: 1, startsOnDownbeat: true, reason: 'placed'});
    expect(placement.score).toBeGreaterThan(0.5);
  });

  it('follows a hook that comes later', () => {
    const placement = placeMusic({bed: bed(), durationSec: 30, hookAtSec: 5, intensity: flat(30), bpm: 120});
    // lift at bed 16.5 s: downbeat 10.5 puts it at 6.0 and 12.5 at 4.0, both a beat from the hook; the tie goes to the earlier downbeat
    expect(placement.startOffsetSec).toBe(10.5);
    expect(placement.liftErrBeats).toBeLessThanOrEqual(2);
  });

  it('is always on a downbeat of the bed, whatever the hook and duration', () => {
    const meta = bed();
    for (const hook of [1.5, 2.5, 3.7, 6]) {
      for (const duration of [12, 15, 24.6, 40, 55]) {
        const out = placeMusic({bed: meta, durationSec: duration, hookAtSec: hook, intensity: flat(Math.ceil(duration)), bpm: 120});
        expect(meta.downbeatTimes, `hook ${hook} duration ${duration}`).toContain(out.startOffsetSec);
        expect(out.startsOnDownbeat).toBe(true);
      }
    }
  });

  it('with no lift in the bed, the energy shape is matched to the video intensity', () => {
    // 4 quiet bars then 4 loud bars, repeating every 16 s; the video is 8 s quiet then 8 s busy
    const downbeatTimes = Array.from({length: 32}, (_, i) => 0.5 + i * 2);
    const energyMap = downbeatTimes.map((_, i) => ((i % 8) < 4 ? 0.1 : 0.9));
    const meta = bed({downbeatTimes, energyMap, liftSec: null, liftBar: null, fullDurationSec: 66});
    const intensity = Array.from({length: 16}, (_, s) => (s < 8 ? 0.05 : 0.9));
    const out = placeMusic({bed: meta, durationSec: 16, hookAtSec: 2.5, intensity, bpm: 120});
    expect((out.startOffsetSec - 0.5) % 16).toBeCloseTo(0, 6);
    const wrong = placeMusic({bed: meta, durationSec: 16, hookAtSec: 2.5, intensity: intensity.map(v => 1 - v), bpm: 120});
    expect((wrong.startOffsetSec - 0.5) % 16).not.toBeCloseTo(0, 6); // the opposite intensity picks a different phase
  });

  it('prefers a quiet bar under the first 1.5 s', () => {
    // two candidates with the same lift error: one starts in a loud bar, one in a quiet one
    const downbeatTimes = Array.from({length: 20}, (_, i) => 0.5 + i * 2);
    const energyMap = downbeatTimes.map((_, i) => (i === 3 ? 0.95 : 0.1));
    const meta = bed({downbeatTimes, energyMap, liftSec: null, liftBar: null, fullDurationSec: 40});
    const out = placeMusic({bed: meta, durationSec: 12, hookAtSec: 2.5, intensity: flat(12), bpm: 120});
    expect(out.startOffsetSec).not.toBe(downbeatTimes[3]);
  });
});

describe('ending', () => {
  const at = (duration: number) => placeMusic({bed: bed(), durationSec: duration, hookAtSec: 2.5, intensity: flat(Math.ceil(duration)), bpm: 120});
  it('buttons on the last bar line when it is within 1.5 s of the end: 120 ms fade, silent after', () => {
    // offset 14.5: bar lines every 2 s in video time from 0
    const out = at(19.2);
    expect(out).toMatchObject({endType: 'button', endFadeSec: BUTTON_FADE_SEC});
    expect(out.barLinesSec).toContain(18);
    expect(out.endSec).toBeCloseTo(18.12, 3);
    expect(placementGainAt(18, out.endSec, out.endFadeSec)).toBe(1); // the bar line itself plays
    expect(placementGainAt(18.12, out.endSec, out.endFadeSec)).toBe(0);
    expect(placementGainAt(19.1, out.endSec, out.endFadeSec)).toBe(0);
  });
  it('lands exactly on a bar line at the end', () => {
    const out = at(20);
    expect(out.endType).toBe('button');
    expect(out.endSec).toBe(20);
  });
  it('holds to the end and fades over the last 400 ms when the last bar line is more than 1.5 s early', () => {
    const out = at(19.9); // last bar line 18, 1.9 s early
    expect(out).toMatchObject({endType: 'hold-fade', endFadeSec: HOLD_FADE_SEC, endSec: 19.9});
    expect(placementGainAt(19.4, out.endSec, out.endFadeSec)).toBe(1);
    expect(placementGainAt(19.7, out.endSec, out.endFadeSec)).toBeCloseTo(0.5, 6);
  });
});

describe('loop hand-off when the video is longer than the full bed', () => {
  const looped = bed({hasLoop: true, loopDurationSec: 32, loopBars: 16}); // 2.0 s bars
  it('hands off on a bar line, keeps the grid after it and ends on a bar line', () => {
    const out = placeMusic({bed: looped, durationSec: 90, hookAtSec: 2.5, intensity: flat(90), bpm: 120});
    expect(out.loopFromSec).not.toBeNull();
    expect(out.barLinesSec).toContain(out.loopFromSec);
    expect(out.loopFromSec!).toBeLessThanOrEqual(56 - out.startOffsetSec + 1e-6);
    expect(out.loopFromSec!).toBeGreaterThan(56 - out.startOffsetSec - 2.01); // the last bar line of the full bed
    const after = out.barLinesSec.filter(t => t > out.loopFromSec!);
    expect(after.length).toBeGreaterThan(5);
    expect(after[1]! - after[0]!).toBeCloseTo(2, 3);
    const last = out.barLinesSec.at(-1)!;
    expect(out.endType).toBe('button');
    expect(90 - last).toBeLessThanOrEqual(1.5);
    expect(out.endSec).toBeCloseTo(Math.min(90, last + BUTTON_FADE_SEC), 3);
    expect(placementFields(out).musicLoopFromSec).toBe(out.loopFromSec);
  });
  it('a video the full bed covers needs no hand-off', () => {
    expect(placeMusic({bed: looped, durationSec: 20, hookAtSec: 2.5, intensity: flat(20), bpm: 120}).loopFromSec).toBeNull();
  });
  it('a long video with no loop body falls back to the first downbeat and ends with the file', () => {
    const out = placeMusic({bed: bed({hasLoop: false}), durationSec: 90, hookAtSec: 2.5, intensity: flat(90), bpm: 120});
    expect(out).toMatchObject({reason: 'no_valid_start', startOffsetSec: 0.5, startsOnDownbeat: true, loopFromSec: null});
    expect(out.endSec).toBeCloseTo(55.5, 3);
  });
});

describe('without bed meta', () => {
  it('starts at 0, holds and fades at the end, and reports no score', () => {
    for (const meta of [undefined, null, bed({downbeatTimes: [1]}), bed({fullDurationSec: null})]) {
      const out = placeMusic({bed: meta, durationSec: 30, hookAtSec: 2.5, intensity: flat(30)});
      expect(out).toMatchObject({startOffsetSec: 0, endSec: 30, endType: 'hold-fade', endFadeSec: 0.4, score: null, startsOnDownbeat: false, reason: 'no_meta'});
    }
  });
});

describe('voice-first: placement never changes a level', () => {
  const words = Array.from({length: 40}, (_, i) => ({start: 1 + i * 0.4, end: 1.3 + i * 0.4}));
  const duck = buildDuckEnvelope({words, durationSec: 30, voLufs: -20, bedLufs: -16});
  const audio: AudioDesign = {sfx: [], musicUrl: 'https://media.kinmel.shop/b.wav', musicSource: 'generated', voLufs: -20, duck, ducking: true};
  const placement = placeMusic({bed: bed(), durationSec: 30, hookAtSec: 2.5, intensity: flat(30), bpm: 120});

  it('the duck envelope is identical with placement on and off', () => {
    const placed = withPlacement(audio, placement);
    expect(placed.duck).toEqual(audio.duck);
    for (let frame = 0; frame < 30 * 120; frame += 1) expect(duckDbAt(placed.duck as never, frame / 120)).toBe(duckDbAt(audio.duck as never, frame / 120));
    const {musicStartOffsetSec: _a, musicEndSec: _b, musicEndFadeSec: _c, musicEndType: _d, musicLoopFromSec: _e, musicPlacementScore: _f, ...rest} = placed;
    expect(rest).toEqual(audio);
  });
  it('writes only the six placement fields, and none of them is a gain', () => {
    expect(Object.keys(placementFields(placement)).sort()).toEqual(['musicEndFadeSec', 'musicEndSec', 'musicEndType', 'musicPlacementScore', 'musicStartOffsetSec']);
    expect(Object.keys(placementFields({...placement, loopFromSec: 3})).length).toBe(6);
  });
  it('the end fade can only lower the bed: gain is within 0..1 at every moment', () => {
    for (let t = -1; t < 40; t += 0.013) {
      const g = placementGainAt(t, placement.endSec, placement.endFadeSec);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
    expect(placementGainAt(5, undefined, undefined)).toBe(1);
  });
});

describe('planPlacement', () => {
  it('builds the brief with the real events and the known hook/CTA, then places the bed', () => {
    const words = Array.from({length: 90}, (_, i) => ({start: i * 0.3, end: i * 0.3 + 0.25})); // about 200 wpm: high energy
    const out = planPlacement({
      videoId: 'v', words, durationSec: 30, visualMood: 'bold_energetic', contentType: 'motivational',
      cutTimesSec: [3, 6, 9], zoomTimesSec: [4], plateTimesSec: [5], popTimesSec: [7],
      hookStartSec: 0, hookDurationSec: 3, ctaAtSec: 27, bed: bed(),
    });
    expect(out.brief).toMatchObject({style: 'driving-electronic', hookAtSec: 3, ctaAtSec: 27, arc: 'build'});
    expect(out.brief.cutsPerMin).toBe(8);
    expect(out.placement.reason).toBe('placed');
    expect(out.intensity).toHaveLength(30);
    expect(hookAtFrom(undefined, undefined)).toBe(2.5);
    expect(hookAtFrom(0, 9)).toBe(6);
    expect(hookAtFrom(0, 0.4)).toBe(1.5);
  });
});

describe('new edits only', () => {
  it('a blueprint without placement fields hands the renderer no placement keys, so it takes the old branches', async () => {
    const {bedSpecFor} = await import('./mixMeasure.ts');
    expect(bedSpecFor({musicUrl: 'u', musicFullUrl: 'f', musicSource: 'generated'})).toEqual({musicFullUrl: 'f', musicSource: 'generated'});
    expect(bedSpecFor({musicUrl: 'u', musicStartOffsetSec: 14.5, musicEndSec: 30, musicEndFadeSec: 0.12, musicLoopFromSec: 20})).toEqual({
      musicStartOffsetSec: 14.5, musicEndSec: 30, musicEndFadeSec: 0.12, musicLoopFromSec: 20,
    });
  });
  it('analyzeVideo places and snaps only behind MUSIC_PERSONALIZE, and only for a generated bed', async () => {
    const {readFileSync} = await import('node:fs');
    const source = readFileSync(new URL('../../pipeline/analyzeVideo.ts', import.meta.url), 'utf8');
    expect(source).toContain("if (personalizeEnabled() && resolved.source === 'generated' && audioDesign.musicUrl) {");
    expect(source).toContain('placementForSfx = planned.placement;');
    expect(source).toContain("if (placement && ((placement.beatsSec.length > 0 && (audioDesign.hits?.length ?? 0) > 0) || wantsHookCta)) {");
  });
});
