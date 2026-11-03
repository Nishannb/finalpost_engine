/**
 * RVM transparent talking-head job runner (POST /v1/matting/jobs).
 *
 * Same pattern as analysisRunner / captionsEditRunner: create the job record, `void run()` in this process, the phone polls
 * GET /v1/matting/jobs/:id. No queue, no new service. At most MATTING_MAX_CONCURRENT python/RVM processes run at once (default 1);
 * further jobs stay `queued` until a slot frees.
 *
 *   download (SSRF-guarded) -> ffprobe + limits -> `python -m human_matting.cli` (silent VP9 yuva420p WebM) -> uploadPublicFile -> done
 *
 * Everything runs inside `withWorkspace`, so the temp dir (source, partial/finished webm, result json) is removed on success AND failure.
 * The caller's source object is never touched. analyzeVideo does not call this runner; it shares the same RVM process slot (media/rvmSlot.ts) through media/personMatte.ts.
 */

import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';

import {env} from '../config/env.ts';
import {EngineError, isEngineError, toEngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';
import {downloadToFile, withWorkspace} from '../lib/tempFiles.ts';
import {
  assertRvmRuntime,
  buildRvmArgs,
  parseRvmProgressLine,
  probeForMatting,
  resolveRvmPython,
  rvmChildEnv,
  RVM_ROOT,
  spawnRvm,
  validateMattingProbe,
  type MattingProbe,
  type RunPython,
  type RvmCliResult,
} from '../media/rvmMatte.ts';
import {createRvmSlots, rvmSlots, type RvmSlots} from '../media/rvmSlot.ts';
import {r2Configured, uploadPublicFile} from '../storage/r2.ts';
import {
  findMattingJobByFingerprint,
  indexMattingJob,
  loadMattingJob,
  mattingFingerprint,
  saveMattingJob,
  type MattingJob,
  type MattingOutputFormat,
  type MattingQuality,
} from '../store/mattingStore.ts';

const log = stageLogger('matting');

export type MattingConfig = {
  /** Resolved interpreter (RVM_PYTHON, else the local venv), or null = not configured. */
  python: string | null;
  device: string;
  maxConcurrent: number;
  maxDurationSec: number;
  maxDimension: number;
  timeoutSec: number;
  /** Same ceiling as analysis ingest (MAX_SOURCE_BYTES in analyzeVideo.ts). */
  maxSourceBytes: number;
  downloadTimeoutMs: number;
  /** A queued/running job re-saves itself at this interval so GET's stale check only trips when the process is really gone. */
  heartbeatMs: number;
  /** At most this often does a progress line write the job record (a few times per second). */
  progressThrottleMs: number;
  /** TEST HOOK: passes `--max-frames N` to the python CLI. Never set from env or HTTP; production leaves it undefined. */
  testMaxFrames?: number;
};

export function mattingConfigFromEnv(): MattingConfig {
  const timeoutSec = Math.max(30, env.MATTING_TIMEOUT_SEC);
  return {
    python: resolveRvmPython(),
    device: env.RVM_DEVICE || 'auto',
    maxConcurrent: Math.max(1, Math.floor(env.MATTING_MAX_CONCURRENT) || 1),
    maxDurationSec: env.MATTING_MAX_DURATION_SEC,
    maxDimension: env.MATTING_MAX_DIMENSION,
    timeoutSec,
    maxSourceBytes: 400 * 1024 * 1024,
    downloadTimeoutMs: 300_000,
    heartbeatMs: Math.min(30_000, Math.floor((timeoutSec * 1000) / 3)),
    progressThrottleMs: 250,
  };
}

export type MattingDeps = {
  /** Throws `not_configured` when the runtime (python, ffmpeg libvpx-vp9, storage) is missing. */
  available: () => Promise<void>;
  download: (url: string, destination: string, options: {maxBytes: number; timeoutMs?: number}) => Promise<{path: string; bytes: number}>;
  probe: (filePath: string) => Promise<MattingProbe>;
  runPython: RunPython;
  upload: (filePath: string, key: string, contentType: string) => Promise<{publicUrl: string; key: string}>;
};

function defaultDeps(config: MattingConfig): MattingDeps {
  return {
    available: async () => {
      await assertRvmRuntime(config.python);
      if (!r2Configured()) {
        throw new EngineError('not_configured', 'Storage is not configured');
      }
    },
    download: downloadToFile,
    probe: probeForMatting,
    runPython: spawnRvm,
    upload: uploadPublicFile,
  };
}

export type StartMattingInput = {
  userId: string;
  videoUrl: string;
  quality: MattingQuality;
  outputFormat: MattingOutputFormat;
  useCache: boolean;
};

export type MattingRunner = {
  start: (input: StartMattingInput) => Promise<MattingJob>;
  /** Owner-only. Another user's (or an unknown) job is `not_found`. Applies the stale-job expiry. */
  getForUser: (jobId: string, userId: string) => Promise<MattingJob>;
  /** Resolves when the in-process run of `jobId` has fully finished (tests; never needed by the routes). */
  settled: (jobId: string) => Promise<void>;
  stats: () => {active: number; waiting: number};
};

/** Query strings and fragments can carry signatures; never persist or log them. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

const GENERIC_FAILURE = 'Talking-head extraction failed. Please try again.';

/** `slots` defaults to a private instance sized by this runner's config; the process-wide runner passes the shared `rvmSlots` so analyze and matting jobs never run RVM at the same time. */
export function createMattingRunner(options: {config?: Partial<MattingConfig>; deps?: Partial<MattingDeps>; slots?: RvmSlots} = {}): MattingRunner {
  const config: MattingConfig = {...mattingConfigFromEnv(), ...options.config};
  const deps: MattingDeps = {...defaultDeps(config), ...options.deps};
  const semaphore = options.slots ?? createRvmSlots(() => config.maxConcurrent);
  const runs = new Map<string, Promise<void>>();
  const creating = new Map<string, Promise<MattingJob>>();

  async function expireIfStale(job: MattingJob): Promise<MattingJob> {
    if (job.status !== 'queued' && job.status !== 'running') return job;
    const age = Date.now() - Date.parse(job.updatedAt);
    if (!(age > config.timeoutSec * 1000)) return job;
    const failed: MattingJob = {
      ...job,
      status: 'failed',
      stage: undefined,
      errorCode: 'upstream_timeout',
      errorMessage: 'Talking-head extraction timed out. Please try again.',
      updatedAt: new Date().toISOString(),
    };
    await saveMattingJob(failed);
    log.warn({jobId: job.jobId, userId: job.userId, status: 'failed', ageSec: Math.round(age / 1000)}, 'stale matting job expired');
    return failed;
  }

  async function runJob(job: MattingJob, videoUrl: string): Promise<void> {
    const started = Date.now();
    const source = redactUrl(videoUrl);
    let lastSave = 0;
    const touch = (patch: Partial<MattingJob>, force = false): Promise<void> => {
      Object.assign(job, patch, {updatedAt: new Date().toISOString()});
      const now = Date.now();
      if (force || now - lastSave >= config.progressThrottleMs) {
        lastSave = now;
        return saveMattingJob(job);
      }
      return Promise.resolve();
    };
    const heartbeat = setInterval(() => {
      job.updatedAt = new Date().toISOString();
      void saveMattingJob(job).catch(() => undefined);
    }, config.heartbeatMs);
    heartbeat.unref();

    let release: (() => void) | null = null;
    try {
      release = (await semaphore.acquire())!; // no waitMs: resolves with a release function
      await touch({status: 'running', stage: 'downloading', progress: 0.02}, true);
      log.info({jobId: job.jobId, userId: job.userId, status: 'running', source}, 'matting job started');

      const finished = await withWorkspace('matting', async workspace => {
        const sourcePath = workspace.file('source.mp4');
        const webmPath = workspace.file('matte.webm');
        const resultPath = workspace.file('result.json');

        await deps.download(videoUrl, sourcePath, {maxBytes: config.maxSourceBytes, timeoutMs: config.downloadTimeoutMs});

        await touch({stage: 'probing', progress: 0.1});
        const probe = await deps.probe(sourcePath);
        validateMattingProbe(probe, {maxDurationSec: config.maxDurationSec, maxDimension: config.maxDimension});

        if (!config.python) {
          throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server');
        }
        await touch({stage: 'matting', progress: 0.12}, true);
        const run = await deps.runPython(
          config.python,
          buildRvmArgs({input: sourcePath, outputWebm: webmPath, resultJson: resultPath, quality: job.quality, maxFrames: config.testMaxFrames}),
          {
            cwd: RVM_ROOT,
            env: rvmChildEnv(config.device),
            timeoutMs: config.timeoutSec * 1000,
            onStdoutLine: line => {
              const progress = parseRvmProgressLine(line);
              if (progress && progress.total > 0) {
                void touch({progress: 0.12 + 0.76 * Math.min(1, progress.done / progress.total)});
              }
            },
          },
        );
        if (run.timedOut) {
          throw new EngineError('upstream_timeout', 'Talking-head extraction timed out. Please try again.');
        }
        if (run.spawnError) {
          log.error({jobId: job.jobId, error: run.spawnError}, 'could not start the RVM python process');
          throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server', {reason: 'spawn_failed'});
        }
        let result: RvmCliResult | null = null;
        try {
          result = JSON.parse(await fs.readFile(resultPath, 'utf8')) as RvmCliResult;
        } catch {
          result = null;
        }
        if (run.code === 4 || result?.code === 'not_configured') {
          log.error({jobId: job.jobId, exit: run.code, detail: result?.error}, 'RVM runtime not configured');
          throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server', {reason: 'runtime'});
        }
        if (run.code !== 0 || !result?.ok || !(Number(result.frames_encoded) > 0)) {
          log.error({jobId: job.jobId, exit: run.code, detail: result?.error, stderr: run.stderr.slice(-1000)}, 'RVM run failed');
          throw new EngineError('matting_failed', GENERIC_FAILURE, {exitCode: run.code});
        }
        const stat = await fs.stat(webmPath).catch(() => null);
        if (!stat || stat.size < 1) {
          throw new EngineError('matting_failed', GENERIC_FAILURE, {reason: 'empty_output'});
        }

        await touch({stage: 'uploading', progress: 0.9}, true);
        const key = `ai-video/matte/${new Date().toISOString().slice(0, 10)}/${job.jobId}.webm`;
        let uploaded: {publicUrl: string; key: string};
        try {
          uploaded = await deps.upload(webmPath, key, 'video/webm');
        } catch (error) {
          const e = toEngineError(error);
          if (e.code === 'not_configured') throw e;
          throw new EngineError('matting_failed', isEngineError(error) ? e.message : 'Could not store the extracted video. Please try again.');
        }
        return {result, outputUrl: uploaded.publicUrl};
      });

      clearInterval(heartbeat);
      const elapsedMs = Date.now() - started;
      const r = finished.result;
      await touch(
        {
          status: 'done',
          stage: undefined,
          progress: 1,
          outputUrl: finished.outputUrl,
          result: {
            width: Number(r.width),
            height: Number(r.height),
            fps: Number(r.fps),
            frames: Number(r.frames_encoded),
            durationSec: Number(r.duration_sec),
            device: String(r.device ?? ''),
            elapsedMs,
            silent: true,
          },
        },
        true,
      );
      log.info({jobId: job.jobId, userId: job.userId, status: 'done', frames: r.frames_encoded, device: r.device, elapsedMs}, 'matting job done');
    } catch (error) {
      clearInterval(heartbeat);
      const engineError = isEngineError(error) ? error : new EngineError('matting_failed', GENERIC_FAILURE);
      log.error({jobId: job.jobId, userId: job.userId, status: 'failed', code: engineError.code, elapsedMs: Date.now() - started, ...(isEngineError(error) ? {} : {error})}, 'matting job failed');
      await touch({status: 'failed', stage: undefined, errorCode: engineError.code, errorMessage: engineError.message}, true).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      release?.();
    }
  }

  async function createJob(input: StartMattingInput, fingerprint: string): Promise<MattingJob> {
    if (input.useCache) {
      const existing = await findMattingJobByFingerprint(fingerprint);
      if (existing && existing.userId === input.userId) {
        const current = await expireIfStale(existing);
        if (current.status !== 'failed') return current;
      }
    }
    await deps.available();
    const now = new Date().toISOString();
    const job: MattingJob = {
      jobId: `mt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      userId: input.userId,
      sourceUrl: redactUrl(input.videoUrl),
      quality: input.quality,
      outputFormat: input.outputFormat,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    await saveMattingJob(job);
    await indexMattingJob(fingerprint, job.jobId);
    const run = runJob(job, input.videoUrl).finally(() => {
      runs.delete(job.jobId);
    });
    runs.set(job.jobId, run);
    return {...job};
  }

  return {
    async start(input) {
      const fingerprint = mattingFingerprint(input);
      const pending = input.useCache ? creating.get(fingerprint) : undefined;
      if (pending) return pending;
      const creation = createJob(input, fingerprint);
      if (input.useCache) creating.set(fingerprint, creation);
      try {
        return await creation;
      } finally {
        if (creating.get(fingerprint) === creation) creating.delete(fingerprint);
      }
    },
    async getForUser(jobId, userId) {
      const job = await loadMattingJob(jobId);
      if (!job || job.userId !== userId) {
        throw new EngineError('not_found', 'Matting job not found');
      }
      return expireIfStale(job);
    },
    settled: jobId => runs.get(jobId) ?? Promise.resolve(),
    stats: semaphore.stats,
  };
}

let defaultRunner: MattingRunner | null = null;

/** The process-wide runner used by the routes (built lazily so env is read at first use). */
export function getMattingRunner(): MattingRunner {
  defaultRunner ??= createMattingRunner({slots: rvmSlots});
  return defaultRunner;
}
