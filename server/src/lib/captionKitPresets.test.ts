import {describe, expect, it} from 'vitest';

import {
  captionKitPresetIds,
  isCaptionKitPresetId,
  loadCaptionKitPresets,
} from './captionKitPresets.ts';

describe('captionKit presets', () => {
  it('loads spotlight and rejects unknown ids', () => {
    const ids = captionKitPresetIds();
    expect(ids.has('spotlight')).toBe(true);
    expect(isCaptionKitPresetId('spotlight')).toBe(true);
    expect(isCaptionKitPresetId('not-a-real-preset')).toBe(false);
    expect(loadCaptionKitPresets().length).toBeGreaterThan(70);
  });
});
