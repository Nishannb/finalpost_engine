import {describe, expect, it} from 'vitest';

import {parseAssetInsight} from './userBrollDescribe.ts';

describe('parseAssetInsight', () => {
  it('reads document kind and text regions', () => {
    const parsed = parseAssetInsight(
      '{"kind":"document","description":"Wikipedia article on rhabdomyolysis","regions":[{"label":"rapid dissolution of damaged skeletal muscle","x":0.08,"y":0.3,"w":0.84,"h":0.12}]}',
      {durationSec: 0, isImage: true},
    );
    expect(parsed.kind).toBe('document');
    expect(parsed.regions[0]?.label).toMatch(/dissolution/);
    expect(parsed.regions[0]?.w).toBeGreaterThan(0.5);
  });
});
