/**
 * Development-only local storage backend (STORAGE_BACKEND=local): off by default, refused in production, keys confined to the store,
 * and the presign -> PUT -> GET round trip that the app's upload uses. No network beyond 127.0.0.1.
 */
import fs from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {toEngineError} from '../lib/errors.ts';
import {devStorageRoutes, localPathFor, localStorageActive} from './localStorage.ts';
import {presignSourceVideo, r2Configured, sourceObjectExists, uploadPublicFile} from './r2.ts';

const e = env as unknown as {STORAGE_BACKEND: string; LOCAL_STORAGE_DIR: string; LOCAL_STORAGE_PUBLIC_BASE_URL: string};
const original = {...e};
let dir = '';
let server: ReturnType<ReturnType<typeof express>['listen']> | null = null;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-storage-test-'));
});
afterEach(() => {
  Object.assign(e, original);
});
afterAll(async () => {
  server?.close();
  await fs.rm(dir, {recursive: true, force: true});
});

async function startServer(): Promise<string> {
  const app = express();
  app.use(devStorageRoutes());
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const err = toEngineError(error);
    res.status(err.status).json(err.toJSON());
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('STORAGE_BACKEND=local (development only)', () => {
  it('is off by default: r2 stays the backend and the R2 checks are unchanged', () => {
    expect(env.STORAGE_BACKEND).toBe('r2');
    expect(localStorageActive()).toBe(false);
  });

  it('refuses an incomplete configuration instead of silently using R2', () => {
    Object.assign(e, {STORAGE_BACKEND: 'local', LOCAL_STORAGE_DIR: '', LOCAL_STORAGE_PUBLIC_BASE_URL: ''});
    expect(() => localStorageActive()).toThrow(/needs LOCAL_STORAGE_DIR/);
  });

  it('is refused when NODE_ENV=production', async () => {
    vi.resetModules();
    const saved = {NODE_ENV: process.env.NODE_ENV, STORAGE_BACKEND: process.env.STORAGE_BACKEND, LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR, LOCAL_STORAGE_PUBLIC_BASE_URL: process.env.LOCAL_STORAGE_PUBLIC_BASE_URL};
    Object.assign(process.env, {NODE_ENV: 'production', STORAGE_BACKEND: 'local', LOCAL_STORAGE_DIR: dir, LOCAL_STORAGE_PUBLIC_BASE_URL: 'http://localhost:1'});
    try {
      const fresh = await import('./localStorage.ts');
      expect(() => fresh.localStorageActive()).toThrow(/refused when NODE_ENV=production/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.resetModules();
    }
  });

  it('confines every key to the store', () => {
    Object.assign(e, {STORAGE_BACKEND: 'local', LOCAL_STORAGE_DIR: dir, LOCAL_STORAGE_PUBLIC_BASE_URL: 'http://localhost:1'});
    for (const bad of ['../escape.mp4', 'a/../../b.mp4', 'a//b.mp4', '/abs.mp4', '.hidden', 'a/./b.mp4', '']) {
      expect(() => localPathFor(bad), bad).toThrow(/Invalid storage key/);
    }
    expect(localPathFor('ai-video/source/2026-11-09/x.mp4')).toBe(path.join(path.resolve(dir), 'ai-video/source/2026-11-09/x.mp4'));
  });

  it('presign -> one-time PUT -> GET (with Range) round trip; uploads only under ai-video/source/', async () => {
    const base = await startServer();
    Object.assign(e, {STORAGE_BACKEND: 'local', LOCAL_STORAGE_DIR: dir, LOCAL_STORAGE_PUBLIC_BASE_URL: base});
    expect(r2Configured()).toBe(true);

    const presigned = await presignSourceVideo({contentType: 'video/mp4', extension: '.mp4'});
    expect(presigned.key).toMatch(/^ai-video\/source\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.mp4$/);
    expect(presigned.uploadUrl).toBe(`${base}/dev-storage/${presigned.key}`);
    expect(presigned.publicUrl).toBe(presigned.uploadUrl);
    expect(await sourceObjectExists(presigned.key)).toBe(false);

    const body = Buffer.from('0123456789abcdef'.repeat(64));
    const put = await fetch(presigned.uploadUrl, {method: 'PUT', headers: {'Content-Type': 'video/mp4'}, body});
    expect(put.status).toBe(200);
    expect(await sourceObjectExists(presigned.key)).toBe(true);

    const again = await fetch(presigned.uploadUrl, {method: 'PUT', body});
    expect(again.status).toBe(400); // one-time: never overwrites

    const get = await fetch(presigned.publicUrl);
    expect(get.status).toBe(200);
    expect(Buffer.from(await get.arrayBuffer()).equals(body)).toBe(true);
    const ranged = await fetch(presigned.publicUrl, {headers: {Range: 'bytes=0-9'}});
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('0123456789');

    const outside = await fetch(`${base}/dev-storage/ai-video/render/x.mp4`, {method: 'PUT', body});
    expect(outside.status).toBe(400);
    const missing = await fetch(`${base}/dev-storage/ai-video/source/none.mp4`);
    expect(missing.status).toBe(404);
  });

  it('server-side uploads (renders, burns) land in the store and are served from it', async () => {
    const base = server ? `http://127.0.0.1:${(server.address() as AddressInfo).port}` : await startServer();
    Object.assign(e, {STORAGE_BACKEND: 'local', LOCAL_STORAGE_DIR: dir, LOCAL_STORAGE_PUBLIC_BASE_URL: base});
    const src = path.join(dir, 'render-input.mp4');
    await fs.writeFile(src, 'rendered');
    const out = await uploadPublicFile(src, 'ai-video/render/2026-11-09/rj_1.mp4', 'video/mp4');
    expect(out).toEqual({key: 'ai-video/render/2026-11-09/rj_1.mp4', publicUrl: `${base}/dev-storage/ai-video/render/2026-11-09/rj_1.mp4`});
    expect(await (await fetch(out.publicUrl)).text()).toBe('rendered');
  });
});
