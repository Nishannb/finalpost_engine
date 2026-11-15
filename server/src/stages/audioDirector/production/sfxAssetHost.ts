/**
 * Hosting for generated event SFX, so a Lambda render can load them (a local render loads them as staticFile assets from remotion/public).
 *
 *   - Stable references: content-addressed object keys `music/sfx/generated/<sha256 of the WAV bytes>.wav` (the same sound always has the same URL).
 *   - No duplicate uploads: HEAD first; an existing object is reused, never re-uploaded (also across videos).
 *   - Failure-safe: any missing file, hashing, HEAD or upload error returns `ok: false` and the caller keeps the edit's existing hits (no generated
 *     SFX on that render) - a render never points at an object that was not confirmed.
 * The store is injected. `r2SfxObjectStore()` adapts the project's existing R2 helpers (storage/r2.ts: sourceObjectExists, uploadPublicFile with its
 * retries and local-storage mode; stages/music/uploadBed.ts publicUrlForKey). Nothing here runs unless the caller passes a store.
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

export type SfxObjectStore = {
  exists(key: string): Promise<boolean>;
  put(filePath: string, key: string, contentType: string): Promise<{publicUrl: string}>;
  publicUrl(key: string): string;
};

export const SFX_OBJECT_PREFIX = 'music/sfx/generated';
export const sfxObjectKey = (sha256: string): string => `${SFX_OBJECT_PREFIX}/${sha256}.wav`;

type Hit = {at: number; src?: string; [key: string]: unknown};
export type PublishResult<H extends Hit> =
  | {ok: true; hits: H[]; uploaded: string[]; reused: string[]}
  | {ok: false; code: 'asset_missing' | 'store_error' | 'not_a_local_asset'; detail: string};

/** Rewrites every `staticFile:generated-sfx/...` hit to its hosted URL (uploading only objects that do not exist yet). Other hits pass unchanged. */
export async function publishGeneratedSfxHits<H extends Hit>(hits: readonly H[], input: {publicRoot: string; store: SfxObjectStore}): Promise<PublishResult<H>> {
  const uploaded: string[] = [];
  const reused: string[] = [];
  const keyFor = new Map<string, string>();
  try {
    for (const hit of hits) {
      if (typeof hit.src !== 'string' || !hit.src.startsWith('staticFile:generated-sfx/')) continue;
      const rel = hit.src.slice('staticFile:'.length);
      if (keyFor.has(rel)) continue;
      const file = path.join(input.publicRoot, rel);
      if (!existsSync(file)) return {ok: false, code: 'asset_missing', detail: `${rel} is not in ${input.publicRoot}`};
      const key = sfxObjectKey(createHash('sha256').update(readFileSync(file)).digest('hex'));
      if (await input.store.exists(key)) reused.push(key);
      else {
        await input.store.put(file, key, 'audio/wav');
        uploaded.push(key);
      }
      keyFor.set(rel, key);
    }
  } catch (error) {
    return {ok: false, code: 'store_error', detail: error instanceof Error ? error.message.slice(0, 200) : 'store_error'};
  }
  const out = hits.map(hit => {
    if (typeof hit.src !== 'string' || !hit.src.startsWith('staticFile:generated-sfx/')) return hit;
    return {...hit, src: input.store.publicUrl(keyFor.get(hit.src.slice('staticFile:'.length))!)};
  });
  return {ok: true, hits: out, uploaded, reused};
}

/** The production store over the existing R2 helpers. Null when R2 is not configured. Loaded lazily (no client is built unless it is used). */
export async function r2SfxObjectStore(): Promise<SfxObjectStore | null> {
  const r2 = await import('../../../storage/r2.ts');
  if (!r2.r2Configured()) return null;
  const {publicUrlForKey} = await import('../../music/uploadBed.ts');
  return {
    exists: key => r2.sourceObjectExists(key),
    put: (filePath, key, contentType) => r2.uploadPublicFile(filePath, key, contentType),
    publicUrl: key => publicUrlForKey(key),
  };
}
