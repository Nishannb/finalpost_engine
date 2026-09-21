/**
 * Stage C.4 — resolve a keyword to a copyright-free Pexels clip.
 *
 * File selection is deliberately biased toward the smallest acceptable render:
 * Remotion Lambda downloads every overlay before it can draw a frame, so a 4K
 * file would add seconds of cold-start per clip for no visible gain at 1080x1920.
 */

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {keywordFallbacks} from './visualQuery.ts';
import {
  STOCK_MIN_WIDTH,
  pickRenderSizedFile,
  stockAssetKey,
  type StockAsset,
} from './stockTypes.ts';

export {keywordFallbacks} from './visualQuery.ts';
/** @deprecated Prefer StockAsset — kept as alias for older call sites. */
export type PexelsAsset = StockAsset;

const log = stageLogger('stage-c-pexels');

const PEXELS_VIDEO_SEARCH_URL = 'https://api.pexels.com/videos/search';
const PEXELS_PHOTO_SEARCH_URL = 'https://api.pexels.com/v1/search';

/** Overlays are drawn on a 1080-wide canvas; anything past this is waste. */
const MIN_WIDTH = STOCK_MIN_WIDTH;

type PexelsVideoFile = {
  id?: number;
  quality?: string;
  file_type?: string;
  width?: number;
  height?: number;
  link?: string;
};

type PexelsVideo = {
  id?: number;
  duration?: number;
  user?: {name?: string; url?: string};
  url?: string;
  video_files?: PexelsVideoFile[];
};

export function pexelsConfigured(): boolean {
  return Boolean(env.PEXELS_API_KEY);
}

export async function findBRollAsset(
  keyword: string,
  options: {
    minDurationSec: number;
    excludeKeys?: Set<string>;
    /** @deprecated use excludeKeys */
    excludeIds?: Set<number>;
  },
): Promise<StockAsset | null> {
  const listed = await listPexelsVideos(keyword, {...options, limit: 1});
  return listed[0] ?? null;
}

export async function listPexelsVideos(
  keyword: string,
  options: {
    minDurationSec: number;
    excludeKeys?: Set<string>;
    excludeIds?: Set<number>;
    limit?: number;
  },
): Promise<StockAsset[]> {
  if (!pexelsConfigured()) {
    throw new EngineError(
      'not_configured',
      'B-roll library is not configured (PEXELS_API_KEY missing)',
    );
  }

  const limit = Math.max(1, Math.min(options.limit ?? 4, 6));
  const found: StockAsset[] = [];
  for (const queryKeyword of keywordFallbacks(keyword)) {
    for (const orientation of ['portrait', 'landscape', ''] as const) {
      const batch = await searchVideos(queryKeyword, {
        minDurationSec: options.minDurationSec,
        excludeKeys: options.excludeKeys,
        excludeIds: options.excludeIds,
        orientation,
        limit: limit - found.length,
      });
      for (const asset of batch) {
        if (found.some(row => row.providerId === asset.providerId)) {
          continue;
        }
        found.push(asset);
        if (found.length >= limit) {
          return found;
        }
      }
    }
  }
  return found;
}

export async function findPhotoAsset(
  keyword: string,
  options: {
    excludeKeys?: Set<string>;
    excludeIds?: Set<number>;
    orientation?: 'portrait' | 'landscape';
  } = {},
): Promise<StockAsset | null> {
  if (!pexelsConfigured()) {
    throw new EngineError(
      'not_configured',
      'B-roll library is not configured (PEXELS_API_KEY missing)',
    );
  }

  for (const queryKeyword of keywordFallbacks(keyword)) {
    const orientations: Array<'portrait' | 'landscape' | ''> = options.orientation
      ? [options.orientation, '']
      : ['portrait', 'landscape', ''];
    for (const orientation of orientations) {
      const asset = await searchPhotos(queryKeyword, {
        excludeKeys: options.excludeKeys,
        excludeIds: options.excludeIds,
        orientation,
      });
      if (asset) {
        return asset;
      }
    }
  }
  return null;
}

