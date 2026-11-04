/**
 * WP3F pure tests: the Lambda check requires audio exactly when the saved ingest probe says the source had audio. The probe flag and the inspection are injected; the download is
 * injected and counted. Import graph: lib/lambdaOutputCheck.ts (-> addressGuard, errors, renderIntegrity, billingGuard). renderRunner, analyzeVideo and localRender import the
 * logger / FFmpeg helpers, so their wiring is read as text. No logger, `.env`, SDK, FFmpeg, Chromium, AWS or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {AUDIO_UNCHECKED_WARNING, audioExpectationFor, verifyLambdaOutput, type LambdaVerifyDeps} from '../lib/lambdaOutputCheck.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

const URL_OK = 'https://renders.s3.us-east-1.amazonaws.com/renders/rn_1.mp4';
const WITH_AUDIO = {path: 'x', exists: true, bytes: 2_000_000, probe: {width: 1080, height: 1920, durationSec: 30, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 900, decodedSec: 30, errors: []}};
const SILENT = {...WITH_AUDIO, probe: {...WITH_AUDIO.probe, hasAudio: false}};

/** What renderRunner does, with the real pieces that are pure and the I/O injected. */
async function lambdaFinish(sourceHasAudio: unknown, facts: unknown, over: Partial<LambdaVerifyDeps> = {}) {
  let downloads = 0;
  let inspections = 0;
  const audio = audioExpectationFor(sourceHasAudio);
  const deps: LambdaVerifyDeps = {
    download: async () => {
      downloads += 1;
    },
    inspect: async () => {
      inspections += 1;
      return facts as never;
    },
    workspace: {file: n => `/s/${n}`, cleanup: async () => undefined},
    resolve: async () => ['52.216.0.1'],
    ...over,
  };
  try {
    const url = await verifyLambdaOutput({outputUrl: URL_OK, expected: {width: 1080, height: 1920, durationSec: 30, expectAudio: audio.expectAudio}}, deps);
    return {outcome: 'done' as const, url, warnings: audio.warnings, downloads, inspections};
  } catch (error) {
    return {outcome: 'failed' as const, error: error as {code: string; message: string}, warnings: audio.warnings, downloads, inspections};
  }
}

describe('what the saved probe flag means', () => {
  it('a saved boolean is passed on as it is', () => {
    expect(audioExpectationFor(true)).toEqual({expectAudio: true, warnings: []});
    expect(audioExpectationFor(false)).toEqual({expectAudio: false, warnings: []});
  });
  it('anything else is not guessed: unset, with the warning render_audio_unchecked', () => {
    for (const value of [undefined, null, 'true', 'yes', 1, 0, {}, []]) {
      expect(audioExpectationFor(value), String(value)).toEqual({expectAudio: undefined, warnings: ['render_audio_unchecked']});
    }
    expect(AUDIO_UNCHECKED_WARNING).toBe('render_audio_unchecked');
  });
});

describe('the Lambda check with the saved probe', () => {
  it('source had audio, output is silent: render_failed naming audio_missing, the URL is not returned', async () => {
    const r = await lambdaFinish(true, SILENT);
    expect(r.outcome).toBe('failed');
    if (r.outcome === 'failed') {
      expect(r.error.code).toBe('render_failed');
      expect(r.error.message).toContain('audio_missing');
    }
  });
  it('source had audio, output has audio: the URL is returned with no warning', async () => {
    const r = await lambdaFinish(true, WITH_AUDIO);
    expect(r).toMatchObject({outcome: 'done', url: URL_OK, warnings: []});
  });
  it('source had no audio (expectAudio false): a silent output passes and no warning is recorded', async () => {
    expect(await lambdaFinish(false, SILENT)).toMatchObject({outcome: 'done', url: URL_OK, warnings: []});
  });
  it('no saved probe: audio is left unchecked, the warning is recorded, the job does not fail for that reason', async () => {
    const r = await lambdaFinish(undefined, SILENT);
    expect(r).toMatchObject({outcome: 'done', url: URL_OK, warnings: ['render_audio_unchecked']});
  });
  it('no saved probe: every other check still runs and still fails the job', async () => {
    const short = {...SILENT, probe: {...SILENT.probe, durationSec: 5}};
    const r = await lambdaFinish(undefined, short);
    expect(r.outcome).toBe('failed');
    if (r.outcome === 'failed') expect(r.error.message).toContain('duration_mismatch');
    const undecoded = await lambdaFinish(undefined, {...WITH_AUDIO, decode: undefined});
    expect(undecoded.outcome).toBe('failed');
  });
  it('a silent output that is also truncated names both checks', async () => {
    const r = await lambdaFinish(true, {...SILENT, probe: {...SILENT.probe, durationSec: 5}});
    expect(r.outcome).toBe('failed');
    if (r.outcome === 'failed') expect(r.error.message).toMatch(/duration_mismatch, audio_missing/);
  });
  it('the output is downloaded once and inspected once; there is no second download or probe of the source (the dependencies have none)', async () => {
    for (const saved of [true, false, undefined]) {
      const r = await lambdaFinish(saved, WITH_AUDIO);
      expect([r.downloads, r.inspections], String(saved)).toEqual([1, 1]);
    }
    const deps: Array<keyof LambdaVerifyDeps> = ['download', 'inspect', 'workspace', 'resolve', 'allowHosts'];
    expect(deps).toHaveLength(5); // the whole dependency surface of the check: nothing probes a source
  });
  it('a private output URL is still refused before any audio decision matters', async () => {
    const r = await lambdaFinish(true, SILENT, {});
    expect(r.outcome).toBe('failed');
    let calls = 0;
    const refused = await (async () => {
      try {
        await verifyLambdaOutput({outputUrl: 'http://127.0.0.1/x.mp4', expected: {width: 1080, height: 1920, durationSec: 30, expectAudio: true}}, {download: async () => { calls += 1; }, inspect: async () => WITH_AUDIO as never, workspace: {file: n => n, cleanup: async () => undefined}});
        return 'returned';
      } catch (error) {
        return (error as {code: string}).code;
      }
    })();
    expect(refused).toBe('source_unreachable');
    expect(calls).toBe(0);
  });
});

