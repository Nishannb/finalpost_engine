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

/** Remotion canvas is 1080×1920. Never prefer UHD when a 1080 file exists. */
export const STOCK_MIN_WIDTH = 640;
export const STOCK_MAX_SHORT_EDGE = 1080;
export const STOCK_MAX_LONG_EDGE = 1920;

/**
 * Pick the largest file that still fits the short-form canvas.
 * Portrait 1440×2560 is closer to "1280 wide" than 1080×1920 is, so a
 * nearest-to-1280 sort systematically chose UHD and blew the compositor cache.
 */
export function pickRenderSizedFile<T extends {width?: number; height?: number}>(
  files: T[],
): T | null {
  if (files.length === 0) {
    return null;
  }
  const ranked = [...files].sort(
    (a, b) => renderSizeScore(b) - renderSizeScore(a),
  );
  return ranked[0] ?? null;
}

export function renderSizeScore(file: {width?: number; height?: number}): number {
  const width = Math.max(0, Number(file.width ?? 0));
  const height = Math.max(0, Number(file.height ?? 0) || width);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const fits =
    shortEdge <= STOCK_MAX_SHORT_EDGE && longEdge <= STOCK_MAX_LONG_EDGE;
  if (fits) {
    return 1_000_000 + shortEdge * longEdge;
  }
  const overshoot =
    Math.max(0, shortEdge - STOCK_MAX_SHORT_EDGE) +
    Math.max(0, longEdge - STOCK_MAX_LONG_EDGE);
  return -overshoot;
}
