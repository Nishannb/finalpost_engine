import {describe, expect, it} from 'vitest';

import {pickVideoFile} from './pixabayClient.ts';
import {stockAssetKey} from './stockTypes.ts';

describe('pixabayClient', () => {
  it('namespaces ids so pexels and pixabay cannot collide', () => {
    expect(stockAssetKey('pexels', 42)).toBe('pexels:42');
    expect(stockAssetKey('pixabay', 42)).toBe('pixabay:42');
  });

  it('picks the largest file that still fits 1080x1920, not UHD', () => {
    const file = pickVideoFile({
      large: {url: 'https://cdn/large.mp4', width: 3840, height: 2160},
      medium: {url: 'https://cdn/medium.mp4', width: 1280, height: 720},
      small: {url: 'https://cdn/small.mp4', width: 640, height: 360},
      tiny: {url: 'https://cdn/tiny.mp4', width: 480, height: 270},
    });
    expect(file?.url).toBe('https://cdn/medium.mp4');
  });
});
