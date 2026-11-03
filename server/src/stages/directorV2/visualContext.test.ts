/**
 * Deterministic tests for the visual-context path: frame coverage, trim time mapping, honest unknowns, focus evidence.
 * BEFORE (legacy, pinned by golden/legacy-frame-times.json) vs AFTER (VISUAL_CONTEXT_V2) are both asserted here.
 * No model, no ffmpeg (stubbed), no network.
 */
import {describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {legacyStoryboardTimes, LEGACY_FRAME_SEND_LIMIT} from './storyboardPlan.ts';
import {
  buildCoverage,
  buildVisualContext,
  coverContentRect,
  coverageFrameTimes,
  evaluateFocus,
  formatVisualContext,
  outputToSourceSec,
  sourceBoxToRendered,
  visualContextFromSingleOccupancy,
  OBSERVATION_HORIZON_SEC,
} from './visualContext.ts';

const decoded = vi.hoisted(() => ({times: [] as number[], occupancyAt: [] as number[]}));
vi.mock('../../media/ffmpeg.ts', async importOriginal => ({...(await importOriginal<typeof import('../../media/ffmpeg.ts')>()), extractStillJpeg: async (_i: string, _o: string, at: number) => void decoded.times.push(Number(at.toFixed(3)))}));
vi.mock('../layout/occupancy.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../layout/occupancy.ts')>();
  return {
    ...actual,
    measureOccupancyAt: async (input: {atSec: number}) => {
      decoded.occupancyAt.push(Number(input.atSec.toFixed(3)));
      return actual.occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision');
    },
  };
});

const {buildPerceptionPack, formatFrameLabels, formatOccupancySlices, frameSendLimit, framesSentToDirector, measuredSpanSentence} = await import('./perception.ts');

/** The saved Hi clip's trim: two silences removed (0.58 s at 4.16 s, 0.32 s at 42.2 s). */
const HI_SEGMENTS = [
  {sourceStart: 0, sourceEnd: 4.16, outputStart: 0},
  {sourceStart: 4.74, sourceEnd: 42.2, outputStart: 4.16},
  {sourceStart: 42.52, sourceEnd: 48.72, outputStart: 41.62},
];
const HI_OUTPUT = 47.82;

describe('frame coverage: before and after', () => {
  it('BEFORE: legacy samples only the first ~14 s and the Director receives only the first 8 frames', () => {
    const times = legacyStoryboardTimes(HI_OUTPUT);
    expect(times).toHaveLength(10);
    expect(times.at(-1)).toBeCloseTo(13.9, 5);
    const sent = times.slice(0, LEGACY_FRAME_SEND_LIMIT);
    expect(sent.at(-1)).toBeCloseTo(10.9, 5);
    expect(buildCoverage(sent, HI_OUTPUT).unseen.at(-1)).toEqual({start: 12.9, end: HI_OUTPUT});
  });

  it('AFTER: frames are spread across the whole timeline and every frame is sent', () => {
    const times = coverageFrameTimes(HI_OUTPUT);
    expect(times).toHaveLength(10);
    expect(times[0]!).toBeGreaterThan(0);
    expect(times.at(-1)!).toBeLessThan(HI_OUTPUT);
    expect(times.at(-1)!).toBeGreaterThan(HI_OUTPUT - 6);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(Math.max(...gaps)).toBeCloseTo(HI_OUTPUT / 10, 5);
    expect(new Set(gaps.map(g => g.toFixed(4))).size).toBe(1);
  });

  it('short and degenerate durations stay valid', () => {
    expect(coverageFrameTimes(0)).toEqual([]);
    expect(coverageFrameTimes(-3)).toEqual([]);
    const short = coverageFrameTimes(3);
    expect(short).toHaveLength(2);
    short.forEach(t => expect(t).toBeGreaterThan(0) && expect(t).toBeLessThan(3));
    expect(coverageFrameTimes(600)).toHaveLength(10);
  });

  it('reports the spans that were not observed, and none when the spread covers the video', () => {
    const coverage = buildCoverage(coverageFrameTimes(HI_OUTPUT), HI_OUTPUT);
    expect(coverage.horizonSec).toBe(OBSERVATION_HORIZON_SEC);
    // spacing 4.78 s, horizon ±2 s: each gap between frames leaves 0.78 s unobserved
    expect(coverage.unseen.length).toBeGreaterThan(0);
    coverage.unseen.forEach(span => expect(span.end - span.start).toBeLessThan(1));
    expect(buildCoverage([5, 7, 9], 12).unseen).toEqual([{start: 0, end: 3}, {start: 11, end: 12}]);
    expect(buildCoverage([1, 3, 5, 7, 9, 11], 12).unseen).toEqual([]);
    expect(buildCoverage([], 10).unseen).toEqual([{start: 0, end: 10}]);
  });
});

