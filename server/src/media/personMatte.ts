/**
 * The person matte for environmental typography (text BEHIND the presenter), produced by Robust Video Matting (RVM). MediaPipe is retired: this is the only engine.
 *
 * It produces the SAME artefact the compositor already consumes (a person-opaque / background-transparent VP9 yuva420p WebM, same timeline as the working source, transparent outside the requested
 * ranges), so `blueprint.subjectForeground`, `SubjectForegroundTrack` and the cut-aware `VideoTrack transparent` work unchanged. A chroma-key cutout (`extractSpeakerCutout`) stays the fast path when the
 * backdrop is keyable; that decision is made upstream (resolveKineticSubject reuses an existing keyed cutout first) and is not touched here.
 *
 * Cost control: RVM runs ONLY on the source ranges the planned hero beats need (frames outside are written transparent and never inferred), the result is cached by source fingerprint + ranges + variant,
 * the cache is evicted oldest-first above a size cap, and the run takes the shared RVM slot (media/rvmSlot.ts): when another RVM job holds it for longer than PERSON_MATTE_MAX_WAIT_SEC the matte is skipped
 * with reason `busy`. Everything is optional: not configured / failed / low quality / busy -> null, and the caller keeps the headroom layout. Nothing here throws into the pipeline.
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {env} from '../config/env.ts';
import {stageLogger} from '../lib/logger.ts';
import {
  assertRvmRuntime,
  buildRvmArgs,
  resolveRvmPython,
  rvmChildEnv,
  RVM_ROOT,
  spawnRvm,
  type RunPython,
  type RvmQuality,
} from './rvmMatte.ts';
import {rvmSlots, type RvmSlots} from './rvmSlot.ts';

const log = stageLogger('person-matte');

export type MatteBox = {x: number; y: number; w: number; h: number};
export type MatteReport = {
  frames: number;
  segmented_frames: number;
  fps: number;
  width: number;
  height: number;
  detected_ratio: number;
  mean_area: number;
  box: MatteBox | null;
  seconds: number;
  model: string;
  ranges: Array<[number, number]>;
  device?: string;
};

export type SubjectMatteResult = {
  path: string;
  report: MatteReport;
  cached: boolean;
  elapsedMs: number;
};

export type KeepSegmentLike = {sourceStart: number; sourceEnd: number; outputStart: number};

/** Bump when the produced artefact changes (engine, encoder settings): old cache entries then stop matching. */
const SCRIPT_VERSION = 'rvm-1';
const MERGE_GAP_SEC = 0.25;

/** True when a python interpreter for RVM resolves (RVM_PYTHON, else the local venv). The ffmpeg libvpx-vp9 check happens when the matte is actually requested. */
export const subjectMatteConfigured = (): boolean => resolveRvmPython() !== null;

/**
 * Output-time windows -> SOURCE-time ranges through the keep segments (cuts / trims / reordering safe: a window that spans a cut becomes two ranges). Windows beyond the timeline are dropped.
 * Segments are 1x speed by construction (`KeepSegment` carries no rate); a retimed clip would need the remap's rate, which the matte tool does not need because it works on source frames only.
 */
