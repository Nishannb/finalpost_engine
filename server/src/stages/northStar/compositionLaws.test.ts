import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {enforceCompositionLaws} from './compositionLaws.ts';

describe('north-star composition laws', () => {
  it('does not move type away from the directed slot', () => {
    const occupancy = occupancyFromSpeaker(
      {x: 0.02, y: 0.04, w: 0.45, h: 0.62},
      'vision',
    );
    const result = enforceCompositionLaws({
      hookTitle: 'THE REAL REASON',
      hookAnchor: 'top_left',
      hookDurationSec: 2.5,
      occupancySlices: [{atSec: 1, occupancy}],
      fallbackOccupancy: occupancy,
      overlays: [],
      motionGraphics: [
        {
          start: 3,
          end: 6,
          text: 'A BETTER SYSTEM',
          role: 'primary',
          shape: 'block',
          accentColor: '#FACC15',
          textColor: '#111111',
          anchor: 'top_left',
          entrance: 'type_stagger',
          exit: 'fade',
          fontScale: 1,
          italic: false,
        },
      ],
      semanticEmphasis: [],
    });

    expect(result.hookAnchor).toBe('top_left');
    expect(result.motionGraphics[0]?.anchor).toBe('top_left');
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.coercions).toEqual([]);
  });

  it('keeps supporting motion during a hero cutaway', () => {
    const occupancy = occupancyFromSpeaker(
      {x: 0.2, y: 0.16, w: 0.42, h: 0.5},
      'vision',
    );
    const result = enforceCompositionLaws({
      hookTitle: '',
      hookAnchor: 'top_right',
      hookDurationSec: 0,
      occupancySlices: [{atSec: 4, occupancy}],
      fallbackOccupancy: occupancy,
      overlays: [
        {
          start: 3,
          end: 7,
          layout: 'cutaway',
          mediaKind: 'video',
          anchor: 'top',
          keyword: 'relevant action',
          overlayText: '',
          assetUrl: 'https://example.com/clip.mp4',
          provider: 'pexels',
          providerId: 1,
          width: 1080,
          height: 1920,
          credit: '',
          creditUrl: '',
          accentColor: '#FFFFFF',
          textStyle: 'outline',
          visualWeight: 'hero',
        },
      ],
      motionGraphics: [
        {
          start: 4,
          end: 6,
          text: 'COMPETING HERO',
          role: 'primary',
          shape: 'block',
          accentColor: '#FACC15',
          textColor: '#111111',
          anchor: 'top_right',
          entrance: 'type_stagger',
          exit: 'fade',
          fontScale: 1,
          italic: false,
        },
      ],
      semanticEmphasis: [],
    });

    expect(result.motionGraphics).toHaveLength(1);
    expect(result.drops.some(value => value.includes('competing_hero'))).toBe(false);
  });

  it('does not relocate type when occupancy is only a guessed fallback box', () => {
    const occupancy = occupancyFromSpeaker(
      {x: 0.18, y: 0.16, w: 0.64, h: 0.62},
      'fallback',
    );
    const result = enforceCompositionLaws({
      hookTitle: '1 Million Community',
      hookAnchor: 'top_left',
      hookDurationSec: 2.5,
      occupancySlices: [{atSec: 1, occupancy}],
      fallbackOccupancy: occupancy,
      overlays: [],
      motionGraphics: [
        {
          start: 3,
          end: 6,
          text: 'MINDSET PLUS MICRO ACTIONS',
          role: 'primary',
          shape: 'block',
          accentColor: '#FACC15',
          textColor: '#111111',
          anchor: 'top_left',
          entrance: 'type_stagger',
          exit: 'fade',
          fontScale: 1,
          italic: false,
        },
      ],
      semanticEmphasis: [],
    });

    expect(result.hookTitle).toMatch(/Million/i);
    expect(result.motionGraphics).toHaveLength(1);
    expect(result.hookAnchor).toBe('top_left');
    expect(result.motionGraphics[0]?.anchor).toBe('top_left');
    expect(result.drops.some(value => value.includes(':face'))).toBe(false);
  });
});
