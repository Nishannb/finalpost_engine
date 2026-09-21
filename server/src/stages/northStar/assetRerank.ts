/**
 * Prefer a stock clip that will sit well on a 9:16 talking-head edit.
 * Ranking is local (no extra LLM): portrait, duration fit, not a tiny file.
 */

import type {StockAsset} from '../broll/stockTypes.ts';

export function rankStockAssets(
  assets: StockAsset[],
  options: {minDurationSec: number},
): StockAsset[] {
  return [...assets].sort((a, b) => score(b, options) - score(a, options));
}

export function pickRankedAsset(
  assets: StockAsset[],
  options: {minDurationSec: number},
): StockAsset | null {
  return rankStockAssets(assets, options)[0] ?? null;
}

export function scoreStockAsset(
  asset: StockAsset,
  options: {minDurationSec: number},
): number {
  return score(asset, options);
}

function score(asset: StockAsset, options: {minDurationSec: number}): number {
  let value = 0;
  const portrait = asset.height >= asset.width * 1.2;
  const landscape = asset.width > asset.height;
  if (portrait) {
    value += 40;
  } else if (!landscape) {
    value += 10;
  }
  if (asset.durationSec <= 0) {
    value += 8;
  } else if (asset.durationSec + 0.05 >= options.minDurationSec) {
    const extra = Math.abs(asset.durationSec - Math.max(options.minDurationSec, 3));
    value += Math.max(0, 24 - extra * 2);
  } else {
    value -= 12;
  }
  if (asset.width >= 720) {
    value += 6;
  }
  return value;
}
