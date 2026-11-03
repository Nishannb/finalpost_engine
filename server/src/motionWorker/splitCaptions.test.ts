/**
 * Caption / generated-split regression: a bottom-half generated graphic must
 * keep (nearly) its whole panel, with captions docked above the seam, while
 * every other layout keeps the exact caption placement it had before.
 */

import {describe, expect, it} from 'vitest';

import {
  captionBandFor,
  captionsForGeneratedSplit,
  regionFor,
  safeAreaFor,
} from '../../../remotion/src/generated/placement.ts';

const W = 1080;
const H = 1920;
const defaultCaptions = {position: 'bottom' as const, bottomFrac: 0.16, frameTopFrac: 0, frameHeightFrac: 1};
const split = (graphicSide: 'top' | 'bottom') =>
  ({id: 's', start: 0, end: 3, placement: {mode: 'split_screen', graphicSide}, module: {url: 'x', sha256: '0'.repeat(64)}, props: {}}) as never;

const usableHeight = (graphicSide: 'top' | 'bottom', layout = defaultCaptions) => {
  const region = regionFor({mode: 'split_screen', graphicSide}, W, H);
  const {band} = captionsForGeneratedSplit(layout, split(graphicSide), H);
  const safe = safeAreaFor(region, H, band);
  return {region, band, safe, fraction: (region.height - safe.top - safe.bottom) / region.height};
};

describe('captions during a generated split', () => {
  it('docks bottom captions above the seam so a bottom graphic keeps its panel', () => {
    const {layout, band} = captionsForGeneratedSplit(defaultCaptions, split('bottom'), H);
    expect(layout).toMatchObject({position: 'bottom', frameTopFrac: 0, frameHeightFrac: 0.5});
    expect(band.bottom).toBeLessThanOrEqual(H / 2);
    const bottom = usableHeight('bottom');
    expect(bottom.fraction).toBeGreaterThan(0.75);
    // Before docking the same panel kept only ~38% for content.
    const undocked = safeAreaFor(bottom.region, H, captionBandFor('bottom', 0.16, H));
    expect((bottom.region.height - undocked.top - undocked.bottom) / bottom.region.height).toBeLessThan(0.4);
  });

  it('docks centre and lower-third captions too, but leaves top captions alone', () => {
    for (const position of ['center', 'lower_third'] as const) {
      expect(usableHeight('bottom', {...defaultCaptions, position}).fraction).toBeGreaterThan(0.75);
    }
    const top = {...defaultCaptions, position: 'top' as const};
    expect(captionsForGeneratedSplit(top, split('bottom'), H).layout).toBe(top);
  });

  it('drops captions below the face during a top split, and changes nothing without a split', () => {
    const {layout, band} = captionsForGeneratedSplit(defaultCaptions, split('top'), H);
    expect(layout).toMatchObject({position: 'bottom', bottomFrac: 0.08, frameTopFrac: 0, frameHeightFrac: 1});
    expect(band.top).toBeGreaterThan(H / 2);
    expect(usableHeight('top').fraction).toBeGreaterThan(0.75);
    const top = {...defaultCaptions, position: 'top' as const};
    expect(captionsForGeneratedSplit(top, split('top'), H).layout).toBe(top);
    expect(captionsForGeneratedSplit(defaultCaptions, undefined, H)).toEqual({
      layout: defaultCaptions,
      band: captionBandFor('bottom', 0.16, H),
    });
  });
});
