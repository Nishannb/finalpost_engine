import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {env} from '../../config/env.ts';
import {stageLogger} from '../../lib/logger.ts';
import {resolvePoolSize} from './flags.ts';
import {r2Configured, sourceObjectExists, uploadPublicFile} from '../../storage/r2.ts';

const log = stageLogger('music');

const LICENCE = 'Generated instrumental bed via Runware ACE-Step v1.5 base for this edit. Not a licensed stock cue.';

/** One bed in a mood pool. The pool object is a list, so new beds append and nothing is overwritten. */
export type PoolBed = {
  cache_key: string;
  url: string;
  mood?: string;
  bpm?: number;
  key?: string;
  seed?: number;
  cost_usd?: number;
  integrated_lufs?: number;
  duration_sec?: number;
  added_at?: string;
  /** Trimmed full bed. Absent on old entries, which keep single-file playback from `url`. */
  full_url?: string;
  loop_url?: string;
  carved_url?: string;
  /** Phase 3: the style this bed was made for and its pool family, and the arc that was requested. */
  style?: string;
  family?: string;
  arc?: string;
  /** Phase 3: measured on the bed (postprocess v4). Absent on older entries, which are still placed (start 0, hold-and-fade end). */
  measured_bpm?: number;
  downbeat_times?: number[];
  energy_map?: number[];
  lift_sec?: number | null;
  lift_bar?: number | null;
  bar_sec?: number | null;
  loop_duration_sec?: number;
  loop_bars?: number;
};

/** Dry (synthetic click) beds live under their own prefix and never enter a real pool. */
export function bedObjectKey(cacheKey: string, dry = false): string {
  return `music/beds/${dry ? 'dry/' : ''}${cacheKey}/bed.wav`;
}

/** Object key for the bar-aligned loop body. Helper only; nothing uploads it yet. */
export function bedLoopObjectKey(cacheKey: string, dry = false): string {
  return `music/beds/${dry ? 'dry/' : ''}${cacheKey}/bed_loop.wav`;
}

