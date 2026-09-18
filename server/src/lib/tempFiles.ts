/**
 * Scratch-file lifecycle.
 *
 * Every pipeline run gets one workspace directory that is removed in a `finally`
 * block, so a crashed render can never fill the VPS disk with 5-minute uploads.
 */

import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

import {EngineError} from './errors.ts';
import {logger} from './logger.ts';

export type Workspace = {
  dir: string;
  /** Absolute path inside the workspace; does not create the file. */
  file: (name: string) => string;
  cleanup: () => Promise<void>;
};

export async function createWorkspace(prefix = 'engine'): Promise<Workspace> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return {
    dir,
    file: (name: string) => path.join(dir, name),
    cleanup: async () => {
      try {
        await fs.rm(dir, {recursive: true, force: true});
      } catch (error) {
        logger.warn({dir, error}, 'workspace cleanup failed');
      }
    },
  };
}

/** Run `fn` with a workspace and always clean up, even on throw. */
export async function withWorkspace<T>(
  prefix: string,
  fn: (workspace: Workspace) => Promise<T>,
): Promise<T> {
  const workspace = await createWorkspace(prefix);
  try {
    return await fn(workspace);
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Stream a remote video to disk with a hard byte ceiling.
 *
 * Streaming (rather than buffering) keeps peak memory flat on a 1 GB VPS, and
 * the ceiling aborts hostile or mistyped URLs before they cost bandwidth.
 */
export async function downloadToFile(
  url: string,
  destination: string,
  options: {maxBytes: number; timeoutMs?: number},
): Promise<{path: string; bytes: number}> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 120_000,
  );
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // GCS and some CDNs 403 the default Node fetch user-agent.
        'User-Agent': 'KinmelVideoEngine/0.1 (video ingest)',
        Accept: '*/*',
      },
    });
    if (!response.ok || !response.body) {
      throw new EngineError(
        'source_unreachable',
        `Could not download source video (HTTP ${response.status})`,
      );
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > options.maxBytes) {
      throw new EngineError('source_too_large', 'Source video is too large');
    }

    let bytes = 0;
    const guard = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, sink) {
        bytes += chunk.byteLength;
        if (bytes > options.maxBytes) {
          throw new EngineError('source_too_large', 'Source video is too large');
        }
        sink.enqueue(chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(
        response.body.pipeThrough(guard) as import('node:stream/web').ReadableStream<Uint8Array>,
      ),
      createWriteStream(destination),
    );

    if (bytes < 1) {
      throw new EngineError('source_unreachable', 'Source video was empty');
    }
    return {path: destination, bytes};
  } catch (error) {
    if (error instanceof EngineError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new EngineError('upstream_timeout', 'Source download timed out');
    }
    throw new EngineError('source_unreachable', 'Could not download source video');
  } finally {
    clearTimeout(timer);
  }
}

export function isLocalMediaPath(raw: string): boolean {
  const value = raw.trim();
  if (!value) {
    return false;
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return false;
  }
  return value.startsWith('file://') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

export function resolveLocalMediaPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('file://')) {
    return decodeURIComponent(trimmed.replace(/^file:\/\//, ''));
  }
  return path.resolve(trimmed);
}

/**
 * Copy a local video into the workspace. Used by `npm run first-video -- /path/to.mp4`.
 */
export async function copyLocalFile(
  source: string,
  destination: string,
  options: {maxBytes: number},
): Promise<{path: string; bytes: number}> {
  const localPath = resolveLocalMediaPath(source);
  const stat = await fs.stat(localPath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size < 1) {
    throw new EngineError('source_unreachable', `Local video not found: ${localPath}`);
  }
  if (stat.size > options.maxBytes) {
    throw new EngineError('source_too_large', 'Source video is too large');
  }
  await fs.copyFile(localPath, destination);
  return {path: destination, bytes: stat.size};
}
