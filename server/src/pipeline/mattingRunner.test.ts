/**
 * RVM matting job: ownership, idempotency, one REAL python/RVM spawn (<= 8 frames), the concurrency gate, failure cleanup, and the HTTP routes.
 * The KV is an in-memory mock (never Redis). No network and no R2: the downloader and uploader are injected.
 */
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';

import express, {type NextFunction, type Request, type Response} from 'express';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../store/kv.ts', () => {
  const data = new Map<string, string>();
  const kv = {
    kind: 'memory' as const,
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => {
      data.set(key, value);
    },
    del: async (key: string) => {
      data.delete(key);
    },
    increment: async (key: string, by: number) => {
      const next = Number(data.get(key) ?? 0) + by;
      data.set(key, String(next));
      return next;
    },
  };
  return {getKv: async () => kv, __data: data};
});

import {toEngineError} from '../lib/errors.ts';
import {createMattingRoutes} from '../http/routes/mattingRoutes.ts';
import {
  resolveRvmPython,
  RVM_ROOT,
  spawnRvm,
  validateMattingProbe,
  type MattingProbe,
  type RunPython,
  type RunPythonResult,
} from '../media/rvmMatte.ts';
import {saveMattingJob, type MattingJob} from '../store/mattingStore.ts';
import {createMattingRunner, type MattingConfig, type MattingDeps, type MattingRunner} from './mattingRunner.ts';

const HI_MP4 = path.resolve(RVM_ROOT, '..', 'remotion', 'public', 'hi.mp4');
const VENV_PYTHON = path.join(RVM_ROOT, '.venv-rvm', 'bin', 'python');

const okProbe: MattingProbe = {codec: 'h264', width: 720, height: 1280, durationSec: 10, fps: 25};
const baseConfig: Partial<MattingConfig> = {python: '/fake/venv/bin/python', heartbeatMs: 50, progressThrottleMs: 0, timeoutSec: 900, maxConcurrent: 1};

const fakeDownload: MattingDeps['download'] = async (_url, dest) => {
  await fs.writeFile(dest, 'fake-video-bytes');
  return {path: dest, bytes: 16};
};

/** A python stub that behaves like a successful cli.py run: writes the webm + result.json, prints progress. */
function successfulRun(frames = 8): RunPython {
  return async (_cmd, args, options) => {
    const [, , , outWebm, resultJson] = args as [string, string, string, string, string];
    await fs.writeFile(outWebm, 'fake-webm-bytes');
    await fs.writeFile(resultJson, JSON.stringify({ok: true, frames_encoded: frames, width: 720, height: 1280, fps: 25, duration_sec: frames / 25, device: 'cpu', elapsed_sec: 0.1}));
    options.onStdoutLine?.(`PROGRESS ${frames} ${frames}`);
    return {code: 0, stderr: '', timedOut: false};
  };
}

const recordingUpload = () => {
  const calls: Array<{key: string; contentType: string; size: number}> = [];
  const upload: MattingDeps['upload'] = async (filePath, key, contentType) => {
    calls.push({key, contentType, size: (await fs.stat(filePath)).size});
    return {publicUrl: `https://cdn.example/${key}`, key};
  };
  return {calls, upload};
};

