/**
 * OCCUPANCY_CONTEXT_V2 contract tests: the model-facing occupancy text under both flag states. Offline: the v1 request body is
 * captured from the real planVisualDirection with the HTTP layer mocked; the v2 text comes from the real formatters. No model.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {describeOccupancyForDirector, occupancyFromSpeaker} from '../layout/occupancy.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {frameSendLimit, framesSentToDirector, formatOccupancySlices, unobservedRanges} from './perception.ts';
import {confirmedVisibilityText, fillStage2User} from './creativeDirector.ts';
import {declaredOccupancySampling, occupancyContractMismatches, producedOccupancySampling} from './occupancyContract.ts';

const captured = vi.hoisted(() => ({bodies: [] as Array<Record<string, any>>, decodedOccupancy: [] as number[], extracted: [] as number[]}));
vi.mock('../../lib/http.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/http.ts')>()),
  requestJson: async (_url: string, options: {body?: string}) => {
    captured.bodies.push(JSON.parse(options.body ?? '{}'));
    return {candidates: [{content: {parts: [{text: JSON.stringify({topic: 't', hook_title: 'Silence Speaks', moments: [{timestamp: 8, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}})}]}}]};
  },
}));
vi.mock('../../media/ffmpeg.ts', async importOriginal => ({...(await importOriginal<typeof import('../../media/ffmpeg.ts')>()), extractStillJpeg: async (_i: string, _o: string, at: number) => void captured.extracted.push(at)}));
vi.mock('../layout/occupancy.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../layout/occupancy.ts')>();
  return {...actual, measureOccupancyAt: async (input: {atSec: number}) => (captured.decodedOccupancy.push(input.atSec), actual.occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision'))};
});
const {buildPerceptionPack} = await import('./perception.ts');

const e = env as unknown as {OCCUPANCY_CONTEXT_V2: boolean; GEMINI_API_KEY: string};
const original = {flag: e.OCCUPANCY_CONTEXT_V2, key: e.GEMINI_API_KEY};
afterEach(() => {
  e.OCCUPANCY_CONTEXT_V2 = original.flag;
  e.GEMINI_API_KEY = original.key;
  captured.bodies.length = 0;
  captured.decodedOccupancy.length = 0;
  captured.extracted.length = 0;
});
const flag = (on: boolean) => {
  e.OCCUPANCY_CONTEXT_V2 = on;
};

const detected = occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision');
const fallback = occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback');
const dense = (measured: Array<{atSec: number; occupancy: typeof detected}>, duration: number) => {
  const slices: Array<{atSec: number; occupancy: typeof detected}> = [];
  for (let t = 0; t <= duration + 0.001; t += 0.5) {
    slices.push({atSec: Number(t.toFixed(2)), occupancy: measured.reduce((best, m) => (Math.abs(m.atSec - t) < Math.abs(best.atSec - t) ? m : best)).occupancy});
  }
  return slices;
};
const packOf = (measured: Array<{atSec: number; occupancy: typeof detected}>, duration = 47.8) =>
  ({occupancySlices: dense(measured, duration), occupancyMeasured: measured, occupancyMeasurements: measured.map(m => ({atSec: m.atSec, source: m.occupancy.source})), outputDurationSec: duration}) as never;

describe('defaults', () => {
  it('OCCUPANCY_CONTEXT_V2 is off by default', () => {
    expect(original.flag).toBe(false);
  });
});

describe('v2 occupancy text', () => {
  const measured = [{atSec: 13.1, occupancy: detected}, {atSec: 21.5, occupancy: fallback}, {atSec: 47.2, occupancy: detected}];

  it('OFF: the existing text (dense copies, face= key, NOTE line from Phase 16) is unchanged', () => {
    flag(false);
    const text = formatOccupancySlices(packOf(measured));
    expect(text.split('\n')[0]).toMatch(/^NOTE: only 3 speaker measurements exist/);
    expect(text).toContain('face=0.20,0.10,0.60,0.29');
    expect(text.split('\n').filter(line => line.startsWith('@'))).toHaveLength(16);
    expect(text).not.toContain('NOT OBSERVED');
  });

  it('ON: one line per independent measurement, labelled detected or UNKNOWN; no line repeats another', () => {
    flag(true);
    const text = formatOccupancySlices(packOf(measured));
    const lines = text.split('\n').filter(line => line.startsWith('@'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('@13.10s speaker box DETECTED: 0.20,0.10,0.60,0.70 (this instant only; confidence not given)');
    expect(lines[1]).toContain('@21.50s speaker position UNKNOWN: detection failed');
    expect(lines[1]).toContain('DEFAULT box');
    expect(lines[1]).toContain('it is not the speaker\'s position');
    expect(lines[2]).toContain('@47.20s speaker box DETECTED');
    expect(text).toContain('3 independent measurements; each line is a different instant; no line repeats another');
  });

  it('ON: the face box is only ever a labelled estimate (never `face=`, never for an undetected speaker)', () => {
    flag(true);
    const text = formatOccupancySlices(packOf(measured));
    expect(text).not.toContain('face=');
    const [detectedLine, unknownLine] = text.split('\n').filter(line => line.startsWith('@'));
    expect(detectedLine).toContain('face box ESTIMATE, not measured (42% of the person-box height): 0.20,0.10,0.60,0.29');
    expect(unknownLine).toContain('no face information');
    expect(unknownLine).not.toContain('ESTIMATE');
  });

  it('ON: coverage comes from the actual observations, and unobserved ranges are named, not smoothed over', () => {
    flag(true);
    const text = formatOccupancySlices(packOf(measured));
    expect(text).toContain('measurements span 13.1–47.2s; nothing was measured before 13.1s');
    expect(text).toContain('NOT OBSERVED');
    expect(text).toContain('0.0–13.1s, 13.1–21.5s, 21.5–47.2s, 47.2–47.8s');
    expect(text).toContain('must not be assumed to match the nearest measurement');
    expect(unobservedRanges([10, 18], 40)).toEqual([{start: 0, end: 10}, {start: 10, end: 18}, {start: 18, end: 40}]);
    expect(unobservedRanges([], 10)).toEqual([{start: 0, end: 10}]);
  });

  it('ON: dense copies do not become observations — 96 identical slices still read as the 1 measurement behind them', () => {
    flag(true);
    const text = formatOccupancySlices(packOf([{atSec: 10, occupancy: detected}], 48));
    expect(text.split('\n').filter(line => line.startsWith('@'))).toHaveLength(1);
    expect(text).toContain('1 independent measurement;');
  });

  it('ON: no measurement at all means unknown everywhere (not full-video visibility)', () => {
    flag(true);
    const text = formatOccupancySlices({occupancySlices: dense([{atSec: 0, occupancy: fallback}], 20), outputDurationSec: 20} as never);
    expect(text).toContain('no speaker measurement exists');
    expect(text).toContain('unknown at every time');
  });

  it('ON: nothing tells the Director to assume visibility', () => {
    flag(true);
    expect(formatOccupancySlices(packOf(measured))).not.toMatch(/treat as visible|assume the speaker is visible(?! there)/i);
  });

  it('the diagnostic recognises the mode and the disclosures under the flag', () => {
    flag(true);
    const produced = producedOccupancySampling(packOf(measured));
    expect(produced).toMatchObject({mode: 'measured_only', linesShown: 3, measurements: 3, facePrinted: false});
    expect(produced.disclosure).toMatchObject({copies: true, estimatedFace: true, defaultBoxMarked: true, measuredSpanStated: true});
    expect(occupancyContractMismatches(declaredOccupancySampling(), produced)).toContain('declared_per_slice_but_only_measured_instants_shown');
  });
});

describe('v2 Director: speaker visibility text', () => {
  const stage2 = (pack: object) =>
    fillStage2User({words: [], sentences: [], storyboard: [], audio: {pauses: [], emphasisWordIds: [], energyPeaks: []}, transcript: '', outputDurationSec: 20, language: 'en', creatorProfile: '', speakerCutoutAvailable: true, speakerCutoutNote: '', userAssets: [], requestedEdits: null, themeColors: [], ...pack} as never, {raw: {}} as never, '', false, null);

  it('OFF: the existing instruction is unchanged', () => {
    flag(false);
    expect(stage2({occupancySlices: dense([{atSec: 0, occupancy: fallback}], 20)})).toContain('unknown (treat as visible unless occupancy says the speaker is cropped/tiny)');
  });

  it('ON: fallback-only data is "unknown", and the assume-visible instruction is gone', () => {
    flag(true);
    const text = stage2({occupancySlices: dense([{atSec: 0, occupancy: fallback}], 20), occupancyMeasured: [{atSec: 0, occupancy: fallback}]});
    expect(text).toContain('unknown: visibility is not confirmed at any time');
    expect(text).not.toContain('treat as visible');
  });

  it('ON: confirmation is only at measured instants where the speaker was detected and framed acceptably, never extended across time', () => {
    flag(true);
    const tight = occupancyFromSpeaker({x: 0.01, y: 0.3, w: 0.2, h: 0.2}, 'vision');
    expect(confirmedVisibilityText({occupancyMeasured: [{atSec: 5, occupancy: detected}, {atSec: 12, occupancy: tight}, {atSec: 18, occupancy: fallback}]} as never)).toBe(
      'confirmed only at the measured instants 5.0s; unknown at every other time (do not assume the speaker is visible there)',
    );
  });
});

describe('v1 occupancy block (real planVisualDirection request, HTTP mocked)', () => {
  const request = async (on: boolean, occupancy = detected, atSec: number | null = 13.1) => {
    flag(on);
    e.GEMINI_API_KEY = 'test-key';
    const {planVisualDirection} = await import('../broll/geminiDirector.ts');
    await planVisualDirection({transcript: 'Quiet moments speak. We explore silence.', sourceDurationSec: 30, momentCount: 2, occupancy, occupancyAtSec: atSec});
    const body = captured.bodies.at(-1)!;
    return {body, prompt: body.contents[0].parts[0].text as string};
  };
  const stripBlock = (prompt: string) => prompt.replace(/FRAME_OCCUPANCY[\s\S]*?Titles, cards, and pip tiles must end above y=0\.72\.\n/, '<OCC>\n');

  it('OFF: exactly the existing block (box with source=, open_side)', async () => {
    const {prompt} = await request(false);
    expect(prompt).toContain('speaker_box: x=0.20 y=0.10 w=0.60 h=0.70 source=vision');
    expect(prompt).toContain('open_side: left');
    expect(prompt).not.toContain('DETECTED');
    expect(prompt).toContain(describeOccupancyForDirector(detected));
  });

  it('ON, detected: the box is one measurement at one instant; the face is not detected', async () => {
    const {prompt} = await request(true);
    expect(prompt).toContain('speaker_box DETECTED at 13.1s in ONE frame (confidence not given): x=0.20 y=0.10 w=0.60 h=0.70. Where the speaker is at any other time is unknown.');
    expect(prompt).toContain('face box: not detected. Any face region you infer from the speaker box is an estimate, not a measurement.');
    expect(prompt).not.toContain('source=vision');
  });

  it('ON, undetected: the default box is said to be a default, not a position', async () => {
    const {prompt} = await request(true, fallback, null);
    expect(prompt).toContain('speaker position UNKNOWN: detection failed.');
    expect(prompt).toContain('LEGAL_SLOTS (accent overlays only; computed from the DEFAULT box, not from a detected position):');
    expect(prompt).not.toContain('open_side');
    expect(prompt).not.toContain('source=fallback');
  });

  it('only the occupancy block differs: system instruction, schema, config and every other prompt line are identical', async () => {
    const off = await request(false);
    const on = await request(true);
    expect(on.body.systemInstruction).toEqual(off.body.systemInstruction);
    expect(on.body.generationConfig).toEqual(off.body.generationConfig);
    expect(stripBlock(on.prompt)).toBe(stripBlock(off.prompt));
    expect(on.prompt).not.toBe(off.prompt);
  });

  it('the legal-slot geometry and rules are unchanged under the flag (only the claims about the box are corrected)', async () => {
    const occupancy = occupancyFromSpeaker({x: 0.05, y: 0.3, w: 0.4, h: 0.5}, 'vision');
    const off = await request(false, occupancy);
    const on = await request(true, occupancy);
    const slots = (prompt: string) => prompt.split('\n').filter(line => line.startsWith('- ') && line.includes('rect='));
    expect(slots(off.prompt).length).toBeGreaterThan(0);
    expect(slots(on.prompt)).toEqual(slots(off.prompt));
  });
});

describe('the flag changes text only: no extra images, no extra measurements, same sampling', () => {
  const HI = [
    {sourceStart: 0, sourceEnd: 4.16, outputStart: 0},
    {sourceStart: 4.74, sourceEnd: 42.2, outputStart: 4.16},
    {sourceStart: 42.52, sourceEnd: 48.72, outputStart: 41.62},
  ];
  const run = async (on: boolean) => {
    flag(on);
    captured.decodedOccupancy.length = 0;
    captured.extracted.length = 0;
    const pack = await buildPerceptionPack({captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}], sourceWords: [{text: 'a', start: 0, end: 1}], transcript: 'a', timeline: buildTimeline(HI as never), sourcePath: '/dev/null', stillDir: (n: string) => `/tmp/${n}`, visualContext: false, primaryOccupancy: detected, activeSourceDurationSec: 48.72} as never);
    return {pack, occupancyCalls: [...captured.decodedOccupancy], stills: [...captured.extracted]};
  };

  it('same 8-image budget, same still times, same number and times of occupancy measurements', async () => {
    const off = await run(false);
    const on = await run(true);
    expect(frameSendLimit(on.pack)).toBe(8);
    expect(framesSentToDirector(on.pack)).toHaveLength(8);
    expect(on.stills).toEqual(off.stills);
    expect(on.occupancyCalls).toEqual(off.occupancyCalls);
    expect(on.pack.storyboard.map(frame => frame.atSec)).toEqual(off.pack.storyboard.map(frame => frame.atSec));
    expect(on.pack.occupancyMeasured!.map(slice => slice.atSec)).toEqual(off.pack.occupancyMeasured!.map(slice => slice.atSec));
  });
});
