/**
 * Does a frame decoded for "output time t" really show the instant the edit calls t?
 *
 * A synthetic 49 s source (no real footage, no model) whose PIXELS encode their own timestamp:
 *   r = 255·T/49 (coarse), b = 8·(⌊T⌋ mod 32) (whole seconds), g = 255·frac(T) (fraction).
 * The real `buildPerceptionPack` + real ffmpeg (`extractStillJpeg`) decode stills from it through the Hi clip's silence
 * trim; the encoded timestamp is read back from the JPEG and compared with the frame's recorded source/output times.
 * Only the speaker-occupancy vision call is stubbed (it would be a paid call).
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {buildTimeline} from '../filters/timeline.ts';
import {coverageFrameTimes, outputToSourceSec} from './visualContext.ts';
import {legacyStoryboardTimes} from './storyboardPlan.ts';

vi.mock('../layout/occupancy.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../layout/occupancy.ts')>();
  return {...actual, measureOccupancyAt: async () => actual.occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision')};
});

const {buildPerceptionPack, formatFrameLabels, frameSendLimit, framesSentToDirector} = await import('./perception.ts');
const {frameParts} = await import('./geminiClient.ts');

const HI_SEGMENTS = [
  {sourceStart: 0, sourceEnd: 4.16, outputStart: 0},
  {sourceStart: 4.74, sourceEnd: 42.2, outputStart: 4.16},
  {sourceStart: 42.52, sourceEnd: 48.72, outputStart: 41.62},
];

const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
const haveFfmpeg = (() => {
  try {
    execFileSync(ffmpeg, ['-version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();
const scratch = mkdtempSync(join(tmpdir(), 'vc-decode-'));
const source = join(scratch, 'timestamp-pixels.mp4');

/** Recover the encoded source time from a decoded JPEG. */
function encodedTimeOf(jpegPath: string): number {
  const rgb = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', jpegPath, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1024});
  const [r, g, b] = [rgb[0]!, rgb[1]!, rgb[2]!];
  const coarse = (r * 49) / 255;
  const frac = g / 255;
  const nMod = Math.round(b / 8);
  const candidates = [0, 32].flatMap(k => [nMod + k - 32, nMod + k, nMod + k + 32]).filter(n => n >= 0).map(n => n + frac);
  return candidates.sort((a, b2) => Math.abs(a - coarse) - Math.abs(b2 - coarse))[0]!;
}

beforeAll(() => {
  if (!haveFfmpeg) {
    return;
  }
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x112:r=25:d=49', '-vf', "format=gbrp,geq=r='clip(255*T/49,0,255)':g='255*(T-floor(T))':b='8*mod(floor(T),32)',format=yuv444p", '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv444p', source]);
});
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

const run = (visualContext: boolean) => {
  const dir = mkdtempSync(join(scratch, visualContext ? 'on-' : 'off-'));
  return buildPerceptionPack({
    captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}],
    sourceWords: [{text: 'a', start: 0, end: 1}],
    transcript: 'a',
    timeline: buildTimeline(HI_SEGMENTS as never),
    sourcePath: source,
    stillDir: name => join(dir, name),
    visualContext,
  } as never);
};

