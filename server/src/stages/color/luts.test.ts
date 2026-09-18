import {describe, expect, it} from 'vitest';

import {listAvailableLuts, normalizeLutId, resolveLutPath} from './luts.ts';

describe('luts', () => {
  it('lists shipped cube files and resolves CELLULOID', () => {
    const available = listAvailableLuts();
    expect(available).toContain('CELLULOID_01_FU_LOW');
    const path = resolveLutPath('CELLULOID_01_FU_LOW');
    expect(path).toMatch(/CELLULOID_01_FU_LOW\.cube$/);
    expect(normalizeLutId('CELLULOID_01_FU_LOW.cube')).toBe('CELLULOID_01_FU_LOW');
  });
});
