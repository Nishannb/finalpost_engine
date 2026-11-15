/**
 * Match Cut shutter (pure): which events get the treatment and the sound, where the sound starts, how it is leveled, and that its numbers stay in step with the Remotion side.
 * The supplied asset is pinned by checksum so it cannot be replaced or re-encoded unnoticed. Rendered-MP4 sync is proven separately (docs/mobile-integration/KINETIC_V1_RELEASE_IMPLEMENTATION_REPORT.md), not here.
 */
import {createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {SHUTTER_CLICK_COUNT, SHUTTER_SCENE_SEC, SHUTTER_ENTRY_SEC, SHUTTER_MAX_SIGMA, SHUTTER_TRAVEL, MATCH_CUT_SPECS, planShutterScenes, shutterLayoutOrder, SHUTTER_ROW_FACTORS, shutterCutFrame, shutterEntryFrames, shutterRowMotion, shutterSceneAt} from '../../../../remotion/src/lib/textMatchCut.ts';
import {MATCHCUT_AUDIO, MATCHCUT_HIT_REASON, MATCHCUT_RENDER_LATENCY_SEC, applyMatchCutShutter, matchCutShutterHits, shutterBurstSec, shutterLeadFrames, shutterRepeatStarts, speechConflict} from './matchCutShutter.ts';
import {parseIntegratedLufs} from './voiceLoudness.ts';
import type {RenderSpec} from './schema.ts';

const asset = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../remotion/public/sfx/matchcut.mp3');
const ev = (id: string, presetResolved: string, inFrame: number, withProps = true) => ({id, presetResolved, inFrame, outFrame: inFrame + 54, ...(withProps && presetResolved === 'type.matchCut' ? {matchCut: {keyword: 'secret', phrase: 'the secret to growth is simple', variant: 'memo'}} : {})});
const spec = (events: unknown[], fps = 30) => ({fps, events} as unknown as RenderSpec);

describe('the supplied asset', () => {
  it('is present and byte-identical to the file that was supplied (sha256), so it was neither replaced nor re-encoded', () => {
    expect(existsSync(asset)).toBe(true);
    expect(createHash('sha256').update(readFileSync(asset)).digest('hex')).toBe('d3ce0efee1870a468973e56c1a4b1fa28b6bbef8211a387a89206152995693c7');
  });
});

describe('Remotion and server agree on the shutter numbers', () => {
  it('11 clicks, 100 ms scenes: cut k is at round(k * 100 ms * fps), so it tracks click k to within half a frame at every frame rate', () => {
    expect(SHUTTER_CLICK_COUNT).toBe(MATCHCUT_AUDIO.clickCount);
    expect(SHUTTER_SCENE_SEC).toBeCloseTo(MATCHCUT_AUDIO.clickPeriodSec, 9);
    expect([0, 1, 2, 10].map(k => shutterCutFrame(k, 30))).toEqual([0, 3, 6, 30]);
    expect([0, 1, 2, 10].map(k => shutterCutFrame(k, 60))).toEqual([0, 6, 12, 60]);
    expect((SHUTTER_CLICK_COUNT - 1) * SHUTTER_SCENE_SEC + SHUTTER_ENTRY_SEC).toBeCloseTo(shutterBurstSec(), 9);
    expect(shutterEntryFrames(30)).toBe(2);
  });

  it('the burst fits inside the sound: the visual never needs the sound to be repeated', () => {
    expect(shutterBurstSec()).toBeLessThan(MATCHCUT_AUDIO.durationSec);
    expect(shutterRepeatStarts(12, shutterBurstSec())).toEqual([12]);
  });
});

describe('applyMatchCutShutter', () => {
  it('marks only type.matchCut events that carry props, and changes nothing else', () => {
    const input = spec([ev('a', 'type.words', 10), ev('m', 'type.matchCut', 120), ev('b', 'type.matchCut', 400, false)]);
    const out = applyMatchCutShutter(input);
    expect((out.events[1] as {matchCut: {shutter?: boolean}}).matchCut.shutter).toBe(true);
    expect(out.events[0]).toBe(input.events[0]);
    expect(out.events[2]).toBe(input.events[2]);
  });

  it('a plan with no Match Cut is returned untouched (same object)', () => {
    const input = spec([ev('a', 'type.words', 10)]);
    expect(applyMatchCutShutter(input)).toBe(input);
  });
});

describe('matchCutShutterHits', () => {
  const words = [1, 3.9, 4.0, 9].map(start => start);

  it('places exactly one sound at the first frame of each shutter Match Cut, and none when there is no Match Cut', () => {
    const marked = applyMatchCutShutter(spec([ev('m', 'type.matchCut', 120), ev('w', 'type.words', 300)]));
    const {hits, report} = matchCutShutterHits(marked, {voLufs: -20, wordOnsetsSec: words});
    expect(hits).toHaveLength(1);
    expect(hits[0]!.at).toBeCloseTo(119 / 30, 5);
    expect(hits[0]).toMatchObject({kind: 'hit', reason: MATCHCUT_HIT_REASON, src: MATCHCUT_AUDIO.src, durationSec: 1.09, sourceChannels: 1});
    expect(report).toMatchObject({matchCuts: 1, hits: 1, dropped: null});
    expect(matchCutShutterHits(applyMatchCutShutter(spec([ev('w', 'type.words', 300)])), {voLufs: -20, wordOnsetsSec: words}).hits).toEqual([]);
  });

  it('an unmarked Match Cut (shutter off) gets no sound', () => {
    expect(matchCutShutterHits(spec([ev('m', 'type.matchCut', 120)]), {voLufs: -20, wordOnsetsSec: []}).hits).toEqual([]);
  });

  it('the sound is started the measured render latency early, in whole frames (24 fps: 1, 30: 1, 60: 3), so it lands on its cut, never after it', () => {
    expect([24, 30, 60].map(shutterLeadFrames)).toEqual([1, 1, 3]);
    expect(MATCHCUT_RENDER_LATENCY_SEC).toBeCloseTo(0.043, 6);
  });

  it('every sound lands (frame-rounded) on its event first frame minus the lead at 24, 30 and 60 fps', () => {
    for (const fps of [24, 30, 60]) {
      const {hits} = matchCutShutterHits(applyMatchCutShutter(spec([ev('m', 'type.matchCut', 97)], fps)), {voLufs: -18, wordOnsetsSec: []});
      // the renderer converts seconds to a frame with Math.round (remotion/src/lib/timeline.ts secToFrame): it must land on the event's own first frame, with the error far below half a frame
      const expected = 97 - shutterLeadFrames(fps);
      expect(Math.abs(hits[0]!.at * fps - expected)).toBeLessThan(1e-3);
      expect(Math.round(hits[0]!.at * fps)).toBe(expected);
    }
  });

  it('voice first: the peak is at the policy offset under the voice and never closer than -6 LU; an unmeasured voice drops the sound instead of guessing', () => {
    const marked = applyMatchCutShutter(spec([ev('m', 'type.matchCut', 120)]));
    const loud = matchCutShutterHits(marked, {voLufs: -18, wordOnsetsSec: [], offsetLu: -10});
    expect(loud.report.peakVsVoiceLu).toBeLessThanOrEqual(-6);
    expect(loud.report.peakVsVoiceLu).toBeCloseTo(-10, 1);
    expect(matchCutShutterHits(marked, {voLufs: -18, wordOnsetsSec: [], offsetLu: -2}).report.peakVsVoiceLu).toBeLessThanOrEqual(-6);
    for (const voLufs of [null, Number.NaN]) {
      const dropped = matchCutShutterHits(marked, {voLufs, wordOnsetsSec: []});
      expect(dropped.hits).toEqual([]);
      expect(dropped.report.dropped).toBe('voice_loudness_unknown');
    }
  });

  it('speech protection: the sound is OMITTED (the Match Cut stays) when it would start inside a spoken word or within 120 ms before one; it plays when there is a real gap', () => {
    const marked = applyMatchCutShutter(spec([ev('m', 'type.matchCut', 120)])); // hit starts at 119/30 = 3.9667 s
    const at = 119 / 30;
    const spans = (gapStart: number, gapEnd: number): Array<[number, number]> => [[gapStart - 0.4, gapStart], [gapEnd, gapEnd + 0.4]];
    const inside = matchCutShutterHits(marked, {voLufs: -20, wordOnsetsSec: [], wordSpansSec: [[at - 0.1, at + 0.2]]});
    expect(inside.hits).toEqual([]);
    expect(inside.report).toMatchObject({omittedForSpeech: 1, hits: 0, peakVsVoiceLu: null});
    const justBefore = matchCutShutterHits(marked, {voLufs: -20, wordOnsetsSec: [], wordSpansSec: [[at + 0.1, at + 0.5]]}); // word starts 100 ms after the sound: inside the 120 ms guard
    expect(justBefore.hits).toEqual([]);
    const clear = matchCutShutterHits(marked, {voLufs: -20, wordOnsetsSec: [], wordSpansSec: spans(at - 0.3, at + 0.14)}); // previous word ended 0.3 s before, next starts 140 ms after
    expect(clear.hits).toHaveLength(1);
    expect(clear.report.omittedForSpeech).toBe(0);
    expect(speechConflict(at, [[at + 0.121, at + 0.5]])).toBe(false);
    expect(speechConflict(at, [[at + 0.119, at + 0.5]])).toBe(true);
    expect(speechConflict(at, [[at - 1, at + 0.0001]])).toBe(true); // the word is still being spoken when the sound would start
    expect(speechConflict(at, [[at - 1, at - 0.01]])).toBe(false); // the word ended 10 ms before the sound starts
  });
});

describe('repeat starts do not drift (longer visuals, several events)', () => {
  it('each repeat is computed from the absolute time, so the error never exceeds half a frame however many repeats', () => {
    const fps = 30;
    const starts = shutterRepeatStarts(10, 10 * MATCHCUT_AUDIO.durationSec);
    expect(starts).toHaveLength(10);
    starts.forEach((s, r) => {
      const ideal = 10 + r * MATCHCUT_AUDIO.durationSec;
      expect(Math.abs(Math.round(s * fps) / fps - ideal)).toBeLessThanOrEqual(0.5 / fps + 1e-6);
    });
  });

  it('several Match Cut events each receive their own sound at their own frame', () => {
    const marked = applyMatchCutShutter(spec([ev('m1', 'type.matchCut', 60), ev('m2', 'type.matchCut', 900), ev('m3', 'type.matchCut', 1800)]));
    expect(matchCutShutterHits(marked, {voLufs: -20, wordOnsetsSec: []}).hits.map(h => Math.round(h.at * 30))).toEqual([59, 899, 1799]);
  });
});

describe('voice loudness parsing', () => {
  it('reads the ebur128 summary and rejects silence / garbage', () => {
    expect(parseIntegratedLufs('x\n  Integrated loudness:\n    I:         -19.4 LUFS\n    Threshold: -29.5 LUFS\n')).toBe(-19.4);
    expect(parseIntegratedLufs('  Integrated loudness:\n    I:         -70.0 LUFS')).toBeNull();
    expect(parseIntegratedLufs('nothing here')).toBeNull();
  });
});

describe('the shutter visual grammar (remotion/src/lib/textMatchCut.ts, pure)', () => {
  const scenes = planShutterScenes({variant: 'memo', keyword: 'secret'});

  it('one scene per click, never the same layout twice in a row, the keyword is the same word in every scene', () => {
    expect(scenes).toHaveLength(SHUTTER_CLICK_COUNT);
    scenes.slice(1).forEach((sc, i) => expect(sc.layoutId).not.toBe(scenes[i]!.layoutId));
    expect(new Set(scenes.map(sc => sc.keyword))).toEqual(new Set(['secret']));
  });

  it('every cut is a meaningful change: no two adjacent scenes share a layout, and the layouts alternate large and small typography', () => {
    for (const variant of ['memo', 'editorial', 'newsprint'] as const) {
      const sc = planShutterScenes({variant, keyword: 'secret'});
      sc.slice(1).forEach((x, i) => expect(x.layoutId).not.toBe(sc[i]!.layoutId));
      expect(new Set(shutterLayoutOrder(variant))).toEqual(new Set(MATCH_CUT_SPECS[variant].cycle)); // the variant's own layouts, nothing added
    }
    for (const variant of ['memo', 'editorial', 'newsprint'] as const) {
      const spec = MATCH_CUT_SPECS[variant];
      const wt = (id: string) => Math.max(0.2, ...spec.layouts[id]!.rows.filter(r => r.kind !== 'kw').map(r => r.size));
      const order = shutterLayoutOrder(variant);
      for (let i = 0; i < order.length; i++) {
        const x = wt(order[i]!), y = wt(order[(i + 1) % order.length]!);
        expect(Math.max(x, y) / Math.min(x, y), `${variant}: ${order[i]} -> ${order[(i + 1) % order.length]}`).toBeGreaterThan(1.12); // adjacent scenes (also across the loop) differ in type scale
      }
    }
  });

  it('cut k lands on the frame nearest to k x 100 ms at 24, 25, 30, 60 and 29.97 fps (never more than half a frame off, no accumulation); the last scene is the landing and holds', () => {
    for (const fps of [24, 25, 29.97, 30, 60]) {
      for (let k = 0; k < SHUTTER_CLICK_COUNT; k++) {
        const cut = shutterCutFrame(k, fps);
        expect(Math.abs(cut / fps - k * SHUTTER_SCENE_SEC)).toBeLessThanOrEqual(0.5 / fps + 1e-9);
        expect(shutterSceneAt(scenes, fps, cut).scene.index).toBe(k);
        expect(shutterSceneAt(scenes, fps, cut).local).toBe(0);
        if (k > 0) expect(shutterSceneAt(scenes, fps, cut - 1).scene.index).toBe(k - 1);
      }
      expect(shutterSceneAt(scenes, fps, Math.round(1.8 * fps) - 1).scene.index).toBe(SHUTTER_CLICK_COUNT - 1);
    }
    expect(Array.from({length: SHUTTER_CLICK_COUNT}, (_, k) => shutterCutFrame(k, 24))).toEqual([0, 2, 5, 7, 10, 12, 14, 17, 19, 22, 24]);
  });

  it('text moves fast and decisively at the cut (16 % of the width, blurred) and the entry settles in under 70 ms', () => {
    for (const fps of [24, 30, 60]) {
      const width = 1080;
      const at0 = shutterRowMotion(0, fps, width, 1);
      expect(Math.abs(at0.dx)).toBeCloseTo(SHUTTER_TRAVEL * width, 6);
      expect(Math.sign(at0.dx)).toBe(-1); // displaced against the direction of travel, then slides forward
      expect(at0.sigma).toBeGreaterThan(0);
      expect(shutterEntryFrames(fps) / fps).toBeLessThanOrEqual(0.09);
      for (let local = 0; local < 40; local++) expect(shutterRowMotion(local, fps, width, 1).sigma).toBeLessThanOrEqual(SHUTTER_MAX_SIGMA * width + 1e-9);
    }
  });

  it('NO FROZEN FRAMES: after the entry the text keeps drifting, so every frame of every scene differs from the previous one, at every frame rate, for every row speed and direction', () => {
    for (const fps of [24, 30, 60]) {
      for (const factor of SHUTTER_ROW_FACTORS) {
        for (const dir of [1, -1] as const) {
          for (let local = 1; local < 40; local++) {
            const a = shutterRowMotion(local - 1, fps, 1080, dir, factor);
            const b = shutterRowMotion(local, fps, 1080, dir, factor);
            expect(Math.abs(b.dx - a.dx), `fps ${fps} factor ${factor} local ${local}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('the landing decelerates to a crisp rest without a frozen frame: motion on every landing frame, no blur on the last ones', () => {
    for (const fps of [24, 30, 60]) {
      const landing = Math.round(0.3 * fps); // the real landing: 1.3 s window minus the 1.0 s of cuts
      for (const factor of SHUTTER_ROW_FACTORS) {
        for (let local = 1; local < landing; local++) {
          const a = shutterRowMotion(local - 1, fps, 1080, 1, factor, landing);
          const b = shutterRowMotion(local, fps, 1080, 1, factor, landing);
          expect(Math.abs(b.dx - a.dx), `fps ${fps} f ${factor} local ${local}`).toBeGreaterThan(0.02);
        }
        expect(shutterRowMotion(landing - 1, fps, 1080, 1, factor, landing).sigma).toBe(0); // crisp at the end
        const early = Math.abs(shutterRowMotion(5, fps, 1080, 1, factor, landing).dx - shutterRowMotion(4, fps, 1080, 1, factor, landing).dx);
        const late = Math.abs(shutterRowMotion(landing - 1, fps, 1080, 1, factor, landing).dx - shutterRowMotion(landing - 2, fps, 1080, 1, factor, landing).dx);
        expect(late).toBeLessThan(early);
      }
    }
  });

  it('rows move at different speeds, so the layers move against each other (not one sheet)', () => {
    const speeds = SHUTTER_ROW_FACTORS.map(f => Math.abs(shutterRowMotion(10, 30, 1080, 1, f).dx - shutterRowMotion(9, 30, 1080, 1, f).dx));
    expect(new Set(speeds.map(v => v.toFixed(3))).size).toBe(3);
  });

  it('the fast entry decelerates into the steady drift and never below it (speed falls monotonically to the drift speed), and the blur follows the speed', () => {
    for (const fps of [24, 30, 60]) {
      const pos = Array.from({length: 8}, (_, local) => shutterRowMotion(local, fps, 1080, 1, 1));
      const speed = pos.slice(1).map((p, i) => Math.abs(p.dx - pos[i]!.dx));
      const drift = (0.26 * 1080) / fps;
      for (let i = 1; i < speed.length; i++) expect(speed[i]!).toBeLessThanOrEqual(speed[i - 1]! + 1e-9);
      expect(speed[speed.length - 1]!).toBeCloseTo(drift, 3);
      expect(speed[0]!).toBeGreaterThan(drift * 2);
      for (let i = 1; i < pos.length; i++) expect(pos[i]!.sigma).toBeLessThanOrEqual(pos[i - 1]!.sigma + 1e-9);
    }
  });
});