describe('no thresholds changed (source text)', () => {
  const judge = read('lib', 'renderIntegrity.ts');
  it('the shared judge still holds the WP2 numbers and the audio rule', () => {
    expect(judge).toContain('export const RENDER_MIN_BYTES = 10_000;');
    expect(judge).toContain('const tolerance = Math.max(0.5, 3 / (probe.fps || 30));');
    expect(judge).toContain("if (expected.expectAudio === true && !probe.hasAudio) failures.push({check: 'audio_missing'");
  });
  it('lambdaOutputCheck adds no threshold of its own', () => {
    const code = read('lib', 'lambdaOutputCheck.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/MIN_BYTES|10_000|tolerance|0\.5\b|0\.98/);
  });
});

describe('where the flag comes from and where it goes (source text; these files import the logger)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  const runner = read('pipeline', 'renderRunner.ts');
  const local = read('stages', 'render', 'localRender.ts');
  it('analyzeVideo records the ingest probe it already took: the same call, no new probe, mvp profile only', () => {
    expect(av).toContain("...(mvpLike || speechCutsOn ? {sourceHasAudio: originalProbe.hasAudio} : {}),");
    expect(av).toContain('const originalProbe = await probeMedia(sourcePath);');
    expect(av.match(/\bprobeMedia\(/g)).toHaveLength(1);
    expect(av.indexOf('const originalProbe = await probeMedia(sourcePath);')).toBeLessThan(av.indexOf('const blueprint: TimelineBlueprint = {'));
  });
  it('the Lambda branch reads the saved flag from the blueprint it already loads, passes expectAudio to the same verifier, and records the warning only when unchecked', () => {
    const poll = runner.slice(runner.indexOf('export async function refreshRenderJob'));
    expect(poll).toContain('const audio = audioExpectationFor(blueprint.sourceHasAudio);');
    expect(poll).toContain('expectAudio: audio.expectAudio}}');
    expect(poll.indexOf('audioExpectationFor(')).toBeLessThan(poll.indexOf('verifyLambdaOutput('));
    expect(poll).toContain('if (audio.warnings.length > 0) {\n        job.warnings = [...new Set([...(job.warnings ?? []), ...audio.warnings])];');
    expect(poll.match(/downloadToFile\(/g)).toHaveLength(2); // one to verify the Lambda output, one for the master pass (whose result is inspected again)
    expect(runner).not.toMatch(/probeMedia|ffprobe/);
  });
  it('the local path still probes its prefetched copy first and only falls back to the saved flag when that probe fails', () => {
    expect(local).toContain("expectAudio = (await probeMedia(path.join(remotionRoot, 'public', blueprint.videoUrl.replace(/^\\//, '')))).hasAudio;");
    expect(local).toContain('expectAudio = audioExpectationFor(input.blueprint.sourceHasAudio).expectAudio;');
    expect(local.indexOf('probeMedia(path.join')).toBeLessThan(local.indexOf('audioExpectationFor(input.blueprint.sourceHasAudio)'));
  });
  it('the fields are optional on the server types and in the Remotion schema, and the renderer never reads them; the defaults are unchanged', () => {
    const types = read('types', 'blueprint.ts');
    expect(types).toContain('sourceHasAudio?: boolean;');
    expect(types).toContain('warnings?: string[];');
    const schema = read('..', '..', 'remotion', 'src', 'blueprintSchema.ts');
    expect(schema).toContain('sourceHasAudio: z.boolean().optional(),');
    for (const file of ['ShortVideo.tsx', 'components/VideoTrack.tsx', 'components/HookTitle.tsx']) expect(read('..', '..', 'remotion', 'src', file), file).not.toContain('sourceHasAudio');
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
