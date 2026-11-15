/**
 * DEVELOPMENT-ONLY local storage backend (STORAGE_BACKEND=local). It stands in for Cloudflare R2 so a development stack never touches the
 * production bucket: storage/r2.ts calls into this module when it is active, and every caller of r2.ts is unchanged.
 *
 *   - objects live under LOCAL_STORAGE_DIR/<key> (keys are the same ones R2 would get, e.g. ai-video/source/<date>/<uuid>.mp4)
 *   - this engine serves them at <LOCAL_STORAGE_PUBLIC_BASE_URL>/dev-storage/<key> (GET, with Range support)
 *   - the "presigned" source upload is a one-time PUT to the same URL, accepted only under ai-video/source/ and only if the object does not
 *     exist yet (the stand-in for a signed R2 PUT); the body is streamed to disk and capped at MAX_UPLOAD_BYTES
 *
 * Refused when NODE_ENV=production (localStorageActive throws), and inactive unless STORAGE_BACKEND=local is set explicitly.
 */
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';

import {Router, type Request, type Response, type NextFunction} from 'express';

import {env, isProduction} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';

/** Same cap the engine already applies to source downloads (pipeline/captionKitBurn.ts MAX_SOURCE_BYTES). */
export const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;
const UPLOAD_PREFIX = 'ai-video/source/';
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,300}$/;

/** True only when STORAGE_BACKEND=local; throws (never falls back silently) when that is set in production or is incomplete. */
export function localStorageActive(): boolean {
  if (env.STORAGE_BACKEND.trim().toLowerCase() !== 'local') {
    return false;
  }
  if (isProduction) {
    throw new EngineError('not_configured', 'STORAGE_BACKEND=local is development-only and is refused when NODE_ENV=production');
  }
  if (!env.LOCAL_STORAGE_DIR.trim() || !env.LOCAL_STORAGE_PUBLIC_BASE_URL.trim()) {
    throw new EngineError('not_configured', 'STORAGE_BACKEND=local needs LOCAL_STORAGE_DIR and LOCAL_STORAGE_PUBLIC_BASE_URL');
  }
  return true;
}

/** Absolute path for a key, guaranteed to stay inside LOCAL_STORAGE_DIR. */
export function localPathFor(key: string): string {
  const parts = key.split('/');
  if (!KEY_RE.test(key) || parts.some(p => p === '' || p === '.' || p === '..')) {
    throw new EngineError('bad_request', 'Invalid storage key');
  }
  const root = path.resolve(env.LOCAL_STORAGE_DIR);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new EngineError('bad_request', 'Invalid storage key');
  }
  return full;
}

export function localPublicUrlFor(key: string): string {
  return `${env.LOCAL_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/dev-storage/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function localObjectExists(key: string): Promise<boolean> {
  try {
    const stat = await fs.stat(localPathFor(key));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/** Server-side "upload": copy a finished file into the store. */
export async function localPutFile(filePath: string, key: string): Promise<{publicUrl: string; key: string}> {
  const dest = localPathFor(key);
  await fs.mkdir(path.dirname(dest), {recursive: true});
  await fs.copyFile(filePath, dest);
  return {publicUrl: localPublicUrlFor(key), key};
}

function keyFromParams(req: Request): string {
  const raw = (req.params as {key?: string | string[]}).key;
  return Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
}

/** Mounted by createApp only while localStorageActive(). */
export function devStorageRoutes(): Router {
  const router = Router();

  router.put('/dev-storage/*key', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = keyFromParams(req);
      if (!key.startsWith(UPLOAD_PREFIX)) {
        throw new EngineError('bad_request', 'Uploads are accepted only for source keys', {reason: 'not_a_source_key'});
      }
      const dest = localPathFor(key);
      if (await localObjectExists(key)) {
        throw new EngineError('bad_request', 'Object already exists', {reason: 'exists'});
      }
      const declared = Number(req.header('content-length') ?? 0);
      if (declared > MAX_UPLOAD_BYTES) {
        throw new EngineError('source_too_large', 'Upload is larger than the development store accepts');
      }
      await fs.mkdir(path.dirname(dest), {recursive: true});
      const partial = `${dest}.part-${process.pid}-${Date.now()}`;
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) req.destroy(new Error('upload too large'));
      });
      try {
        await pipeline(req, createWriteStream(partial, {flags: 'wx'}));
      } catch (error) {
        await fs.rm(partial, {force: true});
        throw new EngineError('bad_request', 'Upload failed', {detail: error instanceof Error ? error.message : String(error)});
      }
      if (received < 1) {
        await fs.rm(partial, {force: true});
        throw new EngineError('bad_request', 'Empty upload');
      }
      await fs.rename(partial, dest);
      res.status(200).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/dev-storage/*key', (req: Request, res: Response, next: NextFunction) => {
    let full: string;
    try {
      full = localPathFor(keyFromParams(req));
    } catch (error) {
      next(error);
      return;
    }
    res.sendFile(full, {dotfiles: 'deny'}, error => {
      if (error && !res.headersSent) next(new EngineError('not_found', 'No such object'));
    });
  });

  return router;
}