function makeRunner(deps: Partial<MattingDeps>, config: Partial<MattingConfig> = {}): MattingRunner {
  return createMattingRunner({
    config: {...baseConfig, ...config},
    deps: {available: async () => undefined, download: fakeDownload, probe: async () => okProbe, runPython: successfulRun(), ...recordingUpload(), ...deps},
  });
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const rejectsWithCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected rejection with ${code}`).not.toBeNull();
  expect(toEngineError(error).code).toBe(code);
};

beforeEach(async () => {
  const mod = (await import('../store/kv.ts')) as unknown as {__data: Map<string, string>};
  mod.__data.clear();
});

describe('1. job ownership', () => {
  it("another user cannot load someone else's job (not_found, not forbidden); owner can", async () => {
    const runner = makeRunner({});
    const job = await runner.start({userId: 'user-a', videoUrl: 'https://cdn.example/a.mp4', quality: 'high', outputFormat: 'transparent', useCache: true});
    await runner.settled(job.jobId);
    await rejectsWithCode(runner.getForUser(job.jobId, 'user-b'), 'not_found');
    await rejectsWithCode(runner.getForUser('mt_doesnotexist', 'user-a'), 'not_found');
    const mine = await runner.getForUser(job.jobId, 'user-a');
    expect(mine.status).toBe('done');
    expect(mine.userId).toBe('user-a');
  });

  it('a queued/running job whose updatedAt is older than MATTING_TIMEOUT_SEC is marked failed (upstream_timeout); a fresh one is not', async () => {
    const runner = makeRunner({});
    const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const base: MattingJob = {jobId: 'mt_stale', userId: 'u', sourceUrl: 'https://x/y.mp4', quality: 'high', outputFormat: 'transparent', status: 'running', progress: 0.4, createdAt: old, updatedAt: old};
    await saveMattingJob(base);
    await saveMattingJob({...base, jobId: 'mt_fresh', updatedAt: new Date().toISOString()});
    const stale = await runner.getForUser('mt_stale', 'u');
    expect(stale.status).toBe('failed');
    expect(stale.errorCode).toBe('upstream_timeout');
    expect((await runner.getForUser('mt_stale', 'u')).status).toBe('failed'); // persisted
    expect((await runner.getForUser('mt_fresh', 'u')).status).toBe('running');
  });
});

describe('2. idempotency (useCache)', () => {
  const input = {userId: 'user-a', videoUrl: 'https://cdn.example/clip.mp4', quality: 'high' as const, outputFormat: 'transparent' as const};

  it('useCache:true returns the same job for the same user+url+quality+format (in flight and after done); useCache:false makes a new one', async () => {
    const runner = makeRunner({});
    const [first, concurrent] = await Promise.all([runner.start({...input, useCache: true}), runner.start({...input, useCache: true})]);
    expect(concurrent.jobId).toBe(first.jobId);
    await runner.settled(first.jobId);
    const again = await runner.start({...input, useCache: true});
    expect(again.jobId).toBe(first.jobId);
    expect(again.status).toBe('done');
    const forced = await runner.start({...input, useCache: false});
    expect(forced.jobId).not.toBe(first.jobId);
    await runner.settled(forced.jobId);
  });

  it('is never shared across users, qualities or urls', async () => {
    const runner = makeRunner({});
    const a = await runner.start({...input, useCache: true});
    const otherUser = await runner.start({...input, userId: 'user-b', useCache: true});
    const otherQuality = await runner.start({...input, quality: 'fast', useCache: true});
    const otherUrl = await runner.start({...input, videoUrl: 'https://cdn.example/other.mp4', useCache: true});
    expect(new Set([a.jobId, otherUser.jobId, otherQuality.jobId, otherUrl.jobId]).size).toBe(4);
    await Promise.all([a, otherUser, otherQuality, otherUrl].map(j => runner.settled(j.jobId)));
  });

  it('a failed job is not reused: the next start creates a new one', async () => {
    const failing: RunPython = async () => ({code: 1, stderr: 'boom', timedOut: false});
    const runner = makeRunner({runPython: failing});
    const first = await runner.start({...input, useCache: true});
    await runner.settled(first.jobId);
    expect((await runner.getForUser(first.jobId, input.userId)).status).toBe('failed');
    const second = await runner.start({...input, useCache: true});
    expect(second.jobId).not.toBe(first.jobId);
    await runner.settled(second.jobId);
  });

  it('does not persist the query string of a signed URL', async () => {
    const runner = makeRunner({});
    const job = await runner.start({...input, videoUrl: 'https://cdn.example/clip.mp4?X-Amz-Signature=SECRET&token=abc', useCache: true});
    await runner.settled(job.jobId);
    const stored = JSON.stringify(await runner.getForUser(job.jobId, input.userId));
    expect(stored).not.toContain('SECRET');
    expect(stored).not.toContain('X-Amz');
  });
});

describe('3. one REAL python/RVM spawn (8 frames)', () => {
  it('uses the venv python, uploads a vp9 yuva420p WebM with alpha under ai-video/matte/, and cleans its workspace', async () => {
    expect(existsSync(HI_MP4), `${HI_MP4} must exist`).toBe(true);
    expect(existsSync(VENV_PYTHON), `${VENV_PYTHON} must exist`).toBe(true);
    expect(resolveRvmPython('')).toBe(VENV_PYTHON);

    const spawned: Array<{cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv}> = [];
    const recordingSpawn: RunPython = (cmd, args, options) => {
      spawned.push({cmd, args, cwd: options.cwd, env: options.env});
      return spawnRvm(cmd, args, options);
    };
    const keep = await fs.mkdtemp(path.join(os.tmpdir(), 'matting-test-out-'));
    const uploads: Array<{key: string; contentType: string}> = [];
    let kept = '';
    try {
      const runner = createMattingRunner({
        config: {python: resolveRvmPython(''), device: 'auto', testMaxFrames: 8, heartbeatMs: 1000, progressThrottleMs: 0},
        deps: {
          available: async () => undefined,
          download: async (_url, dest) => {
            await fs.copyFile(HI_MP4, dest); // local file instead of the network
            return {path: dest, bytes: (await fs.stat(dest)).size};
          },
          runPython: recordingSpawn,
          upload: async (filePath, key, contentType) => {
            uploads.push({key, contentType});
            kept = path.join(keep, 'uploaded.webm');
            await fs.copyFile(filePath, kept); // the workspace is deleted afterwards; keep a copy to inspect
            return {publicUrl: `https://cdn.example/${key}`, key};
          },
        },
      });
      const job = await runner.start({userId: 'user-real', videoUrl: 'https://cdn.example/hi.mp4', quality: 'high', outputFormat: 'transparent', useCache: true});
      await runner.settled(job.jobId);
      const done = await runner.getForUser(job.jobId, 'user-real');
      expect(done.errorMessage).toBeUndefined();
      expect(done.status).toBe('done');
      expect(done.progress).toBe(1);

      // what was spawned
      expect(spawned).toHaveLength(1);
      expect(spawned[0]!.cmd).toBe(VENV_PYTHON);
      expect(spawned[0]!.cwd).toBe(RVM_ROOT);
      expect(spawned[0]!.args.slice(0, 2)).toEqual(['-m', 'human_matting.cli']);
      expect(spawned[0]!.args).toContain('--quality');
      expect(spawned[0]!.args[spawned[0]!.args.indexOf('--quality') + 1]).toBe('high');
      expect(spawned[0]!.args[spawned[0]!.args.indexOf('--max-frames') + 1]).toBe('8'); // the test hook, 8 frames only
      expect(Object.keys(spawned[0]!.env)).not.toContain('R2_SECRET_ACCESS_KEY'); // no engine secrets in the child env

      // what was uploaded
      expect(uploads).toHaveLength(1);
      expect(uploads[0]!.key).toMatch(/^ai-video\/matte\/\d{4}-\d{2}-\d{2}\/mt_[0-9a-f]{20}\.webm$/);
      expect(uploads[0]!.key.endsWith(`${job.jobId}.webm`)).toBe(true);
      expect(uploads[0]!.contentType).toBe('video/webm');
      expect(done.outputUrl).toBe(`https://cdn.example/${uploads[0]!.key}`);
      expect(done.result).toMatchObject({frames: 8, width: 720, height: 1280, fps: 25, silent: true});

      // the file itself, from real ffprobe (libvpx-vp9 DECODER so pix_fmt shows alpha)
      const probe = JSON.parse(
        execFileSync('ffprobe', ['-v', 'error', '-c:v', 'libvpx-vp9', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height:stream_tags=alpha_mode', '-of', 'json', kept], {encoding: 'utf8'}),
      ) as {streams: Array<{codec_type: string; codec_name: string; pix_fmt: string; width: number; height: number; tags?: Record<string, string>}>};
      expect(probe.streams.map(s => s.codec_type)).toEqual(['video']); // silent
      const video = probe.streams[0]!;
      expect(video.codec_name).toBe('vp9');
      expect(video.pix_fmt).toBe('yuva420p');
      expect(video.tags?.alpha_mode ?? video.tags?.ALPHA_MODE).toBe('1');
      console.log(`[ffprobe alpha proof] codec_name=${video.codec_name} pix_fmt=${video.pix_fmt} alpha_mode=${video.tags?.alpha_mode} size=${video.width}x${video.height} frames=${done.result?.frames} device=${done.result?.device}`);

      // workspace removed (it contained source.mp4 + matte.webm + result.json)
      const workspaceDir = path.dirname(spawned[0]!.args[3]!);
      expect(existsSync(workspaceDir)).toBe(false);
    } finally {
      await fs.rm(keep, {recursive: true, force: true});
    }
  }, 180_000);
});

