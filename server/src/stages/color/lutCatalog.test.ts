import {describe, expect, it} from 'vitest';

import {formatLutsForDirectorPrompt, type LutCatalogEntry} from './lutCatalog.ts';

describe('lut catalog prompt', () => {
  it('prints one field per line using the cube file name', () => {
    const rows: LutCatalogEntry[] = [
      {
        name: 'CELLULOID_01_FU_LOW',
        gamma: 'Blackmagic BMD Film 4K',
        color: 'Blue',
        key: 'Neutral',
        style: 'cine drama',
      },
    ];
    expect(formatLutsForDirectorPrompt(rows)).toBe(
      [
        'CELLULOID_01_FU_LOW',
        'Gamma: Blackmagic BMD Film 4K',
        'Color: Blue',
        'Key: Neutral',
        'Style: cine drama',
      ].join('\n'),
    );
  });

  it('tells the director to skip LUTs when the catalog is empty', () => {
    expect(formatLutsForDirectorPrompt([])).toMatch(/none/i);
  });
});