export function outputWindowsToSourceRanges(
  segments: readonly KeepSegmentLike[],
  windows: ReadonlyArray<{start: number; end: number}>,
  padSec = 0.3,
): Array<[number, number]> {
  const ordered = [...segments].sort((a, b) => a.outputStart - b.outputStart);
  const out: Array<[number, number]> = [];
  for (const win of windows) {
    for (const seg of ordered) {
      const segOutEnd = seg.outputStart + (seg.sourceEnd - seg.sourceStart);
      const a = Math.max(win.start - padSec, seg.outputStart);
      const b = Math.min(win.end + padSec, segOutEnd);
      if (b <= a) continue;
      out.push([round3(seg.sourceStart + (a - seg.outputStart)), round3(seg.sourceStart + (b - seg.outputStart))]);
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const range of out) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + MERGE_GAP_SEC) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type MatteGate = {usable: boolean; reason: string};

/**
 * Low-quality matte guard. A matte that found the person in too few of the segmented frames, or that covers an implausible share of the frame (the model keyed the whole background, or only a speck), must
 * not be used: the planner then keeps the no-matte headroom layout instead of drawing broken occlusion.
 */
export function matteQualityGate(report: Pick<MatteReport, 'detected_ratio' | 'mean_area' | 'segmented_frames'>): MatteGate {
  if (report.segmented_frames < 3) return {usable: false, reason: 'no_frames'};
  if (report.detected_ratio < 0.7) return {usable: false, reason: `person_in_only_${Math.round(report.detected_ratio * 100)}pct_of_frames`};
  if (report.mean_area < 0.015) return {usable: false, reason: 'subject_too_small'};
  if (report.mean_area > 0.8) return {usable: false, reason: 'matte_covers_frame'};
  return {usable: true, reason: 'ok'};
}

async function fingerprint(file: string): Promise<string> {
  const stat = await fs.stat(file);
  const hash = createHash('sha256');
  hash.update(`${stat.size}:${SCRIPT_VERSION}`);
  // size + first and last MiB: unique enough for a source upload, and cheap on a multi-hundred-MB file
  const slice = (start: number, end: number) =>
    new Promise<void>((resolve, reject) => {
      const stream = createReadStream(file, {start, end});
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
  const MiB = 1024 * 1024;
  await slice(0, Math.min(stat.size - 1, MiB - 1));
  if (stat.size > 2 * MiB) await slice(stat.size - MiB, stat.size - 1);
  return hash.digest('hex').slice(0, 32);
}

/** `variant` carries everything else that changes the artefact (max side, quality) so differently-built mattes never share an entry. */
export function cacheKey(sourceFingerprint: string, ranges: ReadonlyArray<readonly [number, number]>, variant = ''): string {
  return createHash('sha256').update(sourceFingerprint).update(JSON.stringify(ranges)).update(variant).digest('hex').slice(0, 40);
}

const cacheRoot = () => env.PERSON_MATTE_CACHE_DIR.trim() || path.join(os.tmpdir(), 'finalpost-subject-matte');

/**
 * Keep the cache directory under `maxBytes` by deleting the least recently used entries (a `.webm` + `.json` pair per key, ordered by the newest mtime; a cache hit touches its entry). The entry named
 * `keepKey` (the one just written / used) is never removed, and stale `.partial.webm` leftovers of a killed run are cleaned up. Best effort: never throws.
 */
export async function evictPersonMatteCache(dir: string, maxBytes: number, keepKey?: string): Promise<{removedEntries: number; freedBytes: number}> {
  const result = {removedEntries: 0, freedBytes: 0};
  try {
    const names = await fs.readdir(dir);
    const groups = new Map<string, {files: string[]; bytes: number; mtime: number}>();
    const now = Date.now();
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (name.endsWith('.partial.webm')) {
        if (now - stat.mtimeMs > 3_600_000) {
          await fs.rm(full, {force: true});
          result.freedBytes += stat.size;
        }
        continue;
      }
      const key = name.split('.')[0]!;
      const group = groups.get(key) ?? {files: [], bytes: 0, mtime: 0};
      group.files.push(full);
      group.bytes += stat.size;
      group.mtime = Math.max(group.mtime, stat.mtimeMs);
      groups.set(key, group);
    }
    let total = [...groups.values()].reduce((sum, group) => sum + group.bytes, 0);
    const oldestFirst = [...groups.entries()].sort((a, b) => a[1].mtime - b[1].mtime);
    for (const [key, group] of oldestFirst) {
      if (total <= maxBytes) break;
      if (key === keepKey) continue;
      await Promise.all(group.files.map(file => fs.rm(file, {force: true})));
      total -= group.bytes;
      result.removedEntries += 1;
      result.freedBytes += group.bytes;
    }
  } catch {
    // a missing / unreadable cache dir is not a failure of the matte
  }
  return result;
}

/**
 * Produce (or fetch from cache) the person matte for `ranges` (SOURCE seconds) of `inputPath`. Returns null when RVM is not set up, the tool fails or times out, the shared RVM slot stays busy, or the quality
 * gate rejects the result; the reason is logged and returned through `onSkip` (`not_configured`, `no_ranges`, `busy`, `timeout`, `tool_failed:<exit>:…`, `low_quality:…`, `error:…`). Never throws.
 */
export async function extractSubjectMatte(input: {
  inputPath: string;
  outputPath: string;
  ranges: ReadonlyArray<readonly [number, number]>;
  /** Test seam: replaces the python spawn. */
  runner?: RunPython;
  /** Override the cache directory (tests); default PERSON_MATTE_CACHE_DIR / <tmp>/finalpost-subject-matte. */
  cacheDir?: string;
  onSkip?: (reason: string) => void;
  /** Override the interpreter (tests): a string, or null = "not configured". Default: RVM_PYTHON / the local venv. */
  python?: string | null;
  /** Override the slot (tests). Default: the process-wide RVM slot shared with the matting job runner. */
  slots?: RvmSlots;
  /** How long to wait for the slot before skipping with `busy`. Default PERSON_MATTE_MAX_WAIT_SEC. */
  maxWaitMs?: number;
  maxSide?: number;
  quality?: RvmQuality;
  cacheMaxBytes?: number;
}): Promise<SubjectMatteResult | null> {
  const skip = (reason: string) => {
    log.info({reason}, 'person matte skipped');
    input.onSkip?.(reason);
    return null;
  };
  const python = input.python !== undefined ? input.python : resolveRvmPython();
  if (!python && !input.runner) return skip('not_configured');
  if (input.ranges.length === 0) return skip('no_ranges');
  const started = Date.now();
  const maxSide = input.maxSide ?? (env.PERSON_MATTE_MAX_SIDE > 0 ? Math.floor(env.PERSON_MATTE_MAX_SIDE) : undefined);
  const quality: RvmQuality = input.quality ?? (env.PERSON_MATTE_QUALITY === 'high' ? 'high' : 'fast');
  try {
    const key = cacheKey(await fingerprint(input.inputPath), input.ranges, `side=${maxSide ?? 0};q=${quality}`);
    const dir = input.cacheDir ?? cacheRoot();
    await fs.mkdir(dir, {recursive: true});
    const cachedWebm = path.join(dir, `${key}.webm`);
    const cachedReport = path.join(dir, `${key}.json`);
    const nonEmpty = async (file: string) => ((await fs.stat(file).catch(() => null))?.size ?? 0) > 0;
    let cached = (await nonEmpty(cachedWebm)) && (await nonEmpty(cachedReport));
    if (cached) {
      const now = new Date();
      await Promise.all([fs.utimes(cachedWebm, now, now), fs.utimes(cachedReport, now, now)]).catch(() => undefined); // LRU: a hit makes the entry the newest
    } else {
      if (!input.runner) {
        try {
          await assertRvmRuntime(python); // python exists + ffmpeg has libvpx-vp9
        } catch {
          return skip('not_configured');
        }
      }
      const release = await (input.slots ?? rvmSlots).acquire({waitMs: input.maxWaitMs ?? Math.max(0, env.PERSON_MATTE_MAX_WAIT_SEC) * 1000});
      if (!release) return skip('busy');
      let run: Awaited<ReturnType<RunPython>>;
      try {
        run = await (input.runner ?? spawnRvm)(
          python ?? 'python',
          buildRvmArgs({input: input.inputPath, outputWebm: cachedWebm, resultJson: cachedReport, quality, ranges: input.ranges, ...(maxSide ? {maxSide} : {})}),
          {cwd: RVM_ROOT, env: rvmChildEnv(env.RVM_DEVICE), timeoutMs: Math.max(30, env.MATTING_TIMEOUT_SEC) * 1000},
        );
      } finally {
        release();
      }
      if (run.spawnError || run.code === 4) {
        await cleanupEntry(dir, key);
        return skip('not_configured');
      }
      if (run.timedOut) {
        await cleanupEntry(dir, key);
        return skip('timeout');
      }
      if (run.code !== 0) {
        await cleanupEntry(dir, key);
        return skip(`tool_failed:${run.code}:${run.stderr.trim().split('\n').pop()?.slice(0, 160) ?? ''}`);
      }
      await evictPersonMatteCache(dir, Math.max(0, input.cacheMaxBytes ?? env.PERSON_MATTE_CACHE_MAX_MB * 1024 * 1024), key);
      cached = false;
    }
    const report = JSON.parse(await fs.readFile(cachedReport, 'utf8')) as MatteReport & {ok?: boolean};
    if (report.ok === false) {
      await cleanupEntry(dir, key);
      return skip('tool_failed:report_not_ok');
    }
    const gate = matteQualityGate(report);
    if (!gate.usable) return skip(`low_quality:${gate.reason}`);
    await fs.copyFile(cachedWebm, input.outputPath);
    log.info({cached, seconds: report.seconds, detected: report.detected_ratio, ranges: input.ranges.length, device: report.device, frames: report.segmented_frames, model: report.model, maxSide}, 'person matte ready');
    return {path: input.outputPath, report, cached, elapsedMs: Date.now() - started};
  } catch (error) {
    return skip(`error:${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}`);
  }
}

async function cleanupEntry(dir: string, key: string): Promise<void> {
  await Promise.all([`${key}.webm`, `${key}.json`, `${key}.partial.webm`].map(name => fs.rm(path.join(dir, name), {force: true})));
}