describe('time mapping through the trim', () => {
  it('maps output → source through the keep segments', () => {
    expect(outputToSourceSec(HI_SEGMENTS, 3)).toBeCloseTo(3, 6);
    // At the cut the output instant 4.16 s is the FIRST frame after the cut (source 4.74 s), not the last one before it.
    expect(outputToSourceSec(HI_SEGMENTS, 4.16)).toBeCloseTo(4.74, 6);
    expect(outputToSourceSec(HI_SEGMENTS, 4.16 - 1e-4)).toBeCloseTo(4.16, 3);
    expect(outputToSourceSec(HI_SEGMENTS, 41.62)).toBeCloseTo(42.52, 6);
    expect(outputToSourceSec(HI_SEGMENTS, 0)).toBe(0);
    expect(outputToSourceSec(HI_SEGMENTS, 10)).toBeCloseTo(10.58, 6);
    expect(outputToSourceSec(HI_SEGMENTS, 41.7)).toBeCloseTo(42.6, 6);
    expect(outputToSourceSec(HI_SEGMENTS, 100)).toBeCloseTo(48.72, 6);
    expect(outputToSourceSec(HI_SEGMENTS, -1)).toBe(0);
    expect(outputToSourceSec([], 7.5)).toBe(7.5);
  });

  it('round-trips with the forward map for every sampled frame', () => {
    const timeline = buildTimeline(HI_SEGMENTS as never);
    for (const t of coverageFrameTimes(HI_OUTPUT)) {
      expect(timeline.mapSourceToOutputClamped(outputToSourceSec(HI_SEGMENTS, t))).toBeCloseTo(t, 4);
    }
  });

  it('BEFORE: the legacy path decodes the file at the OUTPUT time, so every frame after a cut shows the wrong instant', () => {
    const timeline = buildTimeline(HI_SEGMENTS as never);
    const errors = legacyStoryboardTimes(HI_OUTPUT).map(t => timeline.mapSourceToOutputClamped(t) - t);
    // frame decoded at source t but meant for output t: after the 0.58 s cut at 4.16 s the content shown is 0.58 s early
    expect(errors[0]).toBeCloseTo(0, 6);
    errors.slice(3).forEach(e => expect(e).toBeCloseTo(-0.58, 2));
  });
});