describe('4. concurrency gate', () => {
  it('with MATTING_MAX_CONCURRENT=1 the second job stays queued until the first finishes (and never overlaps)', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const slow: RunPython = async (cmd, args, options) => {
      const id = `call-${order.length + 1}`;
      order.push(id);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      if (id === 'call-1') await gate;
      running -= 1;
      return successfulRun()(cmd, args, options);
    };
    const runner = makeRunner({runPython: slow});
    const first = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/1.mp4', quality: 'high', outputFormat: 'transparent', useCache: true});
    const second = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/2.mp4', quality: 'high', outputFormat: 'transparent', useCache: true});
    await until(() => order.length === 1);
    await until(async () => (await runner.getForUser(first.jobId, 'u')).status === 'running');

    const queuedAt = await runner.getForUser(second.jobId, 'u');
    expect(queuedAt.status).toBe('queued');
    expect(runner.stats()).toEqual({active: 1, waiting: 1});
    await new Promise(resolve => setTimeout(resolve, 200)); // longer than the 50 ms heartbeat
    const stillQueued = await runner.getForUser(second.jobId, 'u');
    expect(stillQueued.status).toBe('queued');
    expect(order).toEqual(['call-1']); // the second python was NOT started
    expect(Date.parse(stillQueued.updatedAt)).toBeGreaterThan(Date.parse(queuedAt.updatedAt)); // heartbeat keeps a waiting job alive

    releaseFirst();
    await Promise.all([runner.settled(first.jobId), runner.settled(second.jobId)]);
    expect((await runner.getForUser(first.jobId, 'u')).status).toBe('done');
    expect((await runner.getForUser(second.jobId, 'u')).status).toBe('done');
    expect(order).toEqual(['call-1', 'call-2']);
    expect(maxRunning).toBe(1);
    expect(runner.stats()).toEqual({active: 0, waiting: 0});
  });

  it('MATTING_MAX_CONCURRENT=2 lets two run together', async () => {
    let releaseAll!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseAll = resolve;
    });
    let running = 0;
    let maxRunning = 0;
    const slow: RunPython = async (cmd, args, options) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await gate;
      running -= 1;
      return successfulRun()(cmd, args, options);
    };
    const runner = makeRunner({runPython: slow}, {maxConcurrent: 2});
    const a = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/1.mp4', quality: 'high', outputFormat: 'transparent', useCache: true});
    const b = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/2.mp4', quality: 'high', outputFormat: 'transparent', useCache: true});
    await until(() => running === 2);
    releaseAll();
    await Promise.all([runner.settled(a.jobId), runner.settled(b.jobId)]);
    expect(maxRunning).toBe(2);
  });
});

