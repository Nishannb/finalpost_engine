import {describe, expect, it} from 'vitest';

import {resolveSoundHits} from './soundHits.ts';

describe('soundHits', () => {
  it('does not add sound merely because a split enters', () => {
    const hits = resolveSoundHits({
      overlays: [
        {
          start: 6.2,
          end: 12,
          layout: 'split',
          mediaKind: 'video',
          anchor: 'top',
          keyword: 'airport',
          overlayText: '',
          assetUrl: 'https://example.com/a.mp4',
          provider: 'pexels',
          providerId: 1,
          width: 1080,
          height: 1920,
          credit: '',
          creditUrl: '',
          accentColor: '#fff',
          textStyle: 'outline',
        },
      ],
      motionGraphics: [],
      semanticEmphasis: [],
    });
    expect(hits).toEqual([]);
  });

  it('keeps a sparse director cue with a concrete intent', () => {
    const hits = resolveSoundHits({
      audio: {
        sfx: [
          {
            atWordId: 'w1',
            kind: 'hit',
            intent: 'punctuate the final numeric reveal',
          },
        ],
      },
      words: [
        {text: 'It', start: 0, end: 0.2, sentenceIndex: 0},
        {text: 'worked', start: 0.25, end: 0.7, sentenceIndex: 0},
      ],
      overlays: [],
      motionGraphics: [],
      semanticEmphasis: [],
    });
    expect(hits).toEqual([
      {
        at: 0.25,
        kind: 'hit',
        volume: 0.14,
        reason: 'punctuate the final numeric reveal',
      },
    ]);
  });
});
