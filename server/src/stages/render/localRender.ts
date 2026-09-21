/**
 * Dev burn: Remotion on this machine, then upload the MP4 to R2.
 *
 * Lambda is not required for the first video. This path is slower than Lambda
 * but uses the same composition, so captions / trim / zoom / B-roll / split
 * match what production will look like.
 *
 * If R2 upload fails (Cloudflare 503), fall back to serving the MP4 from this
 * engine so LAN device testing can still preview/publish.
 */

import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {env} from '../../config/env.ts';
import {EngineError, isEngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import {applyCubeLut} from '../../media/ffmpeg.ts';
import {uploadRenderedVideo} from '../../storage/r2.ts';
import type {RenderStyle, TimelineBlueprint} from '../../types/blueprint.ts';
import {resolveLutPath} from '../color/luts.ts';
import {prefetchBlueprintMedia} from './prefetchAssets.ts';

const log = stageLogger('stage-e-local');

const remotionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../remotion',
);

const servedDir = path.join(remotionRoot, 'out', 'served');

export function localRenderAvailable(): boolean {
  return existsSync(path.join(remotionRoot, 'src/index.ts'));
}

export function localServedRenderPath(renderJobId: string): string {
  return path.join(servedDir, `${renderJobId}.mp4`);
}

function enginePublicBaseUrl(): string {
  const configured = env.ENGINE_PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  return `http://127.0.0.1:${env.PORT}`;
}

export async function renderLocally(input: {
  blueprint: TimelineBlueprint;
  style: RenderStyle;
  renderJobId: string;
  onProgress?: (progress: number) => void;
}): Promise<{outputUrl: string}> {
  if (!localRenderAvailable()) {
    throw new EngineError('not_configured', 'Remotion project is missing');
  }

  const workDir = path.join(remotionRoot, 'out');
  await fs.mkdir(workDir, {recursive: true});
  const propsPath = path.join(workDir, `${input.renderJobId}.json`);
  const outputPath = path.join(workDir, `${input.renderJobId}.mp4`);
  const gradedPath = path.join(workDir, `${input.renderJobId}.graded.mp4`);
  const prefetchDir = path.join(
    remotionRoot,
    'public',
    'prefetch',
    input.renderJobId,
  );

  await sweepStaleRemotionTemp();
  await assertDiskHeadroom(remotionRoot);
  const blueprint = await prefetchBlueprintMedia(
    input.blueprint,
    prefetchDir,
    `/prefetch/${input.renderJobId}`,
  );

  await fs.writeFile(
    propsPath,
    JSON.stringify({blueprint, style: input.style}),
  );

  const started = Date.now();
  log.info(
    {renderJobId: input.renderJobId, durationSec: blueprint.outputDurationSec},
    'local remotion render starting',
  );

  let uploadPath = outputPath;
  try {
    await runRemotion(outputPath, propsPath, input.onProgress);

    const lutId = (input.style.colorGradeLut ?? '').trim();
    const lutPath = resolveLutPath(lutId);
    if (lutPath) {
      await applyCubeLut({
        inputPath: outputPath,
        outputPath: gradedPath,
        lutPath,
      });
      uploadPath = gradedPath;
      log.info({lutId, lutPath}, 'color grade applied');
    }

    try {
      const uploaded = await uploadRenderedVideo(uploadPath, input.renderJobId);
      log.info(
        {
          renderJobId: input.renderJobId,
          ms: Date.now() - started,
          url: uploaded.publicUrl,
        },
        'local remotion render uploaded',
      );
      await fs.unlink(propsPath).catch(() => undefined);
      return {outputUrl: uploaded.publicUrl};
    } catch (uploadError) {
      // Remotion + LUT already succeeded — R2 blip should not fail the job.
      const localUrl = await persistLocalServedRender(
        uploadPath,
        input.renderJobId,
      );
      log.warn(
        {
          renderJobId: input.renderJobId,
          localUrl,
          uploadError: isEngineError(uploadError)
            ? uploadError.message
            : uploadError instanceof Error
              ? uploadError.message
              : String(uploadError),
        },
        'R2 upload failed after render; serving MP4 from engine instead',
      );
      await fs.unlink(propsPath).catch(() => undefined);
      return {outputUrl: localUrl};
    }
  } catch (error) {
    log.error(
      {renderJobId: input.renderJobId, propsPath},
      'local remotion render failed; props JSON kept for debug',
    );
    throw error;
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
    await fs.unlink(gradedPath).catch(() => undefined);
    await fs.rm(prefetchDir, {recursive: true, force: true}).catch(() => undefined);
  }
}

async function persistLocalServedRender(
  sourcePath: string,
  renderJobId: string,
): Promise<string> {
  await fs.mkdir(servedDir, {recursive: true});
  const dest = localServedRenderPath(renderJobId);
  await fs.copyFile(sourcePath, dest);
  return `${enginePublicBaseUrl()}/v1/local-renders/${encodeURIComponent(renderJobId)}.mp4`;
}

function runRemotion(
  outputPath: string,
  propsPath: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'remotion',
        'render',
        'src/index.ts',
        'ShortVideo',
        outputPath,
        `--props=${propsPath}`,
        '--log=verbose',
        '--timeout=120000',
        '--concurrency=1',
        `--offthreadvideo-cache-size-in-bytes=${256 * 1024 * 1024}`,
      ],
      {
        cwd: remotionRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 80_000) {
        stderr = stderr.slice(-40_000);
      }
      const match = text.match(/Rendered (\d+)\/(\d+)/);
      if (match) {
        const current = Number(match[1]);
        const total = Number(match[2]);
        if (total > 0) {
          onProgress?.(Math.min(0.95, current / total));
        }
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new EngineError('upstream_timeout', 'Local render timed out'));
    }, 40 * 60 * 1000);

    child.on('error', error => {
      clearTimeout(timer);
      reject(
        new EngineError(
          'render_failed',
          `Could not start Remotion (${(error as Error).message})`,
        ),
      );
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new EngineError('render_failed', 'Remotion render failed', {
          detail: stderr.slice(-4000),
        }),
      );
    });
  });
}

/** Drop leftover Remotion Chrome/webpack scratch so a full disk does not abort the next burn. */
async function sweepStaleRemotionTemp(): Promise<void> {
  const tmp = os.tmpdir();
  const names = await fs.readdir(tmp).catch(() => []);
  for (const name of names) {
    if (
      name.startsWith('remotion-webpack-bundle-') ||
      name.startsWith('react-motion-render')
    ) {
      await fs.rm(path.join(tmp, name), {recursive: true, force: true}).catch(() => undefined);
    }
  }
  const prefetchRoot = path.join(remotionRoot, 'public', 'prefetch');
  await fs.rm(prefetchRoot, {recursive: true, force: true}).catch(() => undefined);
}

async function assertDiskHeadroom(dir: string): Promise<void> {
  const free = await freeDiskBytes(dir);
  log.info({freeMb: Math.round(free / 1024 / 1024)}, 'disk free before remotion');
  if (free < 400 * 1024 * 1024) {
    throw new EngineError(
      'render_failed',
      `Not enough free disk for Remotion (${Math.round(free / 1024 / 1024)} MB). Free at least 1 GB and retry.`,
    );
  }
}

async function freeDiskBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}