async function searchVideos(
  keyword: string,
  options: {
    minDurationSec: number;
    excludeKeys?: Set<string>;
    excludeIds?: Set<number>;
    orientation: 'portrait' | 'landscape' | '';
    limit?: number;
  },
): Promise<StockAsset[]> {
  const query = new URLSearchParams({
    query: keyword,
    per_page: '8',
    size: 'medium',
  });
  if (options.orientation) {
    query.set('orientation', options.orientation);
  }

  const body = await requestJson<{videos?: PexelsVideo[]}>(
    `${PEXELS_VIDEO_SEARCH_URL}?${query.toString()}`,
    {
      label: `Pexels video "${keyword}"`,
      failureCode: 'broll_failed',
      timeoutMs: 20_000,
      retries: 2,
      headers: {Authorization: env.PEXELS_API_KEY},
    },
  );

  const videos = (body.videos ?? []).filter(video => {
    const id = Number(video.id);
    if (!Number.isFinite(id)) {
      return false;
    }
    if (options.excludeKeys?.has(stockAssetKey('pexels', id))) {
      return false;
    }
    if (options.excludeIds?.has(id)) {
      return false;
    }
    return Number(video.duration ?? 0) >= options.minDurationSec;
  });

  const limit = Math.max(1, options.limit ?? 1);
  const found: StockAsset[] = [];
  for (const video of videos) {
    const file = pickFile(video.video_files ?? []);
    if (!file?.link) {
      continue;
    }
    log.debug({keyword, providerId: video.id, width: file.width}, 'b-roll video resolved');
    found.push({
      assetUrl: file.link,
      provider: 'pexels',
      providerId: Number(video.id),
      width: Number(file.width ?? 0),
      height: Number(file.height ?? 0),
      durationSec: Number(video.duration ?? 0),
      credit: String(video.user?.name ?? 'Pexels'),
      creditUrl: String(video.user?.url ?? video.url ?? 'https://www.pexels.com'),
    });
    if (found.length >= limit) {
      break;
    }
  }

  return found;
}

type PexelsPhoto = {
  id?: number;
  photographer?: string;
  photographer_url?: string;
  url?: string;
  src?: {
    original?: string;
    large2x?: string;
    large?: string;
    medium?: string;
    portrait?: string;
    landscape?: string;
  };
};

async function searchPhotos(
  keyword: string,
  options: {
    excludeKeys?: Set<string>;
    excludeIds?: Set<number>;
    orientation: 'portrait' | 'landscape' | '';
  },
): Promise<StockAsset | null> {
  const query = new URLSearchParams({
    query: keyword,
    per_page: '8',
  });
  if (options.orientation) {
    query.set('orientation', options.orientation);
  }

  const body = await requestJson<{photos?: PexelsPhoto[]}>(
    `${PEXELS_PHOTO_SEARCH_URL}?${query.toString()}`,
    {
      label: `Pexels photo "${keyword}"`,
      failureCode: 'broll_failed',
      timeoutMs: 20_000,
      retries: 2,
      headers: {Authorization: env.PEXELS_API_KEY},
    },
  );

  for (const photo of body.photos ?? []) {
    const id = Number(photo.id);
    if (!Number.isFinite(id)) {
      continue;
    }
    if (options.excludeKeys?.has(stockAssetKey('pexels', id))) {
      continue;
    }
    if (options.excludeIds?.has(id)) {
      continue;
    }
    const src = photo.src ?? {};
    const assetUrl =
      (options.orientation === 'landscape' ? src.landscape : src.portrait) ||
      src.large2x ||
      src.large ||
      src.medium ||
      src.original;
    if (!assetUrl) {
      continue;
    }
    log.debug({keyword, providerId: id}, 'b-roll photo resolved');
    return {
      assetUrl,
      provider: 'pexels',
      providerId: id,
      width: options.orientation === 'landscape' ? 1280 : 1080,
      height: options.orientation === 'landscape' ? 720 : 1620,
      durationSec: 0,
      credit: String(photo.photographer ?? 'Pexels'),
      creditUrl: String(photo.photographer_url ?? photo.url ?? 'https://www.pexels.com'),
    };
  }
  return null;
}

export function pickFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4s = files.filter(
    file => file.link && (file.file_type ?? '').includes('mp4'),
  );
  if (mp4s.length === 0) {
    return null;
  }
  const usable = mp4s.filter(file => Number(file.width ?? 0) >= MIN_WIDTH);
  const pool = usable.length > 0 ? usable : mp4s;
  return pickRenderSizedFile(pool);
}