describe.skipIf(!haveFfmpeg)('decoded frames show the instant they are labelled with (real ffmpeg, synthetic pixels)', () => {
  const timeline = buildTimeline(HI_SEGMENTS as never);

  it('control: the pixel decoder reads an untrimmed instant to ~0.1 s', () => {
    const file = join(scratch, 'control.jpg');
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '20.3', '-i', source, '-frames:v', '1', '-vf', 'scale=720:-2', file]);
    expect(Math.abs(encodedTimeOf(file) - 20.3)).toBeLessThan(0.12);
  });

  it('BEFORE (reproduced): decoding the file at the OUTPUT time gives an instant 0.58 s early for frames after the first cut', () => {
    const errors = legacyStoryboardTimes(timeline.outputDurationSec).map(t => {
      const file = join(scratch, `before-${t}.jpg`);
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', source, '-frames:v', '1', '-vf', 'scale=720:-2', file]);
      return timeline.mapSourceToOutputClamped(encodedTimeOf(file)) - t;
    });
    expect(Math.abs(errors[0]!)).toBeLessThan(0.12);
    errors.slice(3).forEach(error => expect(error).toBeLessThan(-0.4));
  });

  it('AFTER (default path, flag off): every attached frame shows exactly the output instant it is labelled with', async () => {
    const pack = await run(false);
    for (const frame of framesSentToDirector(pack)) {
      const decodedSource = encodedTimeOf(frame.path);
      expect(Math.abs(decodedSource - frame.sourceSec!), `source @${frame.atSec}`).toBeLessThan(0.12);
      expect(Math.abs(timeline.mapSourceToOutputClamped(decodedSource) - frame.atSec), `output @${frame.atSec}`).toBeLessThan(0.12);
    }
  });

  it('AFTER (VISUAL_CONTEXT_V2): every frame shows exactly the output instant it is labelled with', async () => {
    const pack = await run(true);
    expect(pack.storyboard).toHaveLength(10);
    for (const frame of pack.storyboard) {
      const decodedSource = encodedTimeOf(frame.path);
      expect(Math.abs(decodedSource - frame.sourceSec!), `source time of frame @${frame.atSec}`).toBeLessThan(0.12);
      expect(Math.abs(timeline.mapSourceToOutputClamped(decodedSource) - frame.atSec), `output time of frame @${frame.atSec}`).toBeLessThan(0.12);
    }
    // And the context records the same pair for the same frame.
    for (const frame of pack.visualContext!.frames.filter(item => item.role === 'storyboard')) {
      const stored = pack.storyboard.find(item => Math.abs(item.atSec - frame.outputSec) < 0.011)!;
      expect(Math.abs(stored.sourceSec! - frame.sourceSec)).toBeLessThan(0.011);
    }
  });

  it('the Director receives exactly the frames the labels describe (images attached == labelled frames)', async () => {
    const on = await run(true);
    const imagesOn = await frameParts(on.storyboard.map(frame => frame.path), frameSendLimit(on));
    expect(imagesOn).toHaveLength(on.storyboard.length);
    expect(formatFrameLabels(on).match(/^frame \d+ @/gm)).toHaveLength(imagesOn.length);
  });

  it('default path (flag off): 10 stills are sampled but only the 8 attached are labelled, and each image is the instant its label says', async () => {
    const off = await run(false);
    const sent = framesSentToDirector(off);
    const parts = await frameParts(sent.map(frame => frame.path), frameSendLimit(off));
    expect(off.storyboard).toHaveLength(10);
    expect(parts).toHaveLength(8);
    expect(sent).toHaveLength(8);
    expect(formatFrameLabels(off).match(/^frame \d+ @/gm)).toHaveLength(parts.length);
    // image i ↔ label i: decode the ATTACHED bytes themselves and compare with the label time (legacy decodes at the output time)
    parts.forEach((part, index) => {
      const file = join(scratch, `attached-off-${index}.jpg`);
      writeFileSync(file, Buffer.from((part as {inlineData: {data: string}}).inlineData.data, 'base64'));
      expect(Math.abs(timeline.mapSourceToOutputClamped(encodedTimeOf(file)) - sent[index]!.atSec), `image ${index}`).toBeLessThan(0.12);
    });
  });

  it('visual-context path: each attached image is the source instant its label maps to, in label order', async () => {
    const on = await run(true);
    const sent = framesSentToDirector(on);
    const parts = await frameParts(sent.map(frame => frame.path), frameSendLimit(on));
    expect(parts).toHaveLength(sent.length);
    const timeline = buildTimeline(HI_SEGMENTS as never);
    parts.forEach((part, index) => {
      const file = join(scratch, `attached-on-${index}.jpg`);
      writeFileSync(file, Buffer.from((part as {inlineData: {data: string}}).inlineData.data, 'base64'));
      const decoded = encodedTimeOf(file);
      expect(Math.abs(timeline.mapSourceToOutputClamped(decoded) - sent[index]!.atSec), `image ${index}`).toBeLessThan(0.12);
    });
  });
});

