/**
 * Pull every remote overlay onto disk before Remotion starts.
 *
 * OffthreadVideo lazy-fetches src when a Sequence begins. A Pexels CDN miss
 * around the 60% mark used to abort the whole burn with Remotion's
 * "Failed to fetch / disk space is low" wrapper. Serving files from
 * remotion/public/prefetch keeps Chrome on localhost instead of the internet.
 */

import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {EngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  copyLocalFile,
  downloadToFile,
  isLocalMediaPath,
} from '../../lib/tempFiles.ts';
import type {TimelineBlueprint, VisualOverlay} from '../../types/blueprint.ts';

const log = stageLogger('prefetch-assets');

const MAX_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 90_000;

const MEDIA_EXTS = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
]);

const TEXT_LAYOUTS = new Set<VisualOverlay['layout']>([
  'lockup',
  'stat',
  'banner',
  'chip',
]);

export function collectBlueprintMediaUrls(blueprint: TimelineBlueprint): string[] {
  const urls = new Set<string>();
  const add = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  };
  add(blueprint.videoUrl);
  for (const clip of blueprint.brollClips ?? []) {
    add(clip.assetUrl);
  }
  for (const overlay of blueprint.visualOverlays ?? []) {
    add(overlay.assetUrl);
  }
  for (const clip of blueprint.transitions ?? []) {
    add(clip.assetUrl);
  }
  return [...urls];
}

export function rewriteBlueprintMediaUrls(
  blueprint: TimelineBlueprint,
  urlMap: Map<string, string>,
): TimelineBlueprint {
  const swap = (value?: string): string => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      return '';
    }
    if (!urlMap.has(trimmed)) {
      return trimmed;
    }
    return urlMap.get(trimmed) ?? '';
  };

  const visualOverlays = (blueprint.visualOverlays ?? [])
    .map(overlay => ({...overlay, assetUrl: swap(overlay.assetUrl)}))
    .filter(overlay => overlayKeepsAfterPrefetch(overlay));

  return {
    ...blueprint,
    videoUrl: swap(blueprint.videoUrl),
    brollClips: (blueprint.brollClips ?? [])
      .map(clip => ({...clip, assetUrl: swap(clip.assetUrl)}))
      .filter(clip => Boolean(clip.assetUrl)),
    visualOverlays,
    transitions: (blueprint.transitions ?? [])
      .map(clip => ({...clip, assetUrl: swap(clip.assetUrl)}))
      .filter(clip => Boolean(clip.assetUrl)),
    stats: {
      ...blueprint.stats,
      brollClipCount: (blueprint.brollClips ?? []).filter(clip =>
        Boolean(swap(clip.assetUrl)),
      ).length,
      visualOverlayCount: visualOverlays.length,
      splitCount: visualOverlays.filter(overlay => overlay.layout === 'split').length,
      transitionCount: (blueprint.transitions ?? []).filter(clip =>
        Boolean(swap(clip.assetUrl)),
      ).length,
    },
  };
}

export async function prefetchBlueprintMedia(
  blueprint: TimelineBlueprint,
  cacheDir: string,
  publicPrefix: string,
): Promise<TimelineBlueprint> {
  await fs.mkdir(cacheDir, {recursive: true});
  const urlMap = new Map<string, string>();
  const urls = collectBlueprintMediaUrls(blueprint);
  log.info({count: urls.length}, 'prefetching media for remotion');

  for (const url of urls) {
    const name = hashedFileName(url);
    const dest = path.join(cacheDir, name);
    try {
      if (isLocalMediaPath(url)) {
        await copyLocalFile(url, dest, {maxBytes: MAX_BYTES});
      } else {
        await downloadToFile(url, dest, {
          maxBytes: MAX_BYTES,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
        });
      }
      urlMap.set(url, `${publicPrefix}/${name}`);
      log.info({name, bytesHint: url.slice(0, 96)}, 'prefetched');
    } catch (error) {
      urlMap.set(url, '');
      log.warn(
        {url: url.slice(0, 140), error: (error as Error).message},
        'prefetch failed, dropping asset',
      );
    }
  }

  const rewritten = rewriteBlueprintMediaUrls(blueprint, urlMap);
  if (!rewritten.videoUrl) {
    throw new EngineError(
      'render_failed',
      'Could not prefetch the talking-head video for Remotion',
    );
  }
  return rewritten;
}

function overlayKeepsAfterPrefetch(overlay: VisualOverlay): boolean {
  if (overlay.assetUrl) {
    return true;
  }
  if (overlay.mediaKind === 'text' || TEXT_LAYOUTS.has(overlay.layout)) {
    return true;
  }
  return false;
}

function hashedFileName(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  return `${hash}${extensionFor(url)}`;
}

function extensionFor(url: string): string {
  let pathname = url.split('?')[0] ?? url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Local paths and malformed URLs fall through to path.extname.
  }
  const ext = path.extname(pathname).toLowerCase();
  if (ext === '.jpeg') {
    return '.jpg';
  }
  if (MEDIA_EXTS.has(ext)) {
    return ext;
  }
  return '.bin';
}
