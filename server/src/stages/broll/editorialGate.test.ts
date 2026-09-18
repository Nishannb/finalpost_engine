import {describe, expect, it} from 'vitest';

import {applyEditorialGate} from './editorialGate.ts';
import type {BRollClip, TransitionClip, VisualOverlay} from '../../types/blueprint.ts';

const clip = (start: number, end: number, keyword = 'woman hiking'): BRollClip => ({
  start,
  end,
  keyword,
  assetUrl: 'https://example.com/a.mp4',
  provider: 'pexels',
  providerId: Math.round(start * 100),
  width: 1080,
  height: 1920,
  credit: 't',
  creditUrl: 'https://pexels.com',
});

const overlay = (
  partial: Partial<VisualOverlay> & Pick<VisualOverlay, 'start' | 'end' | 'layout'>,
): VisualOverlay => ({
  mediaKind: 'video',
  anchor: 'top',
  keyword: 'woman walking',
  overlayText: '',
  assetUrl: 'https://example.com/b.mp4',
  provider: 'pexels',
  providerId: 1,
  width: 1080,
  height: 1920,
  credit: '',
  creditUrl: '',
  accentColor: '#FFFFFF',
  textStyle: 'outline',
  ...partial,
});

describe('applyEditorialGate', () => {
  it('drops image splits and keeps video splits', () => {
    const result = applyEditorialGate({
      clips: [clip(8, 10.5)],
      overlays: [
        overlay({
          start: 12,
          end: 14.5,
          layout: 'split',
          mediaKind: 'image',
          assetUrl: 'https://example.com/still.jpg',
        }),
        overlay({
          start: 20,
          end: 22.5,
          layout: 'split',
          mediaKind: 'video',
          assetUrl: 'https://example.com/move.mp4',
        }),
      ],
      transitions: [],
      zooms: [],
      outputDurationSec: 40,
    });
    expect(result.overlays).toHaveLength(1);
    expect(result.overlays[0]?.mediaKind).toBe('video');
    expect(result.warnings).toContain('split_dropped_non_video');
  });

  it('spaces cutaways and drops low-value stickers', () => {
    const transitions: TransitionClip[] = [
      {
        at: 8,
        duration: 0.3,
        keyword: 'light',
        assetUrl: '',
        blend: 'screen',
        provider: 'generated',
        providerId: 0,
        width: 1080,
        height: 1920,
        credit: '',
        creditUrl: '',
      },
    ];
    const result = applyEditorialGate({
      clips: [clip(8, 10.4), clip(10.8, 13)],
      overlays: [
        overlay({start: 15, end: 17, layout: 'sticker', mediaKind: 'image'}),
        overlay({
          start: 18,
          end: 20.5,
          layout: 'lockup',
          mediaKind: 'text',
          textStyle: 'stack',
          overlayText: 'From Dreaming To Doing',
          assetUrl: '',
        }),
      ],
      transitions,
      zooms: [
        {timestamp: 9, durationSec: 1.5},
        {timestamp: 10, durationSec: 1.5},
      ],
      outputDurationSec: 40,
    });
    expect(result.clips.length).toBe(1);
    expect(result.overlays.every(item => item.layout !== 'sticker')).toBe(true);
    expect(result.zooms.length).toBeLessThanOrEqual(1);
  });
});
