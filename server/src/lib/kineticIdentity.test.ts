import {describe, expect, it} from 'vitest';
import {resolveKineticIdentity} from './kineticIdentity.ts';

describe('selected preset -> Kinetic identity (the engine side of the request)', () => {
  it('a known preset id resolves to its identity and is logged on the job', () => {
    const warnings: string[] = [];
    const id = resolveKineticIdentity('punchline', warnings);
    expect(id).toMatchObject({presetId: 'punchline', font: 'anton', accent: '#FFE14D', upper: true});
    expect(warnings[0]).toBe('kinetic_engine:identity:punchline:font=anton:text=#FFFFFF:accent=#FFE14D:case=upper');
  });
  it('ids are trimmed; the same id always gives the same identity', () => {
    expect(resolveKineticIdentity('  spotlight ', [])).toEqual(resolveKineticIdentity('spotlight', []));
  });
  it('missing preference: no identity and no warning noise, so Kinetic uses its own look (documented default)', () => {
    for (const v of [undefined, '', '   ']) {
      const w: string[] = [];
      expect(resolveKineticIdentity(v, w)).toBeUndefined();
      expect(w).toEqual([]);
    }
  });
  it('unknown id (routes reject it first): no identity, and the reason is logged, never a silent default', () => {
    const w: string[] = [];
    expect(resolveKineticIdentity('nope', w)).toBeUndefined();
    expect(w).toEqual(['kinetic_engine:identity_unknown_preset:nope']);
  });
});
