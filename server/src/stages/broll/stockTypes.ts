/**
 * Shared stock media types for Pexels, Pixabay, and future libraries.
 */

export const STOCK_PROVIDERS = ['pexels', 'pixabay'] as const;
export type StockProvider = (typeof STOCK_PROVIDERS)[number];

export type StockAsset = {
  assetUrl: string;
  provider: StockProvider;
  providerId: number;
  width: number;
  height: number;
  durationSec: number;
  credit: string;
  creditUrl: string;
};

/** Namespaced id so Pexels #42 and Pixabay #42 do not collide in exclude sets. */
export function stockAssetKey(provider: StockProvider, providerId: number): string {
  return `${provider}:${providerId}`;
}

export function stockAssetKeyOf(asset: Pick<StockAsset, 'provider' | 'providerId'>): string {
  return stockAssetKey(asset.provider, asset.providerId);
}