describe('5. failures', () => {
  async function failedJobAfter(run: RunPython, extra: Partial<MattingDeps> = {}) {
    const workspaces: string[] = [];
    const uploads = recordingUpload();
    const wrapped: RunPython = async (cmd, args, options) => {
      const workspaceDir = path.dirname(args[3]!);
      workspaces.push(workspaceDir);
      await fs.writeFile(path.join(workspaceDir, 'matte.partial.webm'), 'partial'); // what a crashed encoder leaves
      return run(cmd, args, options);
    };
    const runner = makeRunner({runPython: wrapped, upload: uploads.upload, ...extra});
    const job = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/x.mp4', quality: 'high', outputFormat: 'transparent', useCache: false});
    await runner.settled(job.jobId);
    return {job: await runner.getForUser(job.jobId, 'u'), workspaces, uploads: uploads.calls};
  }

  it('a non-zero python exit marks the job failed with matting_failed, removes the workspace and uploads nothing', async () => {
    const {job, workspaces, uploads} = await failedJobAfter(async () => ({code: 1, stderr: 'Traceback ... boom', timedOut: false}));
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('matting_failed');
    expect(job.errorMessage).toBeTruthy();
    expect(job.errorMessage).not.toContain('Traceback'); // internals stay in the log
    expect(job.outputUrl).toBeUndefined();
    expect(workspaces).toHaveLength(1);
    expect(existsSync(workspaces[0]!)).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it('timeout -> upstream_timeout; exit 4 -> not_configured; spawn error -> not_configured; exit 0 without a valid result -> matting_failed', async () => {
    const cases: Array<[RunPythonResult, string]> = [
      [{code: null, stderr: '', timedOut: true}, 'upstream_timeout'],
      [{code: 4, stderr: 'no libvpx', timedOut: false}, 'not_configured'],
      [{code: -1, stderr: '', timedOut: false, spawnError: 'ENOENT'}, 'not_configured'],
      [{code: 0, stderr: '', timedOut: false}, 'matting_failed'],
    ];
    for (const [result, code] of cases) {
      const {job, workspaces} = await failedJobAfter(async () => result);
      expect(job.status, JSON.stringify(result)).toBe('failed');
      expect(job.errorCode, JSON.stringify(result)).toBe(code);
      expect(existsSync(workspaces[0]!)).toBe(false);
    }
  });

  it('rejects before inference: too long -> source_too_long, big side -> bad_request, bad codec -> bad_request; python is never spawned', async () => {
    const cases: Array<[MattingProbe, string]> = [
      [{...okProbe, durationSec: 91}, 'source_too_long'],
      [{...okProbe, width: 2160, height: 3840}, 'bad_request'],
      [{...okProbe, codec: 'mjpeg'}, 'bad_request'],
    ];
    for (const [probe, code] of cases) {
      const run = vi.fn(successfulRun());
      const runner = makeRunner({probe: async () => probe, runPython: run}, {maxDurationSec: 90, maxDimension: 1920});
      const job = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/x.mp4', quality: 'high', outputFormat: 'transparent', useCache: false});
      await runner.settled(job.jobId);
      const after = await runner.getForUser(job.jobId, 'u');
      expect(after.errorCode, JSON.stringify(probe)).toBe(code);
      expect(run).not.toHaveBeenCalled();
    }
    expect(() => validateMattingProbe({...okProbe, width: 1920, height: 1080, durationSec: 90}, {maxDurationSec: 90, maxDimension: 1920})).not.toThrow(); // boundaries are inclusive
  });

  it('a download failure keeps its existing code (source_too_large) and the job fails', async () => {
    const {EngineError} = await import('../lib/errors.ts');
    const {job} = await failedJobAfter(successfulRun(), {
      download: async () => {
        throw new EngineError('source_too_large', 'Source video is too large');
      },
    });
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('source_too_large');
  });

  it('start() reports not_configured (and creates no job) when the runtime is missing', async () => {
    const {EngineError} = await import('../lib/errors.ts');
    const runner = makeRunner({
      available: async () => {
        throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server');
      },
    });
    await rejectsWithCode(runner.start({userId: 'u', videoUrl: 'https://cdn.example/x.mp4', quality: 'high', outputFormat: 'transparent', useCache: true}), 'not_configured');
  });
});

describe('6. production args and the real process boundary', () => {
  it('production config (no test hook) never passes --max-frames, and passes only a minimal child env', async () => {
    const seen: Array<{args: string[]; env: NodeJS.ProcessEnv}> = [];
    const capture: RunPython = (cmd, args, options) => {
      seen.push({args, env: options.env});
      return successfulRun()(cmd, args, options);
    };
    const runner = makeRunner({runPython: capture}, {device: 'cpu'}); // note: no testMaxFrames
    const job = await runner.start({userId: 'u', videoUrl: 'https://cdn.example/x.mp4', quality: 'fast', outputFormat: 'transparent', useCache: true});
    await runner.settled(job.jobId);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.args).not.toContain('--max-frames');
    expect(seen[0]!.args[seen[0]!.args.indexOf('--quality') + 1]).toBe('fast');
    expect(seen[0]!.env.RVM_DEVICE).toBe('cpu');
    expect(Object.keys(seen[0]!.env).sort()).toEqual(expect.arrayContaining(['PATH', 'RVM_DEVICE', 'PYTHONUNBUFFERED']));
    expect(Object.keys(seen[0]!.env).filter(k => /R2_|SUPABASE|GEMINI|ANTHROPIC|GROQ|API_KEY|SECRET/i.test(k))).toEqual([]);
  });

  it('spawnRvm kills a process that exceeds its timeout (timedOut, group killed) and reports a missing interpreter as spawnError', async () => {
    const started = Date.now();
    const slow = await spawnRvm('sh', ['-c', 'sleep 30 & wait'], {cwd: os.tmpdir(), env: {PATH: process.env.PATH ?? ''}, timeoutMs: 300});
    expect(slow.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);

    const missing = await spawnRvm('/definitely/not/a/python', ['-m', 'x'], {cwd: os.tmpdir(), env: {}, timeoutMs: 5000});
    expect(missing.code).toBe(-1);
    expect(missing.spawnError).toBeTruthy();

    const lines: string[] = [];
    const ok = await spawnRvm('sh', ['-c', 'echo PROGRESS 1 4; echo PROGRESS 4 4; echo noise'], {cwd: os.tmpdir(), env: {PATH: process.env.PATH ?? ''}, timeoutMs: 5000, onStdoutLine: l => lines.push(l)});
    expect(ok.code).toBe(0);
    expect(lines).toEqual(['PROGRESS 1 4', 'PROGRESS 4 4', 'noise']);
  });
});

describe('HTTP routes (mounted with stub auth, real zod/rate-limit/error shape)', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let runner: MattingRunner;
  let base = '';

  beforeEach(async () => {
    runner = makeRunner({});
    const app = express();
    app.set('etag', false);
    app.use(express.json());
    app.use((req: Request, res: Response, next: NextFunction) => {
      const userId = String(req.header('x-test-user') ?? '');
      if (!userId) {
        res.status(401).json({ok: false, code: 'unauthorized'});
        return;
      }
      res.locals.auth = {userId, via: 'supabase-jwt'};
      next();
    });
    app.use('/v1', createMattingRoutes(() => runner));
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e = toEngineError(error);
      res.status(e.status).json(e.toJSON());
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    // Let every job the test started finish (each releases its slot only after its workspace is removed), so no temp dir outlives the test.
    await until(() => runner.stats().active === 0 && runner.stats().waiting === 0);
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const call = async (method: string, route: string, user: string, body?: unknown) => {
    const response = await fetch(`${base}${route}`, {method, headers: {'content-type': 'application/json', 'x-test-user': user}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, headers: response.headers, json: (await response.json()) as Record<string, any>};
  };

  it('POST validates, returns 202 {ok, job}; GET is owner-only with no-store; others get 404 not_found', async () => {
    const bad = await call('POST', '/v1/matting/jobs', 'u1', {videoUrl: 'ftp://x/y.mp4'});
    expect([bad.status, bad.json.code]).toEqual([400, 'bad_request']);
    expect((await call('POST', '/v1/matting/jobs', 'u1', {videoUrl: 'https://cdn.example/a.mp4', quality: 'medium'})).status).toBe(400);
    expect((await call('POST', '/v1/matting/jobs', 'u1', {videoUrl: 'https://cdn.example/a.mp4', outputFormat: 'prores'})).status).toBe(400);

    const created = await call('POST', '/v1/matting/jobs', 'u1', {videoUrl: 'https://cdn.example/a.mp4'});
    expect(created.status).toBe(202);
    expect(created.json.ok).toBe(true);
    expect(created.json.job).toMatchObject({quality: 'high', outputFormat: 'transparent', userId: 'u1'});
    const jobId = created.json.job.jobId as string;

    await until(async () => (await call('GET', `/v1/matting/jobs/${jobId}`, 'u1')).json.job.status === 'done');
    const mine = await call('GET', `/v1/matting/jobs/${jobId}`, 'u1');
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toContain('no-store');
    expect(mine.json.job.outputUrl).toMatch(/ai-video\/matte\/.+\.webm$/);
    expect(JSON.stringify(mine.json)).not.toMatch(/secret|credential/i);

    const theirs = await call('GET', `/v1/matting/jobs/${jobId}`, 'u2');
    expect([theirs.status, theirs.json.code]).toEqual([404, 'not_found']);

    const again = await call('POST', '/v1/matting/jobs', 'u1', {videoUrl: 'https://cdn.example/a.mp4'});
    expect(again.json.job.jobId).toBe(jobId); // idempotent by default
    const forced = await call('POST', '/v1/matting/jobs', 'u1', {videoUrl: 'https://cdn.example/a.mp4', useCache: false});
    expect(forced.json.job.jobId).not.toBe(jobId);
  });

  it('rate-limits at 8 starts per 60 s per user (the 9th is 429 rate_limited); another user is unaffected', async () => {
    for (let i = 0; i < 8; i += 1) {
      expect((await call('POST', '/v1/matting/jobs', 'rl', {videoUrl: `https://cdn.example/${i}.mp4`})).status).toBe(202);
    }
    const ninth = await call('POST', '/v1/matting/jobs', 'rl', {videoUrl: 'https://cdn.example/9.mp4'});
    expect([ninth.status, ninth.json.code]).toEqual([429, 'rate_limited']);
    expect((await call('POST', '/v1/matting/jobs', 'someone-else', {videoUrl: 'https://cdn.example/9.mp4'})).status).toBe(202);
  });
});