export function publicUrlForKey(key: string): string {
  return `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
}

export function moodSlug(mood: string): string {
  const slug = mood.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.slice(0, 48) || 'neutral';
}

export function poolObjectKey(mood: string, dry = false): string {
  return `music/beds/pool/${dry ? 'dry-' : ''}${moodSlug(mood)}.json`;
}

/** Same video id → same index, for a fixed pool. */
export function pickPoolBed<T>(videoId: string, beds: readonly T[]): T | null {
  if (beds.length === 0) return null;
  const digest = createHash('sha256').update(videoId).digest();
  return beds[digest.readUInt32BE(0) % beds.length] ?? null;
}

/**
 * The bed whose tempo is nearest the brief's. Ties (and beds with no tempo) go to the same hash(videoId) pick as before, so a re-render picks the same bed.
 * Deterministic: the same video, brief and pool always give the same bed.
 */
export function pickNearestBpm(videoId: string, beds: readonly PoolBed[], targetBpm: number): PoolBed | null {
  if (beds.length === 0) return null;
  const distance = (bed: PoolBed) => (typeof bed.bpm === 'number' && bed.bpm > 0 ? Math.abs(bed.bpm - targetBpm) : Number.POSITIVE_INFINITY);
  const best = Math.min(...beds.map(distance));
  const tied = beds.filter(bed => distance(bed) === best);
  return pickPoolBed(videoId, tied);
}

export async function findUploadedBed(cacheKey: string, dry = false): Promise<string | null> {
  if (!r2Configured()) return null;
  const key = bedObjectKey(cacheKey, dry);
  if (!(await sourceObjectExists(key))) return null;
  return publicUrlForKey(key);
}

export async function readPool(mood: string, dry = false): Promise<PoolBed[]> {
  if (!r2Configured()) return [];
  try {
    const response = await fetch(`${publicUrlForKey(poolObjectKey(mood, dry))}?t=${Date.now()}`);
    if (!response.ok) return [];
    const body = await response.json() as {beds?: unknown};
    if (!Array.isArray(body.beds)) return [];
    return body.beds.filter((bed): bed is PoolBed => Boolean(bed) && typeof (bed as PoolBed).url === 'string' && (bed as PoolBed).url.trim() !== '' && typeof (bed as PoolBed).cache_key === 'string');
  } catch {
    log.warn({reason: 'pool_read'}, 'music.fallback');
    return [];
  }
}

/** Keys a later upload may add to an existing pool entry. */
export type PoolPatch = Partial<Pick<PoolBed, 'full_url' | 'loop_url' | 'carved_url' | 'duration_sec' | 'style' | 'family' | 'arc' | 'measured_bpm' | 'downbeat_times' | 'energy_map' | 'lift_sec' | 'lift_bar' | 'bar_sec' | 'loop_duration_sec' | 'loop_bars'>>;

/**
 * Pure. An existing cache key is patched in place (every original key kept, only defined patch
 * values written, no second element). A new cache key is appended with the patch applied.
 */
export function mergePoolEntry(
  beds: readonly PoolBed[],
  entry: PoolBed,
  patch: PoolPatch = {},
  limits: {maxSize?: number; allowAppend?: boolean} = {},
): {beds: PoolBed[]; changed: boolean; appended: boolean; skipped?: 'pool_full' | 'qc_failed'} {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as PoolPatch;
  const index = beds.findIndex(bed => bed.cache_key === entry.cache_key);
  if (index < 0) {
    // A new bed joins the pool only when it passed QC and the pool is under its size. Existing entries (the salvaged v2 bed included) are never removed or replaced.
    if (limits.allowAppend === false) return {beds: [...beds], changed: false, appended: false, skipped: 'qc_failed'};
    if (limits.maxSize !== undefined && beds.length >= limits.maxSize) return {beds: [...beds], changed: false, appended: false, skipped: 'pool_full'};
    return {beds: [...beds, {...entry, ...defined}], changed: true, appended: true};
  }
  if (Object.keys(defined).length === 0) return {beds: [...beds], changed: false, appended: false};
  const current = beds[index];
  if (!current) return {beds: [...beds], changed: false, appended: false};
  const next = beds.map(bed => ({...bed}));
  next[index] = {...current, ...defined};
  return {beds: next, changed: true, appended: false};
}

async function appendToPool(mood: string, entry: PoolBed, dry: boolean, patch: PoolPatch = {}, allowAppend = true): Promise<void> {
  const beds = await readPool(mood, dry);
  const merged = mergePoolEntry(beds, entry, patch, {maxSize: resolvePoolSize(), allowAppend});
  if (merged.skipped) log.info({mood, size: beds.length, reason: merged.skipped, cache_key: entry.cache_key}, 'music.pool_not_appended');
  if (!merged.changed) return;
  const file = path.join(os.tmpdir(), `music-pool-${dry ? 'dry-' : ''}${moodSlug(mood)}.json`);
  await fs.writeFile(file, JSON.stringify({beds: merged.beds}));
  await uploadPublicFile(file, poolObjectKey(mood, dry), 'application/json');
  if (merged.appended) log.info({mood, size: merged.beds.length, cache_key: entry.cache_key, dry}, 'music.pool_appended');
}

export async function readBedMeta(cacheKey: string, dry = false): Promise<Record<string, unknown>> {
  return readExistingMeta(cacheKey, dry);
}

async function readExistingMeta(cacheKey: string, dry: boolean): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${publicUrlForKey(`music/beds/${dry ? 'dry/' : ''}${cacheKey}/meta.json`)}?t=${Date.now()}`);
    if (!response.ok) return {};
    const body = await response.json() as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** The Phase 3 fields of a bed's meta, as pool-entry fields. Only what is present; an older bed gives {}. */
export function placementPoolFields(meta: Record<string, unknown>): Partial<PoolBed> {
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const nums = (value: unknown) => (Array.isArray(value) && value.every(item => typeof item === 'number') ? (value as number[]) : undefined);
  const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  const nullable = (value: unknown) => (value === null ? null : num(value));
  const out: Partial<PoolBed> = {
    style: str(meta.style),
    family: str(meta.family),
    arc: str(meta.arc),
    measured_bpm: num(meta.measured_bpm),
    downbeat_times: nums(meta.downbeat_times),
    energy_map: nums(meta.energy_map),
    lift_sec: nullable(meta.lift_sec),
    lift_bar: nullable(meta.lift_bar),
    bar_sec: nullable(meta.bar_sec),
    loop_duration_sec: num(meta.loop_duration_sec),
    loop_bars: num(meta.loop_bars),
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined)) as Partial<PoolBed>;
}

