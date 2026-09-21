import {describe, expect, it} from 'vitest';

import {pickRenderSizedFile} from './stockTypes.ts';

describe('pickRenderSizedFile', () => {
  it('prefers portrait 1080 over 1440 UHD', () => {
    const picked = pickRenderSizedFile([
      {id: 'uhd', width: 1440, height: 2560},
      {id: 'hd', width: 1080, height: 1920},
      {id: 'sd', width: 720, height: 1280},
    ]);
    expect(picked?.id).toBe('hd');
  });

  it('falls back to the least-oversize file when every option is UHD', () => {
    const picked = pickRenderSizedFile([
      {id: '4k', width: 2160, height: 3840},
      {id: 'uhd', width: 1440, height: 2560},
    ]);
    expect(picked?.id).toBe('uhd');
  });
});
