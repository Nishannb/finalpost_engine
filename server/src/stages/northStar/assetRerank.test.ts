import {describe, expect, it} from 'vitest';

import {pickRankedAsset} from './assetRerank.ts';
import type {StockAsset} from '../broll/stockTypes.ts';

const asset = (partial: Partial<StockAsset>): StockAsset => ({
  assetUrl: 'https://example.com/a.mp4',
  provider: 'pexels',
  providerId: 1,
  width: 1920,
  height: 1080,
  durationSec: 8,
  credit: 't',
  creditUrl: 'https://pexels.com',
  ...partial,
});

describe('assetRerank', () => {
  it('prefers portrait clips that cover the hold', () => {
    const picked = pickRankedAsset(
      [
        asset({providerId: 1, width: 1920, height: 1080, durationSec: 12}),
        asset({providerId: 2, width: 1080, height: 1920, durationSec: 4}),
      ],
      {minDurationSec: 2.2},
    );
    expect(picked?.providerId).toBe(2);
  });
});
