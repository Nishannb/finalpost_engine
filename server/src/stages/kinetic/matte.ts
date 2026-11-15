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

/** The colour signalling of a video stream (ffprobe names; '' = not tagged). */
export type VideoColour = {space: string; primaries: string; transfer: string; range: string};

export async function probeVideoColour(video: string): Promise<VideoColour> {
  const {stdout} = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_primaries,color_transfer,color_range,pix_fmt', '-of', 'json', video], {maxBuffer: 1 << 20});
  const st = (JSON.parse(stdout) as {streams?: Array<Record<string, string | undefined>>}).streams?.[0] ?? {};
  const known = (v: string | undefined) => (v && v !== 'unknown' && v !== 'unspecified' ? v : '');
  // a yuvj* stream is full range even when the range field is not set
  return {space: known(st.color_space), primaries: known(st.color_primaries), transfer: known(st.color_transfer), range: known(st.color_range) || (String(st.pix_fmt ?? '').startsWith('yuvj') ? 'pc' : '')};
}

/**
 * Phase 5 options (absent = the original command, byte for byte). Measured in docs/kinetic-runs/phase-5 (colour + timing):
 *  - `fps`: sample the ORIGINAL video on a constant-rate grid (`setpts=PTS-STARTPTS,fps=N:round=up`: the frame the renderer shows at t is the last one with pts <= t), the same selection the matte's working copy used, so foreground frame k == matte frame k == the
 *    picture the renderer shows for source frame k at the composition fps (exact for variable-frame-rate sources too);
 *  - `endSec`: stop reading after the last needed source second;
 *  - `fitWithin`: the render-time normalisation of the main video (media/ffmpeg.ts normalizeVideoForRemotion: fit inside 1080x1920, even sides) so the foreground has the same picture geometry;
 *  - `colour`: the source's colour tags copied onto the foreground (an untagged foreground was decoded with another matrix: -4.4 blue in the renderer); full range is converted to limited range
 *    (the renderer ignored a full-range VP9 flag: |d| 9.9); untagged stays untagged (decoded the same way as the untagged source);
 *  - `crf` (default 30): 18 measured 2.9 / 255 core difference in the renderer vs 4.1 at 30 (RVM's own fgr: 4.6, with a 32.5 edge band from the white stroke).
 *  - `frames`: the matte's frame count (authoritative: the fps filter's last frame at end-of-file can differ by one between two runs; frames before it are the same selection).
 */
export type ForegroundComposeOptions = {fps?: number; endSec?: number; frames?: number; fitWithin?: {w: number; h: number; srcW: number; srcH: number}; colour?: VideoColour; crf?: number};

const SCALE_MATRIX: Record<string, string> = {bt709: 'bt709', smpte170m: 'bt601', bt470bg: 'bt601', bt2020nc: 'bt2020', bt2020c: 'bt2020', smpte240m: 'smpte240m', fcc: 'fcc'};

export function composeForegroundArgs(video: string, matte: string, out: string, opts?: ForegroundComposeOptions): string[] {
  if (!opts) return ['-y', '-v', 'error', '-i', video, '-c:v', 'libvpx-vp9', '-i', matte, '-filter_complex', '[1:v]alphaextract[a0];[a0][0:v]scale2ref=flags=bicubic[a][v0];[v0][a]alphamerge,format=yuva420p', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '30', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-auto-alt-ref', '0', out];
  const c = opts.colour;
  const pre: string[] = [];
  if (opts.fps) pre.push('setpts=PTS-STARTPTS', `fps=${opts.fps}:round=up`); // round=up = the renderer's pick (the last frame with pts <= t), measured 117/117 on a VFR source
  const fit = opts.fitWithin && (opts.fitWithin.srcW > opts.fitWithin.w || opts.fitWithin.srcH > opts.fitWithin.h);
  // the scaler keeps the source matrix (no hue change); a matrix the scaler cannot name is left to its default, as before
  const m = SCALE_MATRIX[c?.space ?? ''];
  const matrix = m ? `:in_color_matrix=${m}:out_color_matrix=${m}` : '';
  if (fit || c?.range === 'pc') {
    const range = c?.range === 'pc' ? ':in_range=pc:out_range=tv' : '';
    pre.push(fit ? `scale=${opts.fitWithin!.w}:${opts.fitWithin!.h}:force_original_aspect_ratio=decrease${range}${matrix},scale=trunc(iw/2)*2:trunc(ih/2)*2` : `scale=iw:ih${range}${matrix}`);
  }
  const src = pre.length ? `[0:v]${pre.join(',')}[s0];` : '';
  const ref = pre.length ? '[s0]' : '[0:v]';
  // Phase 5.2: with `fps`, the matte was made from the constant-rate working copy at the same fps, so matte frame N belongs to output frame N. WebM stores millisecond
  // timestamps (33, 67 ms ...) and the source side runs at exact N/fps, so PTS-based pairing took the PREVIOUS matte frame whenever the rounded time was later
  // (every frame N = 2 mod 3 at 30 fps; measured 55 of 168 and 476 of 1,456 real frames). Re-basing the matte to its frame index in a 1/fps time base pairs frame N with frame N exactly.
  const matteTime = opts.fps ? `settb=1/${opts.fps},setpts=N` : 'setpts=PTS-STARTPTS';
  const graph = `${src}[1:v]${matteTime},alphaextract[a0];[a0]${ref}scale2ref=flags=bicubic[a][v0];[v0][a]alphamerge,format=yuva420p`;
  const tags = [...(c?.space ? ['-colorspace', c.space] : []), ...(c?.primaries ? ['-color_primaries', c.primaries] : []), ...(c?.transfer ? ['-color_trc', c.transfer] : []), ...(c?.range ? ['-color_range', 'tv'] : [])];
  return ['-y', '-v', 'error', ...(opts.endSec ? ['-t', String(opts.endSec)] : []), '-i', video, '-c:v', 'libvpx-vp9', '-i', matte, '-filter_complex', graph, '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', String(opts.crf ?? 30), '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-auto-alt-ref', '0', '-row-mt', '1', ...(opts.frames ? ['-frames:v', String(Math.floor(opts.frames))] : []), ...tags, out];
}

/** Foreground = original RGB + matte alpha (alphamerge) as a VP9-alpha WebM: never RVM's own fgr. */
export async function composeForeground(video: string, matte: string, out: string, opts?: ForegroundComposeOptions): Promise<void> {
  await mkdir(path.dirname(out), {recursive: true});
  await run(FFMPEG(), composeForegroundArgs(video, matte, out, opts), {maxBuffer: 1 << 22});
}
