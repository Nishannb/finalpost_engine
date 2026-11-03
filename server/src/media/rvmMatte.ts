/**
 * Robust Video Matting (RVM) process boundary: python discovery, runtime checks, ffprobe validation and the spawn.
 *
 * Shared by the transparent talking-head job (POST /v1/matting/jobs) and the analyze-side person matte (media/personMatte.ts, the kinetic subject path).
 * RVM is the only person matte (MediaPipe is retired). The python side is subjectmatte/human_matting/cli.py
 * (run with cwd = subjectmatte/, from the .venv-rvm interpreter unless RVM_PYTHON says otherwise).
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
/** <repo>/subjectmatte; same depth from src/media and dist/media. */
export const RVM_ROOT = path.resolve(here, '../../../subjectmatte');

/** The interpreter to use: RVM_PYTHON when set, else the local venv when it exists, else null (= not configured). */
export function resolveRvmPython(configured: string = env.RVM_PYTHON): string | null {
  const explicit = configured.trim();
  if (explicit) return explicit;
  const venv = path.join(RVM_ROOT, '.venv-rvm', 'bin', 'python');
  return existsSync(venv) ? venv : null;
}

const runtimeOk = new Set<string>();

function captureStdout(cmd: string, args: string[], timeoutMs: number): Promise<{code: number | null; stdout: string}> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'ignore']});
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({code: -1, stdout});
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({code, stdout});
    });
  });
}

/**
 * Throws `not_configured` unless a python interpreter is resolvable and ffmpeg has libvpx-vp9 (there is no fallback encoder: the
 * asset must carry real alpha). A positive answer is cached for the process; a negative one is re-checked every time.
 */
export async function assertRvmRuntime(python: string | null, ffmpegPath: string = env.FFMPEG_PATH): Promise<string> {
  if (!python) {
    throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server');
  }
  if (path.isAbsolute(python) && !existsSync(python)) {
    throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server', {reason: 'python_missing'});
  }
  const key = `${python}|${ffmpegPath}`;
  if (runtimeOk.has(key)) return python;
  const {code, stdout} = await captureStdout(ffmpegPath, ['-hide_banner', '-encoders'], 15_000);
  if (code !== 0 || !stdout.includes('libvpx-vp9')) {
    throw new EngineError('not_configured', 'Talking-head extraction is not set up on this server', {reason: 'ffmpeg_vp9_missing'});
  }
  runtimeOk.add(key);
  return python;
}

// --- probe ------------------------------------------------------------------------------------------------------------------

export type MattingProbe = {codec: string; width: number; height: number; durationSec: number; fps: number};

/** Codecs OpenCV's bundled decoder is expected to read. Phone footage is h264 / hevc. */
export const MATTING_ALLOWED_CODECS: ReadonlySet<string> = new Set(['h264', 'hevc', 'vp8', 'vp9', 'mpeg4', 'prores']);

export async function probeForMatting(filePath: string): Promise<MattingProbe> {
  const {code, stdout} = await captureStdout(
    env.FFPROBE_PATH,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration:format=duration', '-of', 'json', filePath],
    30_000,
  );
  if (code === -1) throw new EngineError('not_configured', 'ffprobe is not available on this host');
  let parsed: {streams?: Array<{codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string}>; format?: {duration?: string}};
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new EngineError('bad_request', 'The file is not a readable video');
  }
  const video = parsed.streams?.[0];
  if (code !== 0 || !video) throw new EngineError('bad_request', 'The file is not a readable video');
  const rate = (video.avg_frame_rate && video.avg_frame_rate !== '0/0' ? video.avg_frame_rate : video.r_frame_rate) ?? '';
  const [n, d] = rate.split('/').map(Number);
  const fps = n && d ? n / d : Number(rate) || 0;
  return {
    codec: String(video.codec_name ?? ''),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    durationSec: Number(parsed.format?.duration ?? video.duration ?? 0),
    fps,
  };
}

