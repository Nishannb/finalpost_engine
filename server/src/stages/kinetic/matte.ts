/**
 * S3 + S6 inputs: the matte. Existing RVM only (subjectmatte is not touched). `--matte` wins; otherwise RVM runs when its runtime is configured; otherwise noMatte (every text event renders in front).
 * The alpha WebM is decoded to a coarse grid (cols x rows bits at a few samples per second) for the subject box / alpha area / occlusion. The FOREGROUND layer is built from the ORIGINAL RGB + the matte alpha
 * (alphamerge), never RVM's own `fgr` colour.
 */
import {execFile, spawn} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import type {AlphaGrid, Box} from './scene.ts';

const run = promisify(execFile);
const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';

export type MatteResolution = {path: string | null; source: 'arg' | 'rvm' | 'none'; reason?: string; /** device the RVM run used (cpu when the configured one was unavailable) */ device?: string; /** why the device differs from RVM_DEVICE / what happened (goes into the report) */ deviceNote?: string};

export const matteUsable = (p: string | undefined | null): p is string => Boolean(p && existsSync(p) && statSync(p).size > 0);

/** RVM always runs for speaker awareness (even when no beauty pass cuts the speaker out); this is its wall-clock budget. Past it the pipeline continues with noMatte and a warning. */
export const rvmTimeoutSec = (): number => Math.max(30, Number(process.env.KINETIC_RVM_TIMEOUT_SEC) || 1800);
/** The matte only has to tell WHERE the speaker is (box, alpha grid) and cut the foreground: a 768 px long side is plenty and keeps the CPU path to ~1 s / frame. */
export const RVM_MAX_SIDE = 768;

type RvmRun = (python: string, args: string[], options: {cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number}) => Promise<{code: number | null; stderr: string; timedOut: boolean; spawnError?: string}>;

async function readDevice(resultJson: string): Promise<{device?: string; error?: string}> {
  try {
    const j = JSON.parse(await readFile(resultJson, 'utf8')) as {device?: string; error?: string};
    return {...(j.device ? {device: j.device} : {}), ...(j.error ? {error: j.error} : {})};
  } catch { return {}; }
}

/**
 * Resolve the matte. `--matte` wins; otherwise the existing RVM runs (cached under the job dir): the configured RVM_DEVICE first, and when that device is unavailable (e.g. RVM_DEVICE=mps on a machine where
 * torch.backends.mps is off) it falls back to cpu and says so. A run that exceeds the timeout is killed and the result is noMatte with the reason (the pipeline never hangs on it).
 */
export async function resolveMatte(input: {video: string; matteArg?: string; cacheDir: string; runRvm?: boolean; timeoutSec?: number; run?: RvmRun}): Promise<MatteResolution> {
  if (input.matteArg) {
    return matteUsable(input.matteArg) ? {path: path.resolve(input.matteArg), source: 'arg'} : {path: null, source: 'none', reason: `matte file missing or empty: ${input.matteArg}`};
  }
  if (input.runRvm === false) return {path: null, source: 'none', reason: 'no --matte and RVM disabled'};
  try {
    const {resolveRvmPython, RVM_ROOT, buildRvmArgs, spawnRvm, rvmChildEnv} = await import('../../media/rvmMatte.ts');
    const {env} = await import('../../config/env.ts');
    const python = resolveRvmPython();
    if (!python) return {path: null, source: 'none', reason: 'RVM not configured (no RVM_PYTHON / .venv-rvm); no speaker matte'};
    await mkdir(input.cacheDir, {recursive: true});
    const out = path.join(input.cacheDir, 'matte.webm');
    const resultJson = path.join(input.cacheDir, 'matte.json');
    if (matteUsable(out)) { const d = await readDevice(resultJson); return {path: out, source: 'rvm', ...(d.device ? {device: d.device} : {})}; }
    const run: RvmRun = input.run ?? spawnRvm;
    const configured = (env.RVM_DEVICE || 'auto').trim() || 'auto';
    const devices = configured === 'cpu' ? ['cpu'] : [configured, 'cpu'];
    const timeoutMs = (input.timeoutSec ?? rvmTimeoutSec()) * 1000;
    const failures: string[] = [];
    for (const device of devices) {
      const res = await run(python, buildRvmArgs({input: input.video, outputWebm: out, resultJson, quality: 'fast', maxSide: RVM_MAX_SIDE}), {cwd: RVM_ROOT, env: rvmChildEnv(device), timeoutMs});
      if (res.code === 0 && matteUsable(out)) {
        const note = failures.length ? `RVM_DEVICE=${configured} unavailable (${failures.join('; ')}); fell back to ${device}` : undefined;
        return {path: out, source: 'rvm', device, ...(note ? {deviceNote: note} : {})};
      }
      const info = await readDevice(resultJson);
      if (res.timedOut) return {path: null, source: 'none', device, reason: `RVM on ${device} timed out after ${Math.round(timeoutMs / 1000)} s; continuing without a matte`};
      failures.push(`${device}: ${info.error ?? `code ${res.code}${res.spawnError ? `, ${res.spawnError}` : ''}`}`.slice(0, 200));
    }
    return {path: null, source: 'none', reason: `RVM failed (${failures.join('; ')})`};
  } catch (err) {
    return {path: null, source: 'none', reason: `RVM unavailable: ${err instanceof Error ? err.message : String(err)}`};
  }
}

