/**
 * Phase SFX-2: cross-video SFX content cache. A generated SFX is a function of the provider request (model, prompt, task duration, output format) and
 * of how ingest prepared it (the request's max duration), so the same request in another video can reuse it at $0 with no provider request.
 *
 * Only WAVs that passed ingest (manifest `ready`) are stored; every read re-verifies size and SHA-256 and the WAV header, and anything that fails is a
 * miss (never a corrupted hit). The interface is storage-agnostic; LocalDirSfxCache is a local implementation for offline use and tests. Production
 * storage (R2) is NOT wired and nothing here proves its behaviour.
 */

import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {canonicalJson} from '../eventSheet/hash.ts';
import type {GeneratedAssetManifest} from './manifest.ts';
import type {SfxGenerationRequest} from './requests.ts';
import type {ProviderTask} from './runware.ts';
import {decodeWav} from './wav.ts';

/** Bump when the provider contract or the ingest preparation changes, so old cache entries are not reused for a different request. */
export const SFX_CACHE_VERSION = 'sfxcache-v1' as const;

const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** The cache identity: exactly what makes the sound, never the event or video it was first made for. */
export function sfxCacheKey(task: ProviderTask, prepareMaxSec: number): string {
  const identity = {version: SFX_CACHE_VERSION, model: task.model, positivePrompt: task.positivePrompt, duration: task.duration, outputFormat: task.outputFormat ?? null, prepareMaxSec};
  return `${SFX_CACHE_VERSION}:${sha256Hex(canonicalJson(identity))}`;
}

export type SfxCacheEntry = {key: string; file: string; sha256: string; bytes: number};

export interface SfxCacheStore {
  get(key: string): SfxCacheEntry | null;
  /** Stores a validated WAV under `key`. Throws for anything that is not a parseable WAV. */
  put(key: string, sourceWav: string): SfxCacheEntry;
}

export class LocalDirSfxCache implements SfxCacheStore {
  readonly #dir: string;
  constructor(dir: string) {
    this.#dir = dir;
  }

  #paths(key: string) {
    const stem = sha256Hex(key).slice(0, 32);
    return {wav: path.join(this.#dir, `${stem}.wav`), meta: path.join(this.#dir, `${stem}.json`)};
  }

  get(key: string): SfxCacheEntry | null {
    const {wav, meta} = this.#paths(key);
    if (!existsSync(wav) || !existsSync(meta)) return null;
    try {
      const recorded = JSON.parse(readFileSync(meta, 'utf8')) as {key?: string; sha256?: string; bytes?: number};
      const bytes = readFileSync(wav);
      if (recorded.key !== key || recorded.bytes !== bytes.length || recorded.sha256 !== sha256Hex(bytes)) return null;
      decodeWav(bytes);
      return {key, file: wav, sha256: recorded.sha256, bytes: bytes.length};
    } catch {
      return null;
    }
  }

  put(key: string, sourceWav: string): SfxCacheEntry {
    const bytes = readFileSync(sourceWav);
    decodeWav(bytes); // throws for anything that is not a WAV: nothing invalid is ever cached
    mkdirSync(this.#dir, {recursive: true});
    const {wav, meta} = this.#paths(key);
    const temp = `${wav}.${process.pid}.tmp`;
    copyFileSync(sourceWav, temp);
    renameSync(temp, wav);
    const entry: SfxCacheEntry = {key, file: wav, sha256: sha256Hex(bytes), bytes: bytes.length};
    writeFileSync(`${meta}.${process.pid}.tmp`, JSON.stringify({key, sha256: entry.sha256, bytes: entry.bytes}));
    renameSync(`${meta}.${process.pid}.tmp`, meta);
    return entry;
  }
}

/**
 * Stores every manifest-`ready` SFX (already decoded, trimmed and measured by ingest) under its cache key. Failed, invalid and missing entries are
 * never cached. Returns the keys stored. `keyFor` is runware.ts sfxCacheKeyFor (passed in to keep this module free of provider code).
 */
export function cacheReadySfx(input: {
  manifest: GeneratedAssetManifest;
  requests: readonly SfxGenerationRequest[];
  publicRoot: string;
  cache: SfxCacheStore;
  keyFor: (request: SfxGenerationRequest) => string;
}): string[] {
  const byRequest = new Map(input.manifest.assets.map(entry => [entry.requestId, entry]));
  const stored: string[] = [];
  for (const request of input.requests) {
    const entry = byRequest.get(request.requestId);
    if (!entry || entry.kind !== 'sfx' || entry.status !== 'ready' || !entry.file) continue;
    const key = input.keyFor(request);
    input.cache.put(key, path.join(input.publicRoot, entry.file.path));
    stored.push(key);
  }
  return stored;
}
