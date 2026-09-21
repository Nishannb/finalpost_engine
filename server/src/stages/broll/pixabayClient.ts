/**
 * Pixabay video/photo search — second stock library beside Pexels.
 *
 * Docs: https://pixabay.com/api/docs/
 * Videos may be used directly; we still prefetch into Remotion public/ like Pexels.
 */

import {env} from '../../config/env.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import {keywordFallbacks} from './visualQuery.ts';
import {
  STOCK_MIN_WIDTH,
  pickRenderSizedFile,
  stockAssetKey,
  type StockAsset,
} from './stockTypes.ts';

const log = stageLogger('stage-c-pixabay');

const PIXABAY_VIDEO_URL = 'https://pixabay.com/api/videos/';
const PIXABAY_IMAGE_URL = 'https://pixabay.com/api/';

const MIN_WIDTH = STOCK_MIN_WIDTH;

type PixabayVideoSize = {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
};

type PixabayVideoHit = {
  id?: number;
  pageURL?: string;
  duration?: number;
  user?: string;
  user_id?: number;
  videos?: {
    large?: PixabayVideoSize;
    medium?: PixabayVideoSize;
    small?: PixabayVideoSize;
    tiny?: PixabayVideoSize;
  };
};

type PixabayImageHit = {
  id?: number;
  pageURL?: string;
  user?: string;
  user_id?: number;
  largeImageURL?: string;
  webformatURL?: string;
  imageWidth?: number;
  imageHeight?: number;
};

export function pixabayConfigured(): boolean {
  return Boolean(env.PIXABAY_API_KEY);
}

export async function findPixabayVideo(
  keyword: string,
  options: {minDurationSec: number; excludeKeys?: Set<string>},
): Promise<StockAsset | null> {
  if (!pixabayConfigured()) {
    return null;
  }

  for (const queryKeyword of keywordFallbacks(keyword)) {
    const asset = await searchVideos(queryKeyword, options);
    if (asset) {
      return asset;
    }
  }
  return null;
}

export async function findPixabayPhoto(
  keyword: string,
  options: {
    excludeKeys?: Set<string>;
    orientation?: 'portrait' | 'landscape';
  } = {},
): Promise<StockAsset | null> {
  if (!pixabayConfigured()) {
    return null;
  }

  for (const queryKeyword of keywordFallbacks(keyword)) {
    const asset = await searchPhotos(queryKeyword, options);
    if (asset) {
      return asset;
    }
  }
  return null;
}

async function searchVideos(
  keyword: string,
  options: {minDurationSec: number; excludeKeys?: Set<string>},
): Promise<StockAsset | null> {
  const query = new URLSearchParams({
    key: env.PIXABAY_API_KEY,
    q: keyword.slice(0, 100),
    video_type: 'film',
    safesearch: 'true',
    per_page: '12',
    min_width: String(MIN_WIDTH),
  });

  const body = await requestJson<{hits?: PixabayVideoHit[]}>(
    `${PIXABAY_VIDEO_URL}?${query.toString()}`,
    {
      label: `Pixabay video "${keyword}"`,
      failureCode: 'broll_failed',
      timeoutMs: 20_000,
      retries: 2,
    },
  );

  const hits = (body.hits ?? []).filter(hit => {
    const id = Number(hit.id);
    if (!Number.isFinite(id)) {
      return false;
    }
    if (options.excludeKeys?.has(stockAssetKey('pixabay', id))) {
      return false;
    }
    return Number(hit.duration ?? 0) >= options.minDurationSec;
  });

  // Prefer portrait when available, then any usable medium/small file.
  const ranked = [
    ...hits.filter(hit => isPortraitHit(hit)),
    ...hits.filter(hit => !isPortraitHit(hit)),
  ];

  for (const hit of ranked) {
    const file = pickVideoFile(hit.videos);
    if (!file?.url) {
      continue;
    }
    const id = Number(hit.id);
    log.debug({keyword, providerId: id, width: file.width}, 'pixabay video resolved');
    return {
      assetUrl: file.url,
      provider: 'pixabay',
      providerId: id,
      width: Number(file.width ?? 0),
      height: Number(file.height ?? 0),
      durationSec: Number(hit.duration ?? 0),
      credit: String(hit.user ?? 'Pixabay'),
      creditUrl: pixabayUserUrl(hit.user, hit.user_id) || String(hit.pageURL ?? 'https://pixabay.com'),
    };
  }

  return null;
}

async function searchPhotos(
  keyword: string,
  options: {
    excludeKeys?: Set<string>;
    orientation?: 'portrait' | 'landscape';
  },
): Promise<StockAsset | null> {
  const query = new URLSearchParams({
    key: env.PIXABAY_API_KEY,
    q: keyword.slice(0, 100),
    image_type: 'photo',
    safesearch: 'true',
    per_page: '12',
    min_width: String(MIN_WIDTH),
  });
  if (options.orientation === 'portrait') {
    query.set('orientation', 'vertical');
  } else if (options.orientation === 'landscape') {
    query.set('orientation', 'horizontal');
  }

  const body = await requestJson<{hits?: PixabayImageHit[]}>(
    `${PIXABAY_IMAGE_URL}?${query.toString()}`,
    {
      label: `Pixabay photo "${keyword}"`,
      failureCode: 'broll_failed',
      timeoutMs: 20_000,
      retries: 2,
    },
  );

  for (const hit of body.hits ?? []) {
    const id = Number(hit.id);
    if (!Number.isFinite(id) || options.excludeKeys?.has(stockAssetKey('pixabay', id))) {
      continue;
    }
    const assetUrl = hit.largeImageURL || hit.webformatURL;
    if (!assetUrl) {
      continue;
    }
    log.debug({keyword, providerId: id}, 'pixabay photo resolved');
    return {
      assetUrl,
      provider: 'pixabay',
      providerId: id,
      width: Number(hit.imageWidth ?? (options.orientation === 'landscape' ? 1280 : 1080)),
      height: Number(hit.imageHeight ?? (options.orientation === 'landscape' ? 720 : 1620)),
      durationSec: 0,
      credit: String(hit.user ?? 'Pixabay'),
      creditUrl: pixabayUserUrl(hit.user, hit.user_id) || String(hit.pageURL ?? 'https://pixabay.com'),
    };
  }
  return null;
}

function isPortraitHit(hit: PixabayVideoHit): boolean {
  const file = pickVideoFile(hit.videos);
  if (!file) {
    return false;
  }
  return Number(file.height ?? 0) > Number(file.width ?? 0);
}

export function pickVideoFile(
  videos: PixabayVideoHit['videos'] | undefined,
): PixabayVideoSize | null {
  if (!videos) {
    return null;
  }
  const candidates = [videos.medium, videos.small, videos.large, videos.tiny].filter(
    (file): file is PixabayVideoSize => Boolean(file?.url),
  );
  if (candidates.length === 0) {
    return null;
  }
  const usable = candidates.filter(file => Number(file.width ?? 0) >= MIN_WIDTH);
  const pool = usable.length > 0 ? usable : candidates;
  return pickRenderSizedFile(pool);
}

function pixabayUserUrl(user: string | undefined, userId: number | undefined): string {
  if (!user || !Number.isFinite(Number(userId))) {
    return '';
  }
  return `https://pixabay.com/users/${encodeURIComponent(user)}-${userId}/`;
}
