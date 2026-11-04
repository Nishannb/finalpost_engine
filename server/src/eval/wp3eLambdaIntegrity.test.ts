/**
 * WP3E pure tests of the Lambda render check. The download, the inspection, the scratch directory and the DNS resolver are all injected. Import graph:
 * lib/lambdaOutputCheck.ts -> lib/addressGuard.ts (node:net, node:dns/promises: imported, never called, the resolver is injected), lib/renderIntegrity.ts, lib/errors.ts,
 * lib/billingGuard.ts. renderRunner.ts imports the logger, the SDK path and FFmpeg helpers, so its wiring is read as text. No logger, `.env`, SDK, FFmpeg, Chromium, AWS or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {BlockedUrlError} from '../lib/addressGuard.ts';
import {EngineError} from '../lib/errors.ts';
import {createInFlight, describeVerificationFailure, verifyLambdaOutput, type LambdaVerifyDeps} from '../lib/lambdaOutputCheck.ts';
import type {RenderExpectation} from '../lib/renderIntegrity.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

const URL_OK = 'https://renders.s3.us-east-1.amazonaws.com/renders/rn_1.mp4';
const EXPECTED: RenderExpectation = {width: 1080, height: 1920, durationSec: 30};
const GOOD = {path: 'x.mp4', exists: true, bytes: 2_000_000, probe: {width: 1080, height: 1920, durationSec: 30.1, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 900, decodedSec: 30, errors: []}};
const publicDns = async () => ['52.216.0.1'];

function harness(over: Partial<LambdaVerifyDeps> & {facts?: unknown} = {}) {
  const calls: string[] = [];
  let cleanups = 0;
  const deps: LambdaVerifyDeps = {
    download: async (url, destination) => {
      calls.push(`download:${url}->${destination}`);
    },
    inspect: async path => {
      calls.push(`inspect:${path}`);
      return (over.facts ?? GOOD) as never;
    },
    workspace: {
      file: name => `/scratch/${name}`,
      cleanup: async () => {
        cleanups += 1;
        calls.push('cleanup');
      },
    },
    resolve: publicDns,
    ...over,
  };
  delete (deps as {facts?: unknown}).facts;
  return {deps, calls, cleanups: () => cleanups};
}

describe('a passing inspection', () => {
  it('returns the URL, after download then inspect then cleanup, on the same local file', async () => {
    const h = harness();
    expect(await verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, h.deps)).toBe(URL_OK);
    expect(h.calls).toEqual([`download:${URL_OK}->/scratch/lambda-output.mp4`, 'inspect:/scratch/lambda-output.mp4', 'cleanup']);
    expect(h.cleanups()).toBe(1);
  });
  it('the audio check applies when the caller knows the source had audio', async () => {
    const silent = {...GOOD, probe: {...GOOD.probe, hasAudio: false}};
    expect(await verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, harness({facts: silent}).deps)).toBe(URL_OK); // unknown: not applied
    await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: {...EXPECTED, expectAudio: true}}, harness({facts: silent}).deps)).rejects.toMatchObject({code: 'render_failed'});
  });
});

describe('a failing inspection', () => {
  const bad: Array<[string, unknown, string]> = [
    ['truncated (short duration)', {...GOOD, probe: {...GOOD.probe, durationSec: 12}}, 'duration_mismatch'],
    ['wrong size', {...GOOD, probe: {...GOOD.probe, width: 720, height: 1280}}, 'dimensions_mismatch'],
    ['not decoded end to end', {...GOOD, decode: undefined}, 'output_not_decoded'],
    ['decoder errors', {...GOOD, decode: {ok: false, videoFrames: 10, decodedSec: 1, errors: ['x']}}, 'output_corrupt'],
    ['empty file', {path: 'x', exists: true, bytes: 100}, 'output_empty'],
    ['missing file', {path: 'x', exists: false, bytes: 0}, 'output_missing'],
    ['unreadable', {path: 'x', exists: true, bytes: 50_000, probeError: 'moov atom not found'}, 'output_unreadable'],
  ];
  for (const [name, facts, check] of bad) {
    it(`${name}: throws render_failed naming ${check}, never returns the URL, and still cleans up`, async () => {
      const h = harness({facts});
      let returned: string | undefined;
      let error: unknown;
      try {
        returned = await verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, h.deps);
      } catch (caught) {
        error = caught;
      }
      expect(returned).toBeUndefined();
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe('render_failed');
      expect((error as EngineError).message).toContain(check);
      expect(h.cleanups()).toBe(1);
    });
  }
  it('a silent output fails when audio was expected, naming audio_missing', async () => {
    const silent = {...GOOD, probe: {...GOOD.probe, hasAudio: false}};
    await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: {...EXPECTED, expectAudio: true}}, harness({facts: silent}).deps)).rejects.toThrow(/audio_missing/);
  });
  it('several failures are all named', async () => {
    await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, harness({facts: {...GOOD, probe: {...GOOD.probe, durationSec: 5, width: 1}, decode: undefined}}).deps)).rejects.toThrow(/dimensions_mismatch, duration_mismatch, output_not_decoded/);
  });
});

describe('the address guard applies to the output URL', () => {
  const refused = ['http://127.0.0.1/renders/x.mp4', 'http://localhost:9000/x.mp4', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/x.mp4', 'http://192.168.1.2/x.mp4', 'http://[::1]/x.mp4', 'http://metadata.google.internal/x', 'file:///etc/passwd'];
  for (const url of refused) {
    it(`${url} is refused and is not success: nothing is downloaded or inspected`, async () => {
      const h = harness();
      await expect(verifyLambdaOutput({outputUrl: url, expected: EXPECTED}, h.deps)).rejects.toBeInstanceOf(BlockedUrlError);
      expect(h.calls).toEqual(['cleanup']);
    });
  }
  it('a public-looking host that resolves to a private or metadata address is refused', async () => {
    for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '::1']) {
      const h = harness({resolve: async () => [address]});
      await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, h.deps), address).rejects.toMatchObject({code: 'source_unreachable'});
      expect(h.calls).toEqual(['cleanup']);
    }
  });
  it('a host that does not resolve is refused (fail closed)', async () => {
    const h = harness({resolve: async () => { throw new Error('ENOTFOUND'); }});
    await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, h.deps)).rejects.toBeInstanceOf(BlockedUrlError);
  });
  it('the refusal does not echo the URL or the address', async () => {
    const h = harness();
    try {
      await verifyLambdaOutput({outputUrl: 'http://169.254.169.254/secret', expected: EXPECTED}, h.deps);
    } catch (error) {
      expect((error as Error).message).toBe('Media URL is not allowed');
    }
  });
  it('the explicit opt-out list is honoured only for an exact host', async () => {
    const h = harness({allowHosts: ['renders.internal']});
    expect(await verifyLambdaOutput({outputUrl: 'http://renders.internal/x.mp4', expected: EXPECTED}, h.deps)).toBe('http://renders.internal/x.mp4');
    await expect(verifyLambdaOutput({outputUrl: 'http://other.internal/x.mp4', expected: EXPECTED}, harness({allowHosts: ['renders.internal']}).deps)).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe('a failed download or inspection is a failed job, never a success', () => {
  it('the downloader\'s own typed error propagates; nothing is inspected; the scratch directory is removed', async () => {
    for (const code of ['source_unreachable', 'source_too_large', 'upstream_timeout'] as const) {
      const h = harness({download: async () => { throw new EngineError(code, 'Could not download source video'); }});
      await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, h.deps), code).rejects.toMatchObject({code});
      expect(h.calls).toEqual(['cleanup']);
    }
  });
  it('an inspection that throws propagates and still cleans up', async () => {
    const h = harness({inspect: async () => { throw new Error('ffprobe exploded'); }});
    await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, h.deps)).rejects.toThrow('ffprobe exploded');
    expect(h.cleanups()).toBe(1);
  });
  it('a cleanup failure never changes the verdict', async () => {
    const ok = harness({workspace: {file: n => `/s/${n}`, cleanup: async () => { throw new Error('rm failed'); }}});
    expect(await verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, ok.deps)).toBe(URL_OK);
    const bad = harness({facts: {path: 'x', exists: false, bytes: 0}, workspace: {file: n => `/s/${n}`, cleanup: async () => { throw new Error('rm failed'); }}});
    await expect(verifyLambdaOutput({outputUrl: URL_OK, expected: EXPECTED}, bad.deps)).rejects.toMatchObject({code: 'render_failed'});
  });
});

describe('job fields for a failure', () => {
  it('keeps a typed error as is; hides anything else behind a generic render_failed', () => {
    expect(describeVerificationFailure(new EngineError('render_failed', 'Rendered video failed integrity check (duration_mismatch): x'))).toEqual({code: 'render_failed', message: 'Rendered video failed integrity check (duration_mismatch): x'});
    expect(describeVerificationFailure(new EngineError('source_unreachable', 'Could not download source video'))).toEqual({code: 'source_unreachable', message: 'Could not download source video'});
    expect(describeVerificationFailure(new Error('secret path /tmp/x'))).toEqual({code: 'render_failed', message: 'The render finished but its output could not be verified.'});
    expect(describeVerificationFailure('string')).toMatchObject({code: 'render_failed'});
  });
});

describe('one verification per job', () => {
  it('only the first poll starts; others see it in flight until it ends', () => {
    const flight = createInFlight();
    expect(flight.tryStart('rn_1')).toBe(true);
    expect(flight.tryStart('rn_1')).toBe(false);
    expect(flight.tryStart('rn_2')).toBe(true);
    flight.end('rn_1');
    expect(flight.has('rn_1')).toBe(false);
    expect(flight.tryStart('rn_1')).toBe(true);
  });
});

describe('the module cannot touch the remote object or hold its own thresholds (source text)', () => {
  const module = read('lib', 'lambdaOutputCheck.ts');
  const code = module.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('no delete, overwrite, copy, S3 or AWS call, and no numeric threshold', () => {
    expect(code).not.toMatch(/DeleteObject|deleteRender|deleteFile|\bunlink|\brmSync|putObject|copyObject|\bs3\b|\baws\b|lambda\/client|@remotion/i);
    expect(code).not.toMatch(/MIN_BYTES|10_000|tolerance|0\.5\b|0\.98/);
    expect(code).toContain('assertRenderOutputValid(facts, input.expected);');
  });
  it('imports only the guard, the error type, the shared judge and a type', () => {
    expect([...module.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['../pipeline/experimentVerdict.ts', './addressGuard.ts', './errors.ts', './renderIntegrity.ts']);
    expect(module).toContain("import type {OutputFacts} from '../pipeline/experimentVerdict.ts';");
  });
});

describe('wiring in renderRunner (source text; it imports the logger)', () => {
  const runner = read('pipeline', 'renderRunner.ts');
  const poll = runner.slice(runner.indexOf('export async function refreshRenderJob'));
  it('a finished Lambda render becomes `done` only through verifyLambdaOutput; the raw Lambda URL is never assigned to the job', () => {
    expect(poll).toContain('const verifiedUrl = await verifyLambdaOutput(');
    // Phase 2.4: the verified URL goes through the master pass (music/lambdaMaster.ts), which only ever returns that same URL or a mastered copy it re-inspected itself.
    expect(poll).toContain('{outputUrl: verifiedUrl, renderJobId: job.renderJobId,');
    expect(poll).toContain('job.outputUrl = mastered.url;');
    expect(poll).toContain('assertRenderOutputValid(await inspectOutput(file),');
    expect(poll).not.toContain('job.outputUrl = progress.outputUrl');
    expect(poll).not.toContain('job.outputUrl = verifiedUrl');
    expect(poll).not.toMatch(/masterLambdaOutput\(\s*\{outputUrl: progress\.outputUrl/);
    expect(poll.indexOf("job.status = 'done';")).toBeGreaterThan(poll.indexOf('verifyLambdaOutput('));
    expect(poll.match(/job\.status = 'done'/g)).toHaveLength(1);
  });
  it('uses the existing download helper (with its address guard), the shared inspection and a scratch workspace; the expected size and duration come from the blueprint and the job', () => {
    expect(poll).toContain('download: (url, destination) => downloadToFile(url, destination,');
    expect(poll).toContain('inspect: inspectOutput,');
    expect(poll).toContain("createWorkspace('lambda-verify')");
    expect(poll).toContain('expected: {width: blueprint.width, height: blueprint.height, durationSec: job.outputDurationSec, expectAudio: audio.expectAudio}'); // WP3F added expectAudio
    expect(poll).toContain('allowHosts: env.INGEST_ALLOWED_PRIVATE_HOSTS');
    expect(runner).toContain("import {inspectOutput} from './experimentVerdict.ts';");
  });
  it('a failure marks the job failed with the typed code and message; the Lambda object is not deleted', () => {
    expect(poll).toContain("job.status = 'failed';\n      job.errorCode = failure.code;\n      job.errorMessage = failure.message;");
    expect(runner).not.toMatch(/deleteRender|DeleteObject|deleteFile|s3:/i);
  });
  it('concurrent polls verify once and save nothing while it runs; the blueprint-missing case fails closed', () => {
    expect(poll).toContain('if (!lambdaVerifications.tryStart(job.renderJobId)) {\n      job.progress = Math.min(job.progress, 0.99);\n      return job;\n    }');
    expect(poll).toContain('lambdaVerifications.end(job.renderJobId);');
    expect(poll).toContain('its blueprint is no longer available');
  });
  it('the Lambda start/poll module is unchanged and no thresholds were added to the runner', () => {
    const lambda = read('stages', 'render', 'remotionLambda.ts');
    expect(lambda).toContain('outputUrl: progress.outputFile ?? undefined,');
    expect(lambda).not.toMatch(/verifyLambdaOutput|inspectOutput|assertRenderOutputValid/);
    expect(runner).not.toMatch(/MIN_BYTES|tolerance|0\.98/);
  });
  it('the local render check from WP2 is still in place and the defaults are unchanged', () => {
    expect(read('stages', 'render', 'localRender.ts')).toContain('assertRenderOutputValid(await inspectOutput(uploadPath)');
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
