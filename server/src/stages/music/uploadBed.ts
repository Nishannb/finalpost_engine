import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {env} from '../../config/env.ts';
import {stageLogger} from '../../lib/logger.ts';
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
};

/** Dry (synthetic click) beds live under their own prefix and never enter a real pool. */
export function bedObjectKey(cacheKey: string, dry = false): string {
  return `music/beds/${dry ? 'dry/' : ''}${cacheKey}/bed.wav`;
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

async function appendToPool(mood: string, entry: PoolBed, dry: boolean): Promise<void> {
  const beds = await readPool(mood, dry);
  if (beds.some(bed => bed.cache_key === entry.cache_key)) return;
  const file = path.join(os.tmpdir(), `music-pool-${dry ? 'dry-' : ''}${moodSlug(mood)}.json`);
  await fs.writeFile(file, JSON.stringify({beds: [...beds, entry]}));
  await uploadPublicFile(file, poolObjectKey(mood, dry), 'application/json');
}

/**
 * Uploads an existing file on disk (no generation) with meta.json, then appends it to the mood pool.
 * `mood` is the MoodSpec name (the pool key). Dry beds go to a separate, never-picked prefix.
 */
export async function uploadBed(input: {
  filePath: string;
  cacheKey: string;
  meta: Record<string, unknown>;
  mood: string;
  dry?: boolean;
}): Promise<string> {
  if (!r2Configured()) throw new Error('r2_unconfigured');
  const dry = Boolean(input.dry);
  const existing = await findUploadedBed(input.cacheKey, dry);
  let url = existing;
  if (!url) {
    const uploaded = await uploadPublicFile(input.filePath, bedObjectKey(input.cacheKey, dry), 'audio/wav');
    url = uploaded.publicUrl;
    const metaPath = path.join(os.tmpdir(), `music-meta-${input.cacheKey}.json`);
    await fs.writeFile(metaPath, JSON.stringify({licence: LICENCE, ...input.meta, url}));
    await uploadPublicFile(metaPath, `music/beds/${dry ? 'dry/' : ''}${input.cacheKey}/meta.json`, 'application/json');
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
  }, dry);
  return url;
}

/** Any bed in this mood's pool, used only when generation fails. */
export async function cachedMoodBed(mood: string, videoId = ''): Promise<PoolBed | null> {
  return pickPoolBed(videoId, await readPool(mood));
}