describe('perception pack: legacy vs VISUAL_CONTEXT_V2', () => {
  const baseInput = (visualContext: boolean) => ({
    captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}],
    sourceWords: [{text: 'a', start: 0, end: 1}],
    transcript: 'a',
    timeline: buildTimeline(HI_SEGMENTS as never),
    sourcePath: '/dev/null',
    stillDir: (name: string) => `/tmp/${name}`,
    visualContext,
  });

  it('flag defaults to off', () => {
    expect(env.VISUAL_CONTEXT_V2).toBe(false);
  });

  it('default path: decodes at the SOURCE instant of each output time, keeps 10 sampled / 8 sent, no visual context, face box still printed', async () => {
    decoded.times = [];
    const pack = await buildPerceptionPack(baseInput(false) as never);
    // Output sampling times are the pinned legacy ones (golden/legacy-frame-times.json); only the decode instant is corrected.
    expect(pack.storyboard.map(frame => Number(frame.atSec.toFixed(3)))).toEqual(legacyStoryboardTimes(HI_OUTPUT).map(t => Number(t.toFixed(3))));
    expect(decoded.times.slice(0, 10)).toEqual(legacyStoryboardTimes(HI_OUTPUT).map(t => Number(outputToSourceSec(HI_SEGMENTS, t).toFixed(3))));
    expect(pack.storyboard.every(frame => frame.sourceSec !== undefined)).toBe(true);
    expect(pack.visualContext).toBeUndefined();
    expect(frameSendLimit(pack)).toBe(LEGACY_FRAME_SEND_LIMIT);
    expect(formatOccupancySlices(pack)).toContain('face=');
    expect(formatFrameLabels(pack)).not.toContain('NOT SHOWN');
  });

  it('default path: only the frames that are attached are labelled (10 sampled, 8 sent, 8 labelled; budget unchanged)', async () => {
    const pack = await buildPerceptionPack(baseInput(false) as never);
    const sent = framesSentToDirector(pack);
    expect(pack.storyboard).toHaveLength(10);
    expect(sent).toHaveLength(LEGACY_FRAME_SEND_LIMIT);
    expect(sent.map(frame => frame.atSec)).toEqual(legacyStoryboardTimes(HI_OUTPUT).slice(0, LEGACY_FRAME_SEND_LIMIT));
    const labels = formatFrameLabels(pack).split('\n');
    expect(labels).toHaveLength(8);
    expect(labels.at(-1)).toBe('frame 7 @ 10.90s');
    // the two stills the sampler cuts but never attaches are not described to the Director
    expect(formatFrameLabels(pack)).not.toContain('12.40s');
    expect(formatFrameLabels(pack)).not.toContain('13.90s');
  });

  it('visual-context path: every labelled frame is attached and the coverage lists exactly those frames', async () => {
    const pack = await buildPerceptionPack(baseInput(true) as never);
    const sent = framesSentToDirector(pack);
    expect(sent).toHaveLength(pack.storyboard.length);
    expect(frameSendLimit(pack)).toBe(sent.length);
    const labelled = (formatFrameLabels(pack).match(/^frame \d+ @ ([\d.]+)s/gm) ?? []).map(line => Number(line.split('@ ')[1]!.replace('s', '')));
    expect(labelled).toEqual(sent.map(frame => Number(frame.atSec.toFixed(2))));
    expect(pack.visualContext!.coverage.sampledOutputSec).toEqual(sent.map(frame => Number(frame.atSec.toFixed(2))));
    expect(formatFrameLabels(pack)).toContain('pictures shown (each is ONE still of its own instant): ' + pack.visualContext!.frames.filter(frame => frame.role === 'storyboard').map(frame => `${frame.outputSec.toFixed(1)}s`).join(', '));
  });

  it('visual context: decodes at SOURCE times, records both, sends all frames, says what was not seen, claims no face', async () => {
    decoded.times = [];
    decoded.occupancyAt = [];
    const pack = await buildPerceptionPack(baseInput(true) as never);
    const outputTimes = coverageFrameTimes(HI_OUTPUT);
    const r3 = (list: Array<number | undefined>) => list.map(value => Number((value ?? NaN).toFixed(3)));
    expect(r3(pack.storyboard.map(frame => frame.atSec))).toEqual(r3(outputTimes));
    expect(r3(pack.storyboard.map(frame => frame.sourceSec))).toEqual(r3(outputTimes.map(t => outputToSourceSec(HI_SEGMENTS, t))));
    expect(decoded.times.slice(0, outputTimes.length)).toEqual(r3(outputTimes.map(t => outputToSourceSec(HI_SEGMENTS, t))));
    expect(frameSendLimit(pack)).toBe(10);
    const context = pack.visualContext!;
    expect(context.frames.filter(f => f.role === 'storyboard').every(f => f.timeMap === 'trim_inverse_v1')).toBe(true);
    expect(context.coordinateSpace).toBe('rendered_frame_normalized');
    const text = formatFrameLabels(pack);
    expect(text).toContain('NOT SHOWN');
    expect(text).toContain('only that instant is known');
    expect(text).toContain('No face, product, screen or object locations are available');
    expect(formatOccupancySlices(pack)).not.toContain('face=');
    // Occupancy is measured at source times too, and the main measurement is recorded where it was taken.
    decoded.occupancyAt.forEach(at => expect(at).toBeGreaterThan(0));
  });

  it('places the main occupancy measurement at its true time instead of labelling it 0.4 s', async () => {
    const primary = (await import('../layout/occupancy.ts')).occupancyFromSpeaker({x: 0.3, y: 0.2, w: 0.4, h: 0.5}, 'vision');
    const pack = await buildPerceptionPack({...baseInput(true), primaryOccupancy: primary, activeSourceDurationSec: 48.72} as never);
    const expectedOutput = buildTimeline(HI_SEGMENTS as never).mapSourceToOutput(Math.max(0.4, Math.min(48.72 * 0.28, 48.72 - 0.4)))!;
    const person = pack.visualContext!.observations.find(obs => obs.kind === 'person' && obs.box?.x === 0.3)!;
    const frame = pack.visualContext!.frames.find(f => f.id === person.frameId)!;
    expect(frame.outputSec).toBeCloseTo(expectedOutput, 2);
    expect(frame.outputSec).not.toBeCloseTo(0.4, 1);
  });
});

