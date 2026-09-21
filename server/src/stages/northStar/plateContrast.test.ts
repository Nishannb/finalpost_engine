import {describe, expect, it} from 'vitest';

import {readableOnPlate, contrastCaptionForEdit} from './plateContrast.ts';
import type {CaptionDirection, VisualOverlay} from '../../types/blueprint.ts';

const caption: CaptionDirection = {
  position: 'bottom',
  bottomFrac: 0.22,
  textColor: '#FFFFFF',
  highlightColor: '#22D3EE',
  boxColor: null,
  template: 'clean',
};

describe('plateContrast', () => {
  it('darkens type on a bright plate', () => {
    expect(
      readableOnPlate('#FFFFFF', {r: 0.92, g: 0.91, b: 0.88, luminance: 0.9}),
    ).toBe('#121212');
  });

  it('keeps captions on the related plate when the split speaker is on top', () => {
    const overlay = {
      start: 4,
      end: 12,
      layout: 'split',
      mediaKind: 'video',
      anchor: 'top',
      keyword: 'airport',
      overlayText: 'inspiration and action',
      assetUrl: 'https://example.com/floor.mp4',
      provider: 'pexels',
      providerId: 1,
      width: 1080,
      height: 1920,
      credit: '',
      creditUrl: '',
      accentColor: '#22D3EE',
      textStyle: 'outline',
      speakerSide: 'top',
    } as VisualOverlay;
    const out = contrastCaptionForEdit({
      caption,
      splits: [overlay],
      speakerPalette: {r: 0.3, g: 0.25, b: 0.2, luminance: 0.26},
      plateByUrl: new Map([
        ['https://example.com/floor.mp4', {r: 0.9, g: 0.9, b: 0.88, luminance: 0.9}],
      ]),
    });
    expect(out.position).toBe('bottom');
    expect(out.bottomFrac).toBeLessThanOrEqual(0.18);
    expect(out.textColor).not.toBe('#FFFFFF');
    expect(out.boxColor).toBe('rgba(255,255,255,0.86)');
  });
});
