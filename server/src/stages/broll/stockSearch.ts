/**
 * Multi-library stock search: Pexels + Pixabay (more libraries later).
 *
 * Tries providers in a seeded order per query so results diversify across
 * sources instead of always draining Pexels first.
 */

import {stageLogger} from '../../lib/logger.ts';
import {findPhotoAsset as findPexelsPhoto, findBRollAsset as findPexelsVideo, listPexelsVideos, pexelsConfigured} from './pexelsClient.ts';
import {findPixabayPhoto, findPixabayVideo, pixabayConfigured} from './pixabayClient.ts';
import {
  stockAssetKeyOf,
  type StockAsset,
  type StockProvider,
} from './stockTypes.ts';

const log = stageLogger('stage-c-stock');

export function stockConfigured(): boolean {
  return pexelsConfigured() || pixabayConfigured();
}

export function configuredStockProviders(): StockProvider[] {
  const out: StockProvider[] = [];
  if (pexelsConfigured()) {
    out.push('pexels');
  }
  if (pixabayConfigured()) {
    out.push('pixabay');
  }
  return out;
}

export async function listBRollAssets(
  keyword: string,
  options: {minDurationSec: number; excludeKeys?: Set<string>; limit?: number},
): Promise<StockAsset[]> {
  if (pexelsConfigured()) {
    try {
      return await listPexelsVideos(keyword, options);
    } catch (error) {
      log.warn({error, keyword}, 'pexels list failed; falling back to first hit');
    }
  }
  const one = await findBRollAsset(keyword, options);
  return one ? [one] : [];
}

export async function findBRollAsset(
  keyword: string,
  options: {minDurationSec: number; excludeKeys?: Set<string>},
): Promise<StockAsset | null> {
  const providers = orderProviders(keyword, configuredStockProviders());
  if (providers.length === 0) {
    return null;
  }

  for (const provider of providers) {
    try {
      const asset =
        provider === 'pexels'
          ? await findPexelsVideo(keyword, {
              minDurationSec: options.minDurationSec,
              excludeKeys: options.excludeKeys,
            })
          : await findPixabayVideo(keyword, {
              minDurationSec: options.minDurationSec,
              excludeKeys: options.excludeKeys,
            });
      if (asset) {
        log.debug(
          {keyword, provider: asset.provider, providerId: asset.providerId},
          'stock video resolved',
        );
        return asset;
      }
    } catch (error) {
      log.warn({error, provider, keyword}, 'stock provider failed; trying next');
    }
  }
  return null;
}

export async function findPhotoAsset(
  keyword: string,
  options: {
    excludeKeys?: Set<string>;
    orientation?: 'portrait' | 'landscape';
  } = {},
): Promise<StockAsset | null> {
  const providers = orderProviders(keyword, configuredStockProviders());
  for (const provider of providers) {
    try {
      const asset =
        provider === 'pexels'
          ? await findPexelsPhoto(keyword, {
              excludeKeys: options.excludeKeys,
              orientation: options.orientation,
            })
          : await findPixabayPhoto(keyword, {
              excludeKeys: options.excludeKeys,
              orientation: options.orientation,
            });
      if (asset) {
        return asset;
      }
    } catch (error) {
      log.warn({error, provider, keyword}, 'stock photo provider failed; trying next');
    }
  }
  return null;
}

export {stockAssetKeyOf};

/** Stable per-query shuffle so the same keyword prefers one library, others rotate. */
function orderProviders(keyword: string, providers: StockProvider[]): StockProvider[] {
  if (providers.length <= 1) {
    return providers;
  }
  let hash = 0;
  for (let i = 0; i < keyword.length; i += 1) {
    hash = (hash * 31 + keyword.charCodeAt(i)) >>> 0;
  }
  const start = hash % providers.length;
  return [...providers.slice(start), ...providers.slice(0, start)];
}