export type MatteAnalysis = {
  ok: boolean;
  reason?: string;
  sampleFps: number;
  cols: number;
  rows: number;
  /** per sample: composition frame, normalised bbox of alpha > 0.5 (null when empty), covered fraction */
  samples: Array<{frame: number; box: Box | null; area: number; bits: string}>;
};

const COLS = 36, ROWS = 64, SAMPLE_FPS = 5;

/** Decode alpha with the libvpx-vp9 decoder (the native one drops alpha; alphaextract must run BEFORE scale, which would drop it) and reduce to a coarse bit grid. */
export async function analyzeMatte(matte: string, fps: number): Promise<MatteAnalysis> {
  const frameBytes = COLS * ROWS;
  const chunks: Buffer[] = [];
  const code = await new Promise<number | null>(resolve => {
    const child = spawn(FFMPEG(), ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', matte, '-vf', `fps=${SAMPLE_FPS},alphaextract,scale=${COLS}:${ROWS}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {stdio: ['ignore', 'pipe', 'ignore']});
    child.stdout.on('data', d => chunks.push(d as Buffer));
    child.on('error', () => resolve(-1));
    child.on('close', resolve);
  });
  const buf = Buffer.concat(chunks);
  const n = Math.floor(buf.length / frameBytes);
  if (code !== 0 || n === 0) return {ok: false, reason: `alpha decode failed (code ${code}, ${n} frames)`, sampleFps: SAMPLE_FPS, cols: COLS, rows: ROWS, samples: []};
  const samples: MatteAnalysis['samples'] = [];
  for (let i = 0; i < n; i += 1) {
    const f = buf.subarray(i * frameBytes, (i + 1) * frameBytes);
    let minX = COLS, minY = ROWS, maxX = -1, maxY = -1, cov = 0;
    const bits = Buffer.alloc(frameBytes);
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (f[y * COLS + x]! > 127) { bits[y * COLS + x] = 255; cov += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
    }
    samples.push({frame: Math.round((i / SAMPLE_FPS) * fps), box: maxX < 0 ? null : {x: minX / COLS, y: minY / ROWS, w: (maxX - minX + 1) / COLS, h: (maxY - minY + 1) / ROWS}, area: cov / frameBytes, bits: bits.toString('base64')});
  }
  return {ok: true, sampleFps: SAMPLE_FPS, cols: COLS, rows: ROWS, samples};
}

export function gridOf(a: MatteAnalysis, startFrame: number, endFrame: number): AlphaGrid | undefined {
  const s = a.samples.filter(x => x.frame >= startFrame && x.frame < endFrame && x.box);
  return s.length ? {cols: a.cols, rows: a.rows, samples: s.map(x => ({frame: x.frame, bits: x.bits}))} : undefined;
}

/** Foreground = original RGB + matte alpha (alphamerge) as a VP9-alpha WebM: never RVM's own fgr. */
export async function composeForeground(video: string, matte: string, out: string): Promise<void> {
  await mkdir(path.dirname(out), {recursive: true});
  await run(FFMPEG(), ['-y', '-v', 'error', '-i', video, '-c:v', 'libvpx-vp9', '-i', matte, '-filter_complex', '[1:v]alphaextract[a0];[a0][0:v]scale2ref=flags=bicubic[a][v0];[v0][a]alphamerge,format=yuva420p', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '30', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-auto-alt-ref', '0', out], {maxBuffer: 1 << 22});
}
