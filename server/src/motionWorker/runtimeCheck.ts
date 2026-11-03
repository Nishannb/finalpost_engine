/**
 * One-frame runtime validation for generated graphics.
 *
 * The compiled module is rendered by real Remotion through the production
 * loading path: the `GeneratedGraphicPreview` composition in the Remotion
 * project uses the same loader (sha256 check, require shim, font loading),
 * the same GeneratedGraphicTrack / GeneratedSplitStage, safe area and caption
 * docking as ShortVideo. Nothing is rendered by a second system; this only
 * drives Remotion's own renderer for a single still.
 *
 * The bundle and the headless browser are created once per process and reused.
 * Modules under test are written into the bundle's public folder, so they are
 * served same-origin exactly like prefetched modules in a local burn.
 */

import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition, type HeadlessBrowser} from '@remotion/renderer';

import {stageLogger} from '../lib/logger.ts';
import type {GeneratedGraphicPlacement} from '../types/blueprint.ts';
import {motionToolkitRoot} from './typecheck.ts';

const log = stageLogger('motion-runtime-check');

const COMPOSITION_ID = 'GeneratedGraphicPreview';
const MODULE_DIR = 'mg-runtime-check';

export type RuntimeCheckInput = {
  id: string;
  code: string;
  sha256: string;
  placement: GeneratedGraphicPlacement;
  props: Record<string, unknown>;
  durationSeconds: number;
  captionBottomFrac?: number;
  /** Where to keep the rendered still (optional; a temp file otherwise). */
  stillPath?: string;
};

export type RuntimeCheckResult = {ok: boolean; errors: string[]; frame: number; ms: number; stillPath: string | null};

/** Renders one frame of a compiled graphic; never throws for graphic failures. */
export type RuntimeChecker = (input: RuntimeCheckInput) => Promise<RuntimeCheckResult>;

let serveUrl: Promise<string> | null = null;
let browser: Promise<HeadlessBrowser> | null = null;

/** Mirrors the alias in remotion/remotion.config.ts, which only the CLI reads. */
function captionsThemesAlias(): string {
  const requireFromRemotion = createRequire(path.join(motionToolkitRoot, 'package.json'));
  return path.dirname(requireFromRemotion.resolve('remotion-captions-themes/package.json'));
}

function bundleOnce(): Promise<string> {
  serveUrl ??= (async () => {
    const started = Date.now();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mg-runtime-bundle-'));
    const url = await bundle({
      entryPoint: path.join(motionToolkitRoot, 'src/index.ts'),
      outDir,
      publicDir: path.join(motionToolkitRoot, 'public'),
      webpackOverride: config => ({
        ...config,
        resolve: {...config.resolve, alias: {...config.resolve?.alias, 'remotion-captions-themes': captionsThemesAlias()}},
      }),
    });
    log.info({ms: Date.now() - started, outDir}, 'runtime-check bundle ready');
    return url;
  })().catch(error => {
    serveUrl = null;
    throw error;
  });
  return serveUrl;
}

function browserOnce(): Promise<HeadlessBrowser> {
  browser ??= openBrowser('chrome', {logLevel: 'error'}).catch(error => {
    browser = null;
    throw error;
  });
  return browser;
}

/** Closes the shared browser (scripts call this before exiting). */
export async function closeRuntimeCheck(): Promise<void> {
  const open = browser;
  browser = null;
  if (open) {
    await (await open).close({silent: true}).catch(() => undefined);
  }
}

/** Trims Remotion/Chromium errors to what helps a repair: message + the first frames. */
function cleanError(error: unknown): string {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  const lines = [...new Set(text.split('\n').map(line => line.trimEnd()).filter(Boolean))];
  return lines.slice(0, 12).join('\n').slice(0, 2000);
}

export const remotionRuntimeCheck: RuntimeChecker = async input => {
  const started = Date.now();
  const durationInFrames = Math.max(1, Math.round(input.durationSeconds * 30));
  // Late enough that entrances have played, early enough to precede exits.
  const frame = Math.min(durationInFrames - 1, Math.round(durationInFrames * 0.7));
  const browserErrors: string[] = [];
  const stillPath = input.stillPath ?? path.join(os.tmpdir(), `mg-still-${input.sha256.slice(0, 16)}.png`);
  try {
    const url = await bundleOnce();
    const moduleDir = path.join(url, 'public', MODULE_DIR);
    await fs.mkdir(moduleDir, {recursive: true});
    await fs.writeFile(path.join(moduleDir, `${input.sha256}.js`), input.code);
    const inputProps = {
      graphic: {
        id: input.id,
        start: 0,
        end: input.durationSeconds,
        placement: input.placement,
        module: {url: `staticFile:${MODULE_DIR}/${input.sha256}.js`, sha256: input.sha256},
        props: input.props,
      },
      captionBottomFrac: input.captionBottomFrac ?? 0.16,
    };
    const puppeteerInstance = await browserOnce();
    const composition = await selectComposition({serveUrl: url, id: COMPOSITION_ID, inputProps, puppeteerInstance, logLevel: 'error'});
    await fs.mkdir(path.dirname(stillPath), {recursive: true});
    await renderStill({
      composition,
      serveUrl: url,
      output: stillPath,
      frame,
      inputProps,
      imageFormat: 'png',
      scale: 0.5,
      puppeteerInstance,
      timeoutInMilliseconds: 45_000,
      logLevel: 'error',
      onBrowserLog: entry => {
        if (entry.type === 'error') {
          browserErrors.push(entry.text);
        }
      },
    });
    return {ok: true, errors: [], frame, ms: Date.now() - started, stillPath};
  } catch (error) {
    const errors = [cleanError(error), ...browserErrors.slice(0, 3).map(text => `browser console: ${text.slice(0, 500)}`)];
    log.warn({id: input.id, frame, error: errors[0]?.split('\n')[0]}, 'graphic failed the one-frame render');
    return {ok: false, errors, frame, ms: Date.now() - started, stillPath: null};
  }
};