export type UploadBedResult = {url: string; fullUrl?: string; loopUrl?: string; carvedUrl?: string};

export type UploadBedInput = {
  filePath: string;
  cacheKey: string;
  /** Carries postprocess_version, trailing_trimmed_sec, duration_sec and flat qc_* scores when known. */
  meta: Record<string, unknown>;
  mood: string;
  dry?: boolean;
  /** Optional bar-aligned loop wav. Uploaded to bedLoopObjectKey; url goes on meta as loop_url. */
  loopFilePath?: string;
  /** Optional trimmed full bed. Uploaded as bed_full.wav even when bed.wav already exists. */
  fullFilePath?: string;
  /** Optional VO-carved bed. Uploaded as bed_carved.wav even when bed.wav already exists. */
  carvedFilePath?: string;
};

/**
 * Uploads an existing file on disk (no generation) with meta.json, then adds it to the mood pool.
 * `mood` is the MoodSpec name (the pool key). Dry beds go to a separate, never-picked prefix.
 * bed.wav is never re-uploaded. Derived files upload even when bed.wav exists, and then
 * meta.json is rewritten and the pool entry patched in place.
 */
export async function uploadBedDetailed(input: UploadBedInput): Promise<UploadBedResult> {
  if (!r2Configured()) throw new Error('r2_unconfigured');
  const dry = Boolean(input.dry);
  const prefix = `music/beds/${dry ? 'dry/' : ''}${input.cacheKey}`;
  const existing = await findUploadedBed(input.cacheKey, dry);
  let url = existing;
  if (!url) {
    const uploaded = await uploadPublicFile(input.filePath, bedObjectKey(input.cacheKey, dry), 'audio/wav');
    url = uploaded.publicUrl;
  }
  const up = async (file: string | undefined, key: string) => (file ? (await uploadPublicFile(file, key, 'audio/wav')).publicUrl : undefined);
  const fullUrl = await up(input.fullFilePath, `${prefix}/bed_full.wav`);
  const loopUrl = await up(input.loopFilePath, bedLoopObjectKey(input.cacheKey, dry));
  const carvedUrl = await up(input.carvedFilePath, `${prefix}/bed_carved.wav`);
  const derived = {
    ...(fullUrl ? {full_url: fullUrl} : {}),
    ...(loopUrl ? {loop_url: loopUrl} : {}),
    ...(carvedUrl ? {carved_url: carvedUrl} : {}),
  };
  const hasDerived = Object.keys(derived).length > 0;
  if (!existing || hasDerived) {
    const previous = existing ? await readExistingMeta(input.cacheKey, dry) : {};
    const metaPath = path.join(os.tmpdir(), `music-meta-${input.cacheKey}.json`);
    await fs.writeFile(metaPath, JSON.stringify({licence: LICENCE, ...previous, ...input.meta, url, ...derived}));
    await uploadPublicFile(metaPath, `${prefix}/meta.json`, 'application/json');
  }
  const meta = input.meta as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  await appendToPool(input.mood, {
    cache_key: input.cacheKey,
    url,
    mood: input.mood,
    bpm: num(meta.bpm),
    key: typeof meta.key === 'string' ? meta.key : undefined,
    seed: num(meta.seed),
    cost_usd: num(meta.cost),
    integrated_lufs: num(meta.integrated_lufs ?? meta.lufs),
    duration_sec: num(meta.duration_sec),
    added_at: new Date().toISOString(),
    ...placementPoolFields(meta),
  }, dry, {...derived, ...(hasDerived ? {duration_sec: num(meta.duration_sec)} : {})}, meta.qc_passed !== false);
  return {url, ...(fullUrl ? {fullUrl} : {}), ...(loopUrl ? {loopUrl} : {}), ...(carvedUrl ? {carvedUrl} : {})};
}

export async function uploadBed(input: UploadBedInput): Promise<string> {
  return (await uploadBedDetailed(input)).url;
}

/** Any bed in this mood's pool, used only when generation fails. */
export async function cachedMoodBed(mood: string, videoId = ''): Promise<PoolBed | null> {
  return pickPoolBed(videoId, await readPool(mood));
}