describe('occupancy text in the visual-context path reports measurements, not copies', () => {
  it('lists only the measured slices (not the 0.5 s nearest-neighbour copies) and labels a fallback box as unknown', async () => {
    const occupancy = await import('../layout/occupancy.ts');
    const pack = {
      occupancySlices: Array.from({length: 20}, (_, i) => ({atSec: i * 0.5, occupancy: occupancy.occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback')})),
      measuredOccupancy: [
        {atSec: 3, occupancy: occupancy.occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision')},
        {atSec: 9, occupancy: occupancy.occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback')},
      ],
      visualContext: {},
    } as never;
    const text = formatOccupancySlices(pack);
    expect(text.split('\n').filter(line => line.startsWith('@'))).toHaveLength(2);
    expect(text).toContain('@3.00s speaker box measured: 0.20,0.10,0.60,0.70 (this instant only)');
    expect(text).toContain('@9.00s speaker position UNKNOWN (detection unavailable');
    expect(text).toContain('Between these instants the speaker position is unknown; measurements span');
    expect(text).not.toContain('face=');
  });

  it('legacy (no measuredOccupancy) is unchanged: dense per-slice lines with an invented face box', async () => {
    const occupancy = await import('../layout/occupancy.ts');
    const pack = {occupancySlices: Array.from({length: 6}, (_, i) => ({atSec: i * 0.5, occupancy: occupancy.occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback')}))} as never;
    expect(formatOccupancySlices(pack)).toContain('face=');
  });
});

describe('default path: main occupancy measurement placement and honest drops (Decision 1)', () => {
  const input = (segments: typeof HI_SEGMENTS, extra: Record<string, unknown> = {}) => ({
    captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}],
    sourceWords: [{text: 'a', start: 0, end: 1}],
    transcript: 'a',
    timeline: buildTimeline(segments as never),
    sourcePath: '/dev/null',
    stillDir: (name: string) => `/tmp/${name}`,
    visualContext: false,
    ...extra,
  });

  it('is placed at the output time of its source instant (not labelled 0.4 s) and the other two measurements are decoded at mapped source times', async () => {
    decoded.occupancyAt = [];
    const occupancy = await import('../layout/occupancy.ts');
    const primary = occupancy.occupancyFromSpeaker({x: 0.3, y: 0.2, w: 0.4, h: 0.5}, 'vision');
    const pack = await buildPerceptionPack(input(HI_SEGMENTS, {primaryOccupancy: primary, activeSourceDurationSec: 48.72}) as never);
    const sampleSource = occupancy.occupancySampleSec(48.72);
    expect(pack.occupancyMeasurements!.map(item => item.atSec)).toEqual([...pack.occupancyMeasurements!.map(item => item.atSec)].sort((a, b) => a - b));
    expect(pack.occupancyMeasurements!.some(item => Math.abs(item.atSec - buildTimeline(HI_SEGMENTS as never).mapSourceToOutput(sampleSource)!) < 0.011)).toBe(true);
    expect(pack.occupancyMeasurements!.some(item => item.atSec === 0.4)).toBe(false);
    // two NEW measurements only (the primary replaces the 0.4 s slot): the model-call count is unchanged
    expect(decoded.occupancyAt).toHaveLength(2);
    expect(decoded.occupancyAt).toEqual([HI_OUTPUT * 0.45, HI_OUTPUT - 0.6].map(t => Number(outputToSourceSec(HI_SEGMENTS, t).toFixed(3))));
  });

  it('a main measurement that falls inside trimmed-away audio cannot be placed: it is dropped, not mislabelled, and no extra call is made', async () => {
    decoded.occupancyAt = [];
    const occupancy = await import('../layout/occupancy.ts');
    const primary = occupancy.occupancyFromSpeaker({x: 0.3, y: 0.2, w: 0.4, h: 0.5}, 'vision');
    // sample = 0.28 × 15.714 = 4.4 s of source, inside the removed 4.16–4.74 s silence
    const sample = occupancy.occupancySampleSec(15.714);
    expect(buildTimeline(HI_SEGMENTS as never).mapSourceToOutput(sample)).toBeNull();
    const pack = await buildPerceptionPack(input(HI_SEGMENTS, {primaryOccupancy: primary, activeSourceDurationSec: 15.714}) as never);
    expect(pack.occupancyMeasurements).toHaveLength(2);
    expect(pack.occupancySlices.some(slice => slice.occupancy === primary)).toBe(false);
    expect(decoded.occupancyAt).toHaveLength(2);
  });

  it('an untrimmed clip is unaffected: decode time equals output time, sourceSec equals atSec, the main box sits at its source time', async () => {
    decoded.times = [];
    const occupancy = await import('../layout/occupancy.ts');
    const primary = occupancy.occupancyFromSpeaker({x: 0.3, y: 0.2, w: 0.4, h: 0.5}, 'vision');
    const whole = [{sourceStart: 0, sourceEnd: 40, outputStart: 0}];
    const pack = await buildPerceptionPack(input(whole as never, {primaryOccupancy: primary, activeSourceDurationSec: 40}) as never);
    expect(decoded.times.slice(0, 10)).toEqual(legacyStoryboardTimes(40).map(t => Number(t.toFixed(3))));
    expect(pack.storyboard.every(frame => Math.abs(frame.sourceSec! - frame.atSec) < 1e-9)).toBe(true);
    expect(pack.occupancyMeasurements!.some(item => Math.abs(item.atSec - occupancy.occupancySampleSec(40)) < 1e-9)).toBe(true);
    expect(frameSendLimit(pack)).toBe(8);
    expect(framesSentToDirector(pack)).toHaveLength(8);
  });
});

describe('measured span disclosure', () => {
  it('names the span the measurements cover and where nothing was measured', () => {
    expect(measuredSpanSentence([13.1, 21.5, 47.2], 47.5)).toBe('measurements span 13.1–47.2s; nothing was measured before 13.1s');
    expect(measuredSpanSentence([0.4, 47.4], 47.5)).toBe('measurements span 0.4–47.4s');
    expect(measuredSpanSentence([5], 20)).toBe('measurements span 5.0–5.0s; nothing was measured before 5.0s or after 5.0s');
  });

  it('is printed by the default and the visual-context formatters', async () => {
    const occupancy = await import('../layout/occupancy.ts');
    const a = occupancy.occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision');
    const slices = Array.from({length: 40}, (_, i) => ({atSec: i * 0.5, occupancy: a}));
    const text = formatOccupancySlices({occupancySlices: slices, occupancyMeasurements: [{atSec: 10, source: 'vision'}, {atSec: 18, source: 'vision'}]} as never);
    expect(text).toContain('measurements span 10.0–18.0s; nothing was measured before 10.0s or after 18.0s');
    const flagged = formatOccupancySlices({occupancySlices: slices, measuredOccupancy: [{atSec: 10, occupancy: a}, {atSec: 18, occupancy: a}], visualContext: {}} as never);
    expect(flagged).toContain('measurements span 10.0–18.0s');
  });
});

describe('v2 Director text for speaker visibility (data side)', () => {
  it('a fallback-only pack no longer lists the whole video as confirmed-visible', async () => {
    const occupancy = await import('../layout/occupancy.ts');
    const fallback = occupancy.occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback');
    const {fillStage2User} = await import('./creativeDirector.ts');
    const pack = {words: [], sentences: [], storyboard: [], occupancySlices: Array.from({length: 20}, (_, i) => ({atSec: i * 0.5, occupancy: fallback})), audio: {pauses: [], emphasisWordIds: [], energyPeaks: []}, transcript: '', outputDurationSec: 10, language: 'en', creatorProfile: '', speakerCutoutAvailable: true, speakerCutoutNote: '', userAssets: [], requestedEdits: null, themeColors: []} as never;
    const text = fillStage2User(pack, {raw: {}} as never, '', false, null);
    expect(text).not.toMatch(/SPEAKER_VISIBLE_RANGES[^\n]*\n\s*0\.00–/);
    expect(text).toContain('unknown (treat as visible unless occupancy says the speaker is cropped/tiny)');
  });
});

describe('honest unknowns', () => {
  const timeline = buildTimeline(HI_SEGMENTS as never);

  it('a fallback speaker box is not an observation: no coordinates, no confidence', () => {
    const context = buildVisualContext({durationSec: 30, keepSegments: [], storyboardOutputSec: [], occupancy: [{outputSec: 10, occupancy: {speaker: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'}}]});
    expect(context.observations).toEqual([expect.objectContaining({kind: 'person', box: null, confidence: null, provenance: 'heuristic'})]);
    expect(evaluateFocus(context, {start: 9, end: 12}, {x: 0.5, y: 0.5})).toEqual({ok: false, reason: 'focus_without_visual_evidence'});
  });

  it('a detected box never claims a confidence', () => {
    const context = buildVisualContext({durationSec: 30, keepSegments: [], storyboardOutputSec: [], occupancy: [{outputSec: 10, occupancy: {speaker: {x: 0.2, y: 0.1, w: 0.6, h: 0.7}, source: 'vision'}}]});
    expect(context.observations[0]).toMatchObject({kind: 'person', confidence: null, provenance: 'occupancy_vision'});
  });

  it('v1: one measured box, placed on the output timeline; a cut-out sample yields no observation', () => {
    const ok = visualContextFromSingleOccupancy({durationSec: HI_OUTPUT, keepSegments: HI_SEGMENTS, sampleSourceSec: 13.64, mapSourceToOutput: timeline.mapSourceToOutput, occupancy: {speaker: {x: 0.2, y: 0.1, w: 0.6, h: 0.7}, source: 'vision'}});
    expect(ok.frames).toHaveLength(1);
    expect(ok.frames[0]!.outputSec).toBeCloseTo(13.06, 2);
    expect(ok.frames[0]!.sourceSec).toBeCloseTo(13.64, 2);
    expect(ok.coverage.unseen.length).toBeGreaterThan(0);
    const cut = visualContextFromSingleOccupancy({durationSec: HI_OUTPUT, keepSegments: HI_SEGMENTS, sampleSourceSec: 4.4, mapSourceToOutput: timeline.mapSourceToOutput, occupancy: {speaker: {x: 0.2, y: 0.1, w: 0.6, h: 0.7}, source: 'vision'}});
    expect(cut.frames).toEqual([]);
    expect(cut.observations).toEqual([]);
    expect(cut.coverage.unseen).toEqual([{start: 0, end: HI_OUTPUT}]);
  });

  it('v1 is shown NO picture: coverage says everything is unseen, and the box is reported as a measurement at one instant', () => {
    const context = visualContextFromSingleOccupancy({durationSec: HI_OUTPUT, keepSegments: HI_SEGMENTS, sampleSourceSec: 13.64, mapSourceToOutput: timeline.mapSourceToOutput, occupancy: {speaker: {x: 0.2, y: 0.1, w: 0.6, h: 0.7}, source: 'vision'}});
    // The measured frame is geometry, not a picture the Director saw (regression: it used to count as "observed" coverage).
    expect(context.coverage.sampledOutputSec).toEqual([]);
    expect(context.coverage.measuredOutputSec).toEqual([13.06]);
    expect(context.coverage.unseen).toEqual([{start: 0, end: HI_OUTPUT}]);
    const text = formatVisualContext(context);
    expect(text).toContain('pictures shown: none');
    expect(text).toMatch(/speaker position measured @13\.1s box x=0\.20 .*detected at that instant only/);
    expect(text).not.toContain('NOT SHOWN');
    expect(text).toContain('Do not give focus_x/focus_y for anything that is not a listed observation');
  });

  it('with stills: names the unseen spans and does not present "near a still" as inspection', () => {
    const context = buildVisualContext({durationSec: 40, keepSegments: [], storyboardOutputSec: [5, 20], occupancy: [{outputSec: 30, occupancy: {speaker: {x: 0.2, y: 0.1, w: 0.6, h: 0.7}, source: 'vision'}}]});
    // The occupancy measurement at 30 s must not close the gap between the stills.
    expect(context.coverage.unseen).toEqual([{start: 0, end: 3}, {start: 7, end: 18}, {start: 22, end: 40}]);
    const text = formatVisualContext(context);
    expect(text).toContain('NOT SHOWN (no still within ±2s): 0.0–3.0s, 7.0–18.0s, 22.0–40.0s');
    expect(text).toContain('only that instant is known; motion, gestures and cuts between stills are not');
  });
});

describe('coordinates against the rendered frame', () => {
  it('9:16 source: the whole frame is visible and boxes are unchanged', () => {
    expect(coverContentRect(1080, 1920)).toEqual({x: 0, y: 0, w: 1, h: 1});
    expect(sourceBoxToRendered({x: 0.2, y: 0.1, w: 0.5, h: 0.5}, {x: 0, y: 0, w: 1, h: 1})).toEqual({box: {x: 0.2, y: 0.1, w: 0.5, h: 0.5}, clipped: false});
  });

  it('landscape source: only the central strip is visible; boxes are clipped and remapped', () => {
    const rect = coverContentRect(1920, 1080, 1080, 1920);
    expect(rect.h).toBe(1);
    expect(rect.w).toBeCloseTo(0.3164, 3);
    expect(rect.x).toBeCloseTo(0.3418, 3);
    const centred = sourceBoxToRendered({x: 0.45, y: 0.3, w: 0.1, h: 0.4}, rect)!;
    expect(centred.clipped).toBe(false);
    expect(centred.box.x + centred.box.w / 2).toBeCloseTo(0.5, 2);
    expect(sourceBoxToRendered({x: 0.0, y: 0.2, w: 0.2, h: 0.4}, rect)).toBeNull();
    const partial = sourceBoxToRendered({x: 0.3, y: 0.2, w: 0.2, h: 0.4}, rect)!;
    expect(partial.clipped).toBe(true);
    expect(partial.box.x).toBe(0);
  });

  it('objectPosition shifts the visible strip', () => {
    expect(coverContentRect(1920, 1080, 1080, 1920, {x: 0, y: 0}).x).toBe(0);
    expect(coverContentRect(1920, 1080, 1080, 1920, {x: 1, y: 0}).x).toBeCloseTo(1 - 0.3164, 3);
  });

  it('degenerate sizes fall back to the full frame', () => {
    expect(coverContentRect(0, 0)).toEqual({x: 0, y: 0, w: 1, h: 1});
  });
});

describe('focus evidence (the gate behind VISUAL_CONTEXT_V2)', () => {
  const context = (boxes: Array<{at: number; box: {x: number; y: number; w: number; h: number} | null}>) =>
    buildVisualContext({durationSec: 40, keepSegments: [], storyboardOutputSec: [], occupancy: boxes.map(item => ({outputSec: item.at, occupancy: {speaker: item.box ?? {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: item.box ? ('vision' as const) : ('fallback' as const)}}))});
  const person = {x: 0.3, y: 0.2, w: 0.4, h: 0.5};

  it('accepts a focus inside an observed box near the window', () => {
    const decision = evaluateFocus(context([{at: 10, box: person}]), {start: 10.5, end: 12.5}, {x: 0.5, y: 0.4});
    expect(decision.ok).toBe(true);
  });

  it('refuses without context, without a nearby frame, without a box, or outside the box', () => {
    expect(evaluateFocus(null, {start: 10, end: 12}, {x: 0.5, y: 0.5})).toEqual({ok: false, reason: 'focus_without_visual_evidence'});
    expect(evaluateFocus(context([{at: 10, box: person}]), {start: 30, end: 32}, {x: 0.5, y: 0.4})).toEqual({ok: false, reason: 'focus_without_visual_evidence'});
    expect(evaluateFocus(context([{at: 10, box: null}]), {start: 10, end: 12}, {x: 0.5, y: 0.5})).toEqual({ok: false, reason: 'focus_without_visual_evidence'});
    expect(evaluateFocus(context([{at: 10, box: person}]), {start: 10, end: 12}, {x: 0.95, y: 0.95})).toEqual({ok: false, reason: 'focus_outside_observed_subject'});
  });

  it('a still more than 1 s from the zoom window no longer authorises a focus (coverage horizon is not evidence)', () => {
    const c = context([{at: 10, box: person}]);
    expect(evaluateFocus(c, {start: 10.9, end: 12.5}, {x: 0.5, y: 0.4}).ok).toBe(true);
    expect(evaluateFocus(c, {start: 11.5, end: 13}, {x: 0.5, y: 0.4})).toEqual({ok: false, reason: 'focus_without_visual_evidence'});
    expect(evaluateFocus(c, {start: 7, end: 8.9}, {x: 0.5, y: 0.4})).toEqual({ok: false, reason: 'focus_without_visual_evidence'});
  });

  it('uses a small tolerance at the box edge but not beyond it', () => {
    const c = context([{at: 10, box: person}]);
    expect(evaluateFocus(c, {start: 10, end: 12}, {x: 0.3 - 0.05, y: 0.4}).ok).toBe(true);
    expect(evaluateFocus(c, {start: 10, end: 12}, {x: 0.3 - 0.2, y: 0.4}).ok).toBe(false);
  });

  it('refuses when the subject moves across the frames near the window', () => {
    const c = context([{at: 10, box: person}, {at: 12, box: {x: 0.55, y: 0.2, w: 0.4, h: 0.5}}]);
    expect(evaluateFocus(c, {start: 10, end: 12}, {x: 0.5, y: 0.4})).toEqual({ok: false, reason: 'focus_subject_moves'});
  });
});

describe('zoom focus gate wiring (resolveDirectedZooms)', () => {
  it('keeps the zoom, drops the focus, and notes why; legacy (no gate) keeps the focus', async () => {
    const {resolveDirectedZooms} = await import('../filters/autoZoom.ts');
    const {identityTimeline} = await import('../filters/timeline.ts');
    const notes: string[] = [];
    const words = [{text: 'Hello.', start: 0, end: 1}, {text: 'This', start: 5, end: 5.4}, {text: 'matters.', start: 5.4, end: 6}];
    const run = (gate?: (z: unknown, w: {start: number; end: number}, f: {x: number; y: number}) => string | null) =>
      resolveDirectedZooms({directed: [{timestamp: 5.2, durationSec: 1.5, focus: {x: 0.8, y: 0.3}}], words: words as never, timeline: identityTimeline(30), scale: 1.25, maxDurationSec: 2, ...(gate ? {focusEvidence: gate} : {}), trace: {keep: (_z, _t, note) => notes.push(note ?? ''), drop: () => undefined}})[0]!;
    expect(run().focus).toEqual({x: 0.8, y: 0.3});
    const gated = run(() => 'focus_without_visual_evidence');
    expect(gated.focus).toBeUndefined();
    expect(gated.scale).toBe(1.25);
    expect(notes.at(-1)).toBe('zoom_focus_dropped:focus_without_visual_evidence');
    const accepted = run(() => null);
    expect(accepted.focus).toEqual({x: 0.8, y: 0.3});
  });
});
