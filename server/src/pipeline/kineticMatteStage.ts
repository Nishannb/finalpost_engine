/**
 * Phase 5: the RVM person matte for Kinetic V2 (text BEHIND the speaker). I/O glue only; the geometry is stages/kinetic/matteMap.ts, the RVM run is media/personMatte.ts (cache, shared slot,
 * timeout, quality gate), the foreground compose is stages/kinetic/matte.ts.
 *
 *   source (the active working source the blueprint plays)
 *     -> working copy: [0, last kept second], constant frame rate at the COMPOSITION fps (so matte frame k == the picture the renderer shows for source frame k, also for VFR sources)
 *     -> RVM (alpha only matters: no white stroke, no colour-palette pocket pass), only on the kept source ranges
 *     -> foreground = ORIGINAL source RGB (same CFR selection, render-time geometry, source colour tags, limited range) + RVM alpha, VP9 yuva420p
 *     -> alpha decoded on the source grid -> mapped through cover + zoom + keep segments into composition fractions at output frames (the solver's grid)
 *
 * Contract: NEVER throws. `ok: false` carries a reason (and the warnings), and the caller runs the engine without a matte (front-only, exactly Phase 4.9). Camera footage only is the caller's gate.
 */
import {spawn, execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import {env} from '../config/env.ts';
import {extractSubjectMatte, type SubjectMatteResult} from '../media/personMatte.ts';
import {composeForeground, probeVideoColour, type ForegroundComposeOptions} from '../stages/kinetic/matte.ts';
import {compositionMatte, placedSegments, type CompositionMatte, type KeepSegmentLite, type SourceAlphaFrames} from '../stages/kinetic/matteMap.ts';
import type {AlphaGrid} from '../stages/kinetic/scene.ts';
import type {ZoomTriggerLite} from '../stages/kinetic/zoomTrack.ts';

const run = promisify(execFile);

/** The render-time fit of the main video (media/ffmpeg.ts normalizeVideoForRemotion defaults). */
export const RENDER_FIT = {w: 1080, h: 1920} as const;
/** Longest side of the decoded source alpha used for the composition grid (the grid itself is 36 x 64). */
const ALPHA_LONG_SIDE = 128;
/** Foreground VP9 quality (measured: 2.9 / 255 core difference to the footage in the renderer at 18 vs 4.1 at 30). */
const FOREGROUND_CRF = 18;
const RANGE_PAD_SEC = 0.1;

export type KineticMatteInput = {
  sourcePath: string;
  workDir: string;
  keepSegments: readonly KeepSegmentLite[];
  fps: number;
  outW: number;
  outH: number;
  srcW: number;
  srcH: number;
  objectPosition: {x: number; y: number};
  zoomTriggers: readonly ZoomTriggerLite[];
  zoomEnabled: boolean;
  durationFrames: number;
  /** cap on the kept seconds that go through RVM (default MATTING_MAX_DURATION_SEC) */
  maxDurationSec?: number;
  /** test seams */
  extract?: typeof extractSubjectMatte;
  extractOptions?: Partial<Parameters<typeof extractSubjectMatte>[0]>;
  compose?: typeof composeForeground;
};

export type KineticMatteReport = {
  keptSec: number;
  ranges: Array<[number, number]>;
  workingCopyMs: number;
  matteMs: number;
  matteCached: boolean;
  composeMs: number;
  mapMs: number;
  totalMs: number;
  matteFrames: number;
  foregroundFrames: number;
  device?: string;
  detectedRatio?: number;
  meanArea?: number;
  alphaAreaFrac: number;
  gridSamples: number;
  emptySamples: number;
  colour: string;
};

export type KineticMatteOutcome =
  | {ok: true; matte: {grid: AlphaGrid; alphaAreaFrac: number}; foregroundPath: string; composition: CompositionMatte; report: KineticMatteReport; warnings: string[]}
  | {ok: false; reason: string; warnings: string[]; report?: Partial<KineticMatteReport>};

/** Source ranges the matte must cover: every kept segment (padded, merged). */
export function keptSourceRanges(segments: readonly KeepSegmentLite[], pad = RANGE_PAD_SEC): Array<[number, number]> {
  const r = segments.filter(s => s.sourceEnd > s.sourceStart).map(s => [Math.max(0, s.sourceStart - pad), s.sourceEnd + pad] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const x of r) { const last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push([x[0], x[1]]); }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return out.map(([a, b]) => [r3(a), r3(b)]);
}

async function countFrames(file: string, alpha: boolean): Promise<number> {
  const {stdout} = await run(env.FFPROBE_PATH, ['-v', 'error', ...(alpha ? ['-c:v', 'libvpx-vp9'] : []), '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], {maxBuffer: 1 << 20});
  return Number(stdout.trim().split(/\s+/)[0]) || 0;
}

/** Decode the matte's alpha on a small source-aspect grid, every frame (libvpx-vp9 decoder: the native one drops alpha; alphaextract before the scale). */
async function decodeSourceAlpha(matte: string, srcW: number, srcH: number): Promise<SourceAlphaFrames> {
  const long = ALPHA_LONG_SIDE;
  const cols = srcW >= srcH ? long : Math.max(8, Math.round((long * srcW) / srcH));
  const rows = srcW >= srcH ? Math.max(8, Math.round((long * srcH) / srcW)) : long;
  const chunks: Buffer[] = [];
  const code = await new Promise<number | null>(resolve => {
    const child = spawn(env.FFMPEG_PATH, ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', matte, '-vf', `alphaextract,scale=${cols}:${rows}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {stdio: ['ignore', 'pipe', 'ignore']});
    child.stdout.on('data', d => chunks.push(d as Buffer));
    child.on('error', () => resolve(-1));
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`alpha decode failed (code ${code})`);
  const buf = Buffer.concat(chunks);
  const per = cols * rows;
  const frames: Uint8Array[] = [];
  for (let i = 0; i + per <= buf.length; i += per) frames.push(new Uint8Array(buf.subarray(i, i + per)));
  return {cols, rows, frames};
}

export async function prepareKineticMatte(input: KineticMatteInput): Promise<KineticMatteOutcome> {
  const warnings: string[] = [];
  const t0 = Date.now();
  const fail = (reason: string, report?: Partial<KineticMatteReport>): KineticMatteOutcome => {
    warnings.push(`kinetic_engine:matte_skipped:${reason.slice(0, 120)}`);
    return {ok: false, reason, warnings, ...(report ? {report} : {})};
  };
  try {
    // an EMPTY keep segment (start == end, e.g. a sub-frame tail of an older blueprint) shows nothing of its own: it must not demand a matte frame past the source's end
    const keepSegments = input.keepSegments.filter(s => s.sourceEnd - s.sourceStart >= 0.5 / input.fps);
    if (!(input.fps > 0) || !(input.srcW > 0) || !(input.srcH > 0) || keepSegments.length === 0) return fail('invalid_geometry');
    const ranges = keptSourceRanges(keepSegments);
    const keptSec = keepSegments.reduce((a, s) => a + Math.max(0, s.sourceEnd - s.sourceStart), 0);
    const budget = input.maxDurationSec ?? env.MATTING_MAX_DURATION_SEC;
    if (keptSec > budget) return fail(`over_budget:${Math.round(keptSec)}s>${budget}s`, {keptSec, ranges});
    const endSec = Math.max(...ranges.map(r => r[1])) + 2 / input.fps;
    await fs.mkdir(input.workDir, {recursive: true});

    // 1. constant-frame-rate working copy at the composition fps (RVM input only; alpha is insensitive to this encode)
    const working = path.join(input.workDir, 'kinetic-matte-input.mp4');
    let t = Date.now();
    await run(env.FFMPEG_PATH, ['-y', '-v', 'error', '-t', String(endSec), '-i', input.sourcePath, '-vf', `setpts=PTS-STARTPTS,fps=${input.fps}:round=up`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', working], {maxBuffer: 1 << 22});
    const workingCopyMs = Date.now() - t;

    // 2. RVM (cache / slot / timeout / quality gate in personMatte)
    t = Date.now();
    let skip = '';
    const matte: SubjectMatteResult | null = await (input.extract ?? extractSubjectMatte)({
      inputPath: working,
      outputPath: path.join(input.workDir, 'kinetic-matte.webm'),
      ranges,
      strokePx: 0,
      pocketPasses: 0,
      alphaOnly: true, // Phase 5.3: the foreground below is source RGB + this alpha; RVM's colour is never used
      skipFgrDownload: true, // Phase 5.7 (validated in Phase 5.6, byte-identical matte): RVM's colour is not copied off the device
      reusePackBuffer: true, // Phase 5.7 (validated in Phase 5.6, byte-identical matte): one reused RGBA pack buffer
      onSkip: reason => { skip = reason; },
      ...(input.extractOptions ?? {}),
    });
    const matteMs = Date.now() - t;
    if (!matte) return fail(`rvm:${skip || 'unknown'}`, {keptSec, ranges, workingCopyMs, matteMs});

    // 3. foreground = original RGB (same CFR selection) + RVM alpha
    const colour = await probeVideoColour(input.sourcePath).catch(() => ({space: '', primaries: '', transfer: '', range: ''}));
    const foregroundPath = path.join(input.workDir, 'kinetic-foreground.webm');
    const matteFrames = await countFrames(matte.path, true);
    const opts: ForegroundComposeOptions = {fps: input.fps, endSec, frames: matteFrames, fitWithin: {...RENDER_FIT, srcW: input.srcW, srcH: input.srcH}, colour, crf: FOREGROUND_CRF};
    t = Date.now();
    await (input.compose ?? composeForeground)(input.sourcePath, matte.path, foregroundPath, opts);
    const composeMs = Date.now() - t;
    const foregroundFrames = await countFrames(foregroundPath, true);
    if (matteFrames <= 0 || foregroundFrames !== matteFrames) return fail(`frame_mismatch:matte=${matteFrames},foreground=${foregroundFrames}`, {keptSec, ranges, workingCopyMs, matteMs, composeMs, matteFrames, foregroundFrames});

    // 4. alpha -> composition grid at output frames
    t = Date.now();
    const alpha = await decodeSourceAlpha(matte.path, input.srcW, input.srcH);
    if (alpha.frames.length !== matteFrames) return fail(`alpha_decode_frames:${alpha.frames.length}/${matteFrames}`);
    // every output frame must have a matte frame (the foreground must exist wherever behind text could be drawn)
    const placed = placedSegments(keepSegments, input.fps);
    const lastNeeded = Math.max(...placed.map(p => p.trimBefore + p.durationInFrames - 1));
    if (lastNeeded >= matteFrames) return fail(`matte_short:${matteFrames}<=${lastNeeded}`);
    const composition = compositionMatte(alpha, {srcW: input.srcW, srcH: input.srcH, outW: input.outW, outH: input.outH, objectPosition: input.objectPosition, zoomTriggers: input.zoomTriggers, zoomEnabled: input.zoomEnabled, keepSegments, fps: input.fps, durationFrames: input.durationFrames});
    const mapMs = Date.now() - t;
    if (composition.missing > 0) return fail(`grid_missing_frames:${composition.missing}`);
    if (composition.samples === 0 || composition.empty > composition.samples * 0.3) return fail(`grid_empty:${composition.empty}/${composition.samples}`);

    const report: KineticMatteReport = {
      keptSec: Math.round(keptSec * 100) / 100, ranges, workingCopyMs, matteMs, matteCached: matte.cached, composeMs, mapMs, totalMs: Date.now() - t0, matteFrames, foregroundFrames,
      ...(matte.report.device ? {device: matte.report.device} : {}), detectedRatio: matte.report.detected_ratio, meanArea: matte.report.mean_area,
      alphaAreaFrac: Math.round(composition.alphaAreaFrac * 1000) / 1000, gridSamples: composition.samples, emptySamples: composition.empty,
      colour: `${colour.space || '-'}/${colour.primaries || '-'}/${colour.transfer || '-'}/${colour.range || '-'}`,
    };
    warnings.push(`kinetic_engine:matte_ready:${Math.round(report.totalMs / 100) / 10}s,area=${report.alphaAreaFrac}${matte.cached ? ',cached' : ''}`);
    return {ok: true, matte: {grid: composition.grid, alphaAreaFrac: composition.alphaAreaFrac}, foregroundPath, composition, report, warnings};
  } catch (err) {
    return fail(`error:${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
  }
}
