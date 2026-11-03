/**
 * Phase 34 (opt-in experiment plumbing): the whole video reaches the two Gemini decision calls as a video part, and the Claude worker's uploader /
 * limits can be overridden so compiled modules stay local. Every default is pinned: with nothing opted in, requests and worker options are the same
 * as before. Offline: the Gemini HTTP layer and the worker are mocked; the proxy builder runs real ffmpeg on a 2 s synthetic clip.
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';

const hoisted = vi.hoisted(() => ({bodies: [] as any[], workerCalls: [] as any[], geminiJson: {} as unknown}));
vi.mock('../lib/http.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/http.ts')>();
  return {
    ...actual,
    requestJson: async (_url: string, options: {body?: string; timeoutMs?: number; label?: string}) => {
      hoisted.bodies.push({label: options.label, timeoutMs: options.timeoutMs, body: JSON.parse(options.body ?? '{}')});
      return {candidates: [{content: {parts: [{text: JSON.stringify(hoisted.geminiJson)}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}};
    },
  };
});
vi.mock('../motionWorker/worker.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../motionWorker/worker.ts')>();
  return {
    ...actual,
    generateMotionGraphic: async (brief: {id: string}, options: unknown) => {
      hoisted.workerCalls.push({id: brief.id, options});
      throw new actual.MotionWorkerError('stubbed', brief.id, [], null);
    },
  };
});

const {env} = await import('../config/env.ts');
const {planVisualDirection} = await import('../stages/broll/geminiDirector.ts');
const {buildMotionDirectorPrompt} = await import('../stages/motionDirector/motionDirector.ts');
const {runMotionGraphicsStage} = await import('../stages/motionDirector/index.ts');
const {buildDirectorVideoPart} = await import('../media/directorVideo.ts');

const PART = {mimeType: 'video/mp4', data: 'QUJD', bytes: 3};
const directorInput = {transcript: 'Hello there. This is a test of the director.', sourceDurationSec: 20, momentCount: 3};
const work = mkdtempSync(join(tmpdir(), 'p34-'));
afterAll(() => rmSync(work, {recursive: true, force: true}));
beforeEach(() => {
  hoisted.bodies.length = 0;
  hoisted.workerCalls.length = 0;
  hoisted.geminiJson = {hook_title: 'HELLO THERE', moments: [{timestamp: 5, search_keyword: 'x y', layout: 'cutaway'}], zooms: [], caption: {template: 'clean', position: 'bottom', box: false}};
  (env as Record<string, unknown>).GEMINI_API_KEY = 'test-key';
});

describe('v1 Director: whole-video input is opt-in', () => {
  it('without a video part the request is exactly the old shape (one text part, no video schema field, 45 s timeout)', async () => {
    await planVisualDirection(directorInput);
    const call = hoisted.bodies.find(item => item.label === 'Gemini visual director')!;
    expect(call.body.contents[0].parts).toHaveLength(1);
    expect(call.body.contents[0].parts[0]).toHaveProperty('text');
    expect(JSON.stringify(call.body)).not.toMatch(/video_observations|inlineData|COMPLETE clip/);
    expect(call.timeoutMs).toBe(45_000);
  });

  it('with a video part: the video is sent inline BEFORE the text, the prompt says so, the schema asks for observations, the timeout is longer', async () => {
    await planVisualDirection({...directorInput, videoPart: PART});
    const call = hoisted.bodies.find(item => item.label === 'Gemini visual director')!;
    const parts = call.body.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({inlineData: {mimeType: 'video/mp4', data: 'QUJD'}});
    expect(parts[1].text).toMatch(/COMPLETE clip with its audio/);
    expect(parts[1].text).toMatch(/video_observations/);
    expect(call.body.generationConfig.responseSchema.properties.video_observations.type).toBe('ARRAY');
    expect(call.timeoutMs).toBe(180_000);
  });

  it('the rest of the prompt is identical with and without the video part apart from the added paragraph', async () => {
    await planVisualDirection(directorInput);
    await planVisualDirection({...directorInput, videoPart: PART});
    const [plain, withVideo] = hoisted.bodies.filter(item => item.label === 'Gemini visual director').map(item => item.body.contents[0].parts.at(-1).text as string);
    expect(withVideo.length).toBeGreaterThan(plain.length);
    expect(withVideo.split('\n').filter(line => !line.startsWith('The attached video'))).toEqual(plain.split('\n'));
  });
});

describe('motion Director: whole-video input is opt-in', () => {
  const base = {transcript: 't', words: [{text: 'a', start: 0, end: 1}], outputDurationSec: 20, languageCode: 'en', occupied: []};
  it('the prompt only mentions the video when one is attached', () => {
    expect(buildMotionDirectorPrompt(base as never)).not.toMatch(/COMPLETE clip/);
    expect(buildMotionDirectorPrompt({...base, videoPart: PART} as never)).toMatch(/COMPLETE clip with its audio/);
  });
});

describe('worker overrides (local modules) are opt-in', () => {
  const fixture = join(work, 'director.json');
  writeFileSync(fixture, JSON.stringify({graphics: [{id: 'g1', anchorWordIndex: 0, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen', contentJson: '{"title":"x"}'}]}));
  const input = {transcript: 't', words: Array.from({length: 40}, (_, i) => ({text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4})), outputDurationSec: 20, languageCode: 'en', edit: {brollClips: [], visualOverlays: [], insetReveals: [], depthOverlays: [], mediaContainers: [], motionGraphics: [], semanticEmphasis: [], frameInsets: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0}};

  it('no workerOptions: the worker receives no `upload` / `generator` / `maxRepairAttempts` (R2 and 2 repairs, as before)', async () => {
    process.env.MOTION_DIRECTOR_FIXTURE = fixture;
    const result = await runMotionGraphicsStage(input as never);
    expect(hoisted.workerCalls).toHaveLength(1);
    const options = hoisted.workerCalls[0].options;
    expect(options.upload).toBeUndefined();
    expect(options.generator).toBeUndefined();
    expect(options.maxRepairAttempts).toBeUndefined();
    expect(result.warnings.join(' ')).toMatch(/motion_dropped:g1/); // a worker failure is surfaced, not silent
  });

  it('with workerOptions the uploader, generator and repair limit reach the worker', async () => {
    process.env.MOTION_DIRECTOR_FIXTURE = fixture;
    const upload = async () => 'staticFile:local/x.js';
    const generator = async () => ({text: '', stopReason: null, model: 'm', usage: {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}});
    await runMotionGraphicsStage({...input, workerOptions: {upload, generator, maxRepairAttempts: 1}} as never);
    const options = hoisted.workerCalls.at(-1).options;
    expect(options.upload).toBe(upload);
    expect(options.generator).toBe(generator);
    expect(options.maxRepairAttempts).toBe(1);
    delete process.env.MOTION_DIRECTOR_FIXTURE;
  });
});

describe('director video proxy (real ffmpeg, synthetic 2 s clip)', () => {
  it('covers the whole clip, keeps the audio, stays inline-sized, and uploads nothing', async () => {
    const src = join(work, 'src.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
    const part = await buildDirectorVideoPart(src, join(work, 'proxy.mp4'));
    expect(part.mimeType).toBe('video/mp4');
    const bytes = Buffer.from(part.data, 'base64');
    expect(bytes.length).toBe(part.bytes);
    expect(part.bytes).toBeLessThan(12 * 1024 * 1024);
    writeFileSync(join(work, 'decoded.mp4'), bytes);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-show_entries', 'format=duration', '-of', 'json', join(work, 'decoded.mp4')]).toString());
    expect(Number(probe.format.duration)).toBeGreaterThan(1.9);
    expect(probe.streams.map((s: {codec_type: string}) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(readFileSync(join(work, 'proxy.mp4')).length).toBe(part.bytes);
  });
});