describe.skipIf(!haveFfmpeg)('default path: frame instants across trim layouts (real ffmpeg, synthetic pixels, flag off)', () => {
  const scenarios: Array<[string, Array<{sourceStart: number; sourceEnd: number; outputStart: number}>]> = [
    ['no trims', [{sourceStart: 0, sourceEnd: 49, outputStart: 0}]],
    ['multiple trims (the Hi layout)', HI_SEGMENTS],
    ['trim at the very start', [{sourceStart: 1.2, sourceEnd: 49, outputStart: 0}]],
    ['trim at the end', [{sourceStart: 0, sourceEnd: 40, outputStart: 0}]],
    ['a cut exactly on a sampled frame time (output 3.4 s)', [{sourceStart: 0, sourceEnd: 3.4, outputStart: 0}, {sourceStart: 5, sourceEnd: 49, outputStart: 3.4}]],
    ['several small trims near both ends', [{sourceStart: 0, sourceEnd: 0.8, outputStart: 0}, {sourceStart: 1.5, sourceEnd: 20, outputStart: 0.8}, {sourceStart: 22, sourceEnd: 40, outputStart: 19.3}, {sourceStart: 40.5, sourceEnd: 49, outputStart: 37.3}]],
  ];

  it.each(scenarios)('%s', async (_name, segments) => {
    const timeline = buildTimeline(segments as never);
    const dir = mkdtempSync(join(scratch, 'scn-'));
    const pack = await buildPerceptionPack({captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}], sourceWords: [{text: 'a', start: 0, end: 1}], transcript: 'a', timeline, sourcePath: source, stillDir: (name: string) => join(dir, name), visualContext: false} as never);
    const sent = framesSentToDirector(pack);
    // the request budget and label structure are unchanged
    expect(sent.length).toBe(Math.min(8, pack.storyboard.length));
    const parts = await frameParts(sent.map(frame => frame.path), frameSendLimit(pack));
    expect(parts).toHaveLength(sent.length);
    expect(formatFrameLabels(pack).match(/^frame \d+ @/gm)).toHaveLength(parts.length);
    // bytes ↔ label: decode the ATTACHED image and map its source instant back to the output timeline
    parts.forEach((part, index) => {
      const file = join(scratch, `scn-${index}-${Math.random().toString(36).slice(2)}.jpg`);
      writeFileSync(file, Buffer.from((part as {inlineData: {data: string}}).inlineData.data, 'base64'));
      const decodedSource = encodedTimeOf(file);
      expect(Math.abs(decodedSource - sent[index]!.sourceSec!), `source of image ${index}`).toBeLessThan(0.12);
      expect(Math.abs(timeline.mapSourceToOutputClamped(decodedSource) - sent[index]!.atSec), `output of image ${index} (label ${sent[index]!.atSec})`).toBeLessThan(0.12);
    });
  });

  it('before / at / after a cut: the inverse lands on the correct side', () => {
    const cut = [{sourceStart: 0, sourceEnd: 3.4, outputStart: 0}, {sourceStart: 5, sourceEnd: 49, outputStart: 3.4}];
    expect(outputToSourceSec(cut, 3.4 - 0.01)).toBeCloseTo(3.39, 6);
    expect(outputToSourceSec(cut, 3.4)).toBeCloseTo(5, 6);
    expect(outputToSourceSec(cut, 3.4 + 0.01)).toBeCloseTo(5.01, 6);
  });
});

describe('inverse mapping is consistent for arbitrary trims (property test, no media)', () => {
  /** Deterministic pseudo-random keep segments covering part of a source, in source order. */
  const segmentsFor = (seed: number, sourceDuration: number) => {
    let state = seed;
    const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const segments: Array<{sourceStart: number; sourceEnd: number; outputStart: number}> = [];
    let cursor = 0;
    let output = 0;
    while (cursor < sourceDuration - 0.5) {
      const keep = Math.min(0.5 + rand() * 12, sourceDuration - cursor);
      segments.push({sourceStart: cursor, sourceEnd: cursor + keep, outputStart: output});
      output += keep;
      cursor += keep + (rand() < 0.7 ? 0.2 + rand() * 6 : 0);
    }
    return {segments, outputDuration: output};
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('seed %i: every sampled frame maps into a kept segment and round-trips', seed => {
    const {segments, outputDuration} = segmentsFor(seed * 7919, 120);
    const timeline = buildTimeline(segments as never);
    expect(timeline.outputDurationSec).toBeCloseTo(outputDuration, 6);
    const times = coverageFrameTimes(outputDuration);
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (const t of times) {
      const s = outputToSourceSec(segments, t);
      expect(segments.some(segment => s >= segment.sourceStart - 1e-9 && s <= segment.sourceEnd + 1e-9), `source ${s} lies in a kept segment`).toBe(true);
      expect(timeline.mapSourceToOutputClamped(s)).toBeCloseTo(t, 4);
    }
  });

  it('boundaries: start, every cut, and the very end', () => {
    const timeline = buildTimeline(HI_SEGMENTS as never);
    expect(outputToSourceSec(HI_SEGMENTS, 0)).toBe(0);
    for (const segment of HI_SEGMENTS.slice(1)) {
      expect(outputToSourceSec(HI_SEGMENTS, segment.outputStart)).toBeCloseTo(segment.sourceStart, 6);
      expect(timeline.mapSourceToOutputClamped(segment.sourceStart)).toBeCloseTo(segment.outputStart, 6);
    }
    expect(outputToSourceSec(HI_SEGMENTS, timeline.outputDurationSec)).toBeCloseTo(48.72, 6);
  });

  it('short clips and heavy trimming still yield 2+ frames, all strictly inside the clip', () => {
    const heavy = [{sourceStart: 0, sourceEnd: 1, outputStart: 0}, {sourceStart: 30, sourceEnd: 32, outputStart: 1}, {sourceStart: 55, sourceEnd: 56, outputStart: 3}];
    const timeline = buildTimeline(heavy as never);
    expect(timeline.outputDurationSec).toBe(4);
    const times = coverageFrameTimes(4);
    expect(times).toHaveLength(2);
    times.forEach(t => {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(4);
    });
  });
});