/** Reject before any inference. Existing codes: bad_request (codec, size of a side), source_too_long. */
export function validateMattingProbe(probe: MattingProbe, limits: {maxDurationSec: number; maxDimension: number}): void {
  if (!MATTING_ALLOWED_CODECS.has(probe.codec)) {
    throw new EngineError('bad_request', 'This video format is not supported for talking-head extraction', {codec: probe.codec});
  }
  if (!(probe.width > 0 && probe.height > 0)) {
    throw new EngineError('bad_request', 'The file is not a readable video');
  }
  if (Math.max(probe.width, probe.height) > limits.maxDimension) {
    throw new EngineError('bad_request', `Video is too large for talking-head extraction (longest side limit ${limits.maxDimension}px)`, {
      width: probe.width,
      height: probe.height,
    });
  }
  if (!(probe.fps > 0)) {
    throw new EngineError('bad_request', 'The video has no readable frame rate');
  }
  if (!(probe.durationSec > 0)) {
    throw new EngineError('bad_request', 'Could not read the video duration');
  }
  if (probe.durationSec > limits.maxDurationSec) {
    throw new EngineError('source_too_long', `Video is ${Math.round(probe.durationSec)}s; the limit for talking-head extraction is ${limits.maxDurationSec}s`, {
      durationSec: Math.round(probe.durationSec * 100) / 100,
    });
  }
}

// --- spawn ------------------------------------------------------------------------------------------------------------------

export type RvmQuality = 'high' | 'fast';

export type RvmCliResult = {
  ok: boolean;
  code?: string;
  error?: string;
  frames_encoded?: number;
  width?: number;
  height?: number;
  fps?: number;
  duration_sec?: number;
  device?: string;
  elapsed_sec?: number;
};

/**
 * Arguments after the interpreter. `maxFrames` is a TEST HOOK: the runner only sets it when its config carries `testMaxFrames`, never from the HTTP request or env.
 * `ranges` (SOURCE seconds) limits inference to those windows (the output keeps the source timeline, transparent elsewhere); `maxSide` caps the longest side.
 */
export function buildRvmArgs(input: {
  input: string;
  outputWebm: string;
  resultJson: string;
  quality: RvmQuality;
  maxFrames?: number;
  ranges?: ReadonlyArray<readonly [number, number]>;
  maxSide?: number;
}): string[] {
  return [
    '-m',
    'human_matting.cli',
    input.input,
    input.outputWebm,
    input.resultJson,
    '--quality',
    input.quality,
    ...(input.ranges && input.ranges.length > 0 ? ['--ranges', input.ranges.map(([a, b]) => `${a}-${b}`).join(',')] : []),
    ...(input.maxSide ? ['--max-side', String(Math.floor(input.maxSide))] : []),
    ...(input.maxFrames ? ['--max-frames', String(input.maxFrames)] : []),
  ];
}

export type RunPythonOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  onStdoutLine?: (line: string) => void;
};
export type RunPythonResult = {code: number | null; stderr: string; timedOut: boolean; spawnError?: string};
export type RunPython = (cmd: string, args: string[], options: RunPythonOptions) => Promise<RunPythonResult>;

/** The minimal environment the python process gets: no engine secrets (R2, Supabase, model API keys) leak into it. */
export function rvmChildEnv(device: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    RVM_DEVICE: device || 'auto',
    FFMPEG_PATH: env.FFMPEG_PATH,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
  };
  if (process.env.TMPDIR) out.TMPDIR = process.env.TMPDIR;
  return out;
}

export const spawnRvm: RunPython = (cmd, args, options) =>
  new Promise(resolve => {
    // detached = own process group, so a timeout kills python AND the ffmpeg child it started.
    const child = spawn(cmd, args, {cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    let buffered = '';
    let timedOut = false;
    let settled = false;
    const finish = (result: RunPythonResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    child.stdout.on('data', chunk => {
      buffered += String(chunk);
      let nl: number;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (line) options.onStdoutLine?.(line);
      }
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.on('error', error => finish({code: -1, stderr, timedOut, spawnError: String(error)}));
    child.on('close', code => finish({code, stderr, timedOut}));
  });

/** `PROGRESS <done> <total|0>` -> {done, total} or null. */
export function parseRvmProgressLine(line: string): {done: number; total: number} | null {
  const m = /^PROGRESS (\d+) (\d+)$/.exec(line);
  return m ? {done: Number(m[1]), total: Number(m[2])} : null;
}
